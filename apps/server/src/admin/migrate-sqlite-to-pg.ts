/**
 * migrate-sqlite-to-pg — the one-off import of the old SQLite database.
 *
 * ⚠️  TEMPORARY. This file and the `better-sqlite3` dependency it needs go away in a
 * follow-up commit once the cutover has settled (plans/POSTGRES.md, step 7). Nothing
 * else in the server imports it.
 *
 * Usage (from apps/server; SERVER_DATABASE_URL names the TARGET):
 *
 *   pnpm admin:migrate-sqlite --from ./data/archiyou.db            # dry run by default
 *   pnpm admin:migrate-sqlite --from ./data/archiyou.db --write
 *   pnpm admin:migrate-sqlite --from ./dev-copy.db --merge-scripts # scripts only, skip clashes
 *
 * What it does and does not do:
 *
 *   - **Refuses a non-empty target** unless --merge-scripts. Running it twice by
 *     accident is a far more likely mistake than needing to force it.
 *   - **One transaction.** Either the whole library lands or none of it does; a
 *     half-imported database is not something anyone should have to reason about.
 *   - **Verifies afterwards** (see verify()): row counts per table, md5 of every
 *     script's `code` keyed by id, and a deep-equality sample of `params` and
 *     `published` — the two columns whose representation actually changed
 *     (JSON text → json/jsonb). A count alone would not catch a mangled blob.
 *   - **--merge-scripts** inserts only `script_versions` rows whose `id` is absent
 *     from the target and skips `users` entirely. Ids are uuid4, so "absent" is a
 *     safe test. It is for folding a developer's local-only scripts into the central
 *     database after the cutover; (file_id, version) collisions are reported and
 *     skipped rather than resolved, because only a person can say which one wins.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import 'dotenv/config';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';

import { closeDb, db, describeDatabase } from '../db/client';
import { feedback, scriptVersions, users } from '../db/schema';
import type { NewFeedbackRow, NewScriptVersionRow, NewUserRow } from '../db/schema';

//// ARGS ////

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name: string): boolean => argv.includes(`--${name}`);

if (has('help') || has('h')) {
  console.log(`
  pnpm admin:migrate-sqlite --from <file.db> [--write] [--merge-scripts] [--sample N]

    --from <file.db>   the SQLite database to read (required, opened read-only)
    --write            actually write; without it this is a dry run
    --merge-scripts    only insert script_versions rows whose id is not already
                       in the target; skip users, report (file_id, version) clashes
    --sample N         how many rows to deep-compare for params/published (default 50)

  The TARGET is SERVER_DATABASE_URL, exactly as the server reads it.
`);
  process.exit(0);
}

const FROM = resolve(flag('from') ?? './data/archiyou.db');
const WRITE = has('write');
const MERGE = has('merge-scripts');
const SAMPLE = Number(flag('sample') ?? 50);

if (!existsSync(FROM)) {
  console.error(`No such SQLite database: ${FROM}`);
  process.exit(2);
}

//// CONVERSION ////

/** Rows come back with the SQLite column names and SQLite's types. */
type SqliteRow = Record<string, unknown>;

/** SQLite stored every timestamp as epoch milliseconds; Postgres wants a Date.
 *  A null stays null — `email_verified_at` legitimately has them. */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return new Date(Number(v));
}

/** …and every JSON column as text. `mode: 'json'` parsed it on the way out; reading
 *  the file directly does not, so parse here. Anything unparseable is a corrupt row
 *  and must stop the import rather than land as a string. */
function toJson(v: unknown, where: string): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`${where}: column is not valid JSON: ${v.slice(0, 120)}`);
  }
}

/** SQLite booleans are 0/1 integers. */
const toBool = (v: unknown): boolean => v === 1 || v === true || v === '1';

function toUser(r: SqliteRow): NewUserRow {
  return {
    id: r.id as string,
    username: r.username as string,
    email: r.email as string,
    passwordHash: r.password_hash as string,
    name: (r.name as string | null) ?? null,
    createdAt: toDate(r.created_at) ?? new Date(0),
    emailVerifiedAt: toDate(r.email_verified_at),
    modules: (toJson(r.modules, `users ${r.id} .modules`) as string[] | null) ?? [],
    isAdmin: toBool(r.is_admin),
  };
}

