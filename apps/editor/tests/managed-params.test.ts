/**
 * tests/managed-params.test.ts — merging the params a run reports back into the script.
 *
 * Only define() makes a param the script's own. A param made in the menu that the script
 * merely enables or hides comes back as 'updated' too, and must stay editable: once it is
 * flagged programmatic, the next run that does not touch it reports it deleted.
 */

import { describe, it, expect, vi } from 'vitest';
import { signal } from '@lit-labs/signals';

import { Script } from '@archiyou/core/src/Script';
import { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import { ParamManager } from '@archiyou/core/src/execution/ParamManager';

const { editorScript } = vi.hoisted(() => ({ editorScript: { current: null as any } }));

vi.mock('../src/state/core', () =>
{
  editorScript.current = signal<Script | null>(null, { equals: () => false });
  return {
    editorScript: editorScript.current,
    executionResult: signal(null),
    bumpScript: () => {},
    saveCore: () => {},
  };
});
vi.mock('../src/state/viewer', () => ({ scheduleExecution: () => {} }));

import { applyManagedParamsAndPresets } from '../src/state/editor.js';

/** A number param made in the param menu */
function menuParam(name: string): ScriptParam
{
  return ScriptParam.fromData({
    name, type: 'number',
    schema: { type: 'number', default: 1000, minimum: 200, maximum: 10000, multipleOf: 10 },
  } as any);
}

/** Run the worker side on the script's params, then merge what it reports into the script */
function run(script: Script, body: (pm: ParamManager) => void)
{
  const pm = new ParamManager(Object.values(script.params));
  body(pm);
  applyManagedParamsAndPresets(pm.getManagedParams());
}

function scriptWith(...params: ScriptParam[]): Script
{
  const script = new Script();
  params.forEach(p => { script.params[p.name] = p; });
  editorScript.current.set(script);
  return script;
}

describe('applyManagedParamsAndPresets', () =>
{
  it('keeps a menu param editable when the script only enables it', () =>
  {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const script = scriptWith(menuParam('PROJECT_AREA'));

    run(script, pm => pm['PROJECT_AREA'].enableIf(false));

    expect(script.params.PROJECT_AREA.enabled).toBe(false);
    expect(script.params.PROJECT_AREA._definedProgrammatically).toBeFalsy();

    // A later run that leaves it alone must not delete it
    run(script, () => {});
    expect(script.params.PROJECT_AREA).toBeDefined();
  });

  it('flags a param the script defines', () =>
  {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const script = scriptWith();

    run(script, pm => pm.define('WIDTH', 'number', { min: 0, max: 100, default: 50 }));

    expect(script.params.WIDTH._definedProgrammatically).toBe(true);

    // ...and keeps the flag when the script only enables it afterwards
    run(script, pm => { pm.define('WIDTH', 'number', { min: 0, max: 100, default: 50 }); pm['WIDTH'].enable(); });
    expect(script.params.WIDTH._definedProgrammatically).toBe(true);
  });
});
