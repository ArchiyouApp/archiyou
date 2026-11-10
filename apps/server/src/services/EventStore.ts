/**
 * EventStore — what happened around a published configurator: the `events` rows that carry
 * a `scriptVersionId`. Orders and adjustments are written by ProjectStore (they also belong
 * to a project); the fulfillments handed over without a project (emailed, unlocked, a free
 * download) are written here.
 *
 * Read only by the configurator's author (GET /scripts/configurators/:versionId/events).
 * A visitor is a daily-salted hash (ProjectStore.visitorOf), never an IP.
 */

import { createHash } from 'node:crypto';

import { and, count, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';

import {
  projectLabel,
  type ConfiguratorEvent, type ConfiguratorEventCounts, type ConfiguratorEventFilter,
  type ConfiguratorEventList, type ConfiguratorEventType,
} from '@archiyou/types';
import { uuid4 } from '@archiyou/core/src/utils';

import { db } from '../db/client';
import { clients, configurations, events, projects, scriptVersions, type EventRow } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The same visitor asking for the same configuration by email again within this window
 *  (a double click, an impatient retry) is not sent a second email. */
const EMAIL_DEDUPE_MS = 60 * 60 * 1000;

const FILTER_TYPES: Record<Exclude<ConfiguratorEventFilter, 'all'>, ConfiguratorEventType[]> = {
  orders: ['order.received', 'adjust.requested'],
  fulfillments: ['fulfillment.emailed', 'fulfillment.unlocked', 'fulfillment.downloaded'],
  failed: ['fulfillment.failed'],
};

export interface NewConfiguratorEvent
{
  professional: string;
  scriptVersionId: string;
  type: ConfiguratorEventType;
  meta: Record<string, unknown>;
  visitor?: string | null;
}

/** A fingerprint of one configuration (values + unit system), to recognise a repeat. */
export function configurationKey(values: Record<string, unknown> | null | undefined, unitSystem?: string | null): string
{
  const sorted = Object.keys(values ?? {}).sort().map((k) => [k, (values ?? {})[k]]);
  return createHash('sha256').update(JSON.stringify([sorted, unitSystem ?? null])).digest('hex').slice(0, 24);
}

export class EventStore
{
  async add(event: NewConfiguratorEvent): Promise<void>
  {
    await db.insert(events).values({
      id: uuid4(),
      professional: event.professional,
      projectId: null,
      scriptVersionId: event.scriptVersionId,
      type: event.type,
      actor: 'visitor',
      meta: event.meta,
      visitor: event.visitor ?? null,
      created: new Date(),
    });
  }

  /** Whether this visitor already downloaded this fulfillment today: a download is counted
   *  once per visitor and day, like a delivery's opens. */
  async downloadedToday(scriptVersionId: string, fulfillment: string, visitor: string): Promise<boolean>
  {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const found = await db.select({ meta: events.meta }).from(events).where(and(
      eq(events.scriptVersionId, scriptVersionId),
      eq(events.type, 'fulfillment.downloaded'),
      eq(events.visitor, visitor),
      gt(events.created, today),
    ));
    return found.some((row) => row.meta?.fulfillment === fulfillment);
  }

  /** Emails a configurator sent (or tried to) in the last 24 hours, to cap them. */
  async emailsToday(scriptVersionId: string): Promise<number>
  {
    const [row] = await db.select({ n: count() }).from(events).where(and(
      eq(events.scriptVersionId, scriptVersionId),
      inArray(events.type, ['fulfillment.emailed', 'fulfillment.failed']),
      gt(events.created, new Date(Date.now() - DAY_MS)),
    ));
    return Number(row?.n ?? 0);
  }

  /** Whether this address already asked for this fulfillment of this configuration within
   *  the dedupe window. */
  async emailedRecently(scriptVersionId: string, fulfillment: string, email: string, key: string): Promise<boolean>
  {
    const found = await db.select({ meta: events.meta }).from(events).where(and(
      eq(events.scriptVersionId, scriptVersionId),
      inArray(events.type, ['fulfillment.emailed', 'fulfillment.failed']),
      gt(events.created, new Date(Date.now() - EMAIL_DEDUPE_MS)),
    ));
    return found.some((row) => row.meta?.fulfillment === fulfillment && row.meta?.email === email && row.meta?.key === key);
  }

  /** The version ids (and their semver) the author's events are listed over: one version,
   *  or every version of its file. */
  async versionsOf(author: string, versionId: string, scope: 'version' | 'file'): Promise<Map<string, string | null> | null>
  {
    const [head] = await db.select({ fileId: scriptVersions.fileId, version: scriptVersions.version }).from(scriptVersions)
      .where(and(eq(scriptVersions.id, versionId), eq(scriptVersions.author, author.toLowerCase()))).limit(1);
    if (!head) return null;
    if (scope === 'version') return new Map([[versionId, head.version]]);
    const rows = await db.select({ id: scriptVersions.id, version: scriptVersions.version }).from(scriptVersions)
      .where(and(eq(scriptVersions.fileId, head.fileId), eq(scriptVersions.author, author.toLowerCase())));
    return new Map(rows.map((r) => [r.id, r.version]));
  }

  /** The author's events over `versions`, newest first, a page at a time, with the counts
   *  of the last 30 days. `before` is the `next` of the previous page. */
  async list(professional: string, versions: Map<string, string | null>, options: {
    filter?: ConfiguratorEventFilter;
    before?: string | null;
    limit?: number;
  } = {}): Promise<ConfiguratorEventList>
  {
    const ids = [...versions.keys()];
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const types = options.filter && options.filter !== 'all' ? FILTER_TYPES[options.filter] : null;
    const cursor = parseCursor(options.before);

    const filters = [eq(events.professional, professional), inArray(events.scriptVersionId, ids)];
    if (types) filters.push(inArray(events.type, types));
    if (cursor)
    {
      filters.push(or(lt(events.created, cursor.created), and(eq(events.created, cursor.created), lt(events.id, cursor.id)))!);
    }

    const rows = await db.select({
      event: events,
      projectNumber: projects.number,
      projectTitle: projects.title,
      fulfillment: configurations.fulfillment,
      clientName: clients.name,
      clientEmail: clients.email,
    }).from(events)
      .leftJoin(projects, eq(projects.id, events.projectId))
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(configurations, eq(configurations.id, events.configurationId))
      .where(and(...filters))
      .orderBy(desc(events.created), desc(events.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1]?.event;
    return {
      events: page.map((r) => toConfiguratorEvent(r.event, versions, r)),
      counts: await this.counts(professional, ids),
      next: rows.length > limit && last ? `${last.created.toISOString()}|${last.id}` : null,
    };
  }

  private async counts(professional: string, ids: string[]): Promise<ConfiguratorEventCounts>
  {
    const rows = await db.select({ type: events.type, n: count() }).from(events).where(and(
      eq(events.professional, professional),
      inArray(events.scriptVersionId, ids),
      gt(events.created, new Date(Date.now() - 30 * DAY_MS)),
    )).groupBy(events.type);
    const of = (...types: string[]) => rows.filter((r) => types.includes(r.type)).reduce((sum, r) => sum + Number(r.n), 0);
    return {
      orders: of('order.received'),
      emailed: of('fulfillment.emailed'),
      unlocked: of('fulfillment.unlocked'),
      downloads: of('fulfillment.downloaded'),
      failed: of('fulfillment.failed'),
    };
  }
}

function parseCursor(before: string | null | undefined): { created: Date; id: string } | null
{
  const [at, id] = (before ?? '').split('|');
  const created = at ? new Date(at) : null;
  return created && !Number.isNaN(created.getTime()) && id ? { created, id } : null;
}

function toConfiguratorEvent(
  row: EventRow,
  versions: Map<string, string | null>,
  joined: {
    projectNumber: number | null; projectTitle: string | null; fulfillment: string | null;
    clientName: string | null; clientEmail: string | null;
  },
): ConfiguratorEvent
{
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const user = text(meta.user);
  // An order's client: "Jan (jan@example.com)", or whichever of the two is known
  const client = [joined.clientName, joined.clientEmail && joined.clientName ? `(${joined.clientEmail})` : joined.clientEmail]
    .filter(Boolean).join(' ') || null;
  return {
    id: row.id,
    type: row.type as ConfiguratorEventType,
    created: row.created.toISOString(),
    version: versions.get(row.scriptVersionId ?? '') ?? null,
    fulfillment: text(meta.fulfillment) ?? joined.fulfillment,
    access: text(meta.access),
    who: text(meta.email) ?? (user ? `@${user}` : null) ?? client,
    project: row.projectId && joined.projectNumber !== null
      ? { id: row.projectId, label: projectLabel(joined.projectNumber), title: joined.projectTitle ?? '' }
      : null,
    reason: text(meta.reason),
  };
}

export const eventStore = new EventStore();