function toScriptVersion(r: SqliteRow): NewScriptVersionRow {
  const at = (col: string) => `script_versions ${r.id} .${col}`;
  return {
    id: r.id as string,
    fileId: r.file_id as string,
    author: (r.author as string | null) ?? null,
    name: (r.name as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    details: (r.details as string | null) ?? null,
    version: (r.version as string | null) ?? null,
    tags: (toJson(r.tags, at('tags')) as string[] | null) ?? [],
    code: (r.code as string | null) ?? '',
    params: toJson(r.params, at('params')) as NewScriptVersionRow['params'],
    presets: toJson(r.presets, at('presets')) as NewScriptVersionRow['presets'],
    published: toJson(r.published, at('published')) as NewScriptVersionRow['published'],
    shared: toJson(r.shared, at('shared')) as NewScriptVersionRow['shared'],
    thumbnail: (r.thumbnail as string | null) ?? null,
    created: toDate(r.created) ?? new Date(0),
    updated: toDate(r.updated) ?? new Date(0),
  };
}

function toFeedback(r: SqliteRow): NewFeedbackRow {
  return {
    id: r.id as string,
    message: r.message as string,
    scriptId: (r.script_id as string | null) ?? null,
    fileId: (r.file_id as string | null) ?? null,
    scriptAuthor: (r.script_author as string | null) ?? null,
    scriptName: (r.script_name as string | null) ?? null,
    scriptVersion: (r.script_version as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    username: (r.username as string | null) ?? null,
    starred: toBool(r.starred),
    created: toDate(r.created) ?? new Date(0),
  };
}

const md5 = (s: string): string => createHash('md5').update(s, 'utf8').digest('hex');

/** Rows per INSERT. Postgres caps a statement at 65535 bound parameters and
 *  script_versions binds 16 per row, so this leaves ample headroom while still
 *  being one round trip per few hundred scripts. */
const BATCH = 200;

/** Split into batches; the caller inserts each. Sequential, because they share one
 *  transaction and cannot overlap anyway. */
function batches<T>(rows: T[]): T[][] {
  return Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) => rows.slice(i * BATCH, (i + 1) * BATCH));
}

//// VERIFY ////

async function verify(source: Database.Database, expected: {
  users: number; scriptVersions: number; feedback: number;
}): Promise<boolean> {
  const problems: string[] = [];
  const n = sql<number>`count(*)`.mapWith(Number);

  const got = {
    users: (await db.select({ n }).from(users))[0]?.n ?? 0,
    scriptVersions: (await db.select({ n }).from(scriptVersions))[0]?.n ?? 0,
    feedback: (await db.select({ n }).from(feedback))[0]?.n ?? 0,
  };
  (Object.keys(expected) as Array<keyof typeof expected>).forEach((k) => {
    if (got[k] !== expected[k]) problems.push(`${k}: expected ${expected[k]} rows, found ${got[k]}`);
  });

  // Every script's code, byte for byte. `code` is the only column that actually
  // matters to a user and the only one big enough to be truncated silently.
  const sourceHashes = new Map<string, string>(
    (source.prepare('SELECT id, code FROM script_versions').all() as SqliteRow[])
      .map((r) => [r.id as string, md5((r.code as string | null) ?? '')]),
  );
  const targetRows = await db.select({ id: scriptVersions.id, code: scriptVersions.code }).from(scriptVersions);
  const mismatched = targetRows.filter((r) => sourceHashes.get(r.id) !== md5(r.code));
  if (mismatched.length) {
    problems.push(`code md5 differs for ${mismatched.length} version(s), e.g. ${mismatched[0].id}`);
  }
  const missing = [...sourceHashes.keys()].filter((id) => !targetRows.some((r) => r.id === id));
  if (missing.length) problems.push(`${missing.length} version(s) never arrived, e.g. ${missing[0]}`);

  // The JSON columns: a sample, deep-compared. `params` and `published` are the two
  // whose storage changed (text → json/jsonb) and the two the editor actually reads.
  const sampleRows = source
    .prepare('SELECT id, params, published FROM script_versions WHERE params IS NOT NULL ORDER BY updated DESC LIMIT ?')
    .all(SAMPLE) as SqliteRow[];
  const byId = new Map(
    (await db.select({ id: scriptVersions.id, params: scriptVersions.params, published: scriptVersions.published })
      .from(scriptVersions)).map((r) => [r.id, r]),
  );
  sampleRows.forEach((r) => {
    const target = byId.get(r.id as string);
    if (!target) return; // already reported as missing
    (['params', 'published'] as const).forEach((col) => {
      const before = JSON.stringify(toJson(r[col], `sample ${r.id} .${col}`));
      const after = JSON.stringify(target[col] ?? null);
      // Stringify order matters here, and that is the point: `params` key order is the
      // editor's parameter order, which is exactly what a jsonb column would have lost.
      if (before !== after) problems.push(`${col} differs for ${r.id}`);
    });
  });

  if (problems.length === 0) {
    console.log(`\n✅ verified: ${got.users} users, ${got.scriptVersions} script versions, ${got.feedback} feedback`);
    console.log(`   code md5 matches for all ${targetRows.length} versions`);
    console.log(`   params/published deep-equal for ${sampleRows.length} sampled rows`);
    return true;
  }
  console.error('\n❌ verification FAILED:');
  problems.slice(0, 20).forEach((p) => console.error(`   ${p}`));
  if (problems.length > 20) console.error(`   …and ${problems.length - 20} more`);
  return false;
}

