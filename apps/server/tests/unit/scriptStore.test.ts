/**
 * ScriptStore — library resolution + versioning.
 *
 * The interesting rule under test: ordinary saves inherit a file's `shared`
 * metadata (that is what powers `:dev`), so a shared file keeps an UNVERSIONED
 * working copy in the shared library. "Latest" must still resolve to the newest
 * released version, or the share menu prefills a version that already exists and
 * the next share is rejected by the unique (fileId, version) index.
 *
 * Runs against a throwaway in-process PGlite database (SERVER_DATABASE_URL is set
 * to memory:// before the db client module is imported).
 */

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
async function newFile(name = 'thing'): Promise<string> {
  return (await store.create(AUTHOR, payload({ name }))).fileId as string;
}

beforeAll(async () => {
  // A fresh, empty PGlite database in this process — Postgres, same schema and
  // migrations as the server, nothing to install. Set explicitly (never left to a
  // developer's .env) so the suite can never reach a shared database.
  process.env.SERVER_DATABASE_URL = 'memory://';
  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  const mod = await import('../../src/services/ScriptStore');
  store = mod.scriptStore;
  ScriptStoreError = mod.ScriptStoreError;
});

describe('ScriptStore sharing', () => {
  it('resolves the latest SHARED script to the released version, not a later working copy', async () => {
    const fileId = await newFile('latest-release');
    await store.share(AUTHOR, fileId, payload({ name: 'latest-release', version: '0.1', shared: SHARED }));
    // An ordinary save after sharing: inherits `shared`, has no version, and is
    // the newest row of the file.
    await store.saveVersion(AUTHOR, fileId, payload({ name: 'latest-release', code: 'const a = 2;' }));

    const latest = await store.getShared(AUTHOR, 'latest-release');
    expect(latest?.version).toBe('0.1');
    expect(await store.getSharedVersions(AUTHOR, 'latest-release')).toEqual(['0.1']);
  });

  it('lists the released version in the shared library, not the working copy', async () => {
    const fileId = await newFile('listed');
    await store.share(AUTHOR, fileId, payload({ name: 'listed', version: '0.1', shared: SHARED }));
    await store.saveVersion(AUTHOR, fileId, payload({ name: 'listed' }));

    const listed = (await store.listSharedPublic()).find((s) => s.name === 'listed');
    expect(listed?.version).toBe('0.1');
    expect((await store.listSharedByAuthor(AUTHOR)).find((s) => s.name === 'listed')?.version).toBe('0.1');
  });

  it('picks the highest released version as latest', async () => {
    const fileId = await newFile('multi');
    await store.share(AUTHOR, fileId, payload({ name: 'multi', version: '0.1', shared: SHARED }));
    await store.share(AUTHOR, fileId, payload({ name: 'multi', version: '0.2', shared: SHARED }));

    expect((await store.getShared(AUTHOR, 'multi'))?.version).toBe('0.2');
    expect(await store.getSharedVersions(AUTHOR, 'multi')).toEqual(['0.2', '0.1']);
    expect((await store.getShared(AUTHOR, 'multi', '0.1'))?.version).toBe('0.1');
  });

  it('still serves the unversioned working copy under :dev', async () => {
    const fileId = await newFile('devtag');
    await store.share(AUTHOR, fileId, payload({ name: 'devtag', version: '0.1', shared: { ...SHARED, dev: true } }));
    await store.saveVersion(AUTHOR, fileId, payload({ name: 'devtag', code: 'const a = 3;' }));

    const dev = await store.getShared(AUTHOR, 'devtag', 'dev');
    expect(dev?.version).toBeNull();
    expect(dev?.code).toBe('const a = 3;');
  });

  it('rejects re-using a version of the same file (shared or published)', async () => {
    const fileId = await newFile('collide');
    await store.share(AUTHOR, fileId, payload({ name: 'collide', version: '0.1', shared: SHARED }));

    await expect(
      store.share(AUTHOR, fileId, payload({ name: 'collide', version: '0.1', shared: SHARED })),
    ).rejects.toThrow(/already exists/);

    // Publishing under a version the file already shared collides too — the
    // menus must offer a version taken from the whole file, not one library.
    const err = await store
      .publish(
        AUTHOR,
        fileId,
        payload({ name: 'collide', version: '0.1', published: { public: true, fulfillments: [] } }),
      )
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ScriptStoreError);
  });

  it('reports every version of a file (both libraries) via listVersions', async () => {
    const fileId = await newFile('history');
    await store.share(AUTHOR, fileId, payload({ name: 'history', version: '0.1', shared: SHARED }));
    await store.publish(
      AUTHOR,
      fileId,
      payload({ name: 'history', version: '0.2', published: { public: true, fulfillments: [] } }),
    );

    const versions = (await store.listVersions(AUTHOR, fileId)).map((v) => v.version);
    expect(versions).toContain('0.1');
    expect(versions).toContain('0.2');
    expect(versions).toContain(null); // the initial working copy
  });

  it('falls back to the newest working copy for a file that has no release', async () => {
    const fileId = await newFile('unreleased');
    await store.setShared(AUTHOR, fileId, SHARED);
    await store.saveVersion(AUTHOR, fileId, payload({ name: 'unreleased', code: 'const a = 9;' }));

    const latest = await store.getShared(AUTHOR, 'unreleased');
    expect(latest?.version).toBeNull();
    expect(latest?.code).toBe('const a = 9;');
  });
});

