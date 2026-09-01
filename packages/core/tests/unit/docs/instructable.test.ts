/** Document.instructable(): an instructable's steps laid out over pages.
 *
 *  The composer is pure composition over existing containers — a view, some text — the same
 *  way titleblock() and labelblock() are built, because a Page has no flow layout of any kind
 *  (every container is absolutely positioned). So the grid and the page breaks are arithmetic,
 *  and these tests check the arithmetic reaches the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { Docs } from '../../../src/docs/Docs'
import type { ArchiyouModules } from '../../../src/types'

let modeler: Modeler
let docs: Docs

async function buildTable()
{
    modeler = new Modeler()
    await modeler.load()
    const calc = new Calc()
    docs = new Docs(null, {} as any)

    const modules = { modeler, calc, docs, runner: { getActiveScope: () => ({}) } } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    calc.setArchiyou(modules)
    docs.setArchiyou(modules)

    modeler.group('legs',
        ...[0, 1, 2, 3].map(i => modeler.box(44, 44, 700)
            .moveToX(i % 2 ? 1100 : 0).moveToY(i < 2 ? 500 : 0).name('leg')))
    modeler.group('frame',
        ...[0, 1].map(i => modeler.box(1180, 44, 60).moveToY(i * 500).moveToZ(600).name('rail')))
    modeler.group('top', modeler.box(1200, 600, 18).moveToZ(730).name('top panel'))
}

/** A manual with `count` steps. */
function manualWith(count: number)
{
    const manual = docs.instruct('assembly').parts({ print: false, table: false })
    const refs = ['A', 'B', 'C']
    for (let i = 0; i < count; i++)
    {
        manual.step(`Step ${i + 1}`)
            .shapes(...refs.slice(0, (i % 3) + 1))
            .subject(refs[i % 3])
    }
    return manual
}

beforeEach(async () => { await buildTable() })