//// RUN ////

const source = new Database(FROM, { readonly: true });

console.log(`from : ${FROM}`);
console.log(`to   : ${describeDatabase()}`);
console.log(`mode : ${MERGE ? 'merge-scripts' : 'full import'}${WRITE ? '' : '  (DRY RUN — pass --write)'}\n`);

const srcUsers = source.prepare('SELECT * FROM users').all() as SqliteRow[];
const srcScripts = source.prepare('SELECT * FROM script_versions').all() as SqliteRow[];
const srcFeedback = source.prepare('SELECT * FROM feedback').all() as SqliteRow[];
console.log(`source: ${srcUsers.length} users, ${srcScripts.length} script versions, ${srcFeedback.length} feedback`);

const existingScripts = await db.select({ id: scriptVersions.id, fileId: scriptVersions.fileId, version: scriptVersions.version })
  .from(scriptVersions);
const existingUsers = await db.select({ id: users.id }).from(users);

if (!MERGE && (existingScripts.length > 0 || existingUsers.length > 0)) {
  console.error(
    `\nRefusing to import into a non-empty database (${existingUsers.length} users, ` +
    `${existingScripts.length} script versions).\n` +
    'Use --merge-scripts to add only the script versions it does not already have, or\n' +
    'point SERVER_DATABASE_URL at an empty database.',
  );
  await closeDb();
  process.exit(1);
}

let toInsertUsers: NewUserRow[] = [];
let toInsertScripts: NewScriptVersionRow[] = [];
let toInsertFeedback: NewFeedbackRow[] = [];

if (MERGE) {
  const haveId = new Set(existingScripts.map((r) => r.id));
  // A (file_id, version) already taken by a DIFFERENT row would hit the unique index
  // and abort the whole transaction, so those are dropped and listed instead.
  const haveFileVersion = new Set(existingScripts.filter((r) => r.version).map((r) => `${r.fileId}\u0000${r.version}`));

  const candidates = srcScripts.filter((r) => !haveId.has(r.id as string));
  const clashes = candidates.filter((r) => r.version && haveFileVersion.has(`${r.file_id}\u0000${r.version}`));
  const clashIds = new Set(clashes.map((r) => r.id as string));
  toInsertScripts = candidates.filter((r) => !clashIds.has(r.id as string)).map(toScriptVersion);

  console.log(`merge: ${srcScripts.length - candidates.length} already present, ` +
              `${toInsertScripts.length} to insert, ${clashes.length} skipped on (file_id, version) clash`);
  clashes.slice(0, 20).forEach((r) => console.log(`   clash: ${r.author}/${r.name}:${r.version}  (${r.id})`));
  if (clashes.length > 20) console.log(`   …and ${clashes.length - 20} more`);
} else {
  toInsertUsers = srcUsers.map(toUser);
  toInsertScripts = srcScripts.map(toScriptVersion);
  toInsertFeedback = srcFeedback.map(toFeedback);
}

if (!WRITE) {
  console.log(`\nDry run: would insert ${toInsertUsers.length} users, ` +
              `${toInsertScripts.length} script versions, ${toInsertFeedback.length} feedback.`);
  console.log('Pass --write to do it.');
  source.close();
  await closeDb();
  process.exit(0);
}

const started = Date.now();
await db.transaction(async (tx) => {
  // Users first: `author` is a handle, and although there is no FK yet (a follow-up,
  // see plans/POSTGRES.md) the order is what a future one would need.
  for (const batch of batches(toInsertUsers)) await tx.insert(users).values(batch);
  for (const batch of batches(toInsertScripts)) await tx.insert(scriptVersions).values(batch);
  for (const batch of batches(toInsertFeedback)) await tx.insert(feedback).values(batch);
});
console.log(`\ninserted in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const ok = MERGE
  // A merge deliberately leaves rows the source does not have, so the full row-count
  // and md5 comparison does not apply; the insert either committed or it did not.
  ? true
  : await verify(source, {
    users: srcUsers.length,
    scriptVersions: srcScripts.length,
    feedback: srcFeedback.length,
  });

source.close();
await closeDb();
process.exit(ok ? 0 : 1);
