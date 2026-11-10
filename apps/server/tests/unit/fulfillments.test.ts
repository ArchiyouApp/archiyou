/**
 * tests/unit/fulfillments.test.ts — who can get a configurator's fulfillment: POST
 * /fulfillments (routes/fulfillments.ts), the same rule on POST /orders, the access secrets
 * kept from visitors (ScriptStore.publicScript), and the author's events of a configurator
 * (GET /scripts/configurators/:versionId/events, services/EventStore).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import type { ConfiguratorEventList } from '@archiyou/types';

let app: FastifyInstance;
let emailService: typeof import('../../src/services/EmailService').emailService;
let projectStore: typeof import('../../src/services/ProjectStore').projectStore;
let config: typeof import('../../src/config').config;
let settle: () => Promise<void>;

/** The run the server would make for an emailed fulfillment. */
const execute = vi.fn();

let shop: { id: string; fileId: string };

const CODE = 'Tafel-24';

const PUBLISHED = {
  public: true,
  fulfillments: [
    { name: 'Model', exports: ['default/model/glb'] },
    { name: 'Drawings', exports: ['default/model/stl', 'default/model/dxf'], access: 'email' },
    { name: 'Client pack', exports: ['default/model/stl'], access: 'clients' },
    { name: 'Members', exports: ['default/model/stl'], access: 'signed-in' },
    { name: 'Team', exports: ['default/model/stl'], access: 'users', users: ['Vera'] },
    { name: 'Secret', exports: ['default/model/stl'], access: 'code', code: CODE },
    { name: 'Order this table', category: 'product', exports: [], access: 'signed-in' },
  ],
};

function script(name: string, over: Record<string, unknown> = {}): Record<string, unknown>
{
  return {
    name,
    code: 'box($WIDTH, 500, 750);',
    params: {
      WIDTH: { type: 'number', name: 'WIDTH', default: 1000, schema: { type: 'number', minimum: 100, maximum: 3000 } },
    },
    ...over,
  };
}

const token = (sub: string) => app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub });

const ask = (payload: Record<string, unknown>, sub?: string) => app.inject({
  method: 'POST',
  url: '/fulfillments',
  headers: sub ? { authorization: `Bearer ${token(sub)}` } : {},
  payload: { versionId: shop.id, values: { WIDTH: 1600 }, ...payload },
});

const eventsOf = async (query = '', sub = 'maker') => app.inject({
  method: 'GET',
  url: `/scripts/configurators/${shop.id}/events${query}`,
  headers: { authorization: `Bearer ${token(sub)}` },
});

/** A run that made one STL and one DXF. */
function madeFiles(stlBytes = 10)
{
  execute.mockResolvedValue({
    success: true,
    data: {
      status: 'success',
      outputs: [
        { path: { format: 'stl', requestedPath: 'default/model/stl', category: 'model' }, output: new Uint8Array(stlBytes).buffer },
        { path: { format: 'dxf', requestedPath: 'default/model/dxf', category: 'model' }, output: '0\nSECTION' },
      ],
    },
  });
}

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_FULFILLMENT_RATE_LIMIT = '1000';
  process.env.SERVER_ORDER_RATE_LIMIT = '1000';
  process.env.SERVER_THUMBNAIL_PATH = `${(await import('node:os')).tmpdir()}/archiyou-fulfillments-test-${process.pid}`;
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();

  ({ config } = await import('../../src/config'));
  const { userService } = await import('../../src/services/UserService');
  ({ emailService } = await import('../../src/services/EmailService'));
  ({ projectStore } = await import('../../src/services/ProjectStore'));
  const { scriptStore } = await import('../../src/services/ScriptStore');

  await userService.register('maker@example.com', 'password123', 'maker');
  await userService.markEmailVerified((await userService.findByUsername('maker'))!.id);
  await userService.register('vera@example.com', 'password123', 'vera');
  await userService.register('otto@example.com', 'password123', 'otto');

  const file = await scriptStore.create('maker', script('table'));
  shop = await scriptStore.publish('maker', file.fileId as string, script('table', { version: '1.0.0', published: PUBLISHED })) as { id: string; fileId: string };
  await projectStore.createClient('maker', { email: 'Klant@Example.com', name: 'Klant' });

  app = Fastify();
  await app.register(import('@fastify/jwt'), { secret: 'test-secret' });
  await app.register(import('@fastify/rate-limit'), { global: false });
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) =>
  {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  app.decorate('requireVerified', async () => {});
  app.decorate('executionManager', {
    execute,
    zipRawDataToBuffer: async (files: Array<{ name: string }>) => Buffer.from(`zip of ${files.map((f) => f.name).join(',')}`),
  } as never);
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(app);
  const routes = await import('../../src/routes/fulfillments');
  settle = routes.settleFulfillmentJobs;
  await app.register(routes.registerFulfillmentRoutes);
  await app.register((await import('../../src/routes/client')).registerClientRoutes);
  await app.register((await import('../../src/routes/scripts')).registerScriptRoutes);
  await app.register((await import('../../src/routes/library')).registerLibraryRoutes);
  await app.ready();

  // The email path needs a version that may run on the server
  config.execution.allowedAuthors = ['maker'];
});

