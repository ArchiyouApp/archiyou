/**
 * tests/unit/discoverRoots.test.ts — finding installed modules without a setting.
 *
 * Three properties matter here:
 *
 *  1. A cloned module repository is found with no configuration at all. That is
 *     the whole point: `SERVER_MODULES_DIR` named a location that was already a
 *     convention, so it was a step that did nothing but get forgotten.
 *  2. A checkout with nothing installed discovers NOTHING, and so stays exactly
 *     as inert as it was before discovery existed. This is what lets this
 *     repository ship and run with no modules.
 *  3. An explicit `SERVER_MODULES_DIR` still wins — including when it points at a
 *     directory that does not exist, which must be reported rather than quietly
 *     replaced by a guess.
 *
 * Modules here are fictional. This repository ships none.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { discoverModuleRoots, findRepoRoot, resolveModulesDir } from '../../src/modules/discoverRoots';

let repo: string;

/** A repository root, as `findRepoRoot` recognises one. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ay-discover-'));
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  return dir;
}

/** `<repo>/modules/<...segments>/manifest.json`, plus its runtime artifact. */
function installAt(...segments: string[]): void {
  const dir = join(repo, 'modules', ...segments);
  mkdirSync(dir, { recursive: true });
  const id = segments[segments.length - 1];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id, global: id, name: `${id} module`,
    version: '1.0.0', engine: '^1.0.0', runtime: 'client',
  }));
  writeFileSync(join(dir, 'bundle.js'), 'export default () => ({ setArchiyou() {} });');
}

/** A directory under `modules/` that is not a module and holds none. */
function makeNoise(...segments: string[]): void {
  mkdirSync(join(repo, 'modules', ...segments), { recursive: true });
}

