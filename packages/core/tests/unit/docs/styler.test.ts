/** The Styler: classes on shapes, rules in paper millimeters, one stylesheet per drawing.
 *
 *  A shape says what it is (`addClass('wood')`), a drawing writes that as CSS classes next to
 *  what the line is in the drawing (`cut`, `hidden`, …), and the rules turn into a stylesheet
 *  at the drawing's scale, so a 0.5mm line is 0.5mm on paper at any scale.
 */
import { describe, expect, it, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Docs } from '../../../src/docs/Docs'
import { Styler, STYLER_DEFAULT_RULES, compileStylerRules, resolveStylerRule, stylerPaintOrder, stylerHatchDefs } from '../../../src/docs/styler/Styler'
import { buildSVGDocument, renderDrawing } from '../../../src/modeler/SVGExporter'
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

    it('takes classes with or without the dot of CSS', () =>
    {
        const styler = new Styler().set('cut.wood', { fill: '#ddd' }).set({ hidden: { visible: false } })
        expect(styler.get('.cut.wood')).toMatchObject({ selector: '.cut.wood', fill: '#ddd' })
        expect(styler.get('hidden')).toMatchObject({ selector: '.hidden', visible: false, dash: [3, 2] })
        styler.set('.cut.wood', { weight: 0.7 })
        expect(styler.rules().filter(r => r.selector === '.cut.wood')).toHaveLength(1) // the same rule
    })

    it('paints lines before fills, and thin before heavy, so the heavier line ends on top whole', () =>
    {
        // a cut stud drawn first lost half its line to the fill of the thinner insulation next to it
        const rules = new Styler().set('cut.insulation', { weight: 0.1 }).set('cut.stud', { weight: 0.7 }).rules()
        const el = (classes:string) => `<path d="M0 0" class="${classes}"/>`
        const drawn = [el('line cut stud'), el('line cut insulation'), el('line visible outline'), el('line visible')]
        expect(stylerPaintOrder(drawn, rules)).toEqual([
            el('line visible'),          // 0.25, no fill
            el('line visible outline'),  // 0.35, no fill
            el('line cut insulation'),   // filled, 0.1
            el('line cut stud'),         // filled, 0.7: on top
        ])
        expect(resolveStylerRule(rules, ['line', 'cut', 'stud'])).toMatchObject({ weight: 0.7, fill: '#ffffff', color: '#000000' })
    })

    it('says what is wrong with a rule', () =>
    {
        expect(() => new Styler().set('cut wood', { weight: 0.5 })).toThrow(/selector/)
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

    it('leaves room for half the heaviest line, so the frame does not cut the outer lines', () =>
    {
        // anchored flush to the frame, the top and left lines lost the half of them outside it
        const svg = buildSVGDocument({
            layers: [{ elements: ['<path d="M0 0 L100 0" class="line"/>'], box: { minX: 0, minY: -50, maxX: 100, maxY: 0 } }],
            stroke: { mode: 'mm', unitsPerMm: 10 },
            frame: { mode: 'scale', unitsPerMm: 10, wMm: 20, hMm: 10, align: ['left', 'top'] },
        }) as string
        const [x, y] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)
        // the heaviest default line is the cut, 0.5mm: 2.5 model units on each side at 1:10
        expect(x).toBeCloseTo(-2.5, 3)
        expect(y).toBeCloseTo(-52.5, 3)
    })

    it('warns about a rule on classes no line has, once, and names the classes there are', async () =>
    {
        // `section` is not a class of a section's lines (what it cuts is `cut`): that rule draws nothing
        const styler = new Styler().set('section', { color: 'red' }).set('cut.timber', { color: 'red' })
        const { modeler, modules } = await setup(styler)
        const section = (modeler.box(38, 184, 2400) as any).addClass('timber').section([0, 0, 1000])
        const doc = makeDocs(modules)
        doc.create('d').page('p').view('plan', { scale: '1:10' }).shapes(section).style({ 'cut.steel': { weight: 1 } })

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await doc.toSVG()
        await doc.toSVGPages() // a second output of the same run says nothing new
        const said = warn.mock.calls.map(c => String(c[0]))
        warn.mockRestore()

        const about = (s:string) => said.filter(m => m.includes(s))
        expect(about("styler.set('section')")).toHaveLength(1)
        expect(about("styler.set('section')")[0]).toMatch(/The classes there are: .*\bcut\b.*\btimber\b/)
        expect(about("'cut.timber'")).toHaveLength(0)                               // that one is there
        expect(about("View 'plan' style('cut.steel')")[0]).toContain("'cut' and 'steel' together")
    })

    it('hatches with patterns at the scale of the drawing, over the fill', () =>
    {
        const rules = new Styler().set('cut.insulation', { hatch: 'insulation' })
            .set('cut.steel', { hatch: { pattern: 'lines', angle: 30, spacing: 2, weight: 0.18, color: 'blue' } }).rules()
        const defs = stylerHatchDefs(rules, '.ay-p-v ', 10)
        // insulation: a zigzag of 3mm at 1:10 = 30 model units, on the white of the cut
        expect(defs).toMatch(/<pattern id="ay-p-v-hatch-\d+" patternUnits="userSpaceOnUse" width="30" height="30">/)
        expect(defs).toContain('<rect x="0" y="0" width="30" height="30" fill="#ffffff"/>')
        expect(defs).toContain('<polyline points="0,30 15,0 30,30"')
        // steel: lines 2mm apart = 20 units, turned 30 degrees counterclockwise on paper
        expect(defs).toMatch(/width="20" height="20" patternTransform="rotate\(-30\)"/)
        expect(defs).toContain('stroke="blue" stroke-width="1.8"')
        expect(compileStylerRules(rules, '.ay-p-v ', 10)).toMatch(/\.ay-p-v \.cut\.insulation\{fill:url\(#ay-p-v-hatch-\d+\)\}/)

        expect(() => new Styler().set('cut', { hatch: 'zebra' })).toThrow(/no hatch 'zebra'.*diagonal/)
    })

    it('keeps the hole of a cut: the rings of one part are one path, filled even-odd', async () =>
    {
        // a tube: without the hole, a fill or hatch would cover its inside too
        const { modeler, modules } = await setup()
        const tube = (modeler.box(100, 100, 300) as any).subtract((modeler.box(80, 80, 400) as any).tmp()).addClass('steel')
        const doc = makeDocs(modules)
        doc.create('d').page('p').view('plan', { scale: '1:5' }).shapes(tube.section([0, 0, 0]))
        const svg = await doc.toSVG() as string

        const cut = [...svg.matchAll(/<path d="([^"]*)" class="([^"]*\bcut\b[^"]*)" fill-rule="evenodd"\/>/g)]
        expect(cut).toHaveLength(1)
        expect((cut[0][1].match(/M/g) ?? []).length).toBe(2) // the outside and the hole, one path
    })

    it('is drawn by the default rules without a styler', () =>
    {
        expect(STYLER_DEFAULT_RULES.map(r => r.selector)).toEqual(['.line', '.outline', '.hidden', '.dashed', '.cut', '.fill'])
    })
})
