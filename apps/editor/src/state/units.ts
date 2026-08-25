/**
 * state/units.ts — unit-system state.
 *
 * Two distinct systems (see the user model):
 *   - scriptUnitSystem       the SCRIPT's main unit (metric shows mm, imperial
 *                            shows inches). Set in the editor, persisted on the
 *                            Script. Presentation only.
 *   - configuratorUnitSystem the end-user's LOCAL display preference in the
 *                            configurator only. Converts params/readouts for
 *                            display; never persisted.
 *
 * On a real switch the param widgets snap their stored values to nice numbers
 * in the new system (25mm ⇄ 1") — see param-item-number.
 */

import { signal, computed } from '@lit-labs/signals';

import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';
import { baseUnitForSystem } from '@archiyou/core/src/units/UnitConverter';
import type { ModelUnits } from '@archiyou/core/src/modeler/types';

import { editorScript, saveActive } from './core';
import { executionResult } from './core';

export type { UnitSystem };
export { baseUnitForSystem };

/** The default unit system for a script that has none set yet. */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

//// SCRIPT MAIN UNIT (editor, persisted) ////

/** The active script's main unit system. Falls back to metric when the script
 *  has none set yet. Reactive to script switches. */
export const scriptUnitSystem = computed<UnitSystem>(() =>
{
    const s = editorScript.get();
    return (s?.units as UnitSystem) ?? DEFAULT_UNIT_SYSTEM;
});

/** Persist the script's main unit system onto the active Script and save. */
export function setScriptUnitSystem(system: UnitSystem): void
{
    const script = editorScript.get();
    if (!script) return;
    script.units = system;
    script.updated = new Date();
    saveActive();
    editorScript.set(script);
}

/** Ensure the active script has an explicit unit system persisted (default
 *  metric). Call once when a script becomes active. Idempotent. */
export function ensureScriptUnitSystem(): void
{
    const script = editorScript.get();
    if (script && !script.units) { setScriptUnitSystem(DEFAULT_UNIT_SYSTEM); }
}

//// CONFIGURATOR DISPLAY UNIT (local, not persisted) ////

const _configuratorUnitSystem = signal<UnitSystem | null>(null);

/** The configurator's local display system. Defaults to the script's system
 *  until the end-user explicitly picks one. */
export const configuratorUnitSystem = computed<UnitSystem>(() =>
{
    return _configuratorUnitSystem.get() ?? scriptUnitSystem.get();
});

export function setConfiguratorUnitSystem(system: UnitSystem): void
{
    _configuratorUnitSystem.set(system);
}

//// SOURCE MODEL UNIT (from execution) ////

/** The active script's executed model unit (the conversion anchor), fallback
 *  derived from the script's main system. */
export const scriptModelUnits = computed<ModelUnits>(() =>
{
    const fromMeta = executionResult.get()?.meta?.units as ModelUnits | undefined;
    return fromMeta ?? baseUnitForSystem(scriptUnitSystem.get());
});
