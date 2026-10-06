/**
 * ProjectStore — a professional's clients, projects, configurations, deliveries and the
 * activity on them (plans/PROJECTS.md). Every method takes the professional's handle and
 * every query filters on it, so one professional can never reach another's rows: a
 * foreign id is simply not found.
 *
 * Configurations are snapshots of a script plus validated parameter values, never a
 * reference to a script_versions row: working copies are rewritten by autosave, and files
 * can be deleted.
 */

import { createHash, randomBytes } from 'node:crypto';

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import { uuid4 } from '@archiyou/core/src/utils';
import {
  PROJECT_STATUSES,
  type ClientData, type ClientInput, type ConfigurationData, type ConfigurationOrigin,
  type DeliveryData, type DeliveryFile, type DeliveryFileKind, type DeliveryOffer, type DeliveryResponse, type ProjectCounts, type ProjectData, type ProjectEvent, type ProjectEventActor,
  type ProjectStatus, type ProjectSummary,
} from '@archiyou/types';

import { config } from '../config';
import { db } from '../db/client';
import {
  clients, configurations, deliveries, events, projects,
  type ClientRow, type ConfigurationRow, type DeliveryRow, type EventRow, type ProjectRow,
} from '../db/schema';
import { deliveryFileType } from './DeliveryFileStore';
import { uniqueViolation } from './ScriptStore';

export class ProjectStoreError extends Error
{
  constructor(public readonly code: 'not_found' | 'conflict' | 'invalid' | 'limit', message: string)
  {
    super(message);
  }
}

/** Allowed status changes. Archiving is separate and allowed in any status. */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  request: ['active', 'lost'],
  active: ['won', 'lost'],
  won: ['active'],
  lost: ['active'],
};

export const TEXT_MAX = 2000;
export const TITLE_MAX = 120;
const EVENTS_IN_PROJECT = 200;

export interface NewConfiguration
{
  script: unknown;
  values?: Record<string, unknown> | null;
  unitSystem?: 'metric' | 'imperial' | null;
  lang?: string | null;
  label?: string | null;
  sourceVersionId?: string | null;
  fulfillment?: string | null;
  sourceDeliveryId?: string | null;
  message?: string | null;
}

/** A delivery as the professional starts it; files are added before it is sent. */
export interface NewDelivery
{
  configurationId: string;
  title: string;
  message?: string | null;
  offer?: DeliveryOffer | null;
  /** Defaults to the project's client. */
  recipientEmail?: string | null;
  recipientName?: string | null;
  allowAdjust?: boolean;
}

/** Per-sender caps on deliveries (config.deliveries). */
export interface DeliveryLimits
{
  maxDeliveryBytes: number;
  quotaBytes: number;
  sendPerHour: number;
  sendPerDay: number;
  newAccountSendPerDay: number;
}

/** Output categories (default/{category}/…) and the kind of file they become. */
const KIND_OF_CATEGORY: Record<string, DeliveryFileKind> = { model: 'model', docs: 'document', tables: 'sheet', metrics: 'sheet' };

/**
 * The kinds of file a delivery of this configuration may carry. Of the professional's own
 * script: anything. Of another author's configurator: the 3D model (what its page shows
 * anyway) and what its Download fulfillments give every visitor — nothing more.
 */
export function allowedKinds(professional: string, script: ScriptData): Set<DeliveryFileKind>
{
  if (!script.author || script.author === professional) return new Set(['model', 'document', 'sheet', 'preview']);
  const downloads = (script.published?.fulfillments ?? []).filter((f) => f.category !== 'product');
  const kinds = downloads.flatMap((f) => f.exports.map((path) => KIND_OF_CATEGORY[path.split('/')[1]]).filter(Boolean));
  return new Set<DeliveryFileKind>(['model', 'preview', ...kinds]);
}

/** A visitor of a delivery, for counting unique opens: a hash of who and which day,
 *  salted with the server secret, so it cannot be turned back into an address and does
 *  not follow anyone from one day to the next. */
export function visitorOf(ip: string, userAgent: string, day = new Date().toISOString().slice(0, 10)): string
{
  return createHash('sha256').update(`${config.jwtSecret}|${day}|${ip}|${userAgent}`).digest('hex').slice(0, 32);
}

/** A visitor's order of a product fulfillment (POST /orders). */
export interface NewOrder
{
  /** The published version ordered from; its author is the professional. */
  script: ScriptData;
  fulfillment: string;
  values?: Record<string, unknown> | null;
  unitSystem?: 'metric' | 'imperial' | null;
  lang?: string | null;
  contact: ClientInput & { email: string };
  message?: string | null;
}

/** The same visitor sending the same configuration again within this window gets the
 *  same request back (a double click, a reload), not a second one. */
const ORDER_DEDUPE_MS = 10 * 60 * 1000;

export interface NewEvent
{
  type: string;
  actor: ProjectEventActor;
  deliveryId?: string | null;
  configurationId?: string | null;
  meta?: Record<string, unknown> | null;
  visitor?: string | null;
}

