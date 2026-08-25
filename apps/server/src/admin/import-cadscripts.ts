/**
 * import-cadscripts — seed the DB with the core test cadscripts.
 *
 * The plain .js files in packages/core/tests/cadscripts/scripts are the same
 * scripts the editor stores as rows: the code itself, params declared inline
 * via $PARAMS.define(). This imports them as working (unversioned, unpublished,
 * unshared) scripts owned by `archiyou`:
 *
 *   name        = the filename without .js
 *   description = the second header comment line (`// <description>`), if any
 *
 * Idempotent: a script whose name already exists for the owner is skipped, so
 * re-running never duplicates or overwrites anything.
 *
 * Usage (from apps/server):
 *   pnpm admin:import-cadscripts [--dry] [--owner <handle>] [--dir <path>]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { scriptVersions, users } from '../db/schema';
import { scriptStore } from '../services/ScriptStore';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_DIR = resolve(HERE, '../../../../packages/core/tests/cadscripts/scripts');

//// ARGS ////

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const DRY = argv.includes('--dry');
const OWNER = (flag('owner') ?? 'archiyou').toLowerCase();
const DIR = resolve(flag('dir') ?? DEFAULT_DIR);

//// HELPERS ////

/** The `// <description>` on the second line of the header, if the file has one. */
function descriptionFromCode(code: string): string | undefined {
  const lines = code.split('\n', 3);
  const second = lines[1]?.trim();
  if (!second?.startsWith('//')) return undefined;
  const text = second.replace(/^\/\/\s?/, '').trim();
  return text || undefined;
}

/** Names already taken by this owner (lowercased), so we can skip them. */
function existingNames(owner: string): Set<string> {
  const rows = db
    .select({ name: scriptVersions.name })
    .from(scriptVersions)
    .where(eq(scriptVersions.author, owner))
    .all();
  return new Set(rows.map((r) => (r.name ?? '').toLowerCase()).filter(Boolean));
}

//// RUN ////

const owner = db.select().from(users).where(sql`lower(${users.username}) = ${OWNER}`).get();
if (!owner) {
  console.error(`No user "${OWNER}" — refusing to import scripts for a non-existent owner.`);
  process.exit(1);
}

const taken = existingNames(OWNER);
const files = readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();

console.log(`Importing ${files.length} cadscripts from ${DIR} as "${OWNER}"${DRY ? ' (dry run)' : ''}\n`);

let imported = 0;
let skipped = 0;

for (const file of files) {
  const name = basename(file, '.js');
  if (taken.has(name.toLowerCase())) {
    console.log(`  ⏭  ${name} — already exists, skipped`);
    skipped++;
    continue;
  }

  const code = readFileSync(resolve(DIR, file), 'utf8');
  const description = descriptionFromCode(code);

  if (DRY) {
    console.log(`  +  ${name} — would import (${code.length} chars)${description ? ` — "${description}"` : ''}`);
  } else {
    const saved = scriptStore.create(OWNER, { name, description, code, tags: [], params: {}, presets: {} });
    console.log(`  ✅ ${name} — imported (fileId ${saved.fileId})`);
  }
  taken.add(name.toLowerCase());
  imported++;
}

console.log(`\n${DRY ? 'Would import' : 'Imported'} ${imported}, skipped ${skipped}.`);
