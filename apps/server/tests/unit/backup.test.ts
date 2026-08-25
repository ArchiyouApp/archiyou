/**
 * Backup tests.
 *
 * Two properties carry the whole feature, and they get the most attention here:
 *
 *  1. A snapshot of a live WAL-mode database is CONSISTENT — it must contain every
 *     committed row (including rows that exist only in the -wal), none of an open
 *     transaction's uncommitted ones, and no -wal/-shm sidecars of its own.
 *
 *  2. selectPrunable() never deletes something it shouldn't. It is the only
 *     destructive code path in the server, so each of its safety rules is a case.
 *
 * Everything is driven through temp directories and a fake store; nothing here
 * touches S3, the real database, or the network.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BackupTarget } from '../../src/config';
import {
  BackupConfigError,
  backupStem,
  buildArchive,
  buildManifest,
  collectTarget,
  inspectSnapshot,
  normalizePrefix,
  objectKeyFor,
  parseBackupKey,
  resolveTargets,
  runBackup,
  selectPrunable,
  snapshotDatabase,
} from '../../src/services/BackupService';
import type { BackupObject, BackupStore } from '../../src/services/S3Backend';

let ROOT: string;

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'ay-backup-test-'));
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** A directory tree under ROOT, from a { relPath: contents } map. */
function tree(name: string, files: Record<string, string>): string {
  const base = join(ROOT, name);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(base, rel);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, contents);
  }
  mkdirSync(base, { recursive: true });
  return base;
}

const at = (iso: string): Date => new Date(iso);
const obj = (key: string, lastModified: string, size = 100): BackupObject => ({
  key,
  lastModified: new Date(lastModified),
  size,
});

//// TARGET RESOLUTION ////

