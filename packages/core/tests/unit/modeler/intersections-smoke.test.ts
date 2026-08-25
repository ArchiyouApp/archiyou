import { describe, it, expect, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'

describe('collection.intersections mesh path', () =>
{
    let m: Modeler
    beforeEach(async () => { m = new Modeler(); await m.load() })

    const inScene = (s: any) => m.all().toArray().includes(s)

    it('intersections() returns a SmartShapeCollection', () =>
    {
        const boxes = (m.box(10, 10, 100) as any).row(5)
        const subbox = (m.box(100, 50, 50) as any).color('blue')
        const icol = boxes.copy().intersections(subbox)
        expect(icol).toBeInstanceOf(SmartShapeCollection)
        icol.toArray().forEach((s: any) => expect(s.constructor.name).toBe('Mesh'))
    })

    it('intersections() replaces in place: originals removed, results visible', () =>
    {
        const boxes = (m.box(10, 10, 100) as any).row(5)
        const subbox = (m.box(100, 50, 50) as any).color('blue')
        const copy = boxes.copy()
        const originals = copy.toArray()
        const icol = copy.intersections(subbox).name('icol')

        // Results are in the scene...
        expect(icol.length).toBeGreaterThan(0)
        icol.toArray().forEach((s: any) => expect(inScene(s)).toBe(true))

        // ...and the source copies were removed from the scene.
        originals.forEach((s: any) => expect(inScene(s)).toBe(false))
    })
})
