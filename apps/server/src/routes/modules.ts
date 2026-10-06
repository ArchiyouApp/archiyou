/**
 * routes/modules.ts — the gated script-module API. See modules/README.md.
 *
 *   GET  /modules                            catalog, each entry marked entitled
 *   GET  /modules/:id/docs                   the module's DOCS.md — script-facing docs, public
 *   GET  /modules/:id/:version/bundle.js     client bundle — 403 unless entitled
 *   POST /modules/:id/call                   server-module call — 403 unless entitled
 *
 * ENTITLEMENT IS READ FROM THE DATABASE ON EVERY REQUEST, never from the JWT.
 * Session tokens last days and have no revocation list, so a claim would make a
 * grant or a revoke take up to a week to take effect. The cost is one indexed
 * lookup per request; the benefit is that `pnpm admin:modules` is immediate.
 *
 * With nothing installed under modules/ the catalog is empty and the other two
 * routes 404. No configuration is needed either way: a cloned module repository
 * is found on its own, and a checkout without one keeps the feature off.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

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

/** Ceiling on a served DOCS.md. Generous for documentation, small enough that an
 *  unauthenticated caller cannot make the server read a huge file. */
const DOCS_MAX_CHARS = 256 * 1024;

export async function registerModuleRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The catalog. Public, and it deliberately lists modules the caller may NOT
   * use — the editor shows them as locked, and the runner needs the locked
   * entries to produce a meaningful error instead of `undefined`. Only
   * descriptive fields are exposed; nothing here is the module's code.
   */
  fastify.get('/modules', async (request: FastifyRequest) => {
    const username = await optionalUser(request);
    const entitled = username ? await userService.getModules(username) : [];
    return { success: true, modules: moduleHost.catalogFor(entitled) };
  });

  /**
   * A module's DOCS.md — the script-facing documentation, as markdown, rendered
   * by the editor's module list.
   *
   * PUBLIC, like the catalog itself, and deliberately so: it is served for a
   * module the caller may not use. Someone has to be able to read what a
   * capability does before they can decide they want it, and the fields already
   * on the catalog entry (`description`, `docsUrl`) are public on the same
   * reasoning.
   *
   * DOCS.md and NOT README.md, precisely because this route is open. A module's
   * README is written for whoever builds and deploys it, and reasonably contains
   * environment variables, build steps and the reasoning behind its security
   * guards — none of which belongs in front of every visitor. Serving a
   * separate file makes publishing a deliberate act by the module's author.
   *
   * The response is capped: a module could ship an arbitrarily large file, and
   * this route is unauthenticated. Anything past the cap is truncated rather
   * than refused, so over-long documentation still shows what it starts with.
   */
  fastify.get(
    '/modules/:id/docs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const manifest = moduleHost.get(id);
      if (!manifest) return reply.code(404).send({ success: false, error: `Unknown module '${id}'` });

      // Path from the validated map, never joined from the URL — see
      // ModuleHost.docsPath.
      const path = moduleHost.docsPath(id);
      if (!path) {
        return reply.code(404).send({ success: false, error: `Module '${id}' has no documentation` });
      }

      let markdown: string;
      try {
        markdown = await readFile(path, 'utf-8');
      } catch {
        // The file was there at scan time and is gone now — a module being
        // rebuilt underneath us. Nothing to serve, and nothing worth a 500.
        return reply.code(404).send({ success: false, error: `Module '${id}' has no documentation` });
      }
      if (markdown.length > DOCS_MAX_CHARS) {
        markdown = `${markdown.slice(0, DOCS_MAX_CHARS)}\n\n…`;
      }

      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      // Never immutable: unlike a bundle the URL carries no version, and in dev
      // the whole point is that editing DOCS.md shows up on the next open.
      reply.header('Cache-Control', config.modules.dev ? 'no-store' : 'private, max-age=300');
      return reply.send(markdown);
    },
  );

  /**
   * A client module's bundle — or the client wrapper of a hybrid server module
   * (manifest.client). A plain server module has nothing to serve here: its code
   * never leaves the backend, and ModuleHost.bundlePath() returns null for it.
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
      if (!manifest.public && !(await userService.hasModule(username, id))) {
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
      if (!manifest.public && !(await userService.hasModule(username, id))) {
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
