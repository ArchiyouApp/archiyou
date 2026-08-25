/**
 *  Mesh-kernel API parity for brep Shapes.
 *
 *  A script should not have to know which kernel it is running on. These pin the vocabulary
 *  brep answers to — the mesh kernel's names — and the convention change that came with it:
 *  methods MUTATE, and a caller who wants a copy writes `.copy().x()`. The `-ed` copy-variants
 *  (moved/mirrored/extruded/…) are gone, matching the mesh kernel.
 */
import { describe, test, beforeAll, expect } from 'vitest'
import * as brep from '../../../../src/modeler/brep/index'

beforeAll(async () => { await brep.init() })

describe('the -ed copy-variants are gone', () =>
{
    test('shape transforms mutate; copy() is explicit', () =>
    {
        const box = new brep.Solid().makeBox(100)
        expect((box as any).moved).toBeUndefined()
        expect((box as any).mirrored).toBeUndefined()
        expect((box as any).extruded).toBeUndefined()

        // the meshup way: copy, then mutate
        const shifted = box.copy().move(200)
        expect(Math.round(shifted.center().x)).toEqual(200)
        expect(Math.round(box.center().x)).toEqual(0)   // original untouched
    })

    test('predicates and coordinate helpers that merely LOOK like -ed variants survive', () =>
    {
        // closed() asks a question, it does not copy
        expect(typeof new brep.Wire().makeRect(10, 10).closed).toEqual('function')
        // rounds COORDINATES to tolerance — unrelated to Shape.round() (which fillets)
        expect(typeof new brep.Vertex(1, 2, 3).rounded).toEqual('function')
        // Vector math stays immutable
        expect(new brep.Vector(1, 0, 0).added([0, 1, 0]).toArray()).toEqual([1, 1, 0])
    })
})

describe('mesh-kernel names on brep Shapes', () =>
{
    test('translate() is move()', () =>
    {
        const box = new brep.Solid().makeBox(100).translate([50, 0, 0])
        expect(Math.round(box.center().x)).toEqual(50)
    })

    test('size() is volume, or area for a flat shape', () =>
    {
        expect(new brep.Solid().makeBox(10).size()).toBeCloseTo(1000, 0)
        expect(new brep.Face().makePlane(10, 10).size()).toBeCloseTo(100, 0)
    })

    test('polygons() are the Faces', () =>
    {
        expect(new brep.Solid().makeBox(10).polygons().length).toEqual(6)
    })

    test('points() are the corner Points', () =>
    {
        expect(new brep.Solid().makeBox(10).points().length).toEqual(8)
    })

    test('distanceTo() is distance()', () =>
    {
        const a = new brep.Solid().makeBox(10)
        expect(a.distanceTo([100, 0, 0] as any)).toBeCloseTo(95, 0)

        // KNOWN ISSUE (pre-existing, identical in the pre-monorepo sources): shape-to-shape
        // distance goes through OC's BRepExtrema_DistShapeShape and comes back 0 for
        // non-touching solids. distanceTo() is a faithful alias, so it inherits that —
        // asserted here so the day it is fixed, this test says so.
        const b = new brep.Solid().makeBox(10).move(100)
        expect(a.distanceTo(b as any)).toEqual(0)
    })

    test('grid() repeats on a 3D grid', () =>
    {
        const g = new brep.Solid().makeBox(10).grid(3, 2, 1, 5)
        expect(g.length).toEqual(6)
        const xs = [...new Set(g.toArray().map((s: any) => Math.round(s.center().x)))].sort((a, b) => a - b)
        expect(xs).toEqual([0, 15, 30])     // 10 wide + 5 spacing
    })
})

describe('linear shapes speak the Curve vocabulary', () =>
{
    test('an Edge is one atomic segment', () =>
    {
        const e = new brep.Edge().makeLine([0, 0, 0], [100, 0, 0])
        expect(e.segments().length).toEqual(1)
        expect(e.segment(0).type).toEqual('Edge')
    })

    test('a Wire segments into its Edges', () =>
    {
        const w = new brep.Wire().makeRect(100, 50)
        expect(w.segments().length).toEqual(4)
        expect(w.segment(0).type).toEqual('Edge')
        // a range comes back as a Wire, like a CompoundCurve on the mesh side
        expect((w.segment(0, 1) as any).type).toEqual('Wire')
        // negative indexes count from the end
        expect(w.segment(-1).type).toEqual('Edge')
    })

    test('connect() joins two linear shapes into one Wire', () =>
    {
        const a = new brep.Edge().makeLine([0, 0, 0], [100, 0, 0])
        const b = new brep.Edge().makeLine([100, 0, 0], [100, 100, 0])
        const joined = a.connect(b)
        expect(joined.type).toEqual('Wire')
        expect(joined.edges().length).toEqual(2)
    })

    test('perpendicularPointTo() is on Edge and Wire, and answers like Curve does', () =>
    {
        expect(typeof brep.Edge.prototype.perpendicularPointTo).toEqual('function')
        expect(typeof brep.Wire.prototype.perpendicularPointTo).toEqual('function')

        // same shape of answer on both: a Point by default, every foot with all = true
        const e = new brep.Edge().makeCircle(50)
        expect(e.perpendicularPointTo([200, 0, 0])).toBeInstanceOf(brep.Point)
        expect((e.perpendicularPointTo([200, 0, 0], true) as Array<brep.Point>).length).toEqual(2)

        const w = new brep.Wire().makeRect(100, 50)
        expect(w.perpendicularPointTo([200, 10, 0])).toBeInstanceOf(brep.Point)
        expect((w.perpendicularPointTo([200, 10, 0], true) as Array<brep.Point>).length).toEqual(2)
    })
})

describe('collections speak it too', () =>
{
    test('merge() fuses the collection into one Shape', () =>
    {
        const c = new brep.ShapeCollection(
            new brep.Solid().makeBox(100),
            new brep.Solid().makeBox(100).move(50))
        expect(c.length).toEqual(2)
        c.merge()
        expect(c.length).toEqual(1)
    })

    test('grid() and place() work on a whole collection', () =>
    {
        const c = new brep.ShapeCollection(new brep.Solid().makeBox(10))
        expect(c.grid(2, 2, 1, 5).length).toEqual(4)

        const p = new brep.ShapeCollection(new brep.Solid().makeBox(10)).place(25)
        expect(Math.round(p.bbox().min().z)).toEqual(25)
    })
})
