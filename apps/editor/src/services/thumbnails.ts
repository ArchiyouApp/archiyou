/**
 * thumbnails — attach a script's preview after the fact.
 *
 * A preview is a line drawing generated HERE, in a background run nobody watches: the
 * share dialog kicks it off without awaiting it, so a preview can never block (or break) a
 * share. The cost is that a slow script is not finished drawing when the user presses
 * Share, and the share goes out carrying nothing.
 *
 * This is the recovery path: the drawing is PUT to its own endpoint whenever it is ready,
 * before or after the share, so a slow script gets its preview a few seconds late instead
 * of never. Error-swallowing by construction — by the time this runs the share has already
 * succeeded and the user has moved on, so there is nothing left to fail. What happened to
 * the bytes is recorded server-side (apps/server/src/services/thumbnailLog.ts).
 */

import { api } from './api.js';
import { authService } from './auth-service.js';

/**
 * Attach a drawing to an already-stored version.
 *
 * Resolves to the stored URL, or null when it did not land (not signed in, nothing to
 * send, or the server refused the SVG — which it logs). Never rejects.
 */
export async function uploadThumbnail(
  fileId: string,
  versionId: string,
  svg: string,
): Promise<string | null> {
  const user = authService.getUser()?.id;
  if (!user || !fileId || !versionId || !svg) return null;

  try {
    const res = await api.put<{ success?: boolean; thumbnail?: string }>(
      `/scripts/${user}/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/thumbnail`,
      { thumbnailSvg: svg },
    );
    return res?.thumbnail ?? null;
  } catch (err) {
    // A 422 here means the server refused the SVG; the reason is in the server's thumbnail
    // log, deliberately not in the response (see svgSanitize.ts).
    console.warn('uploadThumbnail(): could not attach thumbnail:', (err as Error)?.message ?? err);
    return null;
  }
}