describe('resolveTargets', () => {
  const probe = (present: Record<string, 'dir' | 'file'>) => (p: string) => {
    const kind = present[p];
    return { exists: kind !== undefined, isDirectory: kind === 'dir' };
  };

  const declared: BackupTarget[] = [
    { name: 'db', path: './data/app.db', kind: 'sqlite' },
    { name: 'thumbnails', path: './data/thumbnails', kind: 'dir', optional: true },
  ];

  const base = '/srv/app';
  const present = { '/srv/app/data/app.db': 'file' as const, '/srv/app/data/thumbnails': 'dir' as const };

  it('resolves relative paths against baseDir and merges the default excludes', () => {
    const { targets } = resolveTargets({ targets: declared, baseDir: base, probe: probe(present) });

    expect(targets.map((t) => t.path)).toEqual(['/srv/app/data/app.db', '/srv/app/data/thumbnails']);
    expect(targets[0].exclude).toContain('-wal');
    expect(targets[0].exclude).toContain('-shm');
  });

  it('appends the global env excludes to every target', () => {
    const { targets } = resolveTargets({
      targets: declared,
      baseDir: base,
      exclude: ['.png'],
      probe: probe(present),
    });
    expect(targets.every((t) => t.exclude.includes('.png'))).toBe(true);
  });

  it('adds SERVER_BACKUP_EXTRA_PATHS targets, inferring the kind from disk', () => {
    const { targets } = resolveTargets({
      targets: declared,
      extraPaths: 'uploads:./data/uploads, license:/etc/ay.license',
      baseDir: base,
      probe: probe({ ...present, '/srv/app/data/uploads': 'dir', '/etc/ay.license': 'file' }),
    });

    expect(targets.map((t) => t.name)).toEqual(['db', 'thumbnails', 'uploads', 'license']);
    expect(targets.find((t) => t.name === 'uploads')?.kind).toBe('dir');
    expect(targets.find((t) => t.name === 'license')?.kind).toBe('file');
    expect(targets.find((t) => t.name === 'license')?.path).toBe('/etc/ay.license');
  });

  it('splits an extra path on the FIRST colon, so the path may contain more', () => {
    const { targets } = resolveTargets({
      targets: [],
      extraPaths: 'weird:/srv/a:b',
      baseDir: base,
      probe: probe({ '/srv/a:b': 'dir' }),
    });
    expect(targets[0]).toMatchObject({ name: 'weird', path: '/srv/a:b' });
  });

  it.each(['uploads', ':./data/uploads', 'uploads:'])('rejects the malformed extra path %j', (entry) => {
    expect(() =>
      resolveTargets({ targets: [], extraPaths: entry, baseDir: base, probe: probe(present) }),
    ).toThrow(BackupConfigError);
  });

  it('rejects a name that would not be a usable directory in the archive', () => {
    expect(() =>
      resolveTargets({
        targets: [{ name: 'a/b', path: './x', kind: 'dir' }],
        baseDir: base,
        probe: probe({ '/srv/app/x': 'dir' }),
      }),
    ).toThrow(/must match/);
  });

  it('rejects duplicate names', () => {
    expect(() =>
      resolveTargets({
        targets: declared,
        extraPaths: 'db:./elsewhere',
        baseDir: base,
        probe: probe({ ...present, '/srv/app/elsewhere': 'dir' }),
      }),
    ).toThrow(/Duplicate backup target name "db"/);
  });

  it('rejects overlapping targets, which would archive the same bytes twice', () => {
    expect(() =>
      resolveTargets({
        targets: declared,
        extraPaths: 'everything:./data',
        baseDir: base,
        probe: probe({ ...present, '/srv/app/data': 'dir' }),
      }),
    ).toThrow(/contains/);
  });

  it('rejects two targets pointing at the same path', () => {
    expect(() =>
      resolveTargets({
        targets: [{ name: 'a', path: './data/thumbnails', kind: 'dir' }],
        extraPaths: 'b:./data/thumbnails',
        baseDir: base,
        probe: probe(present),
      }),
    ).toThrow(/same path/);
  });

  it('fails when a REQUIRED target is missing', () => {
    expect(() =>
      resolveTargets({ targets: declared, baseDir: base, probe: probe({ '/srv/app/data/thumbnails': 'dir' }) }),
    ).toThrow(/required but its source does not exist/);
  });

  it('warns but continues when an OPTIONAL target is missing', () => {
    const { targets, warnings } = resolveTargets({
      targets: declared,
      baseDir: base,
      probe: probe({ '/srv/app/data/app.db': 'file' }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/thumbnails/);
    expect(targets.find((t) => t.name === 'thumbnails')?.present).toBe(false);
  });

  it('fails when a declared kind contradicts what is on disk', () => {
    expect(() =>
      resolveTargets({
        targets: [{ name: 'thumbnails', path: './data/thumbnails', kind: 'file' }],
        baseDir: base,
        probe: probe(present),
      }),
    ).toThrow(/is a directory/);
  });

  it('honours --skip and --only, and rejects a name that is neither', () => {
    const skipped = resolveTargets({ targets: declared, skip: ['thumbnails'], baseDir: base, probe: probe(present) });
    expect(skipped.targets.map((t) => t.name)).toEqual(['db']);

    const only = resolveTargets({ targets: declared, only: ['thumbnails'], baseDir: base, probe: probe(present) });
    expect(only.targets.map((t) => t.name)).toEqual(['thumbnails']);

    // --only wins over --skip rather than producing an empty archive by accident.
    const both = resolveTargets({
      targets: declared,
      only: ['db'],
      skip: ['db'],
      baseDir: base,
      probe: probe(present),
    });
    expect(both.targets.map((t) => t.name)).toEqual(['db']);

    expect(() => resolveTargets({ targets: declared, skip: ['nope'], baseDir: base, probe: probe(present) })).toThrow(
      /Unknown backup target "nope"/,
    );
  });

  it('refuses to produce an empty target set', () => {
    expect(() =>
      resolveTargets({ targets: declared, skip: ['db', 'thumbnails'], baseDir: base, probe: probe(present) }),
    ).toThrow(/No backup targets selected/);
  });
});

//// KEY NAMING ////

describe('key naming', () => {
  it('stamps UTC, never local time', () => {
    // 01:30 UTC is the previous day in UTC-8 — a local formatter would disagree.
    expect(backupStem(at('2026-08-06T01:30:00.000Z'))).toBe('archiyou-20260806-013000');
    expect(backupStem(at('2026-01-01T00:00:00.000Z'))).toBe('archiyou-20260101-000000');
  });

  it('sorts lexically in chronological order', () => {
    const keys = [
      objectKeyFor(at('2026-08-06T03:15:00Z'), ''),
      objectKeyFor(at('2025-12-31T23:59:59Z'), ''),
      objectKeyFor(at('2026-08-06T03:14:59Z'), ''),
    ];
    expect([...keys].sort()).toEqual([keys[1], keys[2], keys[0]]);
  });

  it.each([
    ['', ''],
    ['prod', 'prod'],
    ['/prod/', 'prod'],
    ['archiyou//prod/', 'archiyou/prod'],
    ['  ', ''],
  ])('normalizes the prefix %j to %j', (input, expected) => {
    expect(normalizePrefix(input)).toBe(expected);
  });

  it('rejects a traversing prefix', () => {
    expect(() => normalizePrefix('a/../b')).toThrow(BackupConfigError);
  });

  it('builds a full key under a prefix', () => {
    expect(objectKeyFor(at('2026-08-06T03:15:00Z'), '/archiyou/prod/')).toBe(
      'archiyou/prod/archiyou-20260806-031500.tar.gz',
    );
  });
});

describe('parseBackupKey', () => {
  it('round-trips a key it produced', () => {
    const now = at('2026-08-06T03:15:00.000Z');
    expect(parseBackupKey(objectKeyFor(now, 'prod'), 'prod')?.toISOString()).toBe(now.toISOString());
  });

  it.each([
    ['prod/notes.tar.gz', 'a foreign object'],
    ['prod/archiyou-2026-08-06.tar.gz', 'a differently formatted stamp'],
    ['prod/archiyou-20260806-031500.tar.gz.bak', 'a suffixed copy'],
    ['prod/archiyou-20260806-031500.tgz', 'the wrong extension'],
    ['prod/nested/archiyou-20260806-031500.tar.gz', 'a key in a deeper directory'],
    ['other/archiyou-20260806-031500.tar.gz', 'another instance under a different prefix'],
    ['prod/archiyou-20260231-031500.tar.gz', 'an impossible date that Date.UTC would roll over'],
    ['prod/archiyou-20261301-031500.tar.gz', 'an impossible month'],
    ['prod/backup-20260806-031500.tar.gz', 'a different filename stem'],
  ])('returns null for %j — %s', (key) => {
    expect(parseBackupKey(key, 'prod')).toBeNull();
  });
});

//// PRUNING — the destructive path ////

describe('selectPrunable', () => {
  const NOW = at('2026-08-06T03:15:00Z');
  const defaults = { prefix: 'prod', keepDays: 30, minKeep: 3, maxDelete: 100, now: NOW };

  /** N archives, one per day, ending `endDaysAgo` days before NOW. */
  const series = (count: number, endDaysAgo = 0): BackupObject[] =>
    Array.from({ length: count }, (_, i) => {
      const d = new Date(NOW.getTime() - (endDaysAgo + count - 1 - i) * 86_400_000);
      return { key: objectKeyFor(d, 'prod'), lastModified: d, size: 1000 };
    });

  it('prunes nothing when everything is inside the retention window', () => {
    const objects = series(10);
    const d = selectPrunable({ ...defaults, objects });
    expect(d.prune).toHaveLength(0);
    expect(d.keep).toHaveLength(10);
  });

  it('prunes only what is older than keepDays', () => {
    const objects = series(40); // 40 daily archives, the oldest 39 days back
    const d = selectPrunable({ ...defaults, objects });

    expect(d.prune.length).toBe(9);
    expect(d.keep.length).toBe(31);
    // Oldest first, so a maxDelete cap always drops the oldest.
    expect(d.prune[0].key < d.prune[d.prune.length - 1].key).toBe(true);
  });

  it('NEVER passes a non-matching key to a delete — rule 1', () => {
    const objects = [
      ...series(40),
      obj('prod/customer-invoices.zip', '2020-01-01T00:00:00Z'),
      obj('prod/notes.txt', '2019-01-01T00:00:00Z'),
      obj('prod/archiyou-20200101-000000.tar.gz.bak', '2020-01-01T00:00:00Z'),
      obj('prod/nested/archiyou-20200101-000000.tar.gz', '2020-01-01T00:00:00Z'),
    ];

    const d = selectPrunable({ ...defaults, objects });

    expect(d.ignored).toHaveLength(4);
    expect(d.prune.some((o) => d.ignored.includes(o.key))).toBe(false);
    // Every one of them is far older than keepDays, and none is touched.
    expect(d.prune.every((o) => o.key.endsWith('.tar.gz') && o.key.startsWith('prod/archiyou-'))).toBe(true);
  });

  it('keeps the newest minKeep however old everything is — rule 4', () => {
    const objects = series(10, 400); // all ~400 days old
    const d = selectPrunable({ ...defaults, objects, minKeep: 3 });

    expect(d.keep).toHaveLength(3);
    expect(d.prune).toHaveLength(7);
    expect(d.keep.map((o) => o.key)).toEqual(objects.slice(-3).map((o) => o.key));
  });

  it('refuses to empty the prefix even with minKeep 0 — rule 5', () => {
    const objects = series(5, 400);
    const d = selectPrunable({ ...defaults, objects, minKeep: 0 });

    expect(d.prune).toHaveLength(0);
    expect(d.keep).toHaveLength(5);
    expect(d.reason).toMatch(/refusing to prune/);
  });

  it('survives a host clock that is wrong by years', () => {
    // Clock jumped forward a decade: every archive looks ancient.
    const d = selectPrunable({ ...defaults, objects: series(6), now: at('2036-08-06T03:15:00Z') });
    expect(d.keep).toHaveLength(3);
    expect(d.prune).toHaveLength(3);
  });

  it('keeps an old-looking archive that was written recently — rule 3', () => {
    // A restored or re-uploaded copy: the name is a year old, the object is not.
    const restored = obj('prod/archiyou-20250101-000000.tar.gz', '2026-08-06T02:00:00Z');
    const d = selectPrunable({ ...defaults, objects: [...series(40), restored] });

    expect(d.prune.map((o) => o.key)).not.toContain(restored.key);
    expect(d.keep.map((o) => o.key)).toContain(restored.key);
  });

  it('never prunes protectKey — rule 6', () => {
    const objects = series(40, 100); // all old
    const protectKey = objects[0].key; // the oldest, so otherwise first to go
    const d = selectPrunable({ ...defaults, objects, protectKey });

    expect(d.prune.map((o) => o.key)).not.toContain(protectKey);
    expect(d.keep.map((o) => o.key)).toContain(protectKey);
  });

  it('caps deletions at maxDelete and says what it left behind — rule 7', () => {
    const d = selectPrunable({ ...defaults, objects: series(60, 400), maxDelete: 10 });

    expect(d.prune).toHaveLength(10);
    expect(d.reason).toMatch(/over the 10\/run cap/);
    // The 10 oldest.
    expect(d.prune.map((o) => o.key)).toEqual(series(60, 400).slice(0, 10).map((o) => o.key));
  });

  it('handles an empty bucket', () => {
    const d = selectPrunable({ ...defaults, objects: [] });
    expect(d.prune).toHaveLength(0);
    expect(d.reason).toMatch(/no archives/);
  });

  it('ignores another instance sharing the bucket under a different prefix', () => {
    const mine = series(40);
    const theirs = mine.map((o) => ({ ...o, key: o.key.replace('prod/', 'staging/') }));
    const d = selectPrunable({ ...defaults, objects: [...mine, ...theirs] });

    expect(d.prune.every((o) => o.key.startsWith('prod/'))).toBe(true);
    expect(d.ignored.every((k) => k.startsWith('staging/'))).toBe(true);
  });
});

//// SNAPSHOT CONSISTENCY ////

describe('snapshotDatabase', () => {
  it('captures committed WAL state, excludes an open transaction, and leaves no sidecars', async () => {
    const dir = join(ROOT, 'sqlite');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'live.db');

    // A live, WAL-mode database — writes stay in -wal until a checkpoint.
    const live = new Database(dbPath);
    live.pragma('journal_mode = WAL');
    live.exec('create table notes (id integer primary key, body text)');
    const insert = live.prepare('insert into notes (body) values (?)');
    for (let i = 0; i < 500; i++) insert.run(`committed ${i}`);

    // This is the whole point: most of the state is NOT in the .db file.
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    // A second connection holding an open write transaction while we snapshot.
    const writer = new Database(dbPath);
    writer.exec('begin immediate');
    writer.prepare('insert into notes (body) values (?)').run('UNCOMMITTED');

    const snapPath = join(dir, 'snap.db');
    await snapshotDatabase(dbPath, snapPath);

    writer.exec('rollback');
    writer.close();
    live.close();

    // Standalone the moment it is written — a stale sidecar next to a restored
    // file is how a restore becomes a second incident.
    expect(existsSync(`${snapPath}-wal`)).toBe(false);
    expect(existsSync(`${snapPath}-shm`)).toBe(false);

    const snap = new Database(snapPath, { readonly: true });
    expect(snap.pragma('integrity_check', { simple: true })).toBe('ok');
    expect((snap.prepare('select count(*) as n from notes').get() as { n: number }).n).toBe(500);
    expect(snap.prepare(`select 1 from notes where body = 'UNCOMMITTED'`).get()).toBeUndefined();
    snap.close();

    // ...and still standalone after being opened. A WAL-mode copy would have grown
    // sidecars just from that read, which is what makes archiving only the .db a
    // silent data-loss bug rather than an obvious one.
    expect(existsSync(`${snapPath}-wal`)).toBe(false);
    expect(existsSync(`${snapPath}-shm`)).toBe(false);
  });

  it('proves the .db alone is complete, isolated from any sidecar', async () => {
    const dir = join(ROOT, 'sqlite-isolated');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'live.db');

    const live = new Database(dbPath);
    live.pragma('journal_mode = WAL');
    live.exec('create table t (id integer primary key)');
    for (let i = 0; i < 2000; i++) live.exec('insert into t default values');
    // Uncheckpointed: most of this state is in -wal, not in the .db file.
    expect(existsSync(`${dbPath}-wal`)).toBe(true);

    const snapPath = join(dir, 'snap.db');
    await snapshotDatabase(dbPath, snapPath);
    live.close();

    // Move the snapshot somewhere else entirely, leaving anything beside it behind.
    const isolated = join(dir, 'isolated.db');
    copyFileSync(snapPath, isolated);
    const iso = new Database(isolated, { readonly: true });
    expect((iso.prepare('select count(*) as n from t').get() as { n: number }).n).toBe(2000);
    iso.close();
  });

  it('fails loudly rather than creating an empty database at a mistyped path', async () => {
    await expect(snapshotDatabase(join(ROOT, 'does-not-exist.db'), join(ROOT, 'out.db'))).rejects.toThrow(
      /SQLite snapshot .* failed/,
    );
    expect(existsSync(join(ROOT, 'out.db'))).toBe(false);
  });

  it('reports migrations and row counts from the snapshot', async () => {
    const dir = join(ROOT, 'sqlite-stats');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'live.db');

    const live = new Database(dbPath);
    live.exec('create table users (id integer primary key)');
    live.exec('create table __drizzle_migrations (id integer primary key, hash text, created_at integer)');
    live.exec(`insert into __drizzle_migrations (hash, created_at) values ('a', 100), ('b', 200)`);
    live.exec('insert into users default values');
    live.close();

    const snapPath = join(dir, 'snap.db');
    await snapshotDatabase(dbPath, snapPath);
    const stats = inspectSnapshot(snapPath);

    expect(stats.integrityCheck).toBe('ok');
    expect(stats.migrations).toEqual({ count: 2, latestCreatedAt: 200 });
    expect(stats.rowCounts.users).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });
});

