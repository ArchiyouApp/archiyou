import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'

describe('scale() default pivot (mesh kernel)', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    it('rect().moveY(1000).copy().scale(2) keeps its center', () =>
    {
        const r1 = m.rect(30, 40).moveY(1000) as any
        const c0 = r1.center()
        const r2 = r1.copy().scale(2)
        const c1 = r2.center()

        expect(c1.x).toBeCloseTo(c0.x, 5)
        expect(c1.y).toBeCloseTo(c0.y, 5)
        expect(c1.z).toBeCloseTo(c0.z, 5)

        const bb = r2.bbox()
        expect(bb.width()).toBeCloseTo(60, 5)
        expect(bb.depth()).toBeCloseTo(80, 5)
    })

    it('explicit pivot is still honoured', () =>
    {
        const r = m.rect(30, 40).moveY(1000) as any
        r.scale(2, [0, 0, 0])
        expect(r.center().y).toBeCloseTo(2000, 5)
    })

    it('mesh scales around its own center', () =>
    {
        const b = m.box(10, 10, 10).moveY(1000) as any
        const c0 = b.center()
        b.scale(2)
        expect(b.center().y).toBeCloseTo(c0.y, 5)
        expect(b.bbox().height()).toBeCloseTo(20, 5)
    })

    it('collection scales as a group around the collection center', () =>
    {
        const a = m.box(10, 10, 10).moveX(-100) as any
        const b = m.box(10, 10, 10).moveX(100) as any
        const coll = m.collection(a, b) as any
        coll.scale(2)
        expect(a.center().x).toBeCloseTo(-200, 5)
        expect(b.center().x).toBeCloseTo(200, 5)
    })
})
