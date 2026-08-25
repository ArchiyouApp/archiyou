import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import type { ArchiyouModules } from '../../../src/types'

/**
 * Binary STL export for the Modeler pipeline: all scene meshes are merged into a
 * single STL by concatenating their triangle records. See Modeler.toSTL().
 */
describe('Modeler STL export', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
    })

    beforeEach(() => { modeler.reset() })

    const numTriangles = (stl: Uint8Array): number =>
        new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true)

    it('returns null on an empty scene', () =>
    {
        expect(modeler.toSTL()).toBeNull()
    })

    it('exports a single box as a well-formed binary STL', () =>
    {
        modeler.box(10, 10, 10)

        const stl = modeler.toSTL() as Uint8Array
        expect(stl).toBeInstanceOf(Uint8Array)

        const tris = numTriangles(stl)
        expect(tris).toBeGreaterThanOrEqual(12) // a box tessellates to >= 12 triangles
        expect(stl.byteLength).toBe(84 + tris * 50)
    })

    it('merges all meshes in the scene into one STL', () =>
    {
        modeler.box(10, 10, 10)
        const one = numTriangles(modeler.toSTL() as Uint8Array)

        modeler.reset()
        modeler.box(10, 10, 10)
        modeler.box(10, 10, 10).move(50, 0, 0)
        const two = numTriangles(modeler.toSTL() as Uint8Array)

        expect(two).toBe(one * 2)
    })

    it('skips 2D-only scenes (no meshes)', () =>
    {
        modeler.rect(10, 10)
        expect(modeler.toSTL()).toBeNull()
    })
})

/** AMF export — see Modeler.toAMF(). One <object> per scene mesh in one document. */
describe('Modeler AMF export', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
    })

    beforeEach(() => { modeler.reset() })

    it('returns null when the scene has no meshes', () =>
    {
        expect(modeler.toAMF()).toBeNull()

        modeler.rect(10, 10)
        expect(modeler.toAMF()).toBeNull()
    })

    it('exports one object per mesh in a single document with the modeler units', () =>
    {
        modeler.box(10, 10, 10)
        modeler.box(10, 10, 10).move(50, 0, 0)

        const amf = modeler.toAMF() as string
        expect(amf.startsWith('<?xml')).toBe(true)
        expect(amf).toContain('<amf unit="millimeter" version="1.1">')
        expect(amf.trim().endsWith('</amf>')).toBe(true)

        // exactly two objects, renumbered to integer ids, each with its own mesh
        expect([...amf.matchAll(/<object id="(\d+)"/g)].map(m => m[1])).toEqual(['0', '1'])
        expect([...amf.matchAll(/<\/object>/g)].length).toBe(2)
        expect([...amf.matchAll(/<mesh>/g)].length).toBe(2)
        // no nested/duplicated document headers from the per-mesh exports
        expect([...amf.matchAll(/<amf /g)].length).toBe(1)
        expect([...amf.matchAll(/<\?xml/g)].length).toBe(1)
    })

    it('maps the modeler units onto the AMF unit name', async () =>
    {
        const inchModeler = new Modeler('mesh', 'inch')
        await inchModeler.load()
        inchModeler.setArchiyou({ modeler: inchModeler } as unknown as ArchiyouModules)
        inchModeler.box(1, 1, 1)

        expect(inchModeler.toAMF()).toContain('<amf unit="inch"')
    })
})
