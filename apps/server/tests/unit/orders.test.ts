/**
 * tests/unit/orders.test.ts — product orders from a configurator: POST /orders
 * (routes/client.ts, ProjectStore.receiveOrder; plans/PROJECTS.md, phase 2).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

let app: FastifyInstance;
let projectStore: typeof import('../../src/services/ProjectStore').projectStore;
let emailService: typeof import('../../src/services/EmailService').emailService;

/** A configurator's published version, with one product and one download. */
let shop: { id: string };
/** The same, by an author who never confirmed their email address. */
let ghostShop: { id: string };

const PRODUCT = 'Order this table';

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

const PUBLISHED = {
  public: true,
  fulfillments: [
    { name: PRODUCT, category: 'product', exports: ['default/docs/*/pdf'], price: 450 },
    { name: 'Model', exports: ['default/model/glb'], delivery: 'anonymous download' },
  ],
};

async function publish(author: string, name: string): Promise<{ id: string }>
{
  const { scriptStore } = await import('../../src/services/ScriptStore');
  const file = await scriptStore.create(author, script(name));
  return await scriptStore.publish(author, file.fileId as string, script(name, { version: '1.0.0', published: PUBLISHED })) as { id: string };
}

const order = (over: Record<string, unknown> = {}) => app.inject({
  method: 'POST',
  url: '/orders',
  payload: {
    versionId: shop.id,
    fulfillment: PRODUCT,
    values: { WIDTH: 1600 },
    contact: { email: 'Jan@Example.com', name: 'Jan', phone: '0612345678' },
    message: 'Can it be oak?',
    ...over,
  },
});

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_ORDER_RATE_LIMIT = '1000';
  process.env.SERVER_ORDERS_PER_CONFIGURATOR_PER_DAY = '5';
  process.env.SERVER_THUMBNAIL_PATH = `${(await import('node:os')).tmpdir()}/archiyou-orders-test-${process.pid}`;
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();

  const { userService } = await import('../../src/services/UserService');
  ({ projectStore } = await import('../../src/services/ProjectStore'));
  ({ emailService } = await import('../../src/services/EmailService'));

  await userService.register('maker@example.com', 'password123', 'maker');
  await userService.markEmailVerified((await userService.findByUsername('maker'))!.id);
  await userService.register('ghost@example.com', 'password123', 'ghost');

  shop = await publish('maker', 'table');
  ghostShop = await publish('ghost', 'chair');

  app = Fastify();
  await app.register(import('@fastify/rate-limit'), { global: false });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(app);
  const { registerClientRoutes } = await import('../../src/routes/client');
  await app.register(registerClientRoutes);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('POST /orders', () =>
{
  it('turns an order into a request in the author\'s projects', async () =>
  {
    const mail = vi.spyOn(emailService, 'sendOrderReceived');
    const res = await order();
    expect(res.statusCode).toBe(201);
    // The visitor learns nothing beyond "received"
    expect(res.json()).toEqual({ success: true, data: { received: true } });

    const { items } = await projectStore.listProjects('maker', { status: 'request' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'request', clientName: 'Jan', unread: true, title: `${PRODUCT} – Jan` });

    const project = await projectStore.getProject('maker', items[0].id);
    expect(project.client).toMatchObject({ email: 'jan@example.com', phone: '0612345678' });
    expect(project.configurations).toHaveLength(1);
    expect(project.configurations[0]).toMatchObject({
      rev: 1, origin: 'order', fulfillment: PRODUCT, values: { WIDTH: 1600 }, message: 'Can it be oak?',
      configurator: { author: 'maker', name: 'table', version: '1.0.0' },
    });
    expect(project.events.map((e) => e.type)).toEqual(['order.received']);

    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toBe('maker@example.com');
    expect(mail.mock.calls[0][1]).toMatchObject({ product: PRODUCT, clientEmail: 'Jan@Example.com' });
    mail.mockRestore();
  });

  it('returns the first request for the same order again', async () =>
  {
    const mail = vi.spyOn(emailService, 'sendOrderReceived');
    await order({ values: { WIDTH: 1700 } });
    await order({ values: { WIDTH: 1700 }, contact: { email: 'jan@example.com' } });
    const requests = (await projectStore.listProjects('maker', { status: 'request' })).items;
    expect(requests.filter((p) => p.title.endsWith('Jan'))).toHaveLength(2);    // 1600 and 1700
    expect(mail).toHaveBeenCalledTimes(1);
    mail.mockRestore();
  });

  it('finds the client again on a later order', async () =>
  {
    await order({ values: { WIDTH: 1800 }, contact: { email: 'jan@example.com', company: 'De Vries BV' } });
    const clients = await projectStore.listClients('maker', 'jan@');
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ name: 'Jan', company: 'De Vries BV' });
  });

  it('keeps nothing from a filled-in honeypot', async () =>
  {
    const before = (await projectStore.listProjects('maker')).total;
    const res = await order({ values: { WIDTH: 1900 }, website: 'http://spam.example' });
    expect(res.statusCode).toBe(201);
    expect((await projectStore.listProjects('maker')).total).toBe(before);
  });

  it('only takes orders for a product of a verified author', async () =>
  {
    expect((await order({ fulfillment: 'Model' })).statusCode).toBe(404);
    expect((await order({ fulfillment: 'Nothing like it' })).statusCode).toBe(404);
    expect((await order({ versionId: 'no-such-version' })).statusCode).toBe(404);
    expect((await order({ versionId: ghostShop.id })).statusCode).toBe(404);
  });

  it('refuses bad values and a bad address', async () =>
  {
    expect((await order({ values: { DEPTH: 3 } })).statusCode).toBe(422);
    expect((await order({ contact: { email: 'not-an-address' } })).statusCode).toBe(422);
  });

  it('caps the orders one configurator takes in a day', async () =>
  {
    // 3 orders so far (1600, 1700, 1800); the cap is 5
    expect((await order({ values: { WIDTH: 2000 } })).statusCode).toBe(201);
    expect((await order({ values: { WIDTH: 2100 } })).statusCode).toBe(201);
    expect((await order({ values: { WIDTH: 2200 } })).statusCode).toBe(429);
  });
});
