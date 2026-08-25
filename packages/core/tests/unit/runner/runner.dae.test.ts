import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionResult } from '../../../src/runner/types'

/**
 * The `dae` model output. This used to be routed through the remote Archiyou Services
 * (glb -> dae conversion) alongside `obj`; it is now produced locally by Modeler.toDAE().
 * These tests therefore also assert that no service call is attempted.
 */
describe('Runner dae output', () =>
{
    it('produces a COLLADA document with no services call', async () =>
    {
        const runner = await new Runner().load()

        // Fail loudly if anything reaches for the remote converter
        let servicesCalled = false
        const scopeServices = (runner as any)?.scope?.ay?.services
        if (scopeServices)
        {
            scopeServices.isUp = async () => { servicesCalled = true; return false }
            scopeServices.convert = async () => { servicesCalled = true; return { success: false } }
        }

        const result: RunnerScriptExecutionResult = await runner.execute({
            script: { code: 'box(100,100,100).color("red")' },
            outputs: ['default/model/dae'],
        } as any)

        const output = result.outputs?.find(o => o.path.requestedPath === 'default/model/dae')?.output

        expect(typeof output).toBe('string')
        expect(output as string).toContain('<COLLADA')
        expect(output as string).toContain('<up_axis>Z_UP</up_axis>')
        expect(output as string).toContain('<polylist')
        expect(servicesCalled).toBe(false)
    })

    it('passes format options through the output path', async () =>
    {
        const runner = await new Runner().load()

        const result: RunnerScriptExecutionResult = await runner.execute({
            script: { code: 'box(100,100,100)' },
            outputs: ['default/model/dae?ngons=false'],
        } as any)

        const output = result.outputs?.find(o => o.path.requestedPath === 'default/model/dae?ngons=false')?.output as string

        expect(output).toBeTruthy()
        expect(output).toContain('<triangles')
        expect(output).not.toContain('<polylist')
    })
})
