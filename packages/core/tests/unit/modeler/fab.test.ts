/**
 * fab.test.ts
 *
 * The fabrication module (src/modeler/Fab.ts, plans/FAB.md): parts measured from their faces, contacts
 * found automatically, joints chosen by the norm book (fab.json), fasteners laid out by patterns, and
 * every number traceable. Mesh kernel.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { matches, FAB_HEADER, type Fastening, type FabOperations, type SawCut, type Drilling, type PartOperation } from '../../../src/modeler/Fab'
import { installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording } from '../../../src/modeler/Recipe'
import { save } from '@archiyou/meshup/src/utils'
import BOOK_JSON from '../../../src/modeler/fab.json'

const TEST_OUTPUT_DIR = './tests/outputs/modeler'

type V = readonly [number, number, number]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dist = (a: V, b: V) => Math.hypot(...sub(a, b))

async function newModeler(units: 'mm' | 'cm' = 'mm'): Promise<Modeler>
{
    const modeler = new Modeler('mesh', units)
    await modeler.load()
    await modeler.loadFab()
    const calc = new Calc()
    const modules = { modeler, calc } as any
    calc.setArchiyou(modules)
    modeler.setArchiyou(modules)
    return modeler
}

/** A 38x120 stud standing on a 1000 long plate, centred on the origin */
function studOnPlate(m: Modeler, gap = 0)
{
    const stud = m.boxBetween([-19, -60, 38 + gap], [19, 60, 2438 + gap]).name('stud')
    const plate = m.boxBetween([-500, -60, 0], [500, 60, 38]).name('plate')
    return { stud, plate }
}

const byJoint = (ops: FabOperations, joint: string) => ops.fastenings().filter(f => f.joint === joint)
const fastenerShapes = (m: Modeler) => m.scene().shapes().toArray().filter((s: any) => s.name?.() === 'fastener')
const hardwareShapes = (m: Modeler) => m.scene().shapes().toArray().filter((s: any) => /^screw/.test(s.name?.() ?? ''))

describe('Fab — loading', () =>
{
    // First in the file: nothing has loaded the module into this test file's module registry yet
    it('explains how to load the module when the Modeler is used directly', async () =>
    {
        const modeler = new Modeler()
        await modeler.load()
        const fab = modeler.fab
        expect(modeler.fab).toBe(fab) // one stable object, so a scope can bind it once
        expect(() => fab.operations([])).toThrow(/fab\.operations\(\): the fabrication module is not loaded.*await modeler\.loadFab\(\) first/)
        await modeler.loadFab()
        expect(fab.operations([]).fastenings()).toEqual([])
    })

    it('refuses the brep kernel', async () =>
    {
        const m = await newModeler()
        m.mode('brep')
        expect(() => m.fab.operations([])).toThrow(/needs the mesh kernel/)
        m.mode('mesh')
    })
})

