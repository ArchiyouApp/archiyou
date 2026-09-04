---
name: archiyou-local-db
description: Write, list, update or delete Archiyou scripts in the local SQLite database (apps/server/data/archiyou.db). Use when asked to save a script to the local database, put a demo/test script under a user, add a script version, or inspect what scripts a user owns.
---

# Writing scripts to the local Archiyou database

The local database is one SQLite file, `apps/server/data/archiyou.db` (WAL mode).
Path comes from `SERVER_DATABASE_FILE`, defaulting to `./data/archiyou.db` resolved
against **the server package's cwd** — so anything that touches it must run from
`apps/server`, or set that env var.

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
| `--db <path>` | override the database file |

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
const store = new ScriptStore();
const mine = store.listForUser('archiyou');
const row = mine.find(s => s.name === 'object_test');
console.log(row ? store.getFile('archiyou', row.fileId).code.length + ' bytes' : 'NOT FOUND');
"
```

`listForUser(author)` is what the editor's script manager fetches, so appearing
there is the real "it worked" signal.

## Inspecting and undoing

No `sqlite3` CLI on this machine — use better-sqlite3 from `apps/server`:

```bash
cd apps/server && node -e "
const db = require('better-sqlite3')('./data/archiyou.db', { readonly: true });
console.log(db.prepare(\"SELECT id, file_id, name, version, length(code) len, datetime(updated/1000,'unixepoch') upd FROM script_versions WHERE author='archiyou' ORDER BY updated DESC LIMIT 10\").all());
"
```

Delete a script and all its versions (drop `readonly`):

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
- **Timestamps are epoch milliseconds**, not seconds — divide by 1000 for
  `datetime(...)`.
- **JSON columns** (`tags`, `params`, `presets`, `published`, `shared`) are stored
  as JSON text. Writing raw SQL means `JSON.stringify` on every one of them.
- **No restart needed.** The server opens the file per query; a new row shows up on
  the next request.
- **`.db-wal` / `.db-shm` next to the file are normal** — WAL mode. Don't delete
  them or copy the `.db` alone while the server is running.
- Owner-only lists need auth, so `curl` against the API returns 401 for
  `/scripts/<author>`. Verify through `ScriptStore` instead.

## Raw SQL fallback

Only when TypeScript can't run. This skips core validation, so the row can be
subtly wrong in ways the editor only reveals later.

```js
const crypto = require('node:crypto');
const db = require('better-sqlite3')('./data/archiyou.db');
const now = Date.now();
db.prepare(`INSERT INTO script_versions
  (id, file_id, author, name, description, details, version, tags, code,
   params, presets, published, shared, thumbnail, created, updated)
  VALUES (@id, @file_id, @author, @name, @description, NULL, NULL, @tags, @code,
          @params, @presets, NULL, NULL, NULL, @created, @updated)`)
  .run({
    id: crypto.randomUUID(),
    file_id: crypto.randomUUID(),   // reuse an existing file_id to add a version
    author: 'archiyou',
    name: 'object_test',
    description: '…',
    tags: JSON.stringify([]),
    code: require('node:fs').readFileSync('./demo.js', 'utf8'),
    params: JSON.stringify({}),
    presets: JSON.stringify({}),
    created: now, updated: now,
  });
```

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
- `apps/server/src/db/client.ts` — the shared handle; exports both `db` (Drizzle)
  and `sqlite` (raw better-sqlite3).
