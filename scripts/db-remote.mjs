/**
 * db — reach the central PostgreSQL database from a developer machine.
 *
 * The database is no longer a file in the checkout, so there is nothing to
 * "download" and replace. Two things are useful instead:
 *
 *   pnpm db tunnel    forward the remote 5432 to localhost:5432 and hold it open,
 *                     so `SERVER_DATABASE_URL=postgres://…@localhost:5432/archiyou`,
 *                     psql, and `pnpm test:parity` all just work.
 *   pnpm db dump      take a `pg_dump -Fc` on the server and stream it into
 *                     apps/server/data/db-backups/<stamp>/, for a local copy to
 *                     restore into a scratch database and poke at.
 *
 * Neither writes to the remote database, and `dump` writes nothing outside
 * db-backups/. 5432 is published on the server's loopback interface only (see
 * docker-compose.yml), so the tunnel is the access path — there is nothing to
 * connect to from outside.
 *
 * CREDENTIALS ARE NEVER STORED, anywhere. Server and username are asked for at the
 * prompt; the PASSWORD is asked for by `ssh` itself, straight from the terminal —
 * this script never sees it, so it cannot end up in a file, in `ps` output, or in
 * the environment. There is deliberately no key-file setting and no `.env` block.
 * (If ssh can already authenticate on its own — agent or ~/.ssh/config — it simply
 * does not ask.)
 *
 * Exit codes:
 *   0  tunnel closed cleanly / dump written
 *   1  FAILED — the connection or the dump did not work
 *   2  usage error, or nothing to prompt with (no terminal)
 *
 * Usage (from the repo root):
 *   pnpm db tunnel                       # asks for server and username
 *   pnpm db tunnel --port 15432          # use a different LOCAL port
 *   pnpm db dump                         # pg_dump -Fc into data/db-backups/<stamp>/
 *   pnpm db dump --host … --user … --db archiyou
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** Repo root — this file lives in <root>/scripts. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BACKUP_DIR = resolve(ROOT, 'apps/server/data/db-backups');
const HINTS_FILE = resolve(ROOT, 'apps/server/data/.db-remote.json');

/** The postgres container on the server, from its docker-compose.yml. */
const DEFAULT_CONTAINER = 'archiyou-postgres';

//// ARGS ////

const argv = process.argv.slice(2);
const COMMAND = argv.find((a) => !a.startsWith('--')) ?? '';
const KNOWN = ['--host', '--user', '--ssh-port', '--port', '--db', '--dbuser', '--container', '--keep', '--help'];
const VALUED = new Set(KNOWN.filter((k) => k !== '--help'));

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

function fail(code, message) {
  closeMaster();
  console.error(`\n❌ ${message}`);
  process.exit(code);
}

function usage(problem) {
  if (problem) console.error(`\n❌ ${problem}`);
  console.log(`
  pnpm db <command> [options]

    tunnel   forward the remote PostgreSQL port to localhost and hold it open
    dump     pg_dump -Fc on the server, streamed into apps/server/data/db-backups/

  --host <host>        server or ssh alias        --user <name>   ssh username
  --ssh-port <n>       ssh port (default 22)      --port <n>      LOCAL port for the tunnel (default 5432)
  --db <name>          database name (default archiyou)
  --dbuser <name>      PostgreSQL role (default archiyou)
  --container <name>   postgres container on the server (default ${DEFAULT_CONTAINER})
  --keep <n>           dumps to keep in db-backups (default 5; 0 = keep all)
`);
  process.exit(problem ? 2 : 0);
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  if (!KNOWN.includes(arg)) usage(`Unknown option ${arg}.`);
  if (VALUED.has(arg)) i++;
}
if (argv.includes('--help')) usage();
if (!['tunnel', 'dump'].includes(COMMAND)) usage(COMMAND ? `Unknown command "${COMMAND}".` : 'No command given.');

const SSH_PORT = flag('ssh-port') ?? '';
const LOCAL_PORT = Number(flag('port') ?? 5432);
const DB_NAME = flag('db') ?? 'archiyou';
const DB_USER = flag('dbuser') ?? 'archiyou';
const CONTAINER = flag('container') ?? DEFAULT_CONTAINER;
const KEEP = flag('keep') === undefined ? 5 : Number(flag('keep'));
if (!Number.isInteger(LOCAL_PORT) || LOCAL_PORT < 1) usage('--port must be a port number.');
if (!Number.isInteger(KEEP) || KEEP < 0) usage('--keep must be 0 or more.');

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

/** Only these two keys are ever persisted, so a password cannot leak in here even
 *  if one were somehow in scope. Failure to write is not worth a word. */
function saveHints(host, user) {
  try {
    mkdirSync(dirname(HINTS_FILE), { recursive: true });
    writeFileSync(HINTS_FILE, `${JSON.stringify({ host, user }, null, 2)}\n`);
  } catch {
    /* a convenience, never a requirement */
  }
}

const hints = loadHints();
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
rl?.on('SIGINT', cancel);

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
  console.log('\n\n   Cancelled. Nothing was touched.');
  process.exit(0);
}

let HOST = flag('host') ?? '';
let USER = flag('user') ?? '';

if (!HOST || !USER) {
  if (!interactive) {
    fail(2, 'No terminal to ask on. Pass --host and --user (ssh still needs a tty for the\n' +
            '   password, unless the host authenticates by key).');
  }
  console.log(`\n🔌 ${COMMAND} — which server?\n`);
  HOST = HOST || (await ask('server (host or ssh alias)', hints.host));
  if (!HOST) fail(2, 'No server given.');
  USER = USER || (await ask('ssh username', hints.user));
  if (!USER) fail(2, 'No username given.');
}
rl?.close();
saveHints(HOST, USER);

