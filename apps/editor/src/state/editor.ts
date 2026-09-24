/**
 * state/editor.ts — editor-only state.
 *
 * UI state for the editor (scene tree, hidden nodes, bottom panel,
 * file-info, script metadata, param/preset menu collapse) PLUS the param +
 * preset *authoring* API. Param definitions live on the core active `Script`
 * (`script.params` / `script.presets`, canonical model). Mutators translate the
 * param-menu's flat spec into canonical `ScriptParam` (schema-driven) and bump
 * the core script signal so `SignalWatcher` components re-render.
 */

import { signal, computed } from '@lit-labs/signals';

import { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import { ParamManager } from '@archiyou/core/src/execution/ParamManager';
import type { ScriptParamType, ScriptParamData, ParamOperation, ScriptStatementResult,
              ManagedValuesData } from '@archiyou/core/src/execution/types';
import type { SceneNodeData } from '@archiyou/core/src/modeler/types';
import { deepEqual } from '@archiyou/core/src/utils';

import { editorScript, bumpScript, saveCore, executionResult } from './core';
import { evaluateParamBehaviours } from './param-behaviours';
import { scheduleExecution } from './viewer';
import type { ParamEntryRef, ScriptMetadata, ScriptPreset } from './types';

//// EDITOR UI SIGNALS ////

/** App-owned, mutable copy of the runner's scenegraph. Identity by path
 *  (root joined down with `/`). User visibility toggles mutate this tree;
 *  on every new execution we reconcile against this snapshot so toggled
 *  nodes that still exist by path keep their visibility. `equals: () => false`
 *  so in-place node mutations broadcast to watchers. */
export const scenegraph        = signal<SceneNodeData | null>(null, { equals: () => false });

/** Currently selected scene path (single-select), or null. Set by clicking a
 *  shape in the 3D viewer or a row in the scene explorer; identity is the
 *  scenegraph path (same scheme as visibility overrides). Drives the viewer
 *  selection highlight and the scene-explorer active row, and is threaded into
 *  the next execution request so shape.onClick()/shape.selected() can react. */
export const selectedPath = signal<string | null>(null);
export function setSelectedPath(path: string | null): void { selectedPath.set(path); }

/** The statement that made the selected shape, which the code editor highlights. Resolved
 *  through serial ids: a per-statement run records the range each statement added to the
 *  scene (sidFirst/sidLast), and every scenegraph node carries its shape's sid. A layer
 *  resolves when all the shapes under it came from one statement, such as a $component()
 *  call. Null without a selection, outside per-statement mode, or when nothing matches. */
export const selectedStatement = computed<ScriptStatementResult | null>(() =>
{
  const path = selectedPath.get();
  const root = scenegraph.get();
  const statements = executionResult.get()?.statements;
  if (!path || !root || !statements?.length) return null;

  const node = findNodeByPath(root, path);
  const span = node ? _sidSpan(node) : null;
  if (!span) return null;
  const [first, last] = span;
  return statements.find(s => s.sidFirst !== undefined && s.sidLast !== undefined
    && s.sidFirst <= first && last <= s.sidLast) ?? null;
});

/** Scene paths of shapes that declared onClick() in the last run (from
 *  result.state.interactiveShapes). The viewer only triggers a re-run when a
 *  clicked shape's path is in this set; other clicks just highlight/select. */
export const interactiveShapes = signal<string[]>([]);
export function setInteractiveShapes(paths: string[]): void { interactiveShapes.set(paths); }

export const activeBottomPanel = signal<'console' | 'scene' | 'none'>('console');
export const fileManagerCollapsed = signal<boolean>(true);
export const paramMenuCollapsed   = signal<boolean>(false);
export const presetMenuCollapsed  = signal<boolean>(true);

/** The object-list entry currently expanded in the param menu, or null.
 *
 *  Written by param-item-object-list when a row is toggled, and by the viewer when a
 *  handle bound with $handle().param('OPENINGS[i]') is clicked; read back by that menu.
 *  One signal rather than two states, so a click in the 3D view and a click in the menu
 *  are literally the same act — which is the whole point of the feature. */
export const activeParamEntry = signal<ParamEntryRef | null>(null);

export function setActiveParamEntry(ref: ParamEntryRef | null): void
{
  activeParamEntry.set(ref);
  // Activating a row the user cannot see is not activation. The configurator has its own
  // collapse flag in state/configurator.ts; configurator-params reacts to this signal for
  // it, rather than importing it here and closing an import cycle.
  if (ref) paramMenuCollapsed.set(false);
}

export const scriptMetadata = signal<ScriptMetadata>({
  projectName: '',
  version: '',
  description: '',
  projectDetails: '',
  categories: [],
});

function _encodeScenegraphSegment(name: string): string
{
  return encodeURIComponent(name);
}

function _decodeScenegraphSegment(name: string): string
{
  return decodeURIComponent(name);
}

export function buildScenegraphPath(parentPath: string, name: string): string
{
  const segment = _encodeScenegraphSegment(name);
  return parentPath ? `${parentPath}/${segment}` : segment;
}

//// EDITOR UI MUTATORS ////

/** User-applied visibility overrides, keyed by scenegraph path. Only written
 *  by toggleNodeVisibility (user clicks in the scene explorer). Read by
 *  reconcileScenegraph to override script-written `style.visible` on every
 *  re-run. Persists for the lifetime of the page so the user's choice sticks
 *  across parameter tweaks. */
const _userVisibilityOverrides = new Map<string, boolean>();

/** Toggle visibility for the scenegraph node at `path` (slash-separated names
 *  from the root). Mutates the tree in place then notifies. Records the new
 *  value in `_userVisibilityOverrides` so it survives subsequent script runs
 *  (the script's `Shape.hide()`/`Shape.show()` no longer wins over a user
 *  toggle until the user toggles again). */
export function toggleNodeVisibility(path: string): void
{
  const root = scenegraph.get();
  if (!root) return;
  const node = findNodeByPath(root, path);
  if (!node) return;

  const currentVisible = node.style.visible !== false;
  _userVisibilityOverrides.set(path, !currentVisible);

  const next = _toggleNodeVisibilityByPath(root, path);
  if (!next) return;
  scenegraph.set(next);
}

/** Drop all user visibility overrides. Call when loading a new script so the
 *  next execution shows the script's intended visibility from scratch. */
export function clearUserVisibilityOverrides(): void
{
  _userVisibilityOverrides.clear();
}

/** Walk a scenegraph by `/`-joined path. Empty path returns the root. */
export function findNodeByPath(
  root: SceneNodeData,
  path: string,
): SceneNodeData | null
{
  if (!path) return root;
  const parts = path.split('/').map(_decodeScenegraphSegment);
  if (parts[0] !== root.name) return null;
  let cur: SceneNodeData = root;
  for (let i = 1; i < parts.length; i++)
  {
    const next = cur.children.find(c => c.name === parts[i]);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Lowest and highest shape serial id at or below `node`, or null when it holds no shapes.
 *  A shape node answers its own sid. */
function _sidSpan(node: SceneNodeData): [number, number] | null
{
  if (node.sid) return [node.sid, node.sid];
  return node.children.reduce<[number, number] | null>((span, child) =>
  {
    const c = _sidSpan(child);
    if (!c) return span;
    return span ? [Math.min(span[0], c[0]), Math.max(span[1], c[1])] : c;
  }, null);
}

/** Deep-clone a SceneNodeData tree (plain structured data, safe). */
function _cloneNode(n: SceneNodeData): SceneNodeData
{
  return {
    name: n.name,
    shape: n.shape ?? null,
    sid: n.sid, // links the node to the statement that made it (selectedStatement)
    style: { ...n.style },
    children: n.children.map(_cloneNode),
  };
}

/** Return a new tree with the node at `path` toggled, or `null` if not found. */
function _toggleNodeVisibilityByPath(
  root: SceneNodeData,
  path: string,
): SceneNodeData | null
{
  if (!path) return null;

  const parts = path.split('/').map(_decodeScenegraphSegment);
  if (parts[0] !== root.name) return null;

  const toggle = (node: SceneNodeData, partIndex: number): SceneNodeData | null =>
  {
    if (partIndex === parts.length - 1)
    {
      const current = node.style.visible !== false;
      return {
        ...node,
        style: { ...node.style, visible: !current },
        children: node.children.map(_cloneNode),
      };
    }

    const childName = parts[partIndex + 1];
    const childIndex = node.children.findIndex(c => c.name === childName);
    if (childIndex === -1) return null;

    const toggledChild = toggle(node.children[childIndex], partIndex + 1);
    if (!toggledChild) return null;

    const nextChildren = node.children.map((child, index) =>
      index === childIndex ? toggledChild : _cloneNode(child),
    );

    return {
      ...node,
      style: { ...node.style },
      children: nextChildren,
    };
  };

  return toggle(root, 0);
}

/** Reconcile an incoming scenegraph against accumulated user visibility
 *  overrides. The script's `Shape.hide()`/`Shape.show()` writes `style.visible`
 *  on `incoming`; we let those values through *unless* the user has explicitly
 *  toggled the node in the scene explorer — only then does the override win.
 *
 *  Previously this read the override from the *previous* tree's `style.visible`,
 *  but that couldn't distinguish "user toggled it" from "script wrote it last
 *  time," so any script-written visibility from run #1 was treated as a user
 *  preference on run #2, freezing it forever. The override map is mutated only
 *  by `toggleNodeVisibility`, so it's an unambiguous record of user intent.
 *
 *  Stale overrides (paths no longer in `incoming`) are purged here to keep the
 *  map bounded. Pure w.r.t. `incoming`: returns a fresh deep clone. */
export function reconcileScenegraph(
  _prev: SceneNodeData | null,
  incoming: SceneNodeData | null,
): SceneNodeData | null
{
  if (!incoming) return null;
  const clone = _cloneNode(incoming);

  if (_userVisibilityOverrides.size === 0) return clone;

  // Walk the new tree: apply any user override for the path; collect all
  // paths so we can drop stale entries afterwards.
  const seenPaths = new Set<string>();
  const apply = (n: SceneNodeData, parentPath: string) =>
  {
    const p = buildScenegraphPath(parentPath, n.name);
    seenPaths.add(p);
    if (_userVisibilityOverrides.has(p))
    {
      n.style.visible = _userVisibilityOverrides.get(p);
    }
    n.children.forEach(c => apply(c, p));
  };
  apply(clone, '');

  for (const path of _userVisibilityOverrides.keys())
  {
    if (!seenPaths.has(path)) _userVisibilityOverrides.delete(path);
  }
  return clone;
}

/** Drop the scenegraph (called when no model is loaded). Also clears any
 *  user visibility overrides so a new script starts from its own intent. */
export function clearSceneState(): void
{
  scenegraph.set(null);
  clearUserVisibilityOverrides();
}

export function setActiveBottomPanel(panel: 'console' | 'scene' | 'none'): void
{
  activeBottomPanel.set(panel);
}

export function setFileManagerCollapsed(collapsed: boolean): void
{
  fileManagerCollapsed.set(collapsed);
}

export function setParamMenuCollapsed(collapsed: boolean): void
{
  paramMenuCollapsed.set(collapsed);
}

export function setPresetMenuCollapsed(collapsed: boolean): void
{
  presetMenuCollapsed.set(collapsed);
}

export function updateScriptMetadata(_scriptId: string, metadata: ScriptMetadata): void
{
  scriptMetadata.set(metadata);
}

/** Convert a param name to a safe JS variable name (lowercase, underscores). */
export function toVariableName(name: string): string
{
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

//// PARAMS (authored on core.script.params) ////

/**
 * Reactive, ordered view of the active script's params.
 * Replaces the old standalone `scriptParams` signal — same `.get()` API.
 */
export const scriptParams = computed<ScriptParam[]>(() =>
{
  const s = editorScript.get();
  if (!s) return [];
  return Object.values(s.params)
    .map((param, index) => ({ param, index }))
    .sort((a, b) => ((a.param.order ?? 0) - (b.param.order ?? 0)) || (a.index - b.index))
    .map(({ param }) => param);
});

/** Flat spec used by param-menu / param-define-menu (legacy field names). */
export interface ParamSpec
{
  name?: string;
  type?: ScriptParamType;
  group?: string;
  order?: number;
  units?: string;
  defaultValue?: any;
  value?: any;
  // number
  min?: number;
  max?: number;
  step?: number;
  // text
  minLength?: number;
  maxLength?: number;
  // options
  options?: string[];
  // list
  listItemType?: 'string' | 'number' | 'boolean';
}

/** Apply a flat spec onto a canonical ScriptParam (schema-driven). */
function _applySpec(p: ScriptParam, spec: ParamSpec): void
{
  const schema = p.schema as any;

  if (spec.name  !== undefined) p.name  = spec.name.toUpperCase();
  if (spec.group !== undefined) p.group = spec.group;
  if (spec.order !== undefined) p.order = spec.order;
  if (spec.units !== undefined) p.units = spec.units as any;

  if (spec.defaultValue !== undefined)
  {
    p.default      = spec.defaultValue;
    schema.default = spec.defaultValue;
  }
  if (spec.value !== undefined) p._value = spec.value;

  if (spec.min        !== undefined) schema.minimum    = spec.min;
  if (spec.max        !== undefined) schema.maximum    = spec.max;
  if (spec.step       !== undefined) schema.multipleOf = spec.step;
  if (spec.minLength  !== undefined) schema.minLength  = spec.minLength;
  if (spec.maxLength  !== undefined) schema.maxLength  = spec.maxLength;
  if (spec.options    !== undefined) schema.enum       = spec.options;
  if (spec.listItemType !== undefined) schema.items    = { type: spec.listItemType };

  p.iterable = p.isIterable();
}

/** Find a param (and its current key) in the active script by name. */
function _findByName(name: string): { key: string; param: ScriptParam } | null
{
  const s = editorScript.get();
  if (!s) return null;
  const upper = name.toUpperCase();
  for (const [key, param] of Object.entries(s.params))
    if (param.name === upper) return { key, param };
  return null;
}

/** Add a new param to the active script. */
export function addParam(spec: ParamSpec): void
{
  const s = editorScript.get();
  if (!s) return;

  const p = ScriptParam.fromType((spec.type ?? 'number') as ScriptParamType);
  p.name = spec.name ?? p.name;
  p.group = spec.group ?? 'main';
  p.order = spec.order ?? Object.keys(s.params).length;
  _applySpec(p, spec);

  s.params[p.name] = p;
  bumpScript();
  saveCore();
}

/** Update an existing param by name (re-keys the script.params map if renamed). */
export function updateParam(name: string, updates: ParamSpec): void
{
  const found = _findByName(name);
  const s = editorScript.get();
  if (!found || !s) return;

  let { key, param } = found;
  const originalKey = key;

  // type change → rebuild from the new type, preserving identity fields
  if (updates.type && updates.type !== param.type)
  {
    const next = ScriptParam.fromType(updates.type);
    next.name = param.name;
    next.group = param.group;
    next.order = param.order;
    param = next;
  }

  _applySpec(param, updates);

  if (param.name !== originalKey)
  {
    delete s.params[originalKey];
    s.params[param.name] = param;
  }
  else
  {
    s.params[originalKey] = param;
  }
  // A value change can flip dependent params' enabled/visible/options/value via
  // their behaviours — evaluate now so the menu reacts instantly without a re-run.
  evaluateParamBehaviours(s);
  bumpScript();
  saveCore();
}

/** Add a new param directly from a canonical ScriptParamData (schema-driven). */
export function addParamDirect(data: ScriptParamData): void
{
  const s = editorScript.get();
  if (!s) return;

  const p = ScriptParam.fromData(data);
  // Guard against silently overwriting an existing param. Updates must go
  // through updateParamDirect so the original `order` is preserved and the
  // map is re-keyed cleanly on rename. Without this check, a wrong edit-vs-
  // add routing decision in the UI would clobber the order and orphan the
  // old key.
  if (s.params[p.name])
  {
    console.warn(
      `addParamDirect: param "${p.name}" already exists — use updateParamDirect to modify it.`
    );
    return;
  }
  p.order = data.order ?? Object.keys(s.params).length;
  s.params[p.name] = p;
  bumpScript();
  saveCore();
}

/** Update an existing param directly from canonical ScriptParamData.
 *  Re-keys script.params if the name changed. */
export function updateParamDirect(name: string, data: ScriptParamData): void
{
  const found = _findByName(name);
  const s = editorScript.get();
  if (!found || !s) return;

  const { key } = found;
  const p = ScriptParam.fromData(data);
  p.order = found.param.order;

  if (p.name !== key)
  {
    delete s.params[key];
    s.params[p.name] = p;
  }
  else
  {
    s.params[key] = p;
  }
  bumpScript();
  saveCore();
}

export function deleteParam(name: string): void
{
  const found = _findByName(name);
  const s = editorScript.get();
  if (!found || !s) return;
  delete s.params[found.key];
  bumpScript();
  saveCore();
}

//// MANAGED PARAMS / PRESETS (from script $PARAMS.define() / $PARAMS.preset()) ////

/** Merge params/presets a script declared at runtime into the active script.
 *
 *  Code is the source of truth: script-defined params overwrite same-named
 *  params (preserving the user's current value where the new schema still
 *  accepts it) and are flagged `_definedProgrammatically`. `deleted` entries
 *  (params the script previously defined but dropped this run — full sync) are
 *  removed, but only when they are programmatic; UI-authored params are never
 *  auto-removed. Saves are diff-gated: an identical re-run applies nothing, so
 *  the deterministic managed-params stream cannot cause a re-run loop.
 */
export function applyManagedParamsAndPresets(
  managedParams?: Record<ParamOperation, Array<ScriptParamData>>,
  managedPresets?: Record<string, Record<string, ScriptParamData>>,
): void
{
  const s = editorScript.get();
  if (!s) return;
  let changed = false;

  if (managedParams)
  {
    for (const data of [...(managedParams.new ?? []), ...(managedParams.updated ?? [])])
    {
      const upper = (data.name ?? '').toUpperCase();
      if (!upper) continue;
      const existing = s.params[upper];

      const incoming = ScriptParam.fromData({ ...data, name: upper, _definedProgrammatically: true });
      // preserve the user's current value if the new definition still accepts it
      if (existing && existing._value !== undefined && incoming.validateValue(existing._value))
      {
        incoming._value = existing._value;
      }
      incoming.order = existing?.order ?? data.order ?? Object.keys(s.params).length;

      if (!existing || !deepEqual(existing.toData(), incoming.toData()))
      {
        s.params[upper] = incoming;
        changed = true;
      }
    }

    for (const data of (managedParams.deleted ?? []))
    {
      const upper = (data.name ?? '').toUpperCase();
      const existing = s.params[upper];
      if (existing && existing._definedProgrammatically)
      {
        delete s.params[upper];
        changed = true;
      }
    }
  }

  if (managedPresets)
  {
    for (const [name, rec] of Object.entries(managedPresets))
    {
      if (!deepEqual(s.presets[name], rec))
      {
        s.presets[name] = rec;
        changed = true;
      }
    }
  }

  if (changed)
  {
    bumpScript();
    saveCore();
  }
}

/** Re-runs in a row that set() or push() may cause before the editor stops following them */
const MAX_VALUE_RERUNS = 3;
let _valueReruns = 0;
let _valueRerunPending = false;

/** Keep the values the script wrote with $PARAMS.NAME.set()/push() as the params' values,
 *  and re-run when one of them asked for it. Call for every execution result, also one without
 *  managedValues: that is how a run the user started resets the re-run count.
 *
 *  Values only: a param's definition and its `_definedProgrammatically` flag stay as they are,
 *  so a param made in the menu stays editable. Saves only when a value changed. Re-runs on what
 *  the script reported (values that differ from the ones its run started with), also when the
 *  app already had the value through a definition from the same run. A script whose
 *  value never settles (`set($N + 1)`, unseeded randomness) is followed MAX_VALUE_RERUNS times,
 *  then left with a warning. Call after applyManagedParamsAndPresets(): a param defined and set
 *  in the same run has to exist first. */
export function applyManagedValues(managedValues?: ManagedValuesData): void
{
  const fromValueRerun = _valueRerunPending;
  _valueRerunPending = false;
  if (!fromValueRerun) _valueReruns = 0;

  const s = editorScript.get();
  if (!s || !managedValues) return;

  const { changes, rerun } = ParamManager.diffManagedValues(Object.values(s.params), managedValues);
  if (changes.length > 0)
  {
    changes.forEach(({ name, value }) => { s.params[name]._value = value; });
    bumpScript();
    saveCore();
  }

  if (!rerun) return;
  if (_valueReruns >= MAX_VALUE_RERUNS)
  {
    console.warn(`set()/push() keeps changing ${Object.keys(managedValues).join(', ')}: not re-running `
      + `after ${MAX_VALUE_RERUNS} re-runs in a row. Does the value depend on itself?`);
    return;
  }
  _valueReruns++;
  _valueRerunPending = true;
  scheduleExecution();
}

/** Re-order params within a group according to the supplied ordered name list. */
export function reorderParams(_group: string, orderedNames: string[]): void
{
  orderedNames.forEach((name, idx) =>
  {
    const found = _findByName(name);
    if (found) found.param.order = idx;
  });
  bumpScript();
  saveCore();
}

export function renameParamGroup(oldName: string, newName: string): void
{
  const s = editorScript.get();
  if (!s) return;
  for (const p of Object.values(s.params))
    if (p.group === oldName) p.group = newName;
  bumpScript();
  saveCore();
}

/** The param groups in tab order: 'main' first, as in the configurator, then the others where
 *  their first param is (scriptParams is sorted by `order`). */
export const paramGroups = computed<string[]>(() =>
  [...new Set(['main', ...scriptParams.get().map(p => p.group ?? 'main')])]);

/** Move group `source` to the place of group `target` in the tab order. Every param stays in
 *  its own group: the tab order follows the params' `order`, so this renumbers `order` over
 *  all params, group by group in the new order, each keeping its order within the group.
 *  'main' stays the first tab whatever its params' numbers. A script re-run keeps these
 *  numbers (applyManagedParamsAndPresets preserves `order`). */
export function moveParamGroup(source: string, target: string): void
{
  const s = editorScript.get();
  const groups = paramGroups.get();
  const from = groups.indexOf(source);
  const to   = groups.indexOf(target);
  if (!s || from < 0 || to < 0 || from === to) return;

  const ordered = [...groups];
  ordered.splice(from, 1);
  ordered.splice(to, 0, source);

  const params = scriptParams.get();
  ordered
    .flatMap(g => params.filter(p => (p.group ?? 'main') === g))
    .forEach((p, i) => { p.order = i; });
  bumpScript();
  saveCore();
}

//// PRESETS (stored on core.script.presets) ////

/** Reactive view of presets in the legacy `{ name, values }` shape. */
export const scriptPresets = computed<ScriptPreset[]>(() =>
{
  const s = editorScript.get();
  if (!s) return [];
  return Object.entries(s.presets).map(([name, paramRec]) => ({
    name,
    values: Object.fromEntries(
      Object.entries(paramRec).map(([pname, pdata]) =>
        [pname, (pdata as ScriptParamData)._value ?? (pdata as ScriptParamData).default]),
    ),
  }));
});

export function saveAsPreset(name: string): void
{
  const s = editorScript.get();
  if (!s) return;
  s.presets[name] = Object.fromEntries(
    Object.values(s.params).map(p => [p.name, p.toData()]),
  );
  // Reveal the result: the presets menu starts collapsed, so saving one would
  // otherwise look like nothing happened.
  presetMenuCollapsed.set(false);
  bumpScript();
  saveCore();
}

export function deletePreset(name: string): void
{
  const s = editorScript.get();
  if (!s) return;
  delete s.presets[name];
  bumpScript();
  saveCore();
}

export function renamePreset(oldName: string, newName: string): void
{
  const s = editorScript.get();
  if (!s || !(oldName in s.presets)) return;
  s.presets[newName] = s.presets[oldName];
  delete s.presets[oldName];
  bumpScript();
  saveCore();
}

export function activatePreset(name: string): void
{
  const s = editorScript.get();
  if (!s) return;
  const preset = s.presets[name];
  if (!preset) return;
  for (const [pname, pdata] of Object.entries(preset))
  {
    const target = s.params[pname];
    if (target) target._value = (pdata as ScriptParamData)._value ?? (pdata as ScriptParamData).default;
  }
  bumpScript();
  saveCore();
}
