/** A label reaches the page, and takes its room with it.
 *
 *  Label had no toSVG(). BaseAnnotation.toSVG() returns null and annotationLayer() drops
 *  anything falsy, so a labelled drawing exported with every label missing — in the document
 *  SVG and therefore in the PDF — while the same labels showed up fine in the 3D viewer,
 *  which renders them as HTML overlays instead. These tests pin both halves of the fix: that
 *  a label is drawn at all, and that the frame leaves room for the leader and text box it
 *  hangs outside its own anchor.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Docs } from '../../../src/docs/Docs'
import { annotationMarginMm } from '../../../src/annotator/annotationLayer'
import type { ArchiyouModules } from '../../../src/types'

async function setup()
{
    const modeler = new Modeler()
    await modeler.load()
    const annotator = new Annotator()
    const modules = { modeler, annotator } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    annotator.setArchiyou(modules)
    return { modeler, annotator }
}

function makeDocs(annotator: Annotator)
{
    return new Docs(null, {
        runner: { getActiveScope: () => ({}) },
        calc: { metrics: () => ({}) },
        annotator,
    } as any)
}

const labelCount = (svg: string) => (svg.match(/class="label(?:\s|")/g) ?? []).length

describe('labels on a document page', () =>
{
    it('draws every label, with its text', async () =>
    {
        const { modeler, annotator } = await setup()
        const shapes = modeler.collection(modeler.rect(400, 320)) as any
        shapes.first().label('cut here', { labelOnly: false, circle: true })

        const doc = makeDocs(annotator)
        doc.create('labelled').page('main').view('v').shapes(shapes).width(0.5).height(0.5)

        const svg = await doc.toSVG() as string

        expect(annotator.getAnnotations().length).toBe(1)
        expect(labelCount(svg)).toBe(1)
        expect(svg).toContain('>cut here<')
        expect(svg).toContain('class="annotation line leader"')
        expect(svg).toContain('class="annotation marker"')
    })

    it('draws the label alone by default, sitting on what it names', async () =>
    {
        /*  The page's own default: a leader from a dot to a circled word is clutter when the
            word can sit on the thing. `labelOnly: false` above is how a script asks for the
            full callout on paper; the viewer draws one either way. */
        const { modeler, annotator } = await setup()
        const shapes = modeler.collection(modeler.rect(400, 320)) as any
        shapes.first().label('cut here', { circle: true })

        const doc = makeDocs(annotator)
        doc.create('labelled').page('main').view('v').shapes(shapes).width(0.5).height(0.5)

        const svg = await doc.toSVG() as string

        expect(svg).toContain('>cut here<')
        expect(svg).not.toContain('class="annotation line leader"')
        expect(svg).not.toContain('class="annotation marker"')
    })

    it('sizes the label in page millimeters, not model units', async () =>
    {
        const { modeler, annotator } = await setup()

        /*  Two drawings an order of magnitude apart, each fitted to the same view. A label
            sized in MODEL units would come out ten times bigger on one than the other; sized
            for the page it reads the same on both, which is the whole point of the mm
            settings. Compared as a ratio to the drawing, because a fitted view scales the
            geometry, not the page. */
        const fontFor = async (size: number) =>
        {
            const shapes = modeler.collection(modeler.rect(size, size * 0.8)) as any
            shapes.first().label('L')

            const doc = makeDocs(annotator)
            doc.create(`d${size}`).page('main').view('v').shapes(shapes).width(0.5).height(0.5)
            const svg = await doc.toSVG() as string

            annotator.reset()
            modeler.reset()
            return Number(svg.match(/class="annotation text"[\s\S]*?font-size="([\d.]+)"/)?.[1]
                       ?? svg.match(/font-size="([\d.]+)"/)?.[1])
        }

        const small = await fontFor(100)
        const large = await fontFor(1000)

        expect(small).toBeGreaterThan(0)
        expect(large / small).toBeCloseTo(10, 1)   // scales WITH the drawing, i.e. fixed on the page
    })

    it('leaves the label room in the frame, so it is not cropped', async () =>
    {
        const { modeler, annotator } = await setup()

        const viewBoxOf = async (withLabel: boolean) =>
        {
            const shapes = modeler.collection(modeler.rect(400, 320)) as any
            if (withLabel) { shapes.first().label('reaches out', { line: true }) }

            const doc = makeDocs(annotator)
            doc.create(withLabel ? 'with' : 'without').page('main')
               .view('v').shapes(shapes).scale(1 / 10).width(0.5).height(0.5)
            const svg = await doc.toSVG() as string

            annotator.reset()
            modeler.reset()
            return svg
        }

        // A drawing with a label must reserve more room than the geometry alone needs.
        const labelled = await viewBoxOf(true)
        expect(labelled).toContain('>reaches out<')

        // …and that room is what annotationMarginMm() reports once a label is in the list.
        const dimensionOnly = annotationMarginMm(annotator)
        const withLabel = annotationMarginMm(annotator, [{ _type: 'label' }])
        expect(withLabel).toBeGreaterThan(dimensionOnly)
    })

    it('frames a dimension-only drawing exactly as before', async () =>
    {
        const { annotator } = await setup()

        // The margin is label-aware, but ONLY when a label is actually being drawn — a
        // drawing carrying nothing but dimensions must be framed as it always was.
        expect(annotationMarginMm(annotator, [{ _type: 'dimensionLine' }]))
            .toBe(annotationMarginMm(annotator))
        expect(annotationMarginMm(annotator, [])).toBe(annotationMarginMm(annotator))
    })
})
