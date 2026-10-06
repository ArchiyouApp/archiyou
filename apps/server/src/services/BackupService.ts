/**
 * BackupService — off-box backups of the server's durable state.
 *
 * One run produces a single timestamped tar.gz containing every declared backup
 * target (see `backupTargets` in config.ts) and uploads it to S3-compatible
 * storage, then prunes older archives under the same key prefix.
 *
 * Two things here are worth understanding before changing anything:
 *
 *  1. The `postgres` target is a `pg_dump -Fc` stream, never a copy of anything on
 *     disk. Copying $PGDATA out from under a running server gives you a torn
 *     cluster; pg_dump reads inside one repeatable-read snapshot, so what lands in
 *     the archive is a point-in-time image of a database that is still being
 *     written to. The custom format (-Fc) is what makes a partial restore — one
 *     table, or into a scratch database — possible at all.
 *
 *  2. `selectPrunable()` is the only destructive code in the server. It is pure so
 *     that every one of its safety rules is exhaustively unit-testable, and it is
 *     called only after a successful upload — otherwise a backup that has been
 *     failing silently for weeks would quietly age out the last good copies.
 *
 * The CLI wrapper is src/admin/backup.ts; this module never reads argv, never
 * reads `config`, and never calls process.exit. Errors are typed so the CLI can
 * map them to meaningful exit codes.
 *
 * The three external commands (pg_dump, pg_restore, psql) go through the injectable
 * `PostgresTools` below rather than being called inline, so the unit tests can drive
 * every path without a server. CI runs the real ones against a postgres service.
 */

import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import archiver from 'archiver';

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
    // The database target's `path` is a connection URL, not a filesystem path: there
    // is nothing to resolve or stat, and pg_dump is what discovers whether it is
    // reachable. What IS checked here is that it names a server at all — pg_dump
    // cannot read PGlite, so a dev checkout must be told that plainly rather than
    // shipping an archive with no database in it.
    if (t.kind === 'postgres') {
      if (!/^postgres(ql)?:\/\//i.test(t.path)) {
        throw new BackupConfigError(
          `Backup target "${t.name}" needs a PostgreSQL server, but SERVER_DATABASE_URL is "${t.path}". `
          + 'pg_dump cannot read an in-process PGlite database — point at a postgres:// URL, '
          + `or add "${t.name}" to SERVER_BACKUP_SKIP if this instance genuinely has nothing to back up.`,
        );
      }
      resolved.push({ ...targetDefaults(t), path: t.path, exclude: [], present: true });
      continue;
    }

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

//// POSTGRES SNAPSHOT ////

export interface PostgresStats {
  /** `SHOW server_version` of the database that was dumped. */
  serverVersion: string;
  /** How many archive entries `pg_restore --list` reports — the proof the dump file
   *  can actually be read back, which is the whole point of inspecting it. */
  dumpEntries: number;
  /** Which schema this dump matches, from drizzle.__drizzle_migrations. */
  migrations: { count: number; latestCreatedAt: number | null };
  rowCounts: Record<string, number>;
  bytes: number;
}

/**
 * The three PostgreSQL command-line tools this needs, behind an interface.
 *
 * Injected rather than called inline so the unit tests can exercise every branch —
 * a failed dump, an unreadable archive, a database with no drizzle schema — without
 * a server. The real implementation is `postgresTools` below; CI runs it against a
 * postgres service so the argument lists cannot rot.
 */
export interface PostgresTools {
  /** `pg_dump -Fc <url> -f <destPath>`. */
  dump(url: string, destPath: string): Promise<void>;
  /** `pg_restore --list <path>` → its lines. Throws if the file is not a valid archive. */
  list(path: string): Promise<string[]>;
  /** Server version, per-table row counts and migration state, read from the LIVE
   *  database in one read-only repeatable-read transaction. */
  stats(url: string): Promise<Omit<PostgresStats, 'dumpEntries' | 'bytes'>>;
}

const run = promisify(execFile);

/** One field separator that cannot occur in a table name or a number. */
const FS = '\u0001';

