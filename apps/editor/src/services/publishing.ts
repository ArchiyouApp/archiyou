/**
 * publishing — client for publishing a script as a configurator.
 *
 *  - publishScript(): append a published version (concrete semver + the published
 *    metadata: title/description/public/licence/fulfillments) for the active file.
 *    Ensures the file exists server-side first (mirrors sharing.ts).
 *  - fetchPublishedScript(): the latest published version of a file (author/name),
 *    used to prefill the publish menu (last version + description/licence/fulfillments).
 *  - fetchPublishedConfigurators(): the whole published library, for the browser.
 *
 * The published library GET wraps its payload in `{ success, data }`; the
 * owner-scoped `/scripts/{user}/…/publish` endpoint returns the ScriptData raw.
 *
 * See sharing.ts for the parallel sharing client.
 */

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { api } from './api.js';
import { authService } from './auth-service.js';
import { syncSaveNow } from './scripts-sync.js';

interface Envelope<T> { success: boolean; error?: string; data?: T }

function handle(): string | undefined {
  return authService.getUser()?.id ?? undefined;
}

/** The latest published version of a file (author/name), or null if never published.
 *  Used to prefill the publish menu (last version + description/licence/fulfillments). */
export async function fetchPublishedScript(author: string, name: string): Promise<ScriptData | null> {
  try {
    const res = await api.get<Envelope<ScriptData>>(
      `/scripts/published/${encodeURIComponent(author)}/${encodeURIComponent(name)}`,
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** The latest published version of every configurator, across all authors — the browser's
 *  Configurators section. Includes non-public ones: the caller decides what to show. */
export async function fetchPublishedConfigurators(): Promise<ScriptData[]> {
  const res = await api.get<Envelope<ScriptData[]>>('/scripts/published');
  return res.data ?? [];
}

/** A published script by `user` and `name[:version]` (the URL segment used by the
 *  configurator route). No version ⇒ latest. Returns null when not found. */
export async function fetchPublishedScriptVersion(user: string, scriptAndVersion: string): Promise<ScriptData | null> {
  const [name, version] = scriptAndVersion.split(':');
  const segment = version
    ? `${encodeURIComponent(name)}:${encodeURIComponent(version)}`
    : encodeURIComponent(name);
  try {
    const res = await api.get<Envelope<ScriptData>>(
      `/scripts/published/${encodeURIComponent(user)}/${segment}`,
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** Every published version owned by the signed-in user (one entry per published
 *  version, newest first) — powers the "manage configurators" list. Empty when
 *  anonymous. */
export async function fetchMyConfigurators(): Promise<ScriptData[]> {
  if (!handle()) return [];
  // Author comes from the JWT server-side (static path avoids the :fileId clash).
  return api.get<ScriptData[]>('/scripts/configurators');
}

/** Un-publish a single version (clears its `published` metadata server-side).
 *  `versionId` is the row/version id (`ScriptData.id`). */
export async function unpublishConfigurator(versionId: string): Promise<void> {
  if (!handle()) throw new Error('Sign in to manage configurators');
  await api.delete<void>(`/scripts/configurators/${encodeURIComponent(versionId)}`);
}

/** Edit an existing configurator: update just this version's `published` metadata
 *  in place (version + code snapshot unchanged). `script.id` identifies the version.
 *  Returns the stored ScriptData. */
export async function updateConfigurator(script: ScriptData, thumbnailSvg?: string | null): Promise<ScriptData> {
  if (!handle()) throw new Error('Sign in to edit configurators');
  if (!script.id) throw new Error('Configurator has no version id');
  return api.put<ScriptData>(`/scripts/configurators/${encodeURIComponent(script.id)}`,
    withThumbnail(script, thumbnailSvg));
}

/** Publish the active file: append a version carrying `version` + the ScriptPublished
 *  metadata. Ensures the file exists server-side first (publish is a no-op on an
 *  unknown file). Returns the stored ScriptData. */
export async function publishScript(script: Script, thumbnailSvg?: string | null): Promise<ScriptData> {
  const user = handle();
  if (!user) throw new Error('Sign in to publish a script');
  const fileId = script.fileId;
  if (!fileId) throw new Error('Script has no fileId');

  // Guarantee the file exists on the server before appending a published version.
  await syncSaveNow(script);

  return api.post<ScriptData>(`/scripts/${user}/${fileId}/publish`,
    withThumbnail(script.toData(), thumbnailSvg));
}

/** Attach the thumbnail SVG source to a publish/share body.
 *
 *  `thumbnailSvg` is deliberately NOT a ScriptData field: the server writes the SVG to
 *  disk and stamps only the resulting URL onto `ScriptData.thumbnail`, so the bytes never
 *  round-trip through the script model or bloat a library list response. Omitted when
 *  there is nothing to send, so the field never appears as `undefined` on the wire. */
function withThumbnail(data: ScriptData, thumbnailSvg?: string | null): ScriptData {
  return thumbnailSvg ? ({ ...data, thumbnailSvg } as ScriptData) : data;
}
