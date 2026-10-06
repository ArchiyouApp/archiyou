---
name: archiyou-local-db
description: Write, list, update or delete Archiyou scripts in the script database (PostgreSQL, or in-process PGlite). Use when asked to save a script to the database, put a demo/test script under a user, add a script version, or inspect what scripts a user owns.
---

# Writing scripts to the Archiyou database

PostgreSQL. `SERVER_DATABASE_URL` says which one, and the default resolves against
**the server package's cwd** — so anything that touches it must run from `apps/server`,
or set that variable:

| `SERVER_DATABASE_URL` | what you get |
|---|---|
| unset | PGlite under `./data/pgdata` — Postgres in-process, this checkout's own |
| `postgres://…` | a real server: the dev container, **or the shared instance** |
| `memory://` | PGlite in RAM, gone when the process exits |

> ⚠️  **Check which one before writing.** It is no longer one file per checkout. If
> `apps/server/.env` points at a `postgres://` URL, "save a demo script" can mean
> saving it into a database other people — possibly production — read. `save-script.ts`
> prints the target first; read the line rather than scrolling past it.

## The data model in one paragraph

Everything lives in **one table, `script_versions`** — a row *is* a `ScriptData`.
Each save appends a **new row** with a new `id` sharing the file's `file_id`; a
file's "latest" is the newest `updated` for that `file_id`. Ownership is the
`author` column, holding a `users.username` handle — there is no join table.
`version` is a nullable semver: **null for ordinary working saves**, set only on
publish/share, and unique per `(file_id, version)`. `published` / `shared` null
means not published / not shared.

So: **new script = new `file_id` + new `id`. New version of an existing script =
same `file_id`, new `id`.**

## Saving a script (do this)

`scripts/save-script.ts` goes through `ScriptStore`, which validates the payload
with the core `Script` model and writes a row shaped exactly like one the server
would have produced. Run it from anywhere:

```bash
npx tsx .claude/skills/archiyou-local-db/scripts/save-script.ts \
  --author archiyou \
  --name object_test \
  --code-file ./path/to/demo.js \
  --description "What this script demonstrates"
```

| flag | |
|---|---|
| `--author <handle>` | required; must already exist in `users.username` |
| `--name <name>` | required; the name shown in the editor |
| `--code-file <path>` | required; the `.js` file to store as the code |
| `--description <text>` | optional |
| `--new-version` | append a version to the existing file of that name instead of creating a new one |
| `--db <url>` | override the database (a `postgres://` or `pglite://` URL) |

It refuses to overwrite: saving a name that already exists errors and tells you to
pass `--new-version`. It also checks the author exists first, because nothing else
does — `author` is a bare text column with no foreign key, so a typo silently
creates a script owned by nobody.

**Run the script through the cadscript harness before storing it.** A stored script
that throws is worse than no script, and this catches it in seconds:

```bash
cp demo.js packages/core/tests/cadscripts/scripts/_probe.js
cd packages/core && CADSCRIPT=_probe pnpm test:cadscripts
rm tests/cadscripts/scripts/_probe.js tests/outputs/cadscripts/test._probe.gltf
```

`CADSCRIPT=<name>` narrows the run to one script (see `run.cadscripts.test.ts`).
Running the suite rewrites files under `tests/outputs/`, some of which are tracked —
`git checkout -- packages/core/tests/outputs/` afterwards to drop the churn.

## Verifying

Read it back through the server's own reader, not raw SQL — that proves
normalization and validation accept the row, which is what the editor will do:

```bash
cd apps/server && npx tsx -e "
import { ScriptStore } from './src/services/ScriptStore';
import { closeDb, describeDatabase } from './src/db/client';
console.log('database:', describeDatabase());
const store = new ScriptStore();
const mine = await store.listForUser('archiyou');
const row = mine.find(s => s.name === 'object_test');
console.log(row ? (await store.getFile('archiyou', row.fileId)).code.length + ' bytes' : 'NOT FOUND');
await closeDb();
"
```

Every store method is `async` — forget an `await` and you get a `Promise`, not a row.

`listForUser(author)` is what the editor's script manager fetches, so appearing
there is the real "it worked" signal.

## Inspecting and undoing

Against a `postgres://` URL, `psql` is the shortest path — from the dev container:

