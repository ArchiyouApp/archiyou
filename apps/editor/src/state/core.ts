/**
 * state/core.ts — the core workspace state.
 *
 * Everything every page/component needs: the user, the active script, all
 * latest scripts, and execution status (executing + result). Param definitions
 * and presets live ON the active `Script` (canonical model); the editor authors
 * them (see editor.ts) and the configurator derives from them.
 *
 * Scripts are constructed exclusively via `Script.fromData()`. The active
 * script (`editorScript`) is also represented in the `scripts` collection
 * with the **same JS instance** (matched by `fileId`) — so in-place edits to
 * the active script automatically show up in the list without copying.
 */

import { signal, computed } from '@lit-labs/signals';

import { Script } from '@archiyou/core/src/Script';
import type { RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import type { ModelMode } from '@archiyou/core/src/modeler/types';
import { uuid4 } from '@archiyou/core/src/utils';

import { EDITOR_START_SCRIPT } from '../settings';
import type { UserState, WorkspaceCoreState } from './types';
import { scenegraph, reconcileScenegraph, setInteractiveShapes, applyManagedParamsAndPresets } from './editor';
import { applyManagedBehaviours, evaluateParamBehaviours } from './param-behaviours';
import { currentUser } from '../services/auth-service.js';
import { syncCreate, syncSaveActive, syncDelete } from '../services/scripts-sync.js';

//// LOCAL STORAGE ////

const SCRIPT_STORAGE_KEY  = 'archiyou:editor:script';
const SCRIPTS_STORAGE_KEY = 'archiyou:editor:scripts';

/** The canonical data payload for a fresh editor script. */
function _freshScriptData(): Record<string, any>
{
  return EDITOR_START_SCRIPT;
}

/** Build a fresh Script via the sanctioned factory; fall back to a
 *  minimal `{ code }` payload if param validation fails so the editor
 *  never boots with a null active script. */
function _freshScript(): Script
{
  const script = Script.fromData(_freshScriptData());
  if (script) return script;

  console.warn('core.ts: fresh script failed to validate with default params; falling back to code-only payload');
  const fallback = Script.fromData({ name: EDITOR_START_SCRIPT.name, code: EDITOR_START_SCRIPT.code });
  if (!fallback) throw new Error('core.ts: _freshScript() — even the code-only fallback failed to validate.');
  return fallback;
}

/** Whether the active script at startup came from localStorage (a returning
 *  browser) vs. the built-in starter (a fresh one). Snapshotted once at
 *  module load — used to explain deep-link failures to the user (see
 *  `wasActiveScriptRestored`). */
let _restoredFromStorage = false;

/** Load the persisted active script from localStorage (handles legacy shapes). */
function _loadPersistedScript(): Script
{
  try
  {
    const raw = localStorage.getItem(SCRIPT_STORAGE_KEY);
    if (!raw) return _freshScript();
    _restoredFromStorage = true;

    const data = JSON.parse(raw);

    // Legacy: plain code string
    if (typeof data === 'string')
    {
      const s = Script.fromData({ name: EDITOR_START_SCRIPT.name, code: data });
      return s ?? _freshScript();
    }

    // Legacy: { code, params: [...] } — old flat params are incompatible, drop them
    if (Array.isArray(data.params))
    {
      const s = Script.fromData({
        name: EDITOR_START_SCRIPT.name,
        code: data.code ?? EDITOR_START_SCRIPT.code,
      });
      return s ?? _freshScript();
    }

    // Canonical ScriptData
    const loaded = Script.fromData(data);
    return (loaded instanceof Script) ? loaded : _freshScript();
  }
  catch { return _freshScript(); }
}

/** Load the persisted scripts collection (best-effort: skips invalid entries). */
function _loadPersistedScripts(): Script[]
{
  try
  {
    const raw = localStorage.getItem(SCRIPTS_STORAGE_KEY);
    if (!raw) return [];

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    const out: Script[] = [];
    for (const entry of data)
    {
      const s = Script.fromData(entry);
      if (s) out.push(s);
    }
    return out;
  }
  catch { return []; }
}

/** Persist the active script. Cheap — runs on every keystroke. */
export function saveActive(): void
{
  try
  {
    const script = editorScript.get();
    if (!script) return;
    localStorage.setItem(SCRIPT_STORAGE_KEY, JSON.stringify(script.toData()));
    // Never mirror a foreign (read-only) script back to our own account.
    if (_scriptIsForeign(script)) return;
    // Mirror to the server (debounced + no-op when anonymous).
    syncSaveActive(script);
  }
  catch { /* storage unavailable – silently ignore */ }
}

/** Persist the scripts collection. Only call on lifecycle events
 *  (archive / open / delete) to avoid serialising the whole library
 *  on every keystroke. */
export function saveCollection(): void
{
  try
  {
    const list = scripts.get();
    localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify(list.map(s => s.toData())));
  }
  catch { /* storage unavailable – silently ignore */ }
}

