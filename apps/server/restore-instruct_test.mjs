/**
 * restore-instruct_test.mjs — undo an overwrite of instruct_test's version history.
 *
 * What happened: an UPDATE with `where name='instruct_test'` matched all 18 version rows
 * rather than only the newest, so every version's `code` and `updated` was replaced.
 *
 * What this does, in one transaction:
 *   1. restores all 18 rows' original `code` and `updated`, read out of the WAL-recovered
 *      snapshot in scratchpad (verified: 4 distinct variants, the newest being the user's
 *      own edit with columns:3 and the all().iso().move(2000) probe)
 *   2. inserts ONE new version row carrying that latest version plus the two script fixes
 *      from the debugging session (back panel behind the carcass, step 5 on a rear iso)
 *
 * Run from apps/server:  node <path>/restore-instruct_test.mjs
 * Dry run:               node <path>/restore-instruct_test.mjs --dry
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');

const LIVE = resolve('./data/archiyou.db');
const SNAPSHOT = '/tmp/claude-1000/-home-mvdnet-archiyou-archiyou/14efadcd-ca48-4894-9a17-c9d71a263609/scratchpad/state-before-update.db';
const MERGED = '/tmp/claude-1000/-home-mvdnet-archiyou-archiyou/14efadcd-ca48-4894-9a17-c9d71a263609/scratchpad/instruct_test-merged.js';

const src = new Database(SNAPSHOT, { readonly: true, fileMustExist: true });
const dst = new Database(LIVE);

const originals = src.prepare(
  "select id, code, updated from script_versions where name='instruct_test'").all();
const merged = readFileSync(MERGED, 'utf8');

const template = dst.prepare(
  "select * from script_versions where name='instruct_test' order by updated desc limit 1").get();

if (!originals.length || !template) { throw new Error('nothing to restore — check the paths'); }

console.log(`restoring ${originals.length} version rows`);
console.log(`then adding 1 new version (${merged.length} chars)`);
if (DRY) { console.log('(dry run — nothing written)'); process.exit(0); }

const restore = dst.prepare('update script_versions set code = ?, updated = ? where id = ?');
const insert = dst.prepare(`insert into script_versions
  (id, file_id, author, name, description, details, version, tags, code, params, presets,
   published, shared, created, updated, thumbnail)
  values (@id, @file_id, @author, @name, @description, @details, @version, @tags, @code,
          @params, @presets, @published, @shared, @created, @updated, @thumbnail)`);

const now = Date.now();
dst.transaction(() => {
  let n = 0;
  for (const r of originals) n += restore.run(r.code, r.updated, r.id).changes;
  console.log(`  restored ${n} rows`);
  insert.run({ ...template, id: randomUUID(), code: merged, created: now, updated: now });
  console.log('  added the corrected version as the newest');
})();

const after = dst.prepare(
  "select code, updated from script_versions where name='instruct_test'").all();
const latest = after.sort((a, b) => b.updated - a.updated)[0];
console.log(`\nrows: ${after.length}, distinct variants: ${new Set(after.map(r => r.code)).size}`);
console.log(`latest has the fixes: ${latest.code.includes('DEPTH + BOARD/2')
  && latest.code.includes('camera([1, 1, 0.8])')}`);
console.log(`latest keeps your edits: ${latest.code.includes('columns: 3')
  && latest.code.includes('all().iso().move(2000)')}`);
