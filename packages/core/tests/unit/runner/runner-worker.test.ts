import { describe, it, expect } from 'vitest'

import { RunnerWorker } from '../../../src/runner/worker/RunnerWorker'
import type { RunnerScriptExecutionResult } from '../../../src/runner/types'

/**
 * Unit-tests RunnerWorker.execute()'s ergonomics (direct-output return,
 * multi-output map, error throwing) without spinning up a real Web Worker —
 * we stub run() with a canned result. The full worker path is verified in the
 * browser (editor E2E) and the getOutput unwrap in output.test.ts.
 */

function makeResult(overrides: Partial<RunnerScriptExecutionResult> = {}): RunnerScriptExecutionResult
{
    const glb = new TextEncoder().encode('glTF fake body').buffer
    return {
        created: new Date(),
        status: 'success',
        duration: 1,
        request: {} as any,
        outputs: [
            { path: { requestedPath: 'default/model/glb' } as any, output: glb },
            { path: { requestedPath: 'default/model/step' } as any, output: 'SOLID step data' },
        ],
        state: {} as any,
        ...overrides,
    }
}

/** A RunnerWorker whose run() is stubbed — never creates a Worker. */
function stubbedWorker(result: RunnerScriptExecutionResult): RunnerWorker
{
    const worker = new RunnerWorker()
    ;(worker as any).run = async () => result
    return worker
}

describe('RunnerWorker.execute()', () =>
{
    it('returns the single requested output directly (unwrapped ArrayBuffer)', async () =>
    {
        const worker = stubbedWorker(makeResult())
        const out = await worker.execute('box(100,100,100)', { outputs: ['default/model/glb'] })

        expect(out).toBeInstanceOf(ArrayBuffer)
        expect(new TextDecoder().decode(new Uint8Array(out as ArrayBuffer, 0, 4))).toBe('glTF')
    })

    it('returns a keyed map when multiple outputs are requested', async () =>
    {
        const worker = stubbedWorker(makeResult())
        const out = await worker.execute('box(1,1,1)', { outputs: ['default/model/glb', 'default/model/step'] }) as Record<string, any>

        expect(Object.keys(out)).toEqual(['default/model/glb', 'default/model/step'])
        expect(out['default/model/glb']).toBeInstanceOf(ArrayBuffer)
        expect(out['default/model/step']).toBe('SOLID step data')
    })

    it('wraps a bare string script as ScriptData { code } that Runner accepts', () =>
    {
        const worker = new RunnerWorker()
        const req = (worker as any)._buildRequest('box(1,1,1)', { outputs: ['default/model/glb'] })
        expect(req.script).toEqual({ code: 'box(1,1,1)' })
        expect(req.outputs).toEqual(['default/model/glb'])
    })

    it('passes a full request through, keeping its (optional) kernel untouched', () =>
    {
        const worker = new RunnerWorker()
        const req = (worker as any)._buildRequest({ script: { code: 'box(2,2,2)' }, outputs: ['default/model/step'] })
        expect(req.script).toEqual({ code: 'box(2,2,2)' })
        expect(req.outputs).toEqual(['default/model/step'])
    })

    it('throws with the error message when the run failed', async () =>
    {
        const worker = stubbedWorker(makeResult({
            status: 'error',
            outputs: [],
            errors: [{ status: 'error', message: 'boom on line 1' } as any],
        }))

        await expect(worker.execute('nope()')).rejects.toThrow('boom on line 1')
    })
})
