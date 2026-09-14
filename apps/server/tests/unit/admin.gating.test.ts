/**
 * tests/unit/admin.gating.test.ts — access control on the operator surface.
 *
 * /admin's one power is `published.validated`, which clears a specific published
 * version to run SERVER-SIDE, unsandboxed, for callers who may be anonymous
 * (routes/execute.ts). A 403 regressing to a 200 here would let any signed-in
 * account grant that to its own code, so the gate is asserted against a real
 * database rather than a mocked one — the users.is_admin lookup IS the thing
 * under test.
 *
 * Also asserted: that these routes are NOT owner-scoped. Every /scripts/:user/*
 * route carries `assertSelf` (the path handle must equal your own JWT sub), which
 * is exactly wrong for a review queue, so acting on somebody else's script has to
 * keep working.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import type { ScriptData } from '@archiyou/core/src/execution/types';

const SECRET = 'test-secret-for-admin-gating';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;
let scriptStore: typeof import('../../src/services/ScriptStore').scriptStore;

/** A published version owned by `author`; returns its row id. */
function publish(author: string, name: string, version = '0.1'): string {
  const fileId = scriptStore.create(author, { name, code: 'box(10,10,10);' }).fileId as string;
  const data = scriptStore.publish(author, fileId, {
    name, version, code: 'box(10,10,10);',
    published: { public: true, fulfillments: [] },
  } as unknown as Record<string, unknown>);
  return data.id as string;
}

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  // Mirrors the production decorator (plugin.ts): 401 for "log in", 403 for
  // "logged in, still not allowed" — the editor routes on that difference.
  instance.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); return; }
    if (!userService.isAdmin(request.user.sub)) {
      reply.code(403).send({ success: false, error: 'Admin only', code: 'not_admin' });
    }
  });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerAdminRoutes } = await import('../../src/routes/admin');
  await instance.register(registerAdminRoutes);
  await instance.ready();
  return instance;
}

const tokenFor = (sub: string): string => app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub });
const auth = (sub: string) => ({ authorization: `Bearer ${tokenFor(sub)}` });

let aliceScript: string;

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-admin-')), 'test.db');
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();

  ({ userService } = await import('../../src/services/UserService'));
  ({ scriptStore } = await import('../../src/services/ScriptStore'));

  await userService.register('root@example.com', 'password123', 'root');
  await userService.register('alice@example.com', 'password123', 'alice');
  userService.setAdmin('root', true);

  aliceScript = publish('alice', 'chair');

  app = await buildApp();
});

beforeEach(() => {
  userService.setAdmin('root', true);
  userService.setAdmin('alice', false);
  scriptStore.setValidated(aliceScript, false);
});

afterAll(async () => { await app.close(); });

