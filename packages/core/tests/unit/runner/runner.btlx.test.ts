import { describe, it, expect } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import { isRecipeRecording } from '../../../src/modeler/Recipe'
import { save } from '@archiyou/meshup/src/utils'

/**
 * BTLx export end to end: a script run with `default/model/btlx` records recipes and writes the timber parts
 * with their cuts and drillings. The script does not call fab itself: the exporter loads it.
 * Unit coverage: tests/unit/modeler/btlx.test.ts.
 */

const CODE = `
    const wall = make.wall(3000, 2400, 120, 38, 610, [], { height: 600, center: 0.5 });
    const beam = box(38, 120, 2000).move(0, 1000, 0).name('beam');
    const drill = cylinder(6, 200, [0, 0, 0]).rotate(90, 'x').move(0, 1100, 300);
    beam.subtract(drill);
    drill.removeFromScene();
`

describe('Runner — BTLx export', () =>
{
    it('writes the parts of a script that does not use fab', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: CODE, name: 'shed wall', version: '0.1.0' },
            outputs: ['default/model/btlx?timestamp=2026-09-16'],
        } as unknown as RunnerScriptExecutionRequest)

        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(isRecipeRecording()).toBe(true)
        const text = result.outputs?.find(o => o.path.requestedPath.startsWith('default/model/btlx'))?.output as string
        expect(typeof text).toBe('string')
        save('./tests/outputs/runner/runner.btlx.shedwall.btlx', text)

        expect(XMLValidator.validate(text)).toBe(true)
        expect(text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<!-- Archiyou fab: fabrication from the model: BTLx 2.3 from shed wall 0.1.0, norm book /)
        expect(text).toContain('<Project Name="shed wall"')
        expect(text).toContain('Comment="version 0.1.0, norm book ')
        expect(text).toContain('Date="2026-09-16"')
        expect(text).toContain('<!-- not written: 5 fills (insulation) are not machined -->')
        expect(text).toMatch(/Designation="beam"[^>]*>[\s\S]*?<Drilling Name="Drilling" ProcessID="1" ReferencePlaneID="\d"><StartX>1300<\/StartX>/)
        expect(text).toMatch(/<JackRafterCut Name="JackRafterCut" ProcessID="1" ReferencePlaneID="1"><Orientation>end<\/Orientation>/)
        expect(text).not.toContain('unknown')
    }, 60000)
})