describe('Fab — the norm book', () =>
{
    it('matches conditions the way the book documents them', () =>
    {
        expect(matches('a|b', 'b')).toBe(true)
        expect(matches('!=90', 45)).toBe(true)
        expect(matches('!=90', 90)).toBe(false)
        expect(matches('>30', 38)).toBe(true)
        expect(matches('<=12', 18)).toBe(false)
        expect(matches('20-40', 38)).toBe(true)
        expect(matches('20-40', 41)).toBe(false)
        expect(matches('edge-*|*-edge', 'side-edge')).toBe(true)
        expect(matches('end-side', 'side-side')).toBe(false)
        expect(matches(38, 38)).toBe(true)
        expect(matches(['king', 'jack'], 'jack')).toBe(true)
        expect(matches('*', '')).toBe(false)
    })

    it('loads fab.json and reports the source of every row', async () =>
    {
        const m = await newModeler()
        const book = m.fab.config()
        expect(book.version).toMatch(/\d{4}-\d{2}/)
        expect(book.changes).toBe(0)
        const studPlate = book.joints.find(row => row.joint === 'stud-plate')!
        expect(studPlate.rule).toMatch(/^joints#\d+$/)
        expect(studPlate.sources['through.count']).toBe('book')
        expect(book.fasteners.some(f => f.type === 'screw' && f.diameter === 5 && f.length === 90)).toBe(true)
    })

    it('changes joints per run and says so', async () =>
    {
        const m = await newModeler()
        m.fab.configure({ joints: { 'stud-plate': { count: 3 } } })
        const book = m.fab.config()
        expect(book.changes).toBe(1)
        expect(book.joints.find(row => row.joint === 'stud-plate')!.sources['through.count']).toBe('run')

        const { stud, plate } = studOnPlate(m)
        const f = m.fab.operations([stud, plate]).fastenings()[0]
        expect(f.count).toBe(3)
        expect(f.sources.count).toBe('run')

        m.reset() // a new run starts from fab.json again
        expect(m.fab.config().changes).toBe(0)
    })

    it('adds rows in front of the book', async () =>
    {
        const m = await newModeler()
        m.fab.configure({ joints: [{
            joint: 'glued', when: { contact: 'end-side', section: '38x120' }, method: 'none', note: 'glued in the jig',
        }] })
        const { stud, plate } = studOnPlate(m)
        const f = m.fab.operations([stud, plate]).fastenings()[0]
        expect(f.joint).toBe('glued')
        expect(f.rule).toBe('run1#0')
        expect(f.status).toBe('none')
        expect(f.notes).toContain('glued in the jig')
    })

    it('refuses mistakes with a message that says what to write', async () =>
    {
        const m = await newModeler()
        expect(() => m.fab.configure({ joints: { 'stud-plate': { pattern: 'zigzag' } } })).toThrow(/unknown pattern 'zigzag'.*endRow/)
        expect(() => m.fab.configure({ joints: { 'stud-plat': { count: 3 } } })).toThrow(/no joint 'stud-plat'.*stud-plate/)
        expect(() => m.fab.configure({ measure: { contactTolerance: -1 } })).toThrow(/measure/)
        expect(() => m.fab.configure({ joints: [{ joint: 'x', when: {}, method: 'through' }] } as any)).toThrow(/no through layout/)
        expect(() => m.fab.configure({ joints: { 'stud-plate': { toe: { fastener: { length: 'auto' } } } } } as any)).toThrow(/toe fastener needs a length/)
        expect(() => m.fab.configure({ joints: { 'stud-plate': { cout: 3 } } } as any)).toThrow(/unknown key 'cout'.*Known: .*count/)
        // nothing of a refused change is kept
        expect(m.fab.config().changes).toBe(0)

        const { stud, plate } = studOnPlate(m)
        expect(() => m.fab.fasten(stud, plate, { fastener: 'screw 5x90' } as any)).toThrow(/Give it as an object: \{ type: 'screw', diameter: 5, length: 90 \}/)
        expect(() => m.fab.operations([stud, plate], { detial: 'none' } as any)).toThrow(/unknown key 'detial'.*Known: joints, detail/)
        expect(() => m.fab.fasten([stud, plate], plate)).toThrow(/a must be one solid, got 2/)
    })
})

describe('Fab — a norm book from a sheet', () =>
{
    // rows as cloudcalc's wb.table() gives them: every column in every row, empty cells as null
    const JOINTS = [
        { joint: 'stud-plate', 'when.contact': 'end-side', 'when.kinds': 'stick|block+stick|block', method: 'through',
            'through.pattern': 'endRow', 'through.fastener.type': 'screw', 'through.fastener.diameter': 6, 'through.fastener.length': 'auto',
            'through.count': '3', 'through.inset': 25, 'through.penetration': 50, note: null, source: 'workshop norms' },
        { joint: null, 'when.contact': null, 'when.kinds': null, method: null, 'through.pattern': null, 'through.fastener.type': null,
            'through.fastener.diameter': null, 'through.fastener.length': null, 'through.count': null, 'through.inset': null,
            'through.penetration': null, note: null, source: '' },
        { joint: 'rest', 'when.contact': '*', 'when.kinds': null, method: 'none', 'through.pattern': null, 'through.fastener.type': null,
            'through.fastener.diameter': null, 'through.fastener.length': null, 'through.count': null, 'through.inset': null,
            'through.penetration': null, note: 'not fastened in this shop', source: null },
    ]
    const TABLES = {
        joints: JOINTS,
        fasteners: [{ type: 'screw', diameter: 6, lengths: '80, 100, 120', prices: '0.12; 0.14; 0.16', confidence: 'quote' }],
        times: [
            { op: 'handle', 'when.kind': null, unit: 'part', minutes: 2, setup: null, confidence: 'measured' },
            { op: 'sawCut', 'when.kind': 'square', unit: 'cut', minutes: '0.4', setup: null, confidence: 'measured' },
            { op: 'fasten', 'when.kind': null, unit: 'fastener', minutes: 0.3, setup: 1, confidence: 'measured' },
        ],
        rates: [{ key: 'currency', value: 'EUR' }, { key: 'labour', value: 55 }, { key: 'confidence', value: 'quote' }],
        measure: { contactTolerance: '1' },
    }
    const OPTIONS = { name: 'norms', version: '2026-10' }

    it('uses the tables it is given for this run, and names their rows', async () =>
    {
        const m = await newModeler()
        expect(m.fab.normBook(TABLES, OPTIONS)).toBe(m.fab)
        const book = m.fab.config()
        expect(book.version).toBe('2026-10')
        expect(book.about.book).toBe(`norms 2026-10: joints, fasteners, times, rates, measure from the sheet, the rest from fab.json ${BOOK_JSON.version}`)
        expect(book.joints.map(row => row.rule)).toEqual(['norms.joints#0', 'norms.joints#2'])
        expect(book.joints[0]).toMatchObject({
            when: { contact: 'end-side', kinds: 'stick|block+stick|block' }, method: 'through', source: 'workshop norms',
            through: { pattern: 'endRow', fastener: { type: 'screw', diameter: 6, length: 'auto' }, count: 3, inset: 25, penetration: 50 },
            sources: { method: 'sheet', 'through.count': 'sheet' },
        })
        expect(book.fasteners).toEqual([80, 100, 120].map((length, i) =>
            ({ type: 'screw', diameter: 6, length, price: [0.12, 0.14, 0.16][i], confidence: 'quote', rule: 'norms.fasteners#0' })))
        expect(book.times.map(row => [row.rule, row.op, row.minutes])).toEqual([
            ['norms.times#0', 'handle', 2], ['norms.times#1', 'sawCut', 0.4], ['norms.times#2', 'fasten', 0.3]])
        expect(book.rates).toEqual({ currency: 'EUR', labour: 55, confidence: 'quote' })
        expect(book.measure.contactTolerance).toBe(1)
        expect(book.stock).toEqual(m.fab.config().stock) // not given: fab.json's
        expect(book.stock[0].rule).toBe('stock#0')

        const { stud, plate } = studOnPlate(m)
        const ops = m.fab.operations([stud, plate])
        const [f] = ops.fastenings()
        // 38 through the plate + 50 into the stud: the 100 of the sheet's catalogue
        expect(f).toMatchObject({ joint: 'stud-plate', rule: 'norms.joints#0', count: 3, fastener: { type: 'screw', diameter: 6, length: 100 } })
        expect(f.sources).toMatchObject({ method: 'sheet', count: 'sheet', length: 'auto' })
        const est = m.fab.estimate(ops)
        const minutes = (op: string) => est.lines.filter(l => l.op === op).map(l => [l.rule, l.minutes])
        expect(minutes('handle')).toEqual([['norms.times#0', 4]])
        expect(minutes('sawCut')).toEqual([['norms.times#1', 1.6]])
        expect(minutes('fasten')).toEqual([['norms.times#2', 1.9]])
        expect(est.rate).toBe(55)
        expect(est.stock.find(l => l.item === 'fastener')).toMatchObject({ rule: 'norms.fasteners#0', count: 3, cost: 0.42 })
        expect(est.table('time').computeFooterRows()[0].values.op).toBe('norm book 2026-10')

        // changes go on top of the sheet, and a new run starts from fab.json again
        m.fab.configure({ joints: { 'stud-plate': { count: 2 } } })
        const changed = m.fab.config()
        expect(changed).toMatchObject({ version: '2026-10', changes: 1 })
        expect(changed.joints[0].sources['through.count']).toBe('run')
        m.reset()
        expect(m.fab.config().version).toBe(BOOK_JSON.version)
    })

    it('fastens a wall the same way from fab.json rows given as a sheet', async () =>
    {
        const opening = [{ left: 1000, sill: 800, width: 900, height: 1000 }]
        const run = async (sheet: boolean) =>
        {
            const m = await newModeler()
            if (sheet) m.fab.normBook({ joints: BOOK_JSON.joints as any }, { name: 'copy', version: 'copy' })
            const wall: any = m.make.wall(3000, 2400, 120, 38, 610, opening)
            return m.fab.operations(wall, { detail: 'none' }).fastenings()
        }
        const book = await run(false)
        const sheet = await run(true)
        const summary = (list: Fastening[]) => list.map(f => [f.joint, f.method, f.count, f.fastener?.length, f.notes.length])
        expect(summary(sheet)).toEqual(summary(book))
        expect(sheet.map(f => f.rule)).toEqual(book.map(f => `copy.${f.rule}`))
        // the covered rule still switches the later of two blocked joints to toe fastening
        expect(sheet.filter(f => f.method === 'toe').length).toBeGreaterThan(0)
    })

    it('says which table and row are wrong, and keeps nothing of a refused book', async () =>
    {
        const m = await newModeler()
        const bad = (tables: any, options: any = OPTIONS) => () => m.fab.normBook(tables, options)
        expect(bad({ joints: [{ joint: 'x', 'when.contact': 'end-side', method: 'through', 'through.pattern': 'zigzag',
            'through.fastener.type': 'screw', 'through.fastener.diameter': 5, 'through.fastener.length': 90 }] }))
            .toThrow(/norms joints#0 through: unknown pattern 'zigzag'/)
        // the blank first row still counts, so the number is the row under the header
        expect(bad({ times: [{ op: null, unit: null, minutes: null }, { op: 'sawCut', unit: 'part', minutes: 1 }] }))
            .toThrow(/norms times#1: a sawCut is timed per cut, not per part/)
        expect(bad({ joints: [] }, { name: 'norms' })).toThrow(/options\.version is written on every output/)
        expect(bad({ joints: [] }, { name: 'my norms', version: '1' })).toThrow(/options\.name names the rows/)
        expect(bad({ joint: [] })).toThrow(/unknown key 'joint'.*Known: joints/)
        expect(bad({})).toThrow(/give at least one table/)
        expect(bad({ joints: {} })).toThrow(/norms joints must be the rows of a table, like wb\.table\('joints'\)/)
        expect(bad({ rates: [{ currency: 'EUR', labour: 50 }, { currency: 'USD', labour: 60 }] }))
            .toThrow(/norms rates: give one row, or two columns named key and value/)
        expect(bad({ measure: { contactTolerence: 1 } })).toThrow(/unknown key 'contactTolerence' in norms measure/)
        expect(bad({ joints: [{ joint: 'x', when: 'a', 'when.contact': 'b' }] }))
            .toThrow(/norms joints#0: column 'when\.contact' goes inside 'when', which has a value of its own/)
        expect(m.fab.config().version).toBe(BOOK_JSON.version)

        m.fab.configure({ joints: { 'stud-plate': { count: 3 } } })
        expect(bad({ times: TABLES.times })).toThrow(/call it before fab\.configure\(\)/)
    })
})

describe('Fab — measuring parts', () =>
{
    it('reads a stud from its faces', async () =>
    {
        const m = await newModeler()
        const [stud] = m.fab.operations([m.box(38, 120, 2400)]).members()
        expect(stud.kind).toBe('stick')
        expect(stud.direction).toBe('vertical')
        expect(stud.section).toBe('38x120')
        expect(stud.length).toBeCloseTo(2400, 6)
        expect(stud.fill).toBeCloseTo(1, 6)
    })

    it('finds the long axis of a square section, where a PCA box cannot tell', async () =>
    {
        const m = await newModeler()
        const post = m.box(38, 38, 2400).rotate(45, 'z')
        const [member] = m.fab.operations([post]).members()
        expect(member.section).toBe('38x38')
        expect(member.length).toBeCloseTo(2400, 6)
        expect(Math.abs(member.axes.long[2])).toBeCloseTo(1, 6)
    })

    it('does not depend on how a part is turned', async () =>
    {
        const m = await newModeler()
        const beam = m.box(38, 120, 2400).rotate(37, 'z').rotate(10, 'x')
        const [member] = m.fab.operations([beam]).members()
        expect(member.section).toBe('38x120')
        expect(member.length).toBeCloseTo(2400, 6)
        expect(member.direction).toBe('vertical') // within measure.verticalDeg (15)

        const [leaning] = m.fab.operations([m.box(38, 120, 2400).rotate(20, 'x')]).members()
        expect(leaning.direction).toBe('sloped')
    })

    it('tells sheets and blocks from sticks', async () =>
    {
        const m = await newModeler()
        const members = m.fab.operations([
            m.boxBetween([0, 0, 0], [1220, 18, 2440]).name('board'),
            m.boxBetween([2000, 0, 0], [2300, 300, 300]).name('cube'),
            m.boxBetween([3000, 0, 0], [3018, 1220, 2440]).name('floor').rotate(90, 'y'),
        ]).members()
        const kind = (name: string) => members.find(x => x.name === name)!
        expect(kind('board').kind).toBe('sheet')
        expect(kind('board').direction).toBe('vertical')
        expect(kind('cube').kind).toBe('block')
        expect(kind('floor').kind).toBe('sheet')
        expect(kind('floor').direction).toBe('horizontal')
    })
})

describe('Fab — contacts', () =>
{
    it('finds a stud standing on a plate', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const c = m.fab.contact(stud, plate)!
        expect(c.kind).toBe('end-side')
        expect(c.entering.name).toBe('stud')
        expect(c.receiving.name).toBe('plate')
        expect(c.area).toBeCloseTo(38 * 120, 6)
        expect(c.normal[2]).toBeCloseTo(1, 9) // from the plate into the stud
        expect(c.relation).toBe('perpendicular')
    })

    it('says how far apart parts are that do not touch', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m, 5)
        expect(m.fab.contact(stud, plate)).toBeNull()
        expect(() => m.fab.fasten(stud, plate)).toThrow(/do not touch \(gap 5\.0 mm\)/)
        expect(m.fab.contact(stud, plate, { tolerance: 6 })).not.toBeNull()
    })

    it('reports parts that overlap instead of treating them as touching', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m, -10)
        const ops = m.fab.operations([stud, plate])
        expect(ops.contacts()).toHaveLength(0)
        expect(ops.warnings()).toEqual([expect.stringMatching(/stud and plate overlap by about 10 mm/)])
    })
})

