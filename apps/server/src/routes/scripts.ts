/**
 * routes/scripts.ts — a user's own scripts, under `/scripts/{user}/…`.
 *
 * All routes require auth AND self-scoping: `{user}` must equal the token handle
 * (`request.user.sub`), else 403. Bodies are the core `ScriptData` shape
 * (validated inside ScriptStore). Individual files are addressed by `fileId`.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ScriptData, ScriptShared } from '@archiyou/core/src/execution/types';

import { scriptStore } from '../services/ScriptStore';
import { thumbnailStore } from '../services/ThumbnailStore';
import { logThumbnail } from '../services/thumbnailLog';
import { translationQueue } from '../translation/TranslationQueue';
import { userService } from '../services/UserService';
import { configuratorUrl } from './scriptUrl';

/** Publish/share bodies carry the thumbnail SVG source alongside the ScriptData, in a field
 *  that is deliberately NOT part of ScriptSchema — so the bytes can never round-trip through
 *  Script.fromData()/toData() or turn up in a library list response. Only the resulting URL
 *  is persisted (on ScriptData.thumbnail). */
interface WithThumbnailSvg { thumbnailSvg?: unknown }

/**
 * Store the thumbnail that came with a publish/share and stamp its URL onto the stored
 * version. Runs AFTER the row is committed, so a bad or unwritable thumbnail can never
 * fail the publish — it just leaves the script without a preview.
 */
async function attachThumbnail(
  author: string,
  fileId: string,
  stored: ScriptData,
  svg: unknown,
  kind: 'share' | 'publish' | 'configurator-edit',
): Promise<ScriptData> {
  const url = await thumbnailStore.write(author, fileId, stored.id as string, svg, kind);
  if (!url) return stored;
  scriptStore.setThumbnail(author, stored.id as string, url);
  return { ...stored, thumbnail: url };
}