afterAll(async () => { await app.close(); });

afterEach(() =>
{
  vi.restoreAllMocks();
  execute.mockReset();
});

describe('access secrets', () =>
{
  it('stores the code only as a hash, and keeps it and the user list from visitors', async () =>
  {
    const visitor = (await app.inject({ method: 'GET', url: '/scripts/published/maker/table:1.0.0' })).json().data;
    const fulfillments = visitor.published.fulfillments;
    expect(fulfillments.find((f: { name: string }) => f.name === 'Secret')).toEqual({ name: 'Secret', exports: ['default/model/stl'], access: 'code' });
    expect(fulfillments.find((f: { name: string }) => f.name === 'Team').users).toBeUndefined();

    const author = (await app.inject({
      method: 'GET', url: '/scripts/published/maker/table:1.0.0', headers: { authorization: `Bearer ${token('maker')}` },
    })).json().data;
    const secret = author.published.fulfillments.find((f: { name: string }) => f.name === 'Secret');
    expect(secret.code).toBeUndefined();
    expect(secret.codeHash).toMatch(/^scrypt\$/);
    expect(author.published.fulfillments.find((f: { name: string }) => f.name === 'Team').users).toEqual(['vera']);
  });

  it('keeps the code\'s hash through an in-place edit that does not change it', async () =>
  {
    const { scriptStore } = await import('../../src/services/ScriptStore');
    const edited = await scriptStore.updatePublishedVersion('maker', shop.id, {
      ...PUBLISHED,
      fulfillments: PUBLISHED.fulfillments.map(({ code: _code, ...f }) => f),
    } as never);
    expect(edited.published?.fulfillments?.find((f) => f.name === 'Secret')?.codeHash).toMatch(/^scrypt\$/);
    expect((await ask({ fulfillment: 'Secret', code: 'tafel-24 ' })).statusCode).toBe(200);
  });
});

