/** What a drawing carries besides its geometry: a caption and a graduated scale bar.
 *
 *  Both are opt-in — setting a scale on its own must never change what an existing drawing
 *  looks like — and both are drawn in page millimeters, in a band reserved at the bottom of
 *  the view, so nothing overlaps and the PDF gets them for free.
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

/** One page with a single half-size view of `shapes`, built with the options object. */
async function page(modules:any, shapes:any, options?:any, name = 'elevation'):Promise<string>
{
    const doc = makeDocs(modules)
    doc.create('d').page('p').view(name, options).shapes(shapes).width(0.5).height(0.5)
    return await doc.toSVG() as string
}

/** The drawing's own <svg> inside a view — the inner one when there is a furniture band. */
function drawingBox(pageSvg:string):{ wMm:number, hMm:number }
{
    const all = [...pageSvg.matchAll(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)"(?:\s+viewBox="([^"]+)")?[^>]*>/g)]
    // the drawing is the one that shows model space (it has a viewBox that is not the page-mm box)
    const drawing = all.find(m => m[3] && m[3] !== `0 0 ${m[1]} ${m[2]}`) ?? all[0]
    return { wMm: Number(drawing[1]), hMm: Number(drawing[2]) }
}

describe('view furniture', () =>
{
    it('draws nothing at all unless asked — a scale alone is not a caption', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const withScale = await page(modules, shapes, { scale: 1/100 })

        expect(withScale).not.toContain('view-caption')
        expect(withScale).not.toContain('view-furniture')
        // and the markup is what a view has always emitted: one <svg>, no nesting
        expect((withScale.match(/<svg x="0" y="0"/g) ?? []).length).toBe(1)
    })

    it('captions with the view name and the scale it was drawn at', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await page(modules, shapes, { scale: 1/100, caption: true })

        expect(svg).toContain('view-caption')
        expect(svg).toMatch(/>elevation — 1:100</)
    })

    it('takes a caption of its own, and leaves the scale off a fitted drawing', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const named = await page(modules, shapes, { scale: 1/100, caption: 'North elevation' })
        expect(named).toMatch(/>North elevation — 1:100</)

        // fitted: no scale worth printing, so just the text
        const fitted = await page(modules, shapes, { caption: 'North elevation' })
        expect(fitted).toMatch(/>North elevation</)
        expect(fitted).not.toMatch(/North elevation — 1:/)
    })

    it('reserves its band: the drawing gets less height, not an overlap', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const bare = drawingBox(await page(modules, shapes, { scale: 1/100 }))
        const withFurniture = drawingBox(await page(modules, shapes, { scale: 1/100, caption: true, bar: true }))

        expect(withFurniture.wMm).toBeCloseTo(bare.wMm, 4)
        expect(withFurniture.hMm).toBeLessThan(bare.hMm)
    })

    it('draws a graduated bar of a round model length, labelled in real units', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(2000, 800)) as any

        const svg = await page(modules, shapes, { scale: 1/20, bar: true })

        // alternating segments: 4 by default
        const segments = svg.match(/<rect[^>]*class=|<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="(black|white)"/g) ?? []
        expect(segments.length).toBeGreaterThanOrEqual(4)

        // labelled 0 … a round length, in the model's own unit system
        expect(svg).toMatch(/>0</)
        expect(svg).toMatch(/view-bar-label/)
    })

    it('sizes the bar so it is a round number, not a round number of millimeters', async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('mm')
        const shapes = modeler.collection(modeler.rect(4000, 1000)) as any

        const svg = await page(modules, shapes, { scale: 1/50, bar: true })
        const labels = [...svg.matchAll(/class="view-bar-label"[^>]*>([^<]+)</g)].map(m => m[1])

        // one end is 0, the other a 1/2/5 x 10^n length
        expect(labels[0]).toBe('0')
        expect(labels[1]).toMatch(/^(1|2|5)(\.0+)?\s*(mm|cm|m)$/)
    })

    it('every text carries both baselines, or the PDF puts it in the wrong place', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await page(modules, shapes, { scale: 1/100, caption: true, bar: true })

        for(const text of svg.match(/<text class="view-(caption|bar-label)"[^>]*>/g) ?? [])
        {
            // browsers read dominant-baseline, svg2pdf reads alignment-baseline
            expect(text).toContain('dominant-baseline=')
            expect(text).toContain('alignment-baseline=')
        }
    })

    it('falls back to fitting when asked to, instead of clipping', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(4000, 1000)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p')
            .view('v', { scale: 1/2, overflow: 'fit' }).shapes(shapes).width(0.5).height(0.5)
        const data:any = (await doc.toData('d') as any)['d']
        const view = data.pages[0].containers.find((c:any) => c.type === 'view')

        expect(view.resolvedScale.fitted).toBe(true)
        expect(view.resolvedScale.fits).toBe(true)
    })

    it('nests cleanly, so svg2pdf can paint it', async () =>
    {
        /*  The band means a view emits a nested <svg>: the outer one is the view's box in page
            millimeters (where the furniture lives), the inner one the drawing. A nested <svg>
            also clips to its own bounds in browsers and in svg2pdf alike, which is what keeps
            a drawing at too large a scale inside its frame. Malformed nesting is the one thing
            that would show up only at PDF time, so check it here. */
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const svg = await page(modules, shapes, { scale: 1/100, caption: true, bar: true })

        expect((svg.match(/<svg/g) ?? []).length).toBe((svg.match(/<\/svg>/g) ?? []).length)

        // the drawing sits INSIDE the view's page-mm box, not beside it: the outer <svg> is
        // the one whose viewBox IS its own mm size (page-mm space)
        const outerMatch = svg.match(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 \1 \2">/)
        expect(outerMatch).not.toBeNull()

        const outer = outerMatch!.index!
        const inner = svg.indexOf('<svg x="0" y="0"', outer + 1)
        const furniture = svg.indexOf('view-furniture')

        expect(inner).toBeGreaterThan(outer)                          // drawing nested inside
        expect(furniture).toBeGreaterThan(inner)                      // furniture after it
        expect(svg.indexOf('</svg>', inner)).toBeLessThan(furniture)  // and the drawing is closed first
    })

    it('accepts options before or after the shapes', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1000, 400)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p')
            .view('a', shapes, { scale: 1/100, caption: true }).width(0.4).height(0.4)
            .view('b', { scale: 1/200, caption: true }).shapes(shapes).width(0.4).height(0.4).position(1, 0).pivot(1, 0)

        const svg = await doc.toSVG() as string
        expect(svg).toMatch(/>a — 1:100</)
        expect(svg).toMatch(/>b — 1:200</)
    })
})

