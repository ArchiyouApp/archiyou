# Archiyou Server

The entire backend for the Archiyou platform: it serves the [Editor](../editor/),
persists and manages scripts, and executes scripts on the backend.
`Fastify, BullMQ, PostgreSQL, Drizzle ORM, Redis`

It runs from source via `tsx` — there is no build step for this package.

```bash
pnpm dev:server                 # from the repo root, server only on :4100
```

No configuration is needed for development: the server brings up its own database
on first run (see [Database](#database) below), seeds a `test` / `test1234` account,
and logs password-reset and verification emails to the console instead of sending
them. Every server variable is documented in the repo-root
[`.env.example`](../../.env.example).

## Database

PostgreSQL, and `SERVER_DATABASE_URL` picks how you get it:

| `SERVER_DATABASE_URL` | what runs |
|---|---|
| *unset* | **PGlite** under `./data/pgdata` — PostgreSQL compiled to WASM, in this process |
| `postgres://…` | a real PostgreSQL server |
| `memory://` | PGlite in RAM; what every test file sets for itself |

PGlite is the same Postgres: same SQL, same schema, same migrations, one connection
and nothing to install. It is what makes `git clone && pnpm dev` work with no
container and no configuration, and it is why connecting to a database that other
people also use is always something you did on purpose.

For a real server locally:

```bash
pnpm docker:dev     # postgres + redis on 127.0.0.1 (docker-compose.dev.yml)
```

then put this in `apps/server/.env` (gitignored):

```
SERVER_DATABASE_URL=postgres://archiyou:archiyou@localhost:5432/archiyou
# PGlite seeds the dev account for free; on a postgres:// URL it takes an explicit yes
SERVER_SEED_TEST_USER=true
SERVER_TEST_USER_PASSWORD=test1234
```

`pnpm --filter @archiyou/server db:migrate` creates the schema. After that, `psql`,
`pg_dump` and everything else work as usual.

### Two guards, because the database can be shared

Against a `postgres://` URL the server deliberately behaves differently from the way
it does on its own PGlite copy:

- **It will not migrate it.** `pnpm dev` used to migrate whatever it opened, which
  against a shared instance means a checkout sitting on a feature branch silently
  changing production's schema. A development process now compares the applied
  migrations with this checkout's and **refuses to start** if they differ, naming
  which side is ahead. `NODE_ENV=production` (the api container) still migrates on
  boot, as the deploy needs; so does anything on PGlite.
- **It will not seed the test user.** `test` / `test1234` are publicly known
  credentials and `test` is a plausible author handle; every dev machine writing that
  account into the central database is not a thing to leave on. Set
  `SERVER_SEED_TEST_USER=true` **and** `SERVER_TEST_USER_PASSWORD` to opt in.

The tests never read your `.env` for this: all of them set `memory://` explicitly, so
`pnpm test` cannot reach a database that matters however yours is configured.

### Roles

The api owns the schema; developers do not. Create the two roles once, on the server:

```sql
-- the api container: owns the tables, runs migrations
CREATE ROLE archiyou_app LOGIN PASSWORD '…';
ALTER DATABASE archiyou OWNER TO archiyou_app;

-- developers through the ssh tunnel: read and write rows, no DDL
CREATE ROLE archiyou_dev LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE archiyou TO archiyou_dev;
GRANT USAGE ON SCHEMA public TO archiyou_dev;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO archiyou_dev;
ALTER DEFAULT PRIVILEGES FOR ROLE archiyou_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO archiyou_dev;
```

`archiyou_dev` cannot `ALTER TABLE`, so the boot guard above is a clear message
rather than the only thing standing between a branch and production's schema.

The rest of this document is about running it in production.

## Deploying

The repo-root `docker-compose.yml` is a complete single-host deployment: Caddy
(automatic HTTPS) in front of the API, PostgreSQL, Redis, and the built editor served
as static files. The BullMQ execution worker is part of that stack
too, though it does nothing until an execution gate is opened in `.env` — see
"Server-side execution" in the root README. The compose file lives at the root rather
than in `apps/server/`
because it deploys the whole monorepo — it builds from the root context and
mounts `apps/editor/dist`. For local development there are two options.
`docker-compose.dev.yml` at the repo root is postgres + redis, no image build:
`pnpm docker:dev` starts them, then `pnpm dev` and
`pnpm dev:worker` run the API and the execution worker straight from source — use this
to work on the code. This directory's own `docker-compose.yml` instead runs api +
postgres + redis + worker in containers (`pnpm --filter @archiyou/server docker:dev`),
building the image and the editor first — use that to rehearse a deployment.

```bash
# 1. configure the deployment
cp .env.example .env
#    set SERVER_JWT_SECRET (openssl rand -base64 48), FRONTEND_URL,
#    REDIS_PASW and POSTGRES_PASW (both: openssl rand -base64 32)

# 2. point the hostnames in Caddyfile at your domain, then:
pnpm docker:prod          # == docker compose up -d
```

There is no build step to run: the api container installs dependencies and
builds the workspace on boot, from the mounted checkout. A deploy is therefore

```bash
git pull && git submodule update --init --recursive
docker compose restart api
```

and `docker compose build` is needed only when the base image itself changes.
Note that the first boot builds the editor from scratch — minutes, during which
caddy serves 404s — and that **the API does not accept connections until the
build finishes**. Subsequent restarts with no source change are immediate.

### What gets built, and when

`docker-entrypoint.sh` builds when any file under `apps/`, `packages/`,
`modules/` or the root manifests is newer than
`node_modules/.archiyou-build-stamp` — one `find` that stops at the first stale
file, so the up-to-date case costs milliseconds. It builds, in this order:

| Package | Output | Consumed by |
| --- | --- | --- |
| `packages/meshup` (a **submodule**) | `dist/` | the editor build — its package `exports` point at `dist`, not `src`, so this must come first |
| `apps/editor` | `dist/` | caddy, as `/srv/app` |
| `modules/*`, `modules/*/*` | `dist/bundle.js` | the server's `ModuleHost`, read in place |

Nothing else needs building: `apps/server` runs from source via `tsx`, and
`packages/{core,ui,types,module-sdk}` all export `src/`, so their consumers
compile the sources.

This is an explicit list rather than the root `pnpm build`, because **`turbo
build` currently fails outright**: `@archiyou/editor` and `@archiyou/ui` depend
on each other and turbo rejects the cyclic task graph. Break that cycle and the
entrypoint collapses back to a single `pnpm run build`.

Two things the build step deliberately does **not** do:

- **It does not inherit the container's environment.** The build runs under
  `env -i` with an explicit allowlist, because `apps/editor/vite.config.ts` sets
  `envPrefix: ['VITE_','SERVER_']` and this container is started with
  `env_file: .env` — without the scrub, every `SERVER_*` variable, including
  `SERVER_JWT_SECRET`, would be visible to Vite and inlinable into a bundle that
  ships to browsers. `SERVER_API_BASE_URL` is passed through (default `/api`,
  matching the prefix caddy strips) and is inlined at build time, so changing it
  means rebuilding: `ARCHIYOU_FORCE_BUILD=1`.
- **It does not update `modules/`.** That overlay is a separate, gitignored
  repository, so a root `git pull` leaves it untouched — pull it too, then
  restart, and the entrypoint rebuilds it.

Escape hatches: `ARCHIYOU_SKIP_BUILD=1` boots on whatever was built last (useful
if a build breaks on the server), `ARCHIYOU_FORCE_BUILD=1` always rebuilds. The
worker service skips the build automatically — its mount is read-only.

**`apps/editor/dist` is not committed.** Only the empty directory is, via a
`.gitkeep`: docker creates a missing bind-mount source as root, which would
leave the container's uid 1000 unable to build into it.

### What runs from where

| Runs from | Mounted into | Rebuild needed? |
| --- | --- | --- |
| `apps/editor/dist` | caddy `/srv/app` | built by the api container on boot |
| `Caddyfile` | caddy `/etc/caddy` | no — `docker compose restart caddy` |
| the whole checkout | api `/archiyou` | no |

The `apps/server/Dockerfile` image contains **no application code and no
`node_modules`** — just Node, pnpm and a build toolchain. Everything it runs
comes from the bind-mounted checkout, so a deploy is
`git pull && docker compose restart api`, and `docker compose build` is
needed only when the base image itself changes.

Dependencies come from the mount too, so `apps/server/docker-entrypoint.sh`
installs them on boot when needed — you never run `pnpm` on the host. It
installs when `node_modules/.pnpm` is absent (first deploy) or when
`pnpm-lock.yaml` is newer than the stamp it drops at
`node_modules/.archiyou-install-stamp` (a `git pull` changed dependencies).
Otherwise it is a no-op and startup is immediate. Installing inside the image
also means `better-sqlite3` — a native module, kept only for the one-off
SQLite→Postgres import — is compiled against the exact Node that loads it.

That install — and the build that follows it — writes into the mounted checkout
as uid 1000 (`USER node`), so the checkout must be writable by it: `sudo chown
-R 1000:1000 <checkout>` on the host. This is not optional now that the editor's
`dist/` is produced there rather than committed; a read-only checkout means the
entrypoint silently skips the build (that is how the worker service opts out)
and caddy serves whatever was there before. Installing by hand keeps the install
step quiet, but not the build:

```bash
docker compose run --rm --user 0 --entrypoint pnpm api install --frozen-lockfile
```

Note this installs the **whole workspace** — editor, Vite, the WASM packages —
not just the server's dependencies, because the mount is the whole monorepo.

The mount is the repo **root**, not `apps/server`: `apps/server` is a workspace
package whose `node_modules` are symlinks into `../../node_modules/.pnpm`, and
pnpm needs the root `package.json`, `pnpm-workspace.yaml` and lockfile. The
containers' `WORKDIR` is `/archiyou/apps/server`, which is what makes `pnpm
start` / `pnpm worker` resolve (from the workspace root they fail with
`ERR_PNPM_NO_SCRIPT_OR_SERVER` and `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`) and
what makes the relative paths in `.env` — thumbnails, logs, backup scratch — land in
`apps/server/data`. That directory is written by uid 1000 (`USER node`):
`chown -R 1000:1000 apps/server/data` on the host if the checkout is owned by someone
else.

Both `env_file:` and `${REDIS_PASW}` / `${POSTGRES_PASW}` interpolation resolve
relative to the compose file, so the `.env` belongs at the **repo root**. A missing one
is quiet, not loud: `${REDIS_PASW}` becomes an empty string and Redis starts with
`--requirepass ""`, and the `postgres` container refuses to initialise at all.

The compose project is pinned to `name: archiyou`, so the `redis_data` and `pg_data`
volumes keep the same names regardless of what the checkout directory is called. Don't
remove the pin — a rename orphans both the queue's persisted state and the script
database.

**The scripts live in the `pg_data` volume**, not in the checkout. `apps/server/data/`
in the checkout still holds the thumbnails, the logs and the backup scratch directory;
back up both (see below) and never `git clean -x` the latter.

**5432 is published on `127.0.0.1` only.** That is the one line in
`docker-compose.yml` not to "simplify": binding it to all interfaces puts the whole
script library on the internet behind one password. Developers reach it through
`pnpm db tunnel` (ssh), below.

One host serves the editor and proxies `/api/*` to the server, so there is no
cross-origin traffic and CORS never applies. Database migrations run
automatically on boot (in production; see [Database](#database) for why a dev
process does not).

Work through the checklist at the end of [SECURITY.md](../../SECURITY.md) before
exposing an instance to the internet.

### Backups

`pnpm admin:backup` uploads one timestamped `tar.gz` to any S3-compatible bucket
(AWS, Hetzner, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO).

**What is in it** is the `backupTargets` list in `apps/server/src/config.ts` — the
PostgreSQL database and the thumbnails today. That list is the authoritative answer,
and **anything not on it is treated as regenerable and will be lost on host failure**.
When a new kind of durable asset appears, add a line there; the script needs no other
change. `SERVER_BACKUP_EXTRA_PATHS=name:path,…` adds one without touching code.
Deliberately excluded: `data/cache` (regenerable execution results).

The database goes in as a `pg_dump -Fc` stream, taken inside PostgreSQL's own
repeatable-read snapshot — safe against a live server, **no downtime**, and restorable
one table at a time or into a scratch database. Every dump is read back with
`pg_restore --list` before it is uploaded (a truncated archive fails here, not during
a restore six months from now), and the archive's `MANIFEST.json` records the server
version, which migration the database matches, and the exact row counts to compare
against afterwards.

This needs `pg_dump`, `pg_restore` and `psql` on `PATH`, at **least the server's major
version** — `pg_dump` refuses to read a newer server. The `apps/server/Dockerfile`
installs `postgresql-client-17` from the PGDG repository for exactly that reason;
Debian's own package is too old for a `postgres:17` server.

Configure the `SERVER_BACKUP_*` block in the root `.env` (see
[`.env.example`](../../.env.example)), then **verify before scheduling**:

```bash
# from the repo root
# what would be included, and where it would go
docker compose exec api pnpm admin:backup --list
# validates credentials, endpoint and checksum settings — writes nothing
docker compose exec api pnpm admin:backup --dry
# the real thing
docker compose exec api pnpm admin:backup
```

Then schedule it from the **host** crontab (`crontab -e` as the user who owns the
deploy):

```cron
MAILTO=you@example.com
17 3 * * * cd /opt/archiyou && /usr/bin/docker compose exec -T api pnpm admin:backup >> /var/log/archiyou-backup.log 2>&1
```

Four things reliably go wrong here:

- **`-T` is mandatory.** Cron has no TTY, and `exec` without it fails with
  "the input device is not a TTY".
- **`cd` into the repo root first.** Compose resolves `.env` and relative paths
  from the compose file's directory; cron's working directory is `$HOME`.
- **Use an absolute `/usr/bin/docker`.** Cron's `PATH` is minimal.
- **A target must be visible inside the `api` container.** `exec` runs in the
  already-running container, which has `env_file: .env` and the `server_data`
  volume — so `SERVER_BACKUP_*` and `data/` are already there. A new asset path
  *outside* that volume must also be mounted into the `api` service, or the
  script cannot see it.

If the stack may be down at that hour, use `run --rm -T api pnpm admin:backup`
instead — same env and volume, in a throwaway container.

Exit codes matter, because they are what reaches `MAILTO`:

| Code | Meaning |
|---|---|
| `0` | Uploaded, and any pruning completed. |
| `1` | **Backup failed — no new archive exists.** This is the one that should wake you. |
| `2` | Misconfigured (missing bucket/credentials, unusable targets). Nothing was attempted. |
| `3` | The archive is safe; only pruning failed. Look at it Monday. |

**Retention.** After a *successful* upload, archives older than
`SERVER_BACKUP_KEEP_DAYS` (default 30) are deleted. The pruner only ever touches
keys matching its own exact `archiyou-YYYYMMDD-HHmmss.tar.gz` pattern under its
own prefix, always keeps the newest `SERVER_BACKUP_MIN_KEEP` regardless of age,
never empties the prefix, and never deletes more than
`SERVER_BACKUP_MAX_DELETE` in one run. Instances sharing a bucket must use
different `SERVER_BACKUP_S3_PREFIX` values or they will prune each other.

Note the same credentials upload *and* delete, so a compromised server can erase
its own history. If your provider supports lifecycle rules, the stronger setup is
`SERVER_BACKUP_PRUNE=false` plus a bucket lifecycle rule and a write-only key.

#### Restoring

```bash
# 1. fetch and inspect — this touches nothing
aws s3 --endpoint-url "$ENDPOINT" cp "s3://$BUCKET/$PREFIX/archiyou-20260806-031500.tar.gz" .
tar tzf archiyou-20260806-031500.tar.gz
mkdir restore && tar xzf archiyou-20260806-031500.tar.gz -C restore --strip-components=1

# 2. VERIFY BEFORE TOUCHING PRODUCTION — into a SCRATCH database, never the live one
cat restore/MANIFEST.json     # targets, server version, migrations, row counts
docker compose exec -T postgres pg_restore --list /dev/stdin < restore/db/archiyou.dump | head
docker compose exec -T postgres psql -U archiyou -d postgres -c 'CREATE DATABASE restore_check;'
docker compose exec -T postgres pg_restore -U archiyou -d restore_check --no-owner /dev/stdin \
  < restore/db/archiyou.dump
docker compose exec -T postgres psql -U archiyou -d restore_check \
  -c 'select count(*) from users;' -c 'select count(*) from script_versions;'
#    …compare those against MANIFEST.json → targets[db].rowCounts. Then drop it:
docker compose exec -T postgres psql -U archiyou -d postgres -c 'DROP DATABASE restore_check;'

# 3. the real restore. Stop the api so nothing writes while the database is replaced;
#    postgres itself stays up, because it is what does the restoring.
docker compose stop api worker

# 4. replace the contents of the live database. --clean --if-exists drops each object
#    before recreating it, so this is a replacement and not a merge with whatever is
#    there now. -1 wraps it in one transaction: it either all lands or none of it does.
docker compose exec -T postgres pg_restore -U archiyou -d archiyou \
  --clean --if-exists --no-owner -1 /dev/stdin < restore/db/archiyou.dump

# 5. the thumbnails are files in the checkout, not in the database
rm -rf apps/server/data/thumbnails && cp -a restore/thumbnails apps/server/data/thumbnails
sudo chown -R 1000:1000 apps/server/data/thumbnails

# 6. back up
docker compose start api worker
```

Step 2 is the part people skip and the part that matters: a dump that has never been
restored is a hope, not a backup. `MANIFEST.json` carries the row counts precisely so
that "did it all arrive" has an answer rather than a feeling. Do it against a scratch
database once a quarter.

`1000:1000` in step 5 is the `node` user the container runs as — root-owned thumbnail
files leave the API unable to write new ones.

### Working on a copy of production

`pnpm db` (from the repo root) is how a developer machine reaches the central
database over SSH — no S3 credentials, nothing installed on the server. Two commands:

```bash
pnpm db tunnel            # forward the remote 5432 to localhost and hold it open
pnpm db dump              # pg_dump -Fc on the server → apps/server/data/db-backups/<stamp>/
pnpm db --help            # every answer also has a flag
```

**`tunnel`** is what you want most of the time. Leave it running, and in another shell
point `SERVER_DATABASE_URL` at `localhost:5432`: the dev server, `psql`, `pnpm
test:parity` and anything else then work against the real library. 5432 is published on
the server's loopback interface only, so this is the access path, not a shortcut past
one. Remember what you are connected to — the two guards under
[Database](#two-guards-because-the-database-can-be-shared) stop the schema and the test
user from being changed, and nothing stops the rest.

**`dump`** takes a `pg_dump -Fc` inside the server's `postgres` container (so the
client version always matches) and streams it straight into
`apps/server/data/db-backups/<stamp>/`, keeping the newest `--keep` (default 5). It
verifies the `PGDMP` header before claiming success, so a file full of an ssh error
message is reported rather than kept. Restore it wherever you like:

```bash
docker exec -i archiyou-dev-postgres psql -U archiyou -d archiyou -c 'create database scratch;'
docker exec -i archiyou-dev-postgres pg_restore -U archiyou -d scratch --no-owner \
  < apps/server/data/db-backups/<stamp>/archiyou.dump
```

**Nothing is configured up front and no credential is ever stored.** It asks for the
server and your username; the *password* is asked for by `ssh` itself, so this script
never sees it — it cannot land in a file, in `ps` output, or in the environment. There
is deliberately no key-file setting and no `.env` block. For `dump` you are asked
**once**: the first connection is an ssh ControlMaster and every later command rides
the same authenticated socket, which is closed on the way out. (Where ssh can already
authenticate by itself — agent or `~/.ssh/config` — it just does not ask.) The
non-secret answers are remembered in the gitignored
`apps/server/data/.db-remote.json`, so the next run is two Enters.

Neither command writes to the remote database, and `dump` writes nothing outside
`db-backups/`.

Remember what you are reaching: this is production data, including user records. Treat
the tunnel, the copies and the backups directory accordingly.

### Why a script has no thumbnail

Script thumbnails are iso line drawings generated **in the browser** while the
share/publish dialog is open, sent along with the script, and validated against a
strict allowlist before the server writes them. Every step of that is silent on
purpose — a share must never fail, or wait, because of a preview — so when a
thumbnail does not appear there is nothing on screen and nothing in the database
to explain it.

`apps/server/data/logs/thumbnails.log` is that explanation. One JSON object per
line, both ends of the flow in one file:

```bash
tail -f apps/server/data/logs/thumbnails.log

# only the failures, in a readable form
jq -c 'select(.event=="rejected" or .event=="write-failed" or .step=="generate:error")' \
   apps/server/data/logs/thumbnails.log
```

`src:"client"` lines are the browser's own report of the background run
(`generate:start` → `generate:ok` / `generate:empty` / `generate:error`, then
`submit`); `src:"server"` lines say what arrived and what happened to it
(`received`, `stored`, `rejected`, `write-failed`, `removed`). The three usual
answers read directly off the file:

| What you see | What happened |
| --- | --- |
| `submit` with `state:"pending"`, then `received` with `bytes:0` | The user pressed Share before the background run finished — nothing failed; the preview simply was not ready yet. |
| `generate:empty` | The run produced no drawing: a 2D/docs-only script, or one whose drawing blew the 64 KB cap. `firstError` carries the runner's own message when there was one. |
| `rejected` | The SVG reached the server but is not something our exporter would emit; `reason` names the rule (see `services/svgSanitize.ts`). |

The log rotates at 5 MB (one generation) and is configured by
`SERVER_THUMBNAIL_LOG` — set it empty to switch the whole thing off.

