/**
 * config.ts — typed environment config. `dotenv/config` is imported in index.ts
 * before this module is used.
 *
 * Convention: the one frontend-facing setting is grouped under FRONTEND;
 * everything else is BACKEND and prefixed `SERVER_` in the environment.
 */

import { resolveModulesDir } from './modules/discoverRoots';

const isProduction = process.env.NODE_ENV === 'production';

/** Where the installed script modules are, and how we worked that out. Resolved
 *  once at import: it stats a handful of directories, and every consumer —
 *  ModuleHost, the boot log, `admin:modules --list` — must agree on the answer. */
const modulesDir = resolveModulesDir(process.env.SERVER_MODULES_DIR);

// Legacy file-based execution-result cache (execution/Library.ts) reads these
// from the environment directly. They are no longer part of the documented
// .env — keep dev defaults so instantiating that class never throws.
process.env.LIBRARY_PATH ??= './data/cache';
process.env.LIBRARY_URL ??= `http://localhost:${process.env.SERVER_PORT ?? 4100}`;

/** In production a real secret is mandatory; in dev we fall back to a fixed
 *  value so `pnpm dev` boots with no `.env`. Tokens signed with it are not
 *  secure — never run production without a real SERVER_JWT_SECRET.
 *
 *  Resolved lazily (see the `jwtSecret` getter below) so that processes which
 *  never mint or verify a token — notably the execution worker — do not need the
 *  secret in their environment at all. Handing it to the worker would put it in
 *  reach of the unsandboxed script Runner. */
let jwtSecretCache: string | undefined;
function jwtSecret(): string {
  if (jwtSecretCache !== undefined) return jwtSecretCache;
  const v = process.env.SERVER_JWT_SECRET;
  if (v) return (jwtSecretCache = v);
  if (isProduction) throw new Error('Missing required environment variable: SERVER_JWT_SECRET');
  console.warn('⚠️  SERVER_JWT_SECRET not set — using an insecure dev default. Set SERVER_JWT_SECRET for production.');
  return (jwtSecretCache = 'dev-insecure-jwt-secret-change-me');
}