describe('fonts reach the PDF', () =>
{
    it('every text names a font family, or svg2pdf draws it in Times', async () =>
    {
        /*  svg2pdf starts each run with `attributeState.fontFamily = 'times'` and falls back
            to 'times' for any family jsPDF does not have registered. A <text> with no
            font-family therefore comes out of the PDF in Times New Roman while the rest of
            the document is in Outfit — which is exactly what the dimension labels did: every
            emitter in docs/ set the family, the annotator's did not. */
        const { modeler, modules } = await setup()
        const r = modeler.rect(1000, 400) as any
        r.bbox().back().dim()

        const doc = makeDocs(modules)
        doc.create('d').page('p')
            .view('v', { scale: 1/20, caption: true, bar: true }).shapes(r).width(0.5).height(0.5)
            .text('Some doc text')

        const svg = await doc.toSVG() as string

        const texts = svg.match(/<text[^>]*>/g) ?? []
        expect(texts.length).toBeGreaterThan(3)   // dimension, caption, bar labels, doc text
        for(const text of texts)
        {
            expect(text).toMatch(/font-family="[^"]+"/)
        }
    })
})

describe('caption() on a container', () =>
{
    const captionsOf = (svg:string) =>
        [...svg.matchAll(/class="view-caption"[^>]*>([^<]*)</g)].map(m => m[1])

    it('lets a view caption itself, with no argument at all', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1200, 600)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('elevation', { scale: 1/20 })
            .shapes(shapes).width(0.5).height(0.5).caption()

        // a view knows what it is: its name, and the scale it came out at
        expect(captionsOf(await doc.toSVG() as string)).toEqual(['elevation — 1:20'])
    })

    it('takes a string or the full options object', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1200, 600)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p')
            .view('plan', { scale: 1/20 }).shapes(shapes).width(0.3).height(0.3)
                .caption('Ground floor')
            .view('detail', { scale: 1/10 }).shapes(shapes).width(0.3).height(0.3)
                .position(1, 0).pivot(1, 0)
                .caption({ text: 'Corner', format: '{name} @ {scale}', align: 'left' })

        expect(captionsOf(await doc.toSVG() as string))
            .toEqual(['Ground floor — 1:20', 'Corner @ 1:10'])
    })

    it('leaves the scale off a fitted view, which has none worth printing', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1200, 600)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('sketch').shapes(shapes).width(0.5).height(0.5).caption()

        expect(captionsOf(await doc.toSVG() as string)).toEqual(['sketch'])
    })

    it('turns one off again', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(1200, 600)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('v', { scale: 1/20, caption: true })
            .shapes(shapes).width(0.5).height(0.5).caption(false)

        expect(captionsOf(await doc.toSVG() as string)).toEqual([])
    })

    it('asks any other container for a string, rather than throwing', async () =>
    {
        const { modules } = await setup()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const doc = makeDocs(modules)
        doc.create('d').page('p').rect(40).caption()   // a graphic cannot caption itself

        const said = warn.mock.calls.map(c => String(c[0])).join('\n')
        expect(said).toContain('needs a string')
        expect(said).toContain('graphic')
        warn.mockRestore()
    })
})

