/**
 * plugin.ts — the whole Archiyou backend as one root Fastify plugin.
 *
 * Wires up CORS, JWT, the `authenticate` preHandler, error mapping, `/health`,
 * the Redis/BullMQ execution pipeline, and every route group at the ROOT:
 *   - /auth/*                          auth (routes/auth.ts)
 *   - /scripts/{user}/*                the user's own scripts, authed (routes/scripts.ts)
 *   - /scripts/{published,shared}/*    public libraries (routes/library.ts)
 *   - /scripts/published/execute/*     server-side execution (routes/execute.ts)
 *
 * One JWT/CORS, one namespace — no `/api` split and no duplicate library auth.
 * Execution init connects to Redis; it is best-effort with a timeout so the
 * read routes still serve if Redis is down (only /execute degrades → 503).
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { config, isAllowedOrigin } from './config';
import { ExecutionManager } from './execution/ExecutionManager';
import { registerAuthRoutes } from './routes/auth';
import { registerUserRoutes } from './routes/users';
import { registerScriptRoutes } from './routes/scripts';
import { registerLibraryRoutes } from './routes/library';
import { registerExecuteRoutes } from './routes/execute';
import { registerProxyRoutes } from './routes/proxy';
import { registerModuleRoutes } from './routes/modules';
import { registerAdminRoutes } from './routes/admin';
import { registerFeedbackRoutes } from './routes/feedback';
import { moduleHost } from './modules/ModuleHost';
import { ValidationError } from './validate';
import { UserError, userService } from './services/UserService';
import { ScriptStoreError } from './services/ScriptStore';
import { FeedbackStoreError } from './services/FeedbackStore';
import { translationQueue } from './translation/TranslationQueue';

const EXECUTION_INIT_TIMEOUT_MS = 5000;

export async function serverApiPlugin(fastify: FastifyInstance): Promise<void> {
  // Explicit origin allowlist (config.corsOrigins = FRONTEND_URL + SERVER_CORS_ORIGINS),
  // plus any loopback origin in development — see isAllowedOrigin.
  // Requests with no Origin header (curl, server-to-server) are allowed through —
  // CORS is a browser mechanism and blocking them would break API consumers.
  await fastify.register(import('@fastify/cors'), {
    origin: (origin, cb) => {
      if (!origin || isAllowedOrigin(origin)) return cb(null, true);
      // Log it: a rejected preflight reaches the browser as a bare "no
      // Access-Control-Allow-Origin header", with nothing naming the origin that
      // was actually refused. Without this line the server console stays silent
      // on the one failure people spend an afternoon on.
      console.warn(
        `⚠️  CORS: refused origin "${origin}". Allowed: ${config.corsOrigins.join(', ') || '(none)'}. ` +
        `Add it to SERVER_CORS_ORIGINS (or set FRONTEND_URL) to permit it.`,
      );
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  // Baseline security headers at the app layer, so they hold however this is
  // deployed rather than depending on the Caddy vhost in front of it. CSP is set
  // by Caddy for the frontend; this API serves JSON, so the default CSP here
  // would only get in the way of the /proxy asset route.
  await fastify.register(import('@fastify/helmet'), { contentSecurityPolicy: false });

  // Rate limiting. Registered with `global: false` so it applies only where a
  // route opts in via `config.rateLimit` — the credential endpoints in
  // routes/auth.ts and the execute route in routes/execute.ts (the one route that
  // runs unsandboxed code for a possibly-anonymous caller). Read/library routes stay
  // unthrottled; a blanket limit would be wrong for an editor that fans out many
  // script requests per session.
  await fastify.register(import('@fastify/rate-limit'), {
    global: false,
    // In-process store: fine for a single API container. With several API
    // replicas each keeps its own counters, so the effective limit multiplies —
    // pass a `redis` connection here if this is ever scaled out.
    keyGenerator: (request) => request.ip,
  });

  await fastify.register(import('@fastify/jwt'), { secret: config.jwtSecret });

  // Thumbnail uploads are the one binary body this API takes: the PNG itself, so the bytes
  // never go through base64 + JSON. Capped a little above the store's own byte cap, so an
  // oversized picture is refused by the check (and logged) rather than by a bare 413.
  fastify.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: config.thumbnails.maxBytes + 1024 },
    (_request, body, done) => done(null, body));

  // Script thumbnails as static files (services/ThumbnailStore.ts writes them). Filenames
  // are content-addressed, which is what makes `immutable` safe: a regenerated thumbnail
  // gets a new name, so a cached one can never go stale.
  //
  // The bytes are PNGs the browser rendered (older ones SVGs), arriving over a client-
  // controlled request body, so they are shape-checked on the way in (ThumbnailStore) AND
  // served defensively here: `sandbox` + `default-src 'none'` neuter anything that somehow
  // got through, and `nosniff` stops a file being re-interpreted as HTML. The content type
  // follows the extension — the two are never mixed under one name.
  // @fastify/static throws at registration when root is missing, and the directory is
  // otherwise only created on the first write — so ensure it here rather than making
  // boot depend on someone having published something.
  const thumbnailRoot = resolve(config.thumbnails.path);
  mkdirSync(thumbnailRoot, { recursive: true });

  await fastify.register(import('@fastify/static'), {
    root: thumbnailRoot,
    prefix: `${config.thumbnails.urlPrefix}/`,
    index: false,
    dotfiles: 'deny',
    immutable: true,
    maxAge: '1y',
    setHeaders: (res, path) => {
      res.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml; charset=utf-8' : 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      // helmet defaults every response to CORP same-origin, which blocks the
      // <img> whenever the frontend is not on this origin (dev: :5173 vs :4100,
      // and any split-host deploy) — Chrome reports
      // ERR_BLOCKED_BY_RESPONSE.NotSameOrigin and the thumbnail silently
      // disappears. Embedding is the entire point of these files, and the CSP
      // above already neuters the SVG itself, so opt this route back out.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  // preHandler that rejects unauthenticated requests.
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // preHandler for routes/admin.ts. Two distinct answers on purpose: 401 means "log
  // in", 403 means "logged in, still not allowed" — collapsing them would send the
  // editor to the login screen for an account that is already signed in.
  //
  // The flag is read from the database here, never from the token. Session tokens
  // last 7 days and there is no revocation list, so an admin claim baked into a JWT
  // would keep working for a week after the grant was withdrawn. Same reasoning as
  // users.modules; the stakes are higher, since this role can clear a script to run
  // unsandboxed for anonymous callers.
  fastify.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!userService.isAdmin(request.user.sub)) {
      reply.code(403).send({ success: false, error: 'Admin only', code: 'not_admin' });
    }
  });

  // Redis/BullMQ execution pipeline. Best-effort: read routes must still register
  // if Redis is down — only /execute degrades. Exposed only once init succeeds,
  // so the execute route returns a clean 503 while the pipeline is unavailable.
  let manager: ExecutionManager | undefined;
  try {
    const m = new ExecutionManager();
    await Promise.race([
      m.init(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`execution init timed out after ${EXECUTION_INIT_TIMEOUT_MS}ms`)), EXECUTION_INIT_TIMEOUT_MS),
      ),
    ]);
    manager = m;
    console.log('🔧 Execution pipeline ready (Redis/BullMQ).');
  } catch (err) {
    console.warn('⚠️  Execution pipeline unavailable (is Redis running?):', (err as Error).message);
    console.warn('    Library read routes are served; /scripts/published/execute will 503 until Redis is reachable.');
  }
  fastify.decorate('executionManager', manager);

  // Background translation of published configurators. Worked in THIS process (pure IO,
  // no script evaluation — unlike the execution queue). Best-effort: with no Redis or no
  // Gemini key, configurators are simply served in the language they were authored in.
  await translationQueue.init();
  fastify.addHook('onClose', async () => { await translationQueue.close(); });

  // Scan installed script modules now rather than on the first request, so a
  // malformed manifest is reported when the deployment happens — not hours later
  // in a user's console. No-op when no module is installed (the default).
  moduleHost.load();
  if (config.modules.dev) {
    // Editing a module should not require restarting the backend.
    moduleHost.watch();
    fastify.addHook('onClose', async () => { moduleHost.close(); });
  }

  fastify.get('/health', async () => ({ status: 'healthy', timestamp: new Date().toISOString() }));

  // Must be set BEFORE registering route sub-plugins: encapsulated child contexts
  // inherit the error handler present at their registration time.
  setupErrorHandling(fastify);

  await fastify.register(registerAuthRoutes);
  await fastify.register(registerUserRoutes);     // /users/search (authed)
  await fastify.register(registerScriptRoutes);   // /scripts/{user}/* (authed)
  await fastify.register(registerLibraryRoutes);  // /scripts/{published,shared}/* (public)
  await fastify.register(registerExecuteRoutes);  // /scripts/published/execute/*
  await fastify.register(registerProxyRoutes);    // /proxy?url= (asset proxy for $import)
  await fastify.register(registerModuleRoutes);   // /modules/* (gated script modules; inert when none is installed)
  await fastify.register(registerFeedbackRoutes); // POST /feedback (public, rate limited)
  await fastify.register(registerAdminRoutes);    // /admin/* (operator only — users.is_admin)
}

/** Exported so route tests can build an app that maps errors the way production
 *  does — otherwise a ValidationError surfaces as a default 500 in tests and the
 *  route's real 422 goes unverified. */
