import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'

describe('scene-decorator smoke', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    const inScene = (s: any) => m.all().toArray().includes(s)

    it('@sceneReplace: curve.extrude detaches self, adds SmartMesh', () =>
    {
        const c = m.circle(20)
        expect(inScene(c)).toBe(true)
        const mesh = (c as any).extrude(10)
        expect(mesh.constructor.name).toBe('Mesh')
        expect(inScene(mesh)).toBe(true)     // result added
        expect(inScene(c)).toBe(false)       // original detached
    })

    it('@sceneReplace: polygon.extrude → SmartMesh in scene', () =>
    {
        const p = m.polygon([[0,0,0],[50,0,0],[50,50,0],[0,50,0]])
        const mesh = (p as any).extrude(10)
        expect(mesh.constructor.name).toBe('Mesh')
        expect(inScene(mesh)).toBe(true)
        expect(inScene(p)).toBe(false)
    })

    it('@toSmart: polygon.toMesh wraps, no scene mutation', () =>
    {
        const p = m.polygon([[0,0,0],[50,0,0],[50,50,0],[0,50,0]])
        const before = m.all().length
        const mesh = (p as any).toMesh()
        expect(mesh.constructor.name).toBe('Mesh')
        expect(m.all().length).toBe(before)  // pure: no scene change
        expect(inScene(p)).toBe(true)
    })

    it('@sceneAdd: mesh.select wraps multiple matches into a SmartShapeCollection in scene', () =>
    {
        const box = m.box(40, 40, 40) as any
        const sel = box.select('E||top') // 4 top-face edges
        expect(sel).toBeInstanceOf(SmartShapeCollection)
        expect(sel.length).toBe(4)
        sel.toArray().forEach((s: any) => expect(s.isShapeClass?.()).toBe(true))
    })

    it('@sceneAdd: mesh.select collapses a single match to a Smart shape (checkSingle)', () =>
    {
        const box = m.box(40, 40, 40) as any
        const sel = box.select('F||top') // one top face → single SmartMeshPolygon
        expect(sel).not.toBeInstanceOf(SmartShapeCollection)
        expect(sel.isShapeClass?.()).toBe(true)
    })

    it('@sceneAdd: curve.select wraps greedy matches as Smart shapes', () =>
    {
        const rect = m.rect(100, 100) as any
        // 'V||left' underspecifies a vertex → both left corners → SmartShapeCollection
        const verts = rect.select('V||left')
        expect(verts).toBeInstanceOf(SmartShapeCollection)
        expect(verts.length).toBe(2)
        verts.toArray().forEach((v: any) => expect(v.constructor.name).toBe('Vertex'))
        // 'E||front' matches exactly one edge → collapsed to a single SmartMeshCurve
        const edge = rect.select('E||front')
        expect(edge).not.toBeInstanceOf(SmartShapeCollection)
        expect(edge.constructor.name).toBe('Curve')
    })

    it('@sceneLayer: mesh.elevation puts curves on elevation layer, keeps original', () =>
    {
        const box = m.box(40, 40, 40) as any
        const before = inScene(box)
        const elev = box.elevation('front')
        expect(elev).toBeTruthy()
        expect(inScene(box)).toBe(before)    // original kept
        const layer = m.scene().find('elevation')
        expect(layer).toBeTruthy()
        expect((layer as any).shapes().length).toBeGreaterThan(0)
    })

    it('@toSmart on collection: box.row(3) → SmartShapeCollection of SmartMesh', () =>
    {
        const col = (m.box(20,20,20) as any).row(3, 10)
        expect(col).toBeInstanceOf(SmartShapeCollection)
        expect(col.length).toBe(3)
        col.toArray().forEach((s: any) => expect(s.constructor.name).toBe('Mesh'))
    })

    it('mesh collection.extrude forwards to each shape in meshup (no brep round-trip)', () =>
    {
        // Regression: collection.extrude used to force _toBrepCollection(), which
        // for a mesh-mode collection of closed curves warned "brep adapter not set"
        // and returned an empty collection. A collection of SmartMeshCurve sections
        // must extrude via the mesh kernel instead.
        const a = m.rect(20, 40)                 // closed SmartMeshCurve sections
        const b = m.rect(20, 40).move(100, 0, 0)
        const nested = m.collection(m.rect(20, 40).move(50, 0, 0))
        const sections = m.collection(a, nested, b) // nested collection is flattened → 3 shapes

        const solids = (sections.copy() as any).extrude(100)
        expect(solids).toBeInstanceOf(SmartShapeCollection)
        expect(solids.length).toBe(3)            // not empty
        solids.toArray().forEach((s: any) =>
        {
            expect(s.constructor.name).toBe('Mesh')
            expect(inScene(s)).toBe(true)
        })
    })

    it('@sceneUpdate: polygon.subtract notches in place, keeps the node, no scene pollution', () =>
    {
        const pl = m.plane(100, 100) as any    // centred: x,y ∈ [-50, 50], area 10000
        expect(pl.area()).toBeCloseTo(10000, 0)
        const cutter = m.rect(20, 20).move(50, 50, 0) as any // closed SmartMeshCurve at the +x/+y corner
        const before = m.all().length          // includes pl + cutter

        const out = pl.subtract(cutter)         // 10x10 bite out of the corner

        expect(out).toBe(pl)                    // same object
        expect(pl.area()).toBeCloseTo(9900, 0)
        expect(inScene(pl)).toBe(true)          // still in scene, same node
        expect(m.all().length).toBe(before)     // subtract added no stray pieces
    })

    it('regression: planeBetween renders to GLTF', async () =>
    {
        m.planeBetween([0,0,0],[100,100,0])
        const g = await (m as any).toGLTF()
        expect(typeof g).toBe('string')
        expect(g.length).toBeGreaterThan(100)
    })

    it('@sceneUpdate: plane.cutoff mutates in place, keeps largest piece, no scene pollution', () =>
    {
        const pl = m.plane(100, 100) as any   // centred: x,y ∈ [-50, 50]
        expect(pl.area()).toBeCloseTo(10000, 0)
        const before = m.all().length

        pl.cutoff('x', 30)                     // largest piece: x ∈ [-50, 30] → 80 x 100

        expect(pl.area()).toBeCloseTo(8000, 0)
        expect(inScene(pl)).toBe(true)         // same object, still in scene
        // cutoff internally splits, but the intermediate pieces must NOT leak into the scene
        expect(m.all().length).toBe(before)
    })

    it('@sceneUpdate: plane.cutoff(smallest=true) keeps the smallest piece', () =>
    {
        const pl = m.plane(100, 100) as any
        pl.cutoff('x', 30, true)               // smallest piece: x ∈ [30, 50] → 20 x 100
        expect(pl.area()).toBeCloseTo(2000, 0)
    })

    it('@sceneUpdate: plane.cutoffBy mutates in place without scene pollution', () =>
    {
        const pl = m.plane(100, 100) as any
        const before = m.all().length
        pl.cutoffBy(m.line([30, -60, 0], [30, 60, 0]))
        // line() adds a curve to the scene; cutoffBy itself must add nothing more.
        expect(pl.area()).toBeCloseTo(8000, 0)
        expect(inScene(pl)).toBe(true)
        expect(m.all().length).toBe(before + 1) // only the cutter line, not split pieces
    })

    //// SCENE-DERIVED SUB-SHAPES ////
    //
    // segments()/start()/vertices() are @sceneCarry: they hand back fresh, unattached shapes
    // (adding every segment of every curve would flood the scene). Those shapes still carry
    // their source's scene root, so a later @sceneUpdate op on one can find the active layer.

    it('@sceneCarry: segments() stay out of the scene but carry the scene root', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const before = m.all().length
        const seg = pl.segments().first()
        expect(inScene(seg)).toBe(false)
        expect(m.all().length).toBe(before)
        expect(seg._scene).toBe(pl._node.root())
    })

    it('copy() of a detached sub-shape attaches it: copy() means "give me a new shape"', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const seg = pl.segments().first()

        const c = seg.copy().moveZ(10)

        expect(inScene(seg)).toBe(false)   // the accessor result itself stays out
        expect(inScene(c)).toBe(true)      // its copy does not
    })

    it('copy() of a shape removed from the scene stays out', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const template = pl.copy().removeFromScene()
        const before = m.all().length

        const c = template.copy()

        expect(inScene(c)).toBe(false)
        expect(m.all().length).toBe(before)
    })

    it('_copy() is the pure clone: never touches the scene', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const before = m.all().length

        const c = pl._copy()

        expect(inScene(c)).toBe(false)
        expect(m.all().length).toBe(before)
    })

    it('@sceneUpdate: connect() on a copied segment puts the result in the scene', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const opl = pl.copy().offset(-10) as any

        const r = pl.segments().first().copy().connect(opl.segments().first())

        expect(inScene(r)).toBe(true)
        expect(r.isClosed()).toBe(true)
    })

    it('@sceneUpdate: offset() on a shape removed from the scene must not re-add it', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const helper = pl.copy().removeFromScene()
        const before = m.all().length

        helper.offset(-10)

        expect(inScene(helper)).toBe(false)
        expect(m.all().length).toBe(before)
    })

    it('tmp() sub-shapes stay out of the scene through connect()', () =>
    {
        const pl = m.polyline([0, 0, 0], [100, 0, 100], [200, 0, 0]) as any
        const opl = pl.copy().offset(-10) as any
        const before = m.all().length

        const r = pl.segments().first().copy().tmp().connect(opl.segments().first())

        expect(inScene(r)).toBe(false)
        expect(m.all().length).toBe(before)
    })
})
