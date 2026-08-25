/**
 * tests/unit/users.search.test.ts — the people-picker directory boundary.
 *
 * `/users/search` is the only route that reads *other people's* rows, and every
 * signed-in account can call it. It used to answer with the same `toPublicUser`
 * view the caller gets for themselves — which meant any account could walk the
 * directory and harvest every user's email address, and could probe whether a
 * given address had an account at all (the thing /auth/forgot-password goes out
 * of its way not to disclose).
 *
 * Run against a real database, because the narrowing lives in the SQL.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-user-search';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerUserRoutes } = await import('../../src/routes/users');
  await instance.register(registerUserRoutes);
  await instance.ready();
  return instance;
}

const auth = (sub: string) => ({
  authorization: `Bearer ${app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub })}`,
});

/** Search as `caller`, returning the result rows. */
async function search(q: string, caller = 'caller'): Promise<any[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/users/search?q=${encodeURIComponent(q)}`,
    headers: auth(caller),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-usersearch-')), 'test.db');
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();

  ({ userService } = await import('../../src/services/UserService'));

  await userService.register('alice@secret-corp.example', 'password123', 'alice');
  await userService.register('bob@secret-corp.example', 'password123', 'bob');
  await userService.register('caller@example.com', 'password123', 'caller');
  // Entitlements are not the searcher's business either.
  userService.setModules('alice', ['example']);

  app = await buildApp();
});

afterAll(async () => { await app.close(); });

describe('GET /users/search — what a caller may learn about other accounts', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/search?q=alice' });
    expect(res.statusCode).toBe(401);
  });

  it('finds people by handle, and never returns their email or entitlements', async () => {
    const [alice] = await search('alic');

    expect(alice.id).toBe('alice');
    expect(alice.name).toBe('alice');
    // The two fields the picker has no use for and an attacker very much does.
    expect(alice.email).toBeNull();
    expect(alice.modules).toEqual([]);
  });

  it('does not leak addresses through a substring of the domain', async () => {
    // The harvesting case: one query over a common domain used to return every
    // colleague's address at once.
    expect(await search('secret-corp')).toEqual([]);
  });

  it('does not confirm an address from a partial one', async () => {
    // A prefix probe would answer the question /auth/forgot-password refuses to.
    expect(await search('alice@secret')).toEqual([]);
  });

  it('still resolves a full address, which is the actual picker workflow', async () => {
    // You already know the address of the person you mean to share with.
    const rows = await search('alice@secret-corp.example');
    expect(rows.map((u: any) => u.id)).toEqual(['alice']);
    // Found by email, still answered without one.
    expect(rows[0].email).toBeNull();
  });

  it('matches a full address case-insensitively', async () => {
    const rows = await search('ALICE@Secret-Corp.Example');
    expect(rows.map((u: any) => u.id)).toEqual(['alice']);
  });

  it('excludes the caller from their own results', async () => {
    expect((await search('caller')).map((u: any) => u.id)).toEqual([]);
  });

  it('returns nothing for a blank query rather than the whole directory', async () => {
    expect(await search('   ')).toEqual([]);
  });
});
