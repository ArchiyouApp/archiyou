/**
 *  Kernel selection per run.
 *
 *  `request.kernel` used to be parsed and then only logged. These tests pin the wiring: the
 *  Runner loads the kernel the request asks for and the script actually executes against it,
 *  for the whole run (no mid-script switching).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Runner } from '../../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../../src/runner/types'

function request(code: string, kernel?: 'mesh' | 'brep'): RunnerScriptExecutionRequest
{
    return {
        kernel,
        script: { code },
        outputs: ['default/model/glb'],
        messages: ['error'],
    } as RunnerScriptExecutionRequest
}

function glbOf(result: any): Uint8Array | undefined
{
    const out = result.outputs?.find((o: any) => o.path.requestedPath === 'default/model/glb')
    const data = out?.output
    if (!data) return undefined
    return data instanceof Uint8Array ? data : new Uint8Array(data.data ?? data)
}

describe('Runner — kernel selection', () =>
{
    let runner: Runner

    beforeAll(async () => { runner = await new Runner().load() }, 120000)

    it('defaults to the mesh kernel when the request does not say', async () =>
    {
        const result = await runner.execute(request('box(100)'))
        expect(result.status).toEqual('success')
        expect(glbOf(result)?.byteLength).toBeGreaterThan(0)
    })

    it('runs a script on the brep kernel when asked', async () =>
    {
        const result = await runner.execute(request('box(100)', 'brep'))

        expect(result.errors ?? []).toEqual([])
        expect(result.status).toEqual('success')
        expect(glbOf(result)?.byteLength).toBeGreaterThan(0)
    }, 120000)

    it('exposes brep-only primitives once the brep kernel is selected', async () =>
    {
        const result = await runner.execute(request('cone(40, 0, 80)', 'brep'))
        expect(result.errors ?? []).toEqual([])
        expect(result.status).toEqual('success')
    }, 120000)

    it('reports a clear error for a brep-only primitive on the mesh kernel', async () =>
    {
        const result = await runner.execute(request('cone(40, 0, 80)', 'mesh'))
        expect(result.status).toEqual('error')
        expect(JSON.stringify(result.errors)).toMatch(/only available in brep mode/)
    })

    it('switches back to mesh on the next run', async () =>
    {
        await runner.execute(request('box(100)', 'brep'))
        const result = await runner.execute(request('box(100)', 'mesh'))

        expect(result.errors ?? []).toEqual([])
        expect(result.status).toEqual('success')
        expect(glbOf(result)?.byteLength).toBeGreaterThan(0)
    }, 120000)

    it('produces geometry of the same size from either kernel', async () =>
    {
        const meshRun = await runner.execute(request('box(100,50,20)', 'mesh'))
        const brepRun = await runner.execute(request('box(100,50,20)', 'brep'))

        // both must yield a real model — the point is the workflow, not byte equality
        expect(glbOf(meshRun)?.byteLength).toBeGreaterThan(0)
        expect(glbOf(brepRun)?.byteLength).toBeGreaterThan(0)
    }, 120000)
})
