/**
 * Save the partstack edit of instruct_test as a NEW version row.
 *
 * A row per save is how the app itself stores a script (new uuid, created == updated), so
 * this adds one rather than rewriting anything: the history stays, and undoing it is a
 * single delete by id.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DIR = '/tmp/claude-1000/-home-mvdnet-archiyou-archiyou/f5eb5082-873e-4f71-9e21-98fcb620de9a/scratchpad';
const DRY = process.argv.includes('--dry');

const db = new Database('./data/archiyou.db');
const latest = db.prepare(
  "select * from script_versions where name='instruct_test' order by updated desc limit 1").get();
if (!latest) { throw new Error('no instruct_test to base a version on'); }

const code = readFileSync(`${DIR}/instruct_test.current.js`, 'utf8');

if (!code.includes("layout('partstack'") || code.includes("layout('row'")) {
  throw new Error('the edited file is not the partstack one — refusing to save it');
}

const before = db.prepare("select count(*) n from script_versions where name='instruct_test'").get().n;
console.log(`${before} versions now; adding one (${code.length} chars, was ${latest.code.length})`);
if (DRY) { console.log('(dry run — nothing written)'); process.exit(0); }

const now = Date.now();
const id = randomUUID();

db.prepare(`insert into script_versions
  (id, file_id, author, name, description, details, version, tags, code, params, presets,
   published, shared, created, updated, thumbnail)
  values (@id, @file_id, @author, @name, @description, @details, @version, @tags, @code,
          @params, @presets, @published, @shared, @created, @updated, @thumbnail)`)
  .run({ ...latest, id, code, created: now, updated: now });

const after = db.prepare(
  "select id, updated, length(code) len from script_versions where name='instruct_test' order by updated desc limit 1").get();

console.log(`added ${after.id} (${after.len} chars)`);
console.log(`versions: ${before} -> ${db.prepare("select count(*) n from script_versions where name='instruct_test'").get().n}`);
console.log(`it is the newest: ${after.id === id}`);
console.log(`undo with:  delete from script_versions where id='${id}';`);
