import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * publish-prices.gs: the button of a product sheet that publishes a builder's prices to the offer
 * template. Apps Script; its plain functions are loaded here as they are.
 */
const code = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/products/publish-prices.gs'), 'utf8')
const gs = new Function(`${code}\nreturn { productLabel, componentIds, priceRows, builderRow, mergeRows }`)()

const PRODUCTS = [
    { product_id: 'sls-38x235', type: 'SLS-regel, C24', vorm: 'balk', breedte: 38, hoogte: 235 },
    { product_id: 'gyp-12.5-1200', type: 'Gipsplaat, standaard', vorm: 'plaat', dikte: 12.5, breedte: 1200 },
    { product_id: 'siteboard-32x200', type: 'Bouwplank (gezaagd, geniet)', vorm: 'plaat', dikte: 32 },
    { product_id: 'washbasin', type: 'Wastafel', vorm: 'stuk', breedte: 500 },
]

describe('publish-prices.gs', () =>
{
    it('names a product by its type and the size that tells it apart, as ProductManager.prices() does', () =>
    {
        expect(PRODUCTS.map(gs.productLabel)).toEqual(['SLS-regel 38x235', 'Gipsplaat 12.5 mm', 'Bouwplank (gezaagd, geniet) 32 mm', 'Wastafel'])
    })

    it('finds the components by their outputs: a cost per m3, per unit, by category, a group and a name', () =>
    {
        const names = ['outputs.wall.costm2', 'outputs.wall.costm3', 'outputs.wall.costs', 'outputs.wall.groep', 'outputs.wall.naam',
            'outputs.kitchen.costst', 'outputs.kitchen.costm3', 'outputs.kitchen.costs', 'outputs.kitchen.groep', 'outputs.kitchen.naam',
            'outputs.heating.costst', 'outputs.heating.costm3', 'outputs.project.total']
        expect(gs.componentIds(names)).toEqual(['wall', 'kitchen'])
    })

    it('writes a row per component under the builder\'s name, and replaces only that builder\'s rows', () =>
    {
        const date = new Date('2026-10-30')
        const rows = gs.priceRows([
            { id: 'wall', gebouwdeel: 'casco', groep: 'wanden', naam: 'HSB wand', unit: 'm2', costs: [60, 0, 15, 30, 25, 20], costm3: 600,
                producten: 'sls-38x235, gyp-12.5-1200, sls-38x235, unknown' },
        ], PRODUCTS, 'Bouwer Eik', date)
        expect(rows).toEqual([['Bouwer Eik', date, 'casco', 'wanden', 'wall', 'HSB wand', 'SLS-regel 38x235, Gipsplaat 12.5 mm', 'm2',
            60, 0, 15, 30, 25, 20, 150, 600]])

        const existing = [['Bouwer Linde', 1], ['Bouwer Eik', 'old'], ['', ''], ['Bouwer Eik', 'old 2']]
        expect(gs.mergeRows(existing, 'Bouwer Eik', [['Bouwer Eik', 'new']])).toEqual([['Bouwer Linde', 1], ['Bouwer Eik', 'new']])
    })

    it('gives a builder\'s scenarios in the order of the offer sheet, and the surcharges', () =>
    {
        const date = new Date('2026-10-30')
        const row = gs.builderRow('Bouwer Eik', date, ['Full Service', 'DIY Casco Afbouw', 'DIY Bouwpakket', 'DIY Full'],
            { 'DIY Full': true, 'Full Service': true, 'DIY Bouwpakket': false },
            { projectkosten: 2, bouwplaats: 2, bedrijfskosten: 5, risico: 3, winst: 8, btw: 21 })
        expect(row).toEqual(['Bouwer Eik', date, true, false, false, true, 2, 2, 5, 3, 8, 21])
    })
})
