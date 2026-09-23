# SQLite → PostgreSQL for apps/server

| | |
|---|---|
| Dates | 2026-09-23 → (open) |
| Model | Claude Opus 5 (claude-opus-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode (review + plan), then as agent |
| Human | Mark van der Net: asked for the review, approved the plan, decided that dev points at the containerised Postgres and that PGlite stays the zero-config fallback, reviewed the code |
| Branch | `pg` |
| Session transcript | kept locally; the prompts are reproduced in full below |

Moves the script database from one embedded SQLite file per checkout to a single central
PostgreSQL instance that dev and prod share, with PGlite (in-process Postgres, WASM) as the
zero-config fallback and the test driver — so `git clone && pnpm dev` keeps working with no
container and no `.env`.

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

## SQLite → PostgreSQL for apps/server — review and migration plan

### Context

Scripts live in one embedded SQLite file per checkout (`apps/server/data/archiyou.db`). Production and
every dev machine each have their own copy, kept in step by `pnpm dbdownload` (ssh + `sqlite3 .backup` +
scp, overwriting the local file). The goal: **one central script database that dev and prod both use**, with
**standard ops tooling** (pg_dump, psql, remote inspection). Decisions taken: Postgres runs as a **container in
the existing docker-compose**, and the server becomes **Postgres-only** (no dual-dialect support).

### Verdict

Feasible and medium-sized. The database is small (3 tables, 6,858 script rows, 51 MB, ~49 SQL statements) and
well isolated: **only `apps/server` touches it**, all SQL sits in 3 store classes behind a clean layer, no route
contains SQL, the execution worker is DB-free, sessions are stateless JWTs, thumbnails are files. Ids are
uuid4 from JS — no autoincrement/rowid/upsert/FTS/BLOB/triggers/views/transactions to port.

The SQL text is ~a dozen fixes. The real cost is elsewhere, in this order:

1. **Sync → async.** better-sqlite3 is synchronous; every store method (≈40) and its **75 call sites** in 15 files become `await`ed.
2. **The backup subsystem is SQLite-native** (online backup API, `integrity_check`, `sqlite_master`, `-wal/-shm`) — a rewrite onto `pg_dump`, including most of `backup.test.ts`.
3. **Dev-against-prod safety.** Sharing one DB is a new risk class that SQLite never had (see "Guards" — two are real holes if skipped).
4. Tooling that treats the DB as a *file*: `scripts/db-download.mjs` (589 lines), the `archiyou-local-db` skill, parity test, two loose `.mjs` scripts, README/SECURITY.md.

Rough size: ~350 lines changed for async, ~250 for the dialect swap, ~150 temporary migration script,
backup −120/+90 (+ test rewrite ~400→~200), `db-download.mjs` 589→~120, ~80 infra, ~150 docs.
Deps: −`better-sqlite3`, −`@types/better-sqlite3`, +`pg`, +`@types/pg`, +`@electric-sql/pglite` (server-only;
**zero editor bundle impact**). Drizzle 0.45.2 already ships the `node-postgres` and `pglite` drivers. Bonus:
the `python3 make g++` Docker layer and the native-module ABI warnings go away.

### Design decisions

- **Driver: `pg` + `drizzle-orm/node-postgres`** (pool, max ~10) when `SERVER_DATABASE_URL` is `postgres://…`.
- **PGlite (in-process Postgres, WASM) when the URL is unset or `memory://`/`pglite://./data/pgdata`.** Same
  dialect, same schema, same migrations — so this is still "Postgres only", but it keeps `git clone && pnpm dev`
  zero-config (README promise), keeps CI container-free, and gives tests a fresh DB per file
  (`SERVER_DATABASE_URL=memory://` replaces the `mkdtempSync(...)/test.db` line in 8 test files).
  Connecting to the central DB is therefore an **explicit opt-in**, never a default.
- **One variable:** `SERVER_DATABASE_URL` replaces `SERVER_DATABASE_FILE` (`config.ts:58`, `drizzle.config.ts`, `.env.example`, compose).
- **Types:** `boolean` for `is_admin`/`starred`; `timestamptz DEFAULT now()` for the 5 timestamp columns
  (Drizzle `mode:'date'` still yields `Date`, so `.toISOString()`/`.getTime()` in `rowToData` are untouched, and psql shows real dates);
  **`jsonb`** for `tags`, `published`, `shared`, `users.modules`; **`json`** (not jsonb) for `params` and `presets` —
  `params` is a record keyed by param name and jsonb reorders object keys, which would silently reshuffle the param UI.
- **Indexes:** replace the btree-over-whole-JSON `sv_by_shared`/`sv_by_published` (INSERT fails past ~2.7 KB in Postgres)
  with partial indexes `(author, updated) WHERE published IS NOT NULL` / `… WHERE shared IS NOT NULL`. Keep `sv_file_version` (NULLs are distinct in PG too).
- **Migrations:** delete the 7 SQLite migrations + snapshots (backticks/PRAGMA/table-rebuild — unpatchable) and generate one fresh PG baseline `0000` with drizzle-kit.
- **Behaviour-neutral port.** FK `author → users.username`, content-addressed `code` dedupe (one file has 2,486 full copies) and
  `plans/SECRETS.md` tables are follow-ups, not part of this.

### Steps

Work on a `postgres` branch off `develop`. On approval: copy this plan to `plans/POSTGRES.md`, open the
ai-disclosure record, commit via `pnpm commit:ai`.

#### 1. Make the store API async — still on SQLite (behaviour-neutral, mergeable on its own)
Method signatures in `ScriptStore.ts`, `UserService.ts`, `FeedbackStore.ts` become `async`; bodies keep `.all()/.get()/.run()`.
Add `await` at the 75 call sites: `routes/{scripts,library,auth,admin,modules,execute,users,feedback}.ts`, `plugin.ts`
(`requireAdmin`), `translation/{translateJob,TranslationQueue}.ts`, `admin/*.admin.ts`, `admin/import-cadscripts.ts`, the skill's `save-script.ts`, and the unit tests.
All Fastify handlers are already `async`, so this is mechanical. Structural spots:
- `ScriptStore.ts:236-244` — query inside `Array.filter`; replace with one `inArray(fileId, …)` + `isNotNull(col)` query.
- `routes/library.ts:52-66` `accessors()` thunks now return promises (4 consumers).
- `UserService.deriveUsername` (`:129-139`) sync `while` loop → async loop.
- Move the 3 direct `db.select()` leaks in `admin/users.admin.ts:63`, `modules.admin.ts:92`, `import-cadscripts.ts:56-66` onto `userService`/`scriptStore` methods.
Run the full suite — green here means the risky mechanical part is done before any dialect change.

#### 2. Dialect swap
- `db/schema.ts`: `pgTable` from `drizzle-orm/pg-core` with the types/indexes above.
- `db/client.ts`: pick pool vs PGlite from the URL; drop PRAGMAs and the exported raw `sqlite` handle; export `closeDb()` for CLIs/tests.
- `db/migrate.ts` + `index.ts:21`: async `runMigrations()` using the matching migrator, with the boot guard below.
- Store bodies: `.all()` → `await q`; `.get()` → `(await q)[0]`; `.run()` → `await q`. Specific fixes:
  - `ScriptStore.ts:343,345` `json_extract(…)=1 / IS NOT 1` → `(published->>'validated')::boolean IS TRUE` / `IS NOT TRUE` (`IS NOT 1` is a syntax error in PG; `IS NOT TRUE` keeps the "key absent" rows).
  - `ScriptStore.ts:610` `/UNIQUE constraint failed/` → SQLSTATE `23505`, read from `e.cause` (Drizzle 0.45 wraps in `DrizzleQueryError`). Otherwise a duplicate version turns from 400 into 500.
  - `FeedbackStore.ts:122` `res.changes` → `.returning({id})` length.
  - `ScriptStore.ts:354`, `FeedbackStore.ts:97` counts → `.mapWith(Number)` (pg returns bigint as string).
  - `UserService.ts:117` un-lowered `like` → `ilike` (PG LIKE is case-sensitive; SQLite's was not).
- **Required for a remote DB:** `listForUser` (`:164-172`) loads every version row incl. `code` and dedupes in JS — ~14 MB per call for the largest author.
  Use `selectDistinctOn([fileId])…orderBy(fileId, desc(updated))`; give `latestRow` a `.limit(1)`. Library lists stay as-is (≤214 rows, semver ranking in JS).
- Tests: 8 files swap the temp-file line for `memory://` and `await runMigrations()`; `scriptStore.test.ts:346,365` direct `db` use gets `await`.
  `tests/parity/mesh-vs-brep-parity.test.ts:53-68` raw `rowid` query → `scriptStore`/Drizzle `DISTINCT ON`.
- Delete `apps/server/save-instruct_test-partstack.mjs` and `restore-instruct_test.mjs` (one-off, hard-coded scratch paths).

#### 3. One-off data migration — `src/admin/migrate-sqlite-to-pg.ts` (temporary; deleted with better-sqlite3 after cutover)
Opens the SQLite file read-only, converts rows (epoch ms → `Date`, JSON text → parsed, 0/1 → boolean), batch-inserts inside **one transaction**,
refuses a non-empty target, then verifies: per-table row counts, `md5(code)` per `script_versions.id`, and a JSON deep-equal sample of `params`/`published`.
Optional `--merge-scripts <local.db>`: insert only `script_versions` rows whose `id` is absent (uuid ids make this collision-free), skip `users`,
report `(file_id, version)` conflicts — for dev-only scripts that never reached prod.

#### 4. Infra
- `docker-compose.yml`: `postgres:17` service, named volume `pg_data`, healthcheck, on `archiyou-network`, **port bound to `127.0.0.1:5432` only**;
  api gets `SERVER_DATABASE_URL` + `depends_on: postgres healthy`; remove the vestigial `server_data` volume. Mirror in `apps/server/docker-compose.yml`. `docker-compose.dev.yml` unchanged (PGlite).
- Worker must stay DB-free: add `SERVER_DATABASE_URL`/`POSTGRES_*` to the denylist in `apps/server/scripts/check-worker-env.py`.
- `apps/server/Dockerfile`: drop `python3 make g++`, add `postgresql-client-17` (PGDG repo; `pg_dump` must be ≥ server major). Remove `better-sqlite3` from `pnpm-workspace.yaml:19-20`.
- CI (`.github/workflows/ci.yml`): unit tests keep running on PGlite; add one job with a `postgres:17` service that reruns the server suite with
  `SERVER_DATABASE_URL` set (fresh `CREATE DATABASE` per run) — catches PGlite/real-PG drift and exercises real `pg_dump`. `.gitleaks.toml`: allow the example URL.

#### 5. Backup and tooling
- `config.ts:423-468`: `BackupTargetKind` `'sqlite'` → `'postgres'`; drop the `-wal/-shm` excludes.
- `BackupService.ts`: `snapshotDatabase` (`:446-466`) → `pg_dump -Fc` to `SERVER_BACKUP_TMP_DIR`; `inspectSnapshot` (`:473-502`) → `pg_restore --list` + row counts from a `REPEATABLE READ` read;
  manifest `sqliteVersion` (`:779-785`) → `server_version`; migrations read from `drizzle.__drizzle_migrations`. `S3Backend`, dir targets, pruning unchanged.
- `tests/unit/backup.test.ts`: rewrite the SQLite sections (`:18-47, 416-500, 846-865`) with an injectable dump command; real `pg_dump` covered by the CI Postgres job.
- `scripts/db-download.mjs` → two small commands in the same file: `tunnel` (`ssh -N -L 5432:127.0.0.1:5432 host`) and `dump` (remote `pg_dump -Fc` streamed to `data/db-backups/<stamp>/`).
- `.agents/skills/archiyou-local-db`: `save-script.ts:80-84` uses `userService` instead of the raw handle; SKILL.md inspection/raw-SQL sections rewritten for psql/Drizzle,
  and it must **print the target DB before writing** — with a central DB, "save a demo script" can now mean production.

#### 6. Guards for dev sharing the prod DB (do not skip)
- **Boot migrations:** today `pnpm dev` migrates whatever it opens — a dev checkout with a newer schema would migrate production. Auto-migrate only for PGlite or `NODE_ENV=production`; otherwise compare applied vs journal and refuse to start with a clear message.
- **Test-user seeding:** `config.seedTestUser = !isProduction` (`config.ts:417`) would seed `test`/`test1234` into the central DB from any dev machine. Seed only on PGlite unless `SERVER_SEED_TEST_USER=true`.
- **Roles:** prod connects as owner `archiyou_app`; devs as `archiyou_dev` with DML only (no DDL) — created once at cutover via psql (runbook in README, no new file).
- **Network:** never publish 5432; dev access only through the ssh tunnel.
- **Tests** always set `memory://` explicitly so a developer's `.env` can never point the suite at the central DB.

#### 7. Cutover (prod downtime: minutes)
Rehearse first against a `pnpm dbdownload` copy. Then: final SQLite backup → `docker compose stop api` → `up -d postgres` → `db:migrate` →
run step 3 + verification → create roles → set `SERVER_DATABASE_URL` → start api → smoke test → take first `admin:backup` and do a restore drill into a scratch database.
Rollback = revert env/branch and restart; the `.db` file is left untouched. Remove better-sqlite3 + the migration script in a follow-up commit once stable.

#### 8. Docs
`README.md:70,92-94`, `apps/server/README.md` (`:5,13,122,146,159-165,179-190,255-330`), `SECURITY.md:133-146`, `.env.example:17-18,236`,
`docker-entrypoint.sh:117-137` comment, header comments in `schema.ts`/`client.ts`/`index.ts`.

### Verification
- After step 1: `pnpm --filter @archiyou/server test` green, still on SQLite.
- After step 2: same suite green on PGlite; CI Postgres job green on real PG; `pnpm dev` with no `.env` boots, seeds the test user, editor can save/publish/share.
- Behaviour checks that would otherwise fail silently: duplicate publish version → 400 (not 500); `/users/search` matches mixed-case input; `/admin/configurators` `total` is a number and the `validated=false` filter includes pre-feature rows; param order in the editor unchanged after a save/reload round trip.
- Migration: row counts 230 / 6,858 / 1, `md5(code)` match for every id, API responses for a sample of scripts byte-identical (dates included) between the SQLite and PG servers.
- Guards: dev server with a pending migration against a `postgres://` URL refuses to boot; `archiyou_dev` cannot `ALTER TABLE`; worker env check fails if the URL leaks.
- Ops: `admin:backup` → restore into a scratch database → counts match; `pnpm test:parity` runs through the tunnel.

## Review and decisions by the human

- **Dev points at the containerised Postgres.** `apps/server/.env` (gitignored) carries
  `SERVER_DATABASE_URL=postgres://…@localhost:5432/archiyou` and `docker-compose.dev.yml`
  gained the `postgres` service next to redis, so `pnpm docker:dev` brings both up. The
  plan had left the dev compose file untouched; PGlite remains what you get with no `.env`
  at all, and what the tests always use.
- **Postgres in both compose files**, superproject and `apps/server`, as asked.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