//// ARCHIVE ////

describe('buildArchive', () => {
  /** Entry names inside a tar.gz, via the system tar — archiver can write but not read. */
  const entries = (path: string): string[] =>
    execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

  async function archiveOf(targets: BackupTarget[], baseDir: string, opts: Partial<Parameters<typeof runBackup>[0]> = {}) {
    const { targets: resolved } = resolveTargets({ targets, baseDir });
    const out = join(ROOT, `out-${Math.abs(hash(JSON.stringify([targets, opts.only, opts.skip])))}.tar.gz`);
    const result = await runBackup({
      targets: resolved,
      prefix: 'prod',
      tmpDir: join(ROOT, 'tmp'),
      maxBytes: 1024 * 1024 * 1024,
      prune: false,
      keepDays: 30,
      minKeep: 3,
      maxDelete: 100,
      dry: false,
      out,
      now: at('2026-08-06T03:15:00Z'),
      ...opts,
    });
    return { out, result, entries: entries(out) };
  }

  const hash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

  it('lays out one directory per target under a single timestamped root', async () => {
    const base = tree('archive-basic', {
      'data/thumbnails/mark/f1/v1-abc.svg': '<svg/>',
      'data/thumbnails/mark/f2/v2-def.svg': '<svg/>',
      'data/config.json': '{}',
    });
    const db = join(base, 'data/app.db');
    new Database(db).exec('create table t (id integer)');

    const { entries: got } = await archiveOf(
      [
        { name: 'db', path: db, kind: 'sqlite' },
        { name: 'thumbnails', path: join(base, 'data/thumbnails'), kind: 'dir' },
        { name: 'config', path: join(base, 'data/config.json'), kind: 'file' },
      ],
      base,
    );

    expect(got.sort()).toEqual(
      [
        'archiyou-20260806-031500/MANIFEST.json',
        'archiyou-20260806-031500/db/app.db',
        'archiyou-20260806-031500/thumbnails/mark/f1/v1-abc.svg',
        'archiyou-20260806-031500/thumbnails/mark/f2/v2-def.svg',
        'archiyou-20260806-031500/config/config.json',
      ].sort(),
    );
  });

  it('excludes sqlite sidecars, .bak copies and the scratch dir from a dir target', async () => {
    const base = tree('archive-excludes', {
      'data/keep.svg': '<svg/>',
      'data/app.db': 'x',
      'data/app.db-wal': 'x',
      'data/app.db-shm': 'x',
      'data/app.db.bak.20260707': 'x',
      'data/backup-tmp/run-abc/snap.db': 'x',
      'data/cache/result.json': '{}',
    });

    const { entries: got } = await archiveOf(
      [{ name: 'data', path: join(base, 'data'), kind: 'dir', exclude: ['cache/'] }],
      base,
    );

    expect(got).toContain('archiyou-20260806-031500/data/keep.svg');
    expect(got).toContain('archiyou-20260806-031500/data/app.db');
    expect(got.some((e) => e.includes('-wal') || e.includes('-shm'))).toBe(false);
    expect(got.some((e) => e.includes('.bak'))).toBe(false);
    expect(got.some((e) => e.includes('backup-tmp'))).toBe(false);
    expect(got.some((e) => e.includes('cache/'))).toBe(false);
  });

  it('records what the archive contains in the manifest', async () => {
    const base = tree('archive-manifest', { 'data/thumbnails/a.svg': '<svg/>' });
    const db = join(base, 'data/app.db');
    const live = new Database(db);
    live.exec('create table users (id integer primary key)');
    live.exec('insert into users default values');
    live.close();

    const { result } = await archiveOf(
      [
        { name: 'db', path: db, kind: 'sqlite' },
        { name: 'thumbnails', path: join(base, 'data/thumbnails'), kind: 'dir' },
      ],
      base,
    );

    expect(result.manifest.stem).toBe('archiyou-20260806-031500');
    expect(result.manifest.createdAt).toBe('2026-08-06T03:15:00.000Z');
    const dbEntry = result.manifest.targets.find((t) => t.name === 'db');
    expect(dbEntry).toMatchObject({ kind: 'sqlite', files: 1, integrityCheck: 'ok' });
    expect(dbEntry?.rowCounts?.users).toBe(1);
    expect(result.manifest.targets.find((t) => t.name === 'thumbnails')).toMatchObject({ kind: 'dir', files: 1 });
  });

  it('omits a target dropped with --skip', async () => {
    const base = tree('archive-skip', { 'data/thumbnails/a.svg': '<svg/>', 'data/other/b.txt': 'b' });
    const { targets } = resolveTargets({
      targets: [
        { name: 'thumbnails', path: join(base, 'data/thumbnails'), kind: 'dir' },
        { name: 'other', path: join(base, 'data/other'), kind: 'dir' },
      ],
      skip: ['other'],
      baseDir: base,
    });

    const out = join(ROOT, 'out-skip.tar.gz');
    await runBackup({
      targets,
      prefix: '',
      tmpDir: join(ROOT, 'tmp'),
      maxBytes: 1e9,
      prune: false,
      keepDays: 30,
      minKeep: 3,
      maxDelete: 100,
      dry: false,
      out,
      now: at('2026-08-06T03:15:00Z'),
    });

    const got = entries(out);
    expect(got.some((e) => e.includes('/thumbnails/'))).toBe(true);
    expect(got.some((e) => e.includes('/other/'))).toBe(false);
  });

  it('aborts and names the offending target when the size ceiling is exceeded', async () => {
    const base = tree('archive-toobig', { 'data/big.bin': 'x'.repeat(50_000) });
    await expect(
      archiveOf([{ name: 'big', path: join(base, 'data'), kind: 'dir' }], base, { maxBytes: 1000 }),
    ).rejects.toThrow(/over the .* ceiling.*"big"/s);
  });

  it('carries an optional missing target through as skipped rather than failing', async () => {
    const base = tree('archive-optional', { 'data/thumbnails/a.svg': '<svg/>' });
    const { result, entries: got } = await archiveOf(
      [
        { name: 'thumbnails', path: join(base, 'data/thumbnails'), kind: 'dir' },
        { name: 'uploads', path: join(base, 'data/uploads'), kind: 'dir', optional: true },
      ],
      base,
    );

    expect(result.manifest.targets.find((t) => t.name === 'uploads')).toMatchObject({ skipped: true, files: 0 });
    expect(got.some((e) => e.includes('/uploads/'))).toBe(false);
  });
});

