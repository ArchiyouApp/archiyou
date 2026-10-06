/**
 * tests/unit/deliveries.test.ts — what a professional sends a client and what the client
 * does with it: the delivery routes in routes/projects.ts and /d/:token in routes/client.ts
 * (plans/PROJECTS.md, phase 3).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-deliveries';

let app: FastifyInstance;
let projectStore: typeof import('../../src/services/ProjectStore').projectStore;
let emailService: typeof import('../../src/services/EmailService').emailService;

const GLB = Buffer.from('glTF fake model');
const PDF = Buffer.from('%PDF-1.7 fake');
const XLSX = Buffer.from('PK fake sheet');

function script(name: string, over: Record<string, unknown> = {}): Record<string, unknown>
{
  return {
    name,
    code: 'box($WIDTH, 500, 750);',
    params: { WIDTH: { type: 'number', name: 'WIDTH', default: 1000, schema: { type: 'number', minimum: 100, maximum: 3000 } } },
    ...over,
  };
}

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, sub = 'pro') =>
  app.inject({ method, url, headers: auth(sub), ...(payload !== undefined ? { payload: payload as object } : {}) });

const upload = (projectId: string, deliveryId: string, name: string, body: Buffer, sub = 'pro') =>
  app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/deliveries/${deliveryId}/files/${name}`,
    headers: { ...auth(sub), 'content-type': 'application/octet-stream' },
    payload: body,
  });

/** A visitor of the client's page: no token, their own browser. */
const visit = (url: string, userAgent = 'client-browser') =>
  app.inject({ method: 'GET', url, headers: { 'user-agent': userAgent } });

/** A project with a client and one configuration of the professional's own script. */
async function project(sub = 'pro'): Promise<{ id: string; configurationId: string; sub: string }>
{
  const res = await call('POST', '/projects', {
    title: 'Kitchen table',
    client: { email: 'jan@example.com', name: 'Jan de Vries' },
    configuration: { script: script('table'), values: { WIDTH: 1600 } },
  }, sub);
  const data = res.json().data;
  return { id: data.id, configurationId: data.configurations[0].id, sub };
}

/** A draft delivery with a model and a document. */
async function draft(p: { id: string; configurationId: string; sub?: string }, over: Record<string, unknown> = {})
{
  const sub = p.sub ?? 'pro';
  const res = await call('POST', `/projects/${p.id}/deliveries`, {
    configurationId: p.configurationId,
    title: 'Offer kitchen table',
    message: 'Here is the table we talked about.',
    offer: { total: 1200, currency: 'eur', validUntil: '2026-12-31' },
    ...over,
  }, sub);
  expect(res.statusCode).toBe(201);
  const delivery = res.json().data;
  expect((await upload(p.id, delivery.id, 'table.glb', GLB, sub)).statusCode).toBe(200);
  expect((await upload(p.id, delivery.id, 'table_offer.pdf', PDF, sub)).statusCode).toBe(200);
  return delivery as { id: string; number: number };
}