describe('Fab — fastening', () =>
{
    it('screws a stud to its plate through the plate, into the end grain', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const f = m.fab.fasten(stud, plate)
        expect(f.joint).toBe('stud-plate')
        expect(f.rule).toMatch(/^joints#\d+$/)
        expect(f.method).toBe('through')
        expect(f.pattern).toBe('endRow')
        expect(f.from!.name).toBe('plate')
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 90 }) // 38 through + 50 penetration
        expect(f.sources).toMatchObject({ count: 'book', inset: 'book', length: 'auto' })
        expect(f.status).toBe('ok')
        expect(f.count).toBe(2)
        const points = f.fasteners.map(p => p.point).sort((a, b) => a[1] - b[1])
        expect(points[0]).toEqual([expect.closeTo(0, 9), expect.closeTo(-30, 9), expect.closeTo(0, 9)])
        expect(points[1]).toEqual([expect.closeTo(0, 9), expect.closeTo(30, 9), expect.closeTo(0, 9)])
        f.fasteners.forEach(p => expect(p.dir[2]).toBeCloseTo(1, 9))
        expect(f.evidence).toMatch(/stud .* end on plate .* → stud-plate \(joints#\d+\); through plate, endRow ×2, inset 30; 2× screw ⌀5 length auto → 90 \(38 through \+ 50 into stud\)/)
    })

    it('lays out the same fastening however the parts are turned', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        ;[stud, plate].forEach(s => s.rotate(37, 'z').rotate(10, 'x')) // the stud stays within 15° of vertical
        const f = m.fab.fasten(stud, plate)
        expect(f.joint).toBe('stud-plate')
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 90 })
        expect(f.count).toBe(2)
        const [p, q] = f.fasteners
        expect(dist(p.point, q.point)).toBeCloseTo(60, 6)
        f.fasteners.forEach(x =>
        {
            // on the far face of the plate, driven along the contact normal
            expect(dot(sub(x.point, f.contact.origin), f.contact.normal)).toBeCloseTo(-38, 6)
            expect(dot(x.dir, f.contact.normal)).toBeCloseTo(1, 9)
        })
    })

    it('fastens toe-wise on request and checks the fasteners stay inside', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const f = m.fab.fasten(stud, plate, { method: 'toe' })
        expect(f.method).toBe('toe')
        expect(f.pattern).toBe('toe')
        expect(f.from!.name).toBe('stud')
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 70 })
        expect(f.sources.method).toBe('pair')
        expect(f.count).toBe(2)
        f.fasteners.forEach(p =>
        {
            expect(p.dir[2]).toBeCloseTo(-Math.cos(30 * Math.PI / 180), 9)
            expect(Math.abs(p.point[0])).toBeCloseTo(19, 9) // on a wide face of the stud
            expect(p.point[2]).toBeCloseTo(38 + 70 / 3, 9)
        })
        // one from each wide face, staggered 20 from the edges so they pass each other
        const [low, high] = [...f.fasteners].sort((p, q) => p.point[1] - q.point[1])
        expect([Math.round(low.point[1]), Math.round(high.point[1])]).toEqual([-40, 40])
        expect(Math.sign(low.point[0])).toBe(-Math.sign(high.point[0]))
        expect(f.warnings).toEqual([])

        const meeting = m.fab.fasten(stud, plate, { method: 'toe', inset: 60 })
        expect(meeting.warnings).toContain('its fasteners cross each other: change the count or inset')

        const long = m.fab.fasten(stud, plate, { method: 'toe', fastener: { length: 100 } as any })
        expect(long.warnings).toEqual([expect.stringMatching(/come out of plate/)])
    })

    it('warns when a fastener cannot hold', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const short = m.fab.fasten(stud, plate, { fastener: { diameter: 4, length: 40 } as any })
        expect(short.fastener).toEqual({ type: 'screw', diameter: 4, length: 40 })
        expect(short.status).toBe('warning')
        expect(short.warnings).toContainEqual(expect.stringMatching(/penetration 2 mm is less than 6d = 24 mm/))

        const odd = m.fab.fasten(stud, plate, { fastener: { diameter: 7 } as any })
        expect(odd.warnings).toContainEqual(expect.stringMatching(/no catalogue length for screw ⌀7: used 90 mm/))
        expect(odd.fastener!.length).toBe(90)
    })

    it('face-screws two studs side by side in two staggered rows', async () =>
    {
        const m = await newModeler()
        const king = m.boxBetween([0, -60, 0], [38, 60, 2400]).name('king')
        const jack = m.boxBetween([38, -60, 0], [76, 60, 2400]).name('jack')
        const f = m.fab.operations([king, jack]).fastenings()[0]
        expect(f.joint).toBe('stud-stud')
        expect(f.contact.kind).toBe('side-side')
        expect(f.contact.relation).toBe('parallel')
        // at most 400 apart, 100 from the ends: 7 in one row, 6 staggered in the other
        expect(f.count).toBe(13)
        expect(new Set(f.fasteners.map(p => Math.round(p.point[1])))).toEqual(new Set([-30, 30]))
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 70 }) // 38 + 30, stays inside 38 + 38
    })

    it('fastens crossing plates near two corners', async () =>
    {
        const m = await newModeler()
        const lower = m.boxBetween([-500, -60, 0], [500, 60, 38])
        const upper = m.boxBetween([-60, -500, 38], [60, 500, 76])
        const f = m.fab.operations([lower, upper]).fastenings()[0]
        expect(f.joint).toBe('cross')
        expect(f.contact.relation).toBe('perpendicular')
        expect(f.count).toBe(2)
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 70 })
    })

    it('screws a sheet closer at its edges than in its field', async () =>
    {
        const m = await newModeler()
        const studs = [0, 610, 1182].map((x, i) => m.boxBetween([x, -60, 0], [x + 38, 60, 2400]).name(`stud${i}`))
        const sheet = m.boxBetween([0, -78, 0], [1220, -60, 2440]).name('board')
        const ops = m.fab.operations([...studs, sheet])
        const count = (name: string) => ops.fastenings().find(f => f.contact.receiving.name === name)!.count
        expect(ops.fastenings().every(f => f.joint === 'sheet' && f.from!.name === 'board')).toBe(true)
        expect(count('stud0')).toBe(17) // every 150 over 2370
        expect(count('stud1')).toBe(9)  // every 300
        expect(count('stud2')).toBe(17)
        expect(ops.fasteners()).toEqual([{ type: 'screw', diameter: 4, length: 50, count: 43 }]) // 18 + 30 → 50
    })

    it('notes when an entry is covered and drives equal parts from their free side', async () =>
    {
        const m = await newModeler()
        const stud = m.boxBetween([0, -60, 38], [38, 60, 2438]).name('stud')
        const bottom = m.boxBetween([-500, -60, 0], [500, 60, 38]).name('bottomplate')
        const top = m.boxBetween([-500, -60, 2438], [500, 60, 2476]).name('topplate')
        const top2 = m.boxBetween([-500, -60, 2476], [500, 60, 2514]).name('topplate2')
        const ops = m.fab.operations([stud, bottom, top, top2])
        const toTop = ops.fastenings().find(f => f.contact.receiving.name === 'topplate')!
        expect(toTop.notes).toContain('entry covered by topplate2: fasten before placing it')
        const plates = byJoint(ops, 'plate-plate')[0]
        expect(plates.from!.name).toBe('topplate2')
        expect(plates.notes).toEqual([])
        expect(plates.count).toBe(5) // 1000 long, 100 from the ends, at most 400 apart: 3, and 2 staggered
    })

    it('toe-fastens the later of two parts that block each other through a header', async () =>
    {
        const m = await newModeler()
        const header = m.boxBetween([-500, -60, 1000], [500, 60, 1038]).name('header')
        const below = m.boxBetween([-19, -60, 0], [19, 60, 1000]).name('below')
        const above = m.boxBetween([-19, -60, 1038], [19, 60, 2000]).name('above')
        const ops = m.fab.operations([header, below, above])
        const [first, second] = byJoint(ops, 'stud-plate')
        expect(first.method).toBe('through')
        expect(first.notes).toContainEqual(expect.stringMatching(/entry covered by (above|below): fasten before placing it/))
        expect(second.method).toBe('toe')
        expect(second.sources.method).toBe('auto')
        expect(second.notes[0]).toMatch(/fastened toe-wise: (above|below) covers the entry and is fastened through header from the other side \(covered: toe in joints#\d+\)/)
        expect(ops.warnings()).toEqual([])
    })

    it('reports fasteners that cross, when the book keeps both joints as they are', async () =>
    {
        const m = await newModeler()
        m.fab.configure({ joints: { 'stud-plate': { covered: 'keep' } } })
        const header = m.boxBetween([-500, -60, 1000], [500, 60, 1038]).name('header')
        const below = m.boxBetween([-19, -60, 0], [19, 60, 1000]).name('below')
        const above = m.boxBetween([-19, -60, 1038], [19, 60, 2000]).name('above')
        const ops = m.fab.operations([header, below, above])
        const both = byJoint(ops, 'stud-plate')
        expect(both.map(f => f.method)).toEqual(['through', 'through'])
        both.forEach(f =>
        {
            expect(f.status).toBe('warning')
            expect(f.warnings).toContainEqual(expect.stringMatching(/its fasteners cross those of (above|below) \/ header/))
        })
    })

    it('uses a pair override in later operations and draws it once', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        m.fab.fasten(stud, plate, { count: 3 })
        expect(fastenerShapes(m)).toHaveLength(6) // a circle and a line per fastener
        const f = m.fab.operations([stud, plate]).fastenings()[0]
        expect(f.count).toBe(3)
        expect(f.sources.count).toBe('pair')
        expect(fastenerShapes(m)).toHaveLength(6)
    })

    it('takes joint changes for one call', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const f = m.fab.operations([stud, plate], { joints: { 'stud-plate': { method: 'toe' } } }).fastenings()[0]
        expect(f.method).toBe('toe')
        expect(f.sources.method).toBe('call')
        expect(m.fab.operations([stud, plate], { detail: 'none' }).fastenings()[0].method).toBe('through')
    })
})

