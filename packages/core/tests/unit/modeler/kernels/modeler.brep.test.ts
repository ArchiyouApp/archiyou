/**
 *  Modeler with the BREP (OpenCascade) kernel.
 *
 *  The same Modeler API, the same scene and the same layer semantics as mesh mode — only the
 *  shapes underneath are OpenCascade ones. What is asserted here is the wiring: primitives
 *  build, they land in the scene at the active layer, and the app-level methods reach through.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Modeler } from '../../../../src/modeler/Modeler'

describe('Modeler — brep mode', () =>
{
    let m: Modeler

    // Loading the OpenCascade WASM is slow (~0.5s) and global, so do it once.
    beforeAll(async () => { await new Modeler('brep').load() }, 60000)

    beforeEach(async () =>
    {
        m = new Modeler('brep')
        await m.load()
    })

    it('reports brep as the active kernel', () =>
    {
        expect(m.mode()).toBe('brep')
        expect(m.kernel()).toBeTruthy()
    })

    describe('primitives', () =>
    {
        it('box() builds an OpenCascade Solid with the requested size', () =>
        {
            const box = m.box(10, 20, 30) as any
            expect(box.type).toBe('Solid')
            expect(box.bbox().width()).toBe(10)
            expect(box.bbox().depth()).toBe(20)
            expect(box.bbox().height()).toBe(30)
        })

        it('sphere() and cylinder() build Solids', () =>
        {
            expect((m.sphere(25) as any).type).toBe('Solid')
            expect((m.cylinder(10, 40) as any).type).toBe('Solid')
        })

        it('cone() is brep-only and builds a Solid', () =>
        {
            expect((m.cone(30, 0, 60) as any).type).toBe('Solid')
        })

        it('line() and arc() build Edges', () =>
        {
            expect((m.line([0, 0, 0], [100, 0, 0]) as any).type).toBe('Edge')
            expect((m.arc([0, 0, 0], [50, 20, 0], [100, 0, 0]) as any).type).toBe('Edge')
        })

        it('circle() and rect() build OUTLINES, plane() builds a surface', () =>
        {
            // Same split as the mesh kernel: circle/rect give you the curve, plane the surface
            expect((m.circle(40) as any).type).toBe('Edge')
            expect((m.rect(100, 50) as any).type).toBe('Wire')
            expect((m.plane(100, 50) as any).type).toBe('Face')
        })

        it('helix() and spiral() are brep-only and build Wires', () =>
        {
            expect((m.helix(20, 100, 720) as any).type).toBe('Wire')
            expect((m.spiral(10, 40, 720) as any).type).toBe('Wire')
        })

        it('brep-only primitives refuse to run in mesh mode, with a clear message', () =>
        {
            const mesh = new Modeler('mesh')
            expect(() => mesh.cone()).toThrow(/only available in brep mode/)
            expect(() => mesh.helix()).toThrow(/only available in brep mode/)
        })
    })

    describe('scene', () =>
    {
        it('adopts every primitive into the scene', () =>
        {
            expect(m.all().length).toBe(0)
            m.box(10)
            m.sphere(10)
            expect(m.all().length).toBe(2)
        })

        it('puts shapes on the active layer', () =>
        {
            m.layer('parts')
            const box = m.box(10) as any
            expect(box.node()).not.toBeNull()
            expect(box.node().parent().name).toBe('parts')
        })

        it('exposes the scene graph the navigator reads', () =>
        {
            m.layer('frame')
            m.box(10)
            const graph = m.toGraph()
            expect(JSON.stringify(graph)).toContain('frame')
        })

        it('boolean results replace the operand in the scene', () =>
        {
            const box = m.box(100) as any
            const cutter = m.sphere(60) as any
            expect(m.all().length).toBe(2)

            const result = box.subtracted(cutter)
            expect(result).toBeTruthy()
            // subtracted() is @sceneAdd: the result joins the scene
            expect(m.all().length).toBeGreaterThan(2)
        })

        it('intersection() adds its result to the scene, like intersections()', () =>
        {
            const l1 = m.line([0,0,0],[100,0,0]) as any
            const l2 = m.line([50,-50,0],[50,50,0]) as any
            const before = m.all().length

            const v = l1.intersection(l2)
            expect(v).toBeTruthy()
            expect(v.type).toBe('Vertex')
            // the intersection Vertex is a new Shape in the scene; both operands stay
            expect(m.all().toArray()).toContain(v)
            expect(m.all().length).toBe(before + 1)
            expect(m.all().toArray()).toContain(l1)
        })

        it('an intersection() result carries the modeler, so addToScene() works on it', () =>
        {
            const l1 = m.line([0,0,0],[100,0,0]) as any
            const l2 = m.line([50,-50,0],[50,50,0]) as any

            const v = l1.intersection(l2)
            expect(v._modeler).toBe(m)

            m.layer('connectors')
            v.addToScene() // re-adding moves it to the active layer, it does not duplicate
            const n = m.all().toArray().filter((s:any) => s === v).length
            expect(n).toBe(1)
            expect(v._node.parent().name).toBe('connectors')
        })
    })

    describe('app methods', () =>
    {
        it('are patched onto brep Shapes once the kernel loads', () =>
        {
            const box = m.box(10) as any
            expect(box.mode).toBe('brep')
            expect(typeof box.dim).toBe('function')
            expect(typeof box.material).toBe('function')
            expect(typeof box.onClick).toBe('function')
        })

        it('styling goes through the shared Style model', () =>
        {
            const box = m.box(10) as any
            box.color('blue')
            expect(box.getColor()).toBe(255)
        })
    })

    it('sketch() draws with the mesh kernel Sketch in both modes', () =>
    {
        // brep/Sketch.ts was dropped; the drawing happens in meshup.Sketch …
        const sketch = m.sketch('xy')
        expect(sketch).toBeTruthy()
        expect(sketch.constructor.name).toBe('Sketch')
    })

    /*  The contracts a script relies on when it is switched from mesh to brep. Each of these
        used to be a pinned divergence (kernel-divergences.test.ts) and was found by running the
        cadscripts on both kernels (tests/cadscripts/kernel.parity.test.ts). */
    describe('mesh-kernel contracts on brep shapes', () =>
    {
        it('… but what a sketch hands back in brep mode is brep geometry', () =>
        {
            const outline = m.sketch('xy').moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).end() as any
            expect(['Edge', 'Wire']).toContain(outline.type)
            expect(outline.bbox().width()).toBeCloseTo(100, 3)
            expect(outline.bbox().depth()).toBeCloseTo(50, 3)
            expect(outline.length()).toBeCloseTo(150, 3)

            // and it is usable against the rest of the brep model
            const cutter = m.line([50, -10, 0], [50, 100, 0]) as any
            expect(() => outline.intersects(cutter)).not.toThrow()
        })

        it('collection(a, b) holds brep shapes passed one by one, and copy() keeps them', () =>
        {
            const a = m.box(10) as any
            const b = (m.box(20) as any).move(50)
            const c = m.collection(a, b)
            expect(c.length).toBe(2)
            expect(c.copy().length).toBe(2)
            expect(m.all().length).toBe(4)     // the two copies joined the scene
        })

        it('mirror(direction, position) reads its arguments like the mesh kernel', () =>
        {
            const box = () => (m.box(100, 50, 20) as any).move(100, 0, 0)

            // an axis and a coordinate
            expect(box().mirror('x', 0).bbox().center().x).toBeCloseTo(-100, 3)
            // a normal vector and a point on the plane
            expect(box().mirror([1, 0, 0], [0, 0, 0]).bbox().center().x).toBeCloseTo(-100, 3)
            // a non-unit vector alone: the plane sits at its end point (mirror([250]) ⇒ x = 250)
            expect(box().mirror([250]).bbox().center().x).toBeCloseTo(400, 3)
            // no position: the shape's own centre, so it stays put
            expect(box().mirror('y').bbox().center().x).toBeCloseTo(100, 3)
        })

        it('Vector.rotate(axis, angle) takes the axis first, like the mesh kernel', () =>
        {
            const v = m.vector(1, 0, 0) as any
            v.rotate([0, 0, 1], 90)
            expect(v.x).toBeCloseTo(0, 6)
            expect(v.y).toBeCloseTo(1, 6)
            expect((m.vector(1, 0, 0) as any).rotated([0, 1, 0], -90).z).toBeCloseTo(1, 6)
        })

        it('toMesh() is a no-op on brep shapes, so `.toMesh().edges()` scripts run', () =>
        {
            const face = m.plane(100, 50) as any
            expect(face.toMesh()).toBe(face)
            expect(face.toMesh().edges().length).toBe(4)
            expect(m.collection(face).toMesh().length).toBe(1)
        })

        it('row(), grid() and array() name their copies like the mesh kernel', () =>
        {
            const names = (col: any) => col.toArray().map((s: any) => s.name())
            expect(names((m.box(10) as any).name('stud').row(3, 5))).toEqual(['stud1', 'stud2', 'stud3'])
            expect(names((m.box(10) as any).name('post').grid(2, 2, 1, 5))).toEqual(['post11', 'post21', 'post12', 'post22'])
            expect(names((m.box(10) as any).name('tile').array([2, 1, 1]))).toEqual(['tile11', 'tile21'])
            // array() without offsets places the copies side by side, as meshup does
            expect((m.box(10) as any).array([2, 1, 1]).bbox().width()).toBeCloseTo(20, 3)
        })

        it('a collection selects across its members as a whole, like the mesh kernel', () =>
        {
            const edges = (m.plane(100, 50) as any).edges()
            const left = edges.select('E||left')
            expect(left.type).toBe('Edge')                       // one hit → the shape itself
            expect(left.bbox().max().x).toBeCloseTo(-50, 3)      // the left-most OF THE FOUR
            expect(edges.select('E||left and E||right').length).toBe(2)
            // meshup collections holding brep shapes answer the same way
            expect((m.collection(edges) as any).select('E||left').type).toBe('Edge')
        })

        it('extrudes a straight edge into the coordinate plane the mesh kernel picks, facing the same way', () =>
        {
            // a vertical line: the XZ plane (y normal), not +x
            const face = (m.line([600, 0, 0], [600, 0, 650]) as any).extrude(50)
            expect(face.bbox().max().y).toBeCloseTo(50, 3)
            expect(face.bbox().width()).toBeCloseTo(0, 3)
            // its normal is (edge direction × extrusion) = −x, so the next default extrude goes −x
            expect(face.normal().x).toBeCloseTo(-1, 6)
            const solid = face.extrude(25)
            expect(solid.bbox().min().x).toBeCloseTo(575, 3)
            expect(solid.bbox().max().x).toBeCloseTo(600, 3)
            // a horizontal line in the XY plane goes up
            expect((m.line([0, 0, 0], [100, 0, 0]) as any).extrude(50).bbox().max().z).toBeCloseTo(50, 3)
        })

        it('an operation that rebuilds the shape keeps its name in the scene', () =>
        {
            const box = (m.box(100, 50, 20) as any).name('crate')
            box.mirror([250])
            expect(box.name()).toBe('crate')
            const paths = m.scene().descendants().filter((n: any) => n.shape()).map((n: any) => decodeURIComponent(n.path()))
            expect(paths).toContain('Scene/crate')
        })

        it('bbox() is exact, before and after the shape has been meshed for export', () =>
        {
            const line = m.line([0, 0, 0], [100, 0, 0]) as any
            expect(line.bbox().depth()).toBe(0)
            line.toMeshShape?.({ linearDeflection: 0.1, angularDeflection: 0.5, tolerance: 1e-6, edgeMinimalPoints: 2, edgeMinimalLength: 1e-3 })
            expect(line.bbox().depth()).toBe(0)
            expect(line.bbox().width()).toBe(100)
        })
    })
})
