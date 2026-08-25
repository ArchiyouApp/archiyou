/**
 * BackupService — off-box backups of the server's durable state.
 *
 * One run produces a single timestamped tar.gz containing every declared backup
 * target (see `backupTargets` in config.ts) and uploads it to S3-compatible
 * storage, then prunes older archives under the same key prefix.
 *
 * Two things here are worth understanding before changing anything:
 *
 *  1. A `sqlite` target is NEVER copied as a file. The database runs in WAL mode,
 *     so at any moment a large share of the committed state lives in `-wal` rather
 *     than the `.db`. We take a consistent snapshot with SQLite's online backup
 *     API, which yields a fully checkpointed standalone file with no sidecars.
 *
 *  2. `selectPrunable()` is the only destructive code in the server. It is pure so
 *     that every one of its safety rules is exhaustively unit-testable, and it is
 *     called only after a successful upload — otherwise a backup that has been
 *     failing silently for weeks would quietly age out the last good copies.
 *
 * The CLI wrapper is src/admin/backup.ts; this module never reads argv, never
 * reads `config`, and never calls process.exit. Errors are typed so the CLI can
 * map them to meaningful exit codes.
 */

import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import archiver from 'archiver';
import Database from 'better-sqlite3';

import type { BackupTarget, BackupTargetKind } from '../config';
import { BACKUP_DEFAULT_EXCLUDES } from '../config';

import type { BackupObject, BackupStore } from './S3Backend';

//// ERRORS ////

/** Bad configuration or unusable targets. Detected before any work — exit 2. */
export class BackupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupConfigError';
  }
}

/** The backup itself failed; no new archive exists — exit 1. */
export class BackupFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackupFailure';
  }
}

/** The archive is safely uploaded but housekeeping broke — exit 3. */
export class PruneFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PruneFailure';
  }
}

//// TARGET RESOLUTION ////

export interface ResolvedTarget {
  name: string;
  kind: BackupTargetKind;
  /** Absolute. */
  path: string;
  optional: boolean;
  /** BACKUP_DEFAULT_EXCLUDES + the target's own + the global env ones. */
  exclude: string[];
  /** False when an optional target's source does not exist; it is reported and skipped. */
  present: boolean;
}

export interface ResolveTargetsInput {
  /** The declared list, normally `backupTargets` from config. */
  targets: BackupTarget[];
  /** SERVER_BACKUP_EXTRA_PATHS — comma-separated `name:path` pairs. */
  extraPaths?: string;
  /** SERVER_BACKUP_SKIP plus anything from `--skip`. */
  skip?: string[];
  /** `--only`; when non-empty, everything else is dropped. */
  only?: string[];
  /** SERVER_BACKUP_EXCLUDE — appended to every target's exclusions. */
  exclude?: string[];
  /** Base for relative paths. apps/server in practice. */
  baseDir: string;
  /** Injected so resolution stays pure and testable. */
  probe?: (absPath: string) => { exists: boolean; isDirectory: boolean };
}

export interface ResolveTargetsResult {
  targets: ResolvedTarget[];
  /** Optional-but-missing targets and other non-fatal notes, for the CLI to print. */
  warnings: string[];
}

const TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function defaultProbe(absPath: string): { exists: boolean; isDirectory: boolean } {
  try {
    return { exists: true, isDirectory: statSync(absPath).isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

/**
 * Turn the declared list plus the env overrides into an ordered set of absolute,
 * validated targets — or throw BackupConfigError explaining exactly what is wrong.
 *
 * Pure apart from `probe`, which is injected. Everything that decides *what ends up
 * in an archive* lives here so it can be table-tested.
 */
export function resolveTargets(input: ResolveTargetsInput): ResolveTargetsResult {
  const { targets, baseDir } = input;
  const probe = input.probe ?? defaultProbe;
  const globalExclude = input.exclude ?? [];
  const warnings: string[] = [];

  const declared: BackupTarget[] = [...targets, ...parseExtraPaths(input.extraPaths ?? '', probe, baseDir)];

  // Names must be usable as a directory inside the archive, and unique.
  const seen = new Map<string, BackupTarget>();
  for (const t of declared) {
    if (!TARGET_NAME.test(t.name)) {
      throw new BackupConfigError(
        `Invalid backup target name "${t.name}" — it becomes a directory inside the archive, so it must match ${TARGET_NAME} (no slashes).`,
      );
    }
    const prev = seen.get(t.name);
    if (prev) {
      throw new BackupConfigError(
        `Duplicate backup target name "${t.name}" (${prev.path} and ${t.path}). Names must be unique — check SERVER_BACKUP_EXTRA_PATHS.`,
      );
    }
    seen.set(t.name, t);
  }

  // --only wins over --skip / SERVER_BACKUP_SKIP; both must name real targets, so a
  // typo is a loud error rather than a silently smaller backup.
  const only = (input.only ?? []).filter(Boolean);
  const skip = (input.skip ?? []).filter(Boolean);
  for (const name of [...only, ...skip]) {
    if (!seen.has(name)) {
      throw new BackupConfigError(
        `Unknown backup target "${name}". Declared targets: ${[...seen.keys()].join(', ') || '(none)'}.`,
      );
    }
  }

  const selected = declared.filter((t) => (only.length ? only.includes(t.name) : !skip.includes(t.name)));
  if (!selected.length) {
    throw new BackupConfigError('No backup targets selected — refusing to upload an empty archive.');
  }

  const resolved: ResolvedTarget[] = [];
  for (const t of selected) {
    const abs = isAbsolute(t.path) ? resolve(t.path) : resolve(baseDir, t.path);
    const { exists, isDirectory } = probe(abs);

    if (!exists) {
      if (!t.optional) {
        throw new BackupConfigError(
          `Backup target "${t.name}" is required but its source does not exist: ${abs}. Fix the path, mark it optional, or add it to SERVER_BACKUP_SKIP.`,
        );
      }
      warnings.push(`target "${t.name}" skipped — nothing at ${abs}`);
      resolved.push({ ...targetDefaults(t), path: abs, exclude: mergeExcludes(t, globalExclude), present: false });
      continue;
    }

    if (t.kind === 'dir' && !isDirectory) {
      throw new BackupConfigError(`Backup target "${t.name}" is declared as a directory but ${abs} is a file.`);
    }
    if (t.kind !== 'dir' && isDirectory) {
      throw new BackupConfigError(`Backup target "${t.name}" is declared as a ${t.kind} but ${abs} is a directory.`);
    }

    resolved.push({ ...targetDefaults(t), path: abs, exclude: mergeExcludes(t, globalExclude), present: true });
  }

  assertNoOverlap(resolved);

  return { targets: resolved, warnings };
}

function targetDefaults(t: BackupTarget): Omit<ResolvedTarget, 'path' | 'exclude' | 'present'> {
  return { name: t.name, kind: t.kind, optional: t.optional === true };
}

function mergeExcludes(t: BackupTarget, global: string[]): string[] {
  return [...new Set([...BACKUP_DEFAULT_EXCLUDES, ...(t.exclude ?? []), ...global])];
}

/**
 * `name:path,name:path` — split on the FIRST colon so absolute Windows-ish or
 * colon-bearing paths survive. Extras are optional by default (they are typically
 * added ahead of the directory existing) and their kind is probed from disk.
 */
function parseExtraPaths(
  raw: string,
  probe: (p: string) => { exists: boolean; isDirectory: boolean },
  baseDir: string,
): BackupTarget[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(':');
      if (colon <= 0 || colon === entry.length - 1) {
        throw new BackupConfigError(
          `Malformed SERVER_BACKUP_EXTRA_PATHS entry "${entry}" — expected "name:path", e.g. "uploads:./data/uploads".`,
        );
      }
      const name = entry.slice(0, colon).trim();
      const path = entry.slice(colon + 1).trim();
      const abs = isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
      const { exists, isDirectory } = probe(abs);
      // A path that isn't there yet is assumed to be a directory — the common case,
      // and `optional` means a wrong guess only ever warns.
      return { name, path, kind: (!exists || isDirectory ? 'dir' : 'file') as BackupTargetKind, optional: true };
    });
}

/**
 * Two targets where one contains the other would put the same bytes in the archive
 * twice under different names — silently doubling every backup. Refuse instead.
 */
function assertNoOverlap(targets: ResolvedTarget[]): void {
  for (const a of targets) {
    for (const b of targets) {
      if (a === b) continue;
      if (a.path === b.path) {
        throw new BackupConfigError(
          `Backup targets "${a.name}" and "${b.name}" point at the same path (${a.path}) — the archive would contain it twice.`,
        );
      }
      if (b.path.startsWith(a.path + sep)) {
        throw new BackupConfigError(
          `Backup target "${a.name}" (${a.path}) contains "${b.name}" (${b.path}) — the archive would contain it twice. Narrow one of them or drop it with SERVER_BACKUP_SKIP.`,
        );
      }
    }
  }
}

//// KEY NAMING ////

/** Fixed, not configurable: the prune matcher keys off it and must be exact. */
const KEY_STEM = 'archiyou';
const KEY_SUFFIX = '.tar.gz';
const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/**
 * `archiyou-YYYYMMDD-HHmmss`, always UTC — a DST-shifted host must not produce two
 * archives with the same name or a name that sorts out of order. Lexical order is
 * chronological order, which is what makes pruning cheap and auditable.
 */
export function backupStem(now: Date): string {
  const iso = now.toISOString();
  return `${KEY_STEM}-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

/** '' | 'a/b' — no leading or trailing slash, no empty or traversing segments. */
export function normalizePrefix(prefix: string): string {
  const parts = prefix.split('/').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (p === '.' || p === '..') {
      throw new BackupConfigError(`Invalid SERVER_BACKUP_S3_PREFIX "${prefix}" — "${p}" is not a usable key segment.`);
    }
  }
  return parts.join('/');
}

export function objectKeyFor(now: Date, prefix: string): string {
  const p = normalizePrefix(prefix);
  return `${p ? `${p}/` : ''}${backupStem(now)}${KEY_SUFFIX}`;
}

/**
 * The instant a key encodes, or null if it is not one of our archives. Everything
 * that returns null here is an object the pruner will never touch.
 */
export function parseBackupKey(key: string, prefix: string): Date | null {
  const p = normalizePrefix(prefix);
  const head = p ? `${p}/` : '';
  if (!key.startsWith(head)) return null;

  const name = key.slice(head.length);
  // Reject anything in a deeper "directory" — those are not ours.
  if (name.includes('/')) return null;
  if (!name.startsWith(`${KEY_STEM}-`) || !name.endsWith(KEY_SUFFIX)) return null;

  const stamp = name.slice(KEY_STEM.length + 1, name.length - KEY_SUFFIX.length);
  const m = STAMP.exec(stamp);
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (!Number.isFinite(at.getTime())) return null;
  // Round-trip: rejects impossible dates that Date.UTC silently rolls over
  // (20260231 → March 3rd), which would otherwise read as a valid old backup.
  if (backupStem(at) !== `${KEY_STEM}-${stamp}`) return null;
  return at;
}

//// PRUNING ////

export interface PruneInput {
  objects: BackupObject[];
  prefix: string;
  keepDays: number;
  /** Newest N are always retained, however old. */
  minKeep: number;
  /** Ceiling on deletions per run. */
  maxDelete: number;
  /** The archive just uploaded. Never pruned, whatever the rules say. */
  protectKey?: string;
  now: Date;
}

export interface PruneDecision {
  prune: BackupObject[];
  keep: BackupObject[];
  /** Keys that did not match our exact filename pattern. Never deleted, ever. */
  ignored: string[];
  reason: string;
}

/**
 * Decide which archives may be deleted. PURE — the entire safety argument for the
 * only destructive operation in this codebase is testable from this signature.
 *
 * The rules, in order:
 *   1. Exact pattern or nothing. A key that is not `<prefix>/archiyou-<stamp>.tar.gz`
 *      is `ignored` and never reaches a delete call — that is what makes it safe to
 *      point this at a bucket holding other things.
 *   2. The stamp must parse as a real UTC instant (parseBackupKey round-trips it).
 *   3. Both clocks must agree: the name AND LastModified must both be older than
 *      keepDays, so a re-uploaded or restored old archive survives.
 *   4. The newest `minKeep` are always kept, however old — a host clock that is
 *      wrong by years must not make everything eligible.
 *   5. Never leave zero, asserted independently of rule 4 so that minKeep: 0 still
 *      cannot empty the prefix.
 *   6. `protectKey` is never pruned.
 *   7. At most `maxDelete` per run; the overflow waits for the next run.
 */
export function selectPrunable(input: PruneInput): PruneDecision {
  const { objects, prefix, keepDays, minKeep, maxDelete, protectKey, now } = input;

  const ignored: string[] = [];
  const matched: Array<BackupObject & { stampedAt: Date }> = [];

  for (const o of objects) {
    const stampedAt = parseBackupKey(o.key, prefix); // rules 1 + 2
    if (!stampedAt) {
      ignored.push(o.key);
      continue;
    }
    matched.push({ ...o, stampedAt });
  }

  matched.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // lexical == chronological

  if (!matched.length) {
    return { prune: [], keep: [], ignored, reason: 'nothing to prune — no archives under this prefix' };
  }

  // Rule 4. Guard the slice: minKeep 0 would make slice(-0) return the whole array.
  const protectedNewest = new Set(minKeep > 0 ? matched.slice(-minKeep).map((o) => o.key) : []);

  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  let candidates = matched.filter(
    (o) =>
      o.stampedAt.getTime() < cutoff // rule 3a: the name is old
      && o.lastModified.getTime() < cutoff // rule 3b: ...and so is the object
      && !protectedNewest.has(o.key) // rule 4
      && o.key !== protectKey, // rule 6
  );

  // Rule 5 — a belt-and-braces invariant that does not depend on minKeep being sane.
  if (candidates.length >= matched.length) {
    return {
      prune: [],
      keep: matched,
      ignored,
      reason: `refusing to prune — every one of the ${matched.length} archive(s) under this prefix is older than ${keepDays} days, and emptying it is never right. Check the host clock, then raise SERVER_BACKUP_MIN_KEEP or lower SERVER_BACKUP_KEEP_DAYS deliberately.`,
    };
  }

  let overflow = 0;
  if (candidates.length > maxDelete) {
    // Sorted oldest-first, so the cap always drops the oldest ones first.
    overflow = candidates.length - maxDelete;
    candidates = candidates.slice(0, maxDelete);
  }

  const pruneKeys = new Set(candidates.map((o) => o.key));
  const keep = matched.filter((o) => !pruneKeys.has(o.key));

  const notes = [
    `${matched.length} archive(s) matched`,
    `${candidates.length} older than ${keepDays}d`,
    `${keep.length} kept`,
  ];
  if (overflow) notes.push(`${overflow} over the ${maxDelete}/run cap, left for next time`);
  if (ignored.length) notes.push(`${ignored.length} ignored (not a backup filename)`);

  return { prune: candidates, keep, ignored, reason: notes.join(', ') };
}

//// SQLITE SNAPSHOT ////

export interface SqliteStats {
  integrityCheck: string;
  migrations: { count: number; latestCreatedAt: number | null };
  rowCounts: Record<string, number>;
  bytes: number;
}

/**
 * A consistent copy of a live SQLite database, via the online backup API.
 *
 * Not a file copy and not `PRAGMA wal_checkpoint` + copy: the API process is writing
 * concurrently, and in WAL mode a large share of committed state sits in `-wal` at
 * any moment. sqlite3_backup_step copies pages under SQLite's own locking, treats
 * SQLITE_BUSY as "retry" and restarts if a writer intervenes, so the result is a
 * point-in-time image rather than a torn one. better-sqlite3 drives it 100 pages per
 * event-loop tick, so this never blocks the process for long.
 *
 * The connection is opened read-only and separately from db/client.ts — importing
 * that module would open a second WRITABLE handle on the live database as a side
 * effect of the import.
 *
 * The output is fully checkpointed and standalone: no `-wal`, no `-shm` beside it.
 * The backup API already leaves it that way, but the copy inherits the source's
 * journal_mode, so merely OPENING it — to verify it, or by a careless restore —
 * would recreate the sidecars. We flip the snapshot to `journal_mode = delete` so
 * the archived artifact is unambiguously one self-contained file. db/client.ts sets
 * WAL again on boot, so a restored database is back in WAL mode immediately.
 */
export async function snapshotDatabase(sourcePath: string, destPath: string): Promise<void> {
  let source: Database.Database | undefined;
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    source.pragma('busy_timeout = 5000');
    await source.backup(destPath);

    const snapshot = new Database(destPath);
    try {
      snapshot.pragma('journal_mode = delete');
    } finally {
      snapshot.close();
    }
  } catch (err) {
    // better-sqlite3 unlinks its own partial destination when the copy does not
    // reach SQLITE_DONE, so there is nothing to clean up here — only to report.
    throw new BackupFailure(`SQLite snapshot of ${sourcePath} failed: ${(err as Error).message}`, { cause: err });
  } finally {
    source?.close();
  }
}

/**
 * Read the snapshot back and prove it is usable before it is shipped anywhere.
 * A backup that has never been opened is a hope, not a backup.
 */
export function inspectSnapshot(snapshotPath: string): SqliteStats {
  const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    if (integrity !== 'ok') {
      throw new BackupFailure(`snapshot failed integrity_check: ${integrity}`);
    }

    const tables = db
      .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
      .all() as Array<{ name: string }>;

    const rowCounts: Record<string, number> = {};
    for (const { name } of tables) {
      // Table names come from sqlite_master, not user input; quoted anyway.
      const row = db.prepare(`select count(*) as n from "${name.replace(/"/g, '""')}"`).get() as { n: number };
      rowCounts[name] = row.n;
    }

    // Which schema this file matches — the field you actually need on restore.
    let migrations = { count: 0, latestCreatedAt: null as number | null };
    if (tables.some((t) => t.name === '__drizzle_migrations')) {
      const row = db
        .prepare('select count(*) as n, max(created_at) as latest from __drizzle_migrations')
        .get() as { n: number; latest: number | null };
      migrations = { count: row.n, latestCreatedAt: row.latest ?? null };
    }

    return { integrityCheck: integrity, migrations, rowCounts, bytes: statSync(snapshotPath).size };
  } finally {
    db.close();
  }
}