//// UPLOAD + PRUNE ORCHESTRATION ////

describe('runBackup upload and prune ordering', () => {
  const NOW = at('2026-08-06T03:15:00Z');

  function fakeStore(overrides: Partial<BackupStore> & { objects?: BackupObject[] } = {}) {
    const calls = { put: [] as string[], remove: [] as string[][], list: 0 };
    const objects = overrides.objects ?? [];
    const store: BackupStore = {
      async list() {
        calls.list++;
        return objects;
      },
      async put(key, body) {
        calls.put.push(key);
        // Drain, so a real archive stream completes as it would against S3.
        await new Promise<void>((res, rej) => {
          (body as Readable).on('error', rej).on('end', () => res()).resume();
        });
      },
      async remove(keys) {
        calls.remove.push(keys);
      },
      ...overrides,
    };
    return { store, calls };
  }

  async function run(store: BackupStore, opts: Partial<Parameters<typeof runBackup>[0]> = {}) {
    const base = tree(`run-${Math.random().toString(36).slice(2)}`, { 'data/a.svg': '<svg/>' });
    const { targets } = resolveTargets({
      targets: [{ name: 'thumbnails', path: join(base, 'data'), kind: 'dir' }],
      baseDir: base,
    });
    return runBackup({
      targets,
      store,
      prefix: 'prod',
      tmpDir: join(ROOT, 'tmp'),
      maxBytes: 1e9,
      prune: true,
      keepDays: 30,
      minKeep: 3,
      maxDelete: 100,
      dry: false,
      now: NOW,
      ...opts,
    });
  }

  it('uploads under the expected key, then prunes', async () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      obj(objectKeyFor(new Date(NOW.getTime() - (40 - i) * 86_400_000), 'prod'), '2026-01-01T00:00:00Z'));
    const { store, calls } = fakeStore({ objects: old });

    const result = await run(store);

    expect(calls.put).toEqual(['prod/archiyou-20260806-031500.tar.gz']);
    expect(result.key).toBe('prod/archiyou-20260806-031500.tar.gz');
    expect(calls.remove).toHaveLength(1);
    expect(result.pruned).toBeGreaterThan(0);
    expect(result.pruneError).toBeUndefined();
  });

  it('does NOT prune when the upload fails — a silently failing backup must not age out good copies', async () => {
    const { store, calls } = fakeStore({
      objects: [obj(objectKeyFor(at('2020-01-01T00:00:00Z'), 'prod'), '2020-01-01T00:00:00Z')],
      put: async () => {
        throw new Error('network went away');
      },
    });

    await expect(run(store)).rejects.toThrow(/network went away/);
    expect(calls.remove).toHaveLength(0);
    expect(calls.list).toBe(0);
  });

  it('reports a prune failure separately, so the caller can exit 3 rather than 1', async () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      obj(objectKeyFor(new Date(NOW.getTime() - (40 - i) * 86_400_000), 'prod'), '2026-01-01T00:00:00Z'));
    const { store, calls } = fakeStore({
      objects: old,
      remove: async () => {
        throw new Error('AccessDenied');
      },
    });

    const result = await run(store);

    expect(calls.put).toHaveLength(1); // the archive is safely uploaded...
    expect(result.pruneError?.name).toBe('PruneFailure'); // ...only housekeeping broke
    expect(result.pruneError?.message).toMatch(/AccessDenied/);
    expect(result.pruned).toBe(0);
  });

  it('skips prune entirely when disabled', async () => {
    const { store, calls } = fakeStore();
    await run(store, { prune: false });
    expect(calls.list).toBe(0);
    expect(calls.remove).toHaveLength(0);
  });

  it('a dry run neither uploads nor deletes, but still reports a real size and prune decision', async () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      obj(objectKeyFor(new Date(NOW.getTime() - (40 - i) * 86_400_000), 'prod'), '2026-01-01T00:00:00Z'));
    const { store, calls } = fakeStore({ objects: old });

    const result = await run(store, { dry: true });

    expect(calls.put).toHaveLength(0);
    expect(calls.remove).toHaveLength(0);
    expect(calls.list).toBe(1); // still validates credentials, read-only
    expect(result.uploadedBytes).toBeGreaterThan(0);
    expect(result.prune?.prune.length).toBeGreaterThan(0);
    expect(result.pruned).toBe(0);
  });

  it('leaves no scratch directory behind', async () => {
    const { store } = fakeStore();
    await run(store);
    const tmp = join(ROOT, 'tmp');
    const leftovers = existsSync(tmp)
      ? execFileSync('find', [tmp, '-maxdepth', '1', '-name', 'run-*'], { encoding: 'utf8' }).trim()
      : '';
    expect(leftovers).toBe('');
  });
});

