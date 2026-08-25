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

// ── Presets ───────────────────────────────────────────────────────────────────

export interface ScriptPreset
{
  name: string;
  values: Record<string, any>; // param name → value
}
