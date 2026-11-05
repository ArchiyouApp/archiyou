/** The Styler: classes on shapes, rules in paper millimeters, one stylesheet per drawing.
 *
 *  A shape says what it is (`addClass('wood')`), a drawing writes that as CSS classes next to
 *  what the line is in the drawing (`cut`, `hidden`, …), and the rules turn into a stylesheet
 *  at the drawing's scale, so a 0.5mm line is 0.5mm on paper at any scale.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Docs } from '../../../src/docs/Docs'
import { Styler, STYLER_DEFAULT_RULES, compileStylerRules } from '../../../src/docs/styler/Styler'
import { renderDrawing } from '../../../src/modeler/SVGExporter'
import { MaterialManager } from '../../../src/materials/MaterialManager'
import type { ArchiyouModules } from '../../../src/types'

async function setup(styler?:Styler)
{
    const modeler = new Modeler()
    await modeler.load()
    const annotator = new Annotator()
    const modules = { modeler, annotator, styler, materials: new MaterialManager() } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    annotator.setArchiyou(modules)
    return { modeler, modules }
}

const makeDocs = (modules:any) => new Docs(null, {
    runner: { getActiveScope: () => ({}) },
    calc: { metrics: () => ({}) },
    annotator: modules.annotator,
    modeler: modules.modeler,
    styler: modules.styler,
} as any)

/** The class lists of the paths of a drawing */
const pathClasses = (svg:string):Array<Array<string>> =>
    [...svg.matchAll(/<path\b[^>]*\sclass="([^"]*)"/g)].map(m => m[1].split(' '))

describe('Styler rules', () =>
{
    it('turns paper millimeters into model units at the scale of the drawing', () =>
    {
        const rules = [{ selector: '.cut', weight: 0.5, dash: [3, 2] }]
        expect(compileStylerRules(rules, '', 20)).toBe('.cut{stroke-width:10;stroke-dasharray:60 40}')
        expect(compileStylerRules(rules, '', 100)).toBe('.cut{stroke-width:50;stroke-dasharray:300 200}')
    })

    it('scopes every rule to its drawing', () =>
    {
        expect(compileStylerRules([{ selector: '.cut.wood', fill: '#eee' }], '.ay-p-v ', 1))
            .toBe('.ay-p-v .cut.wood{fill:#eee}')
    })

    it('changes a rule in place, so it keeps its place in the cascade', () =>
    {
        // `.line` comes before `.cut`: set later, it must not overrule the cut lines
        const styler = new Styler().set('.line', { weight: 0.18 }).set('.cut.wood', { fill: '#ddd' })
        const selectors = styler.rules().map(r => r.selector)
        expect(selectors.indexOf('.line')).toBeLessThan(selectors.indexOf('.cut'))
        expect(selectors.at(-1)).toBe('.cut.wood')
        expect(styler.get('.line')).toMatchObject({ weight: 0.18, color: '#000000' })
    })

    it('says what is wrong with a rule', () =>
    {
        expect(() => new Styler().set('cut', { weight: 0.5 })).toThrow(/selector/)
        expect(() => new Styler().set('.cut', { width: 0.5 } as any)).toThrow(/unknown "width"/)
        expect(() => new Styler().set('.cut', { dash: '3 2' } as any)).toThrow(/dash/)
    })

    it('draws a model colour only where a rule asks for it', () =>
    {
        const css = compileStylerRules([{ selector: '.cut', color: 'model' }], '', 1, ['ff0000'])
        expect(css).toBe('.cut.ay-c-ff0000{stroke:#ff0000}')
    })
})

describe('classes on shapes', () =>
{
    it('are a set that adds up from layers to shapes', async () =>
    {
        const { modeler } = await setup()
        const box = (modeler.box(100) as any).addClass('wall', 'wood').addClass('wood')
        expect(box.classes()).toEqual(['wall', 'wood'])
        expect(() => box.addClass('1st')).toThrow(/not a valid class name/)
    })

    it('travel to a section and are written on its line work, next to what it is in the drawing', async () =>
    {
        const { modeler } = await setup()
        const stud = (modeler.box(38, 184, 2400) as any).addClass('timber')
        const section = stud.section([0, 0, 1000])

        const classes = pathClasses(renderDrawing(section) as string)
        const cut = classes.find(c => c.includes('cut'))
        expect(cut).toEqual(expect.arrayContaining(['line', 'cut', 'timber']))
    })

    it('come with a material: its name and its group', async () =>
    {
        const { modeler } = await setup()
        const board = (modeler.box(100) as any).material('osb')
        expect(board.classes()).toEqual(expect.arrayContaining(['osb', 'wood']))
        board.material('steel')
        expect(board.classes()).not.toContain('osb')
    })
})

describe('a drawing in a document', () =>
{
    it('is drawn by the styler, and a view can add its own rules', async () =>
    {
        const styler = new Styler().set('.cut.timber', { weight: 0.7 })
        const { modeler, modules } = await setup(styler)
        const section = (modeler.box(38, 184, 2400) as any).addClass('timber').section([0, 0, 1000])

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('plan', { scale: '1:10' }).shapes(section).style({ '.hidden': { visible: false } })
        const svg = await doc.toSVG() as string

        expect(svg).toMatch(/\.ay-p-plan \.cut\.timber\{stroke-width:7\}/)       // 0.7mm at 1:10
        expect(svg).toMatch(/\.ay-p-plan \.cut\{fill:#ffffff;stroke-width:5\}/)  // the default cut
        expect(svg).toMatch(/\.ay-p-plan \.hidden\{[^}]*display:none\}/)
    })

    it('draws in the ink of the styler, not the colours of the model', async () =>
    {
        const { modeler, modules } = await setup()
        const front = (modeler.box(1000, 200, 500) as any).color('red').elevation('front')

        const doc = makeDocs(modules)
        doc.create('d').page('p').view('front', { scale: '1:20' }).shapes(front)
        const svg = await doc.toSVG() as string

        expect(svg).toContain('ay-c-ff0000')            // the class is there, for a rule that wants it
        expect(svg).not.toMatch(/\{stroke:#ff0000\}/)   // but no rule draws it
        expect(svg).not.toMatch(/<path[^>]*\sstroke="/) // and no attribute either
    })

    it('keeps its line weight option: every line, the others refine it', async () =>
    {
        const { modeler, modules } = await setup()
        const doc = makeDocs(modules)
        doc.create('d').page('p').view('front', { scale: '1:10', lineWeight: 0.35 })
            .shapes((modeler.box(100) as any).elevation('front'))
        const svg = await doc.toSVG() as string

        expect(svg).toMatch(/\.ay-p-front \.line\{[^}]*stroke-width:3\.5;/)
        expect(svg).toMatch(/\.ay-p-front \.cut\{fill:#ffffff;stroke-width:5\}/)
    })

    it('is drawn by the default rules without a styler', () =>
    {
        expect(STYLER_DEFAULT_RULES.map(r => r.selector)).toEqual(['.line', '.silhouette', '.hidden', '.dashed', '.cut', '.fill'])
    })
})
