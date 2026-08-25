/**
 * state/configurator.ts — configurator-only state.
 *
 * The configurator does NOT author params. It *derives* the param definitions
 * from the core active `Script` and keeps only the end-user's runtime values
 * and its own UI state here.
 */

import { signal, computed } from '@lit-labs/signals';

import { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import type { ScriptParamData } from '@archiyou/core/src/execution/types';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import type { ConsoleMessageType } from '@archiyou/core/src/console/types';

import { editorScript } from './core';
import { configuratorUnitSystem } from './units';
import type { ScriptPreset } from './types';

//// DERIVED DEFINITIONS (read-only, from core script) ////

/** Param definitions to configure, taken from the core active script. */
export const configuratorParams = computed<ScriptParam[]>(() =>
{
  const s = editorScript.get();
  if (!s) return [];
  return Object.values(s.params).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

/** Presets available, derived from the core script. */
export const configuratorPresets = computed<ScriptPreset[]>(() =>
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

//// RUNTIME VALUES + UI STATE ////

/** End-user values, keyed by param name. Falls back to the param default. */
export const configuratorValues   = signal<Record<string, any>>({});
export const configuratorExecuting = signal<boolean>(false);

/** Collapse state of the configurator's own Presets/Parameters sections. Kept
 *  separate from the editor's `presetMenuCollapsed`/`paramMenuCollapsed` so the
 *  Configurator Preview never rearranges the editor's left panel behind it. */
export const configuratorPresetMenuCollapsed = signal<boolean>(false);
export const configuratorParamMenuCollapsed  = signal<boolean>(false);

export function setConfiguratorPresetMenuCollapsed(collapsed: boolean): void
{
  configuratorPresetMenuCollapsed.set(collapsed);
}

export function setConfiguratorParamMenuCollapsed(collapsed: boolean): void
{
  configuratorParamMenuCollapsed.set(collapsed);
}

/** Resolve the effective value for a param (runtime override → default). */
export function configuratorValueFor(p: ScriptParam): any
{
  const v = configuratorValues.get();
  return (p.name in v) ? v[p.name] : (p._value ?? p.default);
}

export function setConfiguratorValue(name: string, value: any): void
{
  configuratorValues.set({ ...configuratorValues.get(), [name]: value });
}

export function resetConfiguratorValues(): void
{
  configuratorValues.set({});
}

export function setConfiguratorExecuting(value: boolean): void
{
  configuratorExecuting.set(value);
}

//// EXECUTION REQUEST ////

/**
 * The execution request the configurator runs: the active script, the end-user's
 * param values and their local unit system, for the given output paths.
 *
 * Shared by the live run behind the viewer and by fulfillment downloads (see
 * services/fulfillment.ts) on purpose — a downloaded file must come from exactly
 * the configuration on screen, and two separately-assembled requests drift.
 */
export function buildConfiguratorRequest(
  outputs: string[],
  messages: Array<ConsoleMessageType> = ['error'],
): RunnerScriptExecutionRequest
{
  // Definitions come from the core active script (already canonical via toData());
  // values are the configurator's runtime overrides.
  const scriptData = editorScript.get()?.toData() as any;
  const params = configuratorParams.get();

  const paramValues: Record<string, any> = Object.fromEntries(
    params.map(p => [p.name, configuratorValueFor(p)]),
  );

  return {
    outputs,
    messages,
    script: scriptData,
    params: paramValues,
    // display = the end-user's local choice (geometry stays in the model unit)
    unitSystem: configuratorUnitSystem.get(),
  } as RunnerScriptExecutionRequest;
}

/** Apply a preset's values into the configurator runtime values (by param name). */
export function applyConfiguratorPreset(name: string): void
{
  const s = editorScript.get();
  if (!s) return;
  const preset = s.presets[name];
  if (!preset) return;

  const byName = Object.fromEntries(Object.values(s.params).map(p => [p.name, p]));
  const next = { ...configuratorValues.get() };
  for (const [pname, pdata] of Object.entries(preset))
  {
    const target = byName[pname];
    if (target) next[target.name] = (pdata as ScriptParamData)._value ?? (pdata as ScriptParamData).default;
  }
  configuratorValues.set(next);
}