const TARGET = `${USER}@${HOST}`;

//// SSH ////

/** Single-quote for the REMOTE shell. Arguments are ours, but a space must not split a word. */
const sh = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/** UTC, matching the archive names `pnpm admin:backup` writes. */
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const CONTROL = join(tmpdir(), `dbrem-${process.pid}.sock`);
const portOpts = SSH_PORT ? ['-p', SSH_PORT] : [];
const baseOpts = ['-o', 'ConnectTimeout=20'];
let master = false;
const muxOpts = () => (master ? ['-o', `ControlPath=${CONTROL}`, '-o', 'ControlMaster=no'] : []);

/** One authenticated connection, shared by every command below, so the password is
 *  typed once. Unix-socket paths are length limited, hence the short name in the
 *  system temp dir rather than the repo. */
function openMaster() {
  // -f backgrounds only AFTER authenticating, so the password prompt still happens
  // here, in the foreground, on the terminal.
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
  console.warn('\n⚠️  This ssh cannot share one connection (no ControlMaster), so it will ask\n' +
               '   for the password again for each step.');
}

function closeMaster() {
  if (!master) return;
  master = false;
  spawnSync('ssh', ['-o', `ControlPath=${CONTROL}`, '-O', 'exit', TARGET], { stdio: 'ignore' });
}

process.on('SIGINT', () => { closeMaster(); process.exit(0); });

const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
};

//// TUNNEL ////

if (COMMAND === 'tunnel') {
  console.log(`\n🔌 forwarding ${TARGET}:5432 → localhost:${LOCAL_PORT}`);
  console.log('   Leave this running. In another shell:\n');
  console.log(`     SERVER_DATABASE_URL=postgres://${DB_USER}:<password>@localhost:${LOCAL_PORT}/${DB_NAME} pnpm dev:server`);
  console.log(`     psql postgres://${DB_USER}@localhost:${LOCAL_PORT}/${DB_NAME}\n`);
  console.log('   ⚠️  That is the CENTRAL database. A dev server will refuse to migrate it and');
  console.log('      will not seed the test user; everything else you do to it is real.\n');
  console.log('   Ctrl+C to close.\n');

  // -N: no remote command, just the forward. Foreground on purpose, so the process
  // is the tunnel and closing it closes the forward.
  const child = spawn(
    'ssh',
    [...portOpts, ...baseOpts, '-N', '-L', `127.0.0.1:${LOCAL_PORT}:127.0.0.1:5432`, TARGET],
    { stdio: 'inherit' },
  );
  child.on('exit', (code) => process.exit(code === null ? 0 : code));
  child.on('error', (err) => fail(2, `Could not start ssh: ${err.message}`));
}

//// DUMP ////

if (COMMAND === 'dump') {
  openMaster();

  // pg_dump runs INSIDE the postgres container, so the server needs no client
  // install and the version always matches. -Fc: the custom format, restorable
  // table by table and into a scratch database.
  const remote = `docker exec -i ${sh(CONTAINER)} pg_dump -Fc --no-owner --no-acl -U ${sh(DB_USER)} ${sh(DB_NAME)}`;

  const outDir = join(BACKUP_DIR, stamp);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${DB_NAME}.dump`);

  console.log(`\n📥 pg_dump ${DB_NAME} on ${TARGET} → apps/server/data/db-backups/${stamp}/\n`);

  const sink = createWriteStream(outFile);
  const child = spawn('ssh', [...portOpts, ...baseOpts, ...muxOpts(), TARGET, remote], {
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  child.stdout.pipe(sink);

  const code = await new Promise((done) => child.on('close', done));
  await new Promise((done) => sink.end(done));
  closeMaster();

  if (code !== 0) {
    rmSync(outDir, { recursive: true, force: true });
    fail(1, `pg_dump exited ${code}. Nothing was written.`);
  }

  // A dump that will not open is not a dump. The magic string is the cheapest
  // possible check and catches the common failure: ssh wrote an error message into
  // the file instead of an archive.
  const bytes = statSync(outFile).size;
  const head = readFileSync(outFile).subarray(0, 5).toString('latin1');
  if (head !== 'PGDMP') {
    rmSync(outDir, { recursive: true, force: true });
    fail(1, 'What came back is not a pg_dump archive (no PGDMP header).\n' +
            `   Check that the container "${CONTAINER}" is running on ${HOST}.`);
  }

  console.log(`   ✅ ${outFile} (${formatBytes(bytes)})\n`);
  console.log('   Restore it into a scratch database:\n');
  console.log(`     createdb scratch && pg_restore -d scratch --no-owner ${outFile}`);
  console.log('   …or into your dev container:\n');
  console.log(`     docker exec -i archiyou-dev-postgres psql -U archiyou -d archiyou -c 'create database scratch;'`);
  console.log(`     docker exec -i archiyou-dev-postgres pg_restore -U archiyou -d scratch --no-owner < ${outFile}\n`);

  //// PRUNE LOCAL DUMPS ////

  if (KEEP > 0 && existsSync(BACKUP_DIR)) {
    // Only ever directories matching our own stamp shape, newest KEEP retained.
    readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(KEEP)
      .forEach((old) => {
        rmSync(join(BACKUP_DIR, old), { recursive: true, force: true });
        console.log(`   pruned old dump db-backups/${old}`);
      });
  }
}
