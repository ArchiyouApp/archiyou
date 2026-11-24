/**
 * SignalStore — the `signals` table: one row per problem (fingerprint) per UTC day, counted.
 * Written by the bus (bus.ts) in batches, read by the admin's Signals section, the alerts and
 * the daily report. See db/schema.ts for the columns.
 */

import { and, asc, desc, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm';

import {
  SIGNAL_SEVERITIES,
  type AdminSignal, type AdminSignalList, type SignalRange, type SignalSample, type SignalSeverity,
  type SignalSort, type SignalSource, type SignalType,
} from '@archiyou/types';

import { db } from '../db/client';
import { signals } from '../db/schema';

/** Signed-in users kept per problem and day. */
export const USERS_PER_DAY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The outer query's fingerprint, inside a subquery on the same table. Spelled out: Drizzle
 *  writes a column of a single-table select without its table, which inside the subquery would
 *  mean the subquery's own row. */
const OUTER_FINGERPRINT = sql.raw('"signals"."fingerprint"');

/** 'YYYY-MM-DD' of a moment, in UTC. */
export function utcDay(at: Date = new Date()): string
{
  return at.toISOString().slice(0, 10);
}

/** The UTC day `days` after (or before, negative) `day`. */
export function addDays(day: string, days: number): string
{
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** First day of a range that ends today. */
export function rangeStart(range: SignalRange, today = utcDay()): string
{
  const back = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[range];
  return addDays(today, -back);
}

/** What the bus collected for one problem on one day, since its last flush. */
export interface SignalOccurrence
{
  fingerprint: string;
  day: string;
  type: SignalType;
  source: SignalSource;
  severity: SignalSeverity;
  script: string | null;
  message: string | null;
  sample: SignalSample;
  count: number;
  users: string[];
  firstSeen: Date;
  lastSeen: Date;
}

/** One problem on one day, for the report. */
export interface SignalDayRow
{
  fingerprint: string;
  type: SignalType;
  source: SignalSource;
  severity: SignalSeverity;
  script: string | null;
  message: string | null;
  count: number;
  users: string[];
  sample: SignalSample;
  /** Not seen on any earlier day. */
  isNew: boolean;
}

export interface SignalFilter
{
  range?: SignalRange;
  q?: string;
  type?: SignalType;
  source?: SignalSource;
  severity?: SignalSeverity;
  sort?: SignalSort;
  limit?: number;
  offset?: number;
}

export class SignalStore
{
  /** Count an occurrence in: a new row for the day, or added to the day's row. Keeps the latest
   *  message and sample, and up to USERS_PER_DAY distinct users. */
  async add(o: SignalOccurrence): Promise<void>
  {
    await db.insert(signals).values({
      fingerprint: o.fingerprint,
      day: o.day,
      type: o.type,
      source: o.source,
      severity: o.severity,
      script: o.script,
      message: o.message,
      count: o.count,
      users: o.users.slice(0, USERS_PER_DAY),
      sample: o.sample,
      firstSeen: o.firstSeen,
      lastSeen: o.lastSeen,
    }).onConflictDoUpdate({
      target: [signals.fingerprint, signals.day],
      set: {
        count: sql`${signals.count} + excluded.count`,
        lastSeen: sql`greatest(${signals.lastSeen}, excluded.last_seen)`,
        message: sql`excluded.message`,
        sample: sql`excluded.sample`,
        users: sql`(select coalesce(jsonb_agg(u order by u), '[]'::jsonb)
          from (select distinct u from jsonb_array_elements_text(${signals.users} || excluded.users) as u
                order by u limit ${USERS_PER_DAY}) as merged)`,
      },
    });
  }

  /** When the team was last emailed about this problem, on any day still kept. */
  async lastAlerted(fingerprint: string): Promise<Date | null>
  {
    const [row] = await db.select({ at: sql<Date | null>`max(${signals.alertedAt})`.mapWith(signals.alertedAt) })
      .from(signals).where(eq(signals.fingerprint, fingerprint));
    return row?.at ?? null;
  }

  /** `at: null` takes an alert back (its mail could not be sent), so the next occurrence tries again. */
  async markAlerted(fingerprint: string, day: string, at: Date | null = new Date()): Promise<void>
  {
    await db.update(signals).set({ alertedAt: at })
      .where(and(eq(signals.fingerprint, fingerprint), eq(signals.day, day)));
  }

  /** Every problem of one day, worst and most frequent first. */
  async day(day: string): Promise<SignalDayRow[]>
  {
    const rows = await db.select({
      fingerprint: signals.fingerprint,
      type: signals.type,
      source: signals.source,
      severity: signals.severity,
      script: signals.script,
      message: signals.message,
      count: signals.count,
      users: signals.users,
      sample: signals.sample,
      isNew: sql<boolean>`not exists (select 1 from ${signals} as earlier
        where earlier.fingerprint = ${OUTER_FINGERPRINT} and earlier.day < ${day})`,
    }).from(signals)
      .where(and(eq(signals.day, day), ne(signals.type, 'report.sent')))
      .orderBy(desc(signals.count), asc(signals.fingerprint));
    return rows
      .map((r) => ({ ...r, isNew: Boolean(r.isNew) }))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  /** The admin's table: problems over a range, grouped over its days. */
  async list(filter: SignalFilter = {}): Promise<AdminSignalList>
  {
    const start = rangeStart(filter.range ?? '7d');
    const inRange = and(gte(signals.day, start), ne(signals.type, 'report.sent'));

    const conditions: SQL[] = [inRange!];
    if (filter.type) conditions.push(eq(signals.type, filter.type));
    if (filter.source) conditions.push(eq(signals.source, filter.source));
    if (filter.severity) conditions.push(eq(signals.severity, filter.severity));
    if (filter.q?.trim())
    {
      const like = `%${filter.q.trim().toLowerCase()}%`;
      conditions.push(sql`(lower(coalesce(${signals.message}, '')) like ${like}
        or lower(coalesce(${signals.script}, '')) like ${like}
        or lower(${signals.users}::text) like ${like}
        or lower(${signals.type}) like ${like})`);
    }
    const where = and(...conditions);

    const [{ total }] = await db.select({ total: sql<number>`count(distinct ${signals.fingerprint})`.mapWith(Number) })
      .from(signals).where(where);

    const latest = (column: SQL | typeof signals.message) => sql`(array_agg(${column} order by ${signals.lastSeen} desc))[1]`;
    const count = sql<number>`sum(${signals.count})`.mapWith(Number);
    const firstSeen = sql<Date>`min(${signals.firstSeen})`.mapWith(signals.firstSeen);
    const lastSeen = sql<Date>`max(${signals.lastSeen})`.mapWith(signals.lastSeen);
    const order =
      filter.sort === 'count' ? [desc(count), desc(lastSeen)] :
      filter.sort === 'first' ? [desc(firstSeen)] :
      [desc(lastSeen)];

    const rows = await db.select({
      fingerprint: signals.fingerprint,
      type: sql<SignalType>`max(${signals.type})`,
      source: sql<SignalSource>`max(${signals.source})`,
      severity: sql<SignalSeverity>`max(${signals.severity})`,
      script: sql<string | null>`max(${signals.script})`,
      message: sql<string | null>`${latest(signals.message)}`,
      sample: sql<SignalSample>`${latest(sql`${signals.sample}`)}`.mapWith(signals.sample),
      users: sql<string[][]>`jsonb_agg(${signals.users})`.mapWith(signals.sample),
      count,
      firstSeen,
      lastSeen,
      isNew: sql<boolean>`not exists (select 1 from ${signals} as earlier
        where earlier.fingerprint = ${OUTER_FINGERPRINT} and earlier.day < ${start})`,
    }).from(signals)
      .where(where)
      .groupBy(signals.fingerprint)
      .orderBy(...order, asc(signals.fingerprint))
      .limit(Math.min(filter.limit ?? 50, 200))
      .offset(Math.max(filter.offset ?? 0, 0));

    const items: AdminSignal[] = rows.map((r) => ({
      fingerprint: r.fingerprint,
      type: r.type,
      source: r.source,
      severity: r.severity,
      script: r.script,
      message: r.message,
      count: r.count,
      users: [...new Set(((r.users ?? []) as unknown as string[][]).flat())].sort(),
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: new Date(r.lastSeen).toISOString(),
      isNew: Boolean(r.isNew),
      sample: (r.sample ?? {}) as SignalSample,
    }));

    const severityRows = await db.select({ severity: signals.severity, n: sql<number>`sum(${signals.count})`.mapWith(Number) })
      .from(signals).where(inRange).groupBy(signals.severity);
    const counts = Object.fromEntries(SIGNAL_SEVERITIES.map((s) => [s, 0])) as Record<SignalSeverity, number>;
    severityRows.forEach((r) => { counts[r.severity] = r.n; });

    const typeRows = await db.selectDistinct({ type: signals.type }).from(signals).where(inRange).orderBy(asc(signals.type));

    return { items, total, counts, types: typeRows.map((r) => r.type) };
  }

  /** Forget days older than `retentionDays`. Returns how many rows went. */
  async purge(retentionDays: number, today = utcDay()): Promise<number>
  {
    const gone = await db.delete(signals).where(lt(signals.day, addDays(today, -retentionDays)))
      .returning({ fingerprint: signals.fingerprint });
    return gone.length;
  }

  /** Take the right to send the report on `day`. True for exactly one caller, ever (until purged):
   *  the claim is a row, and a second insert of it does nothing. */
  async claimReport(day: string): Promise<boolean>
  {
    const claimed = await db.insert(signals).values({
      fingerprint: `report:${day}`,
      day,
      type: 'report.sent',
      source: 'api',
      severity: 'info',
      count: 1,
    }).onConflictDoNothing().returning({ fingerprint: signals.fingerprint });
    return claimed.length > 0;
  }

  /** Give a claim back, so the report is tried again (its email could not be made). */
  async releaseReport(day: string): Promise<void>
  {
    await db.delete(signals).where(and(eq(signals.fingerprint, `report:${day}`), eq(signals.day, day)));
  }
}

export function severityRank(severity: SignalSeverity): number
{
  return SIGNAL_SEVERITIES.indexOf(severity);
}

export const signalStore = new SignalStore();
