import { describe, it, expect } from 'vitest'

import { offerPageData, renderOfferHtml, sheetDate, type OfferSource } from '../../../src/products/offer-html'
import { ProductManager } from '../../../src/products/ProductManager'
import type { Table } from '../../../src/calc/Table'
import { Calc } from '../../../src/calc/Calc'

/** A row of tables.bouwkosten, keyed by the template's header (row 4 of BOUWKOSTEN). */
function line(aan: unknown, onderdeel: string, rest: Partial<Record<string, unknown>> = {}): Record<string, unknown>
{
    return {
        aan, onderdeel, Type: '', Specificatie: '', Kwantiteit: '', Eenheid: '', 'Prijs per eenheid': '',
        Materiaal: '', Onsite: '', Voorbewerking: '', Assemblage: '', Montage: '', Afbouw: '', 'Totaal (incl. BTW)': '', ...rest,
    }
}

/** What a computed URBUILD_CLIENT_OFFER_TEMPLATE gives: a wall row in DIY Bouwpakket, logistics, an unticked row. */
function source(): OfferSource
{
    return {
        bouwkosten: [
            line(1, 'FUNDERING'),
            line(false, 'Fundering', { Type: 'Schroeffundering', Kwantiteit: 0, Eenheid: 'm2' }),
            line(2, 'CASCO'),
            line(true, 'Wanden', { Type: 'HSB wand 160', Specificatie: 'SLS-regel 38x235, Gipsplaat 12.5 mm <glued>', Kwantiteit: 10, Eenheid: 'm2',
                'Prijs per eenheid': 165.78, Materiaal: 990.14, Onsite: 0, Voorbewerking: 208.24, Assemblage: 459.44, Montage: 'DIY', Afbouw: 'DIY',
                'Totaal (incl. BTW)': 1657.82 }),
            line(8, 'LOGISTIEK'),
            line('', 'Wordt grotendeels bepaald door de bereikbaarheid'),
            line(true, 'Logistiek', { Type: 'Logistiek (< 100 km)', Kwantiteit: 1, Eenheid: 'dag', 'Prijs per eenheid': 1815, Materiaal: 1815,
                Onsite: 0, Voorbewerking: 0, Assemblage: 0, Montage: 'DIY', Afbouw: 'DIY', 'Totaal (incl. BTW)': 1815 }),
        ],
        proces: [
            { aan: 1, onderdeel: 'Online kleurplaat', 'Optie prijs': '', 'Prijs incl. BTW.': '', Condities: '' },
            { aan: '', onderdeel: 'Je kunt gratis online een basisontwerp maken', 'Optie prijs': '', 'Prijs incl. BTW.': 0, Condities: '' },
            { aan: 3, onderdeel: 'Schetsontwerp sessie', 'Optie prijs': '', 'Prijs incl. BTW.': '', Condities: '' },
            { aan: '', onderdeel: 'Schetsontwerp met positionering op kavel', 'Optie prijs': '', 'Prijs incl. BTW.': 250, Condities: 'kwijtgescholden bij bouw' },
            { aan: false, onderdeel: 'Bezoek bouwlocatie', 'Optie prijs': 250, 'Prijs incl. BTW.': 0, Condities: '' },
            { aan: 6, onderdeel: 'Vergunningsaanvraag', 'Optie prijs': '', 'Prijs incl. BTW.': '', Condities: '' },
            { aan: true, onderdeel: 'Constructieberekeningen', 'Optie prijs': 1500, 'Prijs incl. BTW.': 1500, Condities: '' },
            { aan: '', onderdeel: 'Architectendiensten SUBTOTAAL', 'Optie prijs': '', 'Prijs incl. BTW.': 1750, Condities: '' },
            { aan: 9, onderdeel: 'Bouw', 'Optie prijs': '', 'Prijs incl. BTW.': '', Condities: '' },
            { aan: '', onderdeel: 'Vanaf deze fase de bouwer', 'Optie prijs': '', 'Prijs incl. BTW.': '', Condities: 'Zie BOUWKOSTEN tab' },
            { aan: '', onderdeel: 'TOTAAL PROCESKOSTEN', 'Optie prijs': '€', 'Prijs incl. BTW.': 1750, Condities: 'incl. BTW' },
        ],
        scenarios: [
            { kosten: 'material', 'Full Service': true, 'DIY Bouwpakket': true },
            { kosten: 'montage', 'Full Service': true, 'DIY Bouwpakket': false },
        ],
        bouwers: [{ bouwer: 'Bouwer C', prijspeil: 46325 }],
        outputs: { bouwkosten: { subtotaal: 3472.82, totaal: 4166.8, excl_btw: 3443.64, per_m2: 138.89, per_m3: 64.1, incl_proces: 5916.8 } },
        input: { bouwer: 'Bouwer C', scenario: 'DIY Bouwpakket', floorarea_net: 30 },
    }
}

