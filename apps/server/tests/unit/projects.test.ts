/**
 * tests/unit/projects.test.ts — a professional's projects, clients and configurations
 * (routes/projects.ts, services/ProjectStore.ts; plans/PROJECTS.md, phase 1).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-projects';

let app: FastifyInstance;
let scriptStore: typeof import('../../src/services/ScriptStore').scriptStore;
let projectStore: typeof import('../../src/services/ProjectStore').projectStore;

/** A script with two parameters, as the editor would send it. */
function script(over: Record<string, unknown> = {}): Record<string, unknown>
{
  return {
    name: 'table',
    code: 'box($WIDTH, 500, $HEIGHT);',
    params: {
      WIDTH: { type: 'number', name: 'WIDTH', default: 1000, schema: { type: 'number', minimum: 100, maximum: 3000 } },
      HEIGHT: { type: 'number', name: 'HEIGHT', default: 750, schema: { type: 'number', minimum: 300, maximum: 1200 } },
    },
    ...over,
  };
}

async function buildApp(): Promise<FastifyInstance>
{
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  await instance.register(import('@fastify/rate-limit'), { global: false });
  instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) =>
  {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  const { requireVerified, setupErrorHandling } = await import('../../src/plugin');
  instance.decorate('requireVerified', requireVerified);
  const { config } = await import('../../src/config');
  instance.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: config.thumbnails.maxBytes + 1024 },
    (_request, body, done) => done(null, body));
  setupErrorHandling(instance);
  const { registerProjectRoutes } = await import('../../src/routes/projects');
  await instance.register(registerProjectRoutes);
  await instance.ready();
  return instance;
}

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, sub = 'alice', payload?: unknown) =>
  app.inject({ method, url, headers: auth(sub), ...(payload !== undefined ? { payload: payload as object } : {}) });

async function newProject(sub = 'alice', body: Record<string, unknown> = {}): Promise<{ id: string; number: number }>
{
  const res = await call('POST', '/projects', sub, { title: 'Kitchen table', ...body });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_THUMBNAIL_PATH = `${(await import('node:os')).tmpdir()}/archiyou-projects-test-${process.pid}`;
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();

  const { userService } = await import('../../src/services/UserService');
  ({ scriptStore } = await import('../../src/services/ScriptStore'));
  ({ projectStore } = await import('../../src/services/ProjectStore'));

  for (const name of ['alice', 'bob', 'carol'])
  {
    await userService.register(`${name}@example.com`, 'password123', name);
  }
  for (const name of ['alice', 'bob'])
  {
    await userService.markEmailVerified((await userService.findByUsername(name))!.id);
  }

  app = await buildApp();
});

afterAll(async () => { await app.close(); });

