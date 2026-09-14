# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Email **info@archiyou.com** with `SECURITY` in the subject. Include what you
found, how to reproduce it, and what an attacker could achieve. We will confirm
receipt, keep you posted while we work on it, and credit you in the fix unless
you would rather stay anonymous.

Archiyou is a small project — please allow a reasonable window for a fix before
disclosing publicly.

## Known limitations you should read before self-hosting

These are design characteristics, not undisclosed bugs. Anyone running their own
instance needs to know about them.

### Script execution is not sandboxed

The script Runner compiles user script source with `new AsyncFunction`
(`packages/core/src/runner/Runner.ts`). There is no `vm`, no isolate, and no
separate process.

- **In the browser** this runs inside a Web Worker. That worker cannot reach
  `document` or `localStorage`, which is the boundary the editor relies on.
- **On the server** there is no such boundary. A script executed by the worker
  process gets full Node capability: `fs`, `child_process`, network,
  `process.env`.

Server-side execution is therefore **disabled by default**. `POST
/scripts/published/execute/...` has two independent gates and both ship off; with
neither set, every request 403s.

1. **Trusted authors.** An authenticated caller, where the *script's* author appears
   in `SERVER_EXECUTION_AUTHORS` (ships empty). Coarse-grained: it trusts everything
   that author ever publishes, including code pushed after you added them.
2. **Admin-validated scripts.** `SERVER_EXECUTION_VALIDATED=1` plus a specific
   published version marked `published.validated` by an admin. The caller may be
   **anonymous** — a published configurator's visitor has no account — so this path
   is per-IP rate limited (`SERVER_EXECUTION_RATE_LIMIT`).

The second path deliberately trades caller identity for code review. What is being
trusted is one immutable `(fileId, version)` snapshot: a published row's `code` never
changes, publishing a new version starts unvalidated, and `validated` is writable only
by an admin — `ScriptStore.toRow()` forces it off on every insert, so a client cannot
publish itself into server-side execution. **Validate a script only after reading its
code**; the `/admin` screen shows the source for exactly that reason. Anonymous
execution is still arbitrary code running unsandboxed in the worker, so keep the
container hardening below.

The worker that runs those scripts is part of the standard `docker-compose.yml` stack,
so it starts with everything else. **That on its own enables nothing**: with both gates
above unset the API never enqueues a job and the worker idles on an empty queue. The
`.env` settings are the switch, not the container.

Keep the hardening on that service: it runs as a non-root user with all capabilities
dropped, gets `cpus`/`mem_limit`/`pids_limit`, mounts the code read-only, and is
deliberately given a minimal environment that excludes `SERVER_JWT_SECRET` and the
Mailgun key. That last rule is enforced in CI against the rendered config
(`apps/server/scripts/check-worker-env.py`).

`SERVER_EXECUTION_TIMEOUT_MS` bounds a run, but **only partially**: script code
shares the worker's event loop, so a tight synchronous loop (`while(true){}`)
starves the timer and will not be interrupted. The container limits and BullMQ's
stall detection are what contain that case.

Replacing this with a real isolate is tracked as an open issue.

### Third-party scripts in the browser

A published configurator runs another author's script in the viewer's session.
Mitigations in place:

- script-produced SVG is sanitised with DOMPurify before rendering
- dynamic param behaviours are only `new Function`-hydrated for scripts the
  signed-in user owns, never for foreign ones
- the importer parses pasted script data without evaluating it
- the deployed CSP (the repo-root `Caddyfile`) constrains what a script can reach

Note that the CSP must allow `'unsafe-eval'`, because that is how the Runner
works. Session tokens are JWTs held in `localStorage`, so any XSS that does get
through can read one.

### Sessions

Tokens are stateless JWTs with a 7-day lifetime and **no revocation list**. A
leaked token stays valid until it expires; there is no way to invalidate it
server-side. Refresh tokens plus revocation are tracked as an open issue.

### The asset proxy

`GET /proxy?url=` is intentionally unauthenticated so browser scripts can
`$import()` remote assets that CORS would otherwise block. It validates against
SSRF (rejecting loopback, private, link-local, CGNAT and multicast targets,
re-checking every redirect hop), caps the response size, times out, and rate
limits per IP.

The upstream `Content-Type` is echoed verbatim, because the importer uses it as the
format signal — so the response is instead declawed on the way out: `nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, and
`Content-Disposition: attachment`. Together those mean a proxied HTML or SVG
document downloads rather than renders if it is ever navigated to, and cannot
execute script or claim our origin if it is framed. `fetch()` — how every real
consumer reads this route — is unaffected. This matters because in the recommended
single-host deployment the API answers on the *app's own* origin, whose CSP must
allow `'unsafe-eval'` and `'unsafe-inline'` for the Runner.

Residual gaps, tracked as open issues: the DNS lookup used for validation is not
the one `fetch` ultimately connects with, so a DNS-rebinding race is possible; and
the IPv6 blocklist uses prefix string matching rather than proper prefix-length
checks. Set `SERVER_PROXY_ALLOWLIST` to close this down if you do not need
arbitrary hosts.

## Deployment checklist

- [ ] `SERVER_JWT_SECRET` set to a real random value (`openssl rand -base64 48`).
      The server refuses to boot in production without it.
- [ ] `SERVER_EXECUTION_AUTHORS` left empty unless you truly need server-side
      execution.
- [ ] `SERVER_EXECUTION_VALIDATED` left unset unless you intend to run
      admin-validated scripts for anonymous callers, and you have someone reading
      script code before validating it.
- [ ] `REDIS_PASW` set **in the repo-root `.env`** — that is where compose reads
      it from, and without it the root `docker-compose.yml` starts Redis with
      `--requirepass ""`, i.e. no password. Compose only warns; it does not fail.
- [ ] `SERVER_SEED_TEST_USER` **not** set in production, so the `test` account is
      never created.
- [ ] `FRONTEND_URL` set to your real origin; it drives the CORS allowlist and the
      links in outgoing email.
- [ ] `SERVER_PROXY_ALLOWLIST` considered.
- [ ] Off-box backups configured (`SERVER_BACKUP_S3_*`) and the cron line from
      [apps/server/README → Backups](apps/server/README.md#backups) installed. `pnpm admin:backup` takes a
      consistent snapshot with SQLite's online backup API, so no manual WAL
      checkpoint is needed — but do **not** roll your own by copying `archiyou.db`
      while a `-wal` sits next to it: that silently loses every write still in the
      WAL, which is routinely megabytes.
- [ ] Everything durable is actually on the list. `backupTargets` in
      `apps/server/src/config.ts` decides what is archived; anything absent is
      treated as regenerable and will be lost with the host.
- [ ] The restore procedure run once, against a scratch copy. An untested restore
      is not a backup.
- [ ] Backup credentials scoped as tightly as your provider allows. The script
      deletes old archives with the same key it uploads with, so a compromised
      server can erase its own history; prefer `SERVER_BACKUP_PRUNE=false` plus a
      bucket lifecycle rule and a write-only key where that is available.
