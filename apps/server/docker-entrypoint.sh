#!/bin/bash
# bash, not sh: the stamp checks below use `-nt`, which is a bash test operator.
# The image ships no code — the monorepo checkout is bind-mounted at /archiyou
# (see apps/server/Dockerfile), so node_modules comes from the mount too.
#
# Boot sequence:
#   1. verify the mount is actually there (otherwise every later error is opaque)
#   2. install dependencies if they are missing or stale
#   3. build the workspace (editor SPA, packages, script modules) if it is stale
#   4. exec the real command (pnpm start / pnpm worker)
#
# Step 3 is why a deploy is just `git pull && docker compose restart api`: the
# editor's dist/ is NOT committed, and `docker compose build` only rebuilds this
# codeless base image. Note that the API does not answer until the build
# finishes — a cold build of the editor is minutes, not seconds.
set -e

REPO=/archiyou
STAMP="$REPO/node_modules/.archiyou-install-stamp"
BUILD_STAMP="$REPO/node_modules/.archiyou-build-stamp"

if [ ! -f "$REPO/apps/server/package.json" ]; then
  echo "FATAL: $REPO/apps/server/package.json not found." >&2
  echo "  The monorepo checkout is not mounted at $REPO." >&2
  echo "  docker-compose.yml must bind-mount the repo root:  - ./:$REPO" >&2
  exit 1
fi

# packages/meshup is a git SUBMODULE, and the editor cannot build without it.
# An uninitialised submodule is an empty directory, which fails much later as an
# unresolvable `@archiyou/meshup` import — say so here instead.
if [ ! -f "$REPO/packages/meshup/package.json" ]; then
  echo "FATAL: packages/meshup is empty — the git submodule is not initialised." >&2
  echo "  On the host, in the checkout:  git submodule update --init --recursive" >&2
  exit 1
fi

# ─── 2. dependencies ─────────────────────────────────────────────────────────
# Reasons to install. Missing store = never installed. Stamp older than the
# lockfile = a `git pull` changed dependencies since the last install, which
# would otherwise surface much later as a missing or wrong-version module.
need_install=''
if [ ! -d "$REPO/node_modules/.pnpm" ]; then
  need_install='node_modules is missing'
elif [ ! -f "$STAMP" ] || [ "$REPO/pnpm-lock.yaml" -nt "$STAMP" ]; then
  need_install='pnpm-lock.yaml changed since the last install'
fi

if [ -n "$need_install" ]; then
  echo "==> Installing dependencies ($need_install)" >&2

  # Needs write access to the mounted checkout. The container runs as uid 1000
  # (USER node); if the checkout is owned by root on the host this fails, and
  # the fix is on the host, not here.
  if ! pnpm install --frozen-lockfile --dir "$REPO"; then
    echo "FATAL: pnpm install failed." >&2
    echo "  If it could not write, the checkout is not owned by uid 1000:" >&2
    echo "    sudo chown -R 1000:1000 <checkout>" >&2
    echo "  Or install once by hand, then restart:" >&2
    echo "    docker compose run --rm --user 0 --entrypoint pnpm api install --frozen-lockfile" >&2
    exit 1
  fi

  touch "$STAMP"
  echo "==> Dependencies ready" >&2
fi

# ─── 3. build ────────────────────────────────────────────────────────────────
# What gets built, in this order:
#   packages/meshup  → dist/. Its package `exports` point at dist, not src, so
#                      the editor build cannot resolve @archiyou/meshup until
#                      this has run. Must come first.
#   apps/editor      → dist/, bind-mounted into caddy as /srv/app. Not in git.
#   modules/*, */*   → dist/bundle.js, read in place by ModuleHost. A no-op that
#                      exits 0 when the overlay is absent, as in a public
#                      checkout. NOTE these live in a separate, gitignored
#                      repository, so a root `git pull` does NOT update them —
#                      pull that checkout too.
#
# Not built, deliberately:
#   apps/server      — no build script; runs from source via tsx.
#   packages/core, ui, types, module-sdk — their `exports` point at src/, so
#                      consumers compile the sources. core HAS a build script,
#                      but nothing imports its dist.
#
# This is an explicit list rather than the root `pnpm build`, because `turbo
# build` currently refuses to run at all: @archiyou/editor and @archiyou/ui
# depend on each other, and turbo rejects the cyclic task graph. Fix that cycle
# and this collapses back to one `pnpm --dir "$REPO" run build`.
#
# Escape hatches:  ARCHIYOU_SKIP_BUILD=1 never builds (boot on whatever was built
# last, when a build breaks on the server); ARCHIYOU_FORCE_BUILD=1 always builds.
# The latter is how you pick up a changed SERVER_API_BASE_URL — that lives in the
# environment, not in a source file, so the staleness check cannot see it.

