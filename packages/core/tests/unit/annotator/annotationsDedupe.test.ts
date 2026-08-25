/** An annotation is linked from both ends and must still be drawn once.
 *
 *  A dimension line links itself to the Shape it measures (DimensionLine.link()) and the
 *  Annotator adds it to the collection it dimensioned as well, so the same object sits in two
 *  lists. brep's getAnnotations() concatenated both without deduping, so every dimension of
 *  an auto-dimensioned part came out of toSVG() TWICE, drawn exactly on top of itself.
 *  meshup's collection has always deduped.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

async function setup(kernel:'mesh'|'brep')
{
    const modeler = new Modeler()
    modeler.mode(kernel)   // before load(): load() only pulls in the brep WASM for brep mode
    await modeler.load()
    const annotator = new Annotator()
    const modules = { modeler, annotator } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    annotator.setArchiyou(modules)
    return { modeler, annotator }
}

const dimCount = (svg:string) => (svg.match(/class="dimensionline"/g) ?? []).length

describe.each(['mesh','brep'] as const)('annotation dedupe (%s kernel)', (kernel) =>
{
    it('draws an auto-dimensioned part once per dimension', async () =>
    {
        const { modeler, annotator } = await setup(kernel)

        const rect = modeler.rect(400, 500) as any
        rect.autoDim()

        // NOTE: the ACTIVE kernel's collection class. Modeler.collection() always builds a
        // meshup one (Modeler.ts:709), which silently drops brep shapes.
        const collection = new (modeler.classes.ShapeCollection as any)(rect) as any
        const unique = new Set(collection.getAnnotations()).size

        expect(collection.getAnnotations().length).toBe(unique)
        expect(dimCount(collection.toSVG())).toBe(annotator.getAnnotations().length)
    })

    it('links the same annotation from Shape and collection without doubling it', async () =>
    {
        const { modeler } = await setup(kernel)

        const rect = modeler.rect(200, 200) as any
        // an edge OF the rect — a bbox side is a throwaway Shape with no modeler behind it,
        // so it cannot reach the annotator (see Annotator.autoDimPart)
        const dim = rect.edges().first().dim()         // links itself to the Shape

        // NOTE: the ACTIVE kernel's collection class. Modeler.collection() always builds a
        // meshup one (Modeler.ts:709), which silently drops brep shapes.
        const collection = new (modeler.classes.ShapeCollection as any)(rect) as any
        collection.addAnnotations(dim)                 // and now to the collection too
        collection.addAnnotations(dim)                 // twice, for good measure

        expect(collection.getAnnotations().filter((a:any) => a === dim).length).toBe(1)
    })
})
