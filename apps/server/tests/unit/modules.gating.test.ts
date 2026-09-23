/**
 * tests/unit/modules.gating.test.ts — access control on gated script modules.
 *
 * A client module's bundle route IS the enforcement for that runtime: the browser
 * has no other way to obtain the code, so if a 403 ever regresses to a 200, every
 * paying customer's module becomes free. The server-call route is the same story
 * for CPU. Both are asserted here against a real database and real module files
 * on disk — the entitlement lookup is the thing under test, so mocking it away
 * would test nothing.
 *
 * Modules here are fictional ('example', 'heavy'). This repository ships none.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-module-gating';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;
let moduleHost: typeof import('../../src/modules/ModuleHost').moduleHost;
let modulesDir: string;

/** Write a module into the fixture directory the way a deployment would. */
function installModule(
  id: string,
  over: Record<string, unknown> = {},
  entrySource = 'export default { methods: { echo: async (a) => a } };',
): void {
  const dir = join(modulesDir, id);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    global: id,
    name: `${id} module`,
    version: '1.0.0',
    engine: '^1.0.0',
    runtime: 'client',
    ...over,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, manifest.runtime === 'client' ? 'bundle.js' : 'server.js'), entrySource);
  // A hybrid module ships its client wrapper next to server.js.
  if (manifest.runtime === 'server' && (manifest as any).client === true) {
    writeFileSync(join(dir, 'bundle.js'), 'export default ({ server }) => ({ setArchiyou() {}, server });');
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  await instance.register(import('@fastify/rate-limit'), { global: false });
  instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  // Same order as production: the handler must be installed BEFORE the route
  // plugin, or the encapsulated child context does not inherit it.
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerModuleRoutes } = await import('../../src/routes/modules');
  await instance.register(registerModuleRoutes);
  await instance.ready();
  return instance;
}

const tokenFor = (sub: string): string => app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub });
const auth = (sub: string) => ({ authorization: `Bearer ${tokenFor(sub)}` });

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-modules-')), 'test.db');
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();

  ({ userService } = await import('../../src/services/UserService'));
  ({ moduleHost } = await import('../../src/modules/ModuleHost'));

  modulesDir = mkdtempSync(join(tmpdir(), 'ay-modulesdir-'));
  installModule('example');
  installModule('heavy', { runtime: 'server' });
  installModule('hybrid', { runtime: 'server', client: true });
  moduleHost.load(modulesDir);

  await userService.register('owner@example.com', 'password123', 'owner');
  await userService.register('nobody@example.com', 'password123', 'nobody');
  await userService.setModules('owner', ['example', 'heavy', 'hybrid']);

  app = await buildApp();
});

beforeEach(async () => {
  // Each test starts from the same entitlements, so ordering cannot leak.
  await userService.setModules('owner', ['example', 'heavy', 'hybrid']);
  await userService.setModules('nobody', []);
});

afterAll(async () => { await app.close(); });

describe('GET /modules — the catalog', () => {
  it('lists locked modules too, so the editor can show them', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules', headers: auth('nobody') });

    expect(res.statusCode).toBe(200);
    const mods = res.json().modules;
    // Hiding them would leave a script using one failing with a bare
    // "undefined is not a function" — the entry is what makes the error good.
    expect(mods.map((m: any) => m.id).sort()).toEqual(['example', 'heavy', 'hybrid']);
    expect(mods.every((m: any) => m.entitled === false)).toBe(true);
  });

  it('marks the caller’s own modules entitled', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules', headers: auth('owner') });
    expect(res.json().modules.every((m: any) => m.entitled === true)).toBe(true);
  });

  it('is readable anonymously, with nothing entitled', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules' });
    expect(res.statusCode).toBe(200);
    expect(res.json().modules.every((m: any) => m.entitled === false)).toBe(true);
  });

  it('never exposes a module’s code', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules', headers: auth('owner') });
    expect(JSON.stringify(res.json())).not.toContain('export default');
  });
});

describe('the "*" wildcard entitlement', () => {
  it('entitles every installed module', async () => {
    await userService.setModules('nobody', ['*']);

    const res = await app.inject({ method: 'GET', url: '/modules', headers: auth('nobody') });
    expect(res.json().modules.every((m: any) => m.entitled === true)).toBe(true);
  });

  it('entitles a module installed AFTER the grant was made', async () => {
    await userService.setModules('nobody', ['*']);
    installModule('late');
    moduleHost.load(modulesDir);

    try {
      // The whole point of the wildcard: no per-account change on deployment.
      const res = await app.inject({ method: 'GET', url: '/modules', headers: auth('nobody') });
      const late = res.json().modules.find((m: any) => m.id === 'late');
      expect(late.entitled).toBe(true);

      const bundle = await app.inject({
        method: 'GET', url: '/modules/late/1.0.0/bundle.js', headers: auth('nobody'),
      });
      expect(bundle.statusCode).toBe(200);
    } finally {
      rmSync(join(modulesDir, 'late'), { recursive: true, force: true });
      moduleHost.load(modulesDir);
    }
  });

  it('serves a client bundle and allows a server call', async () => {
    await userService.setModules('nobody', ['*']);

    expect((await app.inject({
      method: 'GET', url: '/modules/example/1.0.0/bundle.js', headers: auth('nobody'),
    })).statusCode).toBe(200);

    const call = await app.inject({
      method: 'POST', url: '/modules/heavy/call', headers: auth('nobody'),
      payload: { method: 'echo', args: ['hi'] },
    });
    expect(call.statusCode).toBe(200);
  });

  it('collapses to exactly ["*"], so no named id looks revocable', async () => {
    // A stored ['*','example'] would invite `--revoke example` and then quietly
    // grant it anyway. Only one shape can mean "everything".
    expect(await userService.setModules('nobody', ['example', '*', 'heavy'])).toEqual(['*']);
  });

  it('is dropped by revoking "*" itself, and only that', async () => {
    await userService.setModules('nobody', ['*']);

    // A named revoke has nothing to remove from ['*'] — asserted so the no-op
    // stays deliberate rather than becoming a surprise.
    expect(await userService.revokeModules('nobody', ['example'])).toEqual(['*']);
    expect(await userService.hasModule('nobody', 'example')).toBe(true);

    expect(await userService.revokeModules('nobody', ['*'])).toEqual([]);
    expect(await userService.hasModule('nobody', 'example')).toBe(false);
  });

  it('cannot be granted by a module id, because "*" is not a legal id', async () => {
    // Belt and braces: ModuleRegistry restricts ids to /^[A-Za-z][A-Za-z0-9_]*$/,
    // so an installed module can never be named '*' and reach every account.
    installModule('*');
    moduleHost.load(modulesDir);

    try {
      expect(moduleHost.list().map((m) => m.id)).not.toContain('*');
    } finally {
      rmSync(join(modulesDir, '*'), { recursive: true, force: true });
      moduleHost.load(modulesDir);
    }
  });
});

