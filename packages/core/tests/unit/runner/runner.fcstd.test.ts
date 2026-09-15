import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import { isRecipeRecording } from '../../../src/modeler/Recipe'
import { save } from '@archiyou/meshup/src/utils'

/**
 * FreeCAD export end to end: a script run with `default/model/fcstd` records recipes, exports the
 * model as FreeCAD features, and lists $PARAMS in a documentation-only sheet that drives nothing.
 * A run without a recipe format records nothing. Unit coverage: tests/unit/modeler/fcstd.test.ts.
 */

const CODE = `
    $PARAMS.define('WIDTH', 'number', { min: 10, max: 200, step: 5, default: 120 });
    $PARAMS.define('HOLE', 'number', { default: 6 });

    plate = box($WIDTH, 40, 10);
    plate.subtract(cylinder($HOLE, 30, [20, 0, -15]));
`

function documentXml(data: Uint8Array): string
{
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const method = view.getUint16(8, true)
    const size = view.getUint32(18, true)
    const nameLength = view.getUint16(26, true)
    expect(new TextDecoder().decode(data.subarray(30, 30 + nameLength))).toBe('Document.xml')
    const body = data.subarray(30 + nameLength, 30 + nameLength + size)
    return new TextDecoder().decode(method === 8 ? inflateRawSync(body) : body)
}

describe('Runner — FreeCAD export', () =>
{
    it('exports the model as features and documents the parameters without linking them', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: CODE, name: 'plate', version: '0.1.0' },
            outputs: ['default/model/fcstd'],
        } as unknown as RunnerScriptExecutionRequest)

        expect(result.status, JSON.stringify(result.errors)).toBe('success')
        expect(isRecipeRecording()).toBe(true)

        const output = result.outputs?.find(o => o.path.requestedPath === 'default/model/fcstd')?.output as Uint8Array
        expect(output?.byteLength).toBeGreaterThan(0)
        // Inspection artifact: open it in FreeCAD and press Recompute
        await save('./tests/outputs/runner/runner.fcstd.plate.FCStd', output)

        const xml = documentXml(output)
        expect(xml).toContain('type="Part::Cut"')
        expect(xml).toContain('type="Part::Box"')
        expect(xml).toContain('type="Part::Cylinder"')
        expect(xml).toContain('type="Spreadsheet::Sheet"')
        expect(xml).toContain('WARNING: documentation only')
        expect(xml).toContain(`content="'WIDTH"`)
        expect(xml).not.toContain('<Expression ')
        expect(xml).not.toContain('alias=')
        expect(xml).toContain('key="archiyou.script" value="plate"')
    })

    it('does the same on the brep kernel', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'brep',
            script: { code: CODE, name: 'plate' },
            outputs: ['default/model/fcstd'],
        } as unknown as RunnerScriptExecutionRequest)

        expect(result.status, JSON.stringify(result.errors)).toBe('success')
        const xml = documentXml(result.outputs!.find(o => o.path.requestedPath === 'default/model/fcstd')!.output as Uint8Array)
        expect(xml).toContain('type="Part::Cut"')
        expect(xml).not.toContain('<Expression ')
    }, 60000)

    it('switches recording off again for a run without a recipe format', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({ kernel: 'mesh', script: { code: CODE }, outputs: ['default/model/fcstd'] } as unknown as RunnerScriptExecutionRequest)
        expect(isRecipeRecording()).toBe(true)

        const plain = await runner.execute({ kernel: 'mesh', script: { code: CODE }, outputs: ['default/model/glb'] } as unknown as RunnerScriptExecutionRequest)
        expect(plain.status).toBe('success')
        expect(isRecipeRecording()).toBe(false)
    })
})
