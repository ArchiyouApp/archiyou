/**
 * routes/modules.ts — the gated script-module API. See modules/README.md.
 *
 *   GET  /modules                            catalog, each entry marked entitled
 *   GET  /modules/:id/:version/bundle.js     client bundle — 403 unless entitled
 *   POST /modules/:id/call                   server-module call — 403 unless entitled
 *
 * ENTITLEMENT IS READ FROM THE DATABASE ON EVERY REQUEST, never from the JWT.
 * Session tokens last days and have no revocation list, so a claim would make a
 * grant or a revoke take up to a week to take effect. The cost is one indexed
 * lookup per request; the benefit is that `pnpm admin:modules` is immediate.
 *
 * With SERVER_MODULES_DIR unset nothing is installed: the catalog is empty and
 * the other two routes 404. No configuration is needed to keep the feature off.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';

import { config } from '../config';
import { moduleHost } from '../modules/ModuleHost';
import { ModuleCallError } from '../modules/ModuleWorkerPool';
import { ModuleCallSchema } from '../modules/manifestSchema';
import { userService } from '../services/UserService';
import { parse } from '../validate';

/** Resolve the caller's handle if a valid token is present, else null.
 *  Mirrors optionalUser() in routes/library.ts. */
async function optionalUser(request: FastifyRequest): Promise<string | null> {
  try {
    await request.jwtVerify();
    return request.user.sub;
  } catch {
    return null;
  }
}

export async function registerModuleRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The catalog. Public, and it deliberately lists modules the caller may NOT
   * use — the editor shows them as locked, and the runner needs the locked
   * entries to produce a meaningful error instead of `undefined`. Only
   * descriptive fields are exposed; nothing here is the module's code.
   */
  fastify.get('/modules', async (request: FastifyRequest) => {
    const username = await optionalUser(request);
    const entitled = username ? userService.getModules(username) : [];
    return { success: true, modules: moduleHost.catalogFor(entitled) };
  });

  /**
   * A client module's bundle.
   *
   * This route IS the enforcement for client-runtime modules: the browser cannot
   * obtain the code any other way, so a 403 here means a user without the
   * entitlement never receives it.
   */
  fastify.get(
    '/modules/:id/:version/bundle.js',
    { preHandler: fastify.authenticate },
    async (
      request: FastifyRequest<{ Params: { id: string; version: string } }>,
      reply: FastifyReply,
    ) => {
      const { id, version } = request.params;
      const username = request.user.sub;

      const manifest = moduleHost.get(id);
      if (!manifest) return reply.code(404).send({ success: false, error: `Unknown module '${id}'` });

      // A public module skips the entitlement check entirely — see AyModuleManifest.public.
      // Gating stays the default; this is the opt-out an open-source module declares.
      if (!manifest.public && !userService.hasModule(username, id)) {
        return reply.code(403).send({
          success: false,
          error: `Module '${id}' is not available on your account`,
          code: 'module_not_entitled',
        });
      }

      // Path comes from ModuleHost's validated map, never from the URL — see
      // ModuleHost.bundlePath. A version mismatch is a 404 so a stale cached URL
      // cannot quietly receive different code than it asked for.
      const path = moduleHost.bundlePath(id, version);
      if (!path) {
        return reply.code(404).send({ success: false, error: `Unknown module version '${id}@${version}'` });
      }

      reply.header('Content-Type', 'text/javascript; charset=utf-8');
      if (config.modules.dev) {
        // In dev the bytes at a given version DO change, on every rebuild. Caching
        // them immutably is the difference between a reload picking up your edit
        // and silently running the previous build — the failure mode this whole
        // dev path exists to prevent.
        reply.header('Cache-Control', 'no-store');
        const rev = moduleHost.revision(id);
        if (rev) reply.header('X-Module-Revision', rev);
      } else {
        // The version is in the path, so a given URL's bytes never change.
        reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      }
      return reply.send(createReadStream(path));
    },
  );

  /**
   * Invoke a server module. Rate-limited per caller: a module call is expensive
   * by definition, so this is the one route where a signed-in user can cheaply
   * consume a lot of CPU.
   */
  fastify.post(
    '/modules/:id/call',
    {
      preHandler: fastify.authenticate,
      config: { rateLimit: { max: config.modules.rateLimit, timeWindow: config.modules.rateWindowMs } },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const username = request.user.sub;

      const manifest = moduleHost.get(id);
      if (!manifest) return reply.code(404).send({ success: false, error: `Unknown module '${id}'` });

      // A public module skips the entitlement check entirely — see AyModuleManifest.public.
      // Gating stays the default; this is the opt-out an open-source module declares.
      if (!manifest.public && !userService.hasModule(username, id)) {
        return reply.code(403).send({
          success: false,
          error: `Module '${id}' is not available on your account`,
          code: 'module_not_entitled',
        });
      }

      if (manifest.runtime !== 'server') {
        return reply.code(400).send({
          success: false,
          error: `Module '${id}' runs in the browser and has no server API`,
        });
      }

      const { method, args } = parse(ModuleCallSchema, request.body);

      try {
        const result = await moduleHost.call(id, method, args);
        return { success: true, result };
      } catch (err) {
        if (err instanceof ModuleCallError) {
          // Distinguish the caller's fault from ours: an unknown method is a bad
          // request, an overloaded pool is retryable, a timeout is a gateway
          // timeout, and anything else is the module failing.
          const code =
            err.kind === 'unknown_method' ? 400 :
            err.kind === 'busy' ? 503 :
            err.kind === 'timeout' ? 504 :
            500;
          return reply.code(code).send({ success: false, error: err.message, code: err.kind });
        }
        throw err;
      }
    },
  );
}