async function sent(p: { id: string; configurationId: string }): Promise<{ id: string; token: string; link: string }>
{
  const delivery = await draft(p);
  const res = await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/send`);
  expect(res.statusCode).toBe(200);
  const link = res.json().data.link as string;
  return { id: delivery.id, link, token: link.split('/d/')[1] };
}

beforeAll(async () =>
{
  const { tmpdir } = await import('node:os');
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_DELIVERY_PATH = `${tmpdir()}/archiyou-deliveries-test-${process.pid}`;
  process.env.SERVER_THUMBNAIL_PATH = `${tmpdir()}/archiyou-deliveries-thumbs-${process.pid}`;
  process.env.SERVER_DELIVERY_MAX_FILE_BYTES = '1000';
  process.env.SERVER_DELIVERY_MAX_BYTES = '1500';
  process.env.SERVER_DELIVERY_SEND_PER_HOUR = '8';
  process.env.SERVER_DELIVERY_SEND_PER_DAY = '100';
  process.env.SERVER_DELIVERY_NEW_ACCOUNT_SEND_PER_DAY = '100';
  process.env.SERVER_DELIVERY_RATE_LIMIT = '10000';
  process.env.SERVER_RESPOND_RATE_LIMIT = '10000';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();

  const { userService } = await import('../../src/services/UserService');
  ({ projectStore } = await import('../../src/services/ProjectStore'));
  ({ emailService } = await import('../../src/services/EmailService'));
  for (const name of ['pro', 'carol', 'busy', 'adjuster'])
  {
    await userService.register(`${name}@example.com`, 'password123', name);
    await userService.markEmailVerified((await userService.findByUsername(name))!.id);
  }

  app = Fastify();
  await app.register(import('@fastify/jwt'), { secret: SECRET });
  await app.register(import('@fastify/rate-limit'), { global: false });
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) =>
  {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  const { requireVerified, setupErrorHandling } = await import('../../src/plugin');
  app.decorate('requireVerified', requireVerified);
  const { config } = await import('../../src/config');
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: config.deliveries.maxFileBytes },
    (_request, body, done) => done(null, body));
  setupErrorHandling(app);
  const { registerProjectRoutes } = await import('../../src/routes/projects');
  const { registerClientRoutes } = await import('../../src/routes/client');
  await app.register(registerProjectRoutes);
  await app.register(registerClientRoutes);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('a draft', () =>
{
  it('takes .glb, .pdf and .xlsx files and refuses anything else', async () =>
  {
    const p = await project();
    const delivery = await draft(p);
    expect((await upload(p.id, delivery.id, 'prices.xlsx', XLSX)).statusCode).toBe(200);
    expect((await upload(p.id, delivery.id, 'page.html', Buffer.from('<script>'))).statusCode).toBe(422);
    expect((await upload(p.id, delivery.id, '..%2Fescape.pdf', PDF)).statusCode).toBe(422);

    const files = (await call('GET', `/projects/${p.id}`)).json().data.deliveries[0].files;
    expect(files.map((f: { name: string; kind: string }) => `${f.name}:${f.kind}`))
      .toEqual(['table.glb:model', 'table_offer.pdf:document', 'prices.xlsx:sheet']);
  });

  it('defaults the recipient to the project\'s client', async () =>
  {
    const p = await project();
    const delivery = await draft(p);
    expect(delivery).toMatchObject({ number: 1, recipientEmail: 'jan@example.com', recipientName: 'Jan de Vries', status: 'draft', link: null });
    expect((delivery as unknown as { offer: unknown }).offer).toMatchObject({ total: 1200, currency: 'EUR' });
  });

  it('refuses a file over the cap, and a delivery over its size', async () =>
  {
    const p = await project();
    const delivery = await draft(p);
    expect((await upload(p.id, delivery.id, 'huge.glb', Buffer.alloc(2000))).statusCode).toBe(413);
    expect((await upload(p.id, delivery.id, 'big.xlsx', Buffer.alloc(900))).statusCode).toBe(200);
    expect((await upload(p.id, delivery.id, 'more.xlsx', Buffer.alloc(900))).statusCode).toBe(429);
  });

  it('cannot be sent without files or a recipient', async () =>
  {
    const p = await project();
    const empty = (await call('POST', `/projects/${p.id}/deliveries`, { configurationId: p.configurationId, title: 'Empty' })).json().data;
    expect((await call('POST', `/projects/${p.id}/deliveries/${empty.id}/send`)).statusCode).toBe(422);

    const bare = (await call('POST', '/projects', { title: 'No client', configuration: { script: script('t') } })).json().data;
    const anonymous = await draft({ id: bare.id, configurationId: bare.configurations[0].id });
    expect((await call('POST', `/projects/${bare.id}/deliveries/${anonymous.id}/send`)).statusCode).toBe(422);
  });

  it('can be deleted; a sent delivery cannot', async () =>
  {
    const p = await project();
    const delivery = await draft(p);
    expect((await call('DELETE', `/projects/${p.id}/deliveries/${delivery.id}`)).statusCode).toBe(204);
    const { id } = await sent(p);
    expect((await call('DELETE', `/projects/${p.id}/deliveries/${id}`)).statusCode).toBe(409);
  });
});

describe('sending', () =>
{
  it('gives the delivery its link, freezes it and emails the client', async () =>
  {
    const mail = vi.spyOn(emailService, 'sendDelivery');
    const p = await project();
    const { id, link, token } = await sent(p);
    expect(link).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);
    expect((await upload(p.id, id, 'late.pdf', PDF)).statusCode).toBe(409);

    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toBe('jan@example.com');
    expect(mail.mock.calls[0][1]).toMatchObject({ professionalEmail: 'pro@example.com', title: 'Offer kitchen table', link });
    expect(token).toBeTruthy();

    const events = (await call('GET', `/projects/${p.id}`)).json().data.events.map((e: { type: string }) => e.type);
    expect(events).toContain('delivery.sent');
    mail.mockRestore();
  });

  it('caps how many deliveries one professional sends', async () =>
  {
    // A professional of their own, so the cap does not stop the other tests
    const p = await project('busy');
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++)
    {
      const delivery = await draft(p);
      statuses.push((await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/send`, undefined, 'busy')).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429]);

    // A day-old account has the per-day cap, a new one a smaller one
    const q = await project();
    const delivery = await draft(q);
    const limits = { maxDeliveryBytes: 1e9, quotaBytes: 1e9, sendPerHour: 1000, sendPerDay: 1000, newAccountSendPerDay: 0 };
    await expect(projectStore.sendDelivery('pro', q.id, delivery.id, new Date(), limits)).rejects.toMatchObject({ code: 'limit' });
    await expect(projectStore.sendDelivery('pro', q.id, delivery.id, new Date(Date.now() - 2 * 86400000), limits)).resolves.toMatchObject({ status: 'sent' });
  });
});

