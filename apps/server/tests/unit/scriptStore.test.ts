/**
 * ScriptStore — library resolution + versioning.
 *
 * The interesting rule under test: ordinary saves inherit a file's `shared`
 * metadata (that is what powers `:dev`), so a shared file keeps an UNVERSIONED
 * working copy in the shared library. "Latest" must still resolve to the newest
 * released version, or the share menu prefills a version that already exists and
 * the next share is rejected by the unique (fileId, version) index.
 *
 * Runs against a throwaway SQLite file (SERVER_DATABASE_FILE is set before the
 * db client module is imported).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

import type { ScriptData, ScriptShared } from '@archiyou/core/src/execution/types';
import type { ScriptStore } from '../../src/services/ScriptStore';

let store: ScriptStore;
let ScriptStoreError: typeof import('../../src/services/ScriptStore').ScriptStoreError;

const AUTHOR = 'tester';

const SHARED: ScriptShared = {
  created: new Date().toISOString(),
  description: 'a shared script',
  licence: 'CC0-1.0',
};

/** Minimal valid ScriptData payload. */
function payload(over: Partial<ScriptData> = {}): Record<string, unknown> {
  return { name: 'thing', code: 'const a = 1;', ...over } as Record<string, unknown>;
}

/** A file with one saved (unversioned) version; returns its fileId. */
function newFile(name = 'thing'): string {
  return store.create(AUTHOR, payload({ name })).fileId as string;
}

beforeAll(async () => {
  process.env.SERVER_DATABASE_FILE = join(mkdtempSync(join(tmpdir(), 'ay-scriptstore-')), 'test.db');
  const { runMigrations } = await import('../../src/db/migrate');
  runMigrations();
  const mod = await import('../../src/services/ScriptStore');
  store = mod.scriptStore;
  ScriptStoreError = mod.ScriptStoreError;
});

describe('ScriptStore sharing', () => {
  it('resolves the latest SHARED script to the released version, not a later working copy', () => {
    const fileId = newFile('latest-release');
    store.share(AUTHOR, fileId, payload({ name: 'latest-release', version: '0.1', shared: SHARED }));
    // An ordinary save after sharing: inherits `shared`, has no version, and is
    // the newest row of the file.
    store.saveVersion(AUTHOR, fileId, payload({ name: 'latest-release', code: 'const a = 2;' }));

    const latest = store.getShared(AUTHOR, 'latest-release');
    expect(latest?.version).toBe('0.1');
    expect(store.getSharedVersions(AUTHOR, 'latest-release')).toEqual(['0.1']);
  });

  it('lists the released version in the shared library, not the working copy', () => {
    const fileId = newFile('listed');
    store.share(AUTHOR, fileId, payload({ name: 'listed', version: '0.1', shared: SHARED }));
    store.saveVersion(AUTHOR, fileId, payload({ name: 'listed' }));

    const listed = store.listSharedPublic().find((s) => s.name === 'listed');
    expect(listed?.version).toBe('0.1');
    expect(store.listSharedByAuthor(AUTHOR).find((s) => s.name === 'listed')?.version).toBe('0.1');
  });

  it('picks the highest released version as latest', () => {
    const fileId = newFile('multi');
    store.share(AUTHOR, fileId, payload({ name: 'multi', version: '0.1', shared: SHARED }));
    store.share(AUTHOR, fileId, payload({ name: 'multi', version: '0.2', shared: SHARED }));

    expect(store.getShared(AUTHOR, 'multi')?.version).toBe('0.2');
    expect(store.getSharedVersions(AUTHOR, 'multi')).toEqual(['0.2', '0.1']);
    expect(store.getShared(AUTHOR, 'multi', '0.1')?.version).toBe('0.1');
  });

  it('still serves the unversioned working copy under :dev', () => {
    const fileId = newFile('devtag');
    store.share(AUTHOR, fileId, payload({ name: 'devtag', version: '0.1', shared: { ...SHARED, dev: true } }));
    store.saveVersion(AUTHOR, fileId, payload({ name: 'devtag', code: 'const a = 3;' }));

    const dev = store.getShared(AUTHOR, 'devtag', 'dev');
    expect(dev?.version).toBeNull();
    expect(dev?.code).toBe('const a = 3;');
  });

  it('rejects re-using a version of the same file (shared or published)', () => {
    const fileId = newFile('collide');
    store.share(AUTHOR, fileId, payload({ name: 'collide', version: '0.1', shared: SHARED }));

    expect(() =>
      store.share(AUTHOR, fileId, payload({ name: 'collide', version: '0.1', shared: SHARED })),
    ).toThrow(/already exists/);

    // Publishing under a version the file already shared collides too — the
    // menus must offer a version taken from the whole file, not one library.
    const err = (() => {
      try {
        store.publish(
          AUTHOR,
          fileId,
          payload({ name: 'collide', version: '0.1', published: { public: true, fulfillments: [] } }),
        );
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ScriptStoreError);
  });

  it('reports every version of a file (both libraries) via listVersions', () => {
    const fileId = newFile('history');
    store.share(AUTHOR, fileId, payload({ name: 'history', version: '0.1', shared: SHARED }));
    store.publish(
      AUTHOR,
      fileId,
      payload({ name: 'history', version: '0.2', published: { public: true, fulfillments: [] } }),
    );

    const versions = store.listVersions(AUTHOR, fileId).map((v) => v.version);
    expect(versions).toContain('0.1');
    expect(versions).toContain('0.2');
    expect(versions).toContain(null); // the initial working copy
  });

  it('falls back to the newest working copy for a file that has no release', () => {
    const fileId = newFile('unreleased');
    store.setShared(AUTHOR, fileId, SHARED);
    store.saveVersion(AUTHOR, fileId, payload({ name: 'unreleased', code: 'const a = 9;' }));

    const latest = store.getShared(AUTHOR, 'unreleased');
    expect(latest?.version).toBeNull();
    expect(latest?.code).toBe('const a = 9;');
  });
});
