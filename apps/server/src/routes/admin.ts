/**
 * routes/admin.ts — the operator surface. Every route here requires `users.is_admin`.
 *
 *   GET  /admin/configurators              every published version, all authors
 *   GET  /admin/configurators/:versionId   one version, INCLUDING its code
 *   PUT  /admin/configurators/:versionId/validated   { validated: boolean }
 *
 * Its one power is `published.validated`, which clears a specific published version to
 * run SERVER-SIDE — unsandboxed, in the execution worker's Node process, for callers who
 * may be anonymous (see routes/execute.ts and SECURITY.md). Validating a script is
 * therefore a code-review decision, not a moderation one, which is why the single-version
 * route returns the source: the operator is vouching for exactly those bytes.
 *
 * Deliberately NOT mounted under /scripts/:user/*. Those routes carry `assertSelf`, which
 * hard-requires the path handle to equal the caller's own JWT `sub` — correct for an
 * owner-scoped API and exactly wrong here, where the whole point is acting on other
 * people's scripts.
 *
 * Granting admin is NOT here. It is `pnpm admin:users`, which needs a shell on the box —
 * so possessing admin never lets you hand it out, and the first operator can exist before
 * any admin UI does.
 */

import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { scriptStore } from '../services/ScriptStore';
import { parse } from '../validate';

const SetValidatedSchema = Type.Object({
  validated: Type.Boolean(),
});

/** `?validated=true|false`, absent meaning "either". Anything else is a bad request
 *  rather than a silent no-filter, which would quietly show the wrong list. */
function parseTristate(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Expected 'true' or 'false', got '${raw}'`);
}

interface ListQuery {
  author?: string;
  validated?: string;
  q?: string;
  limit?: string;
  offset?: string;
}

export async function registerAdminRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [fastify.requireAdmin] };

  /**
   * The review queue. Spans every author — the only list in the API that does.
   * `code` rides along on each row (the library list routes already carry it), so the
   * table can show size and a quick preview without a request per row; the full-fidelity
   * read is the single-version route below.
   */
  fastify.get<{ Querystring: ListQuery }>('/admin/configurators', adminOnly, async (request, reply) => {
    const { author, q } = request.query;
    let validated: boolean | undefined;
    try {
      validated = parseTristate(request.query.validated);
    } catch (error) {
      reply.code(400);
      return { success: false, error: `Invalid 'validated' filter. ${(error as Error).message}` };
    }

    const limit = Math.min(Number(request.query.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(request.query.offset ?? 0) || 0, 0);

    const { total, scripts } = scriptStore.listAllPublished({ author, validated, q, limit, offset });
    return { success: true, total, limit, offset, data: scripts };
  });

  /** One published version in full, code included — what the operator reads before
   *  validating. Not author-scoped: that is the point of this file. */
  fastify.get<{ Params: { versionId: string } }>(
    '/admin/configurators/:versionId',
    adminOnly,
    async (request, reply) => {
      const script = scriptStore.findAnyVersionById(request.params.versionId);
      if (!script) {
        reply.code(404);
        return { success: false, error: `Version ${request.params.versionId} not found` };
      }
      return { success: true, data: script };
    },
  );

  /** Turn server-side execution on or off for one published version. */
  fastify.put<{ Params: { versionId: string } }>(
    '/admin/configurators/:versionId/validated',
    adminOnly,
    async (request, reply) => {
      const { validated } = parse(SetValidatedSchema, request.body);
      const stored = scriptStore.setValidated(request.params.versionId, validated);
      request.log.info(
        { versionId: request.params.versionId, script: `${stored.author}/${stored.name}:${stored.version}`,
          validated, by: request.user.sub },
        'admin: validated flag changed',
      );
      return { success: true, data: stored };
    },
  );
}