/**
 * Exact row counts for every table in `public`, plus the migration state.
 *
 * `query_to_xml` is the standard way to get a real `count(*)` per table in one
 * statement — pg_class.reltuples is a planner estimate and would report numbers that
 * are merely close, which is useless in a backup manifest you are going to compare
 * against after a restore.
 *
 * READ ONLY REPEATABLE READ so every count comes from one snapshot: without it a
 * manifest could claim a users/script_versions pair that never existed together.
 */
const STATS_SQL = `
\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'version' || '${FS}' || setting FROM pg_settings WHERE name = 'server_version';
SELECT 'table' || '${FS}' || table_name || '${FS}'
       || (xpath('/row/cnt/text()',
                 query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name),
                              false, true, '')))[1]::text
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 ORDER BY table_name;
SELECT 'migrations' || '${FS}' || count(*) || '${FS}' || coalesce(max(created_at)::text, '')
  FROM drizzle."__drizzle_migrations";
COMMIT;
`;

/** The same query without the migrations line, for a database that has never been
 *  migrated by drizzle — asking for a table that is not there aborts the whole
 *  transaction under ON_ERROR_STOP, so it is a second attempt rather than a guard. */
const STATS_SQL_NO_MIGRATIONS = STATS_SQL.replace(
  /SELECT 'migrations'[\s\S]*?FROM drizzle\."__drizzle_migrations";\n/,
  '',
);

function parseStats(stdout: string): Omit<PostgresStats, 'dumpEntries' | 'bytes'> {
  const out = {
    serverVersion: 'unknown',
    migrations: { count: 0, latestCreatedAt: null as number | null },
    rowCounts: {} as Record<string, number>,
  };
  stdout.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const [tag, a, b] = line.split(FS);
    if (tag === 'version') out.serverVersion = a;
    else if (tag === 'table') out.rowCounts[a] = Number(b);
    else if (tag === 'migrations') {
      out.migrations = { count: Number(a), latestCreatedAt: b ? Number(b) : null };
    }
  });
  return out;
}

/** The real tools. `pg_dump` must be at least the server's major version, which is
 *  why the Dockerfile installs postgresql-client-17 from PGDG rather than Debian's. */
export const postgresTools: PostgresTools = {
  async dump(url, destPath) {
    // -Fc: the custom format. Compressed, and restorable table by table or into a
    // scratch database, which a plain SQL dump is not.
    // --no-owner/--no-acl: a restore must not depend on the role names of the box it
    // came from; the roles are created by the runbook, not by the dump.
    await run('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', destPath, url], {
      maxBuffer: 16 * 1024 * 1024,
    });
  },

  async list(path) {
    const { stdout } = await run('pg_restore', ['--list', path], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n').filter((l) => l.trim() && !l.startsWith(';'));
  },

  async stats(url) {
    // -X no .psqlrc, -A unaligned, -t tuples only, -q quiet: machine-readable output.
    // The script goes in on stdin (`-f -`) rather than as -c, because it is several
    // statements that must share one transaction.
    const psql = (script: string): Promise<string> => new Promise((ok, fail) => {
      const child = spawn('psql', ['-X', '-A', '-t', '-q', '-f', '-', url]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? ok(stdout) : fail(new Error(stderr.trim() || `psql exited ${code}`))));
      child.stdin.end(script);
    });
    try {
      return parseStats(await psql(STATS_SQL));
    } catch {
      return parseStats(await psql(STATS_SQL_NO_MIGRATIONS));
    }
  },
};

/**
 * A consistent dump of a live PostgreSQL database.
 *
 * pg_dump takes its own repeatable-read snapshot, so the API can keep serving while
 * this runs and the result is still internally consistent — no locking, no downtime,
 * no "stop the server to back it up".
 */