//// TARGET COLLECTION ////

export interface CollectedFile {
  /** Absolute source. */
  from: string;
  /** Path inside the target's directory in the archive. */
  to: string;
  bytes: number;
}

export interface CollectedTarget {
  target: ResolvedTarget;
  files: CollectedFile[];
  bytes: number;
  /** Present for `sqlite` targets only. */
  sqlite?: SqliteStats;
  skipped: boolean;
}

/** Case-insensitive substring match against the path relative to the target root. */
function isExcluded(relPath: string, patterns: string[]): boolean {
  const p = relPath.split(sep).join('/');
  return patterns.some((pattern) => p.toLowerCase().includes(pattern.toLowerCase()));
}

function walk(root: string, exclude: string[]): CollectedFile[] {
  const out: CollectedFile[] = [];
  const stack: string[] = [root];

  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (isExcluded(entry.isDirectory() ? `${rel}/` : rel, exclude)) continue;

      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push({ from: abs, to: rel.split(sep).join('/'), bytes: statSync(abs).size });
      }
      // Symlinks and specials are deliberately not followed: a link out of the data
      // volume would silently pull unrelated (possibly enormous) content into the archive.
    }
  }

  out.sort((a, b) => (a.to < b.to ? -1 : 1)); // deterministic archive ordering
  return out;
}

