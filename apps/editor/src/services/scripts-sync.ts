/**
 * scripts-sync — mirrors the local script collection to apps/server when the
 * user is signed in. Anonymous users are unaffected (every export is a no-op
 * without a token), so the existing localStorage-only flow keeps working.
 *
 * Strategy: the server is the per-user store of record.
 *  - On sign-in / app load: `pullUserScripts()` reconciles the local collection
 *    with the server per file (fileId), last-write-wins by `updated`: a local
 *    script that is newer than (or absent from) the server is pushed up; an
 *    equal/newer server copy is adopted locally. This lets a user work offline
 *    (anonymous or disconnected) for a while and then sign in without losing
 *    their newer local edits.
 *  - On local mutation: `syncCreate` / `syncSaveActive` (debounced) /
 *    `syncDelete` push changes up. A fileId not yet known to the server is
 *    POSTed (create); a known one is PUT (new version).
 *
 * The core↔sync import cycle is function-level only (both sides touch each
 * other's bindings inside functions, never at module-eval time), which ESM
 * and Vite resolve without issue.
 */

import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { api, ApiError } from './api.js';
import { authService } from './auth-service.js';
import { scripts, editorScript, bumpScripts, saveCollection } from '../state/core.js';

/** fileIds we know exist on the server (so we choose PUT vs POST correctly). */
const serverFileIds = new Set<string>();

/** Per-file debounce timers for active-script saves. */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 900;

function authed(): boolean {
  return authService.isAuthenticated();
}

/** The signed-in user's handle (== PublicUser.id == script author), needed to
 *  build the `/scripts/{user}/…` paths. Undefined when not signed in. */
function handle(): string | undefined {
  return authService.getUser()?.id ?? undefined;
}

/** Reconcile the signed-in user's local collection with the server, per file,
 *  last-write-wins by `updated`: a local script that is newer than (or missing
 *  from) the server is pushed up; an equal/newer server copy is adopted locally.
 *  This lets a user work offline and then sign in without losing their newer
 *  local edits. Foreign (read-only) scripts owned by another user are skipped. */
export async function pullUserScripts(): Promise<void> {
  if (!authed()) return;
  const user = handle();
  if (!user) return;

  let remote: ScriptData[];
  try {
    remote = await api.get<ScriptData[]>(`/scripts/${user}`);
  } catch (err) {
    console.warn('scripts-sync: pull failed', err);
    return;
  }

  // Index the server's latest-per-file by fileId.
  const remoteById = new Map<string, ScriptData>();
  for (const data of remote) {
    if (!data.fileId) continue;
    serverFileIds.add(data.fileId);
    remoteById.set(data.fileId, data);
  }

  const list = scripts.get();
  const active = editorScript.get();
  const seenLocal = new Set<string>();
  const toPush: Script[] = [];

  // Reconcile each local script against its server twin.
  for (let i = 0; i < list.length; i++) {
    const local = list[i];
    const fileId = local.fileId;
    if (!fileId) continue;
    seenLocal.add(fileId);

    // Never sync a foreign (read-only) shared script owned by someone else.
    if (local.author && local.author !== user) continue;

    const remoteData = remoteById.get(fileId);
    if (!remoteData) {
      // Absent server-side (offline-authored or never synced) → create it.
      toPush.push(local);
      continue;
    }

    const localMs  = local.updated?.getTime() ?? 0;
    const remoteMs = remoteData.updated ? new Date(remoteData.updated).getTime() : 0;

    if (localMs > remoteMs) {
      // Newer locally (e.g. edited offline) → push our version up.
      toPush.push(local);
    } else {
      // Server is newer or equal → adopt the server copy.
      const merged = Script.fromData(remoteData);
      if (merged) {
        list[i] = merged;
        // Keep the open script's instance in sync when it is this file.
        if (active && active.fileId === fileId && active !== merged) {
          editorScript.set(merged);
        }
      }
    }
  }

  // Server files we don't have locally → add them.
  for (const [fileId, data] of remoteById) {
    if (seenLocal.has(fileId)) continue;
    const script = Script.fromData(data);
    if (script) list.push(script);
  }

  bumpScripts();
  saveCollection();

  // Push newer/absent local scripts up. syncSaveNow chooses PUT (known fileId)
  // vs POST (create) — remote fileIds were registered above, so twins PUT.
  for (const script of toPush) {
    await syncSaveNow(script);
  }
}

