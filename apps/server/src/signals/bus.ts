/**
 * bus.ts — signal(): the one call that reports something, from anywhere in the API process.
 *
 *     signal({ type: 'fulfillment.failed', source: 'api', script: 'alice/shed:1.0.0', message });
 *
 * It returns at once, never throws and never waits: a broken sink can never break the request,
 * the run or the mail that reported. The rule of the type (rules.ts) says where it goes:
 *
 *   umami  queued for Umami at once (umami.ts; best-effort, bounded)
 *   store  counted in memory per problem and day, written every FLUSH_MS (one upsert per
 *          problem, however many times it happened); after writing, alerts are considered
 *          (alerts.ts), since only the table knows whether a problem is new
 *
 * A problem is its fingerprint: the type, the script, the message with its numbers taken out,
 * and the line. The same error for five users is one problem with five users.
 *
 * Sinks never signal themselves, so nothing here can loop. Mailgun failures are signalled by
 * EmailService, except for the team's own mails.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';

import { errorOnly, SIGNAL_LIMITS, type Signal, type SignalSample } from '@archiyou/types';

import { config } from '../config';

import { considerAlert } from './alerts';
import { sendDailyReport } from './report';
import { RULES } from './rules';
import { signalStore, utcDay, type SignalOccurrence } from './SignalStore';
import { sendToUmami, type SignalContext } from './umami';

const FLUSH_MS = 10_000;
/** Problems held in memory between flushes; beyond it, signals are dropped and counted. */
const MAX_PENDING = 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The server's own version, as the app version of server signals and in Umami's User-Agent. */
export const SERVER_VERSION = (() =>
{
  try
  {
    return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
  }
  catch
  {
    return 'unknown';
  }
})();
const SERVER_AGENT = `Mozilla/5.0 (compatible; Archiyou/${SERVER_VERSION})`;

/** Since the process started; the daily report shows them and starts them again. */
export const busStats = { received: 0, unknown: 0, dropped: 0, storeFailed: 0, failed: 0 };

let pending = new Map<string, SignalOccurrence>();
let flushing: Promise<void> | null = null;

/** Report something. Returns at once; never throws. */
export function signal(input: Signal, context: SignalContext = {}): void
{
  try
  {
    busStats.received++;
    const rule = RULES[input.type];
    if (!rule)
    {
      busStats.unknown++;
      return;
    }
    const s = clean(input);
    if (rule.umami) sendToUmami(s, rule.umami, context, SERVER_AGENT);
    if (rule.store) collect(s);
  }
  catch
  {
    busStats.failed++;
  }
}

/** Cut a signal down to what is kept: capped strings, a few short data values, no code. */
export function clean(input: Signal): Signal
{
  const cut = (value: unknown, max: number) =>
    (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
  const data = Object.entries(input.data ?? {})
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, SIGNAL_LIMITS.dataKeys)
    .reduce<Record<string, string | number | boolean>>((all, [k, v]) =>
    {
      all[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, SIGNAL_LIMITS.dataValue) : v;
      return all;
    }, {});
  const line = Number.isInteger(input.line) && input.line! >= 0 ? input.line : undefined;

  return {
    type: input.type,
    source: input.source,
    message: cut(errorOnly(input.message), SIGNAL_LIMITS.message),
    script: cut(input.script, SIGNAL_LIMITS.script),
    scriptVersionId: cut(input.scriptVersionId, 100),
    line,
    query: cut(input.query, SIGNAL_LIMITS.query),
    url: cut(input.url, SIGNAL_LIMITS.url),
    appVersion: cut(input.appVersion, 40) ?? (input.source === 'api' || input.source === 'worker' ? SERVER_VERSION : undefined),
    data: Object.keys(data).length ? data : undefined,
    user: cut(input.user, 100)?.toLowerCase(),
  };
}