/**
 * Gather one target's files. `sqlite` targets are snapshotted into `tmpDir` first,
 * so what lands in the archive is the checkpointed copy, never the live file.
 */
export async function collectTarget(target: ResolvedTarget, tmpDir: string): Promise<CollectedTarget> {
  if (!target.present) {
    return { target, files: [], bytes: 0, skipped: true };
  }

  if (target.kind === 'sqlite') {
    const dest = join(tmpDir, `${target.name}-${basename(target.path)}`);
    await snapshotDatabase(target.path, dest);
    const sqlite = inspectSnapshot(dest);
    return {
      target,
      files: [{ from: dest, to: basename(target.path), bytes: sqlite.bytes }],
      bytes: sqlite.bytes,
      sqlite,
      skipped: false,
    };
  }

  if (target.kind === 'file') {
    const bytes = statSync(target.path).size;
    return { target, files: [{ from: target.path, to: basename(target.path), bytes }], bytes, skipped: false };
  }

  const files = walk(target.path, target.exclude);
  return { target, files, bytes: files.reduce((n, f) => n + f.bytes, 0), skipped: false };
}

//// MANIFEST + ARCHIVE ////

export interface Manifest {
  createdAt: string;
  stem: string;
  tool: string;
  sqliteVersion: string;
  targets: Array<{
    name: string;
    kind: BackupTargetKind;
    sourcePath: string;
    files: number;
    bytes: number;
    skipped: boolean;
    integrityCheck?: string;
    migrations?: { count: number; latestCreatedAt: number | null };
    rowCounts?: Record<string, number>;
  }>;
  totalBytes: number;
}

