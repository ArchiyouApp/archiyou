/**
 * tests/unit/modules.docs.test.ts — serving a module's documentation.
 *
 * `GET /modules/:id/docs` is the one module route that is deliberately NOT
 * gated: the editor shows a locked module so someone can find out that a
 * capability exists, and its DOCS.md is how they find out what it does. That
 * openness is the thing worth pinning down — together with the three properties
 * that make it safe: only DOCS.md is ever read (a README holds build steps,
 * environment variables and security reasoning, and is NOT served), no id can
 * reach a file outside its own module directory, and no file can make the server
 * read an unbounded amount.
 *
 * Modules here are fictional. This repository ships none.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

const SECRET = 'test-secret-for-module-docs';

let app: FastifyInstance;
let userService: typeof import('../../src/services/UserService').userService;
let moduleHost: typeof import('../../src/modules/ModuleHost').moduleHost;
let modulesDir: string;

/** Write a module into the fixture directory the way a deployment would.
 *
 *  Every module gets a README too, and none of them may ever be served: that is
 *  the file this route exists to NOT publish. */
function installModule(id: string, docs?: string): void {
  const dir = join(modulesDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id, global: id, name: `${id} module`,
    version: '1.0.0', engine: '^1.0.0', runtime: 'client',
  }));
  writeFileSync(join(dir, 'bundle.js'), 'export default () => ({ setArchiyou() {} });');
  writeFileSync(join(dir, 'README.md'), `# ${id}\n\nSet CLOUDCALC_GOOGLE_CREDENTIALS to …\n`);
  if (docs !== undefined) writeFileSync(join(dir, 'DOCS.md'), docs);
}

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(import('@fastify/jwt'), { secret: SECRET });
  await instance.register(import('@fastify/rate-limit'), { global: false });
  instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify(); }
    catch { reply.code(401).send({ success: false, error: 'Unauthorized' }); }
  });
  const { setupErrorHandling } = await import('../../src/plugin');
  setupErrorHandling(instance);
  const { registerModuleRoutes } = await import('../../src/routes/modules');
  await instance.register(registerModuleRoutes);
  await instance.ready();
  return instance;
}

const tokenFor = (sub: string): string => app.jwt.sign({ sub, email: `${sub}@example.com`, name: sub });
const auth = (sub: string) => ({ authorization: `Bearer ${tokenFor(sub)}` });

/** Comfortably past the route's 256 KiB ceiling. */
const HUGE = 'x'.repeat(300 * 1024);

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-docs-')), 'test.db');
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();

  ({ userService } = await import('../../src/services/UserService'));
  ({ moduleHost } = await import('../../src/modules/ModuleHost'));

  modulesDir = mkdtempSync(join(tmpdir(), 'ay-docsdir-'));
  installModule('example', '# example\n\nOpens things.\n');
  installModule('bare');                       // README only — no DOCS.md
  installModule('enormous', `# big\n${HUGE}`);
  moduleHost.load(modulesDir);

  await userService.register('nobody@example.com', 'password123', 'nobody');
  await userService.setModules('nobody', []);

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(modulesDir, { recursive: true, force: true });
});

describe('GET /modules/:id/docs', () => {
  it('serves the markdown as markdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/example/docs' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('Opens things.');
  });

  it('is readable anonymously, and by a user who is not entitled', async () => {
    // The whole point: reading what a capability does is how someone decides
    // they want it. Gating the docs would leave the locked entry in the module
    // list explaining nothing.
    expect((await app.inject({ method: 'GET', url: '/modules/example/docs' })).statusCode).toBe(200);

    const locked = await app.inject({ method: 'GET', url: '/modules/example/docs', headers: auth('nobody') });
    expect(await userService.hasModule('nobody', 'example')).toBe(false);
    expect(locked.statusCode).toBe(200);
  });

  it('404s for a module that has a README but no DOCS.md', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/bare/docs' });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown module', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/nope/docs' });
    expect(res.statusCode).toBe(404);
  });

  it('cannot be walked out of the modules directory', async () => {
    // The path is resolved from ModuleHost's validated map, so a traversal id
    // is simply an id that is not installed.
    for (const id of ['..%2F..%2Fetc%2Fpasswd', '..', 'example%2F..%2F..%2Fpackage']) {
      const res = await app.inject({ method: 'GET', url: `/modules/${id}/docs` });
      expect(res.statusCode).toBe(404);
    }
  });

  it('truncates over-long documentation rather than refusing it', async () => {
    const res = await app.inject({ method: 'GET', url: '/modules/enormous/docs' });

    expect(res.statusCode).toBe(200);
    // Still readable from the top — a module with a huge DOCS.md should show
    // what it starts with, not an error.
    expect(res.body.startsWith('# big')).toBe(true);
    expect(res.body.length).toBeLessThan(HUGE.length);
  });

  it('never serves a module’s code or its README down this route', async () => {
    // Both sit next to DOCS.md in the same directory, and this route needs no
    // token — so the fact that only DOCS.md is ever read is the whole safety
    // property. A README routinely names environment variables and credentials.
    const res = await app.inject({ method: 'GET', url: '/modules/example/docs' });

    expect(res.body).not.toContain('setArchiyou');
    expect(res.body).not.toContain('CLOUDCALC_GOOGLE_CREDENTIALS');
    expect(res.body).toContain('Opens things.');
  });

  it('has no route serving a README at all', async () => {
    // The earlier shape of this feature published README.md. Nothing may bring
    // it back by accident.
    for (const url of ['/modules/example/readme', '/modules/example/README.md']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  it('does not shadow the bundle route', async () => {
    // Both live under /modules/:id/… and a router that confused them would
    // hand the bundle out unauthenticated.
    const res = await app.inject({ method: 'GET', url: '/modules/example/1.0.0/bundle.js' });
    expect(res.statusCode).toBe(401);
  });
});
