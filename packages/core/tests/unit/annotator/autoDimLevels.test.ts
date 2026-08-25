/** autoDim({ levels: [...] }) in the MESH kernel.
 *  The 'levels' strategy used to throw ("needs the BREP kernel"): meshup has no
 *  section-plane extrude. It now reads the level crossings off the geometry itself.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'
import type { DimensionLineData } from '../../../src/annotator/types'

describe('autoDim levels (mesh kernel)', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() => { modeler.reset(); annotator.reset() })

    /** dimension values, rounded and sorted */
    const values = (): Array<number> =>
        (annotator.getAnnotationsData() as DimensionLineData[])
            .map(d => Math.round(d.value))
            .sort((a, b) => a - b)

    it('dimensions a flat drawing at a level along y (elevation case)', () =>
    {
        //  two 100-wide posts in the XY plane, at x = 0..100 and x = 300..400, both y = 0..500
        const left = modeler.rect(100, 500).moveTo(50, 250, 0)
        const right = modeler.rect(100, 500).moveTo(350, 250, 0)
        const col = modeler.collection(left, right)

        const dims = annotator.autoDim(col as any, { levels: [{ axis: 'y', at: 0.5, minDistance: 1 }] } as any)

        expect(Array.isArray(dims)).toBe(true)
        // crossings along x: 0, 100, 300, 400 → gaps 100 (post), 200 (gap), 100 (post)
        expect(values()).toEqual([100, 100, 200])
    })

    it('dimensions along x, with the level given as an absolute coordinate', () =>
    {
        const bottom = modeler.rect(400, 50).moveTo(200, 25, 0)
        const top = modeler.rect(400, 50).moveTo(200, 475, 0)
        const col = modeler.collection(bottom, top)

        annotator.autoDim(col as any, { levels: [{ axis: 'x', at: 200, minDistance: 1 }] } as any)

        // crossings along y at x=200: 0, 50, 450, 500 → 50, 400, 50
        expect(values()).toEqual([50, 50, 400])
    })

    it('sections 3D solids at a height level', () =>
    {
        const a = modeler.box(100, 100, 1000)
        const b = modeler.box(100, 100, 1000).moveX(500)
        const col = modeler.collection(a, b)

        annotator.autoDim(col as any, { levels: [{ axis: 'z', at: 0, minDistance: 1 }] } as any)

        // boxes are centred: x spans -50..50 and 450..550 → 100, 400, 100
        expect(values()).toEqual([100, 100, 400])
    })

    it('does not throw and reports nothing when the level misses every shape', () =>
    {
        const col = modeler.collection(modeler.rect(100, 100).moveTo(50, 50, 0))

        expect(() => annotator.autoDim(col as any, { levels: [{ axis: 'y', at: 5000, minDistance: 1 }] } as any)).not.toThrow()
        expect(annotator.getAnnotations().length).toBe(0)
    })
})