/**
 * Scripts are referenced by name ($component('./wall')), so renaming one must not break
 * the scripts that still use its old name: an old name resolves to the latest version
 * of the file that carried it.
 */
describe('ScriptStore rename fallback', () => {
  /** Rows are ordered on a millisecond `updated`; keep consecutive writes distinct. */
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('resolves an old name to the latest version of the renamed file (own scripts)', async () => {
    const fileId = await newFile('oldwall');
    await tick();
    await store.saveVersion(AUTHOR, fileId, payload({ name: 'newwall', code: 'const renamed = 1;' }));

    const byOld = await store.getFileByName(AUTHOR, 'OldWall');
    expect(byOld.fileId).toBe(fileId);
    expect(byOld.name).toBe('newwall');
    expect(byOld.code).toBe('const renamed = 1;');
    expect((await store.getFileByName(AUTHOR, 'newwall')).fileId).toBe(fileId);
  });

  it('prefers a file currently holding the name over one renamed away from it', async () => {
    const renamedId = await newFile('taken');
    await tick();
    await store.saveVersion(AUTHOR, renamedId, payload({ name: 'moved' }));
    await tick();
    const currentId = await newFile('taken');

    expect((await store.getFileByName(AUTHOR, 'taken')).fileId).toBe(currentId);
  });

  it('throws not_found for a name no script ever had', async () => {
    await expect(store.getFileByName(AUTHOR, 'never-existed')).rejects.toThrow(ScriptStoreError);
  });

  it('serves the latest SHARED release of a renamed file under its old name', async () => {
    const fileId = await newFile('oldbeam');
    await tick();
    await store.share(AUTHOR, fileId, payload({ name: 'oldbeam', version: '0.1', shared: SHARED }));
    await tick();
    await store.share(AUTHOR, fileId, payload({ name: 'newbeam', version: '0.2', code: 'const v = 2;', shared: SHARED }));

    const latest = await store.getShared(AUTHOR, 'oldbeam');
    expect(latest?.version).toBe('0.2');
    expect(latest?.name).toBe('newbeam');
    expect((await store.getShared(AUTHOR, 'oldbeam', '0.1'))?.name).toBe('oldbeam');
    expect(await store.getSharedVersions(AUTHOR, 'oldbeam')).toEqual(['0.2', '0.1']);
  });

  it('resolves an old name that was only ever used for unshared working copies', async () => {
    const fileId = await newFile('oldpost');
    await tick();
    await store.share(AUTHOR, fileId, payload({ name: 'newpost', version: '0.1', shared: SHARED }));

    expect((await store.getShared(AUTHOR, 'oldpost'))?.name).toBe('newpost');
  });
});