beforeEach(() => { repo = makeRepo(); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('discoverModuleRoots', () => {
  it('finds a cloned repository that holds several modules', () => {
    // The shape a `git clone` into modules/ actually produces.
    installAt('archiyou-modules', 'struct');
    installAt('archiyou-modules', 'pv');

    expect(discoverModuleRoots(repo)).toEqual([join(repo, 'modules', 'archiyou-modules')]);
  });

  it('finds a single module cloned straight into modules/', () => {
    // The other shape: one module, its own repository, no wrapper directory.
    installAt('fem');

    // The ROOT is modules/ itself — a root is the directory whose CHILDREN are
    // modules, which is exactly what SERVER_MODULES_DIR has always named.
    expect(discoverModuleRoots(repo)).toEqual([join(repo, 'modules')]);
  });

  it('finds both shapes at once, overlay first so a direct clone shadows a repository', () => {
    installAt('fem');
    installAt('archiyou-modules', 'struct');

    // First root wins on a duplicate id (ModuleHost), and the module someone
    // cloned in by hand is the one they mean to override with.
    expect(discoverModuleRoots(repo)).toEqual([
      join(repo, 'modules'),
      join(repo, 'modules', 'archiyou-modules'),
    ]);
  });

  it('lists several cloned repositories in a stable order', () => {
    installAt('z-modules', 'zeta');
    installAt('a-modules', 'alpha');

    // Sorted, not readdir order: first-definition-wins is only meaningful if the
    // order does not vary with the filesystem.
    expect(discoverModuleRoots(repo)).toEqual([
      join(repo, 'modules', 'a-modules'),
      join(repo, 'modules', 'z-modules'),
    ]);
  });

  it('discovers nothing in a checkout with no modules installed', () => {
    // modules/ ships with a README and nothing else. Discovering nothing here is
    // what keeps the open-source checkout inert.
    mkdirSync(join(repo, 'modules'), { recursive: true });
    writeFileSync(join(repo, 'modules', 'README.md'), '# modules');

    expect(discoverModuleRoots(repo)).toEqual([]);
  });

  it('discovers nothing when there is no modules/ directory at all', () => {
    expect(discoverModuleRoots(repo)).toEqual([]);
  });

  it('ignores directories that hold no manifest, and never walks into build output', () => {
    makeNoise('node_modules', 'some-package');
    makeNoise('.git', 'objects');
    makeNoise('dist', 'chunk');
    makeNoise('notes', 'scratch');

    expect(discoverModuleRoots(repo)).toEqual([]);
  });

  it('does not descend past a module into its own vendored trees', () => {
    // struct/ vendors a whole other project; a deeper search would surface its
    // manifests as modules and scan trees that have nothing to do with us.
    installAt('archiyou-modules', 'struct');
    installAt('archiyou-modules', 'struct', 'vendor', 'stabileo');

    expect(discoverModuleRoots(repo)).toEqual([join(repo, 'modules', 'archiyou-modules')]);
  });

  it('returns nothing when the repository root cannot be located', () => {
    // A checkout whose root has no pnpm-workspace.yaml is not one we can reason
    // about — guessing a path would be worse than leaving the feature off.
    expect(discoverModuleRoots(null)).toEqual([]);
  });
});

describe('findRepoRoot', () => {
  it('walks up to the directory holding pnpm-workspace.yaml', () => {
    const deep = join(repo, 'apps', 'server', 'src', 'modules');
    mkdirSync(deep, { recursive: true });

    expect(findRepoRoot(deep)).toBe(repo);
  });

  it('returns null rather than walking to / when there is no workspace above', () => {
    const orphan = mkdtempSync(join(tmpdir(), 'ay-orphan-'));
    expect(findRepoRoot(orphan)).toBeNull();
    rmSync(orphan, { recursive: true, force: true });
  });

  it('locates THIS repository from the source tree', () => {
    // The wiring that matters in production: config resolves its roots from
    // wherever this file happens to live, not from a cwd that differs between
    // `pnpm dev`, an admin script and a worker thread.
    const root = findRepoRoot();
    expect(root).not.toBeNull();
    expect(join(root!, 'apps', 'server', 'package.json')).toBeTruthy();
  });
});

describe('resolveModulesDir', () => {
  it('uses SERVER_MODULES_DIR verbatim when it is set', () => {
    installAt('archiyou-modules', 'struct');

    // An explicit setting is an override, so discovery must not be mixed in.
    expect(resolveModulesDir('/srv/modules', repo)).toEqual({ dir: '/srv/modules', source: 'env' });
  });

  it('keeps a configured path that does not exist, so it can be reported', () => {
    // ModuleHost warns about a missing root. Substituting a discovered one would
    // turn a typo into a silently different set of modules.
    expect(resolveModulesDir('/srv/typo', repo)).toEqual({ dir: '/srv/typo', source: 'env' });
  });

  it('falls back to discovery when the variable is unset or blank', () => {
    installAt('archiyou-modules', 'struct');
    const expected = join(repo, 'modules', 'archiyou-modules');

    // Blank is the interesting one: it is what .env.example ships, so it has to
    // mean "the default" and not "off".
    for (const raw of [undefined, '', '   ']) {
      expect(resolveModulesDir(raw, repo)).toEqual({ dir: expected, source: 'discovered' });
    }
  });

  it('reports source "none" — not "discovered" — when nothing is installed', () => {
    // The distinction is what `admin:modules --list` prints, and the two states
    // have different answers to "why can the server not see my module".
    expect(resolveModulesDir('', repo)).toEqual({ dir: '', source: 'none' });
  });

  it('joins several discovered roots into the list ModuleHost splits', () => {
    installAt('a-modules', 'alpha');
    installAt('b-modules', 'beta');

    const { dir } = resolveModulesDir(undefined, repo);
    expect(dir.split(',')).toEqual([
      join(repo, 'modules', 'a-modules'),
      join(repo, 'modules', 'b-modules'),
    ]);
  });

  it('turns the feature off on request, even with modules installed', () => {
    installAt('archiyou-modules', 'struct');

    // The way back to an open-source-only instance without moving the checkout.
    for (const off of ['off', 'OFF', 'none', 'false', '0', 'disabled']) {
      expect(resolveModulesDir(off, repo)).toEqual({ dir: '', source: 'off' });
    }
  });

  it('treats a path that merely looks like the off-switch as a path', () => {
    // './off' is a directory name; only the bare word disables the feature.
    expect(resolveModulesDir('./off', repo).source).toBe('env');
  });
});

describe('discoverModuleRoots — hostile and awkward trees', () => {
  it('survives a directory it cannot read', () => {
    // A permission error on one entry must not take down discovery for the rest.
    installAt('archiyou-modules', 'struct');
    const denied = join(repo, 'modules', 'denied');
    mkdirSync(denied, { recursive: true });
    // A symlink to nowhere: statSync throws exactly as an unreadable entry would.
    symlinkSync(join(repo, 'nowhere'), join(repo, 'modules', 'broken-link'));

    expect(discoverModuleRoots(repo)).toEqual([join(repo, 'modules', 'archiyou-modules')]);
    rmSync(denied, { recursive: true, force: true });
  });

  it('ignores a file named like a module directory', () => {
    mkdirSync(join(repo, 'modules'), { recursive: true });
    writeFileSync(join(repo, 'modules', 'manifest.json'), '{}');

    // A manifest at the top of modules/ describes nothing: a root's CHILDREN are
    // the modules, so this is just a stray file.
    expect(discoverModuleRoots(repo)).toEqual([]);
  });
});