describe('the client\'s page', () =>
{
  it('shows the delivery without ids or addresses, and counts one open per visitor and day', async () =>
  {
    const p = await project();
    const { id, token } = await sent(p);

    const res = await visit(`/d/${token}`);
    expect(res.statusCode).toBe(200);
    const view = res.json().data;
    expect(view).toMatchObject({ status: 'sent', professional: 'pro', title: 'Offer kitchen table', recipient: 'Jan', response: null });
    expect(view.files.map((f: { name: string }) => f.name)).toEqual(['table.glb', 'table_offer.pdf']);
    expect(JSON.stringify(view)).not.toMatch(/jan@example\.com|pro@example\.com/);

    await visit(`/d/${token}`);                        // a reload: the same visitor
    await visit(`/d/${token}`, 'other-browser');       // someone else
    await app.inject({ method: 'GET', url: `/d/${token}`, headers: auth('pro') });   // the professional's preview

    // The client opened it: the project is unread until the professional looks
    const listed = (await projectStore.listProjects('pro', { q: 'kitchen' })).items.find((x) => x.id === p.id);
    expect(listed?.unread).toBe(true);

    const delivery = (await call('GET', `/projects/${p.id}`)).json().data.deliveries.find((d: { id: string }) => d.id === id);
    expect(delivery.openCount).toBe(2);
    expect(delivery.firstOpenedAt).toBeTruthy();
  });

  it('serves the files, and counts a download', async () =>
  {
    const p = await project();
    const { id, token } = await sent(p);

    const inline = await visit(`/d/${token}/files/table_offer.pdf`);
    expect(inline.statusCode).toBe(200);
    expect(inline.headers['content-type']).toBe('application/pdf');
    expect(inline.headers['content-disposition']).toMatch(/^inline/);
    expect(inline.rawPayload.equals(PDF)).toBe(true);

    const saved = await visit(`/d/${token}/files/table.glb?download=1`);
    expect(saved.headers['content-disposition']).toMatch(/^attachment/);
    await visit(`/d/${token}/files/table.glb?download=1`);

    expect((await visit(`/d/${token}/files/missing.pdf`)).statusCode).toBe(404);
    const delivery = (await call('GET', `/projects/${p.id}`)).json().data.deliveries.find((d: { id: string }) => d.id === id);
    expect(delivery.downloadCount).toBe(1);
  });

  it('takes one answer, and tells the professional', async () =>
  {
    const mail = vi.spyOn(emailService, 'sendClientResponse');
    const p = await project();
    const { id, token } = await sent(p);

    const res = await app.inject({ method: 'POST', url: `/d/${token}/respond`, payload: { response: 'changes', note: 'A bit lower please' } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/d/${token}/respond`, payload: { response: 'accepted' } })).statusCode).toBe(409);

    const project_ = (await call('GET', `/projects/${p.id}`)).json().data;
    expect(project_.deliveries.find((d: { id: string }) => d.id === id)).toMatchObject({ response: 'changes', responseNote: 'A bit lower please' });
    expect(project_.events[0]).toMatchObject({ type: 'delivery.changes_requested', actor: 'client' });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][1]).toMatchObject({ clientName: 'Jan de Vries', response: 'changes' });
    mail.mockRestore();
  });

  it('is gone once revoked, files and all', async () =>
  {
    const p = await project();
    const { id, token } = await sent(p);
    expect((await call('POST', `/projects/${p.id}/deliveries/${id}/revoke`)).statusCode).toBe(200);

    const page = await visit(`/d/${token}`);
    expect(page.statusCode).toBe(410);
    expect(page.json().data).toEqual({ status: 'revoked', professional: 'pro' });
    expect((await visit(`/d/${token}/files/table.glb`)).statusCode).toBe(410);
    expect((await app.inject({ method: 'POST', url: `/d/${token}/respond`, payload: { response: 'accepted' } })).statusCode).toBe(410);
  });

  it('does not know a made-up link', async () =>
  {
    expect((await visit('/d/this-is-not-a-real-token-at-all-0123456789')).statusCode).toBe(404);
    expect((await visit('/d/x')).statusCode).toBe(404);
  });
});

describe('another author\'s configurator', () =>
{
  it('can only carry the model and what it offers for download', async () =>
  {
    const { scriptStore } = await import('../../src/services/ScriptStore');
    const file = await scriptStore.create('carol', script('stool'));
    const published = await scriptStore.publish('carol', file.fileId as string, script('stool', {
      version: '1.0.0',
      published: { public: true, fulfillments: [{ name: 'Model', exports: ['default/model/glb'], delivery: 'anonymous download' }] },
    }));

    const res = await call('POST', '/projects', {
      title: 'Stool for Jan',
      client: { email: 'jan@example.com' },
      configuration: { script: published, values: { WIDTH: 400 } },
    });
    const p = { id: res.json().data.id, configurationId: res.json().data.configurations[0].id };
    const delivery = (await call('POST', `/projects/${p.id}/deliveries`, { configurationId: p.configurationId, title: 'Stool' })).json().data;

    expect((await upload(p.id, delivery.id, 'stool.glb', GLB)).statusCode).toBe(200);
    expect((await upload(p.id, delivery.id, 'stool.pdf', PDF)).statusCode).toBe(422);
    expect((await upload(p.id, delivery.id, 'stool.xlsx', XLSX)).statusCode).toBe(422);
  });
});

describe('adjusting a delivered design', () =>
{
  /** A project whose v1 is the professional's own published configurator, and a sent
   *  delivery of it. A professional of their own, clear of the send caps of the tests above. */
  const SUB = 'adjuster';

  async function deliveredConfigurator(allowAdjust: boolean)
  {
    const { scriptStore } = await import('../../src/services/ScriptStore');
    const file = await scriptStore.create(SUB, script('bench'));
    const published = await scriptStore.publish(SUB, file.fileId as string, script('bench', {
      version: '2.0.0',
      published: { public: true, fulfillments: [] },
    }));
    const created = (await call('POST', '/projects', {
      title: 'Bench for Jan',
      client: { email: 'jan@example.com', name: 'Jan de Vries' },
      configuration: { script: published, values: { WIDTH: 1600 } },
    }, SUB)).json().data;
    const p = { id: created.id as string, configurationId: created.configurations[0].id as string, sub: SUB };
    const delivery = await draft(p, { allowAdjust });
    const sentDelivery = (await call('POST', `/projects/${p.id}/deliveries/${delivery.id}/send`, undefined, SUB)).json().data;
    return { p, published: published as { id: string }, token: (sentDelivery.link as string).split('/d/')[1] };
  }

  const sendChanges = (over: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/orders', payload: { values: { WIDTH: 1800 }, message: 'A bit longer', ...over } });

  it('opens the configurator at the delivered values, with the link', async () =>
  {
    const { token } = await deliveredConfigurator(true);
    const view = (await visit(`/d/${token}`)).json().data;
    expect(view.adjustPath).toBe(`/configurators/adjuster/bench:2.0.0?WIDTH=1600&delivery=${token}`);
  });

  it('brings the changes back as a new configuration of the same project', async () =>
  {
    const mail = vi.spyOn(emailService, 'sendAdjustRequested');
    const { p, published, token } = await deliveredConfigurator(true);

    expect((await sendChanges({ versionId: published.id, deliveryToken: token })).statusCode).toBe(201);
    // The same changes again (a double click) are the same configuration
    expect((await sendChanges({ versionId: published.id, deliveryToken: token })).statusCode).toBe(201);

    const project = (await call('GET', `/projects/${p.id}`, undefined, SUB)).json().data;
    expect(project.configurations).toHaveLength(2);
    expect(project.configurations[0]).toMatchObject({ rev: 2, origin: 'adjust', values: { WIDTH: 1800 }, message: 'A bit longer' });
    expect(project.events[0]).toMatchObject({ type: 'adjust.requested', actor: 'client', meta: { changed: ['WIDTH'], rev: 2 } });
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][1]).toMatchObject({ clientName: 'Jan de Vries', changed: ['WIDTH'], rev: 2 });
    mail.mockRestore();
  });

  it('only for the delivered configurator, and only when allowed', async () =>
  {
    const { published: other } = await deliveredConfigurator(true);
    const { token } = await deliveredConfigurator(true);
    expect((await sendChanges({ versionId: other.id, deliveryToken: token })).statusCode).toBe(404);

    const closed = await deliveredConfigurator(false);
    expect((await visit(`/d/${closed.token}`)).json().data.adjustPath).toBeNull();
    expect((await sendChanges({ versionId: closed.published.id, deliveryToken: closed.token })).statusCode).toBe(404);
  });

  it('records the client opening the configurator, once a day, and nothing else', async () =>
  {
    const { p, token } = await deliveredConfigurator(true);
    const report = (type: string) => app.inject({ method: 'POST', url: `/d/${token}/events`, payload: { type }, headers: { 'user-agent': 'client-browser' } });
    expect((await report('adjust.opened')).statusCode).toBe(204);
    expect((await report('adjust.opened')).statusCode).toBe(204);
    expect((await report('delivery.accepted')).statusCode).toBe(422);

    const events = (await call('GET', `/projects/${p.id}`, undefined, SUB)).json().data.events.filter((e: { type: string }) => e.type === 'adjust.opened');
    expect(events).toHaveLength(1);
  });
});