describe('furniture aligns to the drawing, not the container', () =>
{
    /** The caption's x, and where the geometry actually spans, both in page mm. */
    function measure(pageSvg:string)
    {
        const view = pageSvg.match(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)" viewBox="0 0 \1 \2">([\s\S]*?)<g class="view-furniture">([\s\S]*?)<\/g><\/svg>/)!
        const wMm = Number(view[1])
        const inner = view[3].match(/<svg x="0" y="0" width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"[^>]*preserveAspectRatio="([^"]+)"/)!
        const vb = inner[3].split(' ').map(Number)
        const scale = Math.min(Number(inner[1])/vb[2], Number(inner[2])/vb[3])
        const par = inner[4]
        const slack = par.startsWith('xMid') ? (wMm - vb[2]*scale)/2
                    : par.startsWith('xMax') ? (wMm - vb[2]*scale) : 0

        const xs = [...view[3].matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map(p => Number(p[1]))
        const toMm = (x:number) => slack + (x - vb[0]) * scale

        return {
            wMm,
            captionX: Number(view[4].match(/class="view-caption" x="([-\d.]+)"/)![1]),
            geometryCentreMm: toMm((Math.min(...xs) + Math.max(...xs)) / 2),
        }
    }

    it('centres the caption under the geometry, not under the view box', async () =>
    {
        /*  A small drawing at a large scale leaves slack: the view frames its whole box and
            anchors the geometry in a corner of it, so the box centre is nowhere near the
            drawing. The caption follows the drawing. */
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(300, 200)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('v', { scale: 1/2, caption: true })
            .shapes(shapes).width(1).height(0.45)

        const { captionX, geometryCentreMm, wMm } = measure(await doc.toSVG() as string)

        expect(captionX).toBeCloseTo(geometryCentreMm, 1)
        expect(Math.abs(captionX - wMm/2)).toBeGreaterThan(10)  // and it is NOT the box centre
    })

    it('still lands on the box centre when the drawing is centred in it', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(300, 200)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('v', { scale: 1/2, caption: true })
            .shapes(shapes).width(1).height(0.45).contentAlign('center', 'center')

        const { captionX, geometryCentreMm, wMm } = measure(await doc.toSVG() as string)

        expect(captionX).toBeCloseTo(geometryCentreMm, 1)
        expect(captionX).toBeCloseTo(wMm/2, 1)
    })

    it('measures a fitted view too, where the letterboxing decides the slack', async () =>
    {
        // a wide drawing in a tall view: fitted on width, so there is slack top and bottom,
        // and the x slack comes from the emitted preserveAspectRatio
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(300, 60)) as any

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('v', { caption: true })
            .shapes(shapes).width(0.4).height(0.8)

        const { captionX, geometryCentreMm } = measure(await doc.toSVG() as string)
        expect(captionX).toBeCloseTo(geometryCentreMm, 1)
    })
})
