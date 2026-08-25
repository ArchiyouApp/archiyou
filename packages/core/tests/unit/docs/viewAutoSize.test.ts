/** A view can size itself to what it holds.
 *
 *  With a scale set, the size of a drawing on the page is not a matter of taste: the geometry
 *  spans so many model units, the scale says how many go in a millimeter, and the annotations
 *  and any caption band add their room. Before this, a script had to guess that number as a
 *  fraction of the page — and a wrong guess clipped the drawing.
 */
import { describe, expect, it, vi } from 'vitest'

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
    return { modeler, annotator, modules }
}

const makeDocs = (modules:any) => new Docs(null, {
    runner: { getActiveScope: () => ({}) },
    calc: { metrics: () => ({}) },
    annotator: modules.annotator,
    modeler: modules.modeler,
} as any)

/** The view of a doc built by `build`, after rendering. */
async function viewOf(modules:any, build:(doc:any) => void)
{
    const doc = makeDocs(modules)
    build(doc)
    await doc.toSVG()
    const view = (doc.getDoc('d') as any)._pages[0]._containers.find((c:any) => c._type === 'view')
    return { view, sizeMm: view._sizeMm() as [number, number], scale: view._resolvedScale }
}

describe('width/height auto', () =>
{
    it('sizes a scaled view to its drawing: 1000mm at 1:10 is 100mm of paper', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 500)) as any

        const { sizeMm, scale } = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v', { scale: 1/10 })
                .shapes(shapes).width('auto').height('auto'))

        expect(scale.label).toBe('1:10')
        expect(sizeMm[0]).toBeCloseTo(100, 1)   // no annotations, so no margin
        expect(sizeMm[1]).toBeCloseTo(50, 1)
        expect(scale.fits).toBe(true)
    })

    it('leaves room for the dimensions and the caption band', async () =>
    {
        const { modeler, modules } = await setup()
        const r = modeler.rect(1000, 500) as any
        r.bbox().back().dim()
        const shapes = modeler.collection(r) as any

        const bare = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v', { scale: 1/10 })
                .shapes(modeler.collection(modeler.rect(1000, 500))).width('auto').height('auto'))

        const dressed = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v', { scale: 1/10, caption: true })
                .shapes(shapes).width('auto').height('auto'))

        // wider (the dimension hangs off the top, and its text needs margin) and taller still
        // (that margin, plus the caption band)
        expect(dressed.sizeMm[0]).toBeGreaterThan(bare.sizeMm[0])
        expect(dressed.sizeMm[1]).toBeGreaterThan(bare.sizeMm[1])
        expect(dressed.scale.fits).toBe(true)
    })

    it('stops a fixed scale from being clipped, which is the point', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(2000, 1500)) as any
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // 1:10 needs 200x150mm; a tenth of the page is nowhere near it
        const guessed = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v', { scale: 1/10 })
                .shapes(shapes).width(0.2).height(0.2))
        expect(guessed.scale.fits).toBe(false)
        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('clipped')

        warn.mockClear()
        const sized = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v', { scale: 1/10 })
                .shapes(shapes).width('auto').height('auto'))

        expect(sized.sizeMm[0]).toBeCloseTo(200, 1)
        expect(sized.sizeMm[1]).toBeCloseTo(150, 1)
        expect(sized.scale.fits).toBe(true)
        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).not.toContain('clipped')
        warn.mockRestore()
    })

    it('takes the other side from the drawing when there is no scale', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 250)) as any   // 4:1

        const { sizeMm } = await viewOf(modules, doc =>
            doc.create('d').page('p').view('v')
                .shapes(shapes).width(0.4).height('auto'))

        // a fitted drawing has no size of its own, but it has a shape: 4:1
        expect(sizeMm[0] / sizeMm[1]).toBeCloseTo(4, 1)
    })

    it('says so when both sides are auto and there is no scale to go on', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 250)) as any
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await viewOf(modules, doc =>
            doc.create('d').page('p').view('v').shapes(shapes).width('auto').height('auto'))

        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('no scale to size itself by')
        warn.mockRestore()
    })

    it('warns on a container that cannot measure itself', async () =>
    {
        const { modules } = await setup()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const doc = makeDocs(modules)
        doc.create('d').page('p').text('Cut list').width('auto')
        await doc.toSVG()

        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('cannot size itself')
        warn.mockRestore()
    })
})
