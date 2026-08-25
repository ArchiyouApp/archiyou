/** A view can be pinned to a real drawing scale.
 *
 *  Until now a view always fitted its drawing to whatever room it had, so the same elevation
 *  came out at a different scale in every view and no drawing could say "1:100". These tests
 *  measure what actually lands on the page: a model length, through the emitted viewBox, in
 *  page millimeters.
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

function makeDocs(modules:any)
{
    return new Docs(null, {
        runner: { getActiveScope: () => ({}) },
        calc: { metrics: () => ({}) },
        annotator: modules.annotator,
        modeler: modules.modeler,
    } as any)
}

/** Every view drawn into a page SVG: its size in mm and the model-space window it shows. */
function viewsOf(pageSvg:string):Array<{ wMm:number, hMm:number, vb:Array<number>, body:string }>
{
    const views = []
    for(const m of pageSvg.matchAll(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"[^>]*>/g))
    {
        views.push({
            wMm: Number(m[1]),
            hMm: Number(m[2]),
            vb: m[3].split(/\s+/).map(Number),
            body: pageSvg.slice(m.index! + m[0].length, pageSvg.indexOf('</svg>', m.index!)),
        })
    }
    return views
}

/** Page millimeters per model unit, as the view actually draws it. */
const mmPerUnit = (v:{ wMm:number, hMm:number, vb:Array<number> }) =>
    Math.min(v.wMm / v.vb[2], v.hMm / v.vb[3])   // preserveAspectRatio 'meet'

/** An A4-landscape page (297x210mm) with one half-width, half-height view of `shapes`. */
async function pageWith(modules:any, shapes:any, apply?:(doc:any) => void):Promise<string>
{
    const doc = makeDocs(modules)
    doc.create('sizes').page('main').view('v').shapes(shapes).width(0.5).height(0.5)
    apply?.(doc)
    return await doc.toSVG() as string
}

describe('view scale', () =>
{
    it('draws at exactly the scale it is given: 1000mm of model is 10mm of paper at 1:100', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await pageWith(modules, shapes, doc => doc.scale(1/100))
        const view = viewsOf(svg)[0]

        expect(1000 * mmPerUnit(view)).toBeCloseTo(10, 4)
        expect(400 * mmPerUnit(view)).toBeCloseTo(4, 4)
    })

    it('follows the model unit: 1:100 of metres is not 1:100 of millimetres', async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('m')
        const shapes = modeler.collection(modeler.rect(10, 4)) as any   // 10m x 4m

        const svg = await pageWith(modules, shapes, doc => doc.scale(1/100))
        const view = viewsOf(svg)[0]

        // 10m at 1:100 is 100mm on the page
        expect(10 * mmPerUnit(view)).toBeCloseTo(100, 3)
    })

    it("'auto' picks the largest standard scale that fits", async () =>
    {
        const { modeler, modules } = await setup()
        // half of a 297mm-wide page is 148.5mm; a 2000mm drawing fits at 1:20, not 1:10
        const shapes = modeler.collection(modeler.rect(2000, 800)) as any

        const svg = await pageWith(modules, shapes, doc => doc.scale('auto'))
        const view = viewsOf(svg)[0]

        expect(mmPerUnit(view)).toBeCloseTo(1/20, 6)
    })

    it('honours a scale too big for the view, clips it, and says so', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(2000, 800)) as any
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const svg = await pageWith(modules, shapes, doc => doc.scale(1/2))
        const view = viewsOf(svg)[0]

        // drawn at 1:2 regardless — the window shows only part of the drawing
        expect(mmPerUnit(view)).toBeCloseTo(1/2, 6)
        expect(view.vb[2]).toBeLessThan(2000)

        const said = warn.mock.calls.map(c => String(c[0])).join('\n')
        expect(said).toContain('1:2')
        expect(said).toContain('clipped')
        warn.mockRestore()
    })

    it('still fits by default', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await pageWith(modules, shapes)
        const view = viewsOf(svg)[0]

        // the drawing fills the view: its own extents are the window
        expect(view.vb[2]).toBeCloseTo(1000, 3)
        expect(mmPerUnit(view)).toBeCloseTo(view.wMm / 1000, 6)
    })

    it('reports what it drew, so a caption can say it', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('v').shapes(shapes).width(0.5).height(0.5).scale(1/100)
        // Docs.toData() keys by document name
        const data:any = (await doc.toData('d') as any)['d']

        const view = data.pages[0].containers.find((c:any) => c.type === 'view')
        expect(view.scale).toBe(1/100)                 // what was asked for
        expect(view.resolvedScale.label).toBe('1:100') // what came out
        expect(view.resolvedScale.fitted).toBe(false)
        expect(view.resolvedScale.fits).toBe(true)
    })

    it('zooms on top of the scale', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await pageWith(modules, shapes, doc => doc.scale(1/100).zoom(2))
        const view = viewsOf(svg)[0]

        expect(1000 * mmPerUnit(view)).toBeCloseTo(20, 4)  // twice 1:100
    })
})

