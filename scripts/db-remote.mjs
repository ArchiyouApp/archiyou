/**
 * db:download — pull the production SQLite database down to this machine.
 *
 * The server keeps its database in the bind-mounted checkout
 * (`apps/server/data/archiyou.db`, see docker-compose.yml → api), so this needs
 * nothing but SSH: no docker exec, no S3 credentials, no server-side install.
 *
 * It is the counterpart of `pnpm admin:backup` (off-box archive, runs ON the
 * server) — this one runs on a developer machine and overwrites the LOCAL
 * database, so the local one is always copied to `data/db-backups/<stamp>/`
 * first. That copy is not optional; the only knob is how many are kept.
 *
 * CREDENTIALS ARE NEVER STORED, anywhere. Server, username and remote path are
 * asked for at the prompt; the PASSWORD is asked for by `ssh` itself, straight
 * from the terminal — this script never sees it, so it cannot end up in a file,
 * in `ps` output, or in the environment. There is deliberately no key-file
 * setting and no `.env` block. (If ssh can already authenticate on its own —
 * agent or ~/.ssh/config — it simply does not ask.)
 *
 * You are asked for the password ONCE: the first connection is an ssh
 * ControlMaster, and every command and file transfer after it rides the same
 * authenticated socket, which is closed on the way out.
 *
 * Consistency: the remote snapshot is taken with SQLite's online backup API
 * (`sqlite3 <db> ".backup"`), which is safe against a live server and yields a
 * fully checkpointed, self-contained file. If the server has no `sqlite3`
 * binary the script falls back to copying the database plus its `-wal`, which
 * is *usually* fine but can catch a write mid-flight — it says so loudly, and
 * `apt install sqlite3` on the server makes the warning go away.
 *
 * Exit codes:
 *   0  database downloaded and swapped in; the previous one is in db-backups/
 *   1  FAILED — nothing was swapped, the local database is untouched
 *   2  usage error, or nothing to prompt with (no terminal)
 *
 * Usage (from the repo root):
 *   pnpm dbdownload                      # asks for server, user, password
 *   pnpm dbdownload --dry                # connect and report; change nothing
 *   pnpm dbdownload --host … --user … --yes   # unattended-ish (still asks the password)
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** Repo root — this file lives in <root>/scripts. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_LOCAL_DB = resolve(ROOT, 'apps/server/data/archiyou.db');
const DEFAULT_REMOTE_DB = '/opt/archiyou/apps/server/data/archiyou.db';

/** Set once the shared ssh connection is up. Declared here because fail() —
 *  which closes it — can fire while the arguments are still being parsed. */
let master = false;

//// ARGS ////

const argv = process.argv.slice(2);
const KNOWN = ['--dry', '--yes', '--host', '--user', '--port', '--remote', '--local', '--keep', '--help'];
const VALUED = new Set(['--host', '--user', '--port', '--remote', '--local', '--keep']);

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

function fail(code, message) {
  closeMaster();
  console.error(`\n❌ ${message}`);
  process.exit(code);
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  if (!KNOWN.includes(arg)) fail(2, `Unknown flag "${arg}". Known flags: ${KNOWN.join(' ')}`);
  if (VALUED.has(arg)) {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(2, `${arg} needs a value.`);
    i++;
  }
}

if (argv.includes('--help')) {
  console.log(
    [
      'pnpm dbdownload — copy the production database over SSH into apps/server/data',
      '',
      'Asks for the server, your username and (via ssh itself) your password.',
      'Nothing is stored but the non-secret answers, as defaults for next time.',
      '',
      '  --dry            connect and report what would happen; change nothing',
      '  --yes            skip the confirmation prompt',
      '  --host <host>    server, instead of being asked',
      '  --user <name>    ssh username, instead of being asked',
      '  --port <n>       ssh port (default 22)',
      '  --remote <path>  database path on the server',
      '  --local <path>   database path here (default apps/server/data/archiyou.db)',
      '  --keep <n>       local backups to retain (default 10, 0 = keep all)',
    ].join('\n'),
  );
  process.exit(0);
}

const DRY = argv.includes('--dry');
const YES = argv.includes('--yes');
const PORT = flag('port') ?? '';
const LOCAL_DB = resolve(ROOT, flag('local') ?? DEFAULT_LOCAL_DB);
const BACKUP_DIR = join(dirname(LOCAL_DB), 'db-backups');
/**
 * Last server / username / remote path, so the next run is three Enters. Sits
 * next to the database it points at — apps/server/data/ is already gitignored.
 * NOTHING SECRET IS EVER WRITTEN HERE — see saveHints().
 */
const HINTS_FILE = join(dirname(LOCAL_DB), '.dbdownload.json');
const KEEP = Number(flag('keep') ?? 10);

