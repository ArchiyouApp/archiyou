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
 *  - Every save says which server version the local copy was made from (its
 *    base: row id and `updated`). When the file has a newer version, made in
 *    another tab, browser or by a script, the server refuses the save (409) and
 *    nothing is overwritten: `saveConflict` is set and the editor asks whether to
 *    load the saved version or keep this one on top of it. Opening a script and a
 *    run that only changes the values the script sets itself save to the browser
 *    only (state/core.ts), so an untouched copy never travels back up.
 *
 * The core↔sync import cycle is function-level only (both sides touch each
 * other's bindings inside functions, never at module-eval time), which ESM
 * and Vite resolve without issue.
 */

import { signal } from '@lit-labs/signals';
import { Script } from '@archiyou/core/src/Script';
import type { ScriptData } from '@archiyou/core/src/execution/types';

import { api, ApiError } from './api.js';
import { authService, authReady } from './auth-service.js';
import { scripts, editorScript, bumpScripts, saveCollection } from '../state/core.js';

/** fileIds we know exist on the server (so we choose PUT vs POST correctly). */
const serverFileIds = new Set<string>();

/** The server version a local copy was made from, per fileId. Kept in localStorage, so a
 *  reload still knows what the copies in the browser are based on. */
interface SyncBase
{
  id: string;
  updated: string;
}
const BASES_STORAGE_KEY = 'archiyou:editor:sync-bases';
/** Files with edits that have not reached the server yet (kept across reloads). */
const DIRTY_STORAGE_KEY = 'archiyou:editor:sync-dirty';

function readStored<T>(key: string, fallback: T): T
{
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T; }
  catch { return fallback; }
}
function writeStored(key: string, value: unknown): void
{
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* storage unavailable */ }
}

const bases = new Map<string, SyncBase>(Object.entries(readStored<Record<string, SyncBase>>(BASES_STORAGE_KEY, {})));
const dirty = new Set<string>(readStored<string[]>(DIRTY_STORAGE_KEY, []));

/** Remember the server version a file's local copy now matches. */
function setBase(fileId: string, data: { id?: string; updated?: string | number | Date | null }): void
{
  if (!data.id || !data.updated) return;
  const updated = data.updated instanceof Date ? data.updated.toISOString() : new Date(data.updated).toISOString();
  bases.set(fileId, { id: data.id, updated });
  writeStored(BASES_STORAGE_KEY, Object.fromEntries(bases));
}

function setDirty(fileId: string, on: boolean): void
{
  if (on === dirty.has(fileId)) return;
  if (on) dirty.add(fileId); else dirty.delete(fileId);
  writeStored(DIRTY_STORAGE_KEY, [...dirty]);
}

/** A save the server refused because the file has a newer version than the local copy's.
 *  The editor shows it and resolves it with resolveConflict(). */
export interface SaveConflict
{
  fileId: string;
  name: string;
}
export const saveConflict = signal<SaveConflict | null>(null);

/** The saves of one file go out one after the other, so each knows the base the previous left. */
const queues = new Map<string, Promise<void>>();
function enqueue(fileId: string, job: () => Promise<void>): Promise<void>
{
  const next = (queues.get(fileId) ?? Promise.resolve()).then(job, job);
  queues.set(fileId, next.catch(() => undefined));
  return next;
}

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
    const base = bases.get(fileId);
    const unchanged = base && base.id === remoteData.id && new Date(base.updated).getTime() === remoteMs;

    if (dirty.has(fileId) || (!base && localMs > remoteMs)) {
      // Edits here that never reached the server (e.g. made offline) → push them. With a base
      // the server refuses them when the file moved on meanwhile (a conflict, see syncSaveNow).
      toPush.push(local);
    } else if (unchanged) {
      // The server still has the version this copy was made from: nothing to do.
      continue;
    } else {
      // Server is newer or equal → adopt the server copy. A save of the local copy still
      // waiting for its debounce would put the old code back on top of it: drop it.
      cancelPendingSave(fileId);
      setBase(fileId, remoteData);
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
    setBase(fileId, data);
    const script = Script.fromData(data);
    if (script) list.push(script);
  }

  bumpScripts();
  saveCollection();

  // Push newer/absent local scripts up. syncSaveNow chooses PUT (known fileId)
  // vs POST (create) — remote fileIds were registered above, so twins PUT.
  for (const script of toPush) {
    // A copy without a base (from before bases were kept) cannot be checked: it goes on top as
    // a row of its own, never merged into the server's latest one.
    await syncSaveNow(script, { checkpoint: !bases.has(script.fileId) });
  }
}