//// MAPPING ////

const iso = (d: Date | null): string | null => d ? d.toISOString() : null;
const trimmed = (v: string | null | undefined, max = TEXT_MAX): string | null =>
{
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};
const normalEmail = (v: string | null | undefined): string | null => trimmed(v, 254)?.toLowerCase() ?? null;

function rowToClient(row: ClientRow): ClientData
{
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    phone: row.phone,
    address: row.address,
    note: row.note,
    created: row.created.toISOString(),
    updated: row.updated.toISOString(),
  };
}

/** The values that differ from their parameter's default. */
export function changedValues(script: ScriptData, values: Record<string, unknown>): Record<string, unknown>
{
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return Object.fromEntries(Object.entries(values).filter(([name, value]) => !same(value, script.params?.[name]?.default)));
}

function rowToConfiguration(row: ConfigurationRow, withScript = false): ConfigurationData
{
  const script = row.script;
  const published = !!script.published && !!script.version && !!script.author && !!script.name;
  return {
    id: row.id,
    projectId: row.projectId,
    rev: row.rev,
    label: row.label,
    origin: row.origin as ConfigurationOrigin,
    fulfillment: row.fulfillment,
    scriptName: script.name ?? null,
    scriptAuthor: script.author ?? null,
    sourceFileId: script.fileId ?? null,
    sourceVersionId: row.sourceVersionId,
    configurator: published
      ? { author: script.author as string, name: script.name as string, version: script.version as string }
      : null,
    values: row.values,
    changed: changedValues(script, row.values),
    unitSystem: (row.unitSystem as ConfigurationData['unitSystem']) ?? null,
    lang: row.lang,
    thumbnail: row.thumbnail,
    message: row.message,
    sourceDeliveryId: row.sourceDeliveryId,
    created: row.created.toISOString(),
    ...(withScript ? { script: script as unknown as Record<string, unknown> } : {}),
  };
}

/** The client's link to a delivery. */
export function deliveryLink(token: string): string
{
  return `${config.frontendUrl.replace(/\/+$/, '')}/d/${token}`;
}

export function rowToDelivery(row: DeliveryRow): DeliveryData
{
  return {
    id: row.id,
    projectId: row.projectId,
    configurationId: row.configurationId,
    number: row.number,
    title: row.title,
    message: row.message,
    offer: row.offer ?? null,
    recipientEmail: row.recipientEmail,
    recipientName: row.recipientName,
    files: row.files,
    status: row.status as DeliveryData['status'],
    allowAdjust: row.allowAdjust,
    link: row.token && row.status !== 'draft' ? deliveryLink(row.token) : null,
    sentAt: iso(row.sentAt),
    firstOpenedAt: iso(row.firstOpenedAt),
    openCount: row.openCount,
    downloadCount: row.downloadCount,
    response: (row.response as DeliveryData['response']) ?? null,
    responseNote: row.responseNote,
    responseAt: iso(row.responseAt),
    created: row.created.toISOString(),
    updated: row.updated.toISOString(),
  };
}

function rowToEvent(row: EventRow): ProjectEvent
{
  return {
    id: row.id,
    type: row.type,
    actor: row.actor as ProjectEventActor,
    deliveryId: row.deliveryId,
    configurationId: row.configurationId,
    meta: row.meta ?? null,
    created: row.created.toISOString(),
  };
}

function rowToSummary(row: ProjectRow, clientName: string | null, thumbnail: string | null): ProjectSummary
{
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status as ProjectStatus,
    clientId: row.clientId,
    clientName,
    thumbnail,
    unread: !!row.clientActivityAt && (!row.seenAt || row.clientActivityAt > row.seenAt),
    archived: row.archivedAt !== null,
    created: row.created.toISOString(),
    updated: row.updated.toISOString(),
  };
}

//// SNAPSHOTS ////

/**
 * Validate a script payload and its parameter values into what a configuration stores.
 * `values` come back complete: every parameter, defaults filled in, uppercase names.
 * An unknown name or an invalid value is the caller's mistake (422), not a crash —
 * checkParamValuesVerbose throws on the first and reports the second.
 */
export function snapshotOf(scriptPayload: unknown, values: Record<string, unknown> | null | undefined):
  { script: ScriptData; values: Record<string, unknown> }
{
  const script = Script.fromData(scriptPayload as Record<string, unknown>);
  if (!script) throw new ProjectStoreError('invalid', 'Script payload failed validation');

  let checked: Record<string, unknown>;
  try
  {
    const result = script.checkParamValuesVerbose((values ?? {}) as Record<string, unknown>);
    // `success` only reflects the last value checked, so the errors are the verdict
    if (result.errors.length > 0) throw new ProjectStoreError('invalid', result.errors.join('; '));
    checked = result.checkedParamValues;
  }
  catch (e)
  {
    if (e instanceof ProjectStoreError) throw e;
    throw new ProjectStoreError('invalid', (e as Error).message);
  }

  const data = script.toData();
  // Translations are the configurator's, kept up to date on the published row; a snapshot
  // would only carry a stale, heavy copy of them.
  const published = data.published ? { ...data.published, translations: undefined } : data.published;
  return { script: { ...data, published }, values: checked };
}