if (!Number.isInteger(KEEP) || KEEP < 0) fail(2, `--keep must be a non-negative integer, got "${KEEP}".`);
if (PORT && !/^\d+$/.test(PORT)) fail(2, `--port must be a number, got "${PORT}".`);

//// PROMPTS ////

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Remembered non-secret answers. A corrupt or absent file is simply no defaults. */
function loadHints() {
  try {
    const hints = JSON.parse(readFileSync(HINTS_FILE, 'utf8'));
    return hints && typeof hints === 'object' ? hints : {};
  } catch {
    return {};
  }
}

/** Only these three keys are ever persisted, so a password cannot leak in here
 *  even if one were somehow in scope. Failure to write is not worth a word. */
function saveHints(host, user, remote) {
  try {
    mkdirSync(dirname(HINTS_FILE), { recursive: true });
    writeFileSync(HINTS_FILE, `${JSON.stringify({ host, user, remote }, null, 2)}\n`);
  } catch {
    /* a convenience, never a requirement */
  }
}

const hints = loadHints();
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
rl?.on('SIGINT', cancel);

/** Ask, offering `fallback` on a bare Enter. Ctrl+C / Ctrl+D is a cancel, not a
 *  stack trace: nothing has been touched at this point. */
async function ask(label, fallback) {
  let answer;
  try {
    answer = await rl.question(`   ${label}${fallback ? ` [${fallback}]` : ''}: `);
  } catch {
    cancel();
  }
  return answer.trim() || fallback || '';
}

function cancel() {
  rl?.close();
  console.log(`\n\n   Cancelled. Nothing was touched.`);
  process.exit(0);
}

let HOST = flag('host') ?? '';
let USER = flag('user') ?? '';
let REMOTE_DB = flag('remote') ?? '';

if (!HOST || !USER || !REMOTE_DB) {
  if (!interactive) {
    fail(
      2,
      'No terminal to ask on. Run `pnpm dbdownload` from an interactive shell, or\n' +
        '   pass --host, --user and --remote (ssh still needs a tty for the password,\n' +
        '   unless the host authenticates by key).',
    );
  }
  console.log(`\n📥 database download — where from?\n`);
  HOST = HOST || (await ask('server (host or ssh alias)', hints.host));
  if (!HOST) fail(2, 'No server given.');
  USER = USER || (await ask('ssh username', hints.user));
  if (!USER) fail(2, 'No username given.');
  REMOTE_DB = REMOTE_DB || (await ask('database path on the server', hints.remote || DEFAULT_REMOTE_DB));
}

const TARGET = `${USER}@${HOST}`;

//// HELPERS ////

/** UTC, matching the archive names `pnpm admin:backup` writes. */
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Single-quote for the REMOTE shell. Paths are ours, but a space must not split a word. */
const sh = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/**
 * One authenticated connection, shared by every ssh and scp below, so the
 * password is typed once instead of four times. Unix-socket paths are length
 * limited, hence the short name in the system temp dir rather than the repo.
 */
const CONTROL = join(tmpdir(), `dbdl-${process.pid}.sock`);

const portOpts = PORT ? ['-p', PORT] : [];
const muxOpts = () => (master ? ['-o', `ControlPath=${CONTROL}`, '-o', 'ControlMaster=no'] : []);
const baseOpts = ['-o', 'ConnectTimeout=20'];

function openMaster() {
  // -f backgrounds only AFTER authenticating, so the password prompt still
  // happens here, in the foreground, on the terminal.
  const res = spawnSync(
    'ssh',
    [...portOpts, ...baseOpts, '-f', '-N', '-M', '-o', `ControlPath=${CONTROL}`, '-o', 'ControlPersist=300', TARGET],
    { stdio: 'inherit' },
  );
  if (res.error && res.error.code === 'ENOENT') fail(2, 'No `ssh` on PATH. Install an OpenSSH client.');
  if (res.status === 0) {
    master = true;
    return;
  }
  // Either authentication failed or this ssh has no connection multiplexing
  // (Windows OpenSSH). One plain connection tells us which.
  const plain = spawnSync('ssh', [...portOpts, ...baseOpts, TARGET, 'true'], { stdio: 'inherit' });
  if (plain.status !== 0) fail(1, `Could not connect to ${TARGET}. Wrong host, username or password?`);
  console.warn(
    `\n⚠️  This ssh cannot share one connection (no ControlMaster), so it will ask\n` +
      `   for the password again for each step.`,
  );
}

function closeMaster() {
  if (!master) return;
  master = false;
  spawnSync('ssh', ['-o', `ControlPath=${CONTROL}`, '-O', 'exit', TARGET], { stdio: 'ignore' });
}

