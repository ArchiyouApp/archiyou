import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { collectAnnotations } from '../../../src/annotator/annotationLayer'
import type { ArchiyouModules } from '../../../src/types'

/**
 * Dimensions must follow their geometry when it is REGROUPED.
 *
 * A dimension links itself to the collection it measured, not to that collection's member
 * Shapes. group()/collection() re-parent the Shapes into a new collection and leave the
 * annotations behind on the old one, so the doc-pipeline idiom
 *
 *     topView.autoDim(...);  elevations = group(topView, frameView)
 *     ... .view('parts').shapes('elevations')
 *
 * drew every dimension when the view was handed `topView` and NONE when it was handed
 * `elevations` — the case this file pins.
 */
describe('Annotations on regrouped collections', () =>
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

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    /** A dimensioned footprint, as a doc pipeline makes one. */
    const dimensionedFootprint = (x: number) =>
    {
        const col = modeler.collection(modeler.box(100, 50, 10), modeler.box(20, 50, 10).move(200))
                        .flatten('z').move(x)
        col.bbox().back().dim({ offset: 20 })
        return col
    }

    it('finds dimensions through the group the shapes were moved into', () =>
    {
        const top = dimensionedFootprint(0)
        const frame = dimensionedFootprint(1000)
        expect(collectAnnotations(top).length).toBe(1)

        const elevations = modeler.group(top, frame)

        expect(collectAnnotations(elevations).length).toBe(2)
    })

    it('does not hand a partial view the dimensions of the whole', () =>
    {
        // One beam of a dimensioned frame is not the frame: a measurement that runs off the
        // edge of what is drawn is worse than none.
        const top = dimensionedFootprint(0)
        const onePart = modeler.collection(top.shapes()[0])

        expect(collectAnnotations(onePart).length).toBe(0)
    })

    it('draws them in the SVG the view assembles', () =>
    {
        const elevations = modeler.group(dimensionedFootprint(0), dimensionedFootprint(1000))

        const svg = (elevations as any).toSVG() as string
        // Two dimension lines, each with its value text.
        expect(svg.match(/class="dimensionline"/g)?.length).toBe(2)
    })

    it('still collects a dimension linked straight to a Shape', () =>
    {
        // The route that always worked — the two-sided link on the Shape itself — must keep
        // reporting every dimension exactly once, not twice now that a second route exists.
        const box = modeler.box(100, 50, 10).flatten('z')
        box.dim({ offset: 20 })

        const made = annotator.getAnnotations().length
        expect(made).toBeGreaterThan(0)
        expect(collectAnnotations(modeler.collection(box)).length).toBe(made)
    })
})
