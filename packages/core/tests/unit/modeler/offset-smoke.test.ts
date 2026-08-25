import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

describe('SmartMeshPolygon.offset mutates in place', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })
    afterEach(() => { vi.restoreAllMocks() })

    const inScene = (s: any) => m.all().toArray().includes(s)

    it('planeBetween(...).offset(100) mutates the polygon in place, same scene node', () =>
    {
        const pl = m.planeBetween([0,0,0],[100,100,0])
        expect(pl.constructor.name).toBe('Polygon')
        const node = (pl as any)._node
        const before = m.all().length

        const off = (pl as any).offset(100)
        expect(off).toBe(pl)                                     // same object (in-place)
        expect((pl as any)._node).toBe(node)                     // same scene node
        expect(inScene(pl)).toBe(true)                           // still in scene
        expect(m.all().length).toBe(before)                      // no new shape added
        // outward offset of the 100x100 plane grows the bbox
        expect(pl.bbox().width()).toBeGreaterThan(100)
    })

    it('still renders to GLTF after offset', async () =>
    {
        ;(m.planeBetween([0,0,0],[100,100,0]) as any).offset(100)
        const g = await (m as any).toGLTF()
        expect(typeof g).toBe('string')
        expect(g.length).toBeGreaterThan(100)
    })

    it('rectBetween(...).offset(...) on XZ does not emit a fallback error', () =>
    {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const rect = m.rectBetween([0,0,0], [100,0,100])
        const node = (rect as any)._node
        const before = m.all().length
        const offsetRect = (rect as any).offset(10)

        expect(offsetRect).toBe(rect)
        expect((rect as any)._node).toBe(node)
        expect(m.all().length).toBe(before)
        expect(errorSpy).not.toHaveBeenCalled()
        offsetRect.points().forEach((point: any) =>
        {
            expect(point.y).toBeCloseTo(0, 6)
        })
    })
})
