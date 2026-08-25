/** Annotations come out at a fixed size ON THE PAGE (mm), whatever the model measures.
 *
 *  A view scales its drawing to fit the page, so a dimension sized in model units reads
 *  differently in every view — 4mm text in one, a hairline in the next. The sizes are set on
 *  the Annotator (DIMENSION_TEXT_SIZE_MM and friends) and converted with the view's own scale.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Docs } from '../../../src/docs/Docs'
import type { ArchiyouModules } from '../../../src/types'
import { ShapeCollection } from '@archiyou/meshup'

/** The annotation sizes of the first dimensioned view in a page SVG, in page mm */
function annotationSizesMm(pageSvg: string): { text: number, arrow: number, line: number }
{
    for (const m of pageSvg.matchAll(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"[^>]*>/g))
    {
        const [w, h] = [Number(m[1]), Number(m[2])]
        const vb = m[3].split(/\s+/).map(Number)
        const body = pageSvg.slice(m.index! + m[0].length, pageSvg.indexOf('</svg>', m.index!))
        if (!body.includes('dimensionline')) continue

        const scale = Math.min(w / vb[2], h / vb[3])   // preserveAspectRatio 'meet'
        return {
            text:  Number(body.match(/font-size="([\d.]+)"/)![1]) * scale,
            // the arrow glyph is 10 units wide, scaled by its group transform
            arrow: Number(body.match(/scale\(([\d.]+) /)![1]) * 10 * scale,
            line:  Number(body.match(/class="annotation line" style="stroke:black;stroke-width:([\d.]+)"/)![1]) * scale,
        }
    }
    throw new Error('annotationSizesMm(): no dimensioned view in this page SVG')
}

/** A doc with one view of a dimensioned drawing `size` across, rendered to a page SVG */
async function pageWithDimensionedBox(size: number, annotator: Annotator, modeler: Modeler): Promise<string>
{
    modeler.reset()
    annotator.reset()

    const shapes = modeler.collection(
        modeler.rect(size, size * 0.6),
        modeler.rect(size * 0.2, size * 0.2).moveTo(size * 0.3, 0, 0),
    ) as any
    shapes.bbox().back().dim()
    shapes.bbox().left().dim()

    const scope: Record<string, any> = {}
    const doc = new Docs(null, { runner: { getActiveScope: () => scope }, calc: { metrics: () => ({}) }, annotator } as any)
    doc.create('sizes').pipeline(() => ({ view: shapes })).page('main').view('v').shapes('view').width(0.5).height(0.5)

    return await doc.toSVG() as string
}

describe('annotation size on the page', () =>
{
    it('is the same millimeters for a small part and a large one', async () =>
    {
        const modeler = new Modeler()
        await modeler.load()
        const annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)

        const small = annotationSizesMm(await pageWithDimensionedBox(50, annotator, modeler))
        const large = annotationSizesMm(await pageWithDimensionedBox(12000, annotator, modeler))

        for (const sizes of [small, large])
        {
            expect(sizes.text).toBeCloseTo(annotator.DIMENSION_TEXT_SIZE_MM, 1)
            expect(sizes.arrow).toBeCloseTo(annotator.DIMENSION_ARROW_SIZE_MM, 1)
            expect(sizes.line).toBeCloseTo(annotator.DIMENSION_LINE_WIDTH_MM, 2)
        }

        // 240x model-size difference, same size on paper
        expect(small.text).toBeCloseTo(large.text, 1)
    })

    it('follows the Annotator settings', async () =>
    {
        const modeler = new Modeler()
        await modeler.load()
        const annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)

        annotator.DIMENSION_TEXT_SIZE_MM = 2
        annotator.DIMENSION_ARROW_SIZE_MM = 3
        annotator.DIMENSION_LINE_WIDTH_MM = 0.5

        const sizes = annotationSizesMm(await pageWithDimensionedBox(800, annotator, modeler))

        expect(sizes.text).toBeCloseTo(2, 1)
        expect(sizes.arrow).toBeCloseTo(3, 1)
        expect(sizes.line).toBeCloseTo(0.5, 2)
    })

    it('writes the geometry once per view — only the annotations are re-drawn for the page', async () =>
    {
        /*  Sizing annotations for the page needs the view's scale, which comes from the
            drawing's own extents. Solving that by re-rendering the whole drawing until it
            converged cost 6 passes per view — thousands of path strings each — and took a
            300ms page to 3s. The kernel publishes `data-extents` instead, so the scale is one
            division and only the handful of annotations is drawn again. */
        const modeler = new Modeler()
        await modeler.load()
        const annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)

        const proto = ShapeCollection.prototype as any
        const orig = proto.toSVG
        let renders = 0
        proto.toSVG = function (...args: Array<any>) { renders++; return orig.apply(this, args) }

        try { await pageWithDimensionedBox(800, annotator, modeler) }
        finally { proto.toSVG = orig }

        expect(renders).toBe(1) // one view, one drawing
    })
})
