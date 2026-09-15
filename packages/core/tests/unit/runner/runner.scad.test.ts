import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import { isRecipeRecording } from '../../../src/modeler/Recipe'
import { save } from '@archiyou/meshup/src/utils'

/**
 * OpenSCAD export end to end: a script run with `default/model/scad` records recipes and exports
 * the model as OpenSCAD CSG, with the parameters listed in the header for reference only.
 * Unit coverage: tests/unit/modeler/scad.test.ts.
 */

const CODE = `
    $PARAMS.define('WIDTH', 'number', { min: 100, max: 2000, step: 10, default: 600 });

    top = boxbetween([0, 0, 700], [$WIDTH, 400, 725]).color('#b08050');
    top.subtract(cylinder(15, 100, [$WIDTH / 2, 200, 650]).hide());
    brace = line([40, 20, 100], [$WIDTH - 40, 20, 600]).extrude(20, [0, 1, 0]).extrude(20);
`

describe('Runner — OpenSCAD export', () =>
{
    it('exports the model as CSG and lists the parameters without linking them', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: CODE, name: 'table', version: '0.1.0' },
            outputs: ['default/model/scad'],
        } as unknown as RunnerScriptExecutionRequest)

        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(isRecipeRecording()).toBe(true)
        const text = result.outputs?.find(o => o.path.requestedPath === 'default/model/scad')?.output as string
        expect(typeof text).toBe('string')
        save('./tests/outputs/runner/runner.scad.table.scad', text)

        expect(text.split('\n')[0]).toBe('// Archiyou -> OpenSCAD  |  script: table 0.1.0  |  units: mm')
        expect(text).toContain('// Parts: 2 CSG, 0 baked, 0 2D')
        expect(text).toContain('//   WIDTH = 600')
        expect(text).toContain('module top() {')
        expect(text).toContain('difference() {')
        expect(text).toContain('translate([300, 200, 650]) cylinder(h = 100, r = 15);')
        expect(text).toContain('module brace() {')
        expect(text).toMatch(/linear_extrude\(height = 20\) polygon\(/)
        expect(text).not.toContain('WIDTH -')   // fixed numbers: nothing refers to the parameter
    }, 60000)
})