```bash
docker exec -it archiyou-dev-postgres psql -U archiyou -d archiyou -c \
  "SELECT id, file_id, name, version, length(code) AS len, updated
     FROM script_versions WHERE author='archiyou' ORDER BY updated DESC LIMIT 10;"
```

Against PGlite there is no server to connect to, so go through Drizzle:

```bash
cd apps/server && npx tsx -e "
import { desc, eq } from 'drizzle-orm';
import { db, closeDb } from './src/db/client';
import { scriptVersions } from './src/db/schema';
console.table(await db.select({ id: scriptVersions.id, fileId: scriptVersions.fileId,
    name: scriptVersions.name, version: scriptVersions.version, updated: scriptVersions.updated })
  .from(scriptVersions).where(eq(scriptVersions.author, 'archiyou'))
  .orderBy(desc(scriptVersions.updated)).limit(10));
await closeDb();
"
```

Delete a script and all its versions — prefer `scriptStore.deleteFile(author, fileId)`,
which is ownership-checked. Raw, if you must:

```sql
DELETE FROM script_versions WHERE author = 'archiyou' AND name = 'object_test';
```

## Gotchas that actually bite

- **`description: null` fails validation.** `Script.fromData()` treats it as an
  optional *string* and rejects an explicit null. Omit the key instead. (The helper
  does this; a hand-rolled payload usually doesn't.)
- **`params` is `{}` for scripts whose params are declared in code.** The column
  holds *UI-authored* param definitions. A script using `$PARAMS.define(...)` /
  `$PARAMS.defineObject(...)` needs none — they arrive via `managedParams` at run
  time.
- **Timestamps are `timestamptz`**, so psql shows real dates and Drizzle hands you a
  `Date`. They were epoch-millisecond integers under SQLite; old snippets that divide
  by 1000 are now wrong.
- **`params` and `presets` are `json`, everything else jsonb.** Deliberate: jsonb
  reorders object keys, and `params` key order *is* the parameter order the editor
  renders. Do not "tidy" those two columns to jsonb.
- **No restart needed.** A new row shows up on the next request.
- **Close the connection in a one-off script.** `await closeDb()` — otherwise a pg
  pool keeps the process alive for its idle timeout.
- Owner-only lists need auth, so `curl` against the API returns 401 for
  `/scripts/<author>`. Verify through `ScriptStore` instead.

## Raw SQL fallback

Only when TypeScript can't run. This skips core validation, so the row can be subtly
wrong in ways the editor only reveals later. Requires a `postgres://` target — there is
no CLI for PGlite.

```sql
INSERT INTO script_versions
  (id, file_id, author, name, description, details, version, tags, code,
   params, presets, published, shared, thumbnail, created, updated)
VALUES (gen_random_uuid()::text,
        gen_random_uuid()::text,   -- reuse an existing file_id to add a version
        'archiyou', 'object_test', '…', NULL, NULL,
        '[]'::jsonb,
        pg_read_file('/path/to/demo.js'),   -- or paste the code as a literal
        '{}'::json, '{}'::json,
        NULL, NULL, NULL, now(), now());
```

`pg_read_file` is superuser-only and reads the *server's* filesystem, so from psql on
your own machine paste the code as a dollar-quoted literal (`$code$ … $code$`) instead.

## Where this skill lives

The skill is committed at `.agents/skills/archiyou-local-db/` (alongside the other
skills in this repo), and reached by Claude Code through a symlink — Claude Code
only scans `.claude/skills/`, which this repo gitignores. The symlink is not
committed, so each checkout needs it once:

```bash
mkdir -p .claude/skills
ln -s ../../.agents/skills/archiyou-local-db .claude/skills/archiyou-local-db
```

## Reference

- `apps/server/src/db/schema.ts` — the table, column by column, with the reasoning.
- `apps/server/src/services/ScriptStore.ts` — `create()`, `saveVersion()`,
  `listForUser()`, `getFile()`, `share()`, `publish()`.
- `apps/server/src/db/client.ts` — the shared Drizzle handle `db`, plus `closeDb()`,
  `describeDatabase()` and `isRemoteDatabase`.
- `plans/POSTGRES.md` — why the database moved off SQLite, and what PGlite is doing here.
