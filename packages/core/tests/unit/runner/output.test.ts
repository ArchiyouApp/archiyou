import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { getOutput } from '../../../src/runner/worker/output'

/**
 * Validates the core-side output unwrap (getOutput) used by RunnerWorker.execute().
 * Runs the Runner on the main thread (no Worker needed) and asserts the
 * 'default/model/glb' output comes back as a real GLB ArrayBuffer.
 */
describe('getOutput (RunnerWorker output helper)', () =>
{
    it('returns the requested GLB output as an ArrayBuffer with glTF magic', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: `box(100,100,100).color('blue');` },
            outputs: ['default/model/glb'],
        })

        expect(result.status).toBe('success')

        const glb = getOutput(result, 'default/model/glb')
        expect(glb).toBeInstanceOf(ArrayBuffer)

        const buf = glb as ArrayBuffer
        expect(buf.byteLength).toBeGreaterThan(0)

        // GLB binary container starts with the ASCII magic "glTF".
        const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4))
        expect(magic).toBe('glTF')
    })

    it('returns undefined for an output path that was not requested', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: `box(10,10,10);` },
            outputs: ['default/model/glb'],
        })

        expect(getOutput(result, 'default/model/step')).toBeUndefined()
    })
})
