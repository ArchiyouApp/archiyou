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
import { translationQueue } from '../translation/TranslationQueue';
import { userService } from '../services/UserService';
import { configuratorUrl } from './scriptUrl';

/** A thumbnail upload: the PNG itself as the request body (`Content-Type: image/png`, parsed
 *  to a Buffer in plugin.ts). Never part of a ScriptData body, so the bytes can never
 *  round-trip through Script.fromData()/toData() or turn up in a library list response —
 *  only the resulting URL is persisted (ScriptData.thumbnail). The label says which flow
 *  sent it, for the thumbnail log. */
type ThumbnailBody = Buffer;
type ThumbnailKind = 'working' | 'version' | 'backfill';

function thumbnailKind(query: unknown): ThumbnailKind {
  const kind = (query as { kind?: unknown } | undefined)?.kind;
  return kind === 'backfill' || kind === 'version' || kind === 'working' ? kind : 'version';
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
    const user = await userService.findByUsername(request.user.sub);
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
    return await scriptStore.listForUser(request.user.sub);
  });

  // Create a new file (+ first version).
  fastify.post<{ Params: { user: string } }>('/scripts/:user', auth, async (request, reply) => {
    const stored = await scriptStore.create(request.user.sub, request.body);
    reply.code(201);
    return stored;
  });

  // The caller's published configurators — every published version, newest first.
  // Lives under the static `/scripts/configurators` segment (a static child of the
  // static `scripts` node, like `/scripts/published`) so it isn't shadowed by the
  // `/scripts/:user/:fileId` param route; the author comes from the JWT, not the path.
  const authedOnly = { preHandler: [fastify.authenticate] };
  fastify.get('/scripts/configurators', authedOnly, async (request) => {
    return await scriptStore.listPublishedVersionsForAuthor(request.user.sub);
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
      const stored = await scriptStore.updatePublishedVersion(request.user.sub, request.params.versionId, published);
      // An in-place edit changes the title/description/fulfillments, so the stored
      // translations are now about text that no longer exists — re-translate. The job
      // re-checks the source hash before writing, so a stale result is discarded.
      void translationQueue.enqueue({
        author: request.user.sub, versionId: request.params.versionId, fileId: stored.fileId as string,
      }).catch(() => undefined);
      // The editor re-renders the preview for an edit and attaches it afterwards through
      // PUT …/versions/:versionId/thumbnail, so an existing configurator gets a fresh
      // picture without a version bump.
      return stored;
    },
  );

  // Un-publish a single version (clears its `published` metadata; keeps the row).
  fastify.delete<{ Params: { versionId: string } }>(
    '/scripts/configurators/:versionId',
    authedOnly,
    async (request, reply) => {
      await scriptStore.unpublishVersion(request.user.sub, request.params.versionId);
      reply.code(204);
    },
  );

  // Latest version of the file that has — or used to have — a name. Rename fallback for
  // $component('./oldname') in the editor (Runner._getRenamedComponentScript). Registered
  // as a static segment, so it wins over `/:user/:fileId/versions`.
  fastify.get<{ Params: { user: string; name: string } }>('/scripts/:user/by-name/:name', auth, async (request) => {
    return await scriptStore.getFileByName(request.user.sub, request.params.name);
  });

  // Latest version of one file.
  fastify.get<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request) => {
    return await scriptStore.getFile(request.user.sub, request.params.fileId);
  });

  // Append a new version to an existing file.
  fastify.put<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request) => {
    return await scriptStore.saveVersion(request.user.sub, request.params.fileId, request.body);
  });

  // Delete a file and all its versions.
  fastify.delete<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId', auth, async (request, reply) => {
    await scriptStore.deleteFile(request.user.sub, request.params.fileId);
    // Every version of the file is gone, so its whole thumbnail directory can go too.
    // (Un-publishing a version deliberately does NOT delete its thumbnail: the row
    // survives and may still be shared, which would leave that listing without an image.)
    await thumbnailStore.remove(request.user.sub, request.params.fileId);
    reply.code(204);
  });

  // Version history metadata.
  fastify.get<{ Params: { user: string; fileId: string } }>('/scripts/:user/:fileId/versions', auth, async (request) => {
    return await scriptStore.listVersions(request.user.sub, request.params.fileId);
  });

  // A specific historical version.
  fastify.get<{ Params: { user: string; fileId: string; versionId: string } }>(
    '/scripts/:user/:fileId/versions/:versionId',
    auth,
    async (request) => {
      return await scriptStore.getVersion(request.user.sub, request.params.fileId, request.params.versionId);
    },
  );

  /**
   * Attach (or replace) one stored version's thumbnail.
   *
   * The picture is rendered in the browser, in the background, and deliberately never
   * waited for: a share or publish goes out first and the editor sends the PNG here when
   * it is ready — a few seconds later for a slow script, and again whenever a configurator
   * is edited (a fresh preview without a version bump). The browser page uses the same
   * route to backfill the owner's own versions that have none (`?kind=backfill`, a log
   * label only). Content-addressed filenames make a late write safe — the URL changes with
   * the picture, so nothing can be served stale.
   *
   * Nothing else is riding on the request, so a refused picture is reported as a 422
   * rather than silently swallowed. The reason stays in the log (it is not something a
   * client should be told).
   */
  fastify.put<{ Params: { user: string; fileId: string; versionId: string }; Body: ThumbnailBody }>(
    '/scripts/:user/:fileId/versions/:versionId/thumbnail',
    authVerified,
    async (request, reply) => {
      const { fileId, versionId } = request.params;
      // Ownership + existence gate: getVersion 404s for a version that is not this
      // author's, so a late upload can never land on somebody else's row.
      await scriptStore.getVersion(request.user.sub, fileId, versionId);

      const url = await thumbnailStore.write(
        request.user.sub, fileId, versionId, request.body, thumbnailKind(request.query),
      );
      if (!url) {
        reply.code(422);
        return { success: false, error: 'Thumbnail was not accepted' };
      }
      await scriptStore.setThumbnail(request.user.sub, versionId, url);
      return { success: true, thumbnail: url };
    },
  );

  /**
   * The WORKING copy's preview — what the browser page shows for a script that was never
   * shared or published, and what the share/publish dialogs start from. The editor renders
   * it in the background after a run and uploads it here, addressed by file: every save
   * appends a row the editor never hears back from, so it cannot name the latest version
   * id, and the store keeps one `working-*` file per file anyway. Stamped on whatever row
   * is latest; saveVersion() carries it to the rows that follow.
   *
   * `auth`, not `authVerified`: nothing here is shown to anyone but the owner.
   */
  fastify.put<{ Params: { user: string; fileId: string }; Body: ThumbnailBody }>(
    '/scripts/:user/:fileId/thumbnail',
    auth,
    async (request, reply) => {
      const { fileId } = request.params;
      // Ownership + existence gate first (404s a file that is not this author's), so
      // nothing is ever written to disk for a file the caller does not own.
      await scriptStore.getFile(request.user.sub, fileId);

      const url = await thumbnailStore.writeWorking(
        request.user.sub, fileId, request.body, thumbnailKind(request.query),
      );
      if (!url) {
        reply.code(422);
        return { success: false, error: 'Thumbnail was not accepted' };
      }
      await scriptStore.setFileThumbnail(request.user.sub, fileId, url);
      return { success: true, thumbnail: url };
    },
  );

  // Share a file: append a new version carrying a concrete semver + shared
  // metadata. Body is the full ScriptData (with `version` + `shared` set).
  fastify.post<{ Params: { user: string; fileId: string } }>(
    '/scripts/:user/:fileId/share',
    authVerified,
    async (request, reply) => {
      reply.code(201);
      // The preview follows separately (PUT …/versions/:versionId/thumbnail) once the
      // editor has rendered it, so a share never waits on — or fails over — a picture.
      return await scriptStore.share(request.user.sub, request.params.fileId, request.body);
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
      const stored = await scriptStore.publish(request.user.sub, request.params.fileId, body);
      reply.code(201);
      // Fire-and-forget: the row is already committed, so translation can never fail the
      // publish. The author is not told this is happening and never waits for it — the
      // translations simply appear on the configurator a little later.
      void translationQueue.enqueue({
        author: request.user.sub, versionId: stored.id as string, fileId: request.params.fileId,
      }).catch(() => undefined);
      return stored;
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
      await scriptStore.setShared(request.user.sub, request.params.fileId, shared);
      return { fileId: request.params.fileId, shared };
    },
  );
}
