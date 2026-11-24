/**
 * tests/unit/signals.route.test.ts — POST /signals (public, what browsers report) and
 * GET /admin/signals (the operator's table).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-signals';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;
let bus: typeof import('../../src/signals/bus');
let store: typeof import('../../src/signals/SignalStore');

async function buildApp(): Promise<FastifyInstance>
{
  const instance = Fastify({ trustProxy: true });
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  await instance.register(import('@fastify/rate-limit'), { global: false });
  instance.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) =>
  {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); return; }
    if (!(await userService.isAdmin(request.user.sub)))
    {
      reply.code(403).send({ success: false, error: 'Admin only', code: 'not_admin' });
    }
  });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerSignalRoutes } = await import('../../src/routes/signals');
  const { registerAdminRoutes } = await import('../../src/routes/admin');
  await instance.register(registerSignalRoutes);
  await instance.register(registerAdminRoutes);
  await instance.ready();
  return instance;
}

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/signals', payload: payload as Record<string, unknown>, headers });

const list = async (query = '') =>
{
  await bus.flushSignals();
  const res = await app.inject({ method: 'GET', url: `/admin/signals${query}`, headers: auth('root') });
  return res.json().data;
};

const failed = (over: Record<string, unknown> = {}) => ({
  type: 'run.failed', source: 'configurator', script: 'alice/shed:1.0.0', message: 'Width is too wide', line: 3, query: 'WIDTH=900', ...over,
});

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_SIGNALS_RATE_LIMIT = '1000';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  ({ userService } = await import('../../src/services/UserService'));
  await userService.register('root@example.com', 'password123', 'root');
  await userService.register('alice@example.com', 'password123', 'alice');
  await userService.setAdmin('root', true);
  bus = await import('../../src/signals/bus');
  store = await import('../../src/signals/SignalStore');
  app = await buildApp();
});

afterAll(async () => { await app.close(); });

beforeEach(async () =>
{
  bus.resetSignals();
  const { db } = await import('../../src/db/client');
  const { signals } = await import('../../src/db/schema');
  await db.delete(signals);
});

describe('POST /signals', () =>
{
  it('takes an anonymous batch and answers 204', async () =>
  {
    const res = await post({ signals: [failed(), failed({ type: 'app.crashed', source: 'editor', message: 'x is undefined' })] });
    expect(res.statusCode).toBe(204);
    const { items } = await list('?range=today');
    expect(items.map((i: { type: string }) => i.type).sort()).toEqual(['app.crashed', 'run.failed']);
    const run = items.find((i: { type: string }) => i.type === 'run.failed');
    expect(run).toMatchObject({ script: 'alice/shed:1.0.0', users: [], sample: { line: 3, query: 'WIDTH=900' } });
  });

  it('takes the user from a valid token only', async () =>
  {
    await post({ signals: [failed({ user: 'mallory' })] });
    await post({ signals: [failed()] }, { authorization: 'Bearer not-a-token' });
    await post({ signals: [failed()] }, auth('alice'));
    const { items } = await list('?range=today');
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(3);
    expect(items[0].users).toEqual(['alice']);
  });

  it('refuses server types, unknown types, empty and too large batches', async () =>
  {
    expect((await post({ signals: [failed({ type: 'api.error' })] })).statusCode).toBe(422);
    expect((await post({ signals: [failed({ type: 'whatever' })] })).statusCode).toBe(422);
    expect((await post({ signals: [failed({ source: 'api' })] })).statusCode).toBe(422);
    expect((await post({ signals: [] })).statusCode).toBe(422);
    expect((await post({ signals: Array.from({ length: 11 }, () => failed()) })).statusCode).toBe(422);
    expect((await list('?range=today')).items).toHaveLength(0);
  });

  it('takes a text/plain body, as navigator.sendBeacon sends it', async () =>
  {
    const res = await app.inject({
      method: 'POST', url: '/signals', payload: JSON.stringify({ signals: [failed()] }), headers: { 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(204);
    expect((await list('?range=today')).items).toHaveLength(1);
  });

  it('stores no address of the visitor', async () =>
  {
    await post({ signals: [failed()] }, { 'x-forwarded-for': '203.0.113.7' });
    await bus.flushSignals();
    const { db } = await import('../../src/db/client');
    const { signals } = await import('../../src/db/schema');
    expect(JSON.stringify(await db.select().from(signals))).not.toContain('203.0.113.7');
  });

  it('rate limits per address', async () =>
  {
    const limited = Fastify();
    await limited.register(import('@fastify/jwt'), { secret: SECRET });
    await limited.register(import('@fastify/rate-limit'), { global: false });
    const { config } = await import('../../src/config');
    const saved = { ...config.signals.rateLimit };
    config.signals.rateLimit.max = 2;
    const { registerSignalRoutes } = await import('../../src/routes/signals');
    await limited.register(registerSignalRoutes);
    await limited.ready();
    config.signals.rateLimit.max = saved.max;
    const codes = await Array.from({ length: 3 }).reduce<Promise<number[]>>(async (all) =>
      [...await all, (await limited.inject({ method: 'POST', url: '/signals', payload: { signals: [failed()] } })).statusCode], Promise.resolve([]));
    expect(codes).toEqual([204, 204, 429]);
    await limited.close();
  });
});

describe('GET /admin/signals', () =>
{
  it('is for operators only', async () =>
  {
    expect((await app.inject({ method: 'GET', url: '/admin/signals' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/signals', headers: auth('alice') })).statusCode).toBe(403);
  });

  it('400s a filter value it does not know', async () =>
  {
    const res = await app.inject({ method: 'GET', url: '/admin/signals?range=year', headers: auth('root') });
    expect(res.statusCode).toBe(400);
  });

  it('groups a problem over its days and knows what is new', async () =>
  {
    const today = store.utcDay();
    const occurrence = (fingerprint: string, day: string, count: number, over: Record<string, unknown> = {}) => store.signalStore.add({
      fingerprint, day, type: 'run.failed', source: 'configurator', severity: 'error', script: 'alice/shed:1.0.0',
      message: 'Width is too wide', sample: { line: 3 }, count, users: [], firstSeen: new Date(`${day}T10:00:00Z`),
      lastSeen: new Date(`${day}T11:00:00Z`), ...over,
    });
    await occurrence('old', store.addDays(today, -10), 4);
    await occurrence('old', store.addDays(today, -2), 5, { users: ['bob'] });
    await occurrence('old', today, 1, { users: ['alice'], message: 'Width is far too wide' });
    await occurrence('fresh', store.addDays(today, -1), 2, { type: 'api.error', source: 'api', severity: 'error', script: null, message: 'boom' });

    const week = await list('?range=7d');
    expect(week.total).toBe(2);
    const old = week.items.find((i: { fingerprint: string }) => i.fingerprint === 'old');
    expect(old).toMatchObject({ count: 6, isNew: false, users: ['alice', 'bob'], message: 'Width is far too wide' });
    expect(week.items.find((i: { fingerprint: string }) => i.fingerprint === 'fresh').isNew).toBe(true);
    expect(week.counts.error).toBe(8);
    expect(week.types).toEqual(['api.error', 'run.failed']);

    expect((await list('?range=30d')).items.find((i: { fingerprint: string }) => i.fingerprint === 'old')).toMatchObject({ count: 10, isNew: true });
    expect((await list('?range=7d&type=api.error')).items.map((i: { fingerprint: string }) => i.fingerprint)).toEqual(['fresh']);
    expect((await list('?range=7d&source=configurator')).total).toBe(1);
    expect((await list('?range=7d&q=BOB')).items.map((i: { fingerprint: string }) => i.fingerprint)).toEqual(['old']);
    expect((await list('?range=7d&q=shed')).total).toBe(1);
    expect((await list('?range=7d&sort=count')).items[0].fingerprint).toBe('old');
    expect((await list('?range=7d&severity=critical')).total).toBe(0);
  });
});
