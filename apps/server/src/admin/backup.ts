/**
 * backup — off-box backup of the server's durable state to S3-compatible storage.
 *
 * Uploads one timestamped tar.gz containing every declared backup target (see
 * `backupTargets` in src/config.ts — that list, not this file, is the answer to
 * "what is backed up"), then prunes archives older than the retention window.
 *
 * The SQLite database is snapshotted with SQLite's online backup API, so this is
 * safe to run against a live server and needs no manual WAL checkpoint.
 *
 * Scheduling lives in the host crontab, not here — see apps/server/README → Backups.
 *
 * Exit codes (cron's MAILTO gets these through `docker compose exec`):
 *   0  archive uploaded (or written with --out) and any prune completed
 *   1  BACKUP FAILED — no new archive exists. This is the one that should page you.
 *   2  usage or configuration error, detected before any work was done
 *   3  the archive is safe, but pruning failed. Look at it Monday.
 *
 * Usage (from apps/server):
 *   pnpm admin:backup [--list] [--dry] [--only <names>] [--skip <names>]
 *                     [--out <path>] [--keep <days>] [--no-prune]
 */

import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { BACKUP_DEFAULT_EXCLUDES, backupTargets, config } from '../config';
import {
  BackupConfigError,
  formatBytes,
  normalizePrefix,
  objectKeyFor,
  resolveTargets,
  runBackup,
} from '../services/BackupService';
import { createS3Store, describeStore } from '../services/S3Backend';
import type { BackupStore } from '../services/S3Backend';

//// ARGS ////

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const list = (name: string): string[] =>
  (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const KNOWN = ['--list', '--dry', '--only', '--skip', '--out', '--keep', '--no-prune'];

const LIST = argv.includes('--list');
const DRY = argv.includes('--dry');
const ONLY = list('only');
const SKIP = list('skip');
const OUT = flag('out');
const KEEP = flag('keep');
const NO_PRUNE = argv.includes('--no-prune');

/** apps/server — every relative path setting is documented as being relative to it. */
const BASE_DIR = fileURLToPath(new URL('../..', import.meta.url));

//// HELPERS ////

function fail(code: number, message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(code);
}

/** Flags that take a value, so the value itself is not mistaken for an unknown flag. */
const VALUED = new Set(['--only', '--skip', '--out', '--keep']);

function checkArgs(): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    if (!KNOWN.includes(arg)) {
      fail(2, `Unknown flag "${arg}". Known flags: ${KNOWN.join(' ')}`);
    }
    if (VALUED.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail(2, `${arg} needs a value.`);
      i++; // skip the value
    }
  }

  if (KEEP !== undefined && !Number.isFinite(Number(KEEP))) {
    fail(2, `--keep needs a number of days, got "${KEEP}".`);
  }
  if (ONLY.length && SKIP.length) {
    console.warn('⚠️  --only and --skip were both given; --only wins.');
  }
}

/** The S3 config, or a precise complaint about what is missing. Never logs the secret. */
function requireStore(): BackupStore {
  const s3 = config.backup.s3;
  const missing = [
    !s3.bucket && 'SERVER_BACKUP_S3_BUCKET',
    !s3.accessKeyId && 'SERVER_BACKUP_S3_ACCESS_KEY_ID',
    !s3.secretAccessKey && 'SERVER_BACKUP_S3_SECRET_ACCESS_KEY',
  ].filter(Boolean);

  if (missing.length) {
    fail(
      2,
      `Backups are not configured — missing ${missing.join(', ')}.\n`
      + `   See the "off-box backups" block in apps/server/.env.example.\n`
      + `   To test without credentials: pnpm admin:backup --out ./backup.tar.gz`,
    );
  }
  return createS3Store(s3);
}

//// RUN ////

checkArgs();

const now = new Date();
const keepDays = KEEP !== undefined ? Number(KEEP) : config.backup.keepDays;

let resolved;
try {
  resolved = resolveTargets({
    targets: backupTargets,
    extraPaths: config.backup.extraPaths,
    skip: [...config.backup.skip, ...SKIP],
    only: ONLY,
    exclude: config.backup.exclude,
    baseDir: BASE_DIR,
  });
} catch (err) {
  if (err instanceof BackupConfigError) fail(2, err.message);
  throw err;
}

for (const warning of resolved.warnings) console.warn(`⚠️  ${warning}`);

//// --list: report and stop ////

if (LIST) {
  console.log(`\n📋 Backup targets (declared in src/config.ts → backupTargets)\n`);
  for (const t of resolved.targets) {
    console.log(`   ${t.present ? '✅' : '⏭ '} ${t.name.padEnd(14)} ${t.kind.padEnd(7)} ${t.path}${t.present ? '' : '  (missing)'}`);
  }
  console.log(`\n   excludes: ${[...new Set(resolved.targets.flatMap((t) => t.exclude))].join(', ') || BACKUP_DEFAULT_EXCLUDES.join(', ')}`);
  console.log(`   would upload: ${objectKeyFor(now, config.backup.s3.prefix)}`);
  console.log(`   destination:  ${config.backup.s3.bucket ? describeStore(config.backup.s3) : 'not configured'}\n`);
  process.exit(0);
}

//// backup ////

const store = OUT ? undefined : requireStore();
const prefix = OUT ? '' : normalizePrefix(config.backup.s3.prefix);

console.log(`\n📦 Archiyou backup${DRY ? ' (dry run — nothing is written or deleted)' : ''}`);
if (store) console.log(`   → ${describeStore(config.backup.s3)}`);

const started = Date.now();
let timer: NodeJS.Timeout | undefined;

try {
  const result = await Promise.race([
    runBackup({
      targets: resolved.targets,
      store,
      prefix,
      tmpDir: config.backup.tmpDir,
      maxBytes: config.backup.maxBytes,
      prune: config.backup.prune && !NO_PRUNE,
      keepDays,
      minKeep: config.backup.minKeep,
      maxDelete: config.backup.maxDelete,
      dry: DRY,
      out: OUT,
      now,
      log: (message) => console.log(message),
    }),
    new Promise<never>((_, reject) => {
      // A stalled upload must not still be running when the next cron run starts.
      timer = setTimeout(
        () => reject(new Error(`timed out after ${config.backup.timeoutMs} ms (SERVER_BACKUP_TIMEOUT_MS)`)),
        config.backup.timeoutMs,
      );
    }),
  ]);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n✅ ${DRY ? 'Dry run OK' : 'Backup complete'} — ${formatBytes(result.uploadedBytes)} in ${elapsed}s`
    + `${result.pruned ? `, ${result.pruned} old archive(s) pruned` : ''}`,
  );

  if (result.pruneError) {
    // The data is safe; only housekeeping broke. Exit 3 so this is distinguishable
    // from "there is no backup", which is a very different sort of morning.
    console.error(`\n⚠️  ${result.pruneError.message}`);
    console.error('   The archive uploaded fine — this is a housekeeping failure, not data loss.');
    process.exit(3);
  }

  process.exit(0);
} catch (err) {
  const e = err as Error & { $metadata?: { httpStatusCode?: number; requestId?: string } };
  if (e instanceof BackupConfigError) fail(2, e.message);

  // Log the SDK's shape explicitly rather than the raw error: pinning the fields
  // means a future SDK version cannot start spilling credentials into the log.
  const meta = e.$metadata ? ` (http ${e.$metadata.httpStatusCode ?? '?'}, request ${e.$metadata.requestId ?? '?'})` : '';
  fail(1, `Backup failed: ${e.name}: ${e.message}${meta}\n   No new archive was created.`);
} finally {
  if (timer) clearTimeout(timer);
}
