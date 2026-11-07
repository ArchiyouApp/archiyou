import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The URBUILD library (Apps Script): the buttons of the core sheet and of a builder sheet, see
 * src/products/apps-script/common.gs. Its plain functions are loaded here as they are.
 */
const dir = path.resolve(import.meta.dirname, '../../../src/products/apps-script')
const code = ['common.gs', 'core.gs', 'builder.gs'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
const gs = new Function(`${code}\nreturn { productLabel, mergeRows, withSpecs, coreColumns, coreBlocks, productLabels,
    seedComponent, offerPriceRows, expiredBuilders, componentRows, builderRow, scenariosOf, placeSeeds,
    BUILDER_INPUTS, PRICE_HEADER }`)()

/** The header of the core's tab componenten, as on 2026-11-03 (voorbewerkingskosten with an s). */
const HEADER = ['component', 'gebouwdeel', 'componentgroep', 'naam (in de offerte)', 'representatieve breedte (mm)', 'representatieve hoogte (mm)',
    'representatieve diepte (mm)', 'representatieve maat', 'eenheid maat', 'bouwdeel', 'fase', 'product', 'bewerking', 'omschrijving',
    'stuks (totaal)', 'lengte (totaal m1)', 'oppervlak (totaal m2)', 'volume (totaal m3)', 'zaaglengte (totaal m1)', 'materiaalverlies',
    'vorm / werkeenheid', 'prijseenheid', 'eenheidsprijs', 'hoeveelheid in prijseenheid', 'materiaalkosten', 'onsitekosten',
    'voorbewerkingskosten', 'assemblagekosten', 'montagekosten', 'afbouwkosten', 'totale kosten', 'arbeidstijd (uur)']
const col = (name: string) => HEADER.indexOf(name)

/** A row of the core's componenten tab from the columns that matter. */
function row(values: Record<string, unknown>): Array<unknown>
{
    return HEADER.map((h) => values[h] ?? '')
}

/** A wall block: 6 studs at 600 and three plates of 3000, sheathing, insulation between studs, screws, tape in m1. */
const WALL = [
    row({ component: 'hsbwand', gebouwdeel: 'casco', componentgroep: 'wanden', 'naam (in de offerte)': 'HSB wand', 'representatieve breedte (mm)': 3000,
        'representatieve hoogte (mm)': 2700, 'representatieve diepte (mm)': 263.5, 'representatieve maat': 8.1, 'eenheid maat': 'm2', fase: 'materiaal', product: 'sls-38x235',
        omschrijving: '6 stijlen van 2624 mm h.o.h. 600 mm, onderregel en dubbele bovenregel 3 x 3000 mm', prijseenheid: 'm1',
        eenheidsprijs: 5.02, 'hoeveelheid in prijseenheid': 24.74, materiaalkosten: 136.61 }),
    // an operation names the product it works on: not a material line
    row({ fase: 'voorbewerking', product: 'sls-38x235', bewerking: 'afkorten', omschrijving: '2 per stuk', prijseenheid: 'st', eenheidsprijs: 0.4, 'hoeveelheid in prijseenheid': 18, voorbewerkingskosten: 7.2 }),
    row({ fase: 'materiaal', product: 'buitenplaat-16', omschrijving: 'buitenzijde', prijseenheid: 'm2', eenheidsprijs: 10.8, 'hoeveelheid in prijseenheid': 8.1, materiaalkosten: 100.6 }),
    row({ fase: 'materiaal', product: 'flex-240', omschrijving: '5 vakken', prijseenheid: 'm2', eenheidsprijs: 26.09, 'hoeveelheid in prijseenheid': 7.37, materiaalkosten: 201.9 }),
    row({ fase: 'materiaal', product: 'schroef-4.5x50', omschrijving: 'om de 150 mm', prijseenheid: 'st', eenheidsprijs: 0.05, 'hoeveelheid in prijseenheid': 150, materiaalkosten: 7.87 }),
    row({ fase: 'materiaal', product: 'tape-60', omschrijving: 'naden', prijseenheid: 'm1', eenheidsprijs: 0.71, 'hoeveelheid in prijseenheid': 26.4, materiaalkosten: 19.7 }),
    row({ fase: 'montage', bewerking: 'montagewand', omschrijving: 'het element plaatsen', montagekosten: 150 }),
    row({ product: 'sls-38x235, buitenplaat-16', omschrijving: 'TOTAAL representatief element', materiaalkosten: 466.68, onsitekosten: 0,
        voorbewerkingskosten: 105.6, assemblagekosten: 233, montagekosten: 167.1, afbouwkosten: 129.6 }),
    row({ omschrijving: 'per m2, excl. marges', 'totale kosten': 140.42 }),
    row({ omschrijving: 'per m2, incl. marges (vergelijk met ELEMENTEN)', 'totale kosten': 154.47 }),
    row({ omschrijving: 'per m3, incl. marges', 'totale kosten': 586.21 }),
]
const KITCHEN = [
    row({ component: 'keuken', gebouwdeel: 'interieur', componentgroep: 'keuken', 'naam (in de offerte)': 'Basiskeuken', 'representatieve breedte (mm)': 2400,
        'representatieve hoogte (mm)': 900, 'representatieve diepte (mm)': 600, 'representatieve maat': 1, 'eenheid maat': 'st', fase: 'materiaal', product: 'keukenblok', omschrijving: 'blok',
        prijseenheid: 'st', eenheidsprijs: 1200, 'hoeveelheid in prijseenheid': 1, materiaalkosten: 1200 }),
    row({ fase: 'materiaal', product: 'onbekend-ding', omschrijving: '?', prijseenheid: 'st', eenheidsprijs: 5, 'hoeveelheid in prijseenheid': 2, materiaalkosten: 10 }),
    row({ omschrijving: 'TOTAAL representatief element (1 stuk)', materiaalkosten: 1210, montagekosten: 100 }),
    row({ omschrijving: 'per stuk, incl. marges', 'totale kosten': 1441 }),
]
const PRODUCTS = [
    { product_id: 'sls-38x235', type: 'SLS-regel, C24', vorm: 'balk', breedte: 38, hoogte: 235 },
    { product_id: 'gyp-12.5-1200', type: 'Gipsplaat, standaard', vorm: 'plaat', dikte: 12.5, breedte: 1200 },
    { product_id: 'siteboard-32x200', type: 'Bouwplank (gezaagd, geniet)', vorm: 'plaat', dikte: 32 },
    { product_id: 'washbasin', type: 'Wastafel', vorm: 'stuk', breedte: 500 },
]
/** The core's CO2 (A1-A3, A4-C4, D) and Rc per component. */
const SPECS = new Map([['hsbwand', { gwp: [-40.8, 61.9, -11.4], rc: 5.24 }], ['keuken', { gwp: ['', '', ''], rc: '' }]])

describe('URBUILD library: the core', () =>
{
    it('finds the core\'s columns by name, also voorbewerkingskosten with an s', () =>
    {
        const c = gs.coreColumns(HEADER)
        expect([c.fase, c.product, c.voorbewerking, c.afbouw, c.totaal]).toEqual([col('fase'), col('product'), col('voorbewerkingskosten'), col('afbouwkosten'), col('totale kosten')])
        expect(() => gs.coreColumns(['component', 'product'])).toThrow(/kolommen niet gevonden: gebouwdeel/)
    })

    it('reads a block per component: its material lines, its labour per phase and its price per unit incl. margins', () =>
    {
        const [wall, kitchen] = gs.coreBlocks(HEADER, [...WALL, row({}), ...KITCHEN])
        expect(wall).toMatchObject({ id: 'hsbwand', groep: 'wanden', breedte: 3000, hoogte: 2700, maat: 8.1, eenheid: 'm2', baseline: 154.47 })
        // the operation afkorten names its product, sls-38x235, but is not a material line
        expect(wall.lines.map((l: any) => l.product)).toEqual(['sls-38x235', 'buitenplaat-16', 'flex-240', 'schroef-4.5x50', 'tape-60'])
        expect(wall.costs).toEqual({ onsite: 0, voorbewerking: 105.6, assemblage: 233, montage: 167.1, afbouw: 129.6, material: 466.68 })
        expect(kitchen).toMatchObject({ id: 'keuken', eenheid: 'st', baseline: 1441 })
    })

    it('seeds a builder row: the core\'s material per unit, the hours of the core, the products as the offer names them', () =>
    {
        const [wall] = gs.coreBlocks(HEADER, WALL)
        const labels = new Map([['sls-38x235', 'SLS-regel 38x235'], ['flex-240', 'Houtvezel flex 240 mm']])
        const seed = gs.seedComponent(wall, labels, 40)
        expect(seed.inputs).toEqual(['hsbwand', 'casco', 'wanden', 'HSB wand', '', 3000, 2700, 263.5, 'm2'])
        expect(seed.inputs.length).toBe(gs.BUILDER_INPUTS.length)
        // the TOTAAL row's material over the representative 8.1 m2, excl. margins
        expect(seed.material).toBeCloseTo(466.68 / 8.1, 4)
        expect(seed.hours).toEqual([0, 2.64, 5.83, 4.18, 3.24])
        expect(seed.baseline).toBe(154.47)
        // a product without a label keeps its id
        expect(seed.omschrijving).toBe('SLS-regel 38x235, buitenplaat-16, Houtvezel flex 240 mm, schroef-4.5x50, tape-60')
        expect(seed.notes).toEqual([])
    })

    it('seeds a piece per piece, and says what to check: a size that is not the core\'s, no TOTAAL row', () =>
    {
        const [, kitchen] = gs.coreBlocks(HEADER, [...WALL, ...KITCHEN])
        const seed = gs.seedComponent(kitchen, new Map(), 40)
        expect(seed.inputs[gs.BUILDER_INPUTS.indexOf('eenheid')]).toBe('st')
        expect([seed.material, seed.hours]).toEqual([1210, [0, 0, 0, 2.5, 0]])

        const [wall] = gs.coreBlocks(HEADER, [WALL[0], WALL[2]].map((r) => r.map((v, i) => (i === col('representatieve maat') && v ? 9 : v))))
        const rough = gs.seedComponent(wall, new Map(), 40)
        expect(rough.material).toBeCloseTo((136.61 + 100.6) / 9, 4)
        expect(rough.hours).toEqual([0, 0, 0, 0, 0])
        expect(rough.notes).toEqual(['maat 8.1 m2 uit breedte en hoogte tegen 9 in het core-sheet: de uren per eenheid wijken af', 'geen TOTAAL-regel: uren op 0'])
    })

    it('labels the core\'s products by their id', () =>
    {
        const header = ['product_id', 'type', 'vorm', 'dikte', 'breedte', 'hoogte']
        const labels = gs.productLabels(header, [['sls-38x235', 'SLS-regel, C24', 'balk', '', 38, 235], ['gips', 'Gipsplaat, standaard', 'plaat', 12.5, 1200, ''], ['', '', '', '', '', '']])
        expect([...labels]).toEqual([['sls-38x235', 'SLS-regel 38x235'], ['gips', 'Gipsplaat 12.5 mm']])
    })

    it('publishes to the offer: its fixed rows kept, every builder\'s rows with the core\'s CO2 and Rc', () =>
    {
        const width = gs.PRICE_HEADER.length
        const priceRow = (bouwer: string, component: string) => [bouwer, '', 'casco', 'wanden', component, 'HSB wand', '', 'm2',
            60, 0, 15, 30, 25, 20, 150, 600, 1, 2, 3, 1.96, 7.44]
        const offer = [['alle', '', 'LOGISTIEK', 'logistiek', 'logistiek', 'Logistiek', '', 'dag', 1500, ...new Array(width - 9).fill('')],
            priceRow('Bouwer Oud', 'hsbwand')]
        const rows = gs.offerPriceRows(offer, [priceRow('URBUILD', 'hsbwand'), priceRow('Bouwer Eik', 'eigen-wand'), new Array(width).fill('')], SPECS)
        expect(rows.map((r: any[]) => [r[0], r[4]])).toEqual([['alle', 'logistiek'], ['URBUILD', 'hsbwand'], ['Bouwer Eik', 'eigen-wand']])
        // CO2 and Rc of the core where the component is the core's; the hours stay the builder's
        expect(rows[1].slice(16)).toEqual([-40.8, 61.9, 5.24, 1.96, 7.44])
        expect(rows[2].slice(16)).toEqual([1, 2, 3, 1.96, 7.44])
    })

    it('says whose prices are no longer valid', () =>
    {
        const today = new Date('2026-11-03')
        const builders = [['URBUILD', '', true, 21, new Date('2026-12-31')], ['Bouwer Eik', '', true, 21, new Date('2026-10-31')],
            ['Bouwer Linde', '', true, 21, ''], ['', '', '', '', new Date('2020-01-01')]]
        expect(gs.expiredBuilders(builders, today)).toEqual(['Bouwer Eik'])
    })
})

describe('URBUILD library: a builder sheet', () =>
{
    it('names a product by its type and the size that tells it apart, as ProductManager.prices() does', () =>
    {
        expect(PRODUCTS.map(gs.productLabel)).toEqual(['SLS-regel 38x235', 'Gipsplaat 12.5 mm', 'Bouwplank (gezaagd, geniet) 32 mm', 'Wastafel'])
    })

    it('publishes its component rows: the prices per unit, its own hours, the core\'s CO2 and Rc', () =>
    {
        const date = new Date('2026-11-03')
        const header = ['component', 'gebouwdeel', 'groep', 'naam (in de offerte)', 'variant van', 'eenheid', 'maat', 'volume (m3)',
            'totale tijd (uur)', 'material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw', 'totaal per eenheid', 'totaal per m3', 'omschrijving']
        const rows = gs.componentRows([
            header,
            ['hsbwand', 'casco', 'wanden', 'HSB wand', '', 'm2', 8.1, 2.13, 15.9, 68.2, 0, 14.3, 31.6, 22.7, 17.6, 154.4, 587.7, 'SLS-regel 38x235, Gipsplaat 12.5 mm'],
            ['hsbwand-160', 'casco', 'wanden', 'HSB wand 160', 'hsbwand', 'm2', 8.1, 1.46, 15.9, 58, 0, 14.3, 31.6, 22.7, 17.6, 144.2, 788.7, 'SLS-regel 38x235'],
            ['keuken', 'interieur', 'keuken', 'Basiskeuken', '', 'st', 1, '', 9, 1660, 0, 150, 95, 110, 55, 2070, '', ''],
            ['schets', 'casco', '', 'Zonder groep', '', 'm2', 1, 1, 0, 10, 0, 0, 0, 0, 0, 10, '', ''],       // no group: not published
            ['leeg', 'casco', 'wanden', 'Zonder prijs', '', 'm2', 1, 1, 0, '', '', '', '', '', '', '', '', ''],  // no price yet
            new Array(header.length).fill(''),
        ], 'Bouwer Eik', date, SPECS)
        expect(rows.map((r: any[]) => r.slice(0, 8))).toEqual([
            ['Bouwer Eik', date, 'casco', 'wanden', 'hsbwand', 'HSB wand', 'SLS-regel 38x235, Gipsplaat 12.5 mm', 'm2'],
            ['Bouwer Eik', date, 'casco', 'wanden', 'hsbwand-160', 'HSB wand 160', 'SLS-regel 38x235', 'm2'],
            ['Bouwer Eik', date, 'interieur', 'keuken', 'keuken', 'Basiskeuken', '', 'st'],
        ])
        expect(rows[0].length).toBe(gs.PRICE_HEADER.length)
        // the six categories, their sum, per m3, the core's GWP A1-A3, A4-C4 and Rc, the hours per unit and per m3
        expect(rows[0].slice(8)).toEqual([68.2, 0, 14.3, 31.6, 22.7, 17.6, expect.closeTo(154.4, 6), 587.7, -40.8, 61.9, 5.24,
            expect.closeTo(15.9 / 8.1, 6), expect.closeTo(15.9 / 2.13, 6)])
        // a variant has the CO2 and Rc of the component it is a variant of
        expect(rows[1].slice(16, 19)).toEqual([-40.8, 61.9, 5.24])
        // blank when unknown: the kitchen has no CO2 or volume
        expect(rows[2].slice(14)).toEqual([2070, '', '', '', '', 9, ''])

        expect(() => gs.componentRows([['component', 'groep']], 'Bouwer Eik', date, SPECS)).toThrow(/mist de kolommen: gebouwdeel, naam \(in de offerte\), eenheid/)
    })

    it('gives its row of the tab bouwers: the scenarios in the order of that tab, the surcharges, until when', () =>
    {
        const date = new Date('2026-11-03')
        const until = new Date('2026-12-31')
        const header = ['bouwer', 'prijspeil', 'Full Service', 'DIY Casco Afbouw', 'DIY Bouwpakket', 'DIY Full', 'projectkosten', 'bouwplaats',
            'bedrijfskosten', 'risico', 'winst', 'btw', 'doe-het-zelf factor', 'geldig tot']
        const scenarios = gs.scenariosOf(header)
        expect(scenarios).toEqual(['Full Service', 'DIY Casco Afbouw', 'DIY Bouwpakket', 'DIY Full'])
        const row = gs.builderRow('Bouwer Eik', date, scenarios, { 'DIY Full': true, 'Full Service': true, 'DIY Bouwpakket': false },
            { projectkosten: 2, bouwplaats: 2, bedrijfskosten: 5, risico: 3, winst: 8, btw: 21 }, 1.5, until)
        expect(row).toEqual(['Bouwer Eik', date, true, false, false, true, 2, 2, 5, 3, 8, 21, 1.5, until])
        expect(row.length).toBe(header.length)

        const existing = [['Bouwer Linde', 1], ['Bouwer Eik', 'old'], ['', ''], ['Bouwer Eik', 'old 2']]
        expect(gs.mergeRows(existing, 'Bouwer Eik', [['Bouwer Eik', 'new']])).toEqual([['Bouwer Linde', 1], ['Bouwer Eik', 'new']])
    })

    it('places the core\'s components: a row it has where it is, new ones after the last, the builder\'s own kept', () =>
    {
        const ids = ['hsbwand', 'hsbwand-160', '', 'keuken', '', '']
        const placed = gs.placeSeeds(ids, [{ id: 'keuken' }, { id: 'dak' }, { id: 'hsbwand' }, { id: 'vlonder' }])
        expect(placed.map((p: any) => [p.seed.id, p.row, p.appended])).toEqual([['keuken', 6, false], ['dak', 7, true], ['hsbwand', 3, false], ['vlonder', 8, true]])
    })
})
