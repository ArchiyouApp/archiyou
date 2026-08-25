import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

/**
 *  Automatic dimensioning — Annotator.autoDim(), and the .dim() routing into it.
 *
 *  A shape that a single bounding box cannot describe (an L-shape, a part with holes)
 *  must get real part dimensions, not just its bbox width/depth. `.dim()` decides that
 *  per shape type in DimensionLine.fromShape().
 */

/** The classic L: 100x100 stock, with a 60x60 corner removed at (40,40)-(100,100). */
const L_SHAPE: Array<[number, number]> = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]

describe('autoDim (mesh kernel)', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    const values = () => annotator.getAnnotations().map((a: any) => a.value)

    it('a rectangular Polygon.dim() stays a plain bbox dimension', () =>
    {
        ;(modeler as any).polygon([0, 0], [100, 0], [100, 50], [0, 50]).dim()

        expect(values()).toEqual([100, 50])
    })

    it('an L-shaped Polygon.dim() routes to autoDim instead of the bbox', () =>
    {
        const result = (modeler as any).polygon(...L_SHAPE).dim()

        // Regression: this used to fall through to _dimensionBoxFromShape() and return
        // exactly [100, 100] — the stock bbox, telling you nothing about the shape.
        expect(Array.isArray(result)).toBe(true)
        expect(annotator.getAnnotations().length).toBeGreaterThan(2)

        const vals = values()
        expect(vals.filter(v => v === 100).length).toBe(2)  // level 1: stock size
        expect(vals).toContain(40)                          // level 2: subdivided sides
        expect(vals).toContain(60)                          // level 3: the inner step edges
    })

    it('autoDim() can be called explicitly on a shape and on a collection', () =>
    {
        const p = (modeler as any).polygon(...L_SHAPE)
        p.autoDim()
        const direct = annotator.getAnnotations().length
        expect(direct).toBeGreaterThan(2)

        annotator.reset()
        new (modeler.kernel() as any).ShapeCollection(p).autoDim()
        expect(annotator.getAnnotations().length).toBe(direct)
    })

    it('a part laid flat with layflat() still dimensions (float residue in the bbox)', () =>
    {
        // Regression: layflat() leaves ~1e-14 of thickness behind. An exact `height === 0`
        // flatness test called that a 3D bbox, Bbox.rect() returned null, and autoDim died
        // with "Cannot read properties of null (reading 'edges')".
        const tilted = (modeler as any).polygon(
            [0, 0, 0], [100, 0, 20], [100, 40, 20], [40, 40, 8], [40, 100, 8], [0, 100, 0])
        tilted.layflat()
        tilted.moveToZ(0)

        const bbox = tilted.bbox()
        expect(bbox.height()).toBeGreaterThan(0)   // residue is really there
        expect(bbox.height()).toBeLessThan(1e-9)
        expect(bbox.is2D()).toBe(true)
        expect(bbox.rect()).not.toBeNull()

        expect(() => tilted.dim()).not.toThrow()
        expect(annotator.getAnnotations().length).toBeGreaterThan(2)
    })

    it('a part that is NOT flat says so instead of crashing', () =>
    {
        const tilted = (modeler as any).polygon(
            [0, 0, 0], [100, 0, 20], [100, 40, 20], [40, 40, 8], [40, 100, 8], [0, 100, 0])

        expect(() => tilted.autoDim()).toThrow(/2D part/)
    })

    it('every generated dimension is linked back to the part', () =>
    {
        const p = (modeler as any).polygon(...L_SHAPE)
        p.dim()

        expect(p.annotations().length).toBe(annotator.getAnnotations().length)
    })
})

