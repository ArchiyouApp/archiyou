/**
 * state/units.ts — unit-system state.
 *
 * The script is the source of truth: its units('…') (mm by default) sets the model's
 * system, mm/cm/m metric and inch/feet imperial. Everything here is a display override
 * of that, and only the overrides go out with a run — the effective value from the last
 * run would pin the next one to it:
 *   - scriptUnitSystem       the file-bar switch: how the editor shows the script
 *                            (viewer, params, readouts). Persisted on the Script as
 *                            an override; unset follows the model. Not documents.
 *   - docUnitSystem          the document tool's switch: what documents are written
 *                            in. Unset follows the model. Never persisted.
 *   - configuratorUnitSystem the end-user's LOCAL pick in the configurator, for the
 *                            whole output, documents included. Never persisted.
 *
 * A user's switch snaps the param widgets' stored values to nice numbers in the new
 * system (25mm ⇄ 1") — see param-item-number. A run reporting other model units does not.
 */

import { signal, computed } from '@lit-labs/signals';

import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';
import { baseUnitForSystem, systemOfUnit } from '@archiyou/core/src/units/UnitConverter';
import type { ModelUnits } from '@archiyou/core/src/modeler/types';

import { editorScript, saveActive } from './core';
import { executionResult } from './core';

export type { UnitSystem };
export { baseUnitForSystem };

//// MODEL UNIT (from execution) ////

/** The active script's executed model unit (the conversion anchor): what its units()
 *  said in the last run, mm until it has run. */
export const scriptModelUnits = computed<ModelUnits>(() =>
{
    return (executionResult.get()?.meta?.units as ModelUnits | undefined) ?? 'mm';
});

/** The system of the model's units(), which every switch shows until someone picks one. */
export const modelUnitSystem = computed<UnitSystem>(() => systemOfUnit(scriptModelUnits.get()));

//// SCRIPT DISPLAY UNIT (editor, persisted override) ////

/** The file-bar override (Script.units), undefined when the editor follows the model.
 *  This is what goes out as request.unitSystem. */
export const scriptUnitSystemOverride = computed<UnitSystem | undefined>(() =>
{
    return editorScript.get()?.units as UnitSystem | undefined;
});

/** How the editor shows the active script: the file-bar override, else the model's system. */
export const scriptUnitSystem = computed<UnitSystem>(() =>
{
    return scriptUnitSystemOverride.get() ?? modelUnitSystem.get();
});

/** Set the file-bar switch and save. Picking the model's own system removes the
 *  override, so the switch follows units() again. */
export function setScriptUnitSystem(system: UnitSystem): void
{
    const script = editorScript.get();
    if (!script) return;
    script.units = (system === modelUnitSystem.get()) ? undefined : system;
    script.updated = new Date();
    saveActive();
    editorScript.set(script);
}

//// DOCUMENT DISPLAY UNIT (editor, local, not persisted) ////

const _docUnitSystem = signal<UnitSystem | undefined>(undefined);

/** The document tool's override, undefined when documents follow the model. This is
 *  what goes out as request.docUnitSystem. */
export const docUnitSystemOverride = computed<UnitSystem | undefined>(() => _docUnitSystem.get());

/** What the editor writes documents in: the document tool's override, else the model's system. */
export const docUnitSystem = computed<UnitSystem>(() =>
{
    return _docUnitSystem.get() ?? modelUnitSystem.get();
});

/** Set the document tool's switch. Picking the model's own system removes the override. */
export function setDocUnitSystem(system: UnitSystem): void
{
    _docUnitSystem.set((system === modelUnitSystem.get()) ? undefined : system);
}

//// CONFIGURATOR DISPLAY UNIT (local, not persisted) ////

const _configuratorUnitSystem = signal<UnitSystem | undefined>(undefined);

/** The end-user's pick, undefined until they make one. It goes out as both
 *  request.unitSystem and request.docUnitSystem. */
export const configuratorUnitSystemPick = computed<UnitSystem | undefined>(() => _configuratorUnitSystem.get());

/** The configurator's display system: the end-user's pick, else the script's. */
export const configuratorUnitSystem = computed<UnitSystem>(() =>
{
    return _configuratorUnitSystem.get() ?? scriptUnitSystem.get();
});

export function setConfiguratorUnitSystem(system: UnitSystem): void
{
    _configuratorUnitSystem.set(system);
}
