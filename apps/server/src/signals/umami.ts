/**
 * umami.ts — signals as Umami events, on the "Archiyou platform" website of the team's own
 * Umami (config.signals). Best-effort by design: a queue of at most MAX_QUEUE events, two
 * requests at a time, each given TIMEOUT_MS. When Umami is slow or down, events are dropped
 * and counted (the daily report shows how many); nothing ever waits on Umami.
 *
 * An event carries what is on screen (script, message, line, configuration), never the user.
 * For a browser's signal the visitor's User-Agent and address are passed on, as the sites'
 * own tracker proxy does (archiyou-sites, src/app/(frontend)/t/api/send/route.ts), so Umami can
 * tell visits apart; Umami itself stores no addresses.
 *
 * Reading back (eventValues) is only for the report's failure rates and needs an API key.
 */

import type { Signal } from '@archiyou/types';

import { config } from '../config';

const MAX_QUEUE = 500;
const CONCURRENCY = 2;
const TIMEOUT_MS = 3000;

/** Who sent the signal, for Umami's visit counting. Never stored. */
export interface SignalContext
{
  userAgent?: string;
  ip?: string;
}

export const umamiStats = { sent: 0, failed: 0, dropped: 0 };

interface UmamiJob
{
  body: string;
  headers: Record<string, string>;
}

const queue: UmamiJob[] = [];
let active = 0;

export function umamiConfigured(): boolean
{
  return Boolean(config.signals.umamiUrl && config.signals.umamiWebsiteId);
}

/** The Umami event of a signal (exported for tests). */
export function umamiPayload(s: Signal, name: string): Record<string, unknown>
{
  const data: Record<string, string | number | boolean> = { source: s.source };
  if (s.script) data.script = s.script;
  if (s.message) data.message = s.message.slice(0, 200);
  if (s.line !== undefined) data.line = s.line;
  if (s.query) data.query = s.query.slice(0, 200);
  if (s.appVersion) data.appVersion = s.appVersion;
  Object.entries(s.data ?? {}).forEach(([key, value]) => { data[key] ??= value; });

  return {
    type: 'event',
    payload: {
      website: config.signals.umamiWebsiteId,
      hostname: hostnameOf(config.frontendUrl),
      url: s.url || '/',
      name,
      data,
      // The design without its version, so all versions of a configurator add up.
      ...(s.script ? { tag: s.script.replace(/:[^:]*$/, '') } : {}),
    },
  };
}

/** Queue a signal for Umami. Returns at once; never throws. */
export function sendToUmami(s: Signal, name: string, context: SignalContext, serverAgent: string): void
{
  if (!umamiConfigured()) return;
  if (queue.length >= MAX_QUEUE)
  {
    umamiStats.dropped++;
    return;
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': context.userAgent || serverAgent,
  };
  if (context.ip) headers['x-forwarded-for'] = context.ip;
  queue.push({ body: JSON.stringify(umamiPayload(s, name)), headers });
  pump();
}

function pump(): void
{
  if (active >= CONCURRENCY || queue.length === 0) return;
  const job = queue.shift()!;
  active++;
  post(job).finally(() =>
  {
    active--;
    pump();
  });
  pump();
}

async function post(job: UmamiJob): Promise<void>
{
  try
  {
    const res = await fetch(`${config.signals.umamiUrl}/api/send`, {
      method: 'POST',
      headers: job.headers,
      body: job.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) umamiStats.sent++;
    else umamiStats.failed++;
    await res.body?.cancel().catch(() => undefined);
  }
  catch
  {
    umamiStats.failed++;
  }
}

/** Resolves once nothing is queued or in flight (tests, shutdown). */
export function umamiIdle(): Promise<void>
{
  return new Promise((resolve) =>
  {
    const check = () => (queue.length === 0 && active === 0 ? resolve() : setTimeout(check, 10));
    check();
  });
}

/** How often each value of one property of an event occurred in a period, or null when Umami
 *  cannot be asked (no API key, unreachable). For the report only. */
export async function eventValues(event: string, property: string, startAt: Date, endAt: Date): Promise<Map<string, number> | null>
{
  if (!umamiConfigured() || !config.signals.umamiApiKey) return null;
  try
  {
    const url = new URL(`${config.signals.umamiUrl}/api/websites/${config.signals.umamiWebsiteId}/event-data/values`);
    url.searchParams.set('startAt', String(startAt.getTime()));
    url.searchParams.set('endAt', String(endAt.getTime()));
    url.searchParams.set('event', event);
    url.searchParams.set('propertyName', property);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${config.signals.umamiApiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ value: string; total: number }>;
    return new Map(rows.map((r) => [String(r.value), Number(r.total)]));
  }
  catch
  {
    return null;
  }
}

function hostnameOf(url: string): string
{
  try
  {
    return new URL(url).hostname;
  }
  catch
  {
    return 'archiyou';
  }
}