describe('Fab — diagram', () =>
{
    it('draws a circle on the drill plane and a line along each fastener', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const f = m.fab.fasten(stud, plate)
        expect(f.shapes).toHaveLength(4)
        const circles = f.shapes.filter((_, i) => i % 2 === 0)
        circles.forEach((circle: any, i) =>
        {
            const box = circle.bbox()
            const centre: V = [box.center().x, box.center().y, box.center().z]
            expect(dist(centre, f.fasteners[i].point)).toBeLessThan(1e-6)
            expect(Math.max(box.width(), box.depth())).toBeCloseTo(5, 3)
            expect(box.height()).toBeCloseTo(0, 6)
        })
        const line: any = f.shapes[1]
        expect(line.length()).toBeCloseTo(90, 6)
    })

    it('draws nothing with detail none, and does not draw twice', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610)
        m.fab.operations(wall, { detail: 'none' })
        expect(fastenerShapes(m)).toHaveLength(0)
        const ops = m.fab.operations(wall)
        const total = ops.fasteners().reduce((n, f) => n + f.count, 0)
        expect(fastenerShapes(m)).toHaveLength(2 * total)
        m.fab.operations(wall)
        expect(fastenerShapes(m)).toHaveLength(2 * total)
    })

    it('makes each fastener a part with detail full, and swaps details without leaving any behind', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610)
        const total = m.fab.operations(wall).fasteners().reduce((n, f) => n + f.count, 0)
        const volumes = wall.studs.toArray().map((stud: any) => stud.volume())
        const full = m.fab.operations(wall, { detail: 'full' })
        expect(fastenerShapes(m)).toHaveLength(0)
        expect(hardwareShapes(m)).toHaveLength(2 * total)
        expect(hardwareShapes(m).every((shape: any) => shape.subtype() === 'Cylinder')).toBe(true)
        // the parts themselves are not cut
        expect(wall.studs.toArray().map((stud: any) => stud.volume())).toEqual(volumes)

        // a stud on the bottom plate: the shank from the underside of the plate, the head sunk flush
        const f = full.fastenings().find(x => x.joint === 'stud-plate' && x.contact.receiving.name === 'bottomplate')!
        const [shank, head] = f.shapes.map((shape: any) => shape.bbox())
        expect(f.shapes.map((shape: any) => shape.name())).toEqual(['screw', 'screw head', 'screw', 'screw head'])
        expect([shank.width(), shank.depth(), shank.height()].map(x => Math.round(x * 1000) / 1000)).toEqual([5, 5, 90])
        expect(shank.min().z).toBeCloseTo(0, 6)
        expect([head.width(), head.height()].map(x => Math.round(x * 1000) / 1000)).toEqual([10, 3])
        expect(head.min().z).toBeCloseTo(0, 6)

        // the fastener parts are left out of the next reading, and are not made twice
        const shapes = new Set(full.fastenings().flatMap(x => x.shapes))
        const again = m.fab.operations(m.scene().shapes().toArray(), { detail: 'full' })
        expect(again.members()).toHaveLength(full.members().length)
        expect(again.fastenings().flatMap(x => x.shapes).every(shape => shapes.has(shape))).toBe(true)
        expect(hardwareShapes(m)).toHaveLength(2 * total)

        m.fab.operations(wall)
        expect(hardwareShapes(m)).toHaveLength(0)
        expect(fastenerShapes(m)).toHaveLength(2 * total)
    })

    it('lists the holes of the fasteners apart from the parts own drillings', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const ops = m.fab.operations([stud, plate], { detail: 'none' })
        const holes = ops.holes()
        expect(holes.map(h => [h.part, h.face, h.through, h.depth, h.diameter, h.entry[2], h.axis[2]]).sort()).toEqual([
            ['plate', 'wide', true, 38, 5, 0, 1],
            ['plate', 'wide', true, 38, 5, 0, 1],
            ['stud', 'end', false, 52, 5, 38, 1],
            ['stud', 'end', false, 52, 5, 38, 1],
        ])
        expect(holes.map(h => h.entry[1]).sort((a, b) => a - b).map(Math.round)).toEqual([-30, -30, 30, 30])
        expect(holes[0].evidence).toMatch(/^a ⌀5 hole for a screw of stud-plate stud\/plate, /)
        expect(ops.list().filter(x => x.op === 'drilling')).toEqual([])
        expect(ops.parts().every(p => p.drillings === 0)).toBe(true)
    })
})