/**
 * The record of what a given archive actually contains. Load-bearing precisely
 * because the target list changes over time — a 2026 archive will not have the same
 * directories as a 2027 one, and on restore you need to know which schema the
 * database file matches before you put it anywhere near production.
 */
export function buildManifest(collected: CollectedTarget[], now: Date, sqliteVersion: string): Manifest {
  return {
    createdAt: now.toISOString(),
    stem: backupStem(now),
    tool: '@archiyou/server admin:backup',
    sqliteVersion,
    targets: collected.map((c) => ({
      name: c.target.name,
      kind: c.target.kind,
      sourcePath: c.target.path,
      files: c.files.length,
      bytes: c.bytes,
      skipped: c.skipped,
      ...(c.sqlite
        ? { integrityCheck: c.sqlite.integrityCheck, migrations: c.sqlite.migrations, rowCounts: c.sqlite.rowCounts }
        : {}),
    })),
    totalBytes: collected.reduce((n, c) => n + c.bytes, 0),
  };
}

/**
 * A streaming tar.gz: `<stem>/MANIFEST.json` plus `<stem>/<target>/…` per target.
 *
 * Returns a Readable immediately and never buffers the archive — the caller pipes it
 * straight into a multipart upload, so peak memory does not grow with the data. (Note
 * the zip in execution/ExecutionManager.ts buffers into memory; do not copy that here.)
 */
