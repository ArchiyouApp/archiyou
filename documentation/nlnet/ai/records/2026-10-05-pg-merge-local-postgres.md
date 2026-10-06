# Merge the Postgres branch into develop, local Postgres in Docker

| | |
|---|---|
| Dates | 2026-10-05 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: the first prompt asked for a diagnosis, the second gave the steps) |
| Human | Mark van der Net: wrote the prompts, decided to merge `pg` and to move the local database to PostgreSQL in Docker on a bind mount |
| Branch | `develop`, merging `pg` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Work (agent output; no separate plan)

### Diagnosis: tutorial copies in the workspace

The first prompt asked why playing a tutorial still filled the workspace with copies. The
fix of 2026-09-24 (35bf552, "Help: one script per tutorial, reused instead of copied",
record `2026-09-22-help-content-links.md`) had been committed on `pg` only, and `develop`
still called `createNewScript()` on every open. The local database held 116
`tutorial-simple-table` and 39 `tutorial-simple-table-more` files; 109 of the first had
been created in one 3-second burst on 2026-09-24, when the editor's sign-in sync pushed the
copies made while on `pg` (PGlite server) to the SQLite server after switching back.

The agent proposed: bring the `pg` fix over, reuse the newest copy when several exist,
and delete the other copies of the same tutorial on open. The second prompt answered by
merging `pg`, which brings the first step; the other two are still open.

### Merge of `pg` (16 commits) into `develop` (53 commits since the branch point)

Six files conflicted. `develop` had changed the SQLite-era `ScriptStore` (autosave
coalescing, a `conflict` error for a create of an existing file, `name`/`lines` in the
version history) while `pg` made the store async on PostgreSQL:

- `apps/server/src/services/ScriptStore.ts`: `develop`'s `saveVersion` (coalescing,
  `checkpoint`, nothing written for an unchanged save) in `pg`'s async form. The
  duplicate-row check matched SQLite's message text (`UNIQUE constraint failed:
  script_versions.id`); on Postgres it reads the violated constraint instead:
  `isUniqueViolation()` became `uniqueViolation()`, which returns the constraint name, and
  `script_versions_pkey` maps to `conflict` (409), any other unique violation to `invalid`.
- `apps/server/src/routes/scripts.ts`: `develop`'s `?checkpoint=1` route, awaited.
- `apps/server/tests/unit/scriptStore.test.ts`, `thumbnails.test.ts`: `develop`'s new
  tests (create conflict, eight autosave-merging cases, the checkpoint save) ported to the
  async store; `pg`'s PGlite `memory://` setup kept.
- `apps/editor/src/pages/editor.ts`: `develop`'s version. Its 226ff08 ("one run per edit,
  tool outputs in the same run") is a later rework of `pg`'s d98c712, including not
  adding the lean run's duration to the model run's.
- `documentation/nlnet/ai/README.md`: both sets of record rows; the two `pg` rows say
  "pg (merged into develop)".

The database schema was not changed on `develop`, so `pg`'s migrations stand as they are.

### Local PostgreSQL on a bind mount

- `docker-compose.dev.yml`: Postgres data in `apps/server/data/pgdata` (a bind mount,
  ignored by git) instead of the named volume `pg_data`. The container runs as
  `${UID:-1000}:${GID:-1000}`, so the files belong to the developer rather than root or
  the image's uid 999. `pnpm docker:dev` creates the directory first, because one Docker
  creates is owned by root and Postgres then cannot initialise it.
- PGlite's default directory (used when `SERVER_DATABASE_URL` is unset) moves from
  `./data/pgdata` to `./data/pglite`: two engines cannot share one data directory, and
  PGlite opening a Postgres 17 cluster would fail or damage it. Changed in `config.ts`,
  `.env.example`, both READMEs, the local-db skill and a test fixture string.

### Data migration (no code)

1. SQLite backed up with its online backup API to
   `apps/server/data/backups/archiyou-sqlite-20261005-213238.db`; integrity check ok.
2. The old Docker database (named volume `archiyou-dev_pg_data`, an import of
   2026-09-23 with 7,237 script versions) dumped to
   `apps/server/data/backups/docker-pg-volume-20260923.dump`; the volume itself is kept.
3. The PGlite directory of 2026-09-23 moved to `apps/server/data/backups/pglite-pgdata-20260923`.
4. `pnpm db:migrate`, then `pnpm admin:migrate-sqlite --from ./data/archiyou.db --write`:
   231 users, 12,430 script versions, 1 feedback; the importer's own check (counts, md5 of
   every script's code, 50 sampled rows deep-equal) passed.
5. An independent check compared every row and every column of all three tables between
   the SQLite backup and Postgres (JSON columns by value, timestamps in ms): 0 differences.

### Tests

- Server: 15 files, 320 tests, on PGlite.
- Core unit: 1670 passed; 2 timed out at 5 s under load (`Shelling.test.ts`,
  `importer.test.ts`) and pass when run alone.
- Typecheck: server and editor clean; core at 3 errors (pre-existing, under the budget of 156).
- Against the running stack on Docker Postgres: sign-in with a migrated password hash,
  script create / 409 on re-create / two autosaves merged into one row / checkpoint row /
  history / rename lookup / delete; the shared and published library endpoints; a
  validated published configurator executed through the BullMQ worker (on a temporary
  second API with `SERVER_EXECUTION_VALIDATED=1`, stopped afterwards); the editor opening a
  tutorial and running it.

## Review and decisions by the human

- Chose to merge `pg` rather than port the single tutorial fix.
- Asked for a backup before the migration, and for the Docker volume at
  `apps/server/data/pgdata`.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | (merge) | "Merge the pg work into the develop branch. …" |
