/** Dimension lines in exported drawings (ShapeCollection.toSVG()).
 *  The mesh kernel drew only curves: a doc view of a dimensioned elevation came out
 *  without a single dimension. brep has always drawn them (_getDimensionLinesSvgElems).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

describe('annotations in ShapeCollection.toSVG() (mesh kernel)', () =>
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

    /** [x, y, width, height] of an SVG's viewBox */
    const viewBox = (svg: string): Array<number> =>
        svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)

    it('draws dimensions linked to the collection, and makes room for them', () =>
    {
        const col = modeler.collection(
            modeler.rect(400, 200).moveTo(200, 100, 0),
            modeler.rect(100, 100).moveTo(600, 50, 0),
        ) as any

        const bare = col.toSVG() as string
        expect(bare).not.toContain('dimensionline')
        const bareBox = viewBox(bare)

        col.bbox().back().dim()                       // dims the 650-wide bbox side
        annotator.autoDim(col, { levels: [{ axis: 'y', at: 0.5, minDistance: 1 }] } as any)

        const svg = col.toSVG() as string
        expect((svg.match(/class="dimensionline"/g) ?? []).length).toBe(annotator.getAnnotations().length)
        expect(svg).not.toContain('undefined')

        // the dimension lines sit outside the geometry — the viewBox has to grow for them
        const box = viewBox(svg)
        expect(box[2]).toBeGreaterThan(bareBox[2])
        expect(box[3]).toBeGreaterThan(bareBox[3])
    })

    it('dimensions on the shapes themselves are drawn too', () =>
    {
        const rect = modeler.rect(400, 200) as any
        const col = modeler.collection(rect) as any
        rect.dim()

        expect(col.getAnnotations().length).toBe(annotator.getAnnotations().length)
        expect(col.toSVG()).toContain('class="dimensionline"')
    })

    /** Direction the arrowhead at `translate(x y) rotate(a)` points, in SVG space.
     *  The glyph is a chevron with its tip at the origin pointing up (0,-1). */
    const arrows = (svg: string): Array<{ at: [number, number], dir: [number, number] }> =>
        [...svg.matchAll(/translate\(([-\d.e]+) ([-\d.e]+)\)\s*rotate\(([-\d.e]+)\)/g)].map(m =>
        {
            const [x, y, a] = [Number(m[1]), Number(m[2]), Number(m[3]) * Math.PI / 180]
            // SVG rotate(a): (x,y) → (x cos a − y sin a, x sin a + y cos a)
            return { at: [x, y], dir: [Math.sin(a), -Math.cos(a)] as [number, number] }
        })

    it('arrowheads point outward along the dimension, not back into it', () =>
    {
        /*  Regression: getSVGRotation() said "mirror y" but mirrored across the plane with
            normal [1,0,0] — negating X, which is the same direction turned by 180°. Every
            arrowhead in an exported drawing pointed the wrong way. */
        const horizontal = modeler.line([0, 0], [100, 0]) as any
        horizontal.dim()
        const hDim = annotator.getAnnotations()[0] as any
        const hArrows = arrows(hDim.toSVG())

        expect(hArrows.length).toBe(2)
        // start arrow sits at the low-x end and points further -x; end arrow mirrors it
        const [hStart, hEnd] = hArrows[0].at[0] < hArrows[1].at[0] ? hArrows : [hArrows[1], hArrows[0]]
        expect(hStart.dir[0]).toBeCloseTo(-1)
        expect(hStart.dir[1]).toBeCloseTo(0)
        expect(hEnd.dir[0]).toBeCloseTo(1)
        expect(hEnd.dir[1]).toBeCloseTo(0)

        annotator.reset()

        // A vertical dimension: model +y is SVG -y, so its arrows run along the SVG y axis
        const vertical = modeler.line([0, 0], [0, 100]) as any
        vertical.dim()
        const vArrows = arrows((annotator.getAnnotations()[0] as any).toSVG())
        const [vLow, vHigh] = vArrows[0].at[1] < vArrows[1].at[1] ? vArrows : [vArrows[1], vArrows[0]]
        expect(vLow.dir[1]).toBeCloseTo(-1)   // top of the drawing → points up
        expect(vHigh.dir[1]).toBeCloseTo(1)   // bottom → points down
    })
})