describe('admin routes — the gate', () => {
  const ROUTES: Array<[string, string]> = [
    ['GET', '/admin/configurators'],
    ['GET', '/admin/configurators/some-id'],
    ['PUT', '/admin/configurators/some-id/validated'],
  ];

  it.each(ROUTES)('401s an anonymous %s %s', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url, payload: { validated: true } });
    expect(res.statusCode).toBe(401);
  });

  it.each(ROUTES)('403s a signed-in non-admin %s %s', async (method, url) => {
    const res = await app.inject({
      method: method as 'GET', url, payload: { validated: true }, headers: auth('alice'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('not_admin');
  });

  it('distinguishes "log in" from "not allowed"', async () => {
    // Collapsing these would send the editor to the login screen for an account
    // that is already signed in.
    const anon = await app.inject({ method: 'GET', url: '/admin/configurators' });
    const nonAdmin = await app.inject({ method: 'GET', url: '/admin/configurators', headers: auth('alice') });
    expect(anon.statusCode).toBe(401);
    expect(nonAdmin.statusCode).toBe(403);
  });

  it('reflects a revoked grant immediately, with no token change', async () => {
    // The reason is_admin is a column and not a JWT claim: tokens live 7 days with
    // no revocation list, so a baked-in claim would outlive the withdrawal by a week.
    const token = auth('root');
    expect((await app.inject({ method: 'GET', url: '/admin/configurators', headers: token })).statusCode).toBe(200);
    userService.setAdmin('root', false);
    expect((await app.inject({ method: 'GET', url: '/admin/configurators', headers: token })).statusCode).toBe(403);
  });
});

describe('admin routes — validating a configurator', () => {
  it('toggles validated on somebody else\'s script', async () => {
    // Not owner-scoped, unlike every /scripts/:user/* route. That is the point.
    const on = await app.inject({
      method: 'PUT', url: `/admin/configurators/${aliceScript}/validated`,
      payload: { validated: true }, headers: auth('root'),
    });
    expect(on.statusCode).toBe(200);
    expect((on.json().data as ScriptData).published?.validated).toBe(true);
    expect(scriptStore.findAnyVersionById(aliceScript)?.published?.validated).toBe(true);

    const off = await app.inject({
      method: 'PUT', url: `/admin/configurators/${aliceScript}/validated`,
      payload: { validated: false }, headers: auth('root'),
    });
    expect((off.json().data as ScriptData).published?.validated).toBe(false);
  });

  it('a non-admin cannot validate their own script', async () => {
    // The whole threat model: an author clearing their own code to run unsandboxed.
    const res = await app.inject({
      method: 'PUT', url: `/admin/configurators/${aliceScript}/validated`,
      payload: { validated: true }, headers: auth('alice'),
    });
    expect(res.statusCode).toBe(403);
    expect(scriptStore.findAnyVersionById(aliceScript)?.published?.validated).toBe(false);
  });

  it('422s a body that is not a boolean', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/admin/configurators/${aliceScript}/validated`,
      payload: { validated: 'yes' }, headers: auth('root'),
    });
    expect(res.statusCode).toBe(422);
  });

  it('404s an unknown version', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/admin/configurators/no-such-id/validated',
      payload: { validated: true }, headers: auth('root'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the code on the single-version route', async () => {
    // An operator is vouching for exactly these bytes, so the review screen has to
    // be able to show them.
    const res = await app.inject({
      method: 'GET', url: `/admin/configurators/${aliceScript}`, headers: auth('root'),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as ScriptData).code).toBe('box(10,10,10);');
  });
});

describe('admin routes — the review list', () => {
  it('spans authors and pages independently of the total', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/configurators', headers: auth('root') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.data.map((s: ScriptData) => s.id)).toContain(aliceScript);

    const paged = await app.inject({
      method: 'GET', url: '/admin/configurators?limit=1', headers: auth('root'),
    });
    expect(paged.json().data).toHaveLength(1);
    expect(paged.json().total).toBe(body.total);
  });

  it('filters on validated', async () => {
    scriptStore.setValidated(aliceScript, true);
    const yes = await app.inject({
      method: 'GET', url: '/admin/configurators?validated=true', headers: auth('root'),
    });
    expect(yes.json().data.map((s: ScriptData) => s.id)).toContain(aliceScript);

    const no = await app.inject({
      method: 'GET', url: '/admin/configurators?validated=false', headers: auth('root'),
    });
    expect(no.json().data.map((s: ScriptData) => s.id)).not.toContain(aliceScript);
  });

  it('400s an unparseable validated filter rather than silently showing everything', async () => {
    const res = await app.inject({
      method: 'GET', url: '/admin/configurators?validated=maybe', headers: auth('root'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('filters by author', async () => {
    expect((await app.inject({
      method: 'GET', url: '/admin/configurators?author=alice', headers: auth('root'),
    })).json().total).toBeGreaterThan(0);

    expect((await app.inject({
      method: 'GET', url: '/admin/configurators?author=nobody', headers: auth('root'),
    })).json().total).toBe(0);
  });
});