describe('offer-html: the offer as data', () =>
{
    it('takes the ticked rows per section, with their costs by category, DIY where the client does it', () =>
    {
        const data = offerPageData(source(), { klant: 'Fam. Jansen', datum: new Date('2026-10-30') })
        expect(data.categories).toEqual(['Materiaal', 'Onsite', 'Voorbewerking', 'Assemblage', 'Montage', 'Afbouw'])
        expect(data.sections.map(s => [s.titel, s.toelichting, s.lines.map(l => l.type)])).toEqual([
            ['CASCO', '', ['HSB wand 160']],
            ['LOGISTIEK', 'Wordt grotendeels bepaald door de bereikbaarheid', ['Logistiek (< 100 km)']],
        ])
        expect(data.sections[0]!.lines[0]).toMatchObject({ hoeveelheid: 10, eenheid: 'm2', prijs: 165.78, totaal: 1657.82,
            costs: [990.14, 0, 208.24, 459.44, 'DIY', 'DIY'] })
    })

    it('adds up the surcharges and BTW from the template\'s outputs, and names the builder\'s price date', () =>
    {
        const data = offerPageData(source())
        expect(data.totals).toMatchObject({ subtotaal: 3472.82, totaal: 4166.8, exclBtw: 3443.64, perM2: 138.89, inclProces: 5916.8 })
        expect(data.totals.opslagen).toBeCloseTo(693.98, 6)
        expect(data.totals.btw).toBeCloseTo(723.16, 6)
        expect(data.prijspeil?.toISOString().slice(0, 10)).toBe('2026-10-30')
        expect(data.gebouw).toEqual([{ label: 'Netto vloeroppervlak', value: 30, unit: 'm²' }])
        expect(sheetDate('')).toBeNull()
        expect(sheetDate('2026-10-30')?.toISOString().slice(0, 10)).toBe('2026-10-30')
    })

    it('lists the process steps with a price and the ticked options, and who does what per scenario', () =>
    {
        const data = offerPageData(source())
        expect(data.proces.items).toEqual([
            { titel: 'Schetsontwerp sessie', prijs: 250, conditie: 'kwijtgescholden bij bouw' },
            { titel: 'Constructieberekeningen', prijs: 1500, conditie: '' },
        ])
        expect(data.proces.totaal).toBe(1750)
        expect(data.scenarios).toEqual({ categories: ['material', 'montage'], names: ['Full Service', 'DIY Bouwpakket'], delivers: [[true, true], [true, false]] })
    })
})

