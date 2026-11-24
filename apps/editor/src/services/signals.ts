/**
 * signals.ts — tell the server what went wrong in this browser (POST /signals): a published
 * configurator's failed run, an output that could not be made, a crash of the app. The server
 * routes them on (apps/server/src/signals): to Umami, to the admin's Signals section, and some
 * straight to the team.
 *
 *     sendSignal({ type: 'run.failed', source: 'configurator', script: 'alice/shed:1.0.0', message, line, query });
 *
 * Returns at once and never throws: reporting must never get in the way of what failed. Lean on
 * purpose: one page sends at most SIGNAL_LIMITS.perPage signals in its life, the same problem
 * once, gathered for BATCH_MS into one request, and whatever is left when the page goes away.
 * Signed in, the token goes along so the team can see who it happened to (a `fetch` with
 * keepalive); anonymous, `navigator.sendBeacon`.
 *
 * Never send the errors of a script while its author edits it: those are work, not problems.
 */

import { errorOnly, SIGNAL_LIMITS, type ClientSignal } from '@archiyou/types';

import { APP_VERSION } from '../settings';

import { authService } from './auth-service.js';

export { errorOnly };

const BASE_URL = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';
const BATCH_MS = 2000;

let queue: ClientSignal[] = [];
let sent = 0;
const seen = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

/** Report something. Returns at once; never throws. */
export function sendSignal(s: ClientSignal): void
{
  try
  {
    if (typeof window === 'undefined' || sent >= SIGNAL_LIMITS.perPage) return;
    const key = JSON.stringify([s.type, s.script, s.message, s.line]);
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    queue.push({
      ...s,
      message: errorOnly(s.message),
      url: s.url ?? `${window.location.pathname}${window.location.search}`.slice(0, SIGNAL_LIMITS.url),
      appVersion: APP_VERSION,
    });
    timer ??= setTimeout(() => { void flush(); }, BATCH_MS);
    if (!listening)
    {
      listening = true;
      window.addEventListener('pagehide', () => { void flush(); });
    }
  }
  catch
  {
    // Reporting is never worth an error of its own.
  }
}

async function flush(): Promise<void>
{
  clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try
  {
    const url = `${BASE_URL}/signals`;
    const body = JSON.stringify({ signals: batch });
    const token = await authService.getToken();
    if (!token && navigator.sendBeacon?.(url, body)) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(url, { method: 'POST', headers, body, keepalive: true });
  }
  catch
  {
    // Lost: the network that failed is usually why we cannot report either.
  }
}

/** The configuration of a published configurator as the server's script reference:
 *  'author/name:version', or undefined when there is no such script. */
export function scriptRef(script: { author?: string | null; name?: string | null; version?: string | null } | null | undefined): string | undefined
{
  if (!script?.author || !script.name) return undefined;
  return `${script.author}/${script.name}${script.version ? `:${script.version}` : ''}`;
}

/** Report uncaught errors and rejections of the app itself, once per page. Only those from our
 *  own code: errors from browser extensions and other sites' scripts are not ours to fix. */
export function reportUncaughtErrors(source: ClientSignal['source']): void
{
  if (typeof window === 'undefined') return;
  const ours = (file: string | undefined) => !file || file.startsWith(window.location.origin) || file.startsWith('blob:');
  const firstFrame = (stack: string | undefined) =>
    stack?.split('\n').map((l) => l.trim()).find((l) => l.startsWith('at ') || l.includes('@'))?.slice(0, 200);

  window.addEventListener('error', (event) =>
  {
    if (!event.message || !ours(event.filename)) return;
    const error = event.error as Error | undefined;
    sendSignal({
      type: 'app.crashed',
      source,
      message: event.message,
      data: { where: firstFrame(error?.stack) ?? `${event.filename ?? ''}:${event.lineno ?? ''}` },
    });
  });
  window.addEventListener('unhandledrejection', (event) =>
  {
    const reason = event.reason as Error | string | undefined;
    const message = typeof reason === 'string' ? reason : reason?.message;
    if (!message) return;
    const where = typeof reason === 'object' ? firstFrame(reason?.stack) : undefined;
    if (where && /extension:\/\//.test(where)) return;
    sendSignal({ type: 'app.crashed', source, message: `Unhandled: ${message}`, data: where ? { where } : undefined });
  });
}