# Both ways of disabling the build SAY SO. A silent skip is indistinguishable
# from a build that decided it was up to date, and sends you hunting through the
# staleness check for a reason that was never there.
should_build=1
if [ "${ARCHIYOU_SKIP_BUILD:-}" = '1' ]; then
  should_build=0
  echo "==> Build DISABLED by ARCHIYOU_SKIP_BUILD=1 — booting on whatever was built last." >&2
# The worker service mounts the checkout read-only and has nothing to build.
# Testing apps/editor rather than $REPO because a read-only bind mount reports
# the mount point itself as unwritable, which is precisely the case to skip.
elif [ ! -w "$REPO/apps/editor" ]; then
  should_build=0
  echo "==> Build SKIPPED: $REPO/apps/editor is not writable by uid $(id -u)." >&2
  echo "    Expected on the worker (read-only mount). On the api it is a bug:" >&2
  echo "    the editor SPA will never be rebuilt and caddy keeps serving the old" >&2
  echo "    bundle, or 404s if there is none. Fix on the host:" >&2
  echo "      sudo chown -R 1000:1000 <checkout>/apps/editor" >&2
fi

if [ "$should_build" = '1' ]; then
  # Sources whose change means a rebuild is due. Deliberately not $REPO itself:
  # that would walk .git, caddy/data (Caddy rewrites certs) and apps/server/data
  # (thumbnails, logs and the backup scratch dir all change while the server runs),
  # so the build would never look up to date.
  sources=()
  for p in apps packages modules package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json; do
    [ -e "$REPO/$p" ] && sources+=("$REPO/$p")
  done

  need_build=''
  if [ "${ARCHIYOU_FORCE_BUILD:-}" = '1' ]; then
    need_build='ARCHIYOU_FORCE_BUILD=1'
  elif [ ! -f "$REPO/apps/editor/dist/index.html" ]; then
    need_build='apps/editor/dist is empty — nothing has been built in this checkout'
  elif [ ! -f "$BUILD_STAMP" ]; then
    need_build='no build stamp'
  else
    # One walk, stopping at the first file newer than the stamp: the question is
    # "is anything stale", not "what is stale". Prunes build output so that the
    # previous build's own dist/ does not read as a reason to build again.
    changed=$(find "${sources[@]}" \
      \( -name node_modules -o -name dist -o -name .turbo -o -name target \
         -o -name pkg -o -name data -o -name .git \) -prune -o \
      -newer "$BUILD_STAMP" -type f -print -quit 2>/dev/null)
    [ -n "$changed" ] && need_build="${changed#$REPO/} changed"
  fi

  if [ -n "$need_build" ]; then
    echo "==> Building workspace ($need_build)" >&2
    echo "    The API will not accept connections until this finishes." >&2

    # `env -i`: the build runs with an explicitly constructed environment, NOT
    # this container's. Two independent reasons, both load-bearing:
    #
    #  1. SECRETS. apps/editor/vite.config.ts sets envPrefix ['VITE_','SERVER_'],
    #     and this container is started with `env_file: .env` — so every
    #     SERVER_* variable, SERVER_JWT_SECRET included, is visible to Vite and
    #     inlinable into a bundle that ships to every browser. An allowlist is
    #     the only safe way round that; a denylist would leak the next secret
    #     someone adds to .env.
    #  2. SERVER_API_BASE_URL must be /api (caddy strips that prefix before
    #     proxying, see Caddyfile). Vite reads it from the environment at BUILD
    #     time and inlines it, so it cannot be changed without rebuilding.
    #
    # NODE_ENV is forced to production for the build regardless of how the
    # container was started, so the SPA gets minified, dev-warning-free output.
    build() {
      env -i \
        PATH="$PATH" \
        HOME="$HOME" \
        NODE_ENV=production \
        SERVER_API_BASE_URL="${SERVER_API_BASE_URL:-/api}" \
        COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
        TURBO_TELEMETRY_DISABLED=1 \
        pnpm --dir "$REPO" "$@"
    }

    # `--filter './modules/**'` matches nothing in a checkout without the module
    # overlay and exits 0 with a notice, so this needs no guard. Two levels of
    # glob because one repo may hold several modules (modules/private/fem).
    if   ! build --filter @archiyou/meshup build \
      || ! build --filter @archiyou/editor build \
      || ! build --filter './modules/**'  build; then
      echo "FATAL: build failed." >&2
      echo "  Skip it and boot on whatever was built last:  ARCHIYOU_SKIP_BUILD=1" >&2
      exit 1
    fi

    # Put back the tracked placeholder that keeps apps/editor/dist in git as an
    # empty directory (see .gitignore). Vite empties outDir on every build, which
    # deletes it — and a deleted tracked file makes `git pull` on the next deploy
    # complain about local changes.
    touch "$REPO/apps/editor/dist/.gitkeep"

    touch "$BUILD_STAMP"
    echo "==> Build ready" >&2
  fi
fi

exec "$@"
