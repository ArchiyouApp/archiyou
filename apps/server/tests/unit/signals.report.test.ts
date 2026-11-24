/**
 * tests/unit/signals.report.test.ts — the daily report (once per day, new vs recurring, quiet
 * days) and the Umami sink (payload, forwarded headers, never the user, dropping when full).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

let store: typeof import('../../src/signals/SignalStore');
let report: typeof import('../../src/signals/report');
let umami: typeof import('../../src/signals/umami');
let bus: typeof import('../../src/signals/bus');
let sendReport: ReturnType<typeof vi.spyOn>;

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_UMAMI_URL = 'https://umami.example.com/';
  process.env.SERVER_UMAMI_WEBSITE_ID = 'site-1';
  process.env.SERVER_UMAMI_API_KEY = 'key-1';
  process.env.FRONTEND_URL = 'https://next.archiyou.com';
  process.env.SERVER_SIGNALS_REPORT_HOUR = '6';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  store = await import('../../src/signals/SignalStore');
  report = await import('../../src/signals/report');
  umami = await import('../../src/signals/umami');
  bus = await import('../../src/signals/bus');
  const { emailService } = await import('../../src/services/EmailService');
  sendReport = vi.spyOn(emailService, 'sendTeamReport').mockResolvedValue();
});

beforeEach(async () =>
{
  sendReport.mockClear();
  const { db } = await import('../../src/db/client');
  const { signals } = await import('../../src/db/schema');
  await db.delete(signals);
});

afterEach(() => { vi.unstubAllGlobals(); });

const add = (fingerprint: string, day: string, count: number, over: Record<string, unknown> = {}) => store.signalStore.add({
  fingerprint, day, type: 'run.failed', source: 'configurator', severity: 'error', script: 'alice/shed:1.0.0',
  message: 'Width is too wide', sample: {}, count, users: [], firstSeen: new Date(`${day}T10:00:00Z`),
  lastSeen: new Date(`${day}T10:00:00Z`), ...over,
});

/** fetch stubbed for Umami's event-data: views and errors per script. */
const stubUmamiReads = () => vi.stubGlobal('fetch', vi.fn(async (url: URL) =>
{
  const event = new URL(String(url)).searchParams.get('event');
  const rows = event === 'configurator-view'
    ? [{ value: 'alice/shed:1.0.0', total: 40 }, { value: 'bob/door:2.0.0', total: 10 }]
    : [{ value: 'alice/shed:1.0.0', total: 2 }, { value: 'bob/door:2.0.0', total: 5 }];
  return new Response(JSON.stringify(rows), { status: 200 });
}));

describe('daily report', () =>
{
  const now = new Date('2026-11-24T07:30:00Z');
  const yesterday = '2026-11-23';

  it('waits for the report hour', async () =>
  {
    expect(await report.sendDailyReport(new Date('2026-11-24T05:59:00Z'))).toBe('not-yet');
    expect(sendReport).not.toHaveBeenCalled();
  });

  it('goes out once a day, whoever asks', async () =>
  {
    stubUmamiReads();
    await add('a', yesterday, 3);
    const outcomes = await Promise.all([report.sendDailyReport(now), report.sendDailyReport(now), report.sendDailyReport(now)]);
    expect(outcomes.sort()).toEqual(['already-sent', 'already-sent', 'sent']);
    expect(sendReport).toHaveBeenCalledTimes(1);
  });

  it('separates new problems from the ones coming back, with failure rates', async () =>
  {
    stubUmamiReads();
    await add('old', '2026-11-20', 1);
    await add('old', yesterday, 7, { users: ['alice'] });
    await add('new', yesterday, 2, { type: 'api.error', source: 'api', script: null, message: 'boom' });
    await add('today', '2026-11-24', 9);

    const r = await report.buildReport(yesterday);
    expect(r.total).toBe(9);
    expect(r.fresh.map((x) => x.fingerprint)).toEqual(['new']);
    expect(r.recurring.map((x) => x.fingerprint)).toEqual(['old']);
    expect(r.bySource).toEqual({ configurator: 7, api: 2 });
    expect(r.rates?.[0]).toEqual({ script: 'bob/door:2.0.0', views: 10, errors: 5 });

    const { subject, text, html } = report.renderReport(r);
    expect(subject).toBe('Archiyou signals 2026-11-23: 1 new problem, 9 occurrences');
    expect(text).toContain('7× [error] run.failed in alice/shed:1.0.0: Width is too wide (users: alice)');
    expect(text).toContain('bob/door:2.0.0: 5 failed runs, 10 views (50%)');
    expect(html).toContain('https://next.archiyou.com/admin/signals?range=7d');
  });

  it('says so on a quiet day, so it still proves monitoring works', async () =>
  {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const { subject, text } = report.renderReport(await report.buildReport(yesterday));
    expect(subject).toBe('Archiyou signals 2026-11-23: all quiet');
    expect(text).toContain('Nothing went wrong.');
  });

  it('tries again next time when Mailgun refuses the report', async () =>
  {
    sendReport.mockResolvedValueOnce('failed');
    expect(await report.sendDailyReport(now)).toBe('failed');
    expect(await report.sendDailyReport(now)).toBe('sent');
    expect(await report.sendDailyReport(now)).toBe('already-sent');
  });

  it('gives the day back when the report could not be made', async () =>
  {
    sendReport.mockRejectedValueOnce(new Error('render failed'));
    await expect(report.sendDailyReport(now)).rejects.toThrow('render failed');
    expect(await report.sendDailyReport(now)).toBe('sent');
  });
});

describe('Umami', () =>
{
  it('sends what is on screen, the visitor\'s agent and address, and never the user', async () =>
  {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    bus.signal({
      type: 'run.failed', source: 'configurator', script: 'alice/shed:1.0.0', message: 'Width is too wide', line: 3,
      query: 'WIDTH=900', url: '/configurators/alice/shed:1.0.0', user: 'alice', data: { execution: 'client' },
    }, { userAgent: 'Mozilla/5.0 Test', ip: '203.0.113.7' });
    await umami.umamiIdle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://umami.example.com/api/send');
    expect(init.headers).toMatchObject({ 'user-agent': 'Mozilla/5.0 Test', 'x-forwarded-for': '203.0.113.7' });
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      type: 'event',
      payload: {
        website: 'site-1', hostname: 'next.archiyou.com', url: '/configurators/alice/shed:1.0.0', name: 'configurator-error',
        tag: 'alice/shed',
        data: { source: 'configurator', script: 'alice/shed:1.0.0', message: 'Width is too wide', line: 3, query: 'WIDTH=900', execution: 'client' },
      },
    });
    expect(String(init.body)).not.toContain('alice"');
  });

  it('sends server signals with its own agent, and never waits', async () =>
  {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined)); // Umami hangs
    vi.stubGlobal('fetch', fetch);
    const started = Date.now();
    bus.signal({ type: 'execution.failed', source: 'api', message: 'timed out' });
    expect(Date.now() - started).toBeLessThan(50);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^Mozilla\/5\.0 \(compatible; Archiyou\//);
  });

  it('drops and counts events beyond its queue when Umami does not answer', async () =>
  {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const before = umami.umamiStats.dropped;
    Array.from({ length: 600 }).forEach(() => bus.signal({ type: 'configurator.view', source: 'configurator', script: 'a/b:1' }));
    expect(umami.umamiStats.dropped - before).toBeGreaterThan(90);
  });
});
