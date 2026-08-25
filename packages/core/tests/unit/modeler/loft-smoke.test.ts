import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

/**
 * SmartMeshCurve.loft() must wrap the raw meshup result (Polygon/Mesh) as a Smart
 * shape and add it to the scene. Previously loft() was not overridden, so it returned
 * a plain kernel shape with no scene node — "no result" in the script scope.
 */
describe('SmartMeshCurve.loft()', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    const inScene = (s: any) => m.all().toArray().includes(s)

    it('lofts two straight lines into a scene-registered SmartMeshPolygon (flat quad)', () =>
    {
        const ll1 = m.line([0,0,0],[100,0,100]).move(300) as any
        const ll2 = ll1.copy().extend(50).move(40,40,40) as any

        const surf = ll1.loft(ll2) as any
        expect(surf).toBeTruthy()
        expect(surf.constructor.name).toBe('Polygon')
        expect(surf.area()).toBeCloseTo(6656.854, 2)

        // result is in the scene; the source profile (ll1) is replaced, ll2 remains
        expect(inScene(surf)).toBe(true)
        expect(inScene(ll1)).toBe(false)
        expect(inScene(ll2)).toBe(true)
        expect(m.all().length).toBe(2)   // ll2 + lofted surface (no leaks)
    })

    it('still renders to GLTF after a loft', async () =>
    {
        const a = m.line([0,0,0],[100,0,0]) as any
        const b = m.line([0,50,0],[100,50,0]) as any
        a.loft(b)
        const g = await (m as any).toGLTF()
        expect(typeof g).toBe('string')
        expect(g.length).toBeGreaterThan(100)
    })
})