/** Persist active + collection. */
export function saveCore(): void
{
  saveActive();
  saveCollection();
}

//// SIGNALS ////

/** User state, derived from the auth service's `currentUser` signal so the
 *  whole app reacts to sign-in/out through one source of truth. */
export const userState = computed<UserState>(() => {
  const u = currentUser.get();
  return u
    ? { anonymous: false, id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, isAdmin: u.isAdmin === true }
    : { anonymous: true, id: null, email: null, name: null, avatarUrl: null, isAdmin: false };
});

// Hydration: load collection first, then active, then ensure the active
// script is represented in the collection (upsert by fileId in memory) so
// the on-disk collection's possibly-stale twin gets corrected on next save.
const _initialScripts = _loadPersistedScripts();
const _initialActive  = _loadPersistedScript();

/** True when this browser already had a saved script (the editor is showing
 *  it — deep-link failures leave it untouched). False on a fresh browser,
 *  where the editor is instead showing the built-in starter script. */
export const wasActiveScriptRestored = _restoredFromStorage;
{
  // Keep the "active is represented in the collection" invariant — but not for a
  // foreign (read-only) script restored as active, which must stay out of "My
  // Scripts".
  const idx = _initialScripts.findIndex(s => s.fileId === _initialActive.fileId);
  if (idx >= 0) _initialScripts[idx] = _initialActive;
  else if (!_scriptIsForeign(_initialActive)) _initialScripts.push(_initialActive);
}

// `equals: () => false` — every `.set()` notifies, even when the script
// reference hasn't changed. We mutate the active Script in place (code,
// metadata, params…) and call `editorScript.set(script)` to broadcast;
// without this, the polyfill's default `Object.is` check would suppress
// the notification and watchers would never see the new content.
export const editorScript     = signal<Script | null>(_initialActive, { equals: () => false });
export const scripts          = signal<Script[]>(_initialScripts);
export const executing        = signal<boolean>(false);
export const executionResult  = signal<RunnerScriptExecutionResult | null>(null);

/** Per-statement execution mode: run the script statement-by-statement so a single
 *  failure halts with a partial model instead of losing the whole run, and each
 *  statement is timed (see the Profiling tool). Toggled in the Run options menu.
 *  Session-only, like `executing`/`executionResult`. */
export const perStatement     = signal<boolean>(true);

/** Automatic execute: re-run the script automatically a short delay after code
 *  changes (and on load / unit flip). When off, the user runs manually via the
 *  Run button. Toggled in the Run options menu. Session-only. */
export const autoRun          = signal<boolean>(true);

/** Geometry kernel for the next run: the fast, robust mesh kernel (meshup/csgrs) or the
 *  accurate BREP kernel (OpenCascade). Toggled in the Run options menu, applied per whole
 *  run — a script cannot switch mid-way.
 *
 *  Session-only, deliberately: this is a testing/comparison switch, not a property of the
 *  script (unlike units, which live on the Script). Note the brep kernel loads a ~10MB WASM
 *  on first use, so the first brep run is slower. */
export const kernel           = signal<ModelMode>('mesh');

/** Combined view — use when you need the full core shape. */
export const core = computed<WorkspaceCoreState>(() => ({
  user:      userState.get(),
  script:    editorScript.get(),
  scripts:   scripts.get(),
  executing: executing.get(),
  result:    executionResult.get(),
}));

/** The currently active script. */
export const selectedScript = computed(() => editorScript.get());

//// EDITOR MODE (read / edit) ////

/** True when `s` belongs to someone else — a shared script opened from the
 *  library. Such scripts are read-only: they must be forked before editing and
 *  are never mirrored back to the signed-in user's account. Before auth
 *  resolves (`me` still null) a script that carries both an author and shared
 *  metadata is treated as foreign so we never leak edits upstream. */
function _scriptIsForeign(s: Script | null): boolean
{
  if (!s) return false;
  const me = currentUser.get()?.id ?? null;
  if (s.author && me && s.author !== me) return true;
  if (s.author && !me && !!s.shared) return true;
  return false;
}

/** 'read' for a foreign shared script, 'edit' otherwise. Reactive: recomputes
 *  when the active script or the signed-in user changes. */
export const editorMode = computed<'read' | 'edit'>(() =>
  _scriptIsForeign(editorScript.get()) ? 'read' : 'edit',
);