describe('Fab — walls from make.wall()', () =>
{
    it('fastens a door wall without crossings: a short king-jack contact gets one per row, in the middle', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(4000, 2400, 120, 38, 610, [{ left: 2400, sill: 0, width: 900, height: 2100 }])
        const ops = m.fab.operations(wall, { detail: 'none' })
        expect(ops.warnings()).toEqual([])
        const short = byJoint(ops, 'stud-stud').filter(f => f.notes.some(note => /does not fit twice in 187 mm; one per row in the middle/.test(note)))
        expect(short).toHaveLength(2)
        short.forEach(f =>
        {
            expect(f.count).toBe(2)
            const [a, b] = f.fasteners.map(p => p.point)
            // side by side, halfway up the jack above the door
            const jack = [f.contact.a, f.contact.b].find(x => x.name.startsWith('openingJack'))!
            expect(a[2]).toBeCloseTo(b[2], 6)
            expect(a[2]).toBeCloseTo((jack.bbox.min[2] + jack.bbox.max[2]) / 2, 6)
        })
    })

    it('fastens every stud to both plates and leaves the insulation alone', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610)
        const ops = m.fab.operations(wall)
        const studs = wall.studs.length
        expect(byJoint(ops, 'stud-plate')).toHaveLength(2 * studs)
        expect(ops.fasteners()).toEqual([{ type: 'screw', diameter: 5, length: 90, count: 4 * studs }])
        const insulation = ops.members().filter(x => x.name.startsWith('insulation'))
        expect(insulation.length).toBe(wall.insulation.length)
        expect(insulation.every(x => x.kind === 'fill')).toBe(true)
        expect(byJoint(ops, 'fill').every(f => f.count === 0 && f.status === 'none')).toBe(true)
        expect(ops.fastenings().filter(f => f.status === 'unmatched')).toEqual([])
        expect(ops.warnings()).toEqual([])

        const text = ops.explain()
        expect(text.startsWith(FAB_HEADER)).toBe(true)
        expect(text).toMatch(new RegExp(`${4 * studs}× screw ⌀5 × 90`))

        await save(`${TEST_OUTPUT_DIR}/fab-wall.glb`, await wall.toGLB())
    })

    it('frames an opening with headers, king and jack studs', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610, [{ left: 1000, sill: 800, width: 900, height: 1200 }])
        const ops = m.fab.operations(wall)
        expect(byJoint(ops, 'header-stud')).toHaveLength(4)
        const studStud = byJoint(ops, 'stud-stud')
        expect(studStud.length).toBeGreaterThan(0)
        studStud.forEach(f => expect(new Set(f.fasteners.map(p => Math.round(p.point[1]))).size).toBe(2))
        expect(ops.fastenings().filter(f => f.status === 'unmatched')).toEqual([])
        expect(ops.fastenings().filter(f => f.status === 'warning')).toEqual([])
        // nothing overlaps: the insulation is cut exactly around the king and jack studs
        expect(ops.warnings()).toEqual([])
        // and it touches them, so every bay next to the opening is a fill between two parts
        const kingLeft = ops.members().find(x => x.name === 'openingKingStudLeft')!
        expect(ops.contacts().some(c => (c.a === kingLeft || c.b === kingLeft) && (c.a.kind === 'fill' || c.b.kind === 'fill'))).toBe(true)

        await save(`${TEST_OUTPUT_DIR}/fab-wall-opening.glb`, await wall.toGLB())
    })

    it('finds a rule for every contact of the make.test opening wall', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2000, 200, 32, 610, [{ left: 1000, sill: 500, width: 600, height: 600 }])
        const ops = m.fab.operations(wall)
        expect(ops.fastenings().filter(f => f.status === 'unmatched')).toEqual([])
        // 32 mm stock is thin for the default fasteners: the checks say so
        expect(ops.warnings()).toContainEqual(expect.stringMatching(/penetration 18 mm is less than 6d = 30 mm/))
    })

    it('fastens studs to sloped top plates and notes the ridge', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610, [], { height: 600, center: 0.5 })
        const ops = m.fab.operations(wall)
        const sloped = byJoint(ops, 'stud-plate').filter(f => f.contact.receiving.direction === 'sloped')
        expect(sloped).toHaveLength(wall.studs.length)
        sloped.forEach(f =>
        {
            expect(Math.abs(f.contact.normal[2])).toBeLessThan(0.99)
            expect(f.status).toBe('ok') // the tips stay inside the stud
            f.fasteners.forEach(p =>
            {
                // entered on the sloped top of the plate, driven down along the stud
                expect(dot(sub(p.point, f.contact.origin), f.contact.normal)).toBeCloseTo(-38, 6)
                expect(p.dir[2]).toBeCloseTo(-1, 9)
            })
        })
        const ridge = byJoint(ops, 'end-end')
        expect(ridge).toHaveLength(1)
        expect(ridge[0].notes).toContain('end grain to end grain: use a plate or a bracket')
        expect(ops.fastenings().filter(f => f.status === 'unmatched')).toEqual([])
    })

    it('reports a name that says otherwise than the geometry', async () =>
    {
        const m = await newModeler()
        const lying = m.boxBetween([0, 0, 0], [2400, 120, 38]).name('stud9')
        expect(m.fab.operations([lying]).warnings()).toEqual(['stud9 is named like a stud but runs horizontal; the geometry decides'])
    })
})

describe('Fab — tables and units', () =>
{
    it('writes a table per fastening and a table of fastener totals', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(1220, 2400, 120, 38, 610)
        const ops = m.fab.operations(wall)
        const table = ops.table('fastenings')
        const rows = table.toData()
        expect(rows.length).toBe(ops.fastenings().length)
        expect(rows[0]).toMatchObject({ joint: expect.any(String), part: expect.any(String), status: expect.any(String) })
        const footer = table.computeFooterRows()[0].values
        expect(footer.count).toBe(ops.fasteners().reduce((n, f) => n + f.count, 0))
        expect(footer.joint).toBe(`norm book ${ops.book.version}`)

        const totals = ops.table('fastener totals', { by: 'fastener' }).toData()
        expect(totals).toEqual([{ type: 'screw', diameter: 5, length: 90, count: 12 }])
    })

    it('works in centimetres, with fastener sizes still in millimetres', async () =>
    {
        const m = await newModeler('cm')
        const stud = m.boxBetween([-1.9, -6, 3.8], [1.9, 6, 243.8])
        const plate = m.boxBetween([-50, -6, 0], [50, 6, 3.8])
        const f: Fastening = m.fab.fasten(stud, plate)
        expect(f.joint).toBe('stud-plate')
        expect(f.contact.entering.section).toBe('38x120')
        expect(f.fastener).toEqual({ type: 'screw', diameter: 5, length: 90 })
        expect(f.fasteners[0].length).toBeCloseTo(9, 9)
        expect(Math.abs(f.fasteners[0].point[1])).toBeCloseTo(3, 9)
    })
})

