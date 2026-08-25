import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import type { ScriptParamData } from '../../../src/execution/types'
import { Runner } from '../../../src/runner/Runner'

// A script that declares its own params + a preset, then uses one to build geometry.
const SCRIPT_CODE = `
    $PARAMS.define('WIDTH', 'number', { min: 10, max: 200, step: 5, default: 120, group: 'Size' });
    $PARAMS.define('SHOW',  'boolean', { default: true });
    $PARAMS.preset('SMALL', { WIDTH: 40 }, { description: 'Compact version' });

    box($WIDTH, 20, 30);
`

describe('Runner — programmatic params ($PARAMS.define / $PARAMS.preset)', () =>
{
    it('emits managedParams and managedPresets in result.state', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('success')

        const managed = result.state.managedParams
        expect(managed).toBeDefined()
        const newNames = managed!.new.map(p => p.name)
        expect(newNames).toContain('WIDTH')
        expect(newNames).toContain('SHOW')

        const presets = result.state.managedPresets
        expect(presets).toBeDefined()
        expect(presets!.SMALL.WIDTH._value).toBe(40)
    })

    it('is idempotent on re-run: re-asserting the same params yields no new/deleted', async () =>
    {
        const runner = await new Runner().load()

        // First run to obtain the emitted param definitions.
        const first = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        // Feed the emitted params back in (as the app would persist them) and
        // pick a user value for WIDTH.
        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        const second = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE, params },
            params:  { WIDTH: 80 },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(second.status).toBe('success')
        const managed = second.state.managedParams!
        expect(managed.new.length).toBe(0)       // already known → not new
        expect(managed.deleted.length).toBe(0)   // still defined → not dropped
    })

    /* TODO: Fix and tests
        $PARAMS.define('SHOW', 'boolean', { default: false });  ==> looks like setting default is not workign
    */
})
