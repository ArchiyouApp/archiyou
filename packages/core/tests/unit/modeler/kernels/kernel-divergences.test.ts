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
 *  gone:
 *    3  rotate*() defaulting to a different pivot for linear shapes — meshup Curve now turns
 *       about its own centre, like Mesh and brep
 *    9  mirror() taking (origin, normal) on brep — brep now reads (direction, position) like
 *       meshup; mirrorX/Y/Z were always portable
 *   16  meshup ShapeCollection dropping brep shapes passed one at a time (collection(a, b),
 *       copy()) — the direct path now accepts any kernel's shape like the array path did
 *   17  brep Vector.rotate(angle, position, direction) — now (axis, angle) like meshup
 *   18  toMesh() missing on brep shapes — a brep shape is its own mesh
 *   19  brep row()/grid()/array() leaving copies unnamed — named `${name}1…` like meshup
 *   20  sketch() handing meshup Curves to a brep script — converted to brep Edges/Wires
 *   21  brep bbox() padded by the meshing deflection once a shape had been tessellated
 *   23  brep ShapeCollection.select() selecting within each member instead of across the
 *       collection (E||left on four edges gave all four), and never unwrapping a single hit;
 *       meshup collections holding brep shapes found nothing at all
 *   24  extruding a straight edge: brep chose a different default plane (x for a vertical
 *       line, meshup y) and oriented the swept face the other way round, so the next default
 *       extrude went the opposite way — now (edge × extrusion), like meshup's polygon
 *   25  meshup Vector.rotate(axis, angle) read radians where everything else reads degrees
 *   26  brep operations that rebuild the shape (mirror, extrude, …) dropped its name, style
 *       and material on the way — replaceShape() carries them now
 *   27  meshup Vertex/Curve copies dropped the name where Mesh/Polygon copies kept it
 *  16–27 were found by tests/cadscripts/kernel.parity.test.ts and are asserted the other way
 *  round in modeler.brep.test.ts ("mesh-kernel contracts on brep shapes").
 *
 *  The second pass (closing the gaps) retired these too:
 *    1  arc(start, mid, end) — Modeler.arc() now passes 'threepoint' to meshup
 *    2  union() — brep union() now updates the receiver like subtract(), and returns it
 *    4  brep scale() — the transformed shape is cast back to its TopoDS type
 *    5  brep extend() — a straight edge is rebuilt from its world-space ends
 *    7  brep Solid.center() — volume properties, the centre of mass
 *    8  extruding a closed planar outline — a capped Solid on brep too, along the outline's
 *       normal turned toward the positive axis (a rect goes +z), as meshup
 *   13  is2D() — meshup Curve/Mesh now use the tolerant Bbox test
 *   28  brep Vector.rotationBetween() — added, answers the quaternion rotateQuaternion() takes
 *   31  brep ShapeCollection.union() — returns the fused Shape, as meshup
 *   32  side selectors over a collection of edges — went away with 8: the edges came from an
 *       open shell instead of a solid's bottom face
 *   33  brep Bbox.containsBbox() — added (contains() takes a Bbox too)
 *   14  Polygon.center() — meshup now answers the area centroid (no double-counted closing
 *       vertex), the same centre brep gives a Face; Polygon.layflat() turns about it
 *   34  layflat() — brep turns the face normal onto +z along the shortest arc about the area
 *       centroid, as meshup, instead of squaring the shape up to the axes; planeBetween() gets
 *       its normal from the corner order on both; cutoffBy() reads a straight line through a
 *       face as a full cut; cutoff() no longer asks for a zero-width cutting plane
 *   30  gardenchair drift — it was 34's planeBetween() normal (longBeamBack extruded the other
 *       way) and the coplanar line cut that brep did not perform; gardenchair is clean now
 *
 *  Still OPEN:
 *   29  urhousesketch on brep: the default run completes, but when the Runner re-executes the
 *       script for its `$pipeline('techdraw')` the OpenCascade WASM traps ("unreachable") at
 *       `wallFrontFace.copy().tmp().extrude(...).volume()` — a re-execution/lifetime issue
 *       in the brep kernel, not a modelling contract
 *   35  meshup Mesh.obbox() is a PCA fit: on tomy's 626×100×100 leg it reports 626×141×142
 *       and its axes carry an arbitrary sign, where brep's OBB is tight — so a rotation
 *       derived from obbox().axes() lands the leg 1.7 mm wider and turned 180° on mesh.
 *       A tighter OBB fitter on the mesh side (minimum-volume, not PCA) would close it
 *
 *    6  brep subtract() throws when the cut severs the solid
 *   10  area()/size()/length() answer for different shape families
 *   11  closed outlines are seamed differently, so start()/end()/middle() differ
 *   12  brep pointAt() is parameter-based where mesh pointAtPerc() is arc-length-based
 *   15  odds and ends: a line ∩ a closed outline, distanceTo(), fillet()/chamfer(), circle spans
 *   22  the make module (walls, boarding, part lists) is mesh-only — brep now says so up front
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



    //// ==== 6. BREP BOOLEANS ==== ////

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

    //// ==== 22. MESH-ONLY MODULES ==== ////

    it('22. the make module is mesh-only, and says so before building anything on brep', async () =>
    {
        /*  Make (walls, studs, boarding, part lists, sheet packing) is written against the
            concrete meshup classes. It used to run half-way on brep and fail somewhere inside
            (an empty studs collection, "Please supply a valid ShapeCollection…"). It now refuses
            at the first make.*() call with a message that names the fix.

            SHOULD BE (eventually): Make builds through the Modeler API so it runs on both. */
        const { Runner } = await import('../../../../src/runner/Runner')
        const runner = await new Runner().load()
        const code = `w = make.wall({ length: 1000, height: 1000 })`
        const onBrep = await runner.execute({ kernel: 'brep', script: { code }, outputs: ['default/model/glb'], messages: ['error'] } as any)
        expect(onBrep.status).toEqual('error')
        expect(JSON.stringify(onBrep.errors)).toMatch(/only available in mesh mode/)
    }, 120_000)
})
