import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

describe('SmartShape.distance mesh path', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it("reproduces the reported plane/polyline example", () =>
    {
        const pl = (m.polyline([-100,0,0],[100,0,0],[0,100,0]) as any).close()
        const p  = m.plane(10,10) as any
        expect(p.distance(pl)).toBeCloseTo(0, 4)   // was 95
        expect(pl.distance(p)).toBeCloseTo(0, 4)   // was undefined
    })
})