/** Push a brand-new script to the server (POST). */
export async function syncCreate(script: Script): Promise<void> {
  if (!authed()) return;
  const user = handle();
  const data = script.toData();
  if (!user || !data.fileId) return;
  try {
    const stored = await api.post<ScriptData>(`/scripts/${user}`, data);
    serverFileIds.add(data.fileId);
    setBase(data.fileId, stored);
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
  setDirty(fileId, true);
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
 *  `checkpoint` makes the server append a row instead of merging into a recent autosave.
 *  A PUT carries the copy's base; a 409 on it is a conflict: nothing is saved, and the file
 *  is not saved again until the editor resolves it (resolveConflict). */
export async function syncSaveNow(script: Script, opts: { checkpoint?: boolean } = {}): Promise<void> {
  if (!authed()) return;
  const user = handle();
  const fileId = script.fileId;
  if (!user || !fileId) return;
  // This save sends the script's current state, so a debounced save of it is redundant.
  if (saveTimers.get(fileId)?.script === script) cancelPendingSave(fileId);
  setDirty(fileId, true);
  return enqueue(fileId, () => saveOne(user, script, opts));
}

async function saveOne(user: string, script: Script, opts: { checkpoint?: boolean }): Promise<void>
{
  const fileId = script.fileId;
  if (saveConflict.get()?.fileId === fileId) return;   // waiting for the user
  const data = script.toData();
  const put = async () =>
  {
    const base = bases.get(fileId);
    const query = new URLSearchParams();
    if (opts.checkpoint) query.set('checkpoint', '1');
    if (base) { query.set('base', base.id); query.set('baseUpdated', base.updated); }
    const q = query.toString();
    return api.put<ScriptData>(`/scripts/${user}/${fileId}${q ? `?${q}` : ''}`, data);
  };
  const done = (stored: ScriptData) => { setBase(fileId, stored); setDirty(fileId, false); };
  try {
    if (serverFileIds.has(fileId)) {
      done(await put());
    } else {
      done(await api.post<ScriptData>(`/scripts/${user}`, data));
      serverFileIds.add(fileId);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && serverFileIds.has(fileId)) {
      // The file has a newer version than this copy was made from.
      console.warn(`scripts-sync: ${script.name ?? fileId} has a newer version on the server; not saved`);
      saveConflict.set({ fileId, name: script.name ?? '' });
    } else if (err instanceof ApiError && err.status === 409) {
      // Created as new, but the server has the file already (we missed it in a pull). With a
      // base the save goes through as a version (the server checks the base); without one this
      // copy cannot be checked against the server's versions: a conflict.
      serverFileIds.add(fileId);
      if (!bases.has(fileId)) { saveConflict.set({ fileId, name: script.name ?? '' }); return; }
      try { done(await put()); }
      catch (e) {
        if (e instanceof ApiError && e.status === 409) saveConflict.set({ fileId, name: script.name ?? '' });
        else console.warn('scripts-sync: save failed', e);
      }
    } else if (err instanceof ApiError && err.status === 404) {
      // Server lost the file; recreate it.
      serverFileIds.delete(fileId);
      try { done(await api.post<ScriptData>(`/scripts/${user}`, data)); serverFileIds.add(fileId); }
      catch (e) { console.warn('scripts-sync: recreate failed', e); }
    } else {
      console.warn('scripts-sync: save failed', err);
    }
  }
}

/** The latest server version of one of my files, or null. */
async function fetchLatest(fileId: string): Promise<ScriptData | null>
{
  const user = handle() ?? (await authReady)?.id;
  if (!authed() || !user) return null;
  try { return await api.get<ScriptData>(`/scripts/${user}/${fileId}`); }
  catch { return null; }
}

/** Put a server version in the collection (and in the editor when it is open there). */
function adopt(data: ScriptData): Script | null
{
  const fresh = Script.fromData(data);
  if (!fresh) return null;
  const list = scripts.get();
  const i = list.findIndex((s) => s.fileId === fresh.fileId);
  if (i >= 0) list[i] = fresh; else list.push(fresh);
  if (editorScript.get()?.fileId === fresh.fileId) editorScript.set(fresh);
  setBase(fresh.fileId, data);
  bumpScripts();
  saveCollection();
  return fresh;
}

/** Before opening one of my scripts: take the server's latest version when the copy in this
 *  browser is older and has no edits of its own still to be saved. A copy with such edits is
 *  kept; its next save tells whether the server moved on (a conflict). */
export async function refreshFromServer(fileId: string): Promise<void>
{
  if (!authed() || !fileId || dirty.has(fileId) || saveTimers.has(fileId)) return;
  const local = scripts.get().find((s) => s.fileId === fileId);
  if (local?.author && local.author !== handle()) return;
  const latest = await fetchLatest(fileId);
  if (!latest?.id) return;
  serverFileIds.add(fileId);
  const base = bases.get(fileId);
  const same = base && base.id === latest.id && new Date(base.updated).getTime() === new Date(latest.updated ?? 0).getTime();
  if (!same && !dirty.has(fileId) && !saveTimers.has(fileId)) adopt(latest);
}

/** Resolve a conflict: `theirs` loads the server's latest version in place of this copy (its
 *  unsaved edits are dropped); `mine` saves this copy on top as a row of its own, so the other
 *  version stays in the history. */
export async function resolveConflict(choice: 'theirs' | 'mine'): Promise<void>
{
  const conflict = saveConflict.get();
  if (!conflict) return;
  const { fileId } = conflict;
  const latest = await fetchLatest(fileId);
  if (!latest) return;
  cancelPendingSave(fileId);
  if (choice === 'theirs') {
    adopt(latest);
    setDirty(fileId, false);
    saveConflict.set(null);
    return;
  }
  const mine = scripts.get().find((s) => s.fileId === fileId) ?? editorScript.get();
  setBase(fileId, latest);
  saveConflict.set(null);
  if (mine) await syncSaveNow(mine, { checkpoint: true });
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
  bases.delete(fileId);
  writeStored(BASES_STORAGE_KEY, Object.fromEntries(bases));
  setDirty(fileId, false);
}

// Self-initialize: for returning users (token already in localStorage), pull
// once after the module graph has finished evaluating. Deferred via microtask
// so core's signals are fully defined before we touch them.
queueMicrotask(() => { if (authed()) void pullUserScripts(); });