/** Convenience flag for components/guards. */
export const isReadOnly = computed<boolean>(() => editorMode.get() === 'read');

//// MUTATIONS ////

/** Trigger reactivity after mutating the active script in place. */
export function bumpScript(): void
{
  editorScript.set(editorScript.get());
}

/** Trigger reactivity after mutating the scripts array in place. */
export function bumpScripts(): void
{
  scripts.set([...scripts.get()]);
}

/** Upsert a script into the collection by fileId (mutates the array). */
function _upsertScript(s: Script): void
{
  const list = scripts.get();
  const idx = list.findIndex(x => x.fileId === s.fileId);
  if (idx >= 0) list[idx] = s;
  else          list.push(s);
}

/** Archive the given script into the collection (no-op for null). Foreign
 *  (read-only) scripts are never archived — they must not appear in "My
 *  Scripts" nor be synced to the user's account. */
function _archiveScript(s: Script | null): void
{
  if (!s) return;
  if (_scriptIsForeign(s)) return;
  _upsertScript(s);
  bumpScripts();
}

/** Archive current active, create a fresh default script, set as active. */
export function createNewScript(): Script
{
  _archiveScript(editorScript.get());

  const fresh = _freshScript();
  _upsertScript(fresh);   // also represent the new active in the collection
  editorScript.set(fresh);
  bumpScripts();
  saveActive();
  saveCollection();
  syncCreate(fresh);
  return fresh;
}

function _normalizeImportedScriptName(name?: string): string | undefined
{
  const base = name?.trim().toLowerCase();
  return base ? base : undefined;
}

function _uniqueImportedScriptName(name?: string): string | undefined
{
  const normalized = _normalizeImportedScriptName(name);
  if (!normalized) return undefined;
  if (!isScriptNameTaken(normalized)) return normalized;

  const importBase = normalized.endsWith('-imported')
    ? normalized
    : `${normalized}-imported`;

  if (!isScriptNameTaken(importBase)) return importBase;

  let index = 2;
  while (isScriptNameTaken(`${importBase}-${index}`))
  {
    index++;
  }
  return `${importBase}-${index}`;
}

/** Import ScriptData-like payload as a new local editor script.
 *  The imported script always gets fresh local ids so it never overwrites an
 *  existing script by identity. Returns the opened Script or null if invalid. */
export function importScriptFromData(data: Record<string, any>): Script | null
{
  const validated = Script.fromData(data);
  if (!validated) return null;

  const importedData = validated.toData() as Record<string, any>;
  const importedName = _uniqueImportedScriptName(importedData.name);

  const localScript = Script.fromData({
    ...importedData,
    id: uuid4(),
    fileId: uuid4(),
    name: importedName,
  });

  if (!localScript) return null;

  _archiveScript(editorScript.get());
  _upsertScript(localScript);
  editorScript.set(localScript);
  bumpScripts();
  saveActive();
  saveCollection();
  syncCreate(localScript);

  return localScript;
}

/** Open a script from the collection by fileId.
 *  Archives the current active first; the opened script stays in the list. */
export function openScript(fileId: string): Script | null
{
  const list = scripts.get();
  const target = list.find(s => s.fileId === fileId);
  if (!target) return null;

  _archiveScript(editorScript.get());   // ensure current is in the list
  editorScript.set(target);
  saveActive();
  saveCollection();
  return target;
}

/** Open a shared script fetched from the library as the active script. If it
 *  belongs to another user it opens read-only (see editorMode); it is not added
 *  to "My Scripts" and never synced. Returns the opened Script or null. */
export function openSharedScript(data: Record<string, any>): Script | null
{
  const script = Script.fromData(data);
  if (!script) return null;

  _archiveScript(editorScript.get());   // ensure current (if editable) is in the list
  editorScript.set(script);
  saveActive();                         // local persistence only — sync is skipped for foreign
  return script;
}

/** Fork the active script into a new, editable script owned by the current user.
 *  Copies the code/params/metadata under a fresh fileId+id, clears sharing/
 *  publishing/version, and selects it. The name is kept as-is (uniqueness is by
 *  author namespace). Returns the forked Script or null. */
export function forkScript(): Script | null
{
  const source = editorScript.get();
  if (!source) return null;

  const data = source.toData() as Record<string, any>;
  const me = currentUser.get()?.id;

  const fork = Script.fromData({
    ...data,
    id:        uuid4(),
    fileId:    uuid4(),
    author:    me,           // owned by the forking user (undefined when anonymous)
    version:   null,         // a fork starts unversioned
    shared:    null,         // not shared
    published: null,         // not published
    created:   null,
    updated:   null,
  });
  if (!fork) return null;

  _archiveScript(source);    // no-op if the source was foreign/read-only
  _upsertScript(fork);
  editorScript.set(fork);
  bumpScripts();
  saveActive();
  saveCollection();
  syncCreate(fork);
  return fork;
}