describe('Document.instructable()', () =>
{
    it('places one view per step', async () =>
    {
        manualWith(3)
        const doc = docs.create('manual').page('steps').instructable('assembly')

        const views = doc._pages.flatMap(p => p._containers).filter(c => c._type === 'view')
        expect(views).toHaveLength(3)
        expect(views.map(v => v.name)).toEqual(['step1', 'step2', 'step3'])
    })

    it('draws the step number and title', async () =>
    {
        manualWith(1)
        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        expect(svg).toContain('>1<')
        expect(svg).toContain('>Step 1<')
    })

    it('actually draws geometry — the whole point of projecting first', async () =>
    {
        manualWith(1)
        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        /*  A view handed the 3D scene directly draws NOTHING: drawableLayer keeps only curves
            and faces flat on XY. This is what pins that instructable() projects first. */
        expect((svg.match(/class="line/g) ?? []).length).toBeGreaterThan(10)
    })

    it('draws the part labels the manual is written in', async () =>
    {
        /*  A step's prose says "fit B into A", so the reader has to be able to find B on the
            picture. Labels reached the viewer and never the page. */
        manualWith(2)
        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1])
        expect(texts).toContain('A')
        expect(texts).toContain('B')
        expect(svg).toContain('instruct-part-label')

        // circled letters sitting on the parts: no leaders, no anchor dots, on paper
        expect((svg.match(/<circle class="annotation text-background"/g) ?? []).length).toBe(2)
        expect(svg).not.toContain('class="annotation line leader"')
    })

    it('takes the label styling the manual asks for, through to the page', async () =>
    {
        manualWith(2)
        docs.getInstruct('assembly')!
            .labels('subject', { shape: 'rect', target: 'arrow', labelOnly: false })

        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        expect((svg.match(/class="annotation line leader"/g) ?? []).length).toBe(2)
        expect((svg.match(/class="annotation arrow/g) ?? []).length).toBe(2)
        expect(svg).not.toContain('<circle class="annotation text-background"')
    })

    it('lays a 2x2 grid out left-to-right, top-to-bottom', async () =>
    {
        manualWith(4)
        const doc = docs.create('manual').page('steps').instructable('assembly', { columns: 2, rows: 2 })

        const views = doc._pages[0]._containers.filter(c => c._type === 'view')
        const at = views.map(v => v._position as Array<number>)

        expect(at[0][0]).toBeLessThan(at[1][0])      // step 2 is right of step 1
        expect(at[2][1]).toBeLessThan(at[0][1])      // step 3 is below step 1
        expect(at[0][0]).toBeCloseTo(at[2][0], 6)    // and in the same column
    })

    it('opens a new page when the grid is full', async () =>
    {
        manualWith(5)
        const doc = docs.create('manual').page('steps').instructable('assembly', { columns: 2, rows: 2 })

        expect(doc._pages.map(p => p.name)).toEqual(['steps', 'assembly-2'])
        expect(doc._pages[0]._containers.filter(c => c._type === 'view')).toHaveLength(4)
        expect(doc._pages[1]._containers.filter(c => c._type === 'view')).toHaveLength(1)
    })

    it('fits more per page when asked for a denser grid', async () =>
    {
        manualWith(6)
        const doc = docs.create('manual').page('steps').instructable('assembly', { columns: 3, rows: 2 })

        expect(doc._pages).toHaveLength(1)
        expect(doc._pages[0]._containers.filter(c => c._type === 'view')).toHaveLength(6)
    })

    it('starts on the page that is already active, so a title block can go first', async () =>
    {
        manualWith(2)
        const doc = docs.create('manual').page('cover').text('My manual')
        doc.instructable('assembly', { columns: 2, rows: 2 })

        expect(doc._pages).toHaveLength(1)
        expect(doc._pages[0].name).toBe('cover')
    })

    it('draws the context parts back so the subject reads against them', async () =>
    {
        manualWith(3)
        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        // scoped to the view, so one step's styling cannot restyle another's drawing
        expect(svg).toMatch(/\.ay-steps-step\d+ \.instruct-context\{stroke:#b0b0b0\}/)
    })

    it('leaves the drawing uniform when asked to', async () =>
    {
        manualWith(1)
        const doc = docs.create('manual').page('steps')
            .instructable('assembly', { contextColor: null })
        const svg = await doc.toSVG() as string

        expect(svg).not.toContain('instruct-context{')
    })

    it('writes the note, tools and hardware under the drawing', async () =>
    {
        const manual = docs.instruct('assembly').parts({ print: false, table: false })
        manual.step('Bolt it').shapes('A', 'B').subject('B')
            .note('Do not overtighten.')
            .tools('allen key 4mm')
            .hardware('M6x40 bolt', 8)

        const doc = docs.create('manual').page('steps').instructable('assembly')
        const svg = await doc.toSVG() as string

        expect(svg).toContain('Do not overtighten.')
        expect(svg).toContain('Tools: allen key 4mm')
        expect(svg).toContain('8x M6x40 bolt')
    })

    it('reaches PDF-ready page SVGs like any other document', async () =>
    {
        manualWith(5)
        const doc = docs.create('manual').page('steps').instructable('assembly', { columns: 2, rows: 2 })
        const pages = await doc.toSVGPages()

        expect(pages).toHaveLength(2)
        pages.forEach(page =>
        {
            expect(page.svg.startsWith('<?xml')).toBe(true)   // a standalone page document
            expect(page.svg).toContain('<svg')
            expect(page.widthMm).toBeGreaterThan(0)
        })
    })

    it('says which instructables exist when the name is wrong', () =>
    {
        manualWith(1)
        expect(() => docs.create('manual').page('p').instructable('nope'))
            .toThrow(/No instructable named "nope".*Available: assembly/s)
    })

    it('warns rather than throwing when there are no steps yet', () =>
    {
        docs.instruct('empty')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(() => docs.create('manual').page('p').instructable('empty')).not.toThrow()
        expect(warn.mock.calls.flat().join(' ')).toContain('has no steps yet')
        warn.mockRestore()
    })

    it('takes the first instructable when no name is given', () =>
    {
        manualWith(2)
        const doc = docs.create('manual').page('steps').instructable()
        expect(doc._pages[0]._containers.filter(c => c._type === 'view')).toHaveLength(2)
    })
})