/**
 * `published.validated` is what opens server-side execution to anonymous callers
 * (routes/execute.ts), so the store — not the client — must own it. The rule has two
 * halves that pull in opposite directions and are easy to get backwards:
 *
 *   INSERT (save/share/publish) always forces it OFF — a new row is new `code` that
 *   nobody has reviewed.
 *   IN-PLACE EDIT preserves it — `code` is untouched there, so a review still stands
 *   and an owner renaming their configurator must not knock it off (nor grant it).
 */
describe('ScriptStore validated flag', () => {
  const PUBLISHED = { public: true, fulfillments: [] };

  /** A published version owned by AUTHOR; returns its row id. */
  async function newPublished(name: string, over: Record<string, unknown> = {}): Promise<string> {
    const fileId = await newFile(name);
    const data = await store.publish(
      AUTHOR,
      fileId,
      payload({ name, version: '0.1', published: { ...PUBLISHED, ...over } }),
    );
    return data.id as string;
  }

  it('ignores a client trying to publish itself as validated', async () => {
    const id = await newPublished('self-validate', { validated: true });
    expect((await store.findVersionById(AUTHOR, id))?.published?.validated).toBe(false);
  });

  it('ignores a client trying to share itself as validated', async () => {
    // share() goes through the same toRow() funnel, so it must be closed too.
    const fileId = await newFile('share-validate');
    const data = await store.share(
      AUTHOR,
      fileId,
      payload({
        name: 'share-validate',
        version: '0.1',
        shared: SHARED,
        published: { ...PUBLISHED, validated: true },
      }),
    );
    expect(data.published?.validated).toBe(false);
  });

  it('reports validated as an explicit false, never undefined', async () => {
    // Callers gate execution on this, so `undefined` vs `false` must not be a
    // distinction any of them has to make.
    const id = await newPublished('explicit-false');
    expect((await store.findVersionById(AUTHOR, id))?.published?.validated).toBe(false);
  });

  it('setValidated turns it on and back off', async () => {
    const id = await newPublished('toggle');
    expect((await store.setValidated(id, true)).published?.validated).toBe(true);
    expect((await store.findVersionById(AUTHOR, id))?.published?.validated).toBe(true);
    expect((await store.setValidated(id, false)).published?.validated).toBe(false);
  });

  it('setValidated does not touch `updated`', async () => {
    // Validating is not a content edit: it must not reshuffle "newest first" ordering.
    const id = await newPublished('no-reorder');
    const before = (await store.findVersionById(AUTHOR, id))?.updated;
    await store.setValidated(id, true);
    expect((await store.findVersionById(AUTHOR, id))?.updated).toBe(before);
  });

  it('setValidated refuses a version that is not published', async () => {
    const fileId = await newFile('unpublished');
    const working = (await store.listVersions(AUTHOR, fileId))[0].id;
    await expect(store.setValidated(working, true)).rejects.toThrow(ScriptStoreError);
  });

  it('preserves validated across an owner metadata edit', async () => {
    const id = await newPublished('metadata-edit');
    await store.setValidated(id, true);
    const edited = await store.updatePublishedVersion(AUTHOR, id, {
      ...PUBLISHED,
      title: 'a new title',
    });
    expect(edited.published?.validated).toBe(true);
  });

  it('an owner cannot clear validated by editing metadata', async () => {
    const id = await newPublished('cannot-clear');
    await store.setValidated(id, true);
    const edited = await store.updatePublishedVersion(AUTHOR, id, { ...PUBLISHED, validated: false });
    expect(edited.published?.validated).toBe(true);
  });

  it('an owner cannot grant validated by editing metadata', async () => {
    const id = await newPublished('cannot-grant');
    const edited = await store.updatePublishedVersion(AUTHOR, id, { ...PUBLISHED, validated: true });
    expect(edited.published?.validated).toBe(false);
  });

  it('a newly published version starts unvalidated even when an earlier one is validated', async () => {
    // The core reason validation is per-version: republishing ships new code.
    const fileId = await newFile('bump');
    const v1 = await store.publish(
      AUTHOR, fileId,
      payload({ name: 'bump', version: '0.1', published: PUBLISHED }),
    );
    await store.setValidated(v1.id as string, true);

    const v2 = await store.publish(
      AUTHOR, fileId,
      payload({ name: 'bump', version: '0.2', code: 'const evil = 1;', published: PUBLISHED }),
    );
    expect(v2.published?.validated).toBe(false);
    expect((await store.findVersionById(AUTHOR, v1.id as string))?.published?.validated).toBe(true);
  });
});

