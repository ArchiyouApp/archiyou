import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

/**
 * Length-based checks for line().offset().cutoffBy() in the modeler scope.
 *
 * Regression: cutting an open line by a crossing line in a non-XY coordinate
 * plane (XZ) used to leave the curve uncut (curvo's curve intersection runs in
 * the XY plane), so the "cut" length equalled the original length.
 */
describe('line().offset().cutoffBy() shortens the curve', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('XY plane', () =>
    {
        const ln = m.line([0,0,0],[100,100,0]).moveY(200) as any
        const lnd = m.line([0,0,0],[100,50,0]).moveY(240) as any
        const lnnew = ln.copy().offset(-10).cutoffBy(lnd) as any
        expect(lnnew.length()).toBeGreaterThan(0)
        expect(lnnew.length()).toBeLessThan(ln.length())   // an actual cut happened
    })

    it('XZ plane', () =>
    {
        const ln2 = m.line([0,0,0],[100,0,100]).moveZ(200) as any
        const lnd2 = m.line([0,0,0],[150,0,50]).moveZ(240) as any
        const lnnew2 = ln2.copy().offset(-10).cutoffBy(lnd2) as any
        expect(lnnew2.length()).toBeGreaterThan(0)
        expect(lnnew2.length()).toBeLessThan(ln2.length())  // an actual cut happened
        // the result stays in the XZ plane (y ~ 0)
        expect(Math.abs(lnnew2.start().toArray()[1])).toBeLessThan(1e-6)
        expect(Math.abs(lnnew2.end().toArray()[1])).toBeLessThan(1e-6)
    })

    it('XZ cutoff does not leak reprojected XY curves into the scene', () =>
    {
        // Regression: intersect() transforms into a local XY frame; using this.copy()
        // for the temporaries registered them in the scene, then flattened them onto
        // the XY plane — so the scene gained stray z=0 curves.
        const ln2 = m.line([0,0,0],[100,0,100]).moveZ(200) as any
        const lnd2 = m.line([0,0,0],[150,0,50]).moveZ(240) as any
        ln2.copy().offset(-10).cutoffBy(lnd2)

        const xyLeaks = m.all().toArray().filter((s: any) =>
            Math.abs(s.bbox().minZ()) < 1e-6 && Math.abs(s.bbox().maxZ()) < 1e-6)
        expect(xyLeaks.length).toBe(0)          // no shape collapsed onto the XY plane
        expect(m.all().length).toBe(3)          // ln2, lnd2, and the single cut copy
    })

    it('a cutter that does not intersect the curve leaves the length unchanged', () =>
    {
        // XZ curve vs an XY cutter: the two lines never meet in 3D, so no cut.
        const ln2 = m.line([0,0,0],[100,0,100]).moveZ(200) as any
        const lndXY = m.line([0,0,0],[100,50,0]).moveY(240) as any
        const res = ln2.copy().offset(-10).cutoffBy(lndXY) as any
        expect(res.length()).toBeCloseTo(ln2.length(), 6)   // unchanged (no intersection)
    })

    it('a closed XZ rect cut by a crossing line keeps the bigger region, in place', () =>
    {
        const rect = m.rectBetween([0,0,0],[100,0,100]) as any
        expect(rect.constructor.name).toBe('Curve')
        expect(rect.area()).toBeCloseTo(10000, 3)
        const cutter = m.line([-20,0,-20],[120,0,120]).moveZ(10) as any
        const before = m.all().length

        const res = rect.cutoffBy(cutter) as any
        expect(res).toBe(rect)                       // mutated in place
        expect(res.isClosed()).toBe(true)
        expect(res.area()).toBeCloseTo(5950, 3)      // larger of the two split regions
        expect(m.all().length).toBe(before)          // no extra shapes leaked into the scene
    })
})