describe('autoDim (brep kernel)', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler('brep')
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    }, 180_000)

    it('an L-shaped Face dimensions its stock size and its sides', () =>
    {
        const face = (modeler as any).polygon(...L_SHAPE)
        expect(face.type).toBe('Face')

        // Regression: level 1 used to call dimension() on a bbox side Edge, which throws
        // "no annotator available" — a bbox side belongs to no modeler scene.
        annotator.autoDim(new (modeler.kernel() as any).ShapeCollection(face), {})

        const vals = annotator.getAnnotations().map((a: any) => a.value)
        expect(vals.filter((v: number) => v === 100).length).toBe(2) // stock size
        expect(vals).toContain(40)
        expect(vals).toContain(60)
    })

    it('Shape.autoDim() gives the same result as calling the Annotator directly', () =>
    {
        annotator.reset()
        const face = (modeler as any).polygon(...L_SHAPE)

        // Regression: brep Shape.autoDim() threw `Shape::autoDim(): TODO!`
        expect(() => face.autoDim()).not.toThrow()

        const vals = annotator.getAnnotations().map((a: any) => a.value)
        expect(vals.filter((v: number) => v === 100).length).toBe(2)
        expect(vals).toContain(40)
        expect(vals).toContain(60)
    })

    it('ShapeCollection.autoDim() reaches the annotator through its member Shapes', () =>
    {
        annotator.reset()
        const face = (modeler as any).polygon(...L_SHAPE)
        const collection = new (modeler.kernel() as any).ShapeCollection(face)

        // Regression: a ShapeCollection is never adopted by the Modeler, so it carries no
        // `_modeler` — hostAnnotator() used to throw "no annotator available" for every one.
        expect(collection._modeler).toBeFalsy()
        expect(() => collection.autoDim()).not.toThrow()

        const vals = annotator.getAnnotations().map((a: any) => a.value)
        expect(vals.filter((v: number) => v === 100).length).toBe(2)
        expect(vals).toContain(40)
    })

    it("autoDim({ levels }) picks the 'levels' strategy, also for a 3D Shape", () =>
    {
        annotator.reset()

        // Regression 1: a 3D Shape has no strategy of its own, so explicit levels used to fall
        // through to _getAutoDimStrategy() and silently produce nothing.
        // Regression 2: autoDimLevels() then died on `Bbox.rect()._toWire()` — rect() is null
        // for a bbox that is not flat.
        const box = (modeler as any).box(100, 50, 20)
        expect(() => box.autoDim({ levels: [{ axis: 'z', at: 0.5 }] })).not.toThrow()

        expect(annotator.getAnnotations().map((a: any) => a.value)).toEqual([100])
    })

    it('autoDim() skips closed edges — a circle is not a single dimension line', () =>
    {
        annotator.reset()
        const circle = (modeler as any).circle(50)
        expect(circle.type).toBe('Edge')

        // Regression: level 3 fed the closed Edge to fromEdge(), which built a zero-length
        // Line from its coincident start/end and threw deep inside the kernel.
        expect(() => circle.dim()).not.toThrow()
        expect(annotator.getAnnotations().map((a: any) => a.value)).toEqual([100, 100]) // diameter both ways
    })
})

describe('dim (brep kernel)', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler('brep')
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    }, 180_000)

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    const values = () => annotator.getAnnotations().map((a: any) => a.value)

    it('line(...).dim() is a single dimension line', () =>
    {
        (modeler as any).line([0, 0], [100, 0]).dim()
        expect(values()).toEqual([100])
    })

    it('box(...).dim() gives the three bbox dimensions', () =>
    {
        (modeler as any).box(100, 50, 20).dim()
        expect(values()).toEqual([100, 50, 20])
    })

    it('rect(...).dim() gives two bbox dimensions, not one per edge', () =>
    {
        // Regression: a closed Wire dimensioned every visible edge, so a rectangle came back
        // with four lines — [50, 100, 50, 100] — two of them duplicates. The mesh kernel
        // returns [100, 50] for the same shape.
        (modeler as any).rect(100, 50).dim()
        expect(values()).toEqual([100, 50])
    })

    it('an L-shaped Face .dim() routes to autoDim, like the mesh kernel', () =>
    {
        const result = (modeler as any).polygon(...L_SHAPE).dim()

        expect(Array.isArray(result)).toBe(true)
        const vals = values()
        expect(vals.filter((v: number) => v === 100).length).toBe(2) // stock size
        expect(vals).toContain(40)
        expect(vals).toContain(60)
    })
})

describe('autoDim building blocks (meshup)', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
    })

    it('Bbox.rect() gives the outline Curve of a flat bbox', () =>
    {
        const rect = (modeler as any).polygon(...L_SHAPE).bbox().rect()

        expect(rect.type).toBe('Curve')
        expect(rect.isClosed()).toBe(true)
        expect(rect.edges().length).toBe(4)
        expect(rect.length()).toBeCloseTo(400, 6) // 100 x 100 stock
    })

    it('a 2D Bbox hands back side EDGES, a 3D one side polygons', () =>
    {
        const flat = (modeler as any).polygon(...L_SHAPE).bbox()
        expect(flat.back().type).toBe('Curve')
        expect(flat.back().length()).toBeCloseTo(100, 6)
        expect(flat.left().length()).toBeCloseTo(100, 6)

        expect((modeler as any).box(10, 20, 30).bbox().back().type).toBe('Polygon')
    })

    it('Polygon.edges() returns the real boundary, not the triangulation', () =>
    {
        const edges = (modeler as any).polygon(...L_SHAPE).edges()

        expect(edges.length).toBe(6)
        expect(edges.toArray().map((e: any) => Math.round(e.length())).sort((a: number, b: number) => a - b))
            .toEqual([40, 40, 60, 60, 100, 100])
    })

    it('ShapeCollection.intersecting() selects the shapes touching a target', () =>
    {
        const kernel = modeler.kernel() as any
        const part = (modeler as any).polygon(...L_SHAPE)
        const bottomSide = part.bbox().getSidesShapes('front', 'edge').first()

        const touching = part.edges().intersecting(bottomSide)

        // The bottom edge lies on it; the two verticals touch it at an endpoint.
        expect(touching.length).toBe(3)
        expect(touching.toArray().every((e: any) => e instanceof kernel.Curve)).toBe(true)
    })
})
