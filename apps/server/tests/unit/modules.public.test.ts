/**
 * tests/unit/modules.public.test.ts — public modules and multi-root scanning.
 *
 * Both exist for the same reason: an OPEN-SOURCE script module. The module system was built
 * to gate closed-source capabilities, so it assumed one private directory and an entitlement
 * on every module. A public module lives in its own repository, checked out alongside the
 * private one, and needs no grant.
 *
 * Gating stays the default. Everything here is about the opt-out being explicit and narrow.
 *
 * Modules here are fictional. This repository ships none.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ModuleHost, splitRoots } from '../../src/modules/ModuleHost';

let roots: string[] = [];

function makeRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'ay-modroot-'));
  roots.push(r);
  return r;
}

function install(root: string, id: string, extra: Record<string, unknown> = {}): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id,
    // An id may contain hyphens; a global may not, since it becomes a JavaScript
    // identifier in the script scope.
    global: id.replace(/-/g, '_'),
    name: `${id} module`,
    version: '1.0.0', engine: '^1.0.0', runtime: 'client',
    ...extra,
  }));
  writeFileSync(join(dir, 'bundle.js'), 'export default () => ({ setArchiyou() {} });');
}

beforeEach(() => { roots = []; });
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

describe('public modules', () => {
  it('is entitled for an account holding nothing', () => {
    const root = makeRoot();
    install(root, 'open', { public: true });
    install(root, 'paid');

    const catalog = new ModuleHost().load(root).catalogFor([]);
    expect(catalog.find((m) => m.id === 'open')!.entitled).toBe(true);
    expect(catalog.find((m) => m.id === 'paid')!.entitled).toBe(false);
  });

  it('leaves gating as the default when the flag is absent', () => {
    const root = makeRoot();
    install(root, 'paid');
    expect(new ModuleHost().load(root).catalogFor([]).find((m) => m.id === 'paid')!.entitled).toBe(false);
  });

  it('treats only a literal true as public', () => {
    // A manifest is untrusted input written outside this repository, so 'yes' or 1 must not
    // quietly unlock a module. The schema rejects a non-boolean outright.
    const root = makeRoot();
    install(root, 'sneaky', { public: 'yes' });
    expect(new ModuleHost().load(root).list()).toHaveLength(0);
  });

  it('still refuses a public module whose engine range or name is wrong', () => {
    // Public affects ENTITLEMENT only. Every other guard stands.
    const root = makeRoot();
    install(root, 'mismatch', { public: true, id: 'other' });
    expect(new ModuleHost().load(root).list()).toHaveLength(0);
  });

  it('carries the flag through to the catalog, so the editor can label it', () => {
    const root = makeRoot();
    install(root, 'open', { public: true });
    expect(new ModuleHost().load(root).catalogFor([]).find((m) => m.id === 'open')!.public).toBe(true);
  });
});

describe('multi-root scanning', () => {
  it('loads modules from several roots at once', () => {
    const a = makeRoot(), b = makeRoot();
    install(a, 'private-one');
    install(b, 'open-one', { public: true });

    const ids = new ModuleHost().load(`${a},${b}`).list().map((m) => m.id).sort();
    expect(ids).toEqual(['open-one', 'private-one']);
  });

  it('accepts a colon separator too', () => {
    const a = makeRoot(), b = makeRoot();
    install(a, 'alpha');
    install(b, 'beta');
    expect(new ModuleHost().load(`${a}:${b}`).list()).toHaveLength(2);
  });

  it('lets the first root win a duplicate id', () => {
    // Deliberate: it lets a working tree shadow a deployed copy of the same module.
    const a = makeRoot(), b = makeRoot();
    install(a, 'dup', { name: 'from A' });
    install(b, 'dup', { name: 'from B' });

    const list = new ModuleHost().load(`${a},${b}`).list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('from A');
  });

  it('keeps working when one root does not exist', () => {
    // A checkout the developer has not made yet must not take the others down with it.
    const a = makeRoot();
    install(a, 'alpha');
    expect(new ModuleHost().load(`${a},/nope/does/not/exist`).list()).toHaveLength(1);
  });

  it('stays inert with nothing configured', () => {
    // The property that lets this repository ship with no modules at all.
    const host = new ModuleHost().load('');
    expect(host.list()).toEqual([]);
    expect(host.enabled).toBe(false);
  });
});

describe('splitRoots', () => {
  it('splits on commas and colons, trimming blanks', () => {
    expect(splitRoots('/a, /b ,,/c')).toEqual(['/a', '/b', '/c']);
    expect(splitRoots('/a:/b')).toEqual(['/a', '/b']);
  });

  it('returns nothing for an empty setting', () => {
    expect(splitRoots('')).toEqual([]);
  });

  it('collapses a repeated root', () => {
    // Otherwise a doubled entry warns about an id colliding with itself.
    expect(splitRoots('/a,/a')).toEqual(['/a']);
  });

  it('does not mistake a Windows drive letter for a separator', () => {
    // 'C:/mods' is one path, not 'C' and '/mods'.
    expect(splitRoots('C:/mods')).toHaveLength(1);
    expect(splitRoots('C:/mods,D:/more')).toHaveLength(2);
  });
});