export const config = {
  //// FRONTEND ////

  /** Public origin of the frontend app (editor + configurator). Base for
   *  password-reset links and the published configurator URLs stamped on
   *  publish. Defaults to the Vite dev server so `pnpm dev` works with no `.env`. */
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  //// BACKEND ////

  port: Number(process.env.SERVER_PORT ?? 4100),
  /** Lazy: only the API process touches this, so the worker can run without it. */
  get jwtSecret(): string { return jwtSecret(); },

  /**
   * Where the script database lives. Postgres either way — the URL only picks the
   * driver (db/client.ts opens it):
   *
   *   postgres://… | postgresql://…   a real PostgreSQL server: the container in
   *                                   docker-compose, or the central instance through
   *                                   an ssh tunnel.
   *   memory://                       PGlite in RAM, gone with the process. What every
   *                                   test file sets, explicitly, so a developer's .env
   *                                   can never point the suite at a shared database.
   *   pglite://<dir> | unset          PGlite on disk under <dir>, relative to apps/server.
   *
   * PGlite is PostgreSQL compiled to WASM, running inside this process: the same
   * dialect, the same schema and the same migrations, with nothing to install. That is
   * the default precisely so that connecting to a database other people also use is
   * always a deliberate act, never something a checkout does on its own.
   */
  databaseUrl: process.env.SERVER_DATABASE_URL ?? 'pglite://./data/pgdata',

  /**
   * Browser origins allowed to call this API. `frontendUrl` is always included;
   * SERVER_CORS_ORIGINS adds more (comma-separated) for extra frontends or API
   * consumers. Previously this was `origin: true`, which reflected any origin —
   * so every website on the internet could call every public endpoint.
   *
   * In the recommended same-origin deployment (editor and /api behind one host)
   * no CORS is needed at all and this list is simply unused.
   */
  corsOrigins: [
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
    ...(process.env.SERVER_CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ],

  /**
   * Server-side script execution (routes/execute.ts → ExecutionWorker → Runner).
   *
   * ⚠️  SECURITY: the Runner compiles script source with `new AsyncFunction` and
   * runs it directly in the worker's Node process — there is no sandbox, so a
   * script gets full Node capability (fs, child_process, network, process.env).
   * In the browser that is contained by the Web Worker boundary; on the server
   * it is not.
   *
   * Therefore this feature is DISABLED BY DEFAULT — BOTH gates below ship off, and
   * either one alone is enough to run a script:
   *
   *   1. `allowedAuthors` (SERVER_EXECUTION_AUTHORS) — a trusted-author allowlist for
   *      authenticated API/batch callers. Coarse: it trusts everything that author ever
   *      publishes, including code they push tomorrow.
   *   2. `allowValidated` (SERVER_EXECUTION_VALIDATED) — the per-script path that backs
   *      published configurators. An admin marks one published version `validated` after
   *      reading its code, and only that version may run. Callers may be ANONYMOUS on
   *      this path (a configurator visitor has no account), which is why it is rate
   *      limited and why the unit of trust is one immutable (fileId, version) code
   *      snapshot rather than a person.
   *
   * Tracking issue: replace with a real isolate (isolated-vm / per-job container)
   * so this can be opened up again.
   */
  execution: {
    allowedAuthors: (process.env.SERVER_EXECUTION_AUTHORS ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
    /** Master switch for the validated-script path. Off ⇒ `published.validated` is inert
     *  and only the author allowlist can reach the executor. */
    allowValidated: process.env.SERVER_EXECUTION_VALIDATED === '1',
    /**
     * Where the EXECUTION WORKER can reach this API. Stamped into the job by
     * routes/execute.ts as the run's assetProxyUrl / componentLibraryUrl / moduleApiUrl,
     * so a server-side run can resolve `$import()` assets, `$component('./name')` from the
     * author's shared library, and gated module bundles — all things the browser client
     * fills in for itself (see apps/editor/src/services/execution-service.ts).
     *
     * This is NOT frontendUrl and NOT a public URL: the worker is a separate container on
     * the internal network, so under the shipped docker-compose it must be
     * `http://api:4100`. The localhost default only fits a worker running on the host.
     * Only the api service needs it — the worker just uses what arrives in the job.
     */
    internalApiUrl: process.env.SERVER_INTERNAL_API_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 4100}`,
    /** Wall-clock cap on a single script run, so `while(true){}` can't pin the worker. */
    timeoutMs: Number(process.env.SERVER_EXECUTION_TIMEOUT_MS ?? 30_000),
    /**
     * Per-IP cap on the execute route. This is the only route that runs unsandboxed code
     * for an unauthenticated caller, so it is also the only one where a bare loop of
     * requests costs real CPU. Keyed on request.ip, which is only meaningful because
     * trustProxy is set in index.ts — behind Caddy without it, every client shares one
     * bucket. Generous by default: a configurator legitimately re-runs on every slider
     * move (debounced to ~1 run per 300ms client-side).
     */
    rateLimit: {
      max: Number(process.env.SERVER_EXECUTION_RATE_LIMIT ?? 30),
      timeWindow: process.env.SERVER_EXECUTION_RATE_WINDOW ?? '1 minute',
    },
  },

  /**
   * Gated script modules (routes/modules.ts → ModuleHost). See modules/README.md.
   *
   * Modules are built and distributed OUTSIDE this repository and cloned into
   * `modules/`, where each is `<id>/{manifest.json,bundle.js|server.js}`. With
   * none installed the whole feature is inert: `dir` resolves to empty, `GET
   * /modules` returns [], and the server behaves exactly as it does today. That
   * is what lets this repository stand alone as open source.
   *
   * Server-runtime modules are loaded into worker threads rather than the API
   * event loop — they are expected to be long-running and CPU-bound, and a worker
   * thread's terminate() actually enforces a timeout (unlike the script-execution
   * timeout, which a synchronous loop can starve; see ExecutionWorker).
   */
  modules: {
    /**
     * Directory of installed modules. Empty ⇒ feature disabled.
     *
     * May name SEVERAL directories, comma- or colon-separated, scanned in order with the
     * first definition of an id winning. One was enough while every module lived in a single
     * private repository; an open-source module gets its own repository checked out
     * alongside, and the backend has to see both.
     *
     * **Usually left unset**: with no `SERVER_MODULES_DIR` the roots are discovered under
     * the checkout's `modules/` overlay (see modules/discoverRoots.ts), which is where a
     * module repository is cloned anyway — so installing one takes no configuration, and a
     * checkout with none installed stays exactly as inert as before. Set the variable to
     * override that (a deployment holding modules elsewhere), or to `off` to load nothing
     * even though something is installed.
     */
    dir: modulesDir.dir,
    /** 'env' | 'discovered' | 'off' | 'none' — reported at boot and by
     *  `admin:modules --list`, so "why can the server not see my module" has a
     *  visible answer rather than an inferred one. */
    dirSource: modulesDir.source,
    /**
     * Development mode: watch `dir` and re-scan on change, serve bundles
     * uncached, and publish a content revision so the editor and the runner can
     * tell a rebuild apart from the version it already has.
     *
     * Defaults ON outside production, because the alternative is a stale bundle
     * that looks like a working one: bundles are served immutable, so without
     * this a rebuilt module keeps running the old code through reloads and
     * restarts alike, with nothing to indicate why.
     */
    dev: process.env.SERVER_MODULES_DEV
      ? /^(1|true|yes)$/i.test(process.env.SERVER_MODULES_DEV)
      : process.env.NODE_ENV !== 'production',
    /** Wall-clock cap on one server-module call, enforced by terminating the thread. */
    callTimeoutMs: Number(process.env.SERVER_MODULES_CALL_TIMEOUT_MS ?? 60_000),
    /** Max concurrently-running module worker threads. */
    poolSize: Number(process.env.SERVER_MODULES_POOL_SIZE ?? 2),
    /** Per-user rate limit on module calls: max requests within the window. */
    rateLimit: Number(process.env.SERVER_MODULES_RATE_LIMIT ?? 60),
    /** Rate-limit window in ms. */
    rateWindowMs: Number(process.env.SERVER_MODULES_RATE_WINDOW_MS ?? 60_000),
  },

  /**
   * Asset proxy (routes/proxy.ts) — lets browser scripts `$import()` remote
   * assets (SVG/GeoJSON/STL/…) that CORS would otherwise block. Open but
   * guarded: SSRF checks, a size cap, a request timeout and a per-IP rate limit.
   * All env-overridable. `allowlist` (comma-separated hostnames) is optional;
   * when set, only those hosts may be proxied.
   */
  proxy: {
    /** Max response size in bytes (default 5 MB). */
    maxBytes: Number(process.env.SERVER_PROXY_MAX_BYTES ?? 5 * 1024 * 1024),
    /** Upstream request timeout in ms. */
    timeoutMs: Number(process.env.SERVER_PROXY_TIMEOUT_MS ?? 10_000),
    /** Max redirect hops to follow (each revalidated against SSRF rules). */
    maxRedirects: Number(process.env.SERVER_PROXY_MAX_REDIRECTS ?? 4),
    /** Per-IP rate limit: max requests within the window. */
    rateLimit: Number(process.env.SERVER_PROXY_RATE_LIMIT ?? 60),
    /** Rate-limit window in ms. */
    rateWindowMs: Number(process.env.SERVER_PROXY_RATE_WINDOW_MS ?? 60_000),
    /** Optional comma-separated hostname allowlist (empty = allow any public host). */
    allowlist: (process.env.SERVER_PROXY_ALLOWLIST ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  },

  /**
   * Per-IP rate limits on the credential endpoints (/auth/login, /auth/register,
   * /auth/forgot-password, /auth/reset-password, /auth/resend-verification).
   * There was previously no limiting at all, leaving password brute-force and
   * reset-mail bombing wide open.
   *
   * Keyed on request.ip, which is only meaningful because trustProxy is set in
   * index.ts — behind Caddy without it, every client shares one bucket.
   */
  authRateLimit: {
    max: Number(process.env.SERVER_AUTH_RATE_LIMIT ?? 10),
    timeWindow: process.env.SERVER_AUTH_RATE_WINDOW ?? '5 minutes',
  },

  /** Per-IP rate limit on POST /feedback, which anonymous visitors may call. */
  feedbackRateLimit: {
    max: Number(process.env.SERVER_FEEDBACK_RATE_LIMIT ?? 10),
    timeWindow: process.env.SERVER_FEEDBACK_RATE_WINDOW ?? '10 minutes',
  },

  /**
   * Maximum request body size. Fastify's default is 1 MiB, which script bodies were
   * already approaching (code + params + presets) — a 413 on publish is not a failure
   * mode worth having. (Thumbnails travel as their own `image/png` body, see plugin.ts.)
   */
  bodyLimitBytes: Number(process.env.SERVER_BODY_LIMIT_BYTES ?? 4 * 1024 * 1024),

  /**
   * Script thumbnails: PNG renders of the model made in the BROWSER — after a run in the
   * editor, after a share/publish, or backfilled from the browser page (server-side
   * execution is disabled — see `execution` above) — written here as files and served
   * statically at `/thumbnails/`. Filenames are content-addressed, so the URL changes
   * whenever the picture does and `Cache-Control: immutable` is always correct.
   *
   * ⚠️  `path` must be a persistent volume in production, or thumbnails vanish on redeploy
   * while the DB still points at them (clients fall back to a placeholder icon).
   */
  thumbnails: {
    path: process.env.SERVER_THUMBNAIL_PATH ?? './data/thumbnails',
    /** Public prefix the files are served under. Relative → same origin as the API. */
    urlPrefix: process.env.SERVER_THUMBNAIL_URL_PREFIX ?? '/thumbnails',
    /** Hard cap on a stored thumbnail. A 512px shaded render is 50–200 KB as PNG; this
     *  leaves room for a busy one, not for a photo. Also bounds the `image/png` body. */
    maxBytes: Number(process.env.SERVER_THUMBNAIL_MAX_BYTES ?? 512 * 1024),
    /**
     * JSON Lines diagnostic log for the thumbnail lifecycle — browser generation, what
     * arrived, and why anything was dropped (services/thumbnailLog.ts). Thumbnail
     * failures are silent by design on both ends, so without this "sometimes there is
     * no thumbnail" cannot be investigated at all.
     *
     * Set SERVER_THUMBNAIL_LOG='' to turn it off entirely.
     */
    logPath: process.env.SERVER_THUMBNAIL_LOG ?? './data/logs/thumbnails.log',
    /** Rotate to `.log.1` past this size (one generation kept). 0 ⇒ never rotate. */
    logMaxBytes: Number(process.env.SERVER_THUMBNAIL_LOG_MAX_BYTES ?? 5 * 1024 * 1024),
  },

  /**
   * Off-box backups to S3-compatible storage — see src/admin/backup.ts.
   *
   * NEVER invoked by the server process: this is read only by the standalone
   * `pnpm admin:backup` script, run from the host crontab (apps/server/README → Backups).
   * With no bucket configured the script exits 2 and nothing else changes.
   *
   * WHAT gets backed up is `backupTargets` at the bottom of this file, not these
   * settings — this block is only about where the archive goes and how long it
   * lives there.
   *
   * ⚠️  s3.secretAccessKey must never be logged. Do not console.log or
   * JSON.stringify this object; the script logs a masked key id only.
   */
  backup: {
    s3: {
      /** Empty = real AWS S3. Otherwise the provider's S3 endpoint (R2/B2/Spaces/MinIO). */
      endpoint: process.env.SERVER_BACKUP_S3_ENDPOINT ?? '',
      region: process.env.SERVER_BACKUP_S3_REGION ?? 'us-east-1',
      /** Empty = the feature is off; the script exits 2 rather than doing nothing quietly. */
      bucket: process.env.SERVER_BACKUP_S3_BUCKET ?? '',
      accessKeyId: process.env.SERVER_BACKUP_S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.SERVER_BACKUP_S3_SECRET_ACCESS_KEY ?? '',
      /** Key prefix inside the bucket. Pruning is scoped to it, so two instances
       *  sharing a bucket MUST use different prefixes or they delete each other's
       *  backups. */
      prefix: process.env.SERVER_BACKUP_S3_PREFIX ?? '',
      /** Bucket in the path rather than the hostname — MinIO, usually Backblaze B2. */
      forcePathStyle: process.env.SERVER_BACKUP_S3_FORCE_PATH_STYLE === 'true',
      /** Since SDK v3.729 the default adds CRC32 checksum headers and `aws-chunked`
       *  trailers, which several S3-compatible providers reject with a 400. Off by
       *  default; set `when_supported` only if your provider demands them. */
      checksums: process.env.SERVER_BACKUP_S3_CHECKSUMS ?? 'when_required',
    },

    /** Extra `name:path` targets, comma-separated — adds to `backupTargets` without
     *  a code change. e.g. `uploads:./data/uploads,fonts:/srv/fonts`. */
    extraPaths: process.env.SERVER_BACKUP_EXTRA_PATHS ?? '',
    /** Target names to leave out of this deployment's backups, comma-separated. */
    skip: (process.env.SERVER_BACKUP_SKIP ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
    /** Extra path patterns never included, on top of BACKUP_DEFAULT_EXCLUDES. */
    exclude: (process.env.SERVER_BACKUP_EXCLUDE ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    /** Abort if the targets total more than this uncompressed (default 2 GiB), so
     *  adding a fat directory to the list fails loudly on the next run instead of
     *  silently turning into a nightly multi-gigabyte upload. */
    maxBytes: Number(process.env.SERVER_BACKUP_MAX_BYTES ?? 2 * 1024 * 1024 * 1024),

    /** Delete older objects after a SUCCESSFUL upload. See selectPrunable() in
     *  services/BackupService.ts for the safety rules — this is the only
     *  destructive thing the script does. */
    prune: process.env.SERVER_BACKUP_PRUNE !== 'false',
    keepDays: Number(process.env.SERVER_BACKUP_KEEP_DAYS ?? 30),
    /** The newest N are always retained, however old. Hard floor against a bad clock. */
    minKeep: Number(process.env.SERVER_BACKUP_MIN_KEEP ?? 3),
    /** Ceiling on deletions per run, so a parse or clock bug costs N objects rather
     *  than the whole prefix. */
    maxDelete: Number(process.env.SERVER_BACKUP_MAX_DELETE ?? 100),

    /** Scratch space for the `pg_dump` snapshot. Must be on the persistent data volume —
     *  the container's /tmp is unsized overlay fs. Cleaned up after every run. */
    tmpDir: process.env.SERVER_BACKUP_TMP_DIR ?? './data/backup-tmp',
    /** Whole-run wall-clock cap, so a stalled upload cannot overlap the next cron run. */
    timeoutMs: Number(process.env.SERVER_BACKUP_TIMEOUT_MS ?? 900_000),
  },

  /**
   * Google Gemini, used to translate a published configurator's end-user-facing copy
   * into the locales in @archiyou/core's TRANSLATION_LOCALES.
   *
   * Runs as a background job after publishing (translation/), never in the request path:
   * the author neither triggers nor waits for it, and every failure is silent — an
   * untranslated configurator still works, in the language it was authored in.
   *
   * With no API key the whole feature is simply off: jobs return immediately. Boot never
   * fails over this (same posture as `mailgun` above).
   */
  gemini: {
    apiKey: process.env.SERVER_GEMINI_API_KEY ?? '',
    /** Stronger than DbBuilder's flash-lite: ten-way UI copy with register and length
     *  constraints is a harder task than structured scraping. */
    model: process.env.SERVER_GEMINI_MODEL ?? 'gemini-2.5-flash',
    timeoutMs: Number(process.env.SERVER_GEMINI_TIMEOUT_MS ?? 60_000),
    /** Refuse to translate a script with more strings than this, so one pathological
     *  configurator cannot burn the budget. */
    maxKeys: Number(process.env.SERVER_GEMINI_MAX_KEYS ?? 400),
    /** Per-author translation jobs allowed per hour. This costs real money per account,
     *  so the bucket is the account — not the IP. */
    maxJobsPerHour: Number(process.env.SERVER_GEMINI_MAX_JOBS_PER_HOUR ?? 20),
  },

  /** Redis/BullMQ for the server-side execution pipeline (ExecutionBroker/Worker). */
  redis: {
    host: process.env.SERVER_REDIS_HOST ?? 'localhost',
    port: Number(process.env.SERVER_REDIS_PORT ?? 6379),
    password: process.env.SERVER_REDIS_PASSWORD || undefined,
  },

  /**
   * Mailgun (transactional email, e.g. password reset). Matches the legacy setup
   * (EU region, mg.archiyou.com). When `key` is empty the EmailService logs the
   * message to the console instead of sending — so dev works with no credentials.
   */
  mailgun: {
    key: process.env.SERVER_MAILGUN_KEY ?? '',
    domain: process.env.SERVER_MAILGUN_DOMAIN ?? 'mg.archiyou.com',
    apiBase: process.env.SERVER_MAILGUN_API_BASE ?? 'https://api.eu.mailgun.net',
    from: process.env.SERVER_EMAIL_FROM ?? 'Archiyou <info@archiyou.com>',
  },

  /**
   * A convenience development account, seeded on boot by userService.seedTestUser().
   * `username` is the script `author` handle used to scope ownership. The defaults
   * let `pnpm dev` work with no `.env` at all.
   *
   * ⚠️  NOT seeded in production. Previously this ran unconditionally on every
   * boot, so a production container came up with a `test` / `test1234` account —
   * publicly known credentials, and `test` is a plausible script-author handle.
   * To seed it deliberately in production, set SERVER_SEED_TEST_USER=true AND an
   * explicit SERVER_TEST_USER_PASSWORD (see `seedTestUser` below).
   */
  testUser: {
    username: (process.env.SERVER_TEST_USER_USERNAME ?? 'test').toLowerCase(),
    email: process.env.SERVER_TEST_USER_EMAIL ?? 'test@archiyou.com',
    password: process.env.SERVER_TEST_USER_PASSWORD ?? 'test1234',
    name: process.env.SERVER_TEST_USER_NAME ?? 'Test User',
  },

  /**
   * Whether to seed the account above. Always on outside production; in
   * production it requires both an explicit opt-in and a real password, so the
   * default credentials can never reach a live instance.
   */
  seedTestUser:
    // On PGlite the database belongs to this checkout alone, so seeding it is free.
    // Against a shared Postgres it is not: every dev machine would otherwise write
    // `test` / `test1234` — publicly known credentials, and `test` is a plausible
    // author handle — into the database production reads. There it takes the same
    // explicit opt-in production has always needed.
    (!isProduction && !/^postgres(ql)?:\/\//i.test(process.env.SERVER_DATABASE_URL ?? ''))
    || (process.env.SERVER_SEED_TEST_USER === 'true' && !!process.env.SERVER_TEST_USER_PASSWORD),
};

//// BACKUP TARGETS ////

export type BackupTargetKind = 'postgres' | 'dir' | 'file';

/** One declared thing to copy into a backup archive. */
export interface BackupTarget {
  /** Unique. Becomes the top-level directory inside the archive and the manifest
   *  key, so it is a name, not a path — no slashes. */
  name: string;
  /** Source path, or — for a `postgres` target — the database URL to dump. Relative
   *  paths resolve from apps/server, like every other path setting. */
  path: string;
  /** `postgres` → a consistent `pg_dump -Fc` snapshot (never a file copy);
   *  `dir` → recursive walk; `file` → a single file. */
  kind: BackupTargetKind;
  /** Source missing: true = warn and carry on, false = fail the whole run. */
  optional?: boolean;
  /** Extra exclusions for a `dir` target, on top of BACKUP_DEFAULT_EXCLUDES. */
  exclude?: string[];
}

/**
 * WHAT GETS BACKED UP. This list is the authoritative answer — add a line when a
 * new kind of durable asset appears and `pnpm admin:backup` needs no other change.
 * Anything not listed is treated as regenerable and will be LOST on host failure.
 *
 * Deliberately absent: `data/cache` (the legacy execution-result cache, LIBRARY_PATH
 * above) and `data/README.md`. Targets are enumerated rather than tarring `data/`
 * wholesale precisely so that "what is in a backup" is answerable by reading this.
 *
 * `SERVER_BACKUP_EXTRA_PATHS` adds targets without touching code;
 * `SERVER_BACKUP_SKIP` drops one for a particular deployment.
 *
 * ⚠️  A target outside the `server_data` volume must also be mounted into the `api`
 * container, or the script cannot see it in production. See apps/server/README → Backups.
 */
export const backupTargets: BackupTarget[] = [
  { name: 'db', path: config.databaseUrl, kind: 'postgres' },
  { name: 'thumbnails', path: config.thumbnails.path, kind: 'dir', optional: true },
];

/**
 * Never included, whatever a `dir` target's path is. Matched as substrings against
 * the path relative to the target root. The database is not a directory walk any
 * more (it is a `pg_dump` stream), so this is only about stray editor/scratch files.
 */
export const BACKUP_DEFAULT_EXCLUDES = ['.bak', '.tmp', 'backup-tmp/'];

/** Any http(s) origin on the loopback host, whatever the port. */
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Whether a browser Origin may call this API (see plugin.ts).
 *
 * The explicit allowlist always wins. On top of it, DEVELOPMENT accepts any
 * loopback origin regardless of port: Vite silently moves to the next free port
 * (5174, 5175, …) when 5173 is taken — e.g. a second dev server, or a stale one
 * still holding it — and the mismatch surfaces in the browser as an opaque
 * "No 'Access-Control-Allow-Origin' header" on the login preflight, which looks
 * like the server being down rather than a port change. Production is unaffected:
 * there it stays strictly FRONTEND_URL + SERVER_CORS_ORIGINS.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (config.corsOrigins.includes(origin)) return true;
  return !isProduction && LOCALHOST_ORIGIN.test(origin);
}