describe('GET /modules/:id/:version/bundle.js — client bundles', () => {
  const URL_OK = '/modules/example/1.0.0/bundle.js';

  it('rejects an anonymous request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: URL_OK });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an authenticated but unentitled user with 403', async () => {
    const res = await app.inject({ method: 'GET', url: URL_OK, headers: auth('nobody') });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('module_not_entitled');
    expect(res.body).not.toContain('export default');
  });

  it('serves the bundle to an entitled user', async () => {
    const res = await app.inject({ method: 'GET', url: URL_OK, headers: auth('owner') });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('export default');
    expect(res.headers['content-type']).toMatch(/text\/javascript/);
  });

  it('stops serving the moment access is revoked', async () => {
    // Entitlements are read per request precisely so this is immediate; a JWT
    // claim would have kept working until the token expired, days later.
    expect((await app.inject({ method: 'GET', url: URL_OK, headers: auth('owner') })).statusCode).toBe(200);

    await userService.revokeModules('owner', ['example']);

    expect((await app.inject({ method: 'GET', url: URL_OK, headers: auth('owner') })).statusCode).toBe(403);
  });

  it('serves bundles uncached in dev and immutable in production', async () => {
    const { config } = await import('../../src/config');
    const saved = config.modules.dev;

    config.modules.dev = true;
    const dev = await app.inject({ method: 'GET', url: URL_OK, headers: auth('owner') });
    // The bytes at this URL change on every rebuild during development. Caching
    // them immutably would make a browser reload silently run the previous
    // build — a stale module that looks exactly like a working one.
    expect(dev.headers['cache-control']).toBe('no-store');
    expect(dev.headers['x-module-revision']).toBeTruthy();

    config.modules.dev = false;
    const prod = await app.inject({ method: 'GET', url: URL_OK, headers: auth('owner') });
    // In production the version is in the path, so the bytes really are immutable.
    expect(prod.headers['cache-control']).toMatch(/immutable/);
    expect(prod.headers['x-module-revision']).toBeUndefined();

    config.modules.dev = saved;
  });

  it('404s an unknown module and an unknown version', async () => {
    expect((await app.inject({ method: 'GET', url: '/modules/nope/1.0.0/bundle.js', headers: auth('owner') })).statusCode).toBe(404);
    // A stale cached URL must not silently receive different code.
    expect((await app.inject({ method: 'GET', url: '/modules/example/9.9.9/bundle.js', headers: auth('owner') })).statusCode).toBe(404);
  });

  it('does not serve a server module’s code as a bundle', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/heavy/1.0.0/bundle.js', headers: auth('owner') });
    // The entitlement passes; the runtime check is what refuses. Serving here
    // would defeat the entire point of a server-side module.
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('export default');
  });

  it('serves the client wrapper of a hybrid module, never its server code', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/hybrid/1.0.0/bundle.js', headers: auth('owner') });
    expect(res.statusCode).toBe(200);
    // The wrapper's factory takes the server stub; server.js (with `methods`) stays home.
    expect(res.body).toContain('({ server })');
    expect(res.body).not.toContain('methods');

    // And the wrapper is gated exactly like any bundle.
    const locked = await app.inject({ method: 'GET', url: '/modules/hybrid/1.0.0/bundle.js', headers: auth('nobody') });
    expect(locked.statusCode).toBe(403);
  });

  it('cannot be tricked into path traversal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/modules/..%2F..%2F..%2Fetc/1.0.0/bundle.js',
      headers: auth('owner'),
    });
    expect([400, 403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('root:');
  });
});

describe('POST /modules/:id/call — server modules', () => {
  it('rejects an anonymous request with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/modules/heavy/call', payload: { method: 'echo' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unentitled user with 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/modules/heavy/call',
      payload: { method: 'echo', args: 1 }, headers: auth('nobody'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('module_not_entitled');
  });

  it('refuses to call a client module', async () => {
    const res = await app.inject({
      method: 'POST', url: '/modules/example/call',
      payload: { method: 'echo' }, headers: auth('owner'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/runs in the browser/);
  });

  it('rejects a malformed method name before reaching the module', async () => {
    const res = await app.inject({
      method: 'POST', url: '/modules/heavy/call',
      payload: { method: 'not a method' }, headers: auth('owner'),
    });
    expect(res.statusCode).toBe(422);
  });

  it('404s an unknown module', async () => {
    const res = await app.inject({
      method: 'POST', url: '/modules/nope/call',
      payload: { method: 'echo' }, headers: auth('owner'),
    });
    expect(res.statusCode).toBe(404);
  });
});
