import { describe, it, expect, beforeAll, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { ProductManager, type ProductRow, type OperationRow, type ComponentRow } from '../../../src/products/ProductManager'

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

    it('says what it has for an unknown id or group', () =>
    {
        expect(() => products().assign('SLX', box(38, 140, 2000))).toThrow(/no product, product group or component 'SLX'\. Did you mean: SLS, SLS-T, SLS-FJ/)
        expect(() => new ProductManager().assign('SLS', box(38, 140, 2000))).toThrow(/no products yet/)
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
    /** A stand-in for a cloudcalc workbook: the URHOUSE sheet's names, a project tab of 10 lines. */
    function workbook()
    {
        const sent: Array<any> = []
        return {
            sent,
            table: (name: string) => (name === 'producten' ? PRODUCTS : OPERATIONS) as Array<Record<string, unknown>>,
            tables: () => [{ name: 'producten' }, { name: 'bewerkingen' }],
            namedRanges: () => [{ name: 'inputs.project.regels', range: 'A4:B13' }, { name: 'inputs.project.hoeveelheden', range: 'C4:H13' },
                { name: 'outputs.wall.costm2', range: 'AA40' }, { name: 'outputs.wall.costm3', range: 'AA42' },
                { name: 'outputs.kitchen.costst', range: 'AA263' }, { name: 'outputs.kitchen.costm3', range: 'AA265' }],
            compute: (input: any) =>
            {
                sent.push(input)
                const regels = Array.from({ length: 10 }, (_, i) => (input.project.regels[i][0] ? [10 * (i + 1), 1, 2, 3, 4, 5, 10 * (i + 1) + 15] : Array(7).fill('')))
                return { project: { regels, material: 33, onsite: 3.3, voorbewerking: 6.6, assemblage: 9.9, montage: 13.2, afbouw: 16.5, total: 82.5 } }
            },
        }
    }

    it('sends every line of the project tab, blank ones as null, and reads back the costs', () =>
    {
        const wb = workbook()
        const pm = new ProductManager().fromSheet(wb)
            .assign('SLS', [box(38, 140, 2624), box(38, 140, 2624)], { waste: 0.15 })
            .add('montagewand', { st: 1 })
        const overview = pm.compute()

        const { regels, hoeveelheden } = wb.sent[0].project
        expect(regels).toHaveLength(10)
        expect(regels.slice(0, 3)).toEqual([['sls-38x140', null], ['montagewand', null], [null, null]])
        expect(hoeveelheden[0]).toEqual([2, 5.248, null, expect.closeTo(0.0279, 4), null, 0.15])
        expect(hoeveelheden[1]).toEqual([1, null, null, null, null, null])
        expect(hoeveelheden[9]).toEqual([null, null, null, null, null, null])

        expect(overview).toMatchObject({ material: 33, total: 82.5 })
        expect(overview.lines.map(l => l.costs?.total)).toEqual([25, 35])
        expect(pm.list()[1]!.costs).toEqual({ material: 20, onsite: 1, voorbewerking: 2, assemblage: 3, montage: 4, afbouw: 5, total: 35 })

        // components come from the outputs: a cost per m3, and costm2 or costst for the unit
        expect(() => pm.add('wall', { oppervlak: 7.5 }).add('kitchen', { st: 1 })).not.toThrow()
        expect(() => pm.add('kitchen', { oppervlak: 1 })).toThrow(/per m3 \(volume\) or per piece \(st\)/)

        // the costs belong to these lines: a change clears them
        pm.add('aftapen', { lengte: 2 })
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
        expect(pm.assign('SLS', box(38, 140, 2624)).compute().total).toBe(82.5)

        const undeclared = run((name) => { throw new Error(`$module('${name}'): no such module`) })
        expect(() => undeclared.fromSheet(URL)).toThrow(/declare it at the top of the script: \$module\('cloudcalc'\)$/)
        expect(() => new ProductManager().fromSheet(URL)).toThrow(/declare it at the top of the script/)
    })

    it('needs the sheet, and room in its project tab', () =>
    {
        expect(() => products().compute()).toThrow(/needs the sheet/)
        expect(() => new ProductManager().fromSheet({} as any)).toThrow(/expected the URL of a Google Sheet, or a workbook/)
        const pm = new ProductManager().fromSheet(workbook())
        PRODUCTS.slice(0, 11).forEach(p => pm.add(p.product_id, { st: 1 }))
        expect(() => pm.compute()).toThrow(/11 lines, but the sheet's project tab has room for 10/)
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
            tables: () => [{ name: 'prijzen' }, { name: 'bouwers' }],
            table: (name: string) => (name === 'prijzen' ? prijzen : name === 'bouwers' ? bouwers : []) as Array<Record<string, unknown>>,
            namedRanges: () => ['wanden', 'keuken', 'vlonder'].flatMap(g => ['aan', 'type', 'hoeveelheid'].map(k => ({ name: `inputs.${g}.${k}`, range: 'A1' }))),
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
    })

    it('reads its components from what the builders published, without a builder\'s own sheet', () =>
    {
        const pm = new ProductManager().fromOffer(template() as any)
        expect(pm.add('wall', { oppervlak: 3 }).add('strawwall', { oppervlak: 2 }).list().map(l => [l.id, l.kind])).toEqual([['wall', 'component'], ['strawwall', 'component']])
        expect(() => pm.add('logistiek', { st: 1 })).toThrow(/not a product, an operation or a component/)
        expect(() => new ProductManager().fromOffer(sheet() as any)).toThrow(/expected the URL of an offer template/)
    })

    it('fills a row per component group with the builder\'s component and the quantity in its unit', () =>
    {
        const wb = template()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const pm = new ProductManager().fromOffer(wb as any)
            .add('wall', { oppervlak: 7.5 }).add('wall', { oppervlak: 2.5 })
            .assign('kitchen', box(2400, 600, 900))          // a mass: 1.296 m3 at 1600 per m3 is 1.0368 kitchens of 2000
        expect(pm.offer({ scenario: 'Full Service', inputs: { floorarea_net: 54 } })).toBe(wb)

        expect(wb.sent[0]).toEqual({
            wanden: { aan: true, type: 'HSB wand', hoeveelheid: 10 },
            keuken: { aan: true, type: 'Basiskeuken', hoeveelheid: 1.04 },
            vlonder: { aan: false, type: '', hoeveelheid: 0 },
            bouwer: 'Bouwer A', scenario: 'Full Service', floorarea_net: 54,
        })

        // another builder: its own name for the wall, and no kitchen; a scenario it does not offer
        pm.offer({ bouwer: 'Bouwer B', scenario: 'DIY Full' })
        expect(wb.sent[1]).toMatchObject({ bouwer: 'Bouwer B', wanden: { aan: true, type: 'HSB wand B', hoeveelheid: 10 }, keuken: { aan: false, type: '', hoeveelheid: 0 } })
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Bouwer B does not offer the scenario 'DIY Full'/))
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Bouwer B has no price for component 'kitchen'/))

        // two alternatives of one group in the model: the row shows the first, and says so
        pm.add('strawwall', { oppervlak: 3 }).offer({ bouwer: 'Bouwer B' })
        expect(wb.sent[2].wanden).toEqual({ aan: true, type: 'HSB wand B', hoeveelheid: 10 })
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/'wall' and 'strawwall' are both in group 'wanden'/))
        warn.mockRestore()

        expect(() => pm.offer({ bouwer: 'Bouwer C' })).toThrow(/no builder 'Bouwer C' in the template; it has: Bouwer A, Bouwer B/)
        expect(() => new ProductManager().fromRows(PRODUCTS).offer()).toThrow(/needs the offer template/)
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
