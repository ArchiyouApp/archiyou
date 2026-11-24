/**
 * tests/unit/signals.bus.test.ts — the signals bus: cleaning, fingerprints, counting per problem
 * and day, users, and the alerts it sends after storing.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import type { Signal } from '@archiyou/types';

type Bus = typeof import('../../src/signals/bus');
type Store = typeof import('../../src/signals/SignalStore');
type Alerts = typeof import('../../src/signals/alerts');

let bus: Bus;
let store: Store;
let alerts: Alerts;
let email: typeof import('../../src/services/EmailService').emailService;
let sendAlert: ReturnType<typeof vi.spyOn>;

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_SIGNALS_ALERT_MAX_PER_HOUR = '3';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  bus = await import('../../src/signals/bus');
  store = await import('../../src/signals/SignalStore');
  alerts = await import('../../src/signals/alerts');
  ({ emailService: email } = await import('../../src/services/EmailService'));
  sendAlert = vi.spyOn(email, 'sendTeamAlert').mockResolvedValue();
});

beforeEach(async () =>
{
  bus.resetSignals();
  alerts.resetAlerts();
  sendAlert.mockClear();
  const { db } = await import('../../src/db/client');
  const { signals } = await import('../../src/db/schema');
  await db.delete(signals);
});

const runFailed = (over: Partial<Signal> = {}): Signal => ({
  type: 'run.failed', source: 'configurator', script: 'alice/shed:1.0.0', message: 'Width 900 is too wide', line: 12, ...over,
});

const rows = () => store.signalStore.list({ range: 'today', limit: 200 }).then((l) => l.items);

describe('clean and fingerprint', () =>
{
  it('cuts long values and drops what is not kept', () =>
  {
    const s = bus.clean({
      ...runFailed(),
      message: 'x'.repeat(1000),
      line: -3,
      data: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v'.repeat(500)])),
      user: 'Alice',
    });
    expect(s.message).toHaveLength(300);
    expect(s.line).toBeUndefined();
    expect(Object.keys(s.data!)).toHaveLength(10);
    expect(String(s.data!.k0)).toHaveLength(200);
    expect(s.user).toBe('alice');
  });

  it('keeps the error of a Runner message, never the script lines it quotes', () =>
  {
    const s = bus.clean(runFailed({ message: "\n**** EXECUTION ERROR ****\n- error: 'Too wide' \n- line: 1, column: 5\n- context: \n> 1 | secretCode();\n**** END ERROR ****" }));
    expect(s.message).toBe('Too wide');
  });

  it('gives occurrences that differ only in numbers one fingerprint', () =>
  {
    expect(bus.fingerprint(runFailed({ message: 'Width 900 is too wide' })))
      .toBe(bus.fingerprint(runFailed({ message: 'Width 1200 is too wide' })));
    expect(bus.fingerprint(runFailed())).not.toBe(bus.fingerprint(runFailed({ line: 13 })));
    expect(bus.fingerprint(runFailed())).not.toBe(bus.fingerprint(runFailed({ script: 'alice/shed:1.0.1' })));
  });
});

describe('counting', () =>
{
  it('stores a thousand identical errors as one problem counted a thousand times', async () =>
  {
    Array.from({ length: 1000 }).forEach((_, i) => bus.signal(runFailed({ message: `Width ${i} is too wide` })));
    await bus.flushSignals();
    const items = await rows();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ count: 1000, type: 'run.failed', severity: 'error', script: 'alice/shed:1.0.0', isNew: true });
    expect(items[0].message).toBe('Width 999 is too wide');
    expect(items[0].sample.line).toBe(12);
  });

  it('adds up over flushes and keeps distinct users, at most 20', async () =>
  {
    Array.from({ length: 15 }).forEach((_, i) => bus.signal(runFailed({ user: `user${i}` })));
    bus.signal(runFailed({ user: 'user0' }));
    await bus.flushSignals();
    Array.from({ length: 15 }).forEach((_, i) => bus.signal(runFailed({ user: `other${i}` })));
    await bus.flushSignals();
    const [item] = await rows();
    expect(item.count).toBe(31);
    expect(item.users).toHaveLength(20);
    expect(new Set(item.users).size).toBe(20);
  });

  it('drops unknown types and does not store events meant only for Umami', async () =>
  {
    bus.signal({ type: 'nonsense' as Signal['type'], source: 'api' });
    bus.signal({ type: 'configurator.view', source: 'configurator', script: 'alice/shed:1.0.0' });
    await bus.flushSignals();
    expect(await rows()).toHaveLength(0);
    expect(bus.busStats.unknown).toBe(1);
  });

  it('never throws out of signal(), and counts what could not be stored', async () =>
  {
    const add = vi.spyOn(store.signalStore, 'add').mockRejectedValueOnce(new Error('database down'));
    expect(() => bus.signal(runFailed())).not.toThrow();
    expect(() => bus.signal(null as unknown as Signal)).not.toThrow();
    await bus.flushSignals();
    expect(bus.busStats.storeFailed).toBe(1);
    expect(bus.busStats.failed).toBe(1);
    add.mockRestore();
  });
});

describe('alerts', () =>
{
  it('alerts about a new api.error once, also after a restart', async () =>
  {
    const error: Signal = { type: 'api.error', source: 'api', message: 'boom', data: { route: '/x' } };
    bus.signal(error);
    await bus.flushSignals();
    bus.signal(error);
    await bus.flushSignals();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    alerts.resetAlerts(); // a restart forgets memory; the row remembers
    bus.signal(error);
    await bus.flushSignals();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('repeats a worker.down alert only after an hour', async () =>
  {
    const down: Signal = { type: 'worker.down', source: 'api', message: 'No execution worker is listening' };
    bus.signal(down);
    await bus.flushSignals();
    expect(sendAlert).toHaveBeenCalledTimes(1);

    const [o] = [{ ...(await occurrence(down)) }];
    const { RULES } = await import('../../src/signals/rules');
    expect(await alerts.considerAlert(o, RULES['worker.down'], Date.now() + 30 * 60_000)).toBe(false);
    expect(await alerts.considerAlert(o, RULES['worker.down'], Date.now() + 61 * 60_000)).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('holds back alerts beyond the hourly limit and counts them', async () =>
  {
    Array.from({ length: 5 }).forEach((_, i) => bus.signal({ type: 'api.error', source: 'api', message: `problem ${'abcde'[i]}` }));
    await bus.flushSignals();
    expect(sendAlert).toHaveBeenCalledTimes(3);
    expect(alerts.alertStats.suppressed).toBe(2);
  });

  it('takes an alert back when Mailgun refuses it, and tries again with the next occurrence', async () =>
  {
    sendAlert.mockResolvedValueOnce('failed');
    const error: Signal = { type: 'api.error', source: 'api', message: 'refused once' };
    bus.signal(error);
    await bus.flushSignals();
    expect(alerts.alertStats.failed).toBe(1);
    expect(await store.signalStore.lastAlerted(bus.fingerprint(error))).toBeNull();
    bus.signal(error);
    await bus.flushSignals();
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(alerts.alertStats.sent).toBe(1);
    expect(await store.signalStore.lastAlerted(bus.fingerprint(error))).not.toBeNull();
  });

  it('never alerts about email.failed', async () =>
  {
    bus.signal({ type: 'email.failed', source: 'api', message: 'Mailgun answered 500' });
    await bus.flushSignals();
    expect(sendAlert).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });
});

/** The occurrence the bus would build for a signal (fingerprint and today's day). */
async function occurrence(s: Signal)
{
  const { RULES } = await import('../../src/signals/rules');
  return {
    fingerprint: bus.fingerprint(s), day: store.utcDay(), type: s.type, source: s.source,
    severity: RULES[s.type].severity, script: null, message: s.message ?? null, sample: {},
    count: 1, users: [], firstSeen: new Date(), lastSeen: new Date(),
  };
}