export function setupErrorHandling(fastify: FastifyInstance): void {
  fastify.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ValidationError) {
      return reply.code(422).send({ success: false, error: error.message, issues: error.issues });
    }
    if (error instanceof UserError) {
      const code =
        error.code === 'email_taken' ? 409 :
        error.code === 'invalid_token' ? 400 :
        401;
      return reply.code(code).send({ success: false, error: error.message });
    }
    if (error instanceof FeedbackStoreError) {
      return reply.code(404).send({ success: false, error: error.message });
    }
    if (error instanceof ScriptStoreError) {
      const code = error.code === 'not_found' ? 404 : 422;
      return reply.code(code).send({ success: false, error: error.message });
    }
    request.log.error(error);
    const status = error.statusCode || 500;
    // Never echo an unmapped error's message to the client: those come from deep
    // internals (file paths, SQL, upstream responses) and make a useful recon
    // oracle. 4xx statuses are ones we set deliberately, so their text is safe.
    const message = status >= 500 ? 'Internal server error' : (error.message || 'Request failed');
    if (status >= 500) console.error('Unhandled server error:', error);
    return reply.code(status).send({ success: false, error: message });
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    reply.code(404).send({ success: false, error: `Route ${request.method} ${request.url} not found` });
  });
}

// Fastify instance decorator typing.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    executionManager?: ExecutionManager;
  }
}