describe('Fab — part operations', () =>
{
    beforeAll(() => installRecipeRecorder())
    afterAll(() => uninstallRecipeRecorder())
    beforeEach(() => setRecipeRecording(true))
    afterEach(() => setRecipeRecording(false))

    const opsOf = (ops: FabOperations, name: string) => ops.members().find(m => m.name === name)!.ops
    const cuts = (list: PartOperation[]) => list.filter(op => op.op === 'sawCut') as SawCut[]
    const cutAt = (list: PartOperation[], end: 'start' | 'end') => cuts(list).find(c => c.end === end)!

    it('measures square ends when no recipe was recorded', async () =>
    {
        setRecipeRecording(false)
        const m = await newModeler()
        const ops = m.fab.operations([m.box(38, 120, 2400).name('stud')])
        const [stud] = ops.members()
        expect(stud.recipe).toBe('none')
        expect(stud.ops).toEqual([
            expect.objectContaining({ op: 'sawCut', end: 'start', kind: 'square', angle: 90, inclination: 90, origin: 'measured' }),
            expect.objectContaining({ op: 'sawCut', end: 'end', kind: 'square', origin: 'measured' }),
        ])
    })

    it('confirms the ends with the recipe', async () =>
    {
        const m = await newModeler()
        const ops = m.fab.operations([m.box(38, 120, 2400).name('stud')])
        const [stud] = ops.members()
        expect(stud.recipe).toBe('live')
        expect(cuts(stud.ops).map(c => [c.kind, c.origin, c.evidence])).toEqual([
            ['square', 'derived', 'start cut square: the end of the box as drawn'],
            ['square', 'derived', 'end cut square: the end of the box as drawn'],
        ])
        expect(stud.warnings).toEqual([])
    })

    it('reads an angled cut and the tool that made it', async () =>
    {
        const m = await newModeler()
        const stud = m.boxBetween([500, -60, 0], [538, 60, 3000]).name('stud') as any
        // a prism whose top slopes down 45° towards -x
        stud._intersection(m.polygon([[400, 0, 2000], [700, 0, 2300], [700, 0, 0], [400, 0, 0]]).extrude(400, [0, 1, 0]).move(0, -200, 0))
        const list = opsOf(m.fab.operations([stud]), 'stud')
        expect(cutAt(list, 'start')).toMatchObject({ kind: 'square', origin: 'derived' })
        expect(cutAt(list, 'end')).toMatchObject({
            kind: 'angled', angle: 90, inclination: 135, origin: 'derived',
            evidence: 'end cut angle 90°, inclination 135°: the common with a extrude',
        })
    })

    it('reads a double cut at a pointed end', async () =>
    {
        const m = await newModeler()
        const stud = m.boxBetween([500, -60, 0], [538, 60, 3000]).name('stud') as any
        stud._intersection(m.polygon([[400, 0, 0], [700, 0, 0], [700, 0, 2800], [519, 0, 2981], [400, 0, 2862]]).extrude(400, [0, 1, 0]).move(0, -200, 0))
        const end = cutAt(opsOf(m.fab.operations([stud]), 'stud'), 'end')
        expect(end.kind).toBe('double')
        expect([end.inclination, end.second!.inclination].sort((a, b) => a - b)).toEqual([45, 135])
        expect(end.origin).toBe('derived')
    })

    it('finds a drilling through the part and a blind one, from the recipe', async () =>
    {
        const m = await newModeler()
        const beam = m.box(38, 120, 2000).name('beam') as any // z from -1000 to 1000
        beam.subtract(m.cylinder(6, 200, [0, 0, 0]).rotate(90, 'x').move(0, 100, 300))
        beam.subtract(m.cylinder(5, 30, [0, 0, 0]).rotate(-90, 'y').move(30, 0, -500))
        const drillings = opsOf(m.fab.operations([beam]), 'beam').filter(op => op.op === 'drilling') as Drilling[]
        expect(drillings).toEqual([
            expect.objectContaining({ diameter: 12, through: true, depth: 120, face: 'narrow', along: 1300, across: 0, tilt: 0, origin: 'derived' }),
            expect.objectContaining({ diameter: 10, through: false, depth: 19, face: 'wide', along: 500, across: 0, tilt: 0 }),
        ])
        // the facets of the holes are neither ends nor notches
        expect(cuts(opsOf(m.fab.operations([beam]), 'beam')).map(c => c.kind)).toEqual(['square', 'square'])
    })

    it('recognises a notch with a recipe and reports one without', async () =>
    {
        const m = await newModeler()
        const beam = m.box(38, 120, 2000).name('beam') as any // z from -1000 to 1000
        beam.subtract(m.boxBetween([0, -70, -50], [30, 70, 50]))
        const ops = m.fab.operations([beam])
        expect(opsOf(ops, 'beam').filter(op => op.op === 'notch')).toEqual([
            expect.objectContaining({ origin: 'derived', evidence: 'a box cut from the part leaves 3 face(s) inside it: a notch, lap or rebate' }),
        ])
        expect(ops.warnings()).toEqual([])

        setRecipeRecording(false)
        const plain = m.box(38, 120, 2000).name('plain') as any
        plain.subtract(m.boxBetween([0, -70, -50], [30, 70, 50]))
        const measured = m.fab.operations([plain])
        expect(opsOf(measured, 'plain')).toContainEqual(expect.objectContaining({ op: 'unknown', origin: 'measured' }))
        expect(measured.warnings()).toEqual([expect.stringMatching(/plain: not recognised: 3 face\(s\) inside the part's box/)])
    })

    it('does not mistake a notch at the end for a cut', async () =>
    {
        const m = await newModeler()
        const beam = m.box(38, 120, 2000).name('beam') as any
        beam.subtract(m.boxBetween([0, -70, 900], [30, 70, 1100])) // a half lap at the top end (z = 1000)
        const list = opsOf(m.fab.operations([beam]), 'beam')
        expect(cutAt(list, 'end')).toMatchObject({ kind: 'square', origin: 'derived' })
        expect(list.filter(op => op.op === 'notch')).toEqual([
            expect.objectContaining({ evidence: 'a box cut from the part leaves 2 face(s) inside it: a notch, lap or rebate' }),
        ])
    })

    it('gives sheets a sheathe operation and fills an insulate operation', async () =>
    {
        const m = await newModeler()
        const board = m.boxBetween([0, -78, 0], [1220, -60, 2440]).name('board') as any
        const holed = m.boxBetween([2000, -78, 0], [3220, -60, 2440]).name('holed') as any
        holed.subtract(m.boxBetween([2400, -100, 1000], [2800, 0, 1600]))
        const ops = m.fab.operations([board, holed])
        expect(opsOf(ops, 'board')).toEqual([expect.objectContaining({
            op: 'sheathe', width: 1220, length: 2440, thickness: 18, area: 2.977, shaped: false,
        })])
        expect(opsOf(ops, 'holed')[0]).toMatchObject({ op: 'sheathe', shaped: true, area: 2.737 })

        const wall: any = m.make.wall(1220, 2400, 120, 38, 610)
        const insulation = m.fab.operations(wall).members().filter(x => x.kind === 'fill')
        expect(insulation.length).toBeGreaterThan(0)
        insulation.forEach(fill =>
        {
            const [op] = fill.ops
            expect(op).toMatchObject({ op: 'insulate', thickness: 120, origin: 'measured' })
            expect((op as any).area).toBeCloseTo((op as any).volume / 0.12, 2)
        })
    })

    it('cuts the studs under a ridge at the roof angle', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610, [], { height: 600, center: 0.5 })
        const ops = m.fab.operations(wall)
        const slope = Math.atan(600 / 1500) * 180 / Math.PI
        wall.studs.toArray().forEach((stud: any) =>
        {
            const list = opsOf(ops, stud.name())
            expect(cutAt(list, 'start')).toMatchObject({ kind: 'square', origin: 'derived' })
            const top = cutAt(list, 'end')
            expect(top).toMatchObject({ kind: 'angled', angle: 90, origin: 'derived' })
            expect(Math.abs(top.inclination - 90)).toBeCloseTo(slope, 1) // the cut leans as far as the roof
        })
        // the two sloped top plates are the same part, and nothing is left unrecognised
        const plates = ops.parts().find(p => p.parts.includes('topPlateLeft'))!
        expect(plates.parts).toEqual(['topPlateLeft', 'topPlateRight'])
        expect(plates.count).toBe(2)
        expect(ops.warnings()).toEqual([])
    })

    it('marks parts whose recipe is baked as measured', async () =>
    {
        const m = await newModeler()
        const pieces = (m.box(38, 120, 2400) as any).split(m.boxBetween([-100, -100, -50], [100, 100, 50]).removeFromScene())
        const ops = m.fab.operations(pieces)
        expect(ops.members()).toHaveLength(2)
        ops.members().forEach(piece =>
        {
            expect(piece.recipe).toBe('baked')
            expect(piece.recipeNote).toMatch(/split/)
            expect(cuts(piece.ops).map(c => [c.kind, c.origin])).toEqual([['square', 'measured'], ['square', 'measured']])
        })
    })

    it('reads every part of a wall with an opening from its recipe', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610, [{ left: 1000, sill: 800, width: 900, height: 1200 }])
        const ops = m.fab.operations(wall)
        // cripples are built from boxes, so they have a recipe too
        const cripples = ops.members().filter(x => x.name.startsWith('cripple'))
        expect(cripples.length).toBeGreaterThan(0)
        expect(ops.members().filter(x => x.kind === 'stick').every(x => x.recipe === 'live')).toBe(true)
        expect(ops.parts().every(p => p.origin === 'derived')).toBe(true)
        // the opening verticals were cut against plates they never touch: nothing to report
        ops.members().filter(x => x.name === 'openingVertical').forEach(v => expect(v.ops.map(op => op.op)).toEqual(['sawCut', 'sawCut']))
        expect(ops.warnings()).toEqual([])
    })

    it('trims the cripples above an opening under a ridge like the studs', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(3000, 2400, 120, 38, 610, [{ left: 1000, sill: 800, width: 900, height: 1000 }], { height: 600, center: 0.5 })
        const ops = m.fab.operations(wall)
        const tops = ops.members().filter(x => x.name === 'crippleTop')
        expect(tops.length).toBeGreaterThan(0)
        tops.forEach(top => expect(cutAt(top.ops, 'end')).toMatchObject({ kind: 'angled', origin: 'derived' }))
        expect(ops.fastenings().filter(f => f.status === 'unmatched')).toEqual([])
        // the kernel can leave a corner of a face twice, a hair apart: the screws must still land inside
        const onSloped = byJoint(ops, 'stud-plate')
            .filter(f => f.contact.entering.name === 'crippleTop' && f.contact.receiving.direction === 'sloped')
        expect(onSloped).toHaveLength(tops.length)
        onSloped.forEach(f => expect(f).toMatchObject({ count: 2, warnings: [] }))
        expect(ops.warnings()).toEqual([])
    })

    it('lists every operation and writes a cut list', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(1830, 2400, 120, 38, 610)
        const ops = m.fab.operations(wall)
        const list = ops.list()
        expect(list.filter(x => x.op === 'sawCut')).toHaveLength(2 * (wall.studs.length + 2))
        expect(list.filter(x => x.op === 'fasten')).toHaveLength(2 * wall.studs.length)
        expect(list.filter(x => x.op === 'insulate')).toHaveLength(wall.insulation.length)

        const table = ops.table('cut list', { by: 'part' })
        expect(table.toData()).toEqual([
            { part: `stud0 +${wall.studs.length - 1}`, kind: 'stick', section: '38x120', length: 2324, count: wall.studs.length,
                start: '90', end: '90', drillings: 0, notches: 0, material: '', origin: 'derived' },
            expect.objectContaining({ part: 'bottomplate +1', length: 1830, count: 2 }),
        ])
        expect(table.computeFooterRows()[0].values.count).toBe(wall.studs.length + 2)

        const operations = ops.table('operations', { by: 'operation' }).toData()
        expect(operations.length).toBe(ops.members().reduce((n, x) => n + x.ops.length, 0))
        expect(operations[0]).toMatchObject({ op: 'sawCut', origin: 'derived' })
        expect(() => ops.table('x', { by: 'nothing' as any })).toThrow(/by 'nothing' is not known/)

        expect(ops.explain()).toMatch(/· sawCut \(derived\): start cut square: the end of the box as drawn/)
    })
})