/** Push a brand-new script to the server (POST). */
export async function syncCreate(script: Script): Promise<void> {
  if (!authed()) return;
  const user = handle();
  const data = script.toData();
  if (!user || !data.fileId) return;
  try {
    await api.post<ScriptData>(`/scripts/${user}`, data);
    serverFileIds.add(data.fileId);
  } catch (err) {
    // A 409-ish "already exists" just means we should PUT instead.
    if (err instanceof ApiError && err.status === 409) {
      serverFileIds.add(data.fileId);
      await syncSaveNow(script);
    } else {
      console.warn('scripts-sync: create failed', err);
    }
  }
}

/** Debounced mirror of the active script (called on every keystroke save). */
export function syncSaveActive(script: Script): void {
  if (!authed()) return;
  const fileId = script.fileId;
  if (!fileId) return;
  const existing = saveTimers.get(fileId);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    fileId,
    setTimeout(() => {
      saveTimers.delete(fileId);
      void syncSaveNow(script);
    }, SAVE_DEBOUNCE_MS),
  );
}

/** Immediate save: PUT if the file is known server-side, else POST (create). */
export async function syncSaveNow(script: Script): Promise<void> {
  if (!authed()) return;
  const user = handle();
  const data = script.toData();
  const fileId = data.fileId;
  if (!user || !fileId) return;
  try {
    if (serverFileIds.has(fileId)) {
      await api.put<ScriptData>(`/scripts/${user}/${fileId}`, data);
    } else {
      await api.post<ScriptData>(`/scripts/${user}`, data);
      serverFileIds.add(fileId);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Server lost the file; recreate it.
      serverFileIds.delete(fileId);
      try { await api.post<ScriptData>(`/scripts/${user}`, data); serverFileIds.add(fileId); }
      catch (e) { console.warn('scripts-sync: recreate failed', e); }
    } else {
      console.warn('scripts-sync: save failed', err);
    }
  }
}

/** Every concrete version string this file already used server-side (shared AND
 *  published — `(fileId, version)` is unique across both). The share/publish
 *  menus need it to suggest a version that can't collide. Empty when anonymous
 *  or when the file is not on the server (yet). */
export async function fetchFileVersions(fileId: string): Promise<string[]> {
  if (!authed() || !fileId) return [];
  const user = handle();
  if (!user) return [];
  try {
    const versions = await api.get<Array<{ version: string | null }>>(`/scripts/${user}/${fileId}/versions`);
    return versions.map((v) => v.version).filter((v): v is string => !!v);
  } catch (err) {
    console.warn('scripts-sync: version list failed', err);
    return [];
  }
}

/** Delete a file server-side. */
export async function syncDelete(fileId: string): Promise<void> {
  if (!authed() || !fileId) return;
  const user = handle();
  if (!user) return;
  const timer = saveTimers.get(fileId);
  if (timer) { clearTimeout(timer); saveTimers.delete(fileId); }
  try {
    await api.delete(`/scripts/${user}/${fileId}`);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      console.warn('scripts-sync: delete failed', err);
    }
  }
  serverFileIds.delete(fileId);
}

// Self-initialize: for returning users (token already in localStorage), pull
// once after the module graph has finished evaluating. Deferred via microtask
// so core's signals are fully defined before we touch them.
queueMicrotask(() => { if (authed()) void pullUserScripts(); });
