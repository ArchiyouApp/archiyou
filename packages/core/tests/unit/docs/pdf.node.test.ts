/** PDF export in Node: svg2pdf.js needs a DOM, which in Node is jsdom. Its globals are only
 *  there while a PDF is rendered, so afterwards the process still knows it is not a browser.
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
    return { modeler, modules }
}

const makeDocs = (modules:any) => new Docs(null, {
    runner: { getActiveScope: () => ({}) },
    calc: { metrics: () => ({}) },
    annotator: modules.annotator,
    modeler: modules.modeler,
} as any)

/** The page boxes ([w h] in points) of a PDF */
function mediaBoxes(pdf:ArrayBuffer):Array<[number, number]>
{
    const text = Buffer.from(pdf).toString('latin1')
    return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
        .map(m => [Number(m[1]), Number(m[2])])
}

describe('PDF export in Node', () =>
{
    it('renders a scaled view with a caption to an A3 page', async () =>
    {
        const { modeler, modules } = await setup()
        const doc = makeDocs(modules)
        const front = (modeler.box(3000, 200, 2500) as any).elevation('front')
        doc.create('plan').page('main').size('A3').orientation('landscape')
            .view('front', { scale: '1:50', caption: true }).shapes(front).width(0.6).height(0.6)

        const pdf = await doc.toPDF('plan') as ArrayBuffer

        expect(pdf).toBeInstanceOf(ArrayBuffer)
        expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-')
        const [[w, h]] = mediaBoxes(pdf)
        expect(w).toBeCloseTo(420 / 25.4 * 72, 0)
        expect(h).toBeCloseTo(297 / 25.4 * 72, 0)
    }, 60000)

    it('applies the CSS of the drawing, as a browser does', async () =>
    {
        // The view's stylesheet draws lines black, over the red of the part. jsdom only parses
        // style sheets in a document with a window, so without care the PDF came out red.
        const { modeler, modules } = await setup()
        const doc = makeDocs(modules)
        const front = (modeler.box(1000, 200, 500) as any).color('red').elevation('front')
        doc.create('plan').page('main').view('front', { scale: '1:20' }).shapes(front)

        const pdf = Buffer.from(await doc.toPDF('plan') as ArrayBuffer).toString('latin1')

        const strokes = [...pdf.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) RG\n/g)].map(m => m.slice(1, 4).map(Number))
        expect(strokes.filter(([r, g, b]) => r > 0.5 && g < 0.5 && b < 0.5)).toEqual([])
        expect(pdf).toMatch(/\n0\.? G\n/) // black
    }, 60000)

    it('leaves no browser globals behind', async () =>
    {
        const { modeler, modules } = await setup()
        const doc = makeDocs(modules)
        doc.create('plan').page('main').view('top').shapes((modeler.box(100, 100, 100) as any).elevation('top'))

        await doc.toPDF('plan')

        expect(typeof (globalThis as any).window).toBe('undefined')
        expect(typeof (globalThis as any).document).toBe('undefined')
        expect(typeof (globalThis as any).CSSStyleSheet).toBe('undefined')
    }, 60000)
})
