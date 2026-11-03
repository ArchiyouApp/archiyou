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
import { authService, authReady } from './auth-service.js';
import { scripts, editorScript, bumpScripts, saveCollection } from '../state/core.js';

/** fileIds we know exist on the server (so we choose PUT vs POST correctly). */
const serverFileIds = new Set<string>();

/** Per-file debounced active-script saves: the timer and the script it will send. */
const saveTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; script: Script }>();
const SAVE_DEBOUNCE_MS = 900;

/** One row of a file's server-side history (ScriptStore.listVersions). */
export interface VersionMeta
{
  id: string;
  version: string | null;
  name: string | null;
  lines: number;
  created: number;
  updated: number;
}

/** Drop the debounced save of a file, if one is waiting. Returns the script it would send. */
function cancelPendingSave(fileId: string): Script | undefined
{
  const pending = saveTimers.get(fileId);
  if (!pending) return undefined;
  clearTimeout(pending.timer);
  saveTimers.delete(fileId);
  return pending.script;
}

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
  // On a reload the token is there straight away, but the handle only arrives with the
  // /auth/me check (authReady). Without waiting, the load-time pull found no user and
  // silently did nothing: the editor stayed on its local copies, and not knowing which files
  // the server has, sent every save as a create, which the server refused.
  const user = handle() ?? (await authReady)?.id;
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
      // Server is newer or equal → adopt the server copy. A save of the local copy still
      // waiting for its debounce would put the old code back on top of it: drop it.
      cancelPendingSave(fileId);
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
  cancelPendingSave(fileId);
  const timer = setTimeout(() => {
    saveTimers.delete(fileId);
    void syncSaveNow(script);
  }, SAVE_DEBOUNCE_MS);
  saveTimers.set(fileId, { timer, script });
}

/** Send a file's debounced save now instead of when its timer fires. A restore calls this
 *  first, so the state from just before it is kept as a row of its own. */
export async function flushPendingSave(fileId: string): Promise<void>
{
  const script = cancelPendingSave(fileId);
  if (script) await syncSaveNow(script);
}

/** Immediate save: PUT if the file is known server-side, else POST (create).
 *  `checkpoint` makes the server append a row instead of merging into a recent autosave. */
export async function syncSaveNow(script: Script, opts: { checkpoint?: boolean } = {}): Promise<void> {
  if (!authed()) return;
  const user = handle();
  const data = script.toData();
  const fileId = data.fileId;
  if (!user || !fileId) return;
  // This save sends the script's current state, so a debounced save of it is redundant.
  if (saveTimers.get(fileId)?.script === script) cancelPendingSave(fileId);
  const putPath = `/scripts/${user}/${fileId}${opts.checkpoint ? '?checkpoint=1' : ''}`;
  try {
    if (serverFileIds.has(fileId)) {
      await api.put<ScriptData>(putPath, data);
    } else {
      await api.post<ScriptData>(`/scripts/${user}`, data);
      serverFileIds.add(fileId);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // Created as new, but the server has the file already (we missed it in a pull): save a
      // version of it instead.
      serverFileIds.add(fileId);
      try { await api.put<ScriptData>(putPath, data); }
      catch (e) { console.warn('scripts-sync: save failed', e); }
    } else if (err instanceof ApiError && err.status === 404) {
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
  const versions = await listFileVersions(fileId);
  return versions.map((v) => v.version).filter((v): v is string => !!v);
}

/** The file's server-side history, newest first. Empty when anonymous or when the file
 *  is not on the server (yet). */
export async function listFileVersions(fileId: string): Promise<VersionMeta[]>
{
  if (!authed() || !fileId) return [];
  const user = handle();
  if (!user) return [];
  try
  {
    return await api.get<VersionMeta[]>(`/scripts/${user}/${fileId}/versions`);
  }
  catch (err)
  {
    console.warn('scripts-sync: version list failed', err);
    return [];
  }
}

/** One stored version of the user's file in full, or null. */
export async function fetchFileVersion(fileId: string, versionId: string): Promise<ScriptData | null>
{
  if (!authed() || !fileId || !versionId) return null;
  const user = handle();
  if (!user) return null;
  try
  {
    return await api.get<ScriptData>(`/scripts/${user}/${fileId}/versions/${versionId}`);
  }
  catch (err)
  {
    console.warn('scripts-sync: version fetch failed', err);
    return null;
  }
}

/** The latest stored version of the user's file that has — or used to have — `name`,
 *  or null. Resolves references to a script by its name from before a rename. */
export async function fetchFileByName(name: string): Promise<ScriptData | null> {
  if (!authed() || !name) return null;
  const user = handle();
  if (!user) return null;
  try {
    return await api.get<ScriptData>(`/scripts/${user}/by-name/${encodeURIComponent(name)}`);
  } catch {
    return null;
  }
}

/** Delete a file server-side. */
export async function syncDelete(fileId: string): Promise<void> {
  if (!authed() || !fileId) return;
  const user = handle();
  if (!user) return;
  cancelPendingSave(fileId);
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
