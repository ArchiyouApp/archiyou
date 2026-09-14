/**
 *  Where the two kernels DISAGREE today — the inventory shape-parity.test.ts routes around.
 *
 *  Every test here asserts the CURRENT behaviour of both kernels and says, in its comment, what
 *  the behaviour ought to be. That makes each one a tripwire pointing the right way: the day a
 *  divergence is fixed, its test fails, and the fix is to delete the test (and the workaround in
 *  shape-parity.test.ts that quotes it). Nothing here is an endorsement.
 *
 *  These were all found by building the same shape on both kernels and measuring after every
 *  operation — see shape-parity.test.ts for the harness.
 *
 *  Roughly in order of how much damage each one does to a script that switches kernel. Numbers
 *  stay put when an entry is fixed and deleted, so a gap in the list is a divergence that is
 *  gone (3: rotate*() defaulting to a different pivot for linear shapes — meshup Curve now
 *  turns about its own centre, like Mesh and brep).
 *
 *    1  arc(start, mid, end) draws a different curve on each kernel
 *    2  union()/intersection() mutate on mesh but not on brep
 *    4  brep scale() leaves a linear shape untyped, breaking the next call on it
 *    5  brep extend() ignores the transform the edge has picked up
 *    6  brep subtract() throws when the cut severs the solid
 *    7  brep Solid.center() is the surface centroid, not the centre of mass
 *    8  extruding a closed outline gives a capped solid on mesh, an open shell on brep
 *    9  mirror() takes its two arguments in the opposite order
 *   10  area()/size()/length() answer for different shape families
 *   11  closed outlines are seamed differently, so start()/end()/middle() differ
 *   12  brep pointAt() is parameter-based where mesh pointAtPerc() is arc-length-based
 *   13  is2D() uses an exact zero test on mesh and a tolerant one on brep
 *   14  Polygon.center() double-counts the closing vertex on mesh
 *   15  odds and ends: a line ∩ a closed outline, distanceTo(), fillet()/chamfer(), circle spans
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Modeler } from '../../../../src/modeler/Modeler'

const r4 = (v: number) => +v.toFixed(4)

describe('mesh ↔ brep divergences (pinned, not accepted)', () =>
{
    let mesh: Modeler
    let brep: Modeler

    beforeAll(async () =>
    {
        mesh = new Modeler('mesh')
        await mesh.load()
        brep = new Modeler('brep')
        await brep.load()
    }, 120_000)

    //// ==== 1. PRIMITIVES THAT MEAN DIFFERENT THINGS ==== ////

    it('1. arc(start, mid, end) is a THREE-POINT arc on brep and a TANGENT arc on mesh', () =>
    {
        /*  Modeler.arc()'s own docstring says "Makes an Arc through start, mid and end Point",
            and that is what brep does. meshup's Curve.Arc() defaults to method 'tangent', where
            the middle argument is the tangent DIRECTION at the start, not a point on the curve —
            and Modeler.arc() never passes the method, so the mesh branch takes the default.

            SHOULD BE: Modeler.arc() passes 'threepoint' to meshup.Curve.Arc(). */
        const args = [[0, 0, 0], [50, 20, 0], [100, 0, 0]] as const

        const a = mesh.arc(...args as any) as any
        const b = brep.arc(...args as any) as any

        // brep passes through the mid point: the arc reaches y = 20
        expect(r4(b.bbox().depth())).toEqual(20)
        expect(r4(b.length())).toEqual(110.347)

        // mesh treats [50,20,0] as a tangent, so it never gets near y = 20
        expect(r4(a.bbox().depth())).toEqual(9.629)
        expect(r4(a.length())).toEqual(102.4545)
    })

    //// ==== 2. MUTATION CONTRACTS ==== ////

    it('2. union() mutates the receiver on mesh but not on brep', () =>
    {
        /*  brep's union() builds the result and swaps it into the SCENE, but never updates the
            receiver's own geometry — the handle a script is holding still refers to the old shape.
            subtract() does update it, on both kernels. The portable spelling is therefore to
            rebind: `s = s.union(other)` works everywhere, `s.union(other)` does not.

            intersection() is NOT in this divergence any more: it is non-replacing on both kernels
            (the receiver is untouched, the shared geometry comes back as a new shape on the active
            layer), so `s = s.intersection(other)` is the only spelling on either.

            SHOULD BE: brep union() updates the receiver like subtract() does.
                       (See the "brep methods MUTATE" convention the kernel documents for itself.) */
        for (const [kernel, m, mutatesOnUnion] of [['mesh', mesh, true], ['brep', brep, false]] as const)
        {
            const a = m.box(100) as any
            const returned = a.union(m.box(60).move(30, 0, 0))

            expect(r4(returned.volume()), `${kernel}: the RETURN value is always the union`).toEqual(1036000)
            expect(a.volume() === 1036000, `${kernel}: receiver mutated?`).toEqual(mutatesOnUnion)
        }

        // subtract() is the one boolean that behaves the same on both
        for (const m of [mesh, brep])
        {
            const a = m.box(100) as any
            a.subtract(m.box(60).move(30, 0, 0))
            expect(r4(a.volume())).toEqual(820000)
        }
    })

    //// ==== 4-6. BREP TRANSFORMS AND BOOLEANS ==== ////

    it('4. brep scale() leaves a linear shape untyped, so the next call on it throws', () =>
    {
        /*  brep's Shape.scale() assigns the transform result straight to this._ocShape:

                this._ocShape = ocBuilder.Shape();      // a bare TopoDS_Shape

            move() and rotate() follow the same assignment with _updateFromOcShape(), which casts
            it back down to TopoDS_Edge / TopoDS_Wire / …. scale() does not, so measurements that
            only need a generic shape (bbox, length) keep working while anything that reaches for
            the curve — edgeType(), extend(), start() — throws a WASM BindingError.

            SHOULD BE: scale() calls this._updateFromOcShape() like every other transform. */
        const line = brep.line([0, 0, 0], [100, 0, 0]) as any
        expect(line.edgeType()).toEqual('Line')

        line.scale(3)
        expect(r4(line.length()), 'the measurement still works').toEqual(300)
        expect(() => line.edgeType()).toThrow(/TopoDS_Edge/)

        // mesh has no such trap
        const meshLine = mesh.line([0, 0, 0], [100, 0, 0]) as any
        meshLine.scale(3)
        expect(r4(meshLine.length())).toEqual(300)
        expect(r4((meshLine.extend(50) ?? meshLine).length())).toEqual(350)
    })

    it('5. brep extend() runs along the edge\'s ORIGINAL direction, ignoring its transform', () =>
    {
        /*  Edge.extend() works in the underlying Geom curve's parameter space and then nudges the
            untouched end back into place. The underlying curve does not carry the edge's location,
            so an edge that has been rotated is extended along the direction it had when it was
            built.

            Below: a line along +x, rotated 37°, then extended. mesh grows it along the rotated
            direction (correct); brep grows it along +x and flattens the result.

            SHOULD BE: extend() takes the edge's location into account (or rebuilds from
                       start()/end(), which are already correct). */
        const build = (m: Modeler) => (m.line([0, 0, 0], [100, 0, 0]) as any).rotateZ(37, [0, 0, 0])

        const a = build(mesh).extend(50) ?? build(mesh)
        const b = build(brep)
        b.extend(50)

        expect(r4(a.length())).toEqual(150)
        expect(r4(b.length())).toEqual(150)

        // mesh keeps the 37° direction: the extension adds to BOTH extents
        expect(r4(a.bbox().width())).toEqual(119.7953)
        expect(r4(a.bbox().depth())).toEqual(90.2723)

        // brep comes back axis-aligned — the extension went along +x
        expect(r4(b.bbox().width())).toEqual(150)
        expect(r4(b.bbox().depth())).toEqual(0)
    })

    it('6. brep subtract() does not survive a cut that severs the solid in two', () =>
    {
        /*  A cutter that passes all the way through leaves two disconnected solids. mesh answers
            with one Mesh holding both parts, at the volume you can work out by hand. brep does
            not get there: it typically dies inside BRepExtrema_DistShapeShape ("Cannot read
            properties of undefined") while sorting the pieces, and where it does not throw it
            hands back geometry that is not the two halves.

            Which of the two failure modes fires depends on what else is in the brep scene, so
            this asserts the thing that is stable: mesh gets the right answer, brep does not.

            SHOULD BE: brep returns the pieces — a ShapeCollection, which is what its own
                       disjoint union() already does — instead of throwing. */
        const cutter = (m: Modeler) => m.box(60, 60, 40)      // wider and taller than the target
        const EXPECTED = 40000                                // 100·50·20 − 60·50·20

        // mesh keeps both halves in one Mesh
        const a = mesh.box(100, 50, 20) as any
        a.subtract(cutter(mesh))
        expect(r4(a.volume()), 'mesh keeps both halves').toBeCloseTo(EXPECTED, 0)

        // brep either throws or comes back with something that is not those two halves
        let brepVolume: number | 'threw'
        try
        {
            const b = brep.box(100, 50, 20) as any
            b.subtract(cutter(brep))
            brepVolume = r4(b.volume())
        }
        catch { brepVolume = 'threw' }

        expect(brepVolume, 'brep does not produce the severed solid').not.toBeCloseTo(EXPECTED, 0)
    })

    //// ==== 7. MEASUREMENTS THAT MEAN DIFFERENT THINGS ==== ////

    it('7. brep Solid.center() is the SURFACE centroid, not the centre of mass', () =>
    {
        /*  brep's Solid.center() calls BRepGProp.SurfaceProperties_1, which weights by area rather
            than by volume. On a symmetric solid the two coincide, so it looks right until a
            boolean makes the solid lopsided.

            The case below is checkable by hand: a 100³ cube minus the 50×60×60 slab the cutter
            removes leaves 820 000 mm³ whose centroid sits at x = −(25·180000)/820000 = −5.4878.
            mesh gets that; brep does not.

            SHOULD BE: Solid.center() uses VolumeProperties_1, like Shape.volume() already does. */
        const cut = (m: Modeler) => { const s = m.box(100) as any; s.subtract(m.box(60).move(30, 0, 0)); return s }

        expect(r4(cut(mesh).center().x), 'mesh = the true centre of mass').toBeCloseTo(-5.4878, 3)
        expect(r4(cut(brep).center().x), 'brep = the area-weighted centroid').toBeCloseTo(1.667, 2)

        // the volumes themselves agree exactly, so this is purely the centroid formula
        expect(r4(cut(mesh).volume())).toEqual(820000)
        expect(r4(cut(brep).volume())).toEqual(820000)
    })

    //// ==== 8. EXTRUDING AN OUTLINE ==== ////

    it('8. extruding a closed outline gives a capped SOLID on mesh and an open SHELL on brep', () =>
    {
        /*  Two divergences in one call. mesh caps the extrusion and pulls it along +z; brep sweeps
            only the wire, so the result is the four side walls with no top or bottom, and with no
            direction argument it follows the wire's normal — which points −z for a default rect,
            so the extrusion goes the other way.

            SHOULD BE: extruding a CLOSED linear shape yields a capped Solid, extruded +z (or at
                       least in the same direction on both kernels). */
        const a = (mesh.rect(100, 50) as any).extrude(50)
        const b = (brep.rect(100, 50) as any).extrude(50)

        expect(a.type ?? a.constructor.name).toEqual('Mesh')
        expect(r4(a.volume()), 'mesh: a real 100×50×50 solid').toEqual(250000)
        expect(r4(a.bbox().min().z), 'mesh extrudes +z').toEqual(0)

        expect(b.type).toEqual('Shell')
        expect(b.faces().length, 'brep: the four side walls, no caps').toEqual(4)
        expect(r4(b.bbox().min().z), 'brep extrudes along the wire normal, i.e. −z').toEqual(-50)

        // passing the direction explicitly fixes the direction but not the missing caps
        const c = (brep.rect(100, 50) as any).extrude(50, [0, 0, 1])
        expect(r4(c.bbox().min().z)).toEqual(0)
        expect(c.type).toEqual('Shell')
    })

    //// ==== 9. ARGUMENT ORDER ==== ////

    it('9. mirror() takes (direction, position) on mesh and (origin, normal) on brep', () =>
    {
        /*  The same two arguments, swapped. A script that mirrors about a plane silently does
            nothing on one kernel and works on the other. mirrorX/mirrorY/mirrorZ take a single
            coordinate and agree on both, so they are the portable spelling today.

            SHOULD BE: one argument order (and a runtime check, since both forms are PointLike). */
        const box = (m: Modeler) => (m.box(100, 50, 20) as any).move(100, 0, 0)

        // brep reads (origin, normal): mirrored across the yz plane through the origin
        expect(r4(box(brep).mirror([0, 0, 0], [1, 0, 0]).bbox().center().x)).toEqual(-100)
        // mesh reads (direction, position) — so the same call mirrors about x = 0 in the x
        // direction only by accident of the arguments, and here leaves the box where it was
        expect(r4(box(mesh).mirror([0, 0, 0], [1, 0, 0]).bbox().center().x)).toEqual(100)

        // mesh's own spelling of the same intent
        expect(r4(box(mesh).mirror([1, 0, 0], [0, 0, 0]).bbox().center().x)).toEqual(-100)

        // mirrorX/Y/Z are portable
        expect(r4(box(mesh).mirrorX(0).bbox().center().x)).toEqual(-100)
        expect(r4(box(brep).mirrorX(0).bbox().center().x)).toEqual(-100)
    })

    //// ==== 10. WHICH MEASUREMENTS EXIST ==== ////

    it('10. area(), size() and length() answer for different shape families', () =>
    {
        /*  SHOULD BE: brep Wire/Edge.area() returns the enclosed area of a closed planar outline
                       (or undefined), meshup Curve gains size(), and Mesh.length() and
                       Solid.length() agree on one answer — the current pair is a coin flip. */

        // area() on a closed outline: the area it encloses on mesh, the surface area (0) on brep
        expect(r4((mesh.rect(100, 50) as any).area())).toEqual(5000)
        expect(r4((brep.rect(100, 50) as any).area())).toEqual(0)

        // size() — "how big is this" — is not on a meshup Curve at all
        expect(typeof (mesh.rect(100, 50) as any).size).toEqual('undefined')
        expect(r4((brep.rect(100, 50) as any).size()), 'brep answers, with the useless 0').toEqual(0)

        // size() on a solid agrees, and is the volume on both
        expect(r4((mesh.box(100, 50, 20) as any).size())).toEqual(100000)
        expect(r4((brep.box(100, 50, 20) as any).size())).toEqual(100000)

        // length() of a solid: mesh declines (and warns), brep answers with the longest bbox extent
        expect((mesh.box(100, 50, 20) as any).length()).toBeUndefined()
        expect(r4((brep.box(100, 50, 20) as any).length())).toEqual(100)

        // area() and volume() of a solid DO agree — these are the portable ones
        expect(r4((mesh.box(100, 50, 20) as any).area())).toEqual(16000)
        expect(r4((brep.box(100, 50, 20) as any).area())).toEqual(16000)
    })

    //// ==== 11-12. WALKING ALONG A CURVE ==== ////

    it('11. a closed outline is seamed differently, so start()/end() differ', () =>
    {
        /*  brep's rect starts at a different corner and runs the other way round. Worse, its
            Wire.start() and Wire.end() come back as DIFFERENT points on a closed wire, where by
            definition they should be the same point.

            SHOULD BE: start() === end() on any closed shape. (The seam corner itself is a free
                       choice, but scripts that read start()/end() need it to be a stable one.) */
        const a = mesh.rect(100, 50) as any
        const b = brep.rect(100, 50) as any

        expect([r4(a.start().x), r4(a.start().y)]).toEqual([-50, -25])
        expect([r4(a.end().x), r4(a.end().y)], 'mesh: closed, so start === end').toEqual([-50, -25])

        expect([r4(b.start().x), r4(b.start().y)]).toEqual([-50, 25])
        expect([r4(b.end().x), r4(b.end().y)], 'brep: a different point entirely').toEqual([50, 25])

        // an OPEN curve is fine on both — which is why shape-parity.test.ts compares ends there
        const openA = mesh.polyline([[0, 0, 0], [100, 0, 0], [100, 50, 0]]) as any
        const openB = brep.polyline([[0, 0, 0], [100, 0, 0], [100, 50, 0]]) as any
        expect([r4(openA.start().x), r4(openA.start().y)]).toEqual([r4(openB.start().x), r4(openB.start().y)])
        expect([r4(openA.end().x), r4(openA.end().y)]).toEqual([r4(openB.end().x), r4(openB.end().y)])
    })

    it('12. brep pointAt(perc) is parameter-based where mesh pointAtPerc() is arc-length-based', () =>
    {
        /*  On a polyline whose segments differ in length the two walk at different speeds, and
            middle() inherits it: mesh finds the point half the LENGTH along, brep the point half
            the PARAMETER along.

            The polyline below is 100 + 50 + 60 = 210 long, so its halfway point sits 105 along,
            i.e. 5 up the second segment — which is what mesh answers.

            SHOULD BE: one definition, and arc-length is the one a script means. */
        const pts = [[0, 0, 0], [100, 0, 0], [100, 50, 0], [160, 50, 0]]
        const a = mesh.polyline(pts as any) as any
        const b = brep.polyline(pts as any) as any

        expect([r4(a.middle().x), r4(a.middle().y)], 'mesh: 105 of 210 along').toEqual([100, 5])
        expect([r4(b.middle().x), r4(b.middle().y)], 'brep: halfway in parameter space').toEqual([100, 25])

        // on a single straight segment, where parameter and arc length are proportional, they agree
        const lineA = mesh.line([0, 0, 0], [100, 0, 0]) as any
        const lineB = brep.line([0, 0, 0], [100, 0, 0]) as any
        expect(r4(lineA.middle().x)).toEqual(r4(lineB.middle().x))
    })

    //// ==== 13-14. SMALL BUT SHARP ==== ////

    it('13. is2D() tests the bbox for an exact zero on mesh and a tolerant one on brep', () =>
    {
        /*  meshup's Bbox.is2D() is properly tolerant (BBOX_FLAT_EPS), but Curve.is2D() and
            Mesh.is2D() do not use it — they re-implement the check as `width === 0 || …`. Rotate a
            tessellated shape onto a plane and the float residue makes it report 3D. brep's
            Shape.is2D() delegates to its Bbox and gets it right.

            SHOULD BE: Curve.is2D() and Mesh.is2D() return this.bbox().is2D(). */
        const a = (mesh.circle(40) as any).rotateX(90, [0, 0, 0])
        const b = (brep.circle(40) as any).rotateX(90, [0, 0, 0])

        expect(r4(a.bbox().depth()), 'flat to four decimals on both').toEqual(0)
        expect(r4(b.bbox().depth())).toEqual(0)

        expect(a.is2D(), 'mesh: float residue reads as 3D').toEqual(false)
        expect(b.is2D()).toEqual(true)

        // the tolerant answer is right there on the same object
        expect(a.bbox().is2D()).toEqual(true)
    })

    it('14. Polygon.center() double-counts the closing vertex on mesh', () =>
    {
        /*  plane() is a meshup Polygon on mesh and a brep Face on brep. Polygon.center() averages
            the vertex ring — and the ring that Curve.toPolygon() hands it repeats the first
            vertex at the end, so a 100×50 plane centred on the origin reports its centre at
            (−10, −5): the mean of five points where four were meant.

            SHOULD BE: Polygon.center() drops a duplicated closing vertex (or uses the area
                       centroid, which is what "centre" means for a face). */
        const a = mesh.plane(100, 50) as any
        const b = brep.plane(100, 50) as any

        expect(r4(a.bbox().center().x), 'the bbox is right').toEqual(0)
        expect([r4(a.center().x), r4(a.center().y)], 'the centre is not').toEqual([-10, -5])
        expect([r4(b.center().x), r4(b.center().y)]).toEqual([0, 0])

        // a polygon built from bare points, with no repeated vertex, is fine
        const clean = mesh.polygon([[0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]] as any) as any
        expect([r4(clean.center().x), r4(clean.center().y)]).toEqual([50, 25])
    })

    //// ==== 15. ODDS AND ENDS ==== ////

    it('15. odds and ends: line ∩ closed outline, distanceTo(), fillet()/chamfer(), circle spans', () =>
    {
        // intersect() (replacing) / intersection() (non-replacing) / intersects() (predicate)
        // now mean the same on both kernels, so what used to sit here — intersect() being
        // brep-only, and meshup's Curve.intersect() being a point-getter — is gone.
        // What is left is the RESULT of intersecting a line with a closed outline: mesh reads a
        // closed Curve as a region (its own booleans already do), so the answer is the piece of
        // the line inside the rect; brep reads a Wire as a curve, so the answer is the Vertex
        // where the line crosses the outline.
        // SHOULD BE: one reading of a closed outline, on both kernels.
        const meshLine = () => mesh.line([-100, 0, 0], [100, 10, 0]) as any
        const brepLine = () => brep.line([-100, 0, 0], [100, 10, 0]) as any
        expect((meshLine().intersection(mesh.rect(10, 20) as any) as any).type).toEqual('Curve')
        expect((brepLine().intersection(brep.rect(10, 20) as any) as any).type).toEqual('Vertex')
        // ... and the crossing points are one call away on both: the mesh piece's own vertices
        expect((meshLine().intersection(mesh.rect(10, 20) as any) as any).vertices().length).toEqual(2)

        // distanceTo() takes a bare point on brep but not on mesh
        // SHOULD BE: Mesh.distanceTo() accepts any PointLike, as its brep counterpart does.
        expect(r4((brep.box(100, 50, 20) as any).distanceTo([200, 0, 0]))).toEqual(150)
        expect(() => (mesh.box(100, 50, 20) as any).distanceTo([200, 0, 0])).toThrow(/Unsupported type/)

        // fillet()/chamfer() exist on brep solids only
        // SHOULD BE: documented as brep-only, or implemented on meshup — right now a script that
        //            fillets simply crashes when the kernel is switched.
        expect(typeof (brep.box(10) as any).fillet).toEqual('function')
        expect(typeof (mesh.box(10) as any).fillet).toEqual('undefined')

        // a circle is two arc spans on mesh and one edge on brep, so segment counts differ.
        // The LENGTH agrees, which is what a script reads — this one is cosmetic.
        expect((mesh.circle(40) as any).segments().length).toEqual(2)
        expect((brep.circle(40) as any).segments().length).toEqual(1)
        expect(r4((mesh.circle(40) as any).length())).toBeCloseTo(r4((brep.circle(40) as any).length()), 2)
    })
})
