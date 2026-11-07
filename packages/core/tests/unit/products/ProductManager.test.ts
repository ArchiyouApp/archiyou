import { describe, it, expect, beforeAll, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { ProductManager, cutLengths, type ProductRow, type OperationRow, type ComponentRow } from '../../../src/products/ProductManager'

/**
 * ProductManager: parts of a model → products of a product sheet → costs.
 *
 * The rows are a few products of the URHOUSE sheet as its products table has them. A product
 * group is one product line in several sizes (SLS), a family can hold several lines (OSB).
 */
const PRODUCTS: Array<ProductRow> = [
    { product_id: 'sls-38x140', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 5400, basiseenheid: 'st' },
    { product_id: 'sls-38x235', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 235, lengte: 5400, basiseenheid: 'st' },
    { product_id: 'sls-t-38x140', productgroep: 'SLS-T', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 5400, basiseenheid: 'st' },
    { product_id: 'sls-fj-38x140', productgroep: 'SLS-FJ', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 9000, basiseenheid: 'st' },
    { product_id: 'osb-9-sqe-1220x2440', productgroep: 'OSB-SQE, OSB', vorm: 'plaat', dikte: 9, breedte: 1220, lengte: 2440, basiseenheid: 'st' },
    { product_id: 'osb-9-sqe-1197x2697', productgroep: 'OSB-SQE, OSB', vorm: 'plaat', dikte: 9, breedte: 1197, lengte: 2697, basiseenheid: 'st' },
    { product_id: 'osb-18-sqe-1220x2440', productgroep: 'OSB-SQE, OSB', vorm: 'plaat', dikte: 18, breedte: 1220, lengte: 2440, basiseenheid: 'st' },
    { product_id: 'osb-18-tg2-1220x2440', productgroep: 'OSB-TG2, OSB', vorm: 'plaat', dikte: 18, breedte: 1220, lengte: 2440, basiseenheid: 'st' },
    { product_id: 'wff-140', productgroep: 'WFF', vorm: 'mat', dikte: 140, breedte: 575, lengte: 1350, basiseenheid: 'st' },
    { product_id: 'gyp-12.5-600', productgroep: 'GYP', vorm: 'plaat', dikte: 12.5, breedte: 600, basiseenheid: 'm2' },
    { product_id: 'gyp-12.5-1200', productgroep: 'GYP', vorm: 'plaat', dikte: 12.5, breedte: 1200, basiseenheid: 'm2' },
    { product_id: 'screw-ss-6x100', productgroep: 'SCREW-SS, SCREW', vorm: 'stuk', breedte: 6, lengte: 100, basiseenheid: 'st' },
]
const OPERATIONS: Array<OperationRow> = [
    { naam: 'montagewand', fase: 'montage', werkeenheid: 'st' },
    { naam: 'aftapen', fase: 'assemblage', werkeenheid: 'm1' },
]

const COMPONENTS: Array<ComponentRow> = [
    { component: 'wall', gebouwdeel: 'casco', eenheid: 'm2' },
    { component: 'kitchen', gebouwdeel: 'interieur', eenheid: 'st' },
]

let modeler: Modeler
const products = () => new ProductManager().fromRows(PRODUCTS, OPERATIONS)
const box = (x: number, y: number, z: number) => modeler.box(x, y, z)
const line = (pm: ProductManager, id: string) => pm.list().find(l => l.id === id)!

beforeAll(async () =>
{
    modeler = new Modeler()
    await modeler.load()
})

describe('ProductManager.assign()', () =>
{
    it('gives a wall\'s studs and plates the SLS of their section, and leaves its insulation', () =>
    {
        const wall: any = modeler.make.wall(3000, 2700, 140)
        const pm = products().assign('SLS', wall)
        const timber = [...wall.studs.toArray(), ...wall.plates.toArray()]
        const lengths = timber.map((s: any) => Math.max(s.obbox().width(), s.obbox().height(), s.obbox().depth()))

        const sls = line(pm, 'sls-38x140')
        expect(pm.list().map(l => l.id)).toEqual(['sls-38x140'])
        expect(sls.shapes).toBe(timber.length)
        expect(sls.st).toBe(timber.length)
        expect(sls.lengte).toBeCloseTo(lengths.reduce((a: number, b: number) => a + b, 0) / 1000, 5)
        expect(sls.oppervlak).toBe(0)
        expect(sls.description).toMatch(/studs/)
        expect(pm.unassigned().length).toBe(wall.insulation.length)
        expect(pm.unassigned(wall).length).toBe(wall.insulation.length)

        // a later assign takes the insulation; nothing is left
        pm.assign('WFF', wall.insulation)
        expect(pm.unassigned().length).toBe(0)
        expect(line(pm, 'wff-140')).toMatchObject({ shapes: wall.insulation.length, description: 'insulation' })
    })

    it('takes the shortest stock length that is long enough, and says when none is', () =>
    {
        const pm = products()
        expect(() => pm.assign('SLS', box(38, 140, 6000))).toThrow(/no product of 'SLS' fits any of the parts \(38 x 140 x 6000\)/)
        pm.assign('SLS-FJ', box(38, 140, 6000))
        expect(line(pm, 'sls-fj-38x140')).toMatchObject({ st: 1, lengte: 6 })

        // by id, it is assigned anyway, with a warning
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        pm.assign('sls-38x140', box(38, 140, 6000))
        expect(warn.mock.calls[0]?.[0]).toMatch(/1 part\(s\) do not fit its size: 38 x 140 x 6000/)
        warn.mockRestore()
        expect(line(pm, 'sls-38x140').lengte).toBe(6)
    })

    it('measures a mat in pieces of stock, counting only the cut to length', () =>
    {
        // a bay of a wall: two mats of 575 x 1350, one cut to length; pressed in across its width
        const pm = products().assign('WFF', box(562, 140, 2624))
        expect(line(pm, 'wff-140')).toMatchObject({ st: 2, zaaglengte: 0.562 })
        expect(line(pm, 'wff-140').oppervlak).toBeCloseTo(0.562 * 2.624, 6)
        expect(line(pm, 'wff-140').volume).toBeCloseTo(0.562 * 2.624 * 0.14, 6)
    })

    it('measures an offcut thinner than the mat as the mat it is cut from', () =>
    {
        // insulation under a window: 80 high, 562 wide, 140 deep (the wall)
        const offcut = () => box(562, 140, 80)
        const ROWS = [...PRODUCTS, { product_id: 'wff-80', productgroep: 'WFF', vorm: 'mat', dikte: 80, breedte: 575, lengte: 1350 }]

        // by id: the size that equals the product's thickness is the thickness
        const byId = new ProductManager().fromRows(ROWS).assign('wff-140', offcut())
        expect(line(byId, 'wff-140')).toMatchObject({ st: 1, zaaglengte: 0.08 })
        expect(line(byId, 'wff-140').oppervlak).toBeCloseTo(0.562 * 0.08, 6)

        // by group: as measured when something fits (wff-80), turned only when nothing does
        expect(new ProductManager().fromRows(ROWS).assign('WFF', offcut()).list().map(l => l.id)).toEqual(['wff-80'])
        expect(products().assign('WFF', offcut()).list().map(l => l.id)).toEqual(['wff-140'])

        // a whole wall with a window, by id: every piece is wff-140, none misfits
        const wall: any = modeler.make.wall(3000, 2700, 140, 38, 600, [{ left: 900, sill: 800, width: 1000, height: 1200 }])
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const pm = new ProductManager().fromRows(ROWS).assign('wff-140', wall.insulation)
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
        expect(pm.list().map(l => [l.id, l.shapes])).toEqual([['wff-140', wall.insulation.length]])
    })

    it('takes the smallest sheet that holds a part, else the largest, and counts the cuts', () =>
    {
        const pm = products().assign('OSB', box(600, 9, 2600))
        expect(line(pm, 'osb-9-sqe-1197x2697')).toMatchObject({ st: 1, zaaglengte: 2.6 + 0.6 })   // ripped and cut to length

        // a whole wall side: six of the largest sheets, the last row ripped, the last column cut
        const wall = products().assign('OSB', box(3000, 9, 2700))
        expect(line(wall, 'osb-9-sqe-1197x2697')).toMatchObject({ st: 6, zaaglengte: 3 + 2.7 })

        // gypsum is sold per m2: the narrowest board that is wide enough, never cut to length
        const gyp = products().assign('GYP', [box(600, 12.5, 2700), box(1000, 12.5, 2700)])
        expect(line(gyp, 'gyp-12.5-600')).toMatchObject({ st: 1, zaaglengte: 0 })
        expect(line(gyp, 'gyp-12.5-1200')).toMatchObject({ st: 1, zaaglengte: 2.7 })
    })

    it('refuses a choice it cannot make, and names the narrower groups', () =>
    {
        expect(() => products().assign('OSB', box(1200, 18, 2400)))
            .toThrow(/2 products fit 18 x 1200 x 2400 equally well: osb-18-sqe-1220x2440, osb-18-tg2-1220x2440\. Assign one of them, or a narrower group: OSB-SQE, OSB-TG2/)
        expect(() => products().assign('OSB-SQE', box(1200, 18, 2400))).not.toThrow()
    })

    it('gives each part the first of several candidates that fits it', () =>
    {
        // SLS comes in 5.4 m, finger-jointed SLS in 9 m: only the long one is finger-jointed
        const pm = products().assign(['SLS', 'SLS-FJ'], [box(38, 140, 2700), box(38, 140, 8000)])
        expect(pm.list().map(l => [l.id, l.st])).toEqual([['sls-38x140', 1], ['sls-fj-38x140', 1]])
        expect(() => products().assign(['SLS', 'SLS-FJ'], box(38, 999, 2700))).toThrow(/no product of 'SLS' fits/)
    })

    it('fits a piece by its largest three sizes when its row has four', () =>
    {
        // a window: dikte, breedte, hoogte and a lengte (its sill depth)
        const pm = new ProductManager().fromRows([{ product_id: 'raam-600x1200', productgroep: 'RAAM', vorm: 'raam', dikte: 20, breedte: 600, hoogte: 1200, lengte: 50, basiseenheid: 'st' }])
            .assign('RAAM', box(600, 50, 1200))
        expect(line(pm, 'raam-600x1200').st).toBe(1)
    })

    it('loads products once: what assign() matched belongs to them', () =>
    {
        expect(() => products().fromRows(PRODUCTS)).not.toThrow()
        expect(() => products().assign('SLS', box(38, 140, 2600)).fromRows(PRODUCTS)).toThrow(/loaded once.*another make\.products\(\)/)
        expect(() => products().add('screw-ss-6x100', { st: 1 }).fromRows(PRODUCTS)).toThrow(/loaded once/)
    })

    it('says what it has for an unknown id or group', () =>
    {
        expect(() => products().assign('SLX', box(38, 140, 2000))).toThrow(/no product, product group or component 'SLX'\. Did you mean: SLS, SLS-T, SLS-FJ/)
        // without products it only maps (see collect()); compute() then has nothing
        expect(new ProductManager().assign('SLS', box(38, 140, 2000)).list()).toEqual([])
        expect(() => products().assign('SLS', modeler.line([0, 0, 0], [100, 0, 0]))).toThrow(/no solid shapes/)
    })
})

describe('ProductManager: components', () =>
{
    const withComponents = () => new ProductManager().fromRows(PRODUCTS, OPERATIONS, COMPONENTS)

    it('prices an abstract mass by its own volume, not the box around it', () =>
    {
        const mass = box(3000, 250, 2500)
        const notched = (box(3000, 250, 2500) as any).subtract(box(1000, 400, 1000).move(1500, 0, 1250))   // a corner off: 500 x 250 x 500
        const pm = withComponents().assign('wall', [mass, notched], { label: 'massing' })
        expect(line(pm, 'wall')).toMatchObject({ kind: 'component', vorm: 'component', st: 2, shapes: 2, description: 'massing' })
        expect(line(pm, 'wall').volume).toBeCloseTo(1.875 + 1.875 - 0.0625, 6)
    })

    it('takes a volume, or the quantity of the component\'s own unit, and lists components after products', () =>
    {
        const pm = withComponents()
            .add('montagewand', { st: 1 })
            .add('wall', { oppervlak: 7.5 })
            .add('kitchen', { st: 1 })
            .add('screw-ss-6x100', { st: 32 })
        expect(pm.list().map(l => [l.id, l.kind])).toEqual([
            ['screw-ss-6x100', 'product'], ['wall', 'component'], ['kitchen', 'component'], ['montagewand', 'operation']])
        expect(() => pm.add('kitchen', { oppervlak: 3 })).toThrow(/a component is priced per m3 \(volume\) or per piece \(st\)/)
        expect(() => pm.add('wall', { st: 1 })).toThrow(/per m3 \(volume\) or per m2 \(oppervlak\)/)

        // a later assign of the same shape to a product takes it over
        const mass = box(3000, 140, 38)
        pm.assign('kitchen', mass).assign('SLS', mass)
        expect(line(pm, 'kitchen').shapes).toBe(0)
        expect(line(pm, 'sls-38x140').shapes).toBe(1)
    })
})

describe('ProductManager.add()', () =>
{
    it('adds products and operations the model does not show, adding up the same id', () =>
    {
        const pm = products()
            .add('aftapen', { lengte: 15 })
            .add('screw-ss-6x100', { st: 32 }, { label: 'skeleton' })
            .add('screw-ss-6x100', { st: 150 }, { label: 'sheathing', waste: 0.1 })
            .add('montagewand', { st: 1 })
        expect(pm.list().map(l => [l.id, l.kind])).toEqual([
            ['screw-ss-6x100', 'product'], ['aftapen', 'operation'], ['montagewand', 'operation']])
        expect(line(pm, 'screw-ss-6x100')).toMatchObject({ st: 182, description: 'skeleton, sheathing', waste: 0.1, vorm: 'stuk' })
        expect(line(pm, 'aftapen')).toMatchObject({ lengte: 15, vorm: 'm1' })

        expect(() => pm.add('montage', { st: 1 })).toThrow(/not a product, an operation or a component of the sheet\. Did you mean: montagewand/)
        expect(() => pm.add('montagewand', { stuks: 1 } as any)).toThrow(/unknown quantities stuks/)
    })
})

describe('ProductManager.compute()', () =>
{
    const priced = (id: string, price: Record<string, number | string>) => ({ ...PRODUCTS.find(p => p.product_id === id)!, ...price })
    /** Priced products: a beam of 5.4 m at 27 is 5 per m1, a mat of 0.776 m2 costs 8 per m2. */
    const ROWS = [
        priced('sls-38x140', { 'prijs per basiseenheid': 27, 'prijseenheid': 'st' }),
        priced('sls-38x235', { 'prijs per basiseenheid': 54, 'prijseenheid': 'st' }),
        priced('sls-t-38x140', { 'prijs per basiseenheid': 0, 'prijseenheid': 'st' }),
        priced('wff-140', { 'prijs per m2': 8, 'prijs per basiseenheid': 6.2 }),
        priced('screw-ss-6x100', { 'prijs per basiseenheid': 0.5 }),
    ]
    const RATES: Array<OperationRow> = [
        { naam: 'pakken', fase: 'voorbewerking', werkeenheid: 'st', 'kosten (EUR per werkeenheid)': 1.5 },
        { naam: 'afkorten', fase: 'voorbewerking', werkeenheid: 'st', 'kosten (EUR per werkeenheid)': 0.5 },
        { naam: 'inleggen', fase: 'assemblage', werkeenheid: 'st', 'kosten (EUR per werkeenheid)': 2 },
        { naam: 'bevestigen', fase: 'assemblage', werkeenheid: 'st', 'kosten (EUR per werkeenheid)': 0.1 },
        { naam: 'montagewand', fase: 'montage', werkeenheid: 'st', 'kosten (EUR per werkeenheid)': 30 },
        { naam: 'afmonteren', fase: 'afbouw', werkeenheid: 'm2', 'kosten (EUR per werkeenheid)': 8 },
    ]
    const head = (component: string, unit: string, size: number) => ({
        component, 'eenheid maat': unit, 'representatieve maat': size,
        'representatieve breedte (mm)': 3000, 'representatieve hoogte (mm)': 2700, 'representatieve diepte (mm)': 200,
    })
    const row = (cells: Record<string, unknown>) => ({
        component: '', 'representatieve maat': '', 'eenheid maat': '', bouwdeel: 'x', fase: '', product: '', bewerking: '', 'vorm / werkeenheid': '',
        'hoeveelheid in prijseenheid': '', per: '', factor: '',
        materiaalkosten: '', onsitekosten: '', voorbewerkingskosten: '', assemblagekosten: '', montagekosten: '', afbouwkosten: '', ...cells,
    })
    const op = (bewerking: string, fase: string, owner: string, per: string, factor: number, cost: number) => row({
        bewerking, fase, 'vorm / werkeenheid': 'st', product: owner, per, factor, [`${fase}kosten`]: cost,
    })
    /** A wall of 8.1 m2: beams with a recipe, mats, and work on the element; a floor where a beam has another one. */
    const COMPONENTEN = [
        row({ ...head('wall', 'm2', 8.1), fase: 'materiaal', product: 'sls-38x235', 'vorm / werkeenheid': 'balk', materiaalkosten: 100 }),
        op('pakken', 'voorbewerking', 'sls-38x235', 'st', 1, 13.5),
        op('afkorten', 'voorbewerking', 'sls-38x235', 'st', 2, 9),
        row({ fase: 'materiaal', product: 'wff-140', 'vorm / werkeenheid': 'mat', materiaalkosten: 50 }),
        op('inleggen', 'assemblage', 'wff-140', 'st', 1, 20),
        row({ bouwdeel: 'element', fase: 'montage', bewerking: 'montagewand', 'vorm / werkeenheid': 'st', 'hoeveelheid in prijseenheid': 1, montagekosten: 30 }),
        row({ bouwdeel: 'element', fase: 'afbouw', bewerking: 'afmonteren', 'vorm / werkeenheid': 'm2', 'hoeveelheid in prijseenheid': 8.1, afbouwkosten: 64.8 }),
        row({ product: 'sls-38x235, wff-140', materiaalkosten: 150, montagekosten: 30 }),   // the block's total: no phase
        row({ ...head('floor', 'm2', 10), fase: 'materiaal', product: 'sls-38x235', 'vorm / werkeenheid': 'balk', materiaalkosten: 80 }),
        op('pakken', 'voorbewerking', 'sls-38x235', 'st', 3, 13.5),
    ]
    /** A stand-in for a cloudcalc workbook. */
    function workbook()
    {
        const tables: Record<string, Array<any>> = { producten: ROWS, bewerkingen: RATES, componenten: COMPONENTEN }
        return {
            table: (name: string) => tables[name] as Array<Record<string, unknown>>,
            tables: () => Object.keys(tables).map(name => ({ name })),
            namedRanges: () => [{ name: 'outputs.wall.costm2', range: 'AA40' }, { name: 'outputs.wall.costm3', range: 'AA42' },
                { name: 'outputs.floor.costm2', range: 'AA60' }, { name: 'outputs.floor.costm3', range: 'AA62' }],
            compute: () => ({ marges: { materiaal: 10, arbeid: 20, algemeen: 0 }, verlies: [['balk', 0.1], ['mat', 0.05]] }),
        }
    }
    const sheet = () => new ProductManager().fromSheet(workbook())

    it('prices a beam by its length with the waste of its vorm, and its labour by the recipe in its component', () =>
    {
        const pm = sheet().assign('SLS', [box(38, 140, 2700), box(38, 140, 2700)], { component: 'wall' })
        const line = pm.compute().lines[0]!

        expect(line.costs!.material).toBeCloseTo(5.4 * 5 * 1.1, 6)
        // a beam of another size follows the group in this block: pakken 1 x st, afkorten 2 x st
        expect(line.labour).toBe('wall/SLS')
        expect(line.costs!.voorbewerking).toBeCloseTo(2 * 1.5 + 2 * 2 * 0.5, 6)
        expect(line.costs!.total).toBeCloseTo(29.7 + 5, 6)
    })

    it('counts the same product by the recipe of each component it is in', () =>
    {
        const pm = sheet()
            .add('sls-38x235', { st: 2, lengte: 5 }, { component: 'wall' })
            .add('sls-38x235', { st: 1, lengte: 3 }, { component: 'floor' })
        const line = pm.compute().lines[0]!

        expect(line.labour).toBe('wall/sls-38x235, floor/sls-38x235')
        expect(line.costs!.voorbewerking).toBeCloseTo((2 * 1.5 + 2 * 2 * 0.5) + (1 * 3 * 1.5), 6)
    })

    it('falls back from the component to the sheet: same product, then group, then vorm', () =>
    {
        const source = (id: string, q: any, options?: any) => sheet().add(id, q, options).compute().lines[0]!.labour
        expect(source('sls-38x235', { st: 1, lengte: 1 })).toBe('sls-38x235')
        expect(source('sls-38x140', { st: 1, lengte: 1 })).toBe('SLS')
        expect(source('sls-t-38x140', { st: 1, lengte: 1 })).toBe('balk')
    })

    it('takes the steps most recipes have, at the median factor, when it merges them', () =>
    {
        // two rows for sls-38x235: pakken at 1 and at 3; afkorten only in one of two still counts
        const line = sheet().add('sls-38x235', { st: 1 }).compute().lines[0]!
        expect(line.costs!.voorbewerking).toBeCloseTo(2 * 1.5 + 2 * 0.5, 6)
    })

    it('reports a product without any recipe or price, instead of pricing it at nothing silently', () =>
    {
        const overview = sheet().add('screw-ss-6x100', { st: 10 }).add('sls-t-38x140', { st: 1, lengte: 2 }).compute()
        expect(overview.noRecipe).toEqual(['screw-ss-6x100'])
        expect(overview.noPrice).toEqual(['sls-t-38x140'])
        expect(overview.lines[0]!.costs!.material).toBeCloseTo(10 * 0.5 * 1, 6)
    })

    it('adds the margins to the totals, not to the lines', () =>
    {
        const overview = sheet().add('sls-38x235', { st: 2, lengte: 10 }, { component: 'wall' }).compute()
        const line = overview.lines[0]!.costs!
        expect(overview.material).toBeCloseTo(line.material * 1.1, 6)
        expect(overview.voorbewerking).toBeCloseTo(line.voorbewerking * 1.2, 6)
        expect(overview.total).toBeCloseTo(line.material * 1.1 + line.voorbewerking * 1.2, 6)
    })

    it('adds the work on the element by size, from the representative component', () =>
    {
        const pm = sheet().elementWork('wall', { oppervlak: 16.2 })
        const overview = pm.compute()

        expect(pm.list().map(l => [l.id, l.kind])).toEqual([['montagewand', 'operation'], ['afmonteren', 'operation']])
        expect(pm.list()[0]!.st).toBeCloseTo(2, 6)
        expect(pm.list()[1]!.oppervlak).toBeCloseTo(16.2, 6)
        expect(overview.montage).toBeCloseTo(2 * 30 * 1.2, 6)
        expect(overview.afbouw).toBeCloseTo(16.2 * 8 * 1.2, 6)
        expect(() => sheet().elementWork('wall', { st: 1 })).toThrow(/sized in m2: give oppervlak/)
        expect(() => sheet().elementWork('nope', { st: 1 })).toThrow(/no component 'nope'.*It has: wall, floor/)
    })

    it('completes a component with the products of its block the model does not show, by size', () =>
    {
        // the wall's block: 9 beams of 24.3 m1 and 6 mats of 7.29 m2, for 8.1 m2
        const wb = workbook()
        const rows = COMPONENTEN.map(r => r.component === 'wall' ? { ...r, 'stuks (totaal)': 9, 'lengte (totaal m1)': 24.3 }
            : r.product === 'wff-140' && r.fase === 'materiaal' ? { ...r, 'stuks (totaal)': 6, 'oppervlak (totaal m2)': 7.29 } : r)
        const completed = () => new ProductManager().fromSheet({ ...wb, table: (name: string) => name === 'componenten' ? rows : wb.table(name) })

        // a beam of the same line in the model stands for the block's beam: only the mats and the element work are added
        const pm = completed().assign('SLS', [box(38, 140, 2700)], { component: 'wall' }).complete('wall', { oppervlak: 16.2 })
        expect(pm.list().map(l => [l.id, l.kind])).toEqual([['sls-38x140', 'product'], ['wff-140', 'product'],
            ['montagewand', 'operation'], ['afmonteren', 'operation']])
        expect(line(pm, 'wff-140').st).toBeCloseTo(12, 6)
        expect(line(pm, 'wff-140').oppervlak).toBeCloseTo(14.58, 6)
        expect(pm.compute().lines[1]!.labour).toBe('wall/wff-140')

        // without a model, all of it; and what the model has another build-up for can be left out
        expect(completed().complete('wall', { oppervlak: 8.1 }).list().map(l => l.id)).toEqual(['sls-38x235', 'wff-140', 'montagewand', 'afmonteren'])
        expect(line(completed().complete('wall', { oppervlak: 8.1 }), 'sls-38x235').lengte).toBeCloseTo(24.3, 6)
        expect(completed().complete('wall', { oppervlak: 8.1 }, { except: ['wff-140'] }).list().map(l => l.id)).toEqual(['sls-38x235', 'montagewand', 'afmonteren'])
        expect(() => completed().complete('wall', { st: 1 })).toThrow(/sized in m2: give oppervlak/)
    })

    describe('mapped in a component, collected in the model', () =>
    {
        const wb = workbook()
        const rows = COMPONENTEN.map(r => r.component === 'wall' ? { ...r, 'stuks (totaal)': 9, 'lengte (totaal m1)': 24.3 }
            : r.product === 'wff-140' && r.fase === 'materiaal' ? { ...r, 'stuks (totaal)': 6, 'oppervlak (totaal m2)': 7.29 } : r)
        const withSheet = () => new ProductManager().fromSheet({ ...wb, table: (name: string) => name === 'componenten' ? rows : wb.table(name) })
        /** A wall component: two studs and a mat, mapped without a sheet, completed for 8.1 m2 */
        function wallComponent()
        {
            const studs = [box(38, 140, 2700), box(38, 140, 2700)]
            const mat = box(140, 575, 1350)
            new ProductManager()
                .assign('SLS', studs, { component: 'wall', label: 'studs' })
                .assign('wff-140', mat, { component: 'wall' })
                .add('screw-ss-6x100', { st: 30 }, { component: 'wall' })
                .complete('wall', { oppervlak: 8.1 })
            return [...studs, mat]
        }

        it('maps without a sheet: notes on each shape what it is, loads and prices nothing', () =>
        {
            const shapes = wallComponent()
            expect((shapes[0] as any)._product).toMatchObject({ of: 'SLS', options: { component: 'wall', label: 'studs' } })
            expect((shapes[2] as any)._product.of).toBe('wff-140')
            expect(() => new ProductManager().assign('NOPE', box(10, 10, 10))).not.toThrow()
            expect(() => new ProductManager().collect(shapes)).toThrow(/needs products/)
        })

        it('resolves the mappings with the sheet, as assign() there would', () =>
        {
            const pm = withSheet().collect(wallComponent())
            const direct = withSheet().assign('SLS', [box(38, 140, 2700), box(38, 140, 2700)], { component: 'wall' })
            expect(line(pm, 'sls-38x140').st).toBe(2)
            expect(line(pm, 'sls-38x140').lengte).toBeCloseTo(line(direct, 'sls-38x140').lengte, 6)
            expect(line(pm, 'wff-140').shapes).toBe(1)
            expect(line(pm, 'screw-ss-6x100').st).toBeCloseTo(30, 6)
            // complete(): the block's beam is shown by the studs, the mats by the mat; the work on the element is added
            expect(pm.list().map(l => l.id)).toEqual(['sls-38x140', 'wff-140', 'screw-ss-6x100', 'montagewand', 'afmonteren'])
            expect(line(pm, 'afmonteren').oppervlak).toBeCloseTo(8.1, 6)
        })

        it('counts a component once for every time it is in the model: each shape brings its share', () =>
        {
            const wall = wallComponent()
            const copied = wall.map(s => s.copy())               // the wall again, as a cached component or a copy
            const pm = withSheet().collect([...wall, ...copied])
            expect(line(pm, 'sls-38x140').st).toBe(4)
            expect(line(pm, 'screw-ss-6x100').st).toBeCloseTo(60, 6)
            expect(line(pm, 'afmonteren').oppervlak).toBeCloseTo(16.2, 6)
            expect(line(pm, 'montagewand').st).toBeCloseTo(2, 6)
        })

        it('leaves out what does not fit with a warning, instead of stopping the model', () =>
        {
            const odd = box(38, 999, 2700)
            new ProductManager().assign('SLS', odd, { component: 'wall' })
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const pm = withSheet().collect([odd, ...wallComponent()])
            expect(warn.mock.calls.flat().join(' ')).toMatch(/collect\(\): assign\('SLS'\) left out: .*no product of 'SLS' fits/)
            warn.mockRestore()
            expect(pm.unassigned().toArray()).toEqual([odd])
            expect(line(pm, 'sls-38x140').st).toBe(2)
        })
    })

    it('prices a component as a whole: per its unit, or per m3 when it has a volume', () =>
    {
        const perUnit = sheet().add('wall', { oppervlak: 16.2 }).compute()
        expect(perUnit.lines[0]!.costs!.material).toBeCloseTo(150 * 2, 6)
        expect(perUnit.lines[0]!.costs!.montage).toBeCloseTo(30 * 2, 6)
        expect(perUnit.lines[0]!.labour).toBeNull()

        const perVolume = sheet().add('wall', { volume: 3.24 }).compute()  // the representative volume is 1.62 m3
        expect(perVolume.lines[0]!.costs!.material).toBeCloseTo(150 * 2, 6)
    })

    it('refuses a component it does not know, and clears the costs on a change', () =>
    {
        expect(() => sheet().assign('SLS', box(38, 140, 2700), { component: 'wal' })).toThrow(/no component 'wal'/)
        expect(() => sheet().add('sls-38x140', { st: 1 }, { component: 'wal' })).toThrow(/no component 'wal'/)

        const pm = sheet().add('montagewand', { st: 1 })
        pm.compute()
        expect(pm.list()[0]!.costs).not.toBeNull()
        pm.add('afkorten', { st: 2 })
        expect(pm.list().every(l => l.costs === null)).toBe(true)
    })

    it('opens a sheet by its URL with the run\'s cloudcalc module, which the script declares', () =>
    {
        const opened: Array<any> = []
        const cloudcalc = { open: (ref: string, opts: any) => { opened.push([ref, opts]); return workbook() } }
        const run = (resolve: (name: string) => any) => new ProductManager(() => ({ modules: { resolve } } as any))
        const URL = 'https://docs.google.com/spreadsheets/d/abc/edit'

        expect(run(() => cloudcalc).workbook).toBeNull()
        const pm = run(() => cloudcalc).fromSheet(URL, { key: 'urbuild' })
        expect(opened).toEqual([[URL, { key: 'urbuild' }]])
        expect(typeof pm.workbook?.compute).toBe('function')
        expect(pm.add('montagewand', { st: 1 }).compute().total).toBeCloseTo(36, 6)

        const undeclared = run((name) => { throw new Error(`$module('${name}'): no such module`) })
        expect(() => undeclared.fromSheet(URL)).toThrow(/declare it at the top of the script: \$module\('cloudcalc'\)$/)
        expect(() => new ProductManager().fromSheet(URL)).toThrow(/declare it at the top of the script/)
    })

    it('needs the sheet, with its recipes and margins', () =>
    {
        expect(() => products().compute()).toThrow(/needs the sheet/)
        expect(() => new ProductManager().fromSheet({} as any)).toThrow(/expected the URL of a Google Sheet, or a workbook/)

        const noRecipes = { ...workbook(), tables: () => [{ name: 'producten' }, { name: 'bewerkingen' }] }
        expect(() => new ProductManager().fromSheet(noRecipes).compute()).toThrow(/no recipes: a named range tables.componenten/)
        const builderLayout = { ...workbook(), table: (name: string) => (name === 'componenten' ? [{ component: 'wall', hoofdconstructie: 'sls' }] : workbook().table(name)) }
        expect(() => new ProductManager().fromSheet(builderLayout).compute()).toThrow(/no recipes/)
        const noMargins = { ...workbook(), compute: () => ({}) }
        expect(() => new ProductManager().fromSheet(noMargins).compute()).toThrow(/no margins: named ranges outputs.marges/)
    })

    it('orders beams in lengths of stock, cut from them longest part first', () =>
    {
        // two parts of 2600 and a saw cut of 4 fit in 5400; two of 2700 do not
        expect(cutLengths([2600, 2600, 2600], 5400)).toBe(2)
        expect(cutLengths([2700, 2700], 5400)).toBe(2)
        expect(cutLengths([2700, 2700], 5400, 0)).toBe(1)
        expect(cutLengths([400, 3000, 2000], 5400)).toBe(2)

        const pm = sheet().assign('SLS', [box(38, 140, 2600), box(38, 140, 2600), box(38, 140, 2600)], { component: 'wall' })
        expect(pm.orderList()).toEqual([expect.objectContaining({
            component: '', product: 'sls-38x140', stock: [5400], quantity: 2, unit: 'st', net: 7.8, netUnit: 'm1', price: 27, total: 54 })])

        // the parts of all components are cut from the same lengths, those of each component from its own
        const two = sheet()
            .assign('SLS', [box(38, 140, 2600)], { component: 'wall' })
            .assign('SLS', [box(38, 140, 2600)], { component: 'floor' })
        expect(two.orderList().map(l => l.quantity)).toEqual([1])
        expect(two.orderList({ byComponent: true }).map(l => [l.component, l.quantity])).toEqual([['wall', 1], ['floor', 1]])
    })

    it('orders sheets by their area with the waste of their vorm, pieces by the piece: a line per product', () =>
    {
        const pm = sheet()
            .add('screw-ss-6x100', { st: 10.2 }, { component: 'wall' })
            .add('wff-140', { st: 4, oppervlak: 3 }, { component: 'wall' })
            .add('wff-140', { st: 1, oppervlak: 0.5 }, { component: 'floor' })
        const order = pm.orderList()

        // the mats of both: 3.5 m2 with 5 % waste in mats of 0.77625 m2 at 8 per m2; sheets before pieces
        expect(order.map(l => l.product)).toEqual(['wff-140', 'screw-ss-6x100'])
        expect(order[0]).toMatchObject({ component: '', stock: [575, 1350], quantity: 5, unit: 'st', net: 3.5, netUnit: 'm2' })
        expect(order[0]!.price).toBeCloseTo(0.77625 * 8, 6)
        expect(order[1]).toMatchObject({ description: 'screw-ss-6x100 6x100', quantity: 11, unit: 'st', price: 0.5 })

        // per component: 3 m2 is 5 mats, 0.5 m2 is 1
        expect(pm.orderList({ byComponent: true }).map(l => [l.component, l.product, l.quantity]))
            .toEqual([['wall', 'wff-140', 5], ['wall', 'screw-ss-6x100', 11], ['floor', 'wff-140', 1]])
    })

    it('orders the products of a component the model has as a whole, scaled by size', () =>
    {
        // the floor's block: 4 beams of 20 m1 for 10 m2
        const wb = workbook()
        const rows = COMPONENTEN.map(r => r.component === 'floor' ? { ...r, 'stuks (totaal)': 4, 'lengte (totaal m1)': 20 } : r)
        const pm = new ProductManager().fromSheet({ ...wb, table: (name: string) => name === 'componenten' ? rows : wb.table(name) })
            .add('floor', { oppervlak: 20 })

        // 40 m1 with 10 % waste in lengths of 5.4 m at 54
        expect(pm.orderList({ byComponent: true })).toEqual([expect.objectContaining({ component: 'floor', product: 'sls-38x235', net: 40, quantity: 9, price: 54, total: 486 })])
    })

    it('gives the order list as a table with its total, also per component with a total for each', () =>
    {
        const calc = new Calc()
        calc.setArchiyou({} as any)
        const pm = new ProductManager(() => ({ calc }) as any).fromSheet(workbook())
            .assign('SLS', [box(38, 140, 2600)], { component: 'wall' })
            .add('screw-ss-6x100', { st: 10 }, { component: 'floor' })
        const table = pm.orderTable()

        expect(calc.db.table('order')).toBe(table)
        expect(table.columns()).toEqual(['product', 'description', 'stock (mm)', 'quantity', 'unit', 'net', 'price per unit', 'price'])
        expect(table.toData()[0]).toEqual({ product: 'sls-38x140', description: 'sls-38x140 38x140', 'stock (mm)': '5400',
            quantity: 1, unit: 'st', net: '2.6 m1', 'price per unit': 27, price: 27 })
        expect(table.computeFooterRows().map(f => [f.values.product, f.values.description, f.values.price])).toEqual([['Total', 'excl. margins and BTW', 32]])
        // the html page has the total too
        expect(table.toHtml()).toMatch(/<tfoot>\n<tr class="line b"><td>Total<\/td><td>excl\. margins and BTW<\/td>.*<td class="n">32<\/td><\/tr>\n<\/tfoot>/)

        const split = pm.orderTable('order_split', { byComponent: true })
        expect(split.columns()[0]).toBe('component')
        expect(split.computeFooterRows().map(f => [f.values.component, f.values.product, f.values.price])).toEqual([
            ['wall', 'subtotal', 27], ['floor', 'subtotal', 5], ['Total', 'excl. margins and BTW', 32]])

        // one component: without the component column
        const wall = pm.orderTable('order_wall', { component: 'wall' })
        expect(wall.columns()[0]).toBe('product')
        expect(wall.toData()).toHaveLength(1)
        expect(wall.computeFooterRows().map(f => f.values.price)).toEqual([27])
    })
})

describe('ProductManager.offer()', () =>
{
    /** The product sheet: three components, two of them alternatives in group wanden, and the surcharges. */
    function sheet()
    {
        const rows = PRODUCTS.map(p => p.product_id === 'sls-38x140' ? { ...p, type: 'SLS-regel, C24' } : p.product_id === 'gyp-12.5-1200' ? { ...p, type: 'Gipsplaat (A, verzonken), standaard' } : p)
        const outputs: Record<string, any> = {
            wall: { costm2: 150, costm3: 600, costs: [60, 0, 15, 30, 25, 20], gebouwdeel: 'casco', groep: 'wanden', naam: 'HSB wand', producten: 'sls-38x140, gyp-12.5-1200, sls-38x140' },
            strawwall: { costm2: 140, costm3: 350, costs: [50, 0, 30, 30, 20, 10], gebouwdeel: 'casco', groep: 'wanden', naam: 'Strobalen wand', producten: '' },
            kitchen: { costst: 2000, costm3: 1600, costs: [1600, 0, 100, 100, 100, 100], gebouwdeel: 'interieur', groep: 'keuken', naam: 'Basiskeuken', producten: '' },
            opslagen: { projectkosten: 2, winst: 8 },
        }
        return {
            table: (name: string) => (name === 'producten' ? rows : OPERATIONS) as Array<Record<string, unknown>>,
            tables: () => [{ name: 'producten' }, { name: 'bewerkingen' }],
            // in the sheet's order: the row of each component's cost per m3
            namedRanges: () => [['kitchen', 'st', 265], ['wall', 'm2', 42], ['strawwall', 'm2', 70]]
                .flatMap(([c, unit, row]) => [{ name: `outputs.${c}.cost${unit}`, range: `AD${Number(row) - 2}` }, { name: `outputs.${c}.costm3`, range: `AD${row}` }]),
            compute: () => outputs,
        }
    }
    /** The template: what two builders published, its own fixed prices, and a row for wanden, keuken and vlonder. */
    function template()
    {
        const sent: Array<any> = []
        const price = (bouwer: string, groep: string, component: string, naam: string, eenheid: string, perUnit: number, perM3: number | '') =>
            ({ bouwer, prijspeil: 46325, gebouwdeel: 'casco', groep, component, naam, eenheid, 'totaal per eenheid': perUnit, 'totaal per m3': perM3 })
        const prijzen = [
            price('alle', 'logistiek', 'logistiek', 'Logistiek (< 100 km)', 'dag', 2100, ''),
            price('Bouwer A', 'wanden', 'wall', 'HSB wand', 'm2', 150, 600),
            price('Bouwer A', 'keuken', 'kitchen', 'Basiskeuken', 'st', 2000, 1600),
            price('Bouwer B', 'wanden', 'strawwall', 'Strobalen wand', 'm2', 140, 350),
            price('Bouwer B', 'wanden', 'wall', 'HSB wand B', 'm2', 170, 680),
            { bouwer: '', component: '' },
        ]
        const bouwers = [
            { bouwer: 'Bouwer A', 'Full Service': true, 'DIY Full': true },
            { bouwer: 'Bouwer B', 'Full Service': true, 'DIY Full': false },
        ]
        return {
            sent,
            tables: () => [{ name: 'bouwersprijzen' }, { name: 'bouwers' }],
            table: (name: string) => (name === 'bouwersprijzen' ? prijzen : name === 'bouwers' ? bouwers : []) as Array<Record<string, unknown>>,
            namedRanges: () => ['wanden', 'keuken', 'logistiek', 'footprint'].map(g => ({ name: `inputs.${g}`, range: 'A1' })),
            compute: (input: any) => { sent.push(input); return {} },
        }
    }

    it('lists the components with a group and a name as the price list, in the order of the sheet', () =>
    {
        const prices = new ProductManager().fromSheet(sheet()).prices()
        expect(prices.map(p => [p.groep, p.component, p.naam, p.eenheid])).toEqual([
            ['wanden', 'wall', 'HSB wand', 'm2'], ['wanden', 'strawwall', 'Strobalen wand', 'm2'], ['keuken', 'kitchen', 'Basiskeuken', 'st']])
        expect(prices[0]).toMatchObject({ material: 60, onsite: 0, voorbewerking: 15, assemblage: 30, montage: 25, afbouw: 20 })
        // the products by their type up to a comma outside brackets, and their size; each once
        expect(prices[0]!.omschrijving).toBe('SLS-regel 38x140, Gipsplaat (A, verzonken) 12.5 mm')

        // the row of the cell, not a digit in the tab's name
        const wb = sheet()
        const tab = { ...wb, namedRanges: () => wb.namedRanges().map(r => ({ ...r, range: `'componenten2'!$${r.range.replace(/(\d+)/, '$$$1')}` })) }
        expect(new ProductManager().fromSheet(tab).prices().map(p => p.component)).toEqual(['wall', 'strawwall', 'kitchen'])
    })

    it('reads its components from what the builders published, without a builder\'s own sheet', () =>
    {
        const pm = new ProductManager().fromOffer(template() as any)
        expect(pm.add('wall', { oppervlak: 3 }).add('strawwall', { oppervlak: 2 }).list().map(l => [l.id, l.kind])).toEqual([['wall', 'component'], ['strawwall', 'component']])
        expect(() => pm.add('logistiek', { st: 1 })).toThrow(/not a product, an operation or a component/)
        expect(() => new ProductManager().fromOffer(sheet() as any)).toThrow(/expected the URL of an offer template/)

        // a copy made before the price list was renamed (tables.prijzen) still reads
        const wb = template()
        const old = { ...wb, tables: () => [{ name: 'prijzen' }, { name: 'bouwers' }],
            table: (name: string) => wb.table(name === 'prijzen' ? 'bouwersprijzen' : name) }
        expect(new ProductManager().fromOffer(old as any).add('wall', { oppervlak: 3 }).list().map(l => l.id)).toEqual(['wall'])
    })

    it('fills the quantity of each component group of the model in the unit of the builder\'s component', () =>
    {
        const wb = template()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const pm = new ProductManager().fromOffer(wb as any)
            .add('wall', { oppervlak: 7.5 }).add('wall', { oppervlak: 2.5 })
            .assign('kitchen', box(2400, 600, 900))          // a mass: 1.296 m3 at 1600 per m3 is 1.0368 kitchens of 2000
        expect(pm.offer({ scenario: 'Full Service', inputs: { floorarea_net: 54 } })).toBe(wb)

        expect(wb.sent[0]).toEqual({
            wanden: 10, keuken: 1.04, logistiek: 0,
            bouwer: 'Bouwer A', scenario: 'Full Service', floorarea_net: 54,
        })

        // another builder: no kitchen; a scenario it does not offer
        pm.offer({ bouwer: 'Bouwer B', scenario: 'DIY Full' })
        expect(wb.sent[1]).toEqual({ bouwer: 'Bouwer B', scenario: 'DIY Full', wanden: 10, keuken: 0, logistiek: 0 })
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Bouwer B does not offer the scenario 'DIY Full'/))
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Bouwer B has no price for component 'kitchen'/))

        // two alternatives of one group in the model: the row shows the first, and says so
        pm.add('strawwall', { oppervlak: 3 }).offer({ bouwer: 'Bouwer B' })
        expect(wb.sent[2].wanden).toBe(10)
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/'wall' and 'strawwall' are both in group 'wanden'/))
        warn.mockRestore()

        expect(() => pm.offer({ bouwer: 'Bouwer C' })).toThrow(/no builder 'Bouwer C' in the template; it has: Bouwer A, Bouwer B/)

        // a space after the name in the BOUWERS tab
        const spaced = template()
        const typed = { ...spaced, table: (name: string) => name === 'bouwers'
            ? spaced.table(name).map(b => ({ ...b, bouwer: `${b.bouwer} ` })) : spaced.table(name) }
        new ProductManager().fromOffer(typed as any).add('wall', { oppervlak: 1 }).offer({ bouwer: 'Bouwer B' })
        expect(spaced.sent[0]).toMatchObject({ bouwer: 'Bouwer B', wanden: 1 })
        expect(() => new ProductManager().fromRows(PRODUCTS).offer()).toThrow(/needs the offer template/)
    })

    it('gives the outputs of the last offer, also of another scenario, without changing the offer', () =>
    {
        const wb = template()
        const totals: Record<string, number> = { 'Full Service': 70000, 'DIY Full': 40000 }
        wb.compute = (input: any) => { wb.sent.push(input); return { bouwkosten: { totaal: totals[input.scenario] }, specificaties: { uren: 300 } } }
        const pm = new ProductManager().fromOffer(wb as any).add('wall', { oppervlak: 10 })
        expect(() => pm.offerOutputs()).toThrow(/needs an offer first/)

        pm.offer({ scenario: 'Full Service' })
        expect(pm.offerOutputs().bouwkosten.totaal).toBe(70000)
        expect(pm.offerOutputs({ scenario: 'DIY Full' }).bouwkosten.totaal).toBe(40000)
        expect(pm.offerOutputs().specificaties.uren).toBe(300)
        expect(wb.sent.at(-1)).toMatchObject({ scenario: 'Full Service', wanden: 10 })
    })
})

describe('ProductManager.toTable()', () =>
{
    it('shows the lines, with the costs once computed', () =>
    {
        const made: Array<any> = []
        const calc = { table: (name: string, rows: Array<any>, columns: Array<string>) => { made.push({ name, rows, columns }); return made.at(-1) } }
        const pm = new ProductManager(() => ({ calc } as any)).fromRows(PRODUCTS, OPERATIONS).add('montagewand', { st: 1 })
        pm.toTable()
        expect(made[0]).toMatchObject({ name: 'products', columns: ['product', 'description', 'vorm', 'st', 'lengte', 'oppervlak', 'volume', 'zaaglengte', 'waste'] })
        expect(made[0].rows).toEqual([['montagewand', '', 'st', 1, 0, 0, 0, 0, '']])
        expect(() => products().toTable()).toThrow(/only available inside a run/)
    })
})
