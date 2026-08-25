# Runtime image for @archiyou/server (API + execution worker).
#
# This image carries NO application code: docker-compose.yml bind-mounts the
# whole monorepo checkout at /archiyou, so deploying is `git pull` + restart
# rather than a rebuild. Consequences worth knowing:
#   - node_modules comes from the mount too, so the HOST must have run
#     `pnpm install` in the checkout. The entrypoint fails loudly if it has not.
#   - better-sqlite3 is a native module, compiled by that install and loaded
#     here, so the host's Node/glibc ABI must match this image (Node 22,
#     Debian bookworm). If it does not, run the install inside the image:
#       docker compose run --rm --entrypoint pnpm api install --frozen-lockfile
FROM node:22-bookworm-slim

# Toolchain for native modules (better-sqlite3) + certs. Kept even though the
# install normally happens on the host, so the recovery command above works.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bake the pinned pnpm in. Without `prepare`, corepack fetches it from the
# registry on every container start — that is the "! Corepack is about to
# download …" line in the logs, and it makes startup depend on npm being up.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The monorepo is mounted at /archiyou; run from the server package itself so
# `pnpm start` / `pnpm worker` resolve against apps/server/package.json. (From
# the workspace root they fail: ERR_PNPM_NO_SCRIPT_OR_SERVER for start, and
# ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL for worker.) This cwd is also what makes
# SERVER_DATABASE_FILE=./data/archiyou.db land in apps/server/data.
WORKDIR /archiyou/apps/server

ENV NODE_ENV=production
EXPOSE 4100

COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop root. The worker executes user-authored scripts with no sandbox (see
# config.execution), so running that as uid 0 makes an already-serious hole
# worse.
#
# uid 1000 must be able to WRITE apps/server/data (SQLite db + WAL journal).
# On the host:  sudo chown -R 1000:1000 apps/server/data
# — or set `user:` in docker-compose.yml to the checkout's owner.
USER node

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default = API; index.ts runs DB migrations on boot. The worker service
# overrides this with `pnpm worker`.
CMD ["pnpm", "start"]