describe('POST /fulfillments — unlocking a download', () =>
{
  it('lets signed-in users have a members download, not anonymous visitors', async () =>
  {
    expect((await ask({ fulfillment: 'Members' })).statusCode).toBe(401);
    const res = await ask({ fulfillment: 'Members' }, 'otto');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { granted: true } });
  });

  it('lets only the listed users (and the author) have a team download', async () =>
  {
    expect((await ask({ fulfillment: 'Team' }, 'otto')).statusCode).toBe(403);
    expect((await ask({ fulfillment: 'Team' }, 'vera')).statusCode).toBe(200);
    expect((await ask({ fulfillment: 'Team' }, 'maker')).statusCode).toBe(200);
  });

  it('opens a code download with the right code only', async () =>
  {
    expect((await ask({ fulfillment: 'Secret' })).statusCode).toBe(403);
    expect((await ask({ fulfillment: 'Secret', code: 'wrong' })).json()).toEqual({ success: false, error: 'That is not the right code' });
    expect((await ask({ fulfillment: 'Secret', code: CODE })).statusCode).toBe(200);
  });

  it('is the same 404 for a free download, an unknown fulfillment or version', async () =>
  {
    const free = await ask({ fulfillment: 'Model' });
    const unknown = await ask({ fulfillment: 'Nope' });
    const product = await ask({ fulfillment: 'Order this table' }, 'otto');
    const version = await ask({ fulfillment: 'Members', versionId: 'no-such-version' }, 'otto');
    [free, unknown, product, version].forEach((res) => expect(res.statusCode).toBe(404));
    expect(new Set([free, unknown, product, version].map((r) => r.body)).size).toBe(1);
  });
});

describe('POST /fulfillments — by email', () =>
{
  it('makes the files on the server, zips them and emails them', async () =>
  {
    madeFiles();
    const mail = vi.spyOn(emailService, 'sendFulfillment');
    const res = await ask({ fulfillment: 'Drawings', email: 'Jan@Example.com' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ success: true, data: { queued: true } });
    await settle();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ outputs: ['default/model/stl', 'default/model/dxf'], params: { WIDTH: 1600 } });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toBe('jan@example.com');
    const sent = mail.mock.calls[0][1];
    expect(sent.files.map((f) => f.name)).toEqual(['table_1.0.0_Drawings.zip']);
    expect(sent.link).toContain('/configurators/maker/table:1.0.0?');
  });

  it('does not send the same configuration to the same address twice within the hour', async () =>
  {
    madeFiles();
    const mail = vi.spyOn(emailService, 'sendFulfillment');
    expect((await ask({ fulfillment: 'Drawings', email: 'jan@example.com' })).statusCode).toBe(202);
    await settle();
    expect(mail).not.toHaveBeenCalled();
  });

  it('asks for an address', async () =>
  {
    const res = await ask({ fulfillment: 'Drawings', email: 'not an address' });
    expect(res.statusCode).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses values the script does not take before running anything', async () =>
  {
    const res = await ask({ fulfillment: 'Drawings', email: 'piet@example.com', values: { HEIGHT: 3 } });
    expect(res.statusCode).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });

  it('tells the visitor when the files are too large to email', async () =>
  {
    madeFiles(64);
    const saved = config.fulfillments.maxEmailBytes;
    config.fulfillments.maxEmailBytes = 10;
    const failed = vi.spyOn(emailService, 'sendFulfillmentFailed');
    await ask({ fulfillment: 'Drawings', email: 'big@example.com' });
    await settle();
    config.fulfillments.maxEmailBytes = saved;
    expect(failed).toHaveBeenCalledWith('big@example.com', expect.objectContaining({ reason: 'too large' }));
  });

  it('does not run a version the server may not run', async () =>
  {
    config.execution.allowedAuthors = [];
    const failed = vi.spyOn(emailService, 'sendFulfillmentFailed');
    expect((await ask({ fulfillment: 'Drawings', email: 'early@example.com' })).statusCode).toBe(202);
    await settle();
    config.execution.allowedAuthors = ['maker'];
    expect(execute).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith('early@example.com', expect.objectContaining({ reason: 'no server run' }));
  });

  it('sends a client pack to the author\'s clients only, without telling others apart', async () =>
  {
    madeFiles();
    const mail = vi.spyOn(emailService, 'sendFulfillment');
    const failed = vi.spyOn(emailService, 'sendFulfillmentFailed');
    const client = await ask({ fulfillment: 'Client pack', email: 'klant@example.com' });
    const stranger = await ask({ fulfillment: 'Client pack', email: 'stranger@example.com' });
    await settle();
    expect(client.statusCode).toBe(202);
    expect(stranger.body).toBe(client.body);
    expect(mail.mock.calls.map((c) => c[0])).toEqual(['klant@example.com']);
    expect(failed).toHaveBeenCalledWith('stranger@example.com', expect.objectContaining({ reason: 'not a client' }));
  });
});

