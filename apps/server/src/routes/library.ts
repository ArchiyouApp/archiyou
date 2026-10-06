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
 *
 * And what a link crawler sees of a published configurator (services/SocialCard.ts):
 *
 *   GET /configurators/*                           → the SPA shell with social tags
 *   GET /cards/{user}/{scriptAndVersion}.png       → its 1200×630 preview image
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import semver from 'semver';

import type { ScriptData } from '@archiyou/core/src/execution/types';

import { config } from '../config';
import { scriptStore } from '../services/ScriptStore';
import { cardContent, configuratorPage, readShell, renderCard, socialUrls } from '../services/SocialCard';
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

/** A published version by its URL segment, `{name}:{version}` (no version: the latest),
 *  resolved the way GET /scripts/published/{user}/{scriptAndVersion} does. */
async function findPublished(user: string, scriptAndVersion: string): Promise<ScriptData | null>
{
  const { scriptName, version } = parseScriptAndVersion(scriptAndVersion);
  const resolved = version ? semver.valid(semver.coerce(version)) ?? undefined : undefined;
  return scriptStore.getPublished(user, scriptName, resolved);
}

function registerSocialCards(fastify: FastifyInstance): void
{
  // The configurator page itself: Caddy sends /configurators/* here instead of serving the
  // static shell, because crawlers run no JavaScript and must find the tags in the HTML.
  // This must never break the page: anything that is not a published configurator gets
  // the shell unchanged, as Caddy would have served it. helmet is off so the response
  // carries the static file's headers (Caddy adds the site's own).
  fastify.get('/configurators/*', { helmet: false }, async (request, reply) =>
  {
    const shell = await readShell();
    if (shell === null)
    {
      // No built editor: 503 makes Caddy fall back to its static copy (see Caddyfile).
      return reply.code(503).type('text/plain; charset=utf-8').send('The editor is not built yet.');
    }
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');

    try
    {
      const path = request.url.split('?')[0];
      const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
      if (segments.length !== 3) return shell;
      const [, user, scriptAndVersion] = segments;

      const data = await findPublished(user, scriptAndVersion);
      if (!data) return shell;

      const search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '';
      return configuratorPage(shell, cardContent(data, search), socialUrls(request.url, user, scriptAndVersion));
    }
    catch (error)
    {
      request.log.warn({ err: error }, 'social card: serving the plain shell');
      return shell;
    }
  });

  fastify.get<{ Params: { user: string; file: string } }>(
    '/cards/:user/:file',
    { config: { rateLimit: config.social.rateLimit } },
    async (request, reply) =>
    {
      const { user, file } = request.params;
      const data = await findPublished(user, file.replace(/\.png$/i, ''));
      if (!data) return fail(reply, 404, `Configurator "${user}/${file}" not found`);

      const search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : '';
      const png = await renderCard(data, cardContent(data, search));
      return reply
        .type('image/png')
        // Not immutable: the same link can get a new picture when the thumbnail is redrawn.
        .header('Cache-Control', 'public, max-age=86400')
        // Previews are embedded by whoever shows the link — see the thumbnail mount in plugin.ts.
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(png);
    },
  );
}

export async function registerLibraryRoutes(fastify: FastifyInstance): Promise<void> {
  registerKind(fastify, 'published');
  registerKind(fastify, 'shared');
  registerSocialCards(fastify);
}