describe('offer-html: the page', () =>
{
    it('is one self-contained page: no scripts, no external files, everything escaped', () =>
    {
        const html = renderOfferHtml(offerPageData(source(), { klant: 'Fam. <Jansen>', datum: new Date('2026-10-30') }))
        expect(html.startsWith('<!doctype html>')).toBe(true)
        expect(html).not.toMatch(/<script|<link|src=|https?:\/\//)
        expect(html).toContain('Fam. &lt;Jansen&gt;')
        expect(html).toContain('Gipsplaat 12.5 mm &lt;glued&gt;')
        expect(html).not.toContain('<glued>')
    })

    it('shows the lines, the client\'s own part, the totals, the scenario chosen and the process', () =>
    {
        const html = renderOfferHtml(offerPageData(source(), { datum: new Date('2026-10-30') }))
        const euro = (v: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(v)
        expect(html).toContain('HSB wand 160')
        expect(html).toContain(euro(1657.82))
        expect(html).toContain('Montage zelf')
        expect(html).toContain(`<td class="n">${euro(4166.8)}</td>`)
        expect(html).toContain(`waarvan BTW ${euro(723.16)}, excl. BTW ${euro(3443.64)}`)
        expect(html).toMatch(/<th class="chosen">DIY Bouwpakket<\/th>/)
        expect(html).toContain('Constructieberekeningen')
        expect(html).toContain('30 oktober 2026')
        expect(html).toContain('@page { size: A4')
    })
})

describe('ProductManager: the offer page', () =>
{
    /** A computed template as cloudcalc gives it: tables by name, the outputs of the last inputs. */
    function template()
    {
        const s = source()
        const tables: Record<string, Array<Record<string, unknown>>> = {
            bouwersprijzen: [{ bouwer: 'Bouwer C', gebouwdeel: 'casco', groep: 'wanden', component: 'hsbwand-160', naam: 'HSB wand 160', eenheid: 'm2', 'totaal per eenheid': 144.73, 'totaal per m3': 788.7 }],
            bouwers: [{ bouwer: 'Bouwer C', prijspeil: 46325, 'DIY Bouwpakket': true }],
            bouwkosten: s.bouwkosten, proces: s.proces!, scenarios: s.scenarios!,
        }
        return {
            tables: () => Object.keys(tables).map(name => ({ name })),
            table: (name: string) => tables[name] ?? [],
            namedRanges: () => [{ name: 'inputs.wanden', range: 'A1' }],
            compute: () => s.outputs,
        }
    }

    it('renders the last offer, and needs one', () =>
    {
        const pm = new ProductManager().fromOffer(template() as any)
        expect(() => pm.offerHtml()).toThrow(/needs an offer first/)
        pm.add('hsbwand-160', { oppervlak: 10 }).offer({ bouwer: 'Bouwer C', scenario: 'DIY Bouwpakket' })
        const html = pm.offerHtml({ klant: 'Fam. Jansen' })
        expect(html).toContain('Fam. Jansen')
        expect(html).toContain('Bouwer C')
    })

    it('gives the page as a table output: the lines as rows, the page as its html', () =>
    {
        const calc = new Calc()
        calc.setArchiyou({} as any)
        const pm = new ProductManager(() => ({ calc }) as any).fromOffer(template() as any)
        pm.add('hsbwand-160', { oppervlak: 10 }).offer({ bouwer: 'Bouwer C', scenario: 'DIY Bouwpakket' })
        const table = pm.offerPage('offerte')
        expect(calc.db.table('offerte')).toBe(table)
        expect(table.columns()).toEqual(['onderdeel', 'type', 'specificatie', 'hoeveelheid', 'eenheid', 'prijs per eenheid',
            'Materiaal', 'Onsite', 'Voorbewerking', 'Assemblage', 'Montage', 'Afbouw', 'totaal'])
        expect(table.toData()).toHaveLength(2)
        expect(table.toHtml()).toBe(pm.offerHtml())
    })

    it('says when the template has no table bouwkosten', () =>
    {
        const wb = template()
        const pm = new ProductManager().fromOffer({ ...wb, tables: () => [{ name: 'bouwersprijzen' }, { name: 'bouwers' }] } as any)
        pm.add('hsbwand-160', { oppervlak: 10 }).offer({ bouwer: 'Bouwer C' })
        expect(() => pm.offerHtml()).toThrow(/no table bouwkosten/)
    })
})

describe('Table.toHtml()', () =>
{
    it('is a flat page of the rows, or the page attached with html()', () =>
    {
        const calc = new Calc()
        calc.setArchiyou({} as any)
        const t = calc.table('parts', [{ part: 'stud <a>', length: 2624 }, { part: 'plate', length: 3000 }]) as Table
        const page = calc.db.toTableHtml('parts')['parts']!
        expect(page).toContain('<title>parts</title>')
        expect(page).toContain('<td>stud &lt;a&gt;</td><td class="n">2624</td>')
        expect(page).not.toMatch(/<script/)
        expect(t.toHtml('Onderdelen')).toContain('<h1>Onderdelen</h1>')
        expect(t.html('<p>offer</p>').toHtml()).toBe('<p>offer</p>')
        expect(() => t.html(42 as any)).toThrow(/expected the page as a string/)
    })
})