export function buildArchive(collected: CollectedTarget[], manifest: Manifest): Readable {
  const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
  const stem = manifest.stem;

  archive.append(JSON.stringify(manifest, null, 2), { name: `${stem}/MANIFEST.json` });

  for (const c of collected) {
    for (const f of c.files) {
      archive.file(f.from, { name: `${stem}/${c.target.name}/${f.to}` });
    }
  }

  archive.finalize().catch(() => {
    /* surfaced via the 'error' event the caller is listening on */
  });
  return archive as unknown as Readable;
}

//// RUN ////

export interface RunBackupOptions {
  targets: ResolvedTarget[];
  store?: BackupStore;
  prefix: string;
  tmpDir: string;
  maxBytes: number;
  /** Retention; ignored when `prune` is false. */
  prune: boolean;
  keepDays: number;
  minKeep: number;
  maxDelete: number;
  /** Do everything except PutObject/DeleteObjects. */
  dry: boolean;
  /** Write the archive here instead of uploading. Implies no prune. */
  out?: string;
  now: Date;
  log?: (message: string) => void;
}

export interface RunBackupResult {
  key: string;
  manifest: Manifest;
  collected: CollectedTarget[];
  uploadedBytes: number;
  prune?: PruneDecision;
  pruned: number;
  /** Set when the archive is safe but pruning failed — the caller exits 3. */
  pruneError?: Error;
}