describe('line weight on the page', () =>
{
    it('is the same millimeters in a small view and a large one, and they do not restyle each other', async () =>
    {
        const { modeler, modules } = await setup()
        const small = modeler.collection(modeler.rect(50, 30)) as any
        const large = modeler.collection(modeler.rect(12000, 6000)) as any

        const doc = makeDocs(modules)
        doc.create('two').page('p')
            .view('small').shapes(small).width(0.4).height(0.4).position(0, 1).pivot(0, 1)
            .view('large').shapes(large).width(0.4).height(0.4).position(1, 0).pivot(1, 0)

        const svg = await doc.toSVG() as string
        const views = viewsOf(svg)
        expect(views.length).toBe(2)

        for(const view of views)
        {
            const width = Number(view.body.match(/\.line\{[^}]*stroke-width:([\d.]+)/)![1])
            expect(width * mmPerUnit(view)).toBeCloseTo(0.25, 2)  // mm on paper
        }

        // Both stylesheets land in ONE document once the view's outer <svg> is stripped, so
        // an unscoped `.line` rule from one view would restyle the other — last one wins.
        expect(svg).toMatch(/\.ay-p-small \.line\{/)
        expect(svg).toMatch(/\.ay-p-large \.line\{/)
        // every .line rule in the page is scoped to one view — none applies document-wide
        const allLineRules = svg.match(/\.line\{/g) ?? []
        const scopedLineRules = svg.match(/\.ay-[a-z0-9-]+ \.line\{/g) ?? []
        expect(scopedLineRules.length).toBe(allLineRules.length)
    })
})

describe('annotations stay inside the frame', () =>
{
    /** The value text and arrowheads of every dimension in the first view, with the frame. */
    function annotationPositions(pageSvg:string)
    {
        const view = viewsOf(pageSvg)[0]
        const [vx, vy, vw, vh] = view.vb

        const texts = [...view.body.matchAll(/<text\s+class="annotation text"[\s\S]*?x="([-\d.]+)"\s*\n?\s*y="([-\d.]+)"/g)]
                        .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
        const arrows = [...view.body.matchAll(/translate\(([-\d.]+) ([-\d.]+)\)/g)]
                        .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
        const fontSize = Number(view.body.match(/class="annotation text"[\s\S]*?font-size="([\d.]+)"/)![1])

        return { frame: { minX: vx, minY: vy, maxX: vx + vw, maxY: vy + vh }, texts, arrows, fontSize, view }
    }

    it('leaves room for the labels and arrowheads at a fixed scale', async () =>
    {
        /*  A dimension line reports the box of the LINE. Its value text sits at the middle of
            that line and its arrowheads straddle the ends, so both stick out past it. A
            fitted view has always had that room; a view at a REQUESTED scale was framed flush
            against the drawing instead, and cut every label and arrowhead on the leading
            edges — the top one at exactly y = frame.minY, the left one at x = frame.minX. */
        const { modeler, annotator, modules } = await setup()
        const r = modeler.rect(400, 500) as any
        r.autoDim({ offset: 10 })

        const { frame, texts, arrows, fontSize } = annotationPositions(
            await pageWith(modules, r, doc => doc.scale(1/20)))

        expect(texts.length).toBeGreaterThan(0)
        expect(arrows.length).toBeGreaterThan(0)

        // half a line of text has to fit past the anchor, and half an arrow glyph
        const textPad  = fontSize / 2
        const arrowPad = annotator.DIMENSION_ARROW_SIZE_MM * 20 / 2   // 20 units per mm at 1:20

        for(const t of texts)
        {
            expect(t.x - textPad).toBeGreaterThan(frame.minX)
            expect(t.x + textPad).toBeLessThan(frame.maxX)
            expect(t.y - textPad).toBeGreaterThan(frame.minY)
            expect(t.y + textPad).toBeLessThan(frame.maxY)
        }
        for(const a of arrows)
        {
            expect(a.x - arrowPad).toBeGreaterThan(frame.minX)
            expect(a.y - arrowPad).toBeGreaterThan(frame.minY)
        }
    })

    it('grows that room when the dimension text is made bigger', async () =>
    {
        const { modeler, annotator, modules } = await setup()
        const r = modeler.rect(400, 500) as any
        r.autoDim({ offset: 10 })

        const normal = annotationPositions(await pageWith(modules, r, doc => doc.scale(1/20)))

        annotator.DIMENSION_TEXT_SIZE_MM = 10   // from a script: annotator.DIMENSION_TEXT_SIZE_MM = 10
        const big = annotationPositions(await pageWith(modules, r, doc => doc.scale(1/20)))

        // same scale, same drawing — but more room around it, in step with the text
        expect(big.view.vb[2]).toBeCloseTo(normal.view.vb[2], 4)   // the window is the same size…
        expect(big.frame.minX).toBeLessThan(normal.frame.minX)     // …and sits further out
        expect(big.frame.minY).toBeLessThan(normal.frame.minY)

        for(const t of big.texts)
        {
            expect(t.x - big.fontSize/2).toBeGreaterThan(big.frame.minX)
            expect(t.y - big.fontSize/2).toBeGreaterThan(big.frame.minY)
        }
    })
})
