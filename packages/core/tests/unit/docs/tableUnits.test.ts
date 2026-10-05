/** A table column can hold lengths: declared with `units`, its numbers follow the document's
 *  unit system. Every other column (a quantity, a price) is written exactly as it was. */
import { describe, expect, it } from 'vitest'

import { Docs } from '../../../src/docs/Docs'

const CUT_LIST = [
    { part: 'top', qty: 1, length: 3000, price: 45 },
    { part: 'leg', qty: 4, length: 750, price: 12.5 },
]

function makeDocs()
{
    return new Docs(null, {
        runner: { getActiveScope: () => ({}) },
        calc: { metrics: () => ({}) },
    } as any)
}

/** The text of every cell, row by row, in a document written in `system` */
async function cells(system:'metric'|'imperial', options?:any):Promise<Array<string>>
{
    const docs = makeDocs()
    docs._runUnitSystem = system
    const doc = docs.create('d')
    doc.page('p').table(CUT_LIST, options)
    const svg = (await doc.toSVGPages())[0].svg
    return [...svg.matchAll(/<text[^>]*dominant-baseline="middle"[^>]*>([^<]*)<\/text>/g)]
                .map(m => m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
}

describe('table column units', () =>
{
    it('writes a declared length column the imperial way in an imperial document', async () =>
    {
        const texts = await cells('imperial', { units: { length: 'mm' } })

        expect(texts.slice(0, 4)).toEqual(['part', 'qty', 'length', 'price'])
        expect(texts.slice(4, 8)).toEqual(['top', '1', `9'-10 1/8"`, '45'])
        expect(texts.slice(8, 12)).toEqual(['leg', '4', `29 1/2"`, '12.5'])
    })

    it('keeps a metric length as it is, and names its unit in the header', async () =>
    {
        const texts = await cells('metric', { units: { length: 'mm' } })

        expect(texts.slice(0, 4)).toEqual(['part', 'qty', 'length (mm)', 'price'])
        expect(texts.slice(4, 8)).toEqual(['top', '1', '3000', '45'])
    })

    it('leaves undeclared columns byte for byte as they were', async () =>
    {
        const declared = await cells('imperial', { units: { length: 'mm' } })
        const undeclared = await cells('imperial')

        const others = (texts:Array<string>) => texts.filter((_, i) => i % 4 !== 2)
        expect(others(declared)).toEqual(others(undeclared))
        expect(undeclared).toContain('3000') // nothing converts without a declaration
    })
})