describe('ScriptStore.listPublishedConfigurators', () => {
  const PUBLIC = { public: true, fulfillments: [] };

  it('spans authors and filters on the validated flag', async () => {
    const mine = await store.publish(
      AUTHOR, await newFile('admin-list-a'),
      payload({ name: 'admin-list-a', version: '0.1', published: PUBLIC }),
    );
    await store.create('someoneelse', payload({ name: 'admin-list-b' }));
    await store.setValidated(mine.id as string, true);

    const versionIds = (list: Awaited<ReturnType<ScriptStore['listPublishedConfigurators']>>) =>
      list.configurators.flatMap((c) => c.versions.map((v) => v.id));

    expect(versionIds(await store.listPublishedConfigurators({ validated: true }))).toContain(mine.id);

    const unvalidated = await store.listPublishedConfigurators({ validated: false });
    expect(versionIds(unvalidated)).not.toContain(mine.id);
    // Rows predating the feature have no `validated` key at all; `IS NOT 1` must
    // still count them as unvalidated rather than dropping them from the list.
    expect(unvalidated.total).toBeGreaterThan(0);
  });

  it('groups versions per file, newest version first, and orders files by their latest update', async () => {
    const older = await newFile('admin-group-older');
    await store.publish(AUTHOR, older, payload({ name: 'admin-group-older', version: '0.1', published: PUBLIC }));
    // A minute back, so the order does not hang on two publishes landing in one millisecond
    const { db } = await import('../../src/db/client');
    const { scriptVersions } = await import('../../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(scriptVersions).set({ updated: new Date(Date.now() - 60_000) })
      .where(eq(scriptVersions.fileId, older));

    const grouped = await newFile('admin-group');
    const v1 = await store.publish(AUTHOR, grouped, payload({ name: 'admin-group', version: '0.9', published: PUBLIC }));
    const v2 = await store.publish(AUTHOR, grouped, payload({ name: 'admin-group', version: '0.10', published: PUBLIC }));

    const { configurators } = await store.listPublishedConfigurators({ q: 'admin-group' });
    expect(configurators.map((c) => c.fileId)).toEqual([grouped, older]);
    expect(configurators[0].name).toBe('admin-group');
    expect(configurators[0].versions.map((v) => v.id)).toEqual([v2.id, v1.id]); // semver, not string order
    expect(configurators[0].updated).toBe(v2.updated);
  });

  it('leaves out published rows without a version', async () => {
    const fileId = await newFile('admin-unversioned');
    const { db } = await import('../../src/db/client');
    const { scriptVersions } = await import('../../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(scriptVersions).set({ published: PUBLIC as ScriptData['published'] })
      .where(eq(scriptVersions.fileId, fileId));

    const { configurators } = await store.listPublishedConfigurators({ q: 'admin-unversioned' });
    expect(configurators).toEqual([]);
  });

  it('filters by author and pages by file, with a total independent of the limit', async () => {
    const all = await store.listPublishedConfigurators({ author: AUTHOR });
    expect(all.configurators.length).toBeGreaterThan(1);
    expect(all.total).toBe(all.configurators.length);

    const paged = await store.listPublishedConfigurators({ author: AUTHOR, limit: 1 });
    expect(paged.configurators).toHaveLength(1);
    expect(paged.total).toBe(all.total);

    expect((await store.listPublishedConfigurators({ author: 'nobody' })).total).toBe(0);
  });
});
