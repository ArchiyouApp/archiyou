/**
 * tests/unit/links.test.ts — links reserved before their target exists (routes/links.ts):
 * reserving, setting by the owner only, the redirect and its waiting page, no open redirect.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-links';
const SHEET = 'https://docs.google.com/spreadsheets/d/1abcdefghijklmnopqrstuvwxyz/edit';

let app: FastifyInstance;

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
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerLinkRoutes } = await import('../../src/routes/links');
  await instance.register(registerLinkRoutes);
  await instance.ready();
  return instance;
}

const auth = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}` });

async function reserve(owner = 'alice', title = 'Offer for Jansen'): Promise<{ key: string; url: string }>
{
  const res = await app.inject({ method: 'POST', url: '/links', headers: { ...auth(owner), host: 'app.example.com' }, payload: { kind: 'google-sheet-copy', title } });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

const set = (key: string, payload: Record<string, unknown>, owner = 'alice') =>
  app.inject({ method: 'PUT', url: `/links/${key}`, headers: auth(owner), payload });

const go = (key: string) => app.inject({ method: 'GET', url: `/go/${key}` });

beforeAll(async () =>
{
  // A fresh in-process PGlite database; never a developer's .env database.
  process.env.SERVER_DATABASE_URL = 'memory://';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  app = await buildApp();
});

afterAll(async () => { await app.close(); });

describe('POST /links', () =>
{
  it('reserves a pending link with a 10-character base58 key on the origin it was asked on', async () =>
  {
    const { key, url } = await reserve();
    expect(key).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect(url).toBe(`http://app.example.com/go/${key}`);
  });

  it('needs a signed-in user and a known kind', async () =>
  {
    expect((await app.inject({ method: 'POST', url: '/links', payload: { kind: 'google-sheet-copy' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/links', headers: auth('alice'), payload: { kind: 'anything' } })).statusCode).toBe(422);
  });

  it('gives a different key every time', async () =>
  {
    const { newKey } = await import('../../src/routes/links');
    const keys = new Set(Array.from({ length: 500 }, () => newKey()));
    expect(keys.size).toBe(500);
  });
});

describe('GET /go/:key', () =>
{
  it('shows a self-refreshing waiting page while pending', async () =>
  {
    const { key } = await reserve('alice', 'Offer <Jansen>');
    const res = await go(key);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.body).toContain('<meta http-equiv="refresh" content="3">');
    expect(res.body).toContain('Offer &lt;Jansen&gt;');
    expect(res.body).toContain('almost ready');
  });

  it('redirects with a 302 once the owner sets the target', async () =>
  {
    const { key } = await reserve();
    expect((await set(key, { target: SHEET })).statusCode).toBe(204);
    const res = await go(key);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(SHEET);
  });

  it('says why when the owner marks it failed', async () =>
  {
    const { key } = await reserve();
    expect((await set(key, { error: 'Google Drive refused the copy' })).statusCode).toBe(204);
    const res = await go(key);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Google Drive refused the copy');
    expect(res.body).not.toContain('refresh');
  });

  it('answers 404 for an unknown or malformed key', async () =>
  {
    expect((await go('zzzzzzzzzz')).statusCode).toBe(404);
    expect((await go('not-a-key')).statusCode).toBe(404);
  });

  it('stops waiting for a link that was never finished', async () =>
  {
    const { key } = await reserve();
    const { db } = await import('../../src/db/client');
    const { links } = await import('../../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(links).set({ created: new Date(Date.now() - 16 * 60_000) }).where(eq(links.key, key));
    const res = await go(key);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('never finished');
  });
});

describe('PUT /links/:key', () =>
{
  it('refuses a target outside Google Docs and Drive: no open redirect', async () =>
  {
    const { key } = await reserve();
    expect((await set(key, { target: 'https://evil.example.com/login' })).statusCode).toBe(422);
    expect((await set(key, { target: 'https://docs.google.com.evil.example.com/x' })).statusCode).toBe(422);
    expect((await go(key)).statusCode).toBe(200);
  });

  it('lets only the owner set a link', async () =>
  {
    const { key } = await reserve('alice');
    expect((await set(key, { target: SHEET }, 'bob')).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/links/${key}`, payload: { target: SHEET } })).statusCode).toBe(401);
    expect((await go(key)).statusCode).toBe(200);
  });

  it('takes a target or an error, not both', async () =>
  {
    const { key } = await reserve();
    expect((await set(key, { target: SHEET, error: 'x' })).statusCode).toBe(422);
  });
});
