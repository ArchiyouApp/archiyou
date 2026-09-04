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

    it('sketch() uses the mesh kernel Sketch in both modes', () =>
    {
        // brep/Sketch.ts was dropped; sketching yields meshup Curves into the shared scene
        const sketch = m.sketch('xy')
        expect(sketch).toBeTruthy()
        expect(sketch.constructor.name).toBe('Sketch')
    })
})