export async function registerScriptRoutes(fastify: FastifyInstance): Promise<void> {
  // Reject unless authenticated AND the {user} segment is the caller's own handle.
  async function assertSelf(request: FastifyRequest<{ Params: { user: string } }>, reply: FastifyReply) {
    if ((request.params.user ?? '').toLowerCase() !== request.user.sub) {
      reply.code(403).send({ success: false, error: 'Forbidden' });
    }
  }
  const auth = { preHandler: [fastify.authenticate, assertSelf] };

  /**
   * Reject unless the caller's email address has been confirmed.
   *
   * Applied only to the routes that make content visible to other people —
   * publish, share, and setting share metadata. Saving and loading your own
   * scripts stays open so a new account is usable the moment it is created;
   * verification is the bar for putting something in front of others, which is
   * what makes registration spam worth the effort.
   *
   * Accounts created before verification existed are grandfathered by migration
   * 0002, so this cannot lock out existing users.
   */
  async function requireVerified(request: FastifyRequest, reply: FastifyReply) {
    const user = userService.findByUsername(request.user.sub);
    if (!user || user.emailVerifiedAt === null) {
      reply.code(403).send({
        success: false,
        error: 'Please confirm your email address before publishing or sharing.',
        code: 'email_not_verified',
      });
    }
  }
  const authVerified = { preHandler: [fastify.authenticate, assertSelf, requireVerified] };

  // The user's scripts (latest version each).
  fastify.get<{ Params: { user: string } }>('/scripts/:user', auth, async (request) => {
    return scriptStore.listForUser(request.user.sub);
  });

  // Create a new file (+ first version).
  fastify.post<{ Params: { user: string } }>('/scripts/:user', auth, async (request, reply) => {
    const stored = scriptStore.create(request.user.sub, request.body);
    reply.code(201);
    return stored;
  });

  // The caller's published configurators — every published version, newest first.
  // Lives under the static `/scripts/configurators` segment (a static child of the
  // static `scripts` node, like `/scripts/published`) so it isn't shadowed by the
  // `/scripts/:user/:fileId` param route; the author comes from the JWT, not the path.
  const authedOnly = { preHandler: [fastify.authenticate] };
  fastify.get('/scripts/configurators', authedOnly, async (request) => {
    return scriptStore.listPublishedVersionsForAuthor(request.user.sub);
  });

  // Edit a published configurator in place: update just this version's `published`
  // metadata (version + code snapshot unchanged). Body is the ScriptData whose
  // `published` is applied. Re-stamps the configurator URL (name/version stable).
  fastify.put<{ Params: { versionId: string } }>(
    '/scripts/configurators/:versionId',
    authedOnly,
    async (request, reply) => {
      const body = request.body as ScriptData;
      const published = body?.published;
      if (!published) {
        reply.code(422);
        return { success: false, error: 'Published metadata is required' };
      }
      if (body.name && body.version) {
        published.url = configuratorUrl(request.user.sub, body.name, body.version);
      }
      const stored = scriptStore.updatePublishedVersion(request.user.sub, request.params.versionId, published);
      // An in-place edit changes the title/description/fulfillments, so the stored
      // translations are now about text that no longer exists — re-translate. The job
      // re-checks the source hash before writing, so a stale result is discarded.
      void translationQueue.enqueue({
        author: request.user.sub, versionId: request.params.versionId, fileId: stored.fileId as string,
      }).catch(() => undefined);
      // Doubles as the thumbnail-regeneration path: an existing configurator can get a new
      // preview without a version bump. Content-addressed filenames mean the URL changes,
      // so a cached old image can never be shown.
      return attachThumbnail(
        request.user.sub, stored.fileId as string, stored,
        (request.body as WithThumbnailSvg)?.thumbnailSvg, 'configurator-edit',
      );
    },
  );

  // Un-publish a single version (clears its `published` metadata; keeps the row).
  fastify.delete<{ Params: { versionId: string } }>(
    '/scripts/configurators/:versionId',
    authedOnly,
    async (request, reply) => {
      scriptStore.unpublishVersion(request.user.sub, request.params.versionId);
      reply.code(204);
    },
  );

  // Latest version of one file.
  fastify.get<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request) => {
    return scriptStore.getFile(request.user.sub, request.params.fileId);
  });

  // Append a new version to an existing file.
  fastify.put<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request) => {
    return scriptStore.saveVersion(request.user.sub, request.params.fileId, request.body);
  });

  // Delete a file and all its versions.
  fastify.delete<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request, reply) => {
    scriptStore.deleteFile(request.user.sub, request.params.fileId);
    // Every version of the file is gone, so its whole thumbnail directory can go too.
    // (Un-publishing a version deliberately does NOT delete its thumbnail: the row
    // survives and may still be shared, which would leave that listing without an image.)
    await thumbnailStore.remove(request.user.sub, request.params.fileId);
    reply.code(204);
  });

  // Version history metadata.
  fastify.get<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId/versions', auth, async (request) => {
    return scriptStore.listVersions(request.user.sub, request.params.fileId);
  });

  // A specific historical version.
  fastify.get<{ Params: { user: string; fileId: string; versionId: string } }>(
    '/scripts/:user/:fileId/versions/:versionId',
    auth,
    async (request) => {
      return scriptStore.getVersion(request.user.sub, request.params.fileId, request.params.versionId);
    },
  );

  /**
   * Attach (or replace) one version's thumbnail on its own, after the fact.
   *
   * Thumbnails normally ride along in the share/publish body, which requires the drawing
   * to exist at the moment the user presses the button. It is generated in the browser in
   * the background and deliberately not waited for, so for a slow script it frequently
   * does not — the share goes out without a preview even though nothing failed anywhere.
   * That race is the single most common cause of a missing thumbnail (it is what the
   * `submit` + `state:"pending"` pair in the thumbnail log means).
   *
   * This endpoint decouples the two: the client sends the drawing whenever it is ready,
   * before or after the share, and a slow script simply gets its preview a few seconds
   * late. Content-addressed filenames make a late write safe — the URL changes with the
   * drawing, so nothing can be served stale.
   *
   * Unlike the publish path this is not best-effort: nothing else is riding on the
   * request, so a refused SVG is reported as a 422 rather than silently swallowed. The
   * reason stays in the log (it is not something a client should be told).
   */
  fastify.put<{ Params: { user: string; fileId: string; versionId: string }; Body: WithThumbnailSvg }>(
    '/scripts/:user/:fileId/versions/:versionId/thumbnail',
    authVerified,
    async (request, reply) => {
      const { fileId, versionId } = request.params;
      // Ownership + existence gate: getVersion 404s for a version that is not this
      // author's, so a late upload can never land on somebody else's row.
      scriptStore.getVersion(request.user.sub, fileId, versionId);

      const url = await thumbnailStore.write(
        request.user.sub, fileId, versionId, request.body?.thumbnailSvg, 'deferred',
      );
      if (!url) {
        reply.code(422);
        return { success: false, error: 'Thumbnail was not accepted' };
      }
      scriptStore.setThumbnail(request.user.sub, versionId, url);
      return { success: true, thumbnail: url };
    },
  );

  // Share a file: append a new version carrying a concrete semver + shared
  // metadata. Body is the full ScriptData (with `version` + `shared` set).
  fastify.post<{ Params: { user: string; fileId: string } }>(
    '/scripts/:user/:fileId/share',
    authVerified,
    async (request, reply) => {
      const stored = scriptStore.share(request.user.sub, request.params.fileId, request.body);
      reply.code(201);
      return attachThumbnail(
        request.user.sub, request.params.fileId, stored,
        (request.body as WithThumbnailSvg)?.thumbnailSvg, 'share',
      );
    },
  );

  // Publish a file as configurator: append a new version carrying a concrete
  // semver + published metadata. Body is the full ScriptData (with `version` +
  // `published` set).
  fastify.post<{ Params: { user: string; fileId: string } }>(
    '/scripts/:user/:fileId/publish',
    authVerified,
    async (request, reply) => {
      const body = request.body as ScriptData;
      // Stamp the public configurator URL (built from FRONTEND_URL) so the client
      // can show where the configurator is served — works in dev + prod.
      if (body?.published && body.version && body.name) {
        body.published.url = configuratorUrl(request.user.sub, body.name, body.version);
      }
      const stored = scriptStore.publish(request.user.sub, request.params.fileId, body);
      reply.code(201);
      // Fire-and-forget: the row is already committed, so translation can never fail the
      // publish. The author is not told this is happening and never waits for it — the
      // translations simply appear on the configurator a little later.
      void translationQueue.enqueue({
        author: request.user.sub, versionId: stored.id as string, fileId: request.params.fileId,
      }).catch(() => undefined);
      return attachThumbnail(
        request.user.sub, request.params.fileId, stored,
        (request.body as WithThumbnailSvg)?.thumbnailSvg, 'publish',
      );
    },
  );

  // Set/clear sharing metadata for a file. Body is the ScriptShared object, or
  // { shared: null } / null to un-share.
  fastify.put<{ Params: { user: string; fileId: string }; Body: { shared?: ScriptShared | null } | ScriptShared | null }>(
    '/scripts/:user/:fileId/shared',
    authVerified,
    async (request) => {
      const body = request.body as { shared?: ScriptShared | null } | ScriptShared | null;
      // Accept either the bare ScriptShared object or a { shared } envelope.
      const shared: ScriptShared | null =
        body && typeof body === 'object' && 'shared' in body
          ? (body.shared ?? null)
          : ((body as ScriptShared | null) ?? null);
      scriptStore.setShared(request.user.sub, request.params.fileId, shared);
      return { fileId: request.params.fileId, shared };
    },
  );
}