//// STORE ////

export class ProjectStore
{
  //// CLIENTS ////

  async listClients(professional: string, q?: string): Promise<ClientData[]>
  {
    const filters = [eq(clients.professional, professional)];
    if (q)
    {
      const like = `%${q.toLowerCase()}%`;
      filters.push(sql`(lower(coalesce(${clients.name}, '')) LIKE ${like}
        OR lower(coalesce(${clients.email}, '')) LIKE ${like}
        OR lower(coalesce(${clients.company}, '')) LIKE ${like})`);
    }
    const rows = await db.select().from(clients).where(and(...filters)).orderBy(desc(clients.updated)).limit(100);
    return rows.map(rowToClient);
  }

  async getClient(professional: string, id: string): Promise<ClientData>
  {
    return rowToClient(await this.clientRow(professional, id));
  }

  private async clientRow(professional: string, id: string): Promise<ClientRow>
  {
    const [row] = await db.select().from(clients)
      .where(and(eq(clients.professional, professional), eq(clients.id, id))).limit(1);
    if (!row) throw new ProjectStoreError('not_found', `Client ${id} not found`);
    return row;
  }

  async createClient(professional: string, input: ClientInput): Promise<ClientData>
  {
    const now = new Date();
    try
    {
      const [row] = await db.insert(clients).values({
        id: uuid4(),
        professional,
        ...this.clientFields(input),
        created: now,
        updated: now,
      }).returning();
      return rowToClient(row);
    }
    catch (e)
    {
      if (uniqueViolation(e) !== null) throw new ProjectStoreError('conflict', 'You already have a client with this email');
      throw e;
    }
  }

  async updateClient(professional: string, id: string, input: ClientInput): Promise<ClientData>
  {
    await this.clientRow(professional, id);
    try
    {
      const [row] = await db.update(clients).set({ ...this.clientFields(input), updated: new Date() })
        .where(and(eq(clients.professional, professional), eq(clients.id, id))).returning();
      return rowToClient(row);
    }
    catch (e)
    {
      if (uniqueViolation(e) !== null) throw new ProjectStoreError('conflict', 'You already have a client with this email');
      throw e;
    }
  }

