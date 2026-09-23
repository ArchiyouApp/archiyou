/**
 * save-script.ts — write an Archiyou script into the local SQLite database.
 *
 * Goes through ScriptStore, so the payload is validated by the core Script model
 * and the row is shaped exactly like one the server would have written. Prefer
 * this over a raw INSERT.
 *
 * Run from anywhere:
 *   npx tsx <this file> --author archiyou --name object_test --code-file ./demo.js
 *
 * Options:
 *   --author <handle>     required; must already exist in the `users` table
 *   --name <name>         required; the script name shown in the editor
 *   --code-file <path>    required; the .js file to store as the script code
 *   --description <text>  optional
 *   --new-version         append a version to the existing file of that name
 *                         instead of creating a new file
 *   --db <path>           override the database file (else SERVER_DATABASE_FILE,
 *                         else apps/server/data/archiyou.db)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
{
    const i = argv.indexOf(`--${name}`);
    return (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const author      = flag('author');
const name        = flag('name');
const codeFile    = flag('code-file');
const description = flag('description');
const newVersion  = has('new-version');

if (!author || !name || !codeFile)
{
    console.error('usage: save-script.ts --author <handle> --name <name> --code-file <path> [--description <text>] [--new-version] [--db <path>]');
    process.exit(2);
}

const codePath = resolve(codeFile);
if (!existsSync(codePath)) { console.error(`No such code file: ${codePath}`); process.exit(2); }
const code = readFileSync(codePath, 'utf8');

// ── locate the repo, then the server package ─────────────────────────────────
// ScriptStore reads config.databaseFile, which is resolved against cwd — so the
// process has to be running inside apps/server before that module is imported.

function repoRoot(from: string): string
{
    let dir = from;
    while (dir !== dirname(dir))
    {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('Could not find the repo root (no pnpm-workspace.yaml above this file)');
}

const root      = repoRoot(dirname(new URL(import.meta.url).pathname));
const serverDir = join(root, 'apps', 'server');

const dbOverride = flag('db');
if (dbOverride) process.env.SERVER_DATABASE_FILE = resolve(dbOverride);

process.chdir(serverDir); // config resolves ./data/archiyou.db from here

// Dynamic imports: these must happen AFTER the chdir above. Note they are addressed
// by absolute path — this file lives outside any package, so a bare specifier like
// 'drizzle-orm' would not resolve. Both services go through Drizzle rather than a
// raw driver handle, so this script cannot drift from the schema the server writes.
const { ScriptStore } = await import(pathToFileURL(join(serverDir, 'src/services/ScriptStore.ts')).href);
const { userService } = await import(pathToFileURL(join(serverDir, 'src/services/UserService.ts')).href);

// ── guard: the author must be a real account ─────────────────────────────────

const account = await userService.findByUsername(author);
if (!account)
{
    console.error(`No user "${author}" in the database. Scripts are owned by a users.username handle.`);
    process.exit(1);
}

// ── write ────────────────────────────────────────────────────────────────────

const store = new ScriptStore();
const mine  = await store.listForUser(author) as Array<{ name?: string | null; fileId: string }>;
const existing = mine.find((s) => s.name === name);

if (existing && !newVersion)
{
    console.error(`"${name}" already exists for ${author} (fileId ${existing.fileId}).`);
    console.error('Pass --new-version to append a version to it instead.');
    process.exit(1);
}

// `description` is OMITTED when unset, never null: Script.fromData() validates
// it as an optional string and rejects an explicit null.
const payload: Record<string, unknown> = { name, code, tags: [], params: {}, presets: {} };
if (description) payload.description = description;

const saved = (existing && newVersion)
    ? await store.saveVersion(author, existing.fileId, payload)
    : await store.create(author, payload);

console.log(`${existing && newVersion ? 'new version of' : 'created'} "${name}" for ${author}`);
console.log(`  id     : ${saved.id}`);
console.log(`  fileId : ${saved.fileId}`);
console.log(`  code   : ${saved.code.length} bytes`);