/** Run a command over ssh, returning stdout. stderr is inherited so ssh can talk. */
function ssh(script) {
  const out = spawnSync('ssh', [...portOpts, ...baseOpts, ...muxOpts(), TARGET, script], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (out.error) throw out.error;
  return { code: out.status ?? 1, stdout: (out.stdout ?? '').trim() };
}

function scp(remotePath, localPath) {
  const res = spawnSync(
    'scp',
    // scp spells the port -P; the multiplex socket it takes as a plain -o.
    [...(PORT ? ['-P', PORT] : []), ...baseOpts, ...muxOpts(), '-C', `${TARGET}:${remotePath}`, localPath],
    { stdio: 'inherit' },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`scp exited ${res.status} while fetching ${remotePath}`);
}

const formatBytes = (n) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/** A real SQLite database starts with this. Cheapest possible guard against
 *  downloading an html error page, a truncated transfer or an empty file. */
function assertSqlite(path) {
  const size = statSync(path).size;
  if (size === 0) throw new Error(`${path} is empty — the transfer produced nothing.`);
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    if (head.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw new Error(`${path} is not a SQLite database (bad header) — refusing to install it.`);
    }
  } finally {
    closeSync(fd);
  }
  return size;
}

/** Remove a file if it is there; used for the -wal/-shm sidecars. */
const rmIf = (path) => {
  if (existsSync(path)) unlinkSync(path);
};

//// PLAN ////

console.log(`\n📥 database download`);
console.log(`   from   ${TARGET}:${REMOTE_DB}${PORT ? ` (port ${PORT})` : ''}`);
console.log(`   to     ${LOCAL_DB}`);
console.log(`   backup ${BACKUP_DIR}/${stamp}/  (keeping ${KEEP === 0 ? 'all' : `the newest ${KEEP}`})`);
if (DRY) console.log(`   DRY RUN — nothing will be written`);

if (!DRY && !YES && interactive) {
  const go = (await ask('This replaces your local database. Continue?', 'y')).toLowerCase();
  if (!['y', 'yes'].includes(go)) cancel();
}

// Everything that needed asking has been asked; ssh gets the terminal from here.
rl?.close();

console.log(`\n   connecting to ${TARGET}…`);
openMaster();
saveHints(HOST, USER, REMOTE_DB);

//// REMOTE SNAPSHOT ////

// Everything the remote side does, in one round trip: confirm the database is
// there, take an online-backup snapshot next to it when sqlite3 exists, and
// report sizes. The snapshot lands in the same directory so it is on the same
// filesystem and writable by the same user that owns the database.
const REMOTE_SNAP = `${REMOTE_DB}.dbdownload-${stamp}`;
const probe = ssh(
  [
    'set -e',
    `DB=${sh(REMOTE_DB)}`,
    `SNAP=${sh(REMOTE_SNAP)}`,
    'if [ ! -f "$DB" ]; then echo "MISSING"; exit 0; fi',
    'echo "SIZE $(wc -c < "$DB")"',
    'if command -v sqlite3 >/dev/null 2>&1; then',
    ...(DRY
      ? ['  echo "SQLITE ok"']
      : [
          '  rm -f "$SNAP"',
          '  sqlite3 "$DB" ".backup \'$SNAP\'" >/dev/null',
          '  CHECK=$(sqlite3 "$SNAP" "PRAGMA integrity_check;" | head -1)',
          '  echo "SNAP $(wc -c < "$SNAP")"',
          '  echo "CHECK $CHECK"',
        ]),
    'else',
    '  echo "NOSQLITE"',
    '  if [ -f "$DB-wal" ]; then echo "WAL $(wc -c < "$DB-wal")"; fi',
    'fi',
  ].join('\n'),
);

if (probe.code !== 0) fail(1, `Could not read the database on ${TARGET} (ssh exited ${probe.code}).`);

const lines = probe.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
const has = (tag) => lines.some((l) => l === tag || l.startsWith(`${tag} `));
const value = (tag) => lines.find((l) => l.startsWith(`${tag} `))?.slice(tag.length + 1) ?? '';

if (has('MISSING')) {
  fail(
    1,
    `No database at ${REMOTE_DB} on ${HOST}.\n` +
      `   The database is a plain file in the deploy checkout — it is\n` +
      `   <deploy dir>/apps/server/data/archiyou.db, not a docker volume.`,
  );
}

const remoteSize = Number(value('SIZE') || 0);
const usedSqlite = !has('NOSQLITE');
console.log(`\n   remote database: ${formatBytes(remoteSize)}`);