  /** Only a client no project refers to: a project's history must keep its client. */
  async deleteClient(professional: string, id: string): Promise<void>
  {
    await this.clientRow(professional, id);
    const [used] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.professional, professional), eq(projects.clientId, id))).limit(1);
    if (used) throw new ProjectStoreError('conflict', 'This client still has projects');
    await db.delete(clients).where(and(eq(clients.professional, professional), eq(clients.id, id)));
  }

  /** The professional's client with this email, updated with what is new, or a new one.
   *  How an order finds its client: the same person ordering twice is one client. */
  async upsertClientByEmail(professional: string, input: ClientInput): Promise<ClientData>
  {
    const email = normalEmail(input.email);
    if (!email) return this.createClient(professional, input);
    const [existing] = await db.select().from(clients)
      .where(and(eq(clients.professional, professional), eq(clients.email, email))).limit(1);
    if (!existing) return this.createClient(professional, input);

    // Fill in what the client did not have yet; never overwrite what the professional wrote
    const fill = Object.fromEntries(
      (['name', 'company', 'phone'] as const)
        .filter((k) => !existing[k] && trimmed(input[k], 200))
        .map((k) => [k, trimmed(input[k], 200)]),
    );
    if (Object.keys(fill).length === 0) return rowToClient(existing);
    const [row] = await db.update(clients).set({ ...fill, updated: new Date() })
      .where(eq(clients.id, existing.id)).returning();
    return rowToClient(row);
  }

  private clientFields(input: ClientInput)
  {
    return {
      email: normalEmail(input.email),
      name: trimmed(input.name, 200),
      company: trimmed(input.company, 200),
      phone: trimmed(input.phone, 50),
      address: trimmed(input.address, 500),
      note: trimmed(input.note),
    };
  }

  //// PROJECTS ////

  async listProjects(
    professional: string,
    opts: { status?: ProjectStatus; q?: string; archived?: boolean; limit?: number; offset?: number } = {},
  ): Promise<{ items: ProjectSummary[]; total: number; counts: ProjectCounts }>
  {
    const live = opts.archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt);
    const filters = [eq(projects.professional, professional), live];
    if (opts.status) filters.push(eq(projects.status, opts.status));
    if (opts.q)
    {
      const like = `%${opts.q.toLowerCase()}%`;
      filters.push(sql`(lower(${projects.title}) LIKE ${like}
        OR lower(coalesce(${clients.name}, '')) LIKE ${like}
        OR lower(coalesce(${clients.email}, '')) LIKE ${like}
        OR lower(coalesce(${clients.company}, '')) LIKE ${like}
        OR ${projects.number}::text = ${opts.q.replace(/^p-0*/i, '')})`);
    }
    const where = and(...filters);

    const [{ n: total }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(projects).leftJoin(clients, eq(projects.clientId, clients.id)).where(where);

    const rows = await db.select({ project: projects, clientName: clients.name, clientEmail: clients.email })
      .from(projects).leftJoin(clients, eq(projects.clientId, clients.id))
      .where(where)
      .orderBy(desc(projects.updated), asc(projects.id))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);

    const thumbnails = await this.latestThumbnails(rows.map((r) => r.project.id));
    const items = rows.map((r) => rowToSummary(r.project, r.clientName ?? r.clientEmail, thumbnails.get(r.project.id) ?? null));
    return { items, total, counts: await this.counts(professional) };
  }

  /** Live (not archived) projects per status. */
  async counts(professional: string): Promise<ProjectCounts>
  {
    const rows = await db.select({ status: projects.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(projects)
      .where(and(eq(projects.professional, professional), isNull(projects.archivedAt)))
      .groupBy(projects.status);
    const counts = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as ProjectCounts;
    rows.forEach((r) => { counts[r.status as ProjectStatus] = r.n; });
    return counts;
  }

  /** The newest configuration thumbnail of each project. */
  private async latestThumbnails(projectIds: string[]): Promise<Map<string, string>>
  {
    if (projectIds.length === 0) return new Map();
    const rows = await db.selectDistinctOn([configurations.projectId], {
      projectId: configurations.projectId,
      thumbnail: configurations.thumbnail,
    })
      .from(configurations)
      .where(and(inArray(configurations.projectId, projectIds), isNotNull(configurations.thumbnail)))
      .orderBy(configurations.projectId, desc(configurations.rev));
    return new Map(rows.map((r) => [r.projectId, r.thumbnail as string]));
  }

  /**
   * A new project with the next number. `status` is 'active' for one the professional
   * starts, 'request' for an order. The number is max+1 per professional, retried once
   * when a concurrent insert took it first.
   */
  async createProject(
    professional: string,
    input: { title?: string | null; clientId?: string | null; client?: ClientInput | null; status?: ProjectStatus; note?: string | null },
  ): Promise<ProjectSummary>
  {
    const clientId = input.clientId
      ? (await this.clientRow(professional, input.clientId)).id
      : input.client ? (await this.upsertClientByEmail(professional, input.client)).id : null;

    const insert = async () =>
    {
      const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${projects.number}), 0) + 1`.mapWith(Number) })
        .from(projects).where(eq(projects.professional, professional));
      const now = new Date();
      const [row] = await db.insert(projects).values({
        id: uuid4(),
        professional,
        number: next,
        title: trimmed(input.title, TITLE_MAX) ?? `Project ${next}`,
        clientId,
        status: input.status ?? 'active',
        note: trimmed(input.note),
        created: now,
        updated: now,
        seenAt: now,
      }).returning();
      return row;
    };

    let row: ProjectRow;
    try
    {
      row = await insert();
    }
    catch (e)
    {
      if (uniqueViolation(e) === null) throw e;
      row = await insert();
    }
    const client = clientId ? await this.clientRow(professional, clientId) : null;
    return rowToSummary(row, client?.name ?? client?.email ?? null, null);
  }

  private async projectRow(professional: string, id: string): Promise<ProjectRow>
  {
    const [row] = await db.select().from(projects)
      .where(and(eq(projects.professional, professional), eq(projects.id, id))).limit(1);
    if (!row) throw new ProjectStoreError('not_found', `Project ${id} not found`);
    return row;
  }

  /** Everything on the project page. Opening it is what clears the unread dot. */
  async getProject(professional: string, id: string, opts: { markSeen?: boolean } = {}): Promise<ProjectData>
  {
    let row = await this.projectRow(professional, id);
    if (opts.markSeen)
    {
      [row] = await db.update(projects).set({ seenAt: new Date() }).where(eq(projects.id, id)).returning();
    }

    const client = row.clientId ? await this.clientRow(professional, row.clientId).catch(() => null) : null;
    const configurationRows = await db.select().from(configurations)
      .where(and(eq(configurations.professional, professional), eq(configurations.projectId, id)))
      .orderBy(desc(configurations.rev));
    const deliveryRows = await db.select().from(deliveries)
      .where(and(eq(deliveries.professional, professional), eq(deliveries.projectId, id)))
      .orderBy(desc(deliveries.number));
    const eventRows = await db.select().from(events)
      .where(and(eq(events.professional, professional), eq(events.projectId, id)))
      .orderBy(desc(events.created), desc(events.id))
      .limit(EVENTS_IN_PROJECT);

    const thumbnail = configurationRows.find((c) => c.thumbnail)?.thumbnail ?? null;
    return {
      ...rowToSummary(row, client?.name ?? client?.email ?? null, thumbnail),
      note: row.note,
      client: client ? rowToClient(client) : null,
      configurations: configurationRows.map((c) => rowToConfiguration(c)),
      deliveries: deliveryRows.map(rowToDelivery),
      events: eventRows.map(rowToEvent),
    };
  }

  async updateProject(
    professional: string,
    id: string,
    patch: { title?: string; status?: ProjectStatus; note?: string | null; archived?: boolean; clientId?: string | null },
  ): Promise<ProjectData>
  {
    const row = await this.projectRow(professional, id);
    const set: Partial<typeof projects.$inferInsert> = { updated: new Date() };

    if (patch.title !== undefined)
    {
      const title = trimmed(patch.title, TITLE_MAX);
      if (!title) throw new ProjectStoreError('invalid', 'A project needs a title');
      set.title = title;
    }
    if (patch.note !== undefined) set.note = trimmed(patch.note);
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? (row.archivedAt ?? new Date()) : null;
    if (patch.clientId !== undefined)
    {
      set.clientId = patch.clientId ? (await this.clientRow(professional, patch.clientId)).id : null;
    }
    if (patch.status !== undefined && patch.status !== row.status)
    {
      const from = row.status as ProjectStatus;
      if (!TRANSITIONS[from]?.includes(patch.status))
      {
        throw new ProjectStoreError('invalid', `A project cannot go from ${from} to ${patch.status}`);
      }
      set.status = patch.status;
    }

    await db.update(projects).set(set).where(eq(projects.id, id));
    if (set.status) await this.addEvent(professional, id, { type: 'status.changed', actor: 'professional', meta: { from: row.status, to: set.status } });
    return this.getProject(professional, id);
  }

  /** The project and everything in it. Files on disk are the caller's (the route). */
  async deleteProject(professional: string, id: string): Promise<{ deliveryIds: string[] }>
  {
    await this.projectRow(professional, id);
    const owned = (table: typeof configurations | typeof deliveries | typeof events) =>
      and(eq(table.professional, professional), eq(table.projectId, id));
    const deliveryIds = (await db.select({ id: deliveries.id }).from(deliveries).where(owned(deliveries))).map((r) => r.id);
    await db.transaction(async (tx) =>
    {
      await tx.delete(events).where(owned(events));
      await tx.delete(deliveries).where(owned(deliveries));
      await tx.delete(configurations).where(owned(configurations));
      await tx.delete(projects).where(and(eq(projects.professional, professional), eq(projects.id, id)));
    });
    return { deliveryIds };
  }

  //// CONFIGURATIONS ////

  /**
   * Add a configuration (the next rev) to a project: a snapshot of `script` with its
   * validated values. Any script — the professional's own or another author's.
   */
  async addConfiguration(
    professional: string,
    projectId: string,
    input: NewConfiguration,
    origin: ConfigurationOrigin = 'added',
    opts: { event?: boolean } = {},
  ): Promise<ConfigurationData>
  {
    await this.projectRow(professional, projectId);
    const { script, values } = snapshotOf(input.script, input.values);

    const insert = async () =>
    {
      const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${configurations.rev}), 0) + 1`.mapWith(Number) })
        .from(configurations).where(eq(configurations.projectId, projectId));
      const [row] = await db.insert(configurations).values({
        id: uuid4(),
        professional,
        projectId,
        rev: next,
        label: trimmed(input.label, TITLE_MAX),
        script,
        values,
        unitSystem: input.unitSystem ?? script.units ?? null,
        lang: trimmed(input.lang, 10),
        origin,
        fulfillment: trimmed(input.fulfillment, 200),
        sourceVersionId: trimmed(input.sourceVersionId, 100) ?? script.id ?? null,
        sourceDeliveryId: input.sourceDeliveryId ?? null,
        message: trimmed(input.message),
        created: new Date(),
      }).returning();
      return row;
    };

    let row: ConfigurationRow;
    try
    {
      row = await insert();
    }
    catch (e)
    {
      if (uniqueViolation(e) === null) throw e;
      row = await insert();
    }

    await db.update(projects).set({ updated: new Date() }).where(eq(projects.id, projectId));
    if (opts.event === false) return rowToConfiguration(row);
    await this.addEvent(professional, projectId, {
      type: 'configuration.added',
      actor: origin === 'added' ? 'professional' : 'client',
      configurationId: row.id,
      meta: { rev: row.rev, origin },
    });
    return rowToConfiguration(row);
  }

  async getConfiguration(professional: string, projectId: string, id: string, withScript = true): Promise<ConfigurationData>
  {
    return rowToConfiguration(await this.configurationRow(professional, projectId, id), withScript);
  }

  async configurationRow(professional: string, projectId: string, id: string): Promise<ConfigurationRow>
  {
    const [row] = await db.select().from(configurations)
      .where(and(eq(configurations.professional, professional), eq(configurations.projectId, projectId), eq(configurations.id, id)))
      .limit(1);
    if (!row) throw new ProjectStoreError('not_found', `Configuration ${id} not found`);
    return row;
  }

  /** The only thing about a configuration that can change: the professional's label. */
  async setConfigurationLabel(professional: string, projectId: string, id: string, label: string | null): Promise<ConfigurationData>
  {
    await this.configurationRow(professional, projectId, id);
    const [row] = await db.update(configurations).set({ label: trimmed(label, TITLE_MAX) })
      .where(eq(configurations.id, id)).returning();
    return rowToConfiguration(row);
  }

  async setConfigurationThumbnail(professional: string, projectId: string, id: string, url: string): Promise<ConfigurationData>
  {
    await this.configurationRow(professional, projectId, id);
    const [row] = await db.update(configurations).set({ thumbnail: url })
      .where(eq(configurations.id, id)).returning();
    return rowToConfiguration(row);
  }

  //// DELIVERIES ////

  async deliveryRow(professional: string, projectId: string, id: string): Promise<DeliveryRow>
  {
    const [row] = await db.select().from(deliveries)
      .where(and(eq(deliveries.professional, professional), eq(deliveries.projectId, projectId), eq(deliveries.id, id)))
      .limit(1);
    if (!row) throw new ProjectStoreError('not_found', `Delivery ${id} not found`);
    return row;
  }

  /** A draft delivery of one configuration (the next number in the project). */
  async createDelivery(professional: string, projectId: string, input: NewDelivery): Promise<DeliveryData>
  {
    const project = await this.projectRow(professional, projectId);
    await this.configurationRow(professional, projectId, input.configurationId);
    const client = project.clientId ? await this.clientRow(professional, project.clientId).catch(() => null) : null;
    const title = trimmed(input.title, TITLE_MAX);
    if (!title) throw new ProjectStoreError('invalid', 'A delivery needs a title');
    const offer = input.offer
      ? {
        total: Number(input.offer.total) || 0,
        currency: trimmed(input.offer.currency, 3)?.toUpperCase() ?? 'EUR',
        validUntil: trimmed(input.offer.validUntil, 10),
        note: trimmed(input.offer.note),
      }
      : null;

    const insert = async () =>
    {
      const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${deliveries.number}), 0) + 1`.mapWith(Number) })
        .from(deliveries).where(eq(deliveries.projectId, projectId));
      const now = new Date();
      const [row] = await db.insert(deliveries).values({
        id: uuid4(),
        professional,
        projectId,
        configurationId: input.configurationId,
        number: next,
        title,
        message: trimmed(input.message),
        offer,
        recipientEmail: normalEmail(input.recipientEmail) ?? client?.email ?? null,
        recipientName: trimmed(input.recipientName, 200) ?? client?.name ?? null,
        status: 'draft',
        allowAdjust: !!input.allowAdjust,
        created: now,
        updated: now,
      }).returning();
      return row;
    };
    try
    {
      return rowToDelivery(await insert());
    }
    catch (e)
    {
      if (uniqueViolation(e) === null) throw e;
      return rowToDelivery(await insert());
    }
  }

  /**
   * Add (or replace) one file of a draft delivery. Checks everything before `write` puts
   * the bytes on disk: the name, that this configuration may carry this kind of file, the
   * delivery's size and the professional's quota. Only then is the file listed.
   */
  async addDeliveryFile(
    professional: string,
    projectId: string,
    id: string,
    name: string,
    bytes: number,
    limits: Pick<DeliveryLimits, 'maxDeliveryBytes' | 'quotaBytes'>,
    write: () => Promise<void>,
  ): Promise<DeliveryData>
  {
    const row = await this.deliveryRow(professional, projectId, id);
    if (row.status !== 'draft') throw new ProjectStoreError('conflict', 'A sent delivery cannot change');
    const type = deliveryFileType(name);
    if (!type) throw new ProjectStoreError('invalid', `A delivery cannot hold "${name}": .glb, .pdf, .xlsx and .png only`);

    const configuration = await this.configurationRow(professional, projectId, row.configurationId);
    if (!allowedKinds(professional, configuration.script).has(type.kind))
    {
      throw new ProjectStoreError('invalid', 'From another author\'s configurator you can only deliver the 3D model and what it offers for download');
    }

    const files: DeliveryFile[] = [...row.files.filter((f) => f.name !== name), { name, kind: type.kind, bytes, mime: type.mime }];
    const total = files.reduce((sum, f) => sum + f.bytes, 0);
    if (total > limits.maxDeliveryBytes) throw new ProjectStoreError('limit', 'This delivery is too large');
    const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${deliveries.bytes}), 0)`.mapWith(Number) })
      .from(deliveries).where(and(eq(deliveries.professional, professional), ne(deliveries.id, id)));
    if (used + total > limits.quotaBytes) throw new ProjectStoreError('limit', 'Your deliveries take up all the space you have. Delete old projects to make room.');

    await write();
    const [updated] = await db.update(deliveries).set({ files, bytes: total, updated: new Date() })
      .where(eq(deliveries.id, id)).returning();
    return rowToDelivery(updated);
  }

  /**
   * Send a draft: give it its link and freeze it. The caller emails the link. Capped per
   * professional — everyone with a verified address can email strangers through this.
   */
  async sendDelivery(professional: string, projectId: string, id: string, accountCreated: Date, limits: DeliveryLimits): Promise<DeliveryData>
  {
    const row = await this.deliveryRow(professional, projectId, id);
    if (row.status !== 'draft') throw new ProjectStoreError('conflict', 'This delivery was sent already');
    if (!row.recipientEmail) throw new ProjectStoreError('invalid', 'Who should get it? Add the client\'s email address.');
    if (row.files.length === 0) throw new ProjectStoreError('invalid', 'A delivery needs its files');

    const sentSince = async (ms: number) =>
    {
      const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(deliveries)
        .where(and(eq(deliveries.professional, professional), gt(deliveries.sentAt, new Date(Date.now() - ms))));
      return n;
    };
    const DAY = 24 * 60 * 60 * 1000;
    const newAccount = Date.now() - accountCreated.getTime() < DAY;
    if (await sentSince(60 * 60 * 1000) >= limits.sendPerHour
      || await sentSince(DAY) >= (newAccount ? limits.newAccountSendPerDay : limits.sendPerDay))
    {
      throw new ProjectStoreError('limit', 'You have sent a lot of deliveries just now. Please wait a while before sending more.');
    }

    const now = new Date();
    const [sent] = await db.update(deliveries)
      .set({ status: 'sent', token: randomBytes(32).toString('base64url'), sentAt: now, updated: now })
      .where(eq(deliveries.id, id)).returning();
    await db.update(projects).set({ updated: now }).where(eq(projects.id, projectId));
    await this.addEvent(professional, projectId, {
      type: 'delivery.sent', actor: 'professional', deliveryId: id, meta: { number: sent.number, to: sent.recipientEmail },
    });
    return rowToDelivery(sent);
  }

  /** Take a sent delivery offline: its link and its files stop working. */
  async revokeDelivery(professional: string, projectId: string, id: string): Promise<DeliveryData>
  {
    const row = await this.deliveryRow(professional, projectId, id);
    if (row.status !== 'sent') throw new ProjectStoreError('conflict', 'Only a sent delivery can be revoked');
    const [revoked] = await db.update(deliveries).set({ status: 'revoked', updated: new Date() })
      .where(eq(deliveries.id, id)).returning();
    await this.addEvent(professional, projectId, { type: 'delivery.revoked', actor: 'professional', deliveryId: id, meta: { number: row.number } });
    return rowToDelivery(revoked);
  }

  /** A draft that will not be sent. Its files are the caller's to remove. */
  async deleteDraft(professional: string, projectId: string, id: string): Promise<void>
  {
    const row = await this.deliveryRow(professional, projectId, id);
    if (row.status !== 'draft') throw new ProjectStoreError('conflict', 'A sent delivery stays in the project; revoke it instead');
    await db.delete(deliveries).where(eq(deliveries.id, id));
  }

  //// THE CLIENT'S SIDE OF A DELIVERY ////

  /** A sent (or revoked) delivery by its link; drafts have no link. */
  async deliveryByToken(token: string): Promise<DeliveryRow | null>
  {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const [row] = await db.select().from(deliveries).where(eq(deliveries.token, token)).limit(1);
    return row && row.status !== 'draft' ? row : null;
  }

  /** Has this visitor done this today already? Reloading the page is not a second open. */
  private async seenToday(row: DeliveryRow, type: string, visitor: string, file?: string): Promise<boolean>
  {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const found = await db.select({ meta: events.meta }).from(events)
      .where(and(eq(events.deliveryId, row.id), eq(events.type, type), eq(events.visitor, visitor), gt(events.created, today)));
    return found.some((e) => file === undefined || (e.meta as { file?: string } | null)?.file === file);
  }

  /** The client opened the page: counted once per visitor per day. */
  async recordOpen(row: DeliveryRow, visitor: string): Promise<void>
  {
    if (await this.seenToday(row, 'delivery.opened', visitor)) return;
    const now = new Date();
    await db.update(deliveries).set({
      openCount: sql`${deliveries.openCount} + 1`,
      firstOpenedAt: row.firstOpenedAt ?? now,
    }).where(eq(deliveries.id, row.id));
    await this.addEvent(row.professional, row.projectId, {
      type: 'delivery.opened', actor: 'client', deliveryId: row.id, visitor, meta: { number: row.number },
    });
  }

  /** The client downloaded a file: counted once per visitor, file and day. */
  async recordDownload(row: DeliveryRow, file: string, visitor: string): Promise<void>
  {
    if (await this.seenToday(row, 'file.downloaded', visitor, file)) return;
    await db.update(deliveries).set({ downloadCount: sql`${deliveries.downloadCount} + 1` }).where(eq(deliveries.id, row.id));
    await this.addEvent(row.professional, row.projectId, {
      type: 'file.downloaded', actor: 'client', deliveryId: row.id, visitor, meta: { number: row.number, file },
    });
  }

  /** The client's answer to an offer: once, and only while the link works. */
  async respond(row: DeliveryRow, response: DeliveryResponse, note: string | null): Promise<DeliveryRow>
  {
    if (row.status !== 'sent') throw new ProjectStoreError('not_found', 'This link is no longer available');
    if (row.response) throw new ProjectStoreError('conflict', 'This offer has been answered already');
    const [answered] = await db.update(deliveries)
      .set({ response, responseNote: trimmed(note), responseAt: new Date() })
      .where(and(eq(deliveries.id, row.id), isNull(deliveries.response)))
      .returning();
    if (!answered) throw new ProjectStoreError('conflict', 'This offer has been answered already');
    const type = response === 'changes' ? 'delivery.changes_requested' : `delivery.${response}`;
    await this.addEvent(row.professional, row.projectId, {
      type, actor: 'client', deliveryId: row.id, meta: { number: row.number, note: answered.responseNote },
    });
    return answered;
  }

  //// ORDERS ////

  /**
   * A product order from a configurator: the visitor becomes (or is found as) a client of
   * the configurator's author, and the order a project in status `request` with the
   * configuration as v1. The same order again within ORDER_DEDUPE_MS returns the first one.
   *
   * Over `perDay` orders of this configurator in the last 24 hours is a 'limit' error:
   * the form is public, so one configurator must not be able to flood an inbox.
   */
  async receiveOrder(order: NewOrder, perDay: number):
    Promise<{ project: ProjectSummary; configuration: ConfigurationData; duplicate: boolean }>
  {
    const professional = (order.script.author ?? '').toLowerCase();
    const versionId = order.script.id as string;
    if (!professional || !versionId) throw new ProjectStoreError('not_found', 'This configurator does not take orders');
    const email = normalEmail(order.contact.email);
    if (!email) throw new ProjectStoreError('invalid', 'An email address is needed to order');

    const recent = (since: number) => and(
      eq(configurations.professional, professional),
      eq(configurations.origin, 'order'),
      eq(configurations.sourceVersionId, versionId),
      gt(configurations.created, new Date(Date.now() - since)),
    );

    const [{ n: today }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(configurations).where(recent(24 * 60 * 60 * 1000));
    if (today >= perDay) throw new ProjectStoreError('limit', 'This configurator has had too many orders today. Please try again tomorrow.');

    // Validate before anything is written
    const { values } = snapshotOf(order.script, order.values);

    const same = JSON.stringify(values);
    const [duplicate] = (await db.select({ configuration: configurations, project: projects })
      .from(configurations)
      .innerJoin(projects, eq(projects.id, configurations.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(and(recent(ORDER_DEDUPE_MS), eq(clients.email, email))))
      .filter((r) => JSON.stringify(r.configuration.values) === same);
    if (duplicate)
    {
      return {
        project: rowToSummary(duplicate.project, null, duplicate.configuration.thumbnail),
        configuration: rowToConfiguration(duplicate.configuration),
        duplicate: true,
      };
    }

    const client = await this.upsertClientByEmail(professional, { ...order.contact, email });
    const project = await this.createProject(professional, {
      title: `${order.fulfillment} – ${client.name ?? client.email}`,
      clientId: client.id,
      status: 'request',
    });
    const configuration = await this.addConfiguration(professional, project.id, {
      script: order.script,
      values,
      unitSystem: order.unitSystem,
      lang: order.lang,
      fulfillment: order.fulfillment,
      sourceVersionId: versionId,
      message: order.message,
    }, 'order', { event: false });
    await this.addEvent(professional, project.id, {
      type: 'order.received',
      actor: 'client',
      configurationId: configuration.id,
      meta: { fulfillment: order.fulfillment, rev: configuration.rev },
    });
    return { project, configuration, duplicate: false };
  }

  //// EVENTS ////

  /** Record activity. A client's event also lights the project's unread dot. */
  async addEvent(professional: string, projectId: string, event: NewEvent): Promise<void>
  {
    const now = new Date();
    await db.insert(events).values({
      id: uuid4(),
      professional,
      projectId,
      deliveryId: event.deliveryId ?? null,
      configurationId: event.configurationId ?? null,
      type: event.type,
      actor: event.actor,
      meta: event.meta ?? null,
      visitor: event.visitor ?? null,
      created: now,
    });
    if (event.actor === 'client')
    {
      await db.update(projects).set({ clientActivityAt: now, updated: now })
        .where(and(eq(projects.professional, professional), eq(projects.id, projectId)));
    }
  }

  /** Forget activity older than `days`. Returns how many events went. */
  async purgeEvents(days = config.events.retentionDays): Promise<number>
  {
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const gone = await db.delete(events).where(lt(events.created, before)).returning({ id: events.id });
    return gone.length;
  }
}

export const projectStore = new ProjectStore();