export async function snapshotDatabase(url: string, destPath: string, tools: PostgresTools = postgresTools): Promise<void> {
  try {
    await tools.dump(url, destPath);
  } catch (err) {
    throw new BackupFailure(
      `pg_dump of ${redactUrl(url)} failed: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

/**
 * Read the dump back and prove it is usable before it is shipped anywhere.
 * A backup that has never been opened is a hope, not a backup.
 *
 * `pg_restore --list` is the cheap equivalent of SQLite's integrity_check: it parses
 * the archive's table of contents, so a truncated or corrupt file fails here rather
 * than at 3am six months from now. The row counts come from the live database (the
 * dump format does not carry them) and are what you compare against after a restore.
 */
export async function inspectSnapshot(
  snapshotPath: string,
  url: string,
  tools: PostgresTools = postgresTools,
): Promise<PostgresStats> {
  let entries: string[];
  try {
    entries = await tools.list(snapshotPath);
  } catch (err) {
    throw new BackupFailure(`pg_restore could not read the dump: ${(err as Error).message}`, { cause: err });
  }
  if (entries.length === 0) {
    throw new BackupFailure('pg_restore listed no entries — the dump is empty.');
  }

  const stats = await tools.stats(url);
  return { ...stats, dumpEntries: entries.length, bytes: statSync(snapshotPath).size };
}

/** The database name out of a connection URL — the dump's filename inside the
 *  archive, so a restore reads `db/archiyou.dump` rather than `db/dump`. */
export function databaseNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || 'database';
  } catch {
    return 'database';
  }
}

/** A database URL with the password removed, for logs and error messages. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable database URL)';
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
  /** Present for the `postgres` target only. */
  postgres?: PostgresStats;
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
 * Gather one target's files. The `postgres` target is dumped into `tmpDir` first, so
 * what lands in the archive is a pg_dump stream and never anything read off $PGDATA.
 */
export async function collectTarget(
  target: ResolvedTarget,
  tmpDir: string,
  tools: PostgresTools = postgresTools,
): Promise<CollectedTarget> {
  if (!target.present) {
    return { target, files: [], bytes: 0, skipped: true };
  }

  if (target.kind === 'postgres') {
    // `path` is the database URL for this kind, not a filesystem path.
    const name = `${databaseNameOf(target.path)}.dump`;
    const dest = join(tmpDir, `${target.name}-${name}`);
    await snapshotDatabase(target.path, dest, tools);
    const postgres = await inspectSnapshot(dest, target.path, tools);
    return {
      target,
      files: [{ from: dest, to: name, bytes: postgres.bytes }],
      bytes: postgres.bytes,
      postgres,
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
  /** The PostgreSQL server the `db` target was dumped from — the version a restore
   *  needs to be at least. Empty when no database target was included. */
  serverVersion: string;
  targets: Array<{
    name: string;
    kind: BackupTargetKind;
    sourcePath: string;
    files: number;
    bytes: number;
    skipped: boolean;
    dumpEntries?: number;
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
export function buildManifest(collected: CollectedTarget[], now: Date): Manifest {
  return {
    createdAt: now.toISOString(),
    stem: backupStem(now),
    tool: '@archiyou/server admin:backup',
    serverVersion: collected.find((c) => c.postgres)?.postgres?.serverVersion ?? '',
    targets: collected.map((c) => ({
      name: c.target.name,
      kind: c.target.kind,
      // Redacted: a manifest travels off-box, and for the database target this is a
      // connection URL with a password in it.
      sourcePath: c.target.kind === 'postgres' ? redactUrl(c.target.path) : c.target.path,
      files: c.files.length,
      bytes: c.bytes,
      skipped: c.skipped,
      ...(c.postgres
        ? { dumpEntries: c.postgres.dumpEntries, migrations: c.postgres.migrations, rowCounts: c.postgres.rowCounts }
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
  /** Injected in tests; the real pg_dump/pg_restore/psql otherwise. */
  tools?: PostgresTools;
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
      const c = await collectTarget(target, tmp, opts.tools);
      collected.push(c);
      log(
        c.skipped
          ? `   ⏭  ${target.name} — source missing, skipped`
          : `   ✅ ${target.name} — ${c.files.length} file(s), ${formatBytes(c.bytes)}${c.postgres ? ` (pg ${c.postgres.serverVersion}, ${c.postgres.dumpEntries} dump entries, ${c.postgres.migrations.count} migrations)` : ''}`,
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

    const manifest = buildManifest(collected, opts.now);
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