describe('projects', () =>
{
  it('needs a verified email address', async () =>
  {
    expect((await call('GET', '/projects', 'carol')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/projects' })).statusCode).toBe(401);
  });

  it('numbers each professional\'s projects from P-001', async () =>
  {
    const first = await newProject('bob');
    const second = await newProject('bob');
    expect([first.number, second.number]).toEqual([1, 2]);
  });

  it('keeps one professional out of another\'s projects', async () =>
  {
    const { id } = await newProject('alice');
    expect((await call('GET', `/projects/${id}`, 'bob')).statusCode).toBe(404);
    expect((await call('PUT', `/projects/${id}`, 'bob', { title: 'Mine now' })).statusCode).toBe(404);
    expect((await call('DELETE', `/projects/${id}`, 'bob')).statusCode).toBe(404);
    expect((await call('GET', `/projects/${id}`, 'alice')).statusCode).toBe(200);
  });

  it('allows only the defined status changes', async () =>
  {
    const { id } = await newProject();
    const toWon = await call('PUT', `/projects/${id}`, 'alice', { status: 'won' });
    expect(toWon.statusCode).toBe(200);
    expect(toWon.json().data.events.map((e: { type: string }) => e.type)).toContain('status.changed');

    // won → lost is not a step; reopening (→ active) first is
    expect((await call('PUT', `/projects/${id}`, 'alice', { status: 'lost' })).statusCode).toBe(422);

    const request = await projectStore.createProject('alice', { title: 'Order', status: 'request' });
    expect((await call('PUT', `/projects/${request.id}`, 'alice', { status: 'won' })).statusCode).toBe(422);
    expect((await call('PUT', `/projects/${request.id}`, 'alice', { status: 'active' })).statusCode).toBe(200);
  });

  it('lists by status with counts, and archives', async () =>
  {
    const { id } = await newProject('alice', { title: 'Garden shed' });
    const list = (await call('GET', '/projects?q=shed')).json();
    expect(list.data.map((p: { id: string }) => p.id)).toContain(id);
    expect(list.counts.active).toBeGreaterThan(0);

    await call('PUT', `/projects/${id}`, 'alice', { archived: true });
    expect((await call('GET', '/projects?q=shed')).json().data.map((p: { id: string }) => p.id)).not.toContain(id);
    expect((await call('GET', '/projects?q=shed&archived=true')).json().data[0].archived).toBe(true);
  });
});

describe('configurations', () =>
{
  it('snapshots the script with every value, defaults filled in', async () =>
  {
    const { id } = await newProject();
    const res = await call('POST', `/projects/${id}/configurations`, 'alice', { script: script(), values: { width: 1800 } });
    expect(res.statusCode).toBe(201);
    const configuration = res.json().data;
    expect(configuration).toMatchObject({ rev: 1, origin: 'added', values: { WIDTH: 1800, HEIGHT: 750 }, scriptName: 'table' });
    expect(configuration.changed).toEqual({ WIDTH: 1800 });

    const second = (await call('POST', `/projects/${id}/configurations`, 'alice', { script: script() })).json().data;
    expect(second.rev).toBe(2);

    const full = (await call('GET', `/projects/${id}/configurations/${configuration.id}`)).json().data;
    expect(full.script.code).toBe('box($WIDTH, 500, $HEIGHT);');
    expect(Object.keys(full.script.params)).toEqual(['WIDTH', 'HEIGHT']);
  });

  it('refuses unknown parameters and an invalid script', async () =>
  {
    const { id } = await newProject();
    expect((await call('POST', `/projects/${id}/configurations`, 'alice', { script: script(), values: { DEPTH: 3 } })).statusCode).toBe(422);
    expect((await call('POST', `/projects/${id}/configurations`, 'alice', { script: { code: 42 } })).statusCode).toBe(422);
  });

  it('creates a project with its first configuration in one call', async () =>
  {
    const res = await call('POST', '/projects', 'alice', { title: 'Desk', configuration: { script: script(), values: { HEIGHT: 720 } } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.configurations).toHaveLength(1);

    // …and creates nothing when the configuration is invalid
    const before = (await call('GET', '/projects?q=broken')).json().total;
    const bad = await call('POST', '/projects', 'alice', { title: 'Broken', configuration: { script: script(), values: { NOPE: 1 } } });
    expect(bad.statusCode).toBe(422);
    expect((await call('GET', '/projects?q=broken')).json().total).toBe(before);
  });

  it('adds another author\'s published configurator', async () =>
  {
    const file = await scriptStore.create('carol', script({ name: 'stool' }));
    const published = await scriptStore.publish('carol', file.fileId as string, script({
      name: 'stool',
      version: '1.0.0',
      published: { public: true, fulfillments: [] },
    }));

    const { id } = await newProject('bob');
    const res = await call('POST', `/projects/${id}/configurations`, 'bob', { script: published, values: { WIDTH: 400 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      scriptAuthor: 'carol',
      configurator: { author: 'carol', name: 'stool', version: '1.0.0' },
      sourceVersionId: published.id,
    });
  });

  it('keeps the label as the only editable field', async () =>
  {
    const { id } = await newProject();
    const configuration = (await call('POST', `/projects/${id}/configurations`, 'alice', { script: script() })).json().data;
    const res = await call('PUT', `/projects/${id}/configurations/${configuration.id}`, 'alice', { label: 'Oak, wider' });
    expect(res.json().data).toMatchObject({ label: 'Oak, wider', values: configuration.values });
  });

  it('stores a thumbnail', async () =>
  {
    const { id } = await newProject();
    const configuration = (await call('POST', `/projects/${id}/configurations`, 'alice', { script: script() })).json().data;
    // 1×1 transparent PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/configurations/${configuration.id}/thumbnail`,
      headers: { ...auth('alice'), 'content-type': 'image/png' },
      payload: png,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().thumbnail).toMatch(new RegExp(`/alice/${id}/${configuration.id}-`));
    const list = (await call('GET', '/projects?q=kitchen')).json().data;
    expect(list.find((p: { id: string }) => p.id === id)?.thumbnail).toBe(res.json().thumbnail);
  });

  it('deletes a project with everything in it', async () =>
  {
    const { id } = await newProject();
    await call('POST', `/projects/${id}/configurations`, 'alice', { script: script() });
    expect((await call('DELETE', `/projects/${id}`)).statusCode).toBe(204);
    expect((await call('GET', `/projects/${id}`)).statusCode).toBe(404);
  });
});

describe('clients', () =>
{
  it('dedupes on email whatever its case', async () =>
  {
    const created = await call('POST', '/clients', 'alice', { email: 'Jan@Example.com', name: 'Jan' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.email).toBe('jan@example.com');
    expect((await call('POST', '/clients', 'alice', { email: 'jan@example.com' })).statusCode).toBe(409);

    // An order from the same person finds the same client and fills in what was missing
    const upserted = await projectStore.upsertClientByEmail('alice', { email: 'JAN@example.com', phone: '0612345678' });
    expect(upserted).toMatchObject({ id: created.json().data.id, name: 'Jan', phone: '0612345678' });

    // Another professional's client with the same email is theirs
    expect((await call('POST', '/clients', 'bob', { email: 'jan@example.com' })).statusCode).toBe(201);
  });

  it('keeps a client that still has projects', async () =>
  {
    const client = (await call('POST', '/clients', 'alice', { email: 'piet@example.com', name: 'Piet' })).json().data;
    const { id } = await newProject('alice', { clientId: client.id });
    expect((await call('GET', `/projects/${id}`)).json().data.clientName).toBe('Piet');
    expect((await call('DELETE', `/clients/${client.id}`)).statusCode).toBe(409);

    await call('DELETE', `/projects/${id}`);
    expect((await call('DELETE', `/clients/${client.id}`)).statusCode).toBe(204);
  });
});

describe('activity', () =>
{
  it('marks a project unread on client activity until it is opened', async () =>
  {
    const { id } = await newProject();
    await projectStore.addEvent('alice', id, { type: 'delivery.opened', actor: 'client' });
    const listed = (await call('GET', '/projects?q=kitchen')).json().data.find((p: { id: string }) => p.id === id);
    expect(listed.unread).toBe(true);

    await call('GET', `/projects/${id}`);
    const after = (await call('GET', '/projects?q=kitchen')).json().data.find((p: { id: string }) => p.id === id);
    expect(after.unread).toBe(false);
  });

  it('purges events older than the retention', async () =>
  {
    const { id } = await newProject();
    await projectStore.addEvent('alice', id, { type: 'delivery.opened', actor: 'client' });
    expect(await projectStore.purgeEvents(-1)).toBeGreaterThan(0);
    expect((await call('GET', `/projects/${id}`)).json().data.events).toHaveLength(0);
  });
});
