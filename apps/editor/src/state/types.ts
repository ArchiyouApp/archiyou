/**
 * state/types.ts — shared types for the workspace state modules.
 *
 * The canonical `ScriptParam` lives in @archiyou/core; it is re-exported
 * here so the app has a single import site. The old local flat `ScriptParam`
 * interface is gone — params are JSON-Schema driven (`schema.minimum`,
 * `schema.maximum`, `schema.multipleOf`, `schema.enum`, `schema.items.type`,
 * `default`, `_value`).
 */

import type { Script } from '@archiyou/core/src/Script';
import type { RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';

// ── Canonical param re-exports ────────────────────────────────────────────────

export { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
export type { ScriptParamType, ScriptParamData } from '@archiyou/core/src/execution/types';

import type { ScriptParam as ScriptParamClass } from '@archiyou/core/src/execution/ScriptParam';
import { ParamManager } from '@archiyou/core/src/execution/ParamManager';

/**
 * Schema-field accessors — the canonical param is JSON-Schema driven, so the
 * old flat fields now live under `param.schema`. These keep the param widgets
 * readable (`paramMin(p)` instead of `(p.schema as any).minimum`).
 */
const _s = (p: ScriptParamClass): Record<string, any> => p.schema as any;

export const paramMin          = (p: ScriptParamClass): number => _s(p).minimum ?? 0;
export const paramMax          = (p: ScriptParamClass): number => _s(p).maximum ?? 100;
export const paramStep         = (p: ScriptParamClass): number => _s(p).multipleOf ?? 1;
export const paramMinLength    = (p: ScriptParamClass): number => _s(p).minLength ?? 0;
export const paramMaxLength    = (p: ScriptParamClass): number | undefined => _s(p).maxLength;
export const paramOptions      = (p: ScriptParamClass): (string | number)[] => _s(p).enum ?? [];
export const paramListItemType = (p: ScriptParamClass): 'string' | 'number' | 'boolean' =>
  _s(p).items?.type ?? 'string';
/** JSON Schema of one item of a `list` param. */
export const paramItemSchema   = (p: ScriptParamClass): Record<string, any> => _s(p).items ?? {};
/** Properties of an `object` param, or of one entry of an object list. */
export const paramProperties   = (schema: Record<string, any>): Record<string, any> =>
  schema?.properties ?? {};
/** A `list` whose items are structured objects. Declared from script code only
 *  ($PARAMS.defineObject) and rendered as an editable list of entries rather
 *  than the plain value chips of param-item-list. */
export const isObjectListParam = (p: ScriptParamClass): boolean =>
  p.type === 'list' && paramItemSchema(p).type === 'object';

/** Re-exported from core so the label rule and the "blank entry" defaults have a
 *  single implementation shared by the script side and both menus. */
export const objectEntryLabel = ParamManager.objectEntryLabel;
export const objectDefaults   = ParamManager.objectDefaults;
/** Effective current value: runtime `_value`, falling back to `default`. */
export const paramValue        = (p: ScriptParamClass): any => p._value ?? p.default;
/** Whether the param's control is interactive. Default true; a dynamic behaviour
 *  (enableIf) can set `enabled = false`. */
export const paramEnabled      = (p: ScriptParamClass): boolean => p.enabled !== false;
/** Whether the param row is shown. Default true; a dynamic behaviour (visibleIf)
 *  can set `visible = false`. */
export const paramVisible      = (p: ScriptParamClass): boolean => p.visible !== false;
/** True when this param's definition is owned by the script (declared via
 *  $PARAMS.define()). Such params have an editable value but a locked
 *  definition in the UI. */
export const isProgrammatic    = (p: ScriptParamClass): boolean => !!p._definedProgrammatically;

// ── Core ──────────────────────────────────────────────────────────────────────

export interface UserState
{
  anonymous: boolean;
  id: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** Operator account: shows the Admin entry and lets /admin render. Presentation
   *  only — every admin route re-reads the flag from the database, so nothing here
   *  is load-bearing for access. */
  isAdmin: boolean;
}

/**
 * The core workspace state shared by every page/component:
 * the user, the active script, all latest scripts, and execution status.
 */
export interface WorkspaceCoreState
{
  user: UserState;
  script: Script | null;        // active script (latest; no versions yet)
  scripts: Script[];            // all latest scripts
  executing: boolean;           // whether a script is currently executing
  result: RunnerScriptExecutionResult | null;
}

// ── Editor: script metadata ───────────────────────────────────────────────────

export interface ScriptMetadata
{
  projectName: string;
  version: string;
  /** Short introductory description (markdown). */
  description: string;
  /** Full documentation / technical details (markdown). */
  projectDetails: string;
  categories: string[];
}

// ── Params ────────────────────────────────────────────────────────────────────

/** Detail payload for the 'param-value-change' custom event. */
export interface ParamValueChangeDetail
{
  name:     string;
  value?:   any;
  units?:   string;
  options?: string[];
}

/** Points at ONE entry of an object-list param — the row the param menu has expanded,
 *  and the thing a bound viewer handle stands for.
 *
 *  Index, not id: object-list entries carry no stable identity (the menu keys them by
 *  index too). A delete shifts what a pending ref points at; the next execution re-syncs
 *  the handles, so the two ends drift together rather than apart. */
export interface ParamEntryRef
{
  param: string;
  index: number;
}

// ── Presets ───────────────────────────────────────────────────────────────────

export interface ScriptPreset
{
  name: string;
  values: Record<string, any>; // param name → value
}