/** Remove a script from the collection by fileId. If it was the active one,
 *  fall back to the next entry or a fresh script. */
export function deleteScriptById(fileId: string): void
{
  const list = scripts.get();
  const filtered = list.filter(s => s.fileId !== fileId);
  scripts.set(filtered);

  const active = editorScript.get();
  if (active && active.fileId === fileId)
  {
    if (filtered.length > 0)
    {
      editorScript.set(filtered[filtered.length - 1]);
    }
    else
    {
      const fresh = _freshScript();
      _upsertScript(fresh);
      editorScript.set(fresh);
      bumpScripts();
    }
    saveActive();
  }

  saveCollection();
  syncDelete(fileId);
}

/** Create a new empty script and select it. Returns the new script.
 *  Kept as a thin alias for backwards compatibility. */
export function createScript(_name?: string): Script
{
  return createNewScript();
}

/** Replace the active script. */
export function setScript(script: Script | null): void
{
  editorScript.set(script);
  saveActive();
}

/** Update the code of the active script and persist it. */
export function updateScriptCode(code: string): void
{
  const script = editorScript.get();
  if (!script) return;
  script.code = code;
  script.updated = new Date();
  saveActive();
  editorScript.set(script);
}

/** Update the name of the active script. */
export function updateScriptName(name: string): void
{
  const script = editorScript.get();
  if (!script) return;
  script.name = name.toLowerCase();
  saveActive();
  editorScript.set(script);
}

/** Persist editor metadata onto the active Script (canonical model) and save. */
export function updateScriptMeta(
  meta: { description?: string; details?: string; tags?: string[] },
): void
{
  const script = editorScript.get();
  if (!script) return;
  if (meta.description !== undefined) script.description = meta.description;
  if (meta.details !== undefined)     script.details     = meta.details;
  if (meta.tags !== undefined)        script.tags        = [...meta.tags];
  script.updated = new Date();
  saveActive();
  editorScript.set(script);
}

/** Store the result of the latest execution. Also reconciles the app-owned
 *  scenegraph against the new one from `result.state` so user-toggled
 *  visibility on still-existing paths survives the re-run. We update the
 *  scenegraph synchronously **before** notifying executionResult watchers
 *  (the model-viewer) so its GLB load sees an up-to-date tree. */
export function setExecutionResult(result: RunnerScriptExecutionResult): void
{
  const next = reconcileScenegraph(scenegraph.get(), result.state?.scenegraph ?? null);
  scenegraph.set(next);
  setInteractiveShapes(result.state?.interactiveShapes ?? []);
  // Merge any params/presets the script declared at runtime ($PARAMS.define/preset)
  // into the active script so the param menu reflects them. Diff-gated + deterministic
  // so it cannot trigger a re-run loop. (Code is the source of truth.)
  applyManagedParamsAndPresets(result.state?.managedParams, result.state?.managedPresets);
  // Apply + evaluate dynamic param behaviours (enableIf/visibleIf/...) declared this run.
  // Separate from managedParams: behaviours never change a param's definition. Behaviours
  // are not persisted, so evaluation here only refreshes the UI (no save).
  const activeScript = editorScript.get();
  if (activeScript)
  {
    // `trusted` gates a main-thread `new Function` on the script's behaviour
    // source: only ever do that for a script the signed-in user owns, never for a
    // foreign one (published configurator / someone else's shared script).
    applyManagedBehaviours(
      activeScript,
      result.state?.managedBehaviours,
      !_scriptIsForeign(activeScript),
    );
    if (evaluateParamBehaviours(activeScript)) bumpScript();
  }
  executionResult.set(result);
}

export function setExecuting(value: boolean): void
{
  executing.set(value);
}

/** Set the list of all latest scripts. */
export function setScripts(list: Script[]): void
{
  scripts.set(list);
  saveCollection();
}

/** Returns true if another script in the collection already uses this name.
 *  Comparison is case-insensitive. Pass the current script's `fileId` to
 *  `ignoreFileId` so renaming a script to its own name does not collide. */
export function isScriptNameTaken(name: string, ignoreFileId?: string): boolean
{
  const target = (name ?? '').trim().toLowerCase();
  if (!target) return false;
  return scripts.get().some(s =>
    s.fileId !== ignoreFileId && (s.name ?? '').toLowerCase() === target,
  );
}
