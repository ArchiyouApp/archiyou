/**
 * tests/unit/feedback.test.ts — visitor feedback: the public POST /feedback route and
 * the operator-only list/star/delete routes under /admin/feedback.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-feedback';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  await instance.register(import('@fastify/rate-limit'), { global: false });
  instance.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); return; }
    if (!userService.isAdmin(request.user.sub)) {
      reply.code(403).send({ success: false, error: 'Admin only', code: 'not_admin' });
    }
  });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerFeedbackRoutes } = await import('../../src/routes/feedback');
  const { registerAdminRoutes } = await import('../../src/routes/admin');
  await instance.register(registerFeedbackRoutes);
  await instance.register(registerAdminRoutes);
  await instance.ready();
  return instance;
}

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

const post = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/feedback', payload, headers });

const list = async (query = '') =>
  (await app.inject({ method: 'GET', url: `/admin/feedback${query}`, headers: auth('root') })).json();

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-feedback-')), 'test.db');
  process.env.SERVER_FEEDBACK_RATE_LIMIT = '1000';
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();

  ({ userService } = await import('../../src/services/UserService'));
  await userService.register('root@example.com', 'password123', 'root');
  await userService.register('alice@example.com', 'password123', 'alice');
  userService.setAdmin('root', true);

  app = await buildApp();
});

afterAll(async () => { await app.close(); });

describe('POST /feedback', () => {
  it('accepts anonymous feedback with the script it was about', async () => {
    const res = await post({ message: '  Needs a wider door  ', scriptAuthor: 'Alice', scriptName: 'shed', scriptVersion: '1.0.0' });
    expect(res.statusCode).toBe(201);

    const item = (await list()).data.find((f: { id: string }) => f.id === res.json().data.id);
    expect(item).toMatchObject({ message: 'Needs a wider door', scriptAuthor: 'alice', username: null, starred: false });
  });

  it('records the sender when signed in', async () => {
    const res = await post({ message: 'from alice' }, auth('alice'));
    const item = (await list('?q=from%20alice')).data[0];
    expect(item.id).toBe(res.json().data.id);
    expect(item.username).toBe('alice');
  });

  it('422s an empty or missing message', async () => {
    expect((await post({ message: '   ' })).statusCode).toBe(422);
    expect((await post({})).statusCode).toBe(422);
  });
});

describe('/admin/feedback', () => {
  it('is operator only', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/feedback' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/feedback', headers: auth('alice') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/admin/feedback/x', headers: auth('alice') })).statusCode).toBe(403);
  });

  it('stars, filters on starred and sorts starred first', async () => {
    const id = (await post({ message: 'star me' })).json().data.id;
    await post({ message: 'newer, not starred' });

    const res = await app.inject({
      method: 'PUT', url: `/admin/feedback/${id}/starred`, payload: { starred: true }, headers: auth('root'),
    });
    expect(res.json().data.starred).toBe(true);

    expect((await list('?starred=true')).data.map((f: { id: string }) => f.id)).toEqual([id]);
    expect((await list('?sort=starred')).data[0].id).toBe(id);
    // Rows posted within one millisecond tie on `created`, so assert the order, not a winner.
    const created = (await list('?sort=newest')).data.map((f: { created: string }) => f.created);
    expect(created).toEqual([...created].sort().reverse());
  });

  it('deletes, and 404s what is not there', async () => {
    const id = (await post({ message: 'delete me' })).json().data.id;
    const del = await app.inject({ method: 'DELETE', url: `/admin/feedback/${id}`, headers: auth('root') });
    expect(del.statusCode).toBe(200);
    expect((await list('?q=delete%20me')).total).toBe(0);

    const again = await app.inject({ method: 'DELETE', url: `/admin/feedback/${id}`, headers: auth('root') });
    expect(again.statusCode).toBe(404);
  });

  it('400s an unknown sort', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/feedback?sort=loudest', headers: auth('root') });
    expect(res.statusCode).toBe(400);
  });
});