//// MANIFEST + ARCHIVE UNIT ////

describe('buildManifest', () => {
  it('totals bytes across targets and records skipped ones', () => {
    const manifest = buildManifest(
      [
        {
          target: { name: 'db', kind: 'sqlite', path: '/x/app.db', optional: false, exclude: [], present: true },
          files: [{ from: '/tmp/snap.db', to: 'app.db', bytes: 300 }],
          bytes: 300,
          sqlite: { integrityCheck: 'ok', migrations: { count: 4, latestCreatedAt: 9 }, rowCounts: { users: 2 }, bytes: 300 },
          skipped: false,
        },
        {
          target: { name: 'uploads', kind: 'dir', path: '/x/uploads', optional: true, exclude: [], present: false },
          files: [],
          bytes: 0,
          skipped: true,
        },
      ],
      at('2026-08-06T03:15:00Z'),
      '3.53.2',
    );

    expect(manifest.totalBytes).toBe(300);
    expect(manifest.sqliteVersion).toBe('3.53.2');
    expect(manifest.targets[0].migrations).toEqual({ count: 4, latestCreatedAt: 9 });
    expect(manifest.targets[1].skipped).toBe(true);
  });
});

describe('buildArchive stream', () => {
  it('emits a gzip stream (magic bytes 1f 8b)', async () => {
    const manifest = buildManifest([], at('2026-08-06T03:15:00Z'), '3.53.2');
    const stream = buildArchive([], manifest);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const head = Buffer.concat(chunks).subarray(0, 2);
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);
  });
});

//// collectTarget ////

describe('collectTarget', () => {
  it('archives the SNAPSHOT of a sqlite target, never the live file', async () => {
    const base = tree('collect-sqlite', {});
    const dbPath = join(base, 'live.db');
    const live = new Database(dbPath);
    live.pragma('journal_mode = WAL');
    live.exec('create table t (id integer primary key)');
    for (let i = 0; i < 200; i++) live.exec('insert into t default values');

    const tmp = join(ROOT, 'collect-tmp');
    mkdirSync(tmp, { recursive: true });

    const { targets } = resolveTargets({ targets: [{ name: 'db', path: dbPath, kind: 'sqlite' }], baseDir: base });
    const collected = await collectTarget(targets[0], tmp);
    live.close();

    expect(collected.files).toHaveLength(1);
    expect(collected.files[0].from).not.toBe(dbPath); // the snapshot, not the live file
    expect(collected.files[0].from.startsWith(tmp)).toBe(true);
    expect(collected.files[0].to).toBe('live.db'); // but named as the original inside the archive
    expect(collected.sqlite?.rowCounts.t).toBe(200);
  });
});
