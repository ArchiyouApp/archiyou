import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import type { ArchiyouModules } from '../../../src/types'

/** SVG export for the Modeler pipeline — see Modeler.toSVG(). */
describe('Modeler SVG export', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
    })

    beforeEach(() => { modeler.reset() })

    it('returns null when the scene has no 2D geometry', () =>
    {
        expect(modeler.toSVG()).toBeNull()

        modeler.box(10, 10, 10)
        expect(modeler.toSVG()).toBeNull()
    })

    it('exports 2D shapes as an SVG document', () =>
    {
        modeler.rect(10, 20)

        const svg = modeler.toSVG() as string
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
        expect(svg).toContain('viewBox=')
        expect(svg.trim().endsWith('</svg>')).toBe(true)
    })

    /*  flatten() answers with MESHES — the axis-aligned faces, collapsed onto the plane — and
        the drawing assembler only ever collected curves(). A flattened footprint therefore
        drew nothing at all: no curves, so no line-work, so no document. */
    it('draws the faces of a flattened collection, not just curves', () =>
    {
        const b = modeler.box(100, 10, 30)
        const b2 = modeler.box(20, 40, 30).move(50).moveZ(100)

        const svg = modeler.collection(b, b2).flatten().toSVG() as string

        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
        expect(svg.match(/<polygon /g)?.length).toBe(2)
    })

    /*  The richer serializer (options given) reads the same drawable shapes — it used to be
        handed `.curves()` and so could not see a face even if it wanted to. */
    it('draws flattened faces through the options serializer too', () =>
    {
        modeler.box(100, 10, 30).flatten()

        const svg = modeler.toSVG({ padding: 0.05 }) as string
        expect(svg).toContain('<polygon ')
    })

    it('leaves a 3D collection to a projection', () =>
    {
        // Nothing to draw from above that would say anything about a box — that is what
        // isometry()/elevation()/section() are for. core has nothing to assemble, so the
        // kernel's own placeholder (which says so) is what comes back.
        expect(modeler.collection(modeler.box(10, 10, 10)).toSVG()).toContain('nothing 2D to draw')
    })
})