/** The message with what changes between occurrences taken out: numbers, ids, quoted values. */
export function normalizeMessage(message: string | undefined): string
{
  return (message ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function fingerprint(s: Signal): string
{
  return createHash('sha256')
    .update(JSON.stringify([s.type, s.script ?? '', normalizeMessage(s.message), s.line ?? null]))
    .digest('hex')
    .slice(0, 24);
}

function collect(s: Signal): void
{
  const now = new Date();
  const day = utcDay(now);
  const fp = fingerprint(s);
  const key = `${fp}|${day}`;
  const sample: SignalSample = {
    scriptVersionId: s.scriptVersionId,
    line: s.line,
    query: s.query,
    url: s.url,
    appVersion: s.appVersion,
    data: s.data,
  };
  Object.keys(sample).forEach((k) => sample[k as keyof SignalSample] === undefined && delete sample[k as keyof SignalSample]);

  const known = pending.get(key);
  if (known)
  {
    known.count++;
    known.lastSeen = now;
    known.message = s.message ?? known.message;
    known.sample = sample;
    if (s.user && !known.users.includes(s.user)) known.users.push(s.user);
    return;
  }
  if (pending.size >= MAX_PENDING)
  {
    busStats.dropped++;
    return;
  }
  pending.set(key, {
    fingerprint: fp,
    day,
    type: s.type,
    source: s.source,
    severity: RULES[s.type].severity,
    script: s.script ?? null,
    message: s.message ?? null,
    sample,
    count: 1,
    users: s.user ? [s.user] : [],
    firstSeen: now,
    lastSeen: now,
  });
}

/** Write what was collected and consider its alerts. One flush at a time; never throws.
 *  What arrives during a flush waits for the next one. */
export function flushSignals(): Promise<void>
{
  flushing ??= (async () =>
  {
    try
    {
      const batch = [...pending.values()];
      pending = new Map();
      // One after the other: a burst must not take every database connection.
      await batch.reduce((previous, o) => previous.then(() => flushOne(o)), Promise.resolve());
    }
    finally
    {
      flushing = null;
    }
  })();
  return flushing;
}

async function flushOne(o: SignalOccurrence): Promise<void>
{
  try
  {
    await signalStore.add(o);
  }
  catch (err)
  {
    busStats.storeFailed += o.count;
    console.warn('⚠️  Storing a signal failed:', (err as Error).message);
    return;
  }
  await considerAlert(o, RULES[o.type]).catch((err) =>
    console.warn('⚠️  Alerting about a signal failed:', (err as Error).message));
}

/** Start the bus's timers in the API process: flushing, the daily report, purging old rows and,
 *  when server runs are switched on, watching that a worker listens. All stop with the server. */
export function startSignals(fastify: FastifyInstance, options: { workers?: () => Promise<number> } = {}): void
{
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, task: () => void) =>
  {
    const timer = setInterval(task, ms);
    timer.unref();
    timers.push(timer);
  };

  every(FLUSH_MS, () => { void flushSignals(); });

  const report = () =>
  {
    sendDailyReport().catch((err) => console.warn('⚠️  The daily signals report failed:', (err as Error).message));
  };
  every(HOUR_MS, report);
  setTimeout(report, 60_000).unref();

  const purge = () =>
  {
    signalStore.purge(config.signals.retentionDays)
      .then((n) => { if (n) console.log(`🧹 Forgot ${n} signal row(s) older than ${config.signals.retentionDays} days.`); })
      .catch((err) => signal({ type: 'maintenance.failed', source: 'api', message: `Purging old signals failed: ${(err as Error).message}` }));
  };
  purge();
  every(DAY_MS, purge);

  if (options.workers) watchWorkers(options.workers, every);

  fastify.addHook('onClose', async () =>
  {
    timers.forEach(clearInterval);
    await flushSignals();
  });
}

/** `worker.down` when no execution worker has listened for two checks in a row. The worker
 *  cannot say so itself: it exits on a failed health check, and has no database. */
function watchWorkers(workers: () => Promise<number>, every: (ms: number, task: () => void) => void): void
{
  let missing = 0;
  every(60_000, () =>
  {
    workers()
      .then((n) =>
      {
        missing = n > 0 ? 0 : missing + 1;
        if (missing >= 2) signal({ type: 'worker.down', source: 'api', message: 'No execution worker is listening; server runs cannot be made.' });
      })
      .catch((err) => signal({ type: 'worker.down', source: 'api', message: `Cannot ask Redis for execution workers: ${(err as Error).message}` }));
  });
}

/** Empty the bus (tests). */
export function resetSignals(): void
{
  pending = new Map();
  Object.keys(busStats).forEach((k) => { busStats[k as keyof typeof busStats] = 0; });
}
