/**
 * tests/unit/moduleHost.test.ts — installing, scanning and calling script modules.
 *
 * Two properties matter most here:
 *
 *  1. With SERVER_MODULES_DIR unset the host is INERT. That is what lets this
 *     repository ship and run with no modules at all.
 *  2. A server module's timeout is enforced by terminating its thread. The
 *     script-execution path documents its own timeout as only partial, because a
 *     synchronous loop starves the timer meant to fire — so the infinite-loop
 *     case below is the whole justification for using worker threads.
 *
 * Modules here are fictional. This repository ships none.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ModuleHost } from '../../src/modules/ModuleHost';
import { ModuleCallError } from '../../src/modules/ModuleWorkerPool';
import { config } from '../../src/config';

let root: string;
const savedTimeout = config.modules.callTimeoutMs;

interface InstallOpts {
  manifest?: Record<string, unknown> | string;
  source?: string;
  /** Skip writing the runtime artifact entirely. */
  noEntry?: boolean;
  /** Directory name, when it should differ from the id. */
  dirName?: string;
}

function install(id: string, opts: InstallOpts = {}): void {
  const dir = join(root, opts.dirName ?? id);
  mkdirSync(dir, { recursive: true });

  const manifest = opts.manifest ?? {
    id, global: id, name: `${id} module`,
    version: '1.0.0', engine: '^1.0.0', runtime: 'client',
  };
  writeFileSync(
    join(dir, 'manifest.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
  );

  if (opts.noEntry) return;
  const runtime = typeof manifest === 'object' ? (manifest as any).runtime : 'client';
  writeFileSync(
    join(dir, runtime === 'server' ? 'server.js' : 'bundle.js'),
    opts.source ?? 'export default () => ({ setArchiyou() {} });',
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ay-modulehost-'));

  install('example');
  install('heavy', {
    manifest: { id: 'heavy', global: 'heavy', name: 'Heavy', version: '2.0.0', engine: '^1.0.0', runtime: 'server' },
    source: `
      export default {
        methods: {
          echo: async (args) => ({ got: args }),
          spin: async () => { while (true) {} },
          explode: async () => { throw new Error('module blew up'); },
        },
      };
    `,
  });

  // Every one of these must be skipped with a warning, not crash the scan.
  install('badjson', { manifest: '{ not valid json' });
  install('badfields', { manifest: { id: 'badfields', global: '1nope', name: 'x', version: '1', engine: '^1', runtime: 'client' } });
  install('mismatch', { dirName: 'other-name' });
  install('noentry', { noEntry: true });
});

afterAll(() => {
  config.modules.callTimeoutMs = savedTimeout;
  rmSync(root, { recursive: true, force: true });
});

describe('ModuleHost — the off-by-default case', () => {
  it('is inert with no directory configured', () => {
    const host = new ModuleHost().load('');

    // The shipped default. If this ever regresses, a plain checkout of this
    // repository stops being self-contained.
    expect(host.enabled).toBe(false);
    expect(host.list()).toEqual([]);
    expect(host.catalogFor(['example'])).toEqual([]);
  });

  it('survives a configured directory that does not exist', () => {
    const host = new ModuleHost().load(join(root, 'does-not-exist'));
    expect(host.list()).toEqual([]);
  });
});

describe('ModuleHost — scanning', () => {
  it('loads well-formed modules and skips broken ones', () => {
    const host = new ModuleHost().load(root);

    // A single bad manifest in the deploy directory must not take the working
    // modules down with it.
    expect(host.list().map((m) => m.id).sort()).toEqual(['example', 'heavy']);
  });

  it('skips a module whose manifest id does not match its directory', () => {
    const host = new ModuleHost().load(root);
    // Otherwise "which module is 'mismatch'?" has two answers.
    expect(host.get('mismatch')).toBeUndefined();
  });

  it('skips a module with no runtime artifact', () => {
    const host = new ModuleHost().load(root);
    expect(host.get('noentry')).toBeUndefined();
  });

  it('marks entitlement per user without hiding anything', () => {
    const host = new ModuleHost().load(root);
    const catalog = host.catalogFor(['example']);

    expect(catalog).toHaveLength(2);
    expect(catalog.find((m) => m.id === 'example')!.entitled).toBe(true);
    expect(catalog.find((m) => m.id === 'heavy')!.entitled).toBe(false);
  });
});

describe('ModuleHost — bundle resolution', () => {
  it('resolves a client bundle at its exact version', () => {
    const host = new ModuleHost().load(root);
    expect(host.bundlePath('example', '1.0.0')).toMatch(/example\/bundle\.js$/);
  });

  it('refuses a wrong version, an unknown id, and a server module', () => {
    const host = new ModuleHost().load(root);

    expect(host.bundlePath('example', '9.9.9')).toBeNull();
    expect(host.bundlePath('nope', '1.0.0')).toBeNull();
    // Serving a server module's source would defeat its entire purpose.
    expect(host.bundlePath('heavy', '2.0.0')).toBeNull();
  });

  it('cannot be walked out of its directory', () => {
    const host = new ModuleHost().load(root);
    // Paths come from the validated in-memory map, never from string joining.
    expect(host.bundlePath('../../etc/passwd', '1.0.0')).toBeNull();
    expect(host.bundlePath('example/../../..', '1.0.0')).toBeNull();
  });
});

describe('ModuleHost — development loop', () => {
  const savedDev = config.modules.dev;
  afterAll(() => { config.modules.dev = savedDev; });

  it('finds the build output in dist/, so there is no copy step while developing', () => {
    // A module's own build writes dist/bundle.js. Accepting that layout is what
    // lets SERVER_MODULES_DIR point straight at the overlay.
    const dir = mkdtempSync(join(tmpdir(), 'ay-inplace-'));
    mkdirSync(join(dir, 'inplace', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'inplace', 'manifest.json'), JSON.stringify({
      id: 'inplace', global: 'inplace', name: 'In place',
      version: '1.0.0', engine: '^1.0.0', runtime: 'client',
    }));
    writeFileSync(join(dir, 'inplace', 'dist', 'bundle.js'), 'export default () => ({ setArchiyou(){} });');

    const host = new ModuleHost().load(dir);
    expect(host.bundlePath('inplace', '1.0.0')).toMatch(/inplace\/dist\/bundle\.js$/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('changes a module’s revision when it is rebuilt at the same version', async () => {
    const host = new ModuleHost().load(root);
    const before = host.revision('example');

    // Same version, new bytes — exactly what a rebuild looks like. Without a
    // revision nothing downstream could tell this apart from the build it
    // already had, and a reload would keep running the old code.
    await new Promise((r) => setTimeout(r, 1100)); // mtime resolution
    writeFileSync(join(root, 'example', 'bundle.js'), 'export default () => ({ setArchiyou(){}, v: 2 });');

    const after = new ModuleHost().load(root).revision('example');
    expect(after).not.toBe(before);
  }, 10_000);

  it('publishes the revision in dev and withholds it in production', () => {
    config.modules.dev = true;
    expect(new ModuleHost().load(root).catalogFor([])[0].rev).toBeTruthy();

    // In production the version IS the cache key and bundles are immutable;
    // a per-build revision would only defeat that.
    config.modules.dev = false;
    expect(new ModuleHost().load(root).catalogFor([])[0].rev).toBeUndefined();
  });

  it('re-scans when a module changes on disk, with no restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ay-watch-'));
    const host = new ModuleHost().load(dir).watch();
    expect(host.list()).toEqual([]);

    const changed = new Promise<void>((resolve) => { const off = host.onChange(() => { off(); resolve(); }); });

    mkdirSync(join(dir, 'late'), { recursive: true });
    writeFileSync(join(dir, 'late', 'bundle.js'), 'export default () => ({ setArchiyou(){} });');
    writeFileSync(join(dir, 'late', 'manifest.json'), JSON.stringify({
      id: 'late', global: 'late', name: 'Late',
      version: '1.0.0', engine: '^1.0.0', runtime: 'client',
    }));

    await Promise.race([changed, new Promise((r) => setTimeout(r, 4000))]);
    host.close();

    expect(host.list().map((m) => m.id)).toEqual(['late']);
    rmSync(dir, { recursive: true, force: true });
  }, 10_000);
});

describe('ModuleHost — calling a server module', () => {
  it('runs a method in a worker thread and returns its result', async () => {
    const host = new ModuleHost().load(root);
    await expect(host.call('heavy', 'echo', { n: 1 })).resolves.toEqual({ got: { n: 1 } });
  });

  it('refuses to call a client module', async () => {
    const host = new ModuleHost().load(root);
    await expect(host.call('example', 'anything', null)).rejects.toThrow(/cannot be called/);
  });

  it('rejects a method the module does not declare', async () => {
    const host = new ModuleHost().load(root);
    const err = await host.call('heavy', 'notAMethod', null).catch((e) => e);

    expect(err).toBeInstanceOf(ModuleCallError);
    expect(err.kind).toBe('unknown_method');
  });

  it('rejects an inherited property masquerading as a method', async () => {
    const host = new ModuleHost().load(root);
    // `methods.constructor` exists on every object; only own properties count.
    const err = await host.call('heavy', 'constructor', null).catch((e) => e);
    expect(err.kind).toBe('unknown_method');
  });

  it('surfaces an error thrown inside the module', async () => {
    const host = new ModuleHost().load(root);
    await expect(host.call('heavy', 'explode', null)).rejects.toThrow(/module blew up/);
  });

  it('gives a module its own namespaced config and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ay-env-'));
    mkdirSync(join(dir, 'peeker'), { recursive: true });
    writeFileSync(join(dir, 'peeker', 'manifest.json'), JSON.stringify({
      id: 'peeker', global: 'peeker', name: 'Peeker',
      version: '1.0.0', engine: '^1.0.0', runtime: 'server',
    }));
    writeFileSync(join(dir, 'peeker', 'server.js'),
      'export default { methods: { env: async () => process.env } };');

    process.env.PEEKER_SETTING = 'visible';
    process.env.MODULE_SHARED = 'visible';
    process.env.SERVER_JWT_SECRET = 'MUST-NOT-LEAK';
    process.env.OTHER_MODULE_SECRET = 'MUST-NOT-LEAK';

    const seen = await new ModuleHost().load(dir).call('peeker', 'env', null) as Record<string, string>;

    // A module needs its own configuration…
    expect(seen.PEEKER_SETTING).toBe('visible');
    expect(seen.MODULE_SHARED).toBe('visible');
    // …but the API's environment holds the token-signing key and the mail and S3
    // credentials. Module code is trusted, not omniscient.
    expect(seen.SERVER_JWT_SECRET).toBeUndefined();
    expect(seen.OTHER_MODULE_SECRET).toBeUndefined();

    delete process.env.PEEKER_SETTING;
    delete process.env.MODULE_SHARED;
    delete process.env.SERVER_JWT_SECRET;
    delete process.env.OTHER_MODULE_SECRET;
    rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it('kills a module stuck in an infinite synchronous loop', async () => {
    const host = new ModuleHost().load(root);
    config.modules.callTimeoutMs = 700;

    const started = Date.now();
    const err = await host.call('heavy', 'spin', null).catch((e) => e);
    const elapsed = Date.now() - started;

    // The load-bearing assertion for choosing worker threads: `while(true){}`
    // cannot be interrupted by a timer on its own thread, but terminate() ends
    // it from the parent. Without this the API would hang until restarted.
    expect(err).toBeInstanceOf(ModuleCallError);
    expect(err.kind).toBe('timeout');
    expect(elapsed).toBeLessThan(5000);
  }, 15_000);
});