describe('Fab — estimate', () =>
{
    const line = (est: any, op: string, what?: string) => est.lines.find((l: any) => l.op === op && (!what || l.what === what))

    it('times every operation and prices the stock, naming the row behind each number', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const est = m.fab.estimate(m.fab.operations([stud, plate]))
        expect(line(est, 'handle')).toMatchObject({ rule: 'times#0', qty: 2, minutes: 3, status: 'ok' })
        expect(line(est, 'sawCut', 'square')).toMatchObject({ rule: 'times#1', qty: 4, minutes: 2 })
        // 2 fasteners at 0.25 plus 1 minute to set the joint up
        expect(line(est, 'fasten')).toMatchObject({ what: 'through screw ⌀5×90', qty: 2, items: 1, minutes: 1.5 })
        expect(est.minutes).toBe(6.5)
        expect(est.labour).toBe(5.2) // 6.5 min at 48/h

        // the stud (2400) and the plate (1000) come from one 3600 bar: 2400 + 4 kerf + 1000
        expect(est.stock[0]).toMatchObject({ item: 'bar', what: '38x120 × 3600', count: 1, used: 3404, waste: 196, cuts: [[2400, 1000]], offcuts: [], cost: 7.02, rule: 'stock#1' })
        expect(est.stock[1]).toMatchObject({ item: 'fastener', what: 'screw ⌀5×90', count: 2, cost: 0.16, rule: 'fasteners#3' })
        expect(est.material).toBe(7.18)
        expect(est.total).toBe(12.38)
        expect(est.complete).toBe(true)
        expect(est.warnings()).toEqual([expect.stringMatching(/values are placeholders: calibrate the norm book before quoting/)])
        expect(est.explain()).toMatch(/6\.5 min at 48 EUR\/h\) = 5\.20 EUR labour, 7\.18 EUR material, 12\.38 EUR total/)
    })

    it('cuts pieces from stock first fit decreasing, with the kerf', async () =>
    {
        const m = await newModeler()
        const pieces = [2400, 2400, 2400, 1200].map((l, i) => m.boxBetween([i * 500, 0, 0], [i * 500 + 38, 120, l]))
        const bars = m.fab.estimate(m.fab.operations(pieces)).stock.filter(l => l.item === 'bar')
        // 2400 + 4 + 2400 = 4804 no longer fits 4800
        expect(bars.map(b => [b.what, b.count, b.cuts])).toEqual([
            ['38x120 × 5400', 1, [[2400, 2400]]],
            ['38x120 × 4200', 1, [[2400, 1200]]],
        ])
        expect(bars[0].offcuts).toEqual([596])
    })

    it('says what it cannot time or price, and that the totals are incomplete', async () =>
    {
        const m = await newModeler()
        const long = m.boxBetween([0, 0, 0], [38, 120, 6000]).name('long')
        const odd = m.boxBetween([500, 0, 0], [550, 50, 2000]).name('odd')
        const notched = m.box(38, 120, 2000).move(2000).name('notched') as any
        notched.subtract(m.boxBetween([2000, -70, -50], [2030, 70, 50]))
        const est = m.fab.estimate(m.fab.operations([long, odd, notched]))
        expect(est.complete).toBe(false)
        expect(line(est, 'unknown')).toMatchObject({ rule: null, minutes: null, labour: null, status: 'unmatched' })
        expect(est.warnings()).toEqual(expect.arrayContaining([
            'no time for 1 × unknown (not recognised): add a row to times',
            'no stock row for 50x50: 1 piece, 2000 mm, not priced',
            expect.stringMatching(/^6000 mm: longer than any stock length in stock#1/),
        ]))
        expect(est.explain()).toMatch(/INCOMPLETE/)
    })

    it('uses the rates, times and stock changed for this run', async () =>
    {
        const m = await newModeler()
        m.fab.configure({
            rates: { labour: 60 },
            times: [{ op: 'sawCut', when: { kind: 'square' }, unit: 'cut', minutes: 2, source: 'our workshop, March' }],
            stock: [{ when: { section: '38x120' }, lengths: [2400], pricePerM: 2.5, kerf: 3 }],
        })
        const { stud, plate } = studOnPlate(m)
        const est = m.fab.estimate(m.fab.operations([stud, plate]))
        expect(line(est, 'sawCut')).toMatchObject({ rule: 'run1.times#0', minutes: 8, source: 'our workshop, March', confidence: null })
        expect(est.rate).toBe(60)
        expect(est.stock[0]).toMatchObject({ what: '38x120 × 2400', count: 2, rule: 'run1.stock#0', cost: 12 })

        expect(() => m.fab.configure({ times: [{ op: 'sawCut', unit: 'm2', minutes: 1 }] as any })).toThrow(/a sawCut is timed per cut, not per m2/)
        expect(() => m.fab.configure({ stock: [{ lengths: [3000], size: [1220, 2440], pricePerM: 1 }] as any })).toThrow(/exactly one of them/)
        expect(() => m.fab.configure({ times: [{ op: 'saw', unit: 'cut', minutes: 1 }] as any })).toThrow(/no operation 'saw'/)
        expect(() => m.fab.configure({ fasteners: [{ type: 'screw', diameter: 5, lengths: [70, 90], prices: [0.1] }] })).toThrow(/1 prices for 2 lengths/)
        expect(() => m.fab.estimate({} as any)).toThrow(/give it the result of fab.operations\(\)/)
    })

    it('counts whole sheets and prices cut sheets and fills by area and volume', async () =>
    {
        const m = await newModeler()
        const whole = m.boxBetween([0, 0, 0], [1220, 18, 2440])
        const cut = m.boxBetween([2000, 0, 0], [2600, 18, 1200])
        const est = m.fab.estimate(m.fab.operations([whole, cut]))
        const sheets = est.stock.find(l => l.item === 'sheet')!
        // one whole sheet, and 0.72 m² plus 10% cut from one more
        expect(sheets).toMatchObject({ what: 'sheet 18 1220×2440', count: 2, used: 3.697, rule: 'stock#7', cost: 52.99 })
        expect(line(est, 'sheathe')).toMatchObject({ qty: 3.697, minutes: 36.97 })

        const wall: any = m.make.wall(1220, 2400, 120, 38, 610)
        const walled = m.fab.estimate(m.fab.operations(wall))
        const fill = walled.stock.find(l => l.item === 'fill')!
        const volume = wall.insulation.toArray().reduce((v: number, s: any) => v + s.volume() / 1e9, 0)
        expect(fill.used).toBeCloseTo(volume, 3)
        expect(fill.count).toBeCloseTo(volume * 1.05, 3)
        // every bay is a full wall deep, whatever its width
        walled.operations.members().filter(x => x.kind === 'fill').forEach(x => expect(x.thickness).toBeCloseTo(120, 6))
    })

    it('writes tables and dashboard metrics, and checks hours per m²', async () =>
    {
        const m = await newModeler()
        const wall: any = m.make.wall(2440, 2400, 120, 38, 610)
        const est = m.fab.estimate(m.fab.operations(wall), { area: 2.44 * 2.4, checks: { hoursPerM2: [0.5, 3] } })
        const time = est.table('time')
        const footer = time.computeFooterRows()[0].values
        expect(footer.minutes).toBeCloseTo(est.minutes, 6)
        expect(footer.op).toBe(`norm book ${est.book.version}`)
        const stock = est.table('material', { by: 'stock' })
        expect(stock.computeFooterRows()[0].values.cost).toBeCloseTo(est.material, 6)
        expect(stock.toData()[0]).toMatchObject({ item: 'bar', unit: 'bar', rule: 'stock#1' })

        est.metrics()
        const metrics = (m.modules.calc as any).getMetrics()
        expect(metrics.map((x: any) => [x.name, x.data])).toEqual([
            ['production_time', est.hours], ['cost_labor', est.labour], ['cost_material', est.material],
        ])
        expect(metrics[0].options.label).toBe(`Production time (norm book ${est.book.version})`)

        const perM2 = est.hours / (2.44 * 2.4)
        const outside = perM2 < 0.5 || perM2 > 3
        expect(est.warnings().some(w => /h\/m² is outside the expected 0.5–3 h\/m²/.test(w))).toBe(outside)
        expect(() => est.table('x', { by: 'money' as any })).toThrow(/by 'money' is not known/)
    })

    it('holds the actuals against the estimate, and gives the time rows that would have matched', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const est = m.fab.estimate(m.fab.operations([stud, plate]))
        const cmp = est.compare({ hours: 0.2, minutes: { sawCut: 3, fasten: 1.5 }, note: 'test bench' })
        expect(cmp.rows).toEqual([
            { what: 'hours', estimate: 0.11, actual: 0.2, diff: 0.09, ratio: 1.846, verdict: 'estimate low', rules: ['times#0', 'times#1', line(est, 'fasten').rule] },
            { what: 'sawCut minutes', estimate: 2, actual: 3, diff: 1, ratio: 1.5, verdict: 'estimate low', rules: ['times#1'] },
            { what: 'fasten minutes', estimate: 1.5, actual: 1.5, diff: 0, ratio: 1, verdict: 'on target', rules: [line(est, 'fasten').rule] },
        ])
        expect(cmp.calibrations).toEqual([expect.objectContaining({
            rule: 'times#1', op: 'sawCut', factor: 1.5, minutes: [0.5, 0.75],
            row: expect.objectContaining({ op: 'sawCut', unit: 'cut', minutes: 0.75, source: 'actuals', confidence: 'measured' }),
        })])
        expect(cmp.calibrations[0].row.note).toBe('sawCut took 1.5× the estimate (test bench); times#1 scaled')
        expect(cmp.warnings()).toEqual([])
        expect(cmp.explain()).toMatch(/times#1 sawCut: 0\.5 → 0\.75 min/)
        const table = cmp.table()
        expect(table.toData()).toHaveLength(3)
        expect(table.computeFooterRows()[0].values.what).toBe(`norm book ${est.book.version}, test bench`)

        // the loop: the suggested row, used in the next run, gives the booked minutes
        m.fab.configure({ times: [cmp.calibrations[0].row] })
        const next = m.fab.estimate(m.fab.operations([stud, plate]))
        expect(line(next, 'sawCut')).toMatchObject({ minutes: 3, rule: 'run1.times#0', source: 'actuals', confidence: 'measured' })
        expect(next.compare({ minutes: { sawCut: 3 } }).rows[0].verdict).toBe('on target')
    })

    it('refuses actuals it cannot read, and says what does not add up', async () =>
    {
        const m = await newModeler()
        const { stud, plate } = studOnPlate(m)
        const est = m.fab.estimate(m.fab.operations([stud, plate]))
        expect(() => est.compare({})).toThrow(/give at least one actual/)
        expect(() => est.compare({ hours: -1 })).toThrow(/hours must be a number of 0 or more/)
        expect(() => est.compare({ minutes: { sawing: 3 } })).toThrow(/no operation 'sawing' in minutes\. Known: handle, sawCut/)
        expect(() => est.compare({ hour: 3 } as any)).toThrow(/unknown key 'hour'.*Known: hours/)

        expect(est.compare({ hours: 1, labour: 100 }).warnings()).toEqual([
            'hours are 823% low: book minutes per operation (minutes: { sawCut: … }) to see which time rows to change',
            'labour was 100 EUR/h, the book says 48: check rates.labour',
        ])
        const drilling = est.compare({ minutes: { drilling: 5 } })
        expect(drilling.rows[0]).toMatchObject({ what: 'drilling minutes', estimate: null, ratio: null, verdict: 'not estimated' })
        expect(drilling.warnings()).toEqual(['drilling minutes: the estimate has nothing for this'])
        expect(drilling.calibrations).toEqual([])
        expect(est.compare({ material: 10, labour: 5, total: 20 }).warnings()).toEqual([
            'material is 39% low: check the prices of stock#1, fasteners#3',
            'the actual total 20 is not labour + material (15)',
        ])
    })
})
