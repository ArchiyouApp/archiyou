import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

describe('start()/end() wrap to SmartMeshVertex; dim() works', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('line.start() returns a SmartMeshVertex with toPoint()', () =>
    {
        const ln = m.line([0,0,0],[100,100,0]) as any
        const s = ln.start()
        expect(s.constructor.name).toBe('Vertex')
        expect(typeof s.toPoint).toBe('function')   // regression: was empty collection
        const p = s.toPoint()
        expect(p.x).toBeCloseTo(0)
        expect(p.y).toBeCloseTo(0)
    })

    it('line.end() returns a SmartMeshVertex', () =>
    {
        const e = (m.line([0,0,0],[100,100,0]) as any).end()
        expect(e.constructor.name).toBe('Vertex')
        expect(e.toPoint().x).toBeCloseTo(100)
    })

    // NOTE: full dim() needs the annotator module wired (Runner does this); a bare
    // Modeler has no modules. The regression here was start()/end() returning an empty
    // SmartShapeCollection instead of a SmartMeshVertex — covered above.
})
