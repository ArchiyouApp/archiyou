/** A view keeps its dimension lines whichever way its Shapes were handed to it.
 *
 *  Sizing annotations for the page re-draws them at the view's scale, from the Shapes the
 *  view resolved. Those were only remembered on the pipeline-name path (`.shapes('view')`),
 *  so a view given a Shape reference directly — `.shapes(collection)`, the form most scripts
 *  and Docs.test.ts use — re-drew an EMPTY annotation block: every dimension silently
 *  disappeared from the page.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Docs } from '../../../src/docs/Docs'
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

/** A dimensioned drawing: a rect with a dimension line on two of its bbox sides */
function dimensionedShapes(modeler: Modeler, size = 400)
{
    const shapes = modeler.collection(modeler.rect(size, size * 0.8)) as any
    shapes.bbox().back().dim()
    shapes.bbox().left().dim()
    return shapes
}

function makeDocs(annotator: Annotator, scope: Record<string, any> = {})
{
    return new Docs(null, {
        runner: { getActiveScope: () => scope },
        calc: { metrics: () => ({}) },
        annotator,
    } as any)
}

const dimCount = (svg: string) => (svg.match(/class="dimensionline"/g) ?? []).length

describe('view annotations survive to the page', () =>
{
    it('keeps them when the view is given a ShapeCollection reference', async () =>
    {
        const { modeler, annotator } = await setup()
        const shapes = dimensionedShapes(modeler)

        const doc = makeDocs(annotator)
        doc.create('direct').page('main').view('v').shapes(shapes).width(0.5).height(0.5)

        const svg = await doc.toSVG() as string

        expect(annotator.getAnnotations().length).toBe(2)
        expect(dimCount(svg)).toBe(annotator.getAnnotations().length)
    })

    it('keeps them when the view names a pipeline variable', async () =>
    {
        const { modeler, annotator } = await setup()
        const shapes = dimensionedShapes(modeler)

        const doc = makeDocs(annotator)
        doc.create('named').pipeline(() => ({ view: shapes })).page('main')
            .view('v').shapes('view').width(0.5).height(0.5)

        const svg = await doc.toSVG() as string

        expect(dimCount(svg)).toBe(annotator.getAnnotations().length)
    })

    it('still resolves after the scope references are dropped (components)', async () =>
    {
        const { modeler, annotator } = await setup()
        const shapes = dimensionedShapes(modeler)

        const doc = makeDocs(annotator)
        doc.create('component').page('main').view('v').shapes(shapes).width(0.5).height(0.5)

        // what Docs.toInternalData() does to a component's docs before they travel
        doc.getDoc('component').resolveScopeReferences()

        const svg = await doc.toSVG() as string
        expect(dimCount(svg)).toBe(annotator.getAnnotations().length)
    })
})