export async function runBackup(opts: RunBackupOptions): Promise<RunBackupResult> {
  const log = opts.log ?? (() => {});
  const tmpRoot = resolve(opts.tmpDir);
  mkdirSync(tmpRoot, { recursive: true });
  const tmp = mkdtempSync(join(tmpRoot, 'run-'));

  try {
    //// collect ////
    const collected: CollectedTarget[] = [];
    for (const target of opts.targets) {
      const c = await collectTarget(target, tmp);
      collected.push(c);
      log(
        c.skipped
          ? `   ⏭  ${target.name} — source missing, skipped`
          : `   ✅ ${target.name} — ${c.files.length} file(s), ${formatBytes(c.bytes)}${c.sqlite ? ` (integrity_check: ${c.sqlite.integrityCheck}, ${c.sqlite.migrations.count} migrations)` : ''}`,
      );
    }

    const totalBytes = collected.reduce((n, c) => n + c.bytes, 0);
    if (totalBytes > opts.maxBytes) {
      const biggest = [...collected].sort((a, b) => b.bytes - a.bytes)[0];
      throw new BackupFailure(
        `targets total ${formatBytes(totalBytes)}, over the ${formatBytes(opts.maxBytes)} SERVER_BACKUP_MAX_BYTES ceiling `
        + `(largest: "${biggest?.target.name}" at ${formatBytes(biggest?.bytes ?? 0)}). Raise the ceiling deliberately or narrow the targets.`,
      );
    }

    const manifest = buildManifest(collected, opts.now, sqliteVersion());
    const key = objectKeyFor(opts.now, opts.prefix);

    //// write ////
    let uploadedBytes = 0;
    if (opts.out) {
      uploadedBytes = await writeArchiveToFile(collected, manifest, resolve(opts.out));
      log(`   💾 wrote ${resolve(opts.out)} (${formatBytes(uploadedBytes)})`);
    } else if (opts.dry) {
      uploadedBytes = await measureArchive(collected, manifest);
      log(`   🔎 would upload ${key} (${formatBytes(uploadedBytes)} compressed)`);
    } else {
      if (!opts.store) throw new BackupFailure('no backup store configured');
      const counter = new PassThrough();
      counter.on('data', (chunk: Buffer) => {
        uploadedBytes += chunk.length;
      });
      const archive = buildArchive(collected, manifest);
      await opts.store.put(key, pipeWithErrors(archive, counter));
      log(`   ☁️  uploaded ${key} (${formatBytes(uploadedBytes)})`);
    }

    //// prune — only ever after the archive is safely written ////
    const result: RunBackupResult = { key, manifest, collected, uploadedBytes, pruned: 0 };
    if (opts.prune && opts.store && !opts.out) {
      try {
        const objects = await opts.store.list(normalizePrefix(opts.prefix));
        const decision = selectPrunable({
          objects,
          prefix: opts.prefix,
          keepDays: opts.keepDays,
          minKeep: opts.minKeep,
          maxDelete: opts.maxDelete,
          protectKey: opts.dry ? undefined : key,
          now: opts.now,
        });
        result.prune = decision;
        log(`   🧹 prune: ${decision.reason}`);
        if (decision.prune.length && !opts.dry) {
          await opts.store.remove(decision.prune.map((o) => o.key));
          result.pruned = decision.prune.length;
        }
      } catch (err) {
        // The archive is uploaded and safe; only housekeeping broke. The caller
        // turns this into exit 3, which is a "look at it Monday", not a page.
        result.pruneError = new PruneFailure(`prune failed after a successful backup: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }

    return result;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

//// HELPERS ////

function sqliteVersion(): string {
  const probe = new Database(':memory:');
  try {
    return (probe.prepare('select sqlite_version() as v').get() as { v: string }).v;
  } finally {
    probe.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${units[i]}`;
}

/** Pipe, forwarding source errors so a mid-archive failure aborts the upload. */
function pipeWithErrors(source: Readable, sink: PassThrough): PassThrough {
  source.on('error', (err) => sink.destroy(err));
  source.pipe(sink);
  return sink;
}

async function writeArchiveToFile(collected: CollectedTarget[], manifest: Manifest, path: string): Promise<number> {
  mkdirSync(resolve(path, '..'), { recursive: true });

  const archive = buildArchive(collected, manifest);
  const sink = createWriteStream(path);
  let bytes = 0;
  archive.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });

  await new Promise<void>((res, rej) => {
    archive.on('error', rej);
    sink.on('error', rej);
    sink.on('close', () => res());
    archive.pipe(sink);
  });
  return bytes;
}

/** Build the archive to a null sink, purely to report its real compressed size. */
async function measureArchive(collected: CollectedTarget[], manifest: Manifest): Promise<number> {
  const archive = buildArchive(collected, manifest);
  let bytes = 0;
  await new Promise<void>((res, rej) => {
    archive.on('error', rej);
    archive.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    archive.on('end', () => res());
    archive.resume();
  });
  return bytes;
}
