/**
 * routes/library.ts — the public published + shared script libraries, from the DB.
 *
 * The DB (`script_versions`) is the single source of truth: a row is in the
 * "published" (resp. "shared") library when that metadata column is non-null.
 * Both libraries expose the same read shape, so one factory registers both:
 *
 *   GET /scripts/{kind}                            → all
 *   GET /scripts/{kind}/{user}                     → by author
 *   GET /scripts/{kind}/{user}/{name}/versions     → version strings
 *   GET /scripts/{kind}/{user}/{scriptAndVersion}  → one (":version" optional → latest)
 *
 * where {kind} ∈ { published, shared }. Execution lives in routes/execute.ts.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import semver from 'semver';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import { scriptStore } from '../services/ScriptStore';
import { parseScriptAndVersion } from './scriptUrl';

interface GetResponse {
  success: boolean;
  error?: string;
  data?: ScriptData | ScriptData[] | string[];
}

function fail(reply: FastifyReply, code: number, message: string): GetResponse {
  reply.code(code);
  return { success: false, error: message };
}

type LibraryKind = 'published' | 'shared';

/** Resolve the caller's handle if a valid token is present, else null. Used by
 *  the shared library to gate `onlyUsers`-restricted scripts without forcing
 *  auth on public reads. */
async function optionalUser(request: FastifyRequest): Promise<string | null> {
  try {
    await request.jwtVerify();
    return request.user.sub;
  } catch {
    return null;
  }
}

/** Bind the ScriptStore accessors for a library kind. The shared `list` returns
 *  only community shares (no `onlyUsers`); restricted shares surface via the
 *  authed `/scripts/shared/with-me` route. Every thunk returns a promise — the
 *  store is async — so its four consumers below all await. */
function accessors(kind: LibraryKind) {
  return kind === 'published'
    ? {
        list: () => scriptStore.listPublished(),
        byAuthor: (a: string) => scriptStore.listPublishedByAuthor(a),
        versions: (a: string, n: string) => scriptStore.getPublishedVersions(a, n),
        get: (a: string, n: string, v?: string) => scriptStore.getPublished(a, n, v),
      }
    : {
        list: () => scriptStore.listSharedPublic(),
        byAuthor: (a: string) => scriptStore.listSharedByAuthor(a),
        versions: (a: string, n: string) => scriptStore.getSharedVersions(a, n),
        get: (a: string, n: string, v?: string) => scriptStore.getShared(a, n, v),
      };
}

function registerKind(fastify: FastifyInstance, kind: LibraryKind): void {
  const a = accessors(kind);
  const base = `/scripts/${kind}`;

  // Scripts shared specifically with the authenticated caller. Registered
  // before `/:user` so the static segment wins over the parametric one.
  if (kind === 'shared') {
    fastify.get(
      `${base}/with-me`,
      { preHandler: fastify.authenticate },
      async (request, reply): Promise<GetResponse> => {
        try {
          return { success: true, data: await scriptStore.listSharedWithUser(request.user.sub) };
        } catch (error) {
          return fail(reply, 500, `Failed to load shared-with-me scripts: ${(error as Error).message}`);
        }
      },
    );
  }

  // All scripts in this library.
  fastify.get(base, async (_request, reply): Promise<GetResponse> => {
    try {
      return { success: true, data: await a.list() };
    } catch (error) {
      return fail(reply, 500, `Failed to load ${kind} scripts: ${(error as Error).message}`);
    }
  });

  // By author.
  fastify.get<{ Params: { user: string } }>(`${base}/:user`, async (request, reply): Promise<GetResponse> => {
    try {
      return { success: true, data: await a.byAuthor(request.params.user) };
    } catch (error) {
      return fail(reply, 500, `Failed to load ${kind} scripts for ${request.params.user}: ${(error as Error).message}`);
    }
  });

  // Version list for a script — registered before the 2-segment get (different arity).
  fastify.get<{ Params: { user: string; scriptName: string } }>(
    `${base}/:user/:scriptName/versions`,
    async (request, reply): Promise<GetResponse> => {
      try {
        return { success: true, data: await a.versions(request.params.user, request.params.scriptName) };
      } catch (error) {
        return fail(reply, 500, `Failed to get versions for "${request.params.user}/${request.params.scriptName}": ${(error as Error).message}`);
      }
    },
  );

  // One script (":version" optional → latest; ":dev" → latest working copy when
  // the share opted into dev access). Shared scripts with an `onlyUsers` list are
  // gated: the caller must be the author or a listed user.
  fastify.get<{ Params: { user: string; scriptAndVersion: string } }>(
    `${base}/:user/:scriptAndVersion`,
    async (request, reply): Promise<GetResponse> => {
      try {
        const { user, scriptAndVersion } = request.params;
        const { scriptName, version } = parseScriptAndVersion(scriptAndVersion);
        // "dev" is a sentinel, not a semver — pass it through untouched.
        const resolved =
          version === 'dev'
            ? 'dev'
            : version
              ? semver.valid(semver.coerce(version)) ?? undefined
              : undefined;

        const script = await a.get(user, scriptName, resolved);
        if (!script) {
          return fail(reply, 404, `Script "${user}/${scriptName}:${version ?? 'latest'}" not found in ${kind}`);
        }

        if (kind === 'shared') {
          const caller = await optionalUser(request);
          if (!scriptStore.canAccessShared(script, caller)) {
            return fail(reply, 403, `Not allowed to access "${user}/${scriptName}"`);
          }
        }

        return { success: true, data: script };
      } catch (error) {
        return fail(reply, 500, `Failed to get script: ${(error as Error).message}`);
      }
    },
  );
}

export async function registerLibraryRoutes(fastify: FastifyInstance): Promise<void> {
  registerKind(fastify, 'published');
  registerKind(fastify, 'shared');
}