if (!usedSqlite) {
  console.warn(
    `\n⚠️  No sqlite3 on ${HOST} — falling back to copying the database and its -wal.\n` +
      `   That is a live copy: a write landing mid-transfer can make it inconsistent.\n` +
      `   Fix with \`apt install sqlite3\` on the server and this becomes an\n` +
      `   online-backup snapshot instead.`,
  );
} else if (!DRY) {
  const check = value('CHECK');
  if (check !== 'ok') {
    // Clean up the snapshot before bailing — otherwise every failed run leaves one.
    ssh(`rm -f ${sh(REMOTE_SNAP)}`);
    fail(1, `The remote snapshot fails PRAGMA integrity_check ("${check}"). Nothing downloaded.`);
  }
  console.log(`   snapshot:        ${formatBytes(Number(value('SNAP') || 0))}, integrity_check ok`);
}

if (DRY) {
  closeMaster();
  console.log(
    `\n✅ dry run: ${TARGET} is reachable, the database is there` +
      `${usedSqlite ? ' and sqlite3 can snapshot it' : ' (no sqlite3 — would copy live)'}.` +
      `\n   Run without --dry to download.`,
  );
  process.exit(0);
}

//// DOWNLOAD ////

mkdirSync(dirname(LOCAL_DB), { recursive: true });
const TMP_DB = join(dirname(LOCAL_DB), `.dbdownload-${stamp}.db`);
const TMP_WAL = `${TMP_DB}-wal`;

const cleanupLocal = () => {
  rmIf(TMP_DB);
  rmIf(TMP_WAL);
};

try {
  console.log(`\n   downloading…`);
  scp(sh(usedSqlite ? REMOTE_SNAP : REMOTE_DB), TMP_DB);
  if (!usedSqlite && has('WAL')) scp(sh(`${REMOTE_DB}-wal`), TMP_WAL);

  const downloaded = assertSqlite(TMP_DB);
  console.log(`   downloaded ${formatBytes(downloaded)}`);
} catch (err) {
  cleanupLocal();
  // The snapshot is ours and disposable — never leave it filling the server's
  // disk. (fail() exits the process, so the finally below would not run.)
  if (usedSqlite) ssh(`rm -f ${sh(REMOTE_SNAP)}`);
  fail(1, `Download failed: ${err.message}\n   The local database was not touched.`);
} finally {
  if (usedSqlite) ssh(`rm -f ${sh(REMOTE_SNAP)}`);
}

closeMaster();

//// BACKUP THE LOCAL DATABASE ////

// Copy, never move: if anything below fails the working database is still in
// place. The -wal/-shm sidecars go along, because without them a database that
// was left with un-checkpointed writes is missing its most recent ones.
if (existsSync(LOCAL_DB)) {
  const dest = join(BACKUP_DIR, stamp);
  try {
    mkdirSync(dest, { recursive: true });
    const base = LOCAL_DB.split('/').pop();
    let total = statSync(LOCAL_DB).size;
    copyFileSync(LOCAL_DB, join(dest, base));
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${LOCAL_DB}${suffix}`)) {
        copyFileSync(`${LOCAL_DB}${suffix}`, join(dest, `${base}${suffix}`));
        total += statSync(`${LOCAL_DB}${suffix}`).size;
      }
    }
    console.log(`   backed up the local database → db-backups/${stamp}/ (${formatBytes(total)})`);
  } catch (err) {
    cleanupLocal();
    rmSync(dest, { recursive: true, force: true });
    fail(1, `Could not back up the local database: ${err.message}\n   Nothing was replaced.`);
  }
} else {
  console.log(`   no local database yet — nothing to back up`);
}

//// SWAP IN ////

// The old -wal/-shm belong to the OLD database. Leaving them next to a
// different file is how you corrupt one, so they go before the move.
rmIf(`${LOCAL_DB}-wal`);
rmIf(`${LOCAL_DB}-shm`);
renameSync(TMP_DB, LOCAL_DB);
if (existsSync(TMP_WAL)) renameSync(TMP_WAL, `${LOCAL_DB}-wal`);

console.log(`\n✅ ${LOCAL_DB} is now the copy from ${HOST}`);

//// PRUNE LOCAL BACKUPS ////

if (KEEP > 0 && existsSync(BACKUP_DIR)) {
  // Only ever directories matching our own stamp shape, newest KEEP retained.
  const stamps = readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const old of stamps.slice(KEEP)) {
    rmSync(join(BACKUP_DIR, old), { recursive: true, force: true });
    console.log(`   pruned old backup db-backups/${old}`);
  }
}

console.log(
  `\n   Restore a backup with:\n` +
    `     cp ${BACKUP_DIR}/<stamp>/* ${dirname(LOCAL_DB)}/\n` +
    `   Restart the dev server so it opens the new file.\n`,
);
