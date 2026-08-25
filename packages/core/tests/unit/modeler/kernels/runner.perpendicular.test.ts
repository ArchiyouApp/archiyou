/**
 *  perpendicularPointTo() across both kernels.
 *
 *  The point of the method is that a script does not have to know which kernel it runs on, so the
 *  gate is the script itself: the same source, run on mesh and on brep, has to print the same feet.
 *  The kernel-local suites (meshup tests/unit/Curve.test.ts, brep Edge/Wire tests) cover the
 *  geometry in detail; this pins that the two agree and that the method is reachable from a script.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Runner } from '../../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../../src/runner/types'

/** Report the feet as text so both kernels can be compared literally */
const SCRIPT = `
    const c = circle(50);
    const p = point(200, 0, 0);
    const feet = c.perpendicularPointTo(p, true);
    print('FEET ' + feet.map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.z)].join(',')).join(' | '));
    print('NEAREST ' + c.perpendicularPointTo(p).toArray().map(v => Math.round(v)).join(','));
`

function request(code: string, kernel: 'mesh' | 'brep'): RunnerScriptExecutionRequest
{
    return {
        kernel,
        script: { code },
        outputs: ['default/model/glb'],
        messages: ['error', 'user'],
    } as RunnerScriptExecutionRequest
}

function printed(result: any): Array<string>
{
    return (result.messages ?? [])
        .filter((m: any) => typeof m.message === 'string' && /^(FEET|NEAREST) /.test(m.message))
        .map((m: any) => m.message)
}

describe('Runner — perpendicularPointTo on both kernels', () =>
{
    let runner: Runner
    let mesh: Array<string>
    let brep: Array<string>

    beforeAll(async () =>
    {
        runner = await new Runner().load()
        const meshResult = await runner.execute(request(SCRIPT, 'mesh'))
        const brepResult = await runner.execute(request(SCRIPT, 'brep'))
        expect(meshResult.status).toEqual('success')
        expect(brepResult.status).toEqual('success')
        mesh = printed(meshResult)
        brep = printed(brepResult)
    }, 120000)

    it('finds the near and the far foot of a circle', () =>
    {
        expect(mesh).toEqual(['FEET 50,0,0 | -50,0,0', 'NEAREST 50,0,0'])
    })

    it('answers the same on brep as on mesh', () =>
    {
        expect(brep).toEqual(mesh)
    })
})
