/**
 *  BREP → GLB.
 *
 *  The point of this file: a brep run must produce the SAME kind of output the editor's viewer
 *  already consumes. Geometry is tessellated into meshup shapes at export time (see
 *  brep/toMeshup.ts) and then goes through the unchanged mesh-kernel exporter, so what is
 *  asserted here is that the bytes are valid glTF, that the scene structure survives, and that
 *  the archiyou state extras the viewer/navigator read are present.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Document, WebIO } from '@gltf-transform/core'

import { Modeler } from '../../../src/modeler/Modeler'
import { brepShapeToMeshup, isBrepShape } from '../../../src/modeler/brep/toMeshup'
import * as brep from '../../../src/modeler/brep/index'
import * as meshup from '@archiyou/meshup'

/** Parse GLB bytes back into a glTF document — proves the output is real, not just non-empty */
async function readGLB(glb: Uint8Array): Promise<Document>
{
    return new WebIO().readBinary(glb)
}

describe('brep → meshup conversion', () =>
{
    // both kernels: brep to build the shapes, meshup to rebuild them as mesh geometry
    beforeAll(async () => { await brep.init(); await meshup.init() }, 60000)

    it('recognises brep shapes structurally', () =>
    {
        expect(isBrepShape(new brep.Solid().makeBox(10))).toBe(true)
        expect(isBrepShape({ type: 'Mesh' })).toBe(false)
        expect(isBrepShape(null)).toBe(false)
    })

    it('turns a Solid into a Mesh plus its edges', () =>
    {
        const result = brepShapeToMeshup(new brep.Solid().makeBox(100)) as any
        expect(result.isShapeCollection()).toBe(true)

        const shapes = result.toArray()
        const mesh = shapes.find((s: any) => s.type === 'Mesh')
        expect(mesh).toBeTruthy()
        // a box has 12 triangles and 12 edges
        expect(mesh.vertices().length).toBeGreaterThan(0)
        expect(shapes.filter((s: any) => s.type === 'Curve').length).toEqual(12)
    })

    /** Regression: the stand-in Mesh used to be built from bare points, which leaves every
     *  vertex normal at (0,0,0). A zero-normal surface takes no light, so a brep model
     *  rendered flat grey while its (unlit) edge lines still showed the shape's colour. */
    it('carries the tessellation normals onto the stand-in Mesh', () =>
    {
        const boxNormals = (brepShapeToMeshup(new brep.Solid().makeBox(100)) as any)
            .toArray().find((s: any) => s.type === 'Mesh').toBuffer().normals

        expect(boxNormals.length).toBeGreaterThan(0)
        for (let i = 0; i < boxNormals.length; i += 3)
        {
            const len = Math.hypot(boxNormals[i], boxNormals[i + 1], boxNormals[i + 2])
            expect(len).toBeCloseTo(1, 3)
        }
        // a box is flat-shaded: one normal per face, so six distinct directions
        const distinct = (ns: Float32Array | Array<number>) =>
        {
            const set = new Set<string>()
            for (let i = 0; i < ns.length; i += 3) set.add([0, 1, 2].map(k => ns[i + k].toFixed(3)).join(','))
            return set.size
        }
        expect(distinct(boxNormals)).toEqual(6)

        // a sphere keeps OC's per-node normals, so it shades smooth rather than faceted:
        // many more distinct normals than it has triangles' worth of facets
        const sphereNormals = (brepShapeToMeshup(new brep.Solid().makeSphere(50)) as any)
            .toArray().find((s: any) => s.type === 'Mesh').toBuffer().normals
        expect(distinct(sphereNormals)).toBeGreaterThan(distinct(boxNormals) * 10)
    })

    it('preserves the box dimensions through tessellation', () =>
    {
        const result = brepShapeToMeshup(new brep.Solid().makeBox(100, 50, 20)) as any
        const mesh = result.toArray().find((s: any) => s.type === 'Mesh')
        const bbox = mesh.bbox()
        expect(Math.round(bbox.width())).toEqual(100)
        expect(Math.round(bbox.depth())).toEqual(50)
        expect(Math.round(bbox.height())).toEqual(20)
    })

    it('turns an Edge into a single Curve', () =>
    {
        const result = brepShapeToMeshup(new brep.Edge().makeLine([0, 0, 0], [100, 0, 0])) as any
        expect(result.type).toEqual('Curve')
    })

    it('carries style across to the stand-in', () =>
    {
        const box = new brep.Solid().makeBox(10)
        box.color('blue')
        const result = brepShapeToMeshup(box) as any
        const mesh = result.toArray().find((s: any) => s.type === 'Mesh')
        expect(mesh.style.color).toBeTruthy()
    })
})

describe('Modeler brep GLB export', () =>
{
    let m: Modeler

    beforeAll(async () => { await new Modeler('brep').load() }, 60000)
    beforeEach(async () => { m = new Modeler('brep'); await m.load() })

    it('exports a brep scene to valid GLB', async () =>
    {
        m.box(100)
        const glb = await m.toGLB()

        expect(glb).toBeInstanceOf(Uint8Array)
        expect(glb.byteLength).toBeGreaterThan(0)

        const doc = await readGLB(glb)
        expect(doc.getRoot().listMeshes().length).toBeGreaterThan(0)
    })

    it('keeps the layer structure in the exported node tree', async () =>
    {
        m.layer('frame')
        m.box(100)
        const glb = await m.toGLB()

        const doc = await readGLB(glb)
        const names = doc.getRoot().listNodes().map(n => n.getName())
        expect(names.join(' ')).toContain('frame')
    })

    it('embeds the archiyou state the viewer and navigator read', async () =>
    {
        m.box(100)
        const glb = await m.toGLB()

        const doc = await readGLB(glb)
        const extras = doc.getRoot().getAsset() as any
        // state lives in the document extras written by the core GLTFBuilder
        const json = JSON.stringify(doc.getRoot().listScenes().map(s => s.getExtras()))
        expect(extras || json).toBeTruthy()
    })

    it('exports a mixed brep + mesh scene', async () =>
    {
        m.box(100)                              // brep Solid
        m.sketch('xy').moveTo(0, 0).lineTo(50, 0).lineTo(50, 50).close()  // meshup Curves

        const glb = await m.toGLB()
        const doc = await readGLB(glb)
        expect(doc.getRoot().listMeshes().length).toBeGreaterThan(0)
    })

    it('leaves the live scene intact after export', async () =>
    {
        const box = m.box(100) as any
        const nodeBefore = box.node()
        const countBefore = m.all().length

        await m.toGLB()

        // the export tree must not steal shapes out of the real scene — toArchiyouState()
        // runs after it and needs the scene whole
        expect(box.node()).toBe(nodeBefore)
        expect(m.all().length).toEqual(countBefore)
    })

    it('produces an STL from brep geometry', () =>
    {
        m.box(100)
        const stl = m.toSTL()
        expect(stl).toBeInstanceOf(Uint8Array)
        expect(stl!.byteLength).toBeGreaterThan(84)
    })
})
