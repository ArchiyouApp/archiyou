/** A document writes model values in the system of the model's units(): mm, cm or m make
 *  it metric (written in mm), inch or feet imperial. Only the run's system for documents
 *  (request.docUnitSystem, the editor's document tool) overrides it; the run's display
 *  system (request.unitSystem) does not reach documents.
 *
 *  Dimension numbers, the scale in a caption and the scale bar all follow it.
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
    return { modeler, annotator, modules }
}

const makeDocs = (modules?:any) => new Docs(null, {
    runner: { getActiveScope: () => ({}) },
    calc: { metrics: () => ({}) },
    annotator: modules?.annotator,
    modeler: modules?.modeler,
} as any)

/** SVG text as a reader sees it: quotes and apostrophes unescaped */
const readable = (svg:string) => svg.replace(/&quot;/g, '"').replace(/&apos;/g, "'")

/** The values written on the dimension lines */
const dimensionTexts = (svg:string) =>
    [...readable(svg).matchAll(/dimension-label"[\s\S]*?<text[^>]*>([^<]+)</g)].map(m => m[1])

describe('Document unit system', () =>
{
    /** Docs as the run sets them up for request.docUnitSystem */
    const docsIn = (modules:any, system:'metric'|'imperial') =>
    {
        const docs = makeDocs(modules)
        docs._runUnitSystem = system
        return docs
    }

    it('is metric, on A4 in mm, for a model in millimeters', () =>
    {
        const doc = makeDocs().create('d')

        expect(doc.resolveUnitSystem()).toBe('metric')
        expect(doc._units).toBe('mm')
        expect(doc._pageSize).toBe('A4')
    })

    it("follows the model's units(): inch or feet make it imperial, on Letter in inches", async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('feet')

        const doc = makeDocs(modules).create('d')

        expect(doc.resolveUnitSystem()).toBe('imperial')
        expect(doc._units).toBe('inch')
        expect(doc._pageSize).toBe('Letter')
    })

    it('still takes the paper the script asks for', async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('inch')

        const doc = makeDocs(modules).create('d').pageSize('Tabloid').units('mm')
        const page = doc.page('p')._activePage

        expect(page._units).toBe('mm')
        expect(page._width).toBeCloseTo(431.8, 1) // 17 in, landscape
    })

    it("is not changed by the run's display system", async () =>
    {
        const { modeler, modules } = await setup()
        modeler.unitSystem('imperial')

        expect(makeDocs(modules).create('d').resolveUnitSystem()).toBe('metric')
    })

    it("takes the run's system for documents over the model's, without moving the paper", async () =>
    {
        const { modules } = await setup()

        const docs = docsIn(modules, 'imperial')
        const doc = docs.create('a')
        expect(doc.resolveUnitSystem()).toBe('imperial')
        expect(doc._units).toBe('mm')
        expect(doc._pageSize).toBe('A4')

        docs.reset()
        expect(docs.create('b').resolveUnitSystem()).toBe('metric')
    })

    it('writes the scale in a caption the imperial way', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(3000, 1000)) as any

        const docs = docsIn(modules, 'imperial')
        docs.create('d')
            .page('p').view('elevation', { scale: 1/48, caption: true }).shapes(shapes).width(0.5).height(0.5)

        expect(readable(await docs.toSVG() as string)).toContain(`elevation — 1/4" = 1'-0"`)
    })

    it('labels the scale bar in feet and inches', async () =>
    {
        const { modeler, modules } = await setup()
        const shapes = modeler.collection(modeler.rect(3000, 1000)) as any

        const docs = docsIn(modules, 'imperial')
        docs.create('d')
            .page('p').view('elevation', { scale: 1/48, bar: true }).shapes(shapes).width(0.5).height(0.5)

        const labels = [...readable(await docs.toSVG() as string).matchAll(/class="view-bar-label"[^>]*>([^<]+)</g)].map(m => m[1])
        expect(labels.at(-1)).toMatch(/["']$/)
    })

    it('writes the dimensions of its views in the run\'s system for documents', async () =>
    {
        const { modeler, modules } = await setup()
        const r = modeler.rect(3000, 1000) as any
        r.autoDim({ offset: 100 })

        const metricDocs = makeDocs(modules)
        metricDocs.create('metric').page('p').view('v').shapes(r).width(0.5).height(0.5)
        const metric = dimensionTexts(await metricDocs.toSVG() as string)

        const imperialDocs = docsIn(modules, 'imperial')
        imperialDocs.create('imperial').page('p').view('v').shapes(r).width(0.5).height(0.5)
        const imperial = dimensionTexts(await imperialDocs.toSVG() as string)

        expect(metric).toContain('3000')
        expect(imperial).toContain(`9'-10 1/8"`)
        expect(imperial).toContain(`39 3/8"`)
    })

    it('writes the dimensions of a model in inches imperial without being asked', async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('inch')
        const r = modeler.rect(120, 40) as any
        r.autoDim({ offset: 4 })

        const docs = makeDocs(modules)
        docs.create('d').page('p').view('v').shapes(r).width(0.5).height(0.5)
        const texts = dimensionTexts(await docs.toSVG() as string)

        expect(texts).toContain(`10'-0"`)
        expect(texts).toContain(`40"`)
    })

    it('writes the dimensions of a metric model in mm, whatever unit it is built in', async () =>
    {
        const { modeler, modules } = await setup()
        modeler.units('m')
        const r = modeler.rect(3, 1) as any
        r.autoDim({ offset: 0.1 })

        const docs = makeDocs(modules)
        docs.create('d').page('p').view('v').shapes(r).width(0.5).height(0.5)
        const texts = dimensionTexts(await docs.toSVG() as string)

        expect(texts).toContain('3000')
        expect(texts).toContain('1000')
    })

    it('keeps the system of a merged document on the pages it brought', async () =>
    {
        const main = await setup()
        const part = await setup()
        part.modeler.units('inch')

        const component = makeDocs(part.modules).create('component')
        component.page('detail').view('detail', { scale: 1/48, caption: true })
            .shapes(part.modeler.collection(part.modeler.rect(120, 40)) as any).width(0.5).height(0.5)

        const doc = makeDocs(main.modules).create('main')
        doc.page('overview').view('overview', { scale: 1/50, caption: true })
            .shapes(main.modeler.collection(main.modeler.rect(3000, 1000)) as any).width(0.5).height(0.5)
        doc.merge(component)

        const pages = (await doc.toSVGPages()).map(p => readable(p.svg))
        expect(pages).toHaveLength(2)
        expect(pages[0]).toContain('overview — 1:50')
        expect(pages[1]).toContain(`detail — 1/4" = 1'-0"`)
    })
})
