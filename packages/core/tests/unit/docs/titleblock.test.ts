/** The titleblock says what the drawing's bare numbers are in.
 *
 *  A metric drawing writes its dimensions without a unit, on the understanding that the unit
 *  is stated once, in the titleblock — so it has to be. An imperial one needs no such note:
 *  every value carries its own marks.
 */
import { describe, expect, it } from 'vitest'

import { Docs } from '../../../src/docs/Docs'

function makeDocs(modeler?:any)
{
    return new Docs(null, {
        runner: { getActiveScope: () => ({}) },
        calc: { metrics: () => ({}) },
        modeler,
    } as any)
}

async function titleblockPage(docs:Docs):Promise<string>
{
    const doc = docs.create('sheet')
    // an inline logo, so nothing is fetched
    doc.page('p').titleblock({ title: 'Units', designer: 'Archiyou', logoUrl: 'data:image/png;base64,iVBORw0KGgo=' })
    return (await doc.toSVGPages())[0].svg
}

describe('titleblock unit note', () =>
{
    it('names the unit of the dimensions on a metric drawing', async () =>
    {
        expect(await titleblockPage(makeDocs())).toContain('All dimensions in mm')
    })

    it('names mm whatever unit the model is in, which is what the bare numbers are in', async () =>
    {
        const modeler = { units: () => 'cm' }
        expect(await titleblockPage(makeDocs(modeler))).toContain('All dimensions in mm')
    })

    it('leaves it out on an imperial drawing', async () =>
    {
        const svg = await titleblockPage(makeDocs({ units: () => 'inch' }))

        expect(svg).toContain('Units') // the titleblock is there
        expect(svg).not.toContain('All dimensions in')
    })

    it('can be set like the other titleblock texts', async () =>
    {
        const docs = makeDocs()
        const doc = docs.create('sheet')
        doc.page('p').titleblock({ title: 'Units', logoUrl: 'data:image/png;base64,iVBORw0KGgo=' })
        doc.set('titleblock:units', 'Dimensions in mm unless noted')
        expect((await doc.toSVGPages())[0].svg).toContain('Dimensions in mm unless noted')
    })
})