describe('POST /orders — gated products', () =>
{
  it('takes a signed-in-only order from a signed-in visitor, with their account\'s address', async () =>
  {
    const anonymous = await app.inject({
      method: 'POST', url: '/orders',
      payload: { versionId: shop.id, fulfillment: 'Order this table', contact: { email: 'anon@example.com' } },
    });
    expect(anonymous.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST', url: '/orders', headers: { authorization: `Bearer ${token('otto')}` },
      payload: { versionId: shop.id, fulfillment: 'Order this table', values: { WIDTH: 1200 } },
    });
    expect(res.statusCode).toBe(201);
    const { items } = await projectStore.listProjects('maker', { status: 'request' });
    const project = await projectStore.getProject('maker', items[0].id);
    expect(project.client).toMatchObject({ email: 'otto@example.com' });
  });
});

describe('POST /fulfillments/downloaded', () =>
{
  it('counts a free download once per visitor and day, never the author\'s', async () =>
  {
    const ping = (sub?: string) => app.inject({
      method: 'POST', url: '/fulfillments/downloaded',
      headers: sub ? { authorization: `Bearer ${token(sub)}` } : {},
      payload: { versionId: shop.id, fulfillment: 'Model' },
    });
    expect((await ping()).statusCode).toBe(204);
    await ping();
    await ping('maker');
    const list = (await eventsOf('?filter=fulfillments')).json().data as ConfiguratorEventList;
    expect(list.events.filter((e) => e.type === 'fulfillment.downloaded')).toHaveLength(1);
  });
});

describe('GET /scripts/configurators/:versionId/events', () =>
{
  it('lists what happened, newest first, with the 30-day counts', async () =>
  {
    const res = await eventsOf();
    expect(res.statusCode).toBe(200);
    const list = res.json().data as ConfiguratorEventList;
    expect(list.counts).toMatchObject({ orders: 1, emailed: 2, downloads: 1 });
    expect(list.counts.failed).toBeGreaterThanOrEqual(3);
    expect(list.events[0].type).toBe('fulfillment.downloaded');

    const order = list.events.find((e) => e.type === 'order.received')!;
    expect(order).toMatchObject({ fulfillment: 'Order this table', version: '1.0.0', who: 'otto (otto@example.com)' });
    expect(order.project?.label).toMatch(/^P-\d+/);

    const emailed = list.events.find((e) => e.type === 'fulfillment.emailed')!;
    expect(emailed).toMatchObject({ fulfillment: 'Client pack', access: 'clients', who: 'klant@example.com' });
    const unlocked = list.events.find((e) => e.type === 'fulfillment.unlocked' && e.fulfillment === 'Team')!;
    expect(unlocked.who).toMatch(/^@/);
  });

  it('filters and pages', async () =>
  {
    const failed = (await eventsOf('?filter=failed')).json().data as ConfiguratorEventList;
    expect(failed.events.every((e) => e.type === 'fulfillment.failed')).toBe(true);
    expect(failed.events.map((e) => e.reason)).toEqual(expect.arrayContaining(['too large', 'no server run', 'not a client']));

    const first = (await eventsOf('?limit=2')).json().data as ConfiguratorEventList;
    expect(first.events).toHaveLength(2);
    const second = (await eventsOf(`?limit=2&before=${encodeURIComponent(first.next!)}`)).json().data as ConfiguratorEventList;
    expect(second.events.map((e) => e.id)).not.toContain(first.events[0].id);
  });

  it('is a 404 for anyone but the author', async () =>
  {
    expect((await eventsOf('', 'otto')).statusCode).toBe(404);
  });
});
