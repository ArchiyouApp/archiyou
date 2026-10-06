# Runtime image for @archiyou/server (API + execution worker).
#
# This image carries NO application code: docker-compose.yml bind-mounts the
# whole monorepo checkout at /archiyou, so deploying is `git pull` + restart
# rather than a rebuild. Consequences worth knowing:
#   - node_modules comes from the mount too, so the HOST must have run
#     `pnpm install` in the checkout. The entrypoint fails loudly if it has not.
#   - better-sqlite3 is still installed for the one-off SQLite→Postgres import
#     (src/admin/migrate-sqlite-to-pg.ts) and is a native module compiled by that
#     install, so the host's Node/glibc ABI must match this image (Node 22, Debian
#     bookworm). If it does not, run the install inside the image:
#       docker compose run --rm --entrypoint pnpm api install --frozen-lockfile
#     Both the dependency and its toolchain go once the cutover has settled.
FROM node:22-bookworm-slim

# postgresql-client: `pg_dump`/`pg_restore` for `pnpm admin:backup`, and psql for
# looking at the database from the api container. It comes from the PGDG repo rather
# than Debian's, because pg_dump refuses a server newer than itself and bookworm ships
# 15 against a postgres:17 server.
#
# python3/make/g++ is the toolchain for better-sqlite3 (see above) — remove it with
# that dependency.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 make g++ \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y curl gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Bake the pinned pnpm in. Without `prepare`, corepack fetches it from the
# registry on every container start — that is the "! Corepack is about to
# download …" line in the logs, and it makes startup depend on npm being up.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The monorepo is mounted at /archiyou; run from the server package itself so
# `pnpm start` / `pnpm worker` resolve against apps/server/package.json. (From
# the workspace root they fail: ERR_PNPM_NO_SCRIPT_OR_SERVER for start, and
# ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL for worker.) This cwd is also what makes the
# relative paths in .env — thumbnails, logs, backup scratch — land in apps/server/data.
WORKDIR /archiyou/apps/server

ENV NODE_ENV=production
EXPOSE 4100

COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop root. The worker executes user-authored scripts with no sandbox (see
# config.execution), so running that as uid 0 makes an already-serious hole
# worse.
#
# uid 1000 must be able to WRITE apps/server/data (thumbnails, logs, backup scratch).
# On the host:  sudo chown -R 1000:1000 apps/server/data
# — or set `user:` in docker-compose.yml to the checkout's owner.
USER node

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default = API; index.ts migrates the database on boot (see db/migrate.ts — in
# production it applies, in development against a shared server it only verifies).
# The worker service overrides this with `pnpm worker`.
CMD ["pnpm", "start"]
