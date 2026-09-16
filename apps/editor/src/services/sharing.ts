/**
 * sharing — client for the script-sharing + user-directory endpoints.
 *
 *  - shareScript(): append a shared version (concrete semver + ScriptShared) for
 *    the active file. Ensures the file exists server-side first.
 *  - fetchPublicShared / fetchSharedWithMe: feed the script-manager tabs.
 *  - fetchSharedVersions: powers the version-bump suggestion in the share menu.
 *  - searchUsers: the "Share only with" people picker.
 *
 * The library + user endpoints wrap their payload in `{ success, data }`; the
 * owner-scoped `/scripts/{user}/…` share endpoint returns the ScriptData raw.
 */

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import type { PublicUser } from '@archiyou/types';

import { api } from './api.js';
import { authService } from './auth-service.js';
import { syncSaveNow } from './scripts-sync.js';

interface Envelope<T> { success: boolean; error?: string; data?: T }

function handle(): string | undefined {
  return authService.getUser()?.id ?? undefined;
}

/** Community-shared scripts (no `onlyUsers` restriction), latest version each. */
export async function fetchPublicShared(): Promise<ScriptData[]> {
  const res = await api.get<Envelope<ScriptData[]>>('/scripts/shared');
  return res.data ?? [];
}

/** Scripts shared specifically with the signed-in user. Empty when anonymous. */
export async function fetchSharedWithMe(): Promise<ScriptData[]> {
  if (!authService.isAuthenticated()) return [];
  const res = await api.get<Envelope<ScriptData[]>>('/scripts/shared/with-me');
  return res.data ?? [];
}

/** Existing shared version strings for a file (author/name), latest first. */
export async function fetchSharedVersions(author: string, name: string): Promise<string[]> {
  try {
    const res = await api.get<Envelope<string[]>>(
      `/scripts/shared/${encodeURIComponent(author)}/${encodeURIComponent(name)}/versions`,
    );
    return res.data ?? [];
  } catch {
    return [];
  }
}

/** The latest shared version of a file (author/name), or null if never shared.
 *  Used to prefill the share menu (last version + description/licence/dev/users). */
export async function fetchSharedScript(author: string, name: string): Promise<ScriptData | null> {
  try {
    const res = await api.get<Envelope<ScriptData>>(
      `/scripts/shared/${encodeURIComponent(author)}/${encodeURIComponent(name)}`,
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

/** Search accounts for the people picker (excludes the caller server-side). */
export async function searchUsers(query: string): Promise<PublicUser[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await api.get<Envelope<PublicUser[]>>(`/users/search?q=${encodeURIComponent(q)}`);
  return res.data ?? [];
}

/** Share the active file: append a version carrying `version` + the ScriptShared
 *  metadata. Ensures the file exists server-side first (share is a no-op on an
 *  unknown file). Returns the stored ScriptData. */
export async function shareScript(script: Script): Promise<ScriptData> {
  const user = handle();
  if (!user) throw new Error('Sign in to share a script');
  const fileId = script.fileId;
  if (!fileId) throw new Error('Script has no fileId');

  // Guarantee the file exists on the server before appending a shared version.
  await syncSaveNow(script);

  // The preview is not part of this: it is attached afterwards, in the background, by
  // services/thumbnails.ts — so sharing never waits on (or fails because of) a picture.
  return api.post<ScriptData>(`/scripts/${user}/${fileId}/share`, script.toData());
}
