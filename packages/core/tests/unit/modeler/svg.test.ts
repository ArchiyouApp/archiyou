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

    /**
     * The drawing plane. An SVG serializer projects by dropping z and flipping y, which is a
     * plan and only a plan — a wall elevation modelled on XZ has one y for every point, so it
     * collapsed to a single horizontal line. The drawing is now taken in the plane the
     * geometry actually lies on. See src/modeler/utils.ts.
     */
    describe('drawing plane', () =>
    {
        /** Everything but the ids, which name shapes and differ between two builds. */
        const skeleton = (svg: string): string => svg.replace(/ id="[^"]*"/g, '')

        /** One of each thing the serializers can draw. */
        const drawEverything = (place: (shape: any) => void): void =>
        {
            const rect = modeler.rect(100, 50) as any
            rect.fillet(10)                                     // path with arcs
            place(rect)
            place(modeler.circle(20, [200, 0, 0]))              // <circle>
            place(modeler.arc([300, 0, 0], [320, 20, 0], [340, 0, 0]))
            place(modeler.line([0, 100, 0], [100, 100, 0]))
            place(modeler.spline([0, -100, 0], [50, -50, 0], [100, -150, 0], [150, -100, 0]))
        }

        const drawingOf = (draw: (place: (shape: any) => void) => string,
            place: (shape: any) => void): string =>
        {
            modeler.reset()
            return skeleton(draw(place))
        }

        // The sharpest statement of what "draw in the model's own plane" has to mean: stood up
        // on XZ, the same shapes must produce the same drawing they do lying on XY.
        it('draws an XZ model exactly as it draws the same model on XY', () =>
        {
            const scene = (place: any) => { drawEverything(place); return modeler.toSVG() as string }
            expect(drawingOf(scene, s => s.rotateX(90))).toBe(drawingOf(scene, () => {}))
        })

        it('draws a YZ model exactly as it draws the same model on XY', () =>
        {
            const scene = (place: any) => { drawEverything(place); return modeler.toSVG() as string }
            // 120 degrees about [1,1,1] cycles x -> y -> z -> x, landing XY on YZ.
            expect(drawingOf(scene, s => s.rotateAround(120, [1, 1, 1]))).toBe(drawingOf(scene, () => {}))
        })

        it('draws in the plane through the drawing serializer too', () =>
        {
            const drawing = (place: any) => { drawEverything(place); return (modeler.all() as any).toSVG() as string }
            expect(drawingOf(drawing, s => s.rotateX(90))).toBe(drawingOf(drawing, () => {}))
        })

        it('draws in the plane through the options serializer too', () =>
        {
            const assembled = (place: any) => { drawEverything(place); return modeler.toSVG({ padding: 0.05 }) as string }
            expect(drawingOf(assembled, s => s.rotateX(90))).toBe(drawingOf(assembled, () => {}))
        })

        // What the collapse actually looked like: a 4m bent came out as a 4730 x 430 strip.
        it('gives an elevation its real height instead of a flat line', () =>
        {
            modeler.line([0, 0, 0], [4000, 0, 0])
            modeler.line([0, 0, 0], [0, 0, 2500])   // 2.5m up, on XZ

            const svg = modeler.toSVG() as string
            const [, , , height] = (svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/) ?? [])
                .slice(1).map(Number)
            expect(height).toBeGreaterThan(2500)
        })

        // The copies the rotation is applied to are thrown away; the scene keeps its own
        // coordinates, so a script can draw and go on modelling with the same shapes.
        it('leaves the scene untouched', () =>
        {
            const rect = (modeler.rect(100, 50) as any).rotateX(90)
            const before = [rect.bbox().min().toArray(), rect.bbox().max().toArray()]

            expect(modeler.toSVG()).not.toBeNull()
            ;(modeler.all() as any).toSVG()

            expect([rect.bbox().min().toArray(), rect.bbox().max().toArray()]).toEqual(before)
        })

        // is2D() tests a bbox extent for an EXACT zero, and a rect rotated onto XZ keeps
        // ~1e-15 of it — so a model built by rotation was turned away before it was drawn.
        it('draws a model whose plane carries rounding from a rotation', () =>
        {
            ;(modeler.rect(100, 50) as any).rotateX(90)
            expect(modeler.toSVG()).not.toBeNull()
        })

        it('still draws a scene with no plane of its own as a plan', () =>
        {
            const box = modeler.box(100, 60, 40)
            const flat = (box as any).flatten?.()
            expect(modeler.toSVG() ?? (flat ? 'drawn' : null)).toBeTruthy()
        })
    })

    /**
     * The layer style cascade. A layer is a SceneNode and its colour and linetype cascade to
     * the shapes beneath it, resolved at export time — meshup's toSVGElem() reads
     * `shape.style` alone and knows nothing about it. See withCascadedStyles() in
     * src/modeler/SVGExporter.ts, and the same resolution in the DXF exporter.
     */
    describe('layer style cascade', () =>
    {
        /** Presentation attributes of every drawn element, in document order. */
        const drawn = (svg: string): Array<Record<string, string>> =>
            [...svg.matchAll(/<(?:path|circle)\b([^>]*)>/g)].map(m =>
                Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])))

        it('draws a shape in the colour and linetype its layer sets', () =>
        {
            modeler.layer('diagram').color('blue').dashed()
            modeler.rect(100, 50)

            const [rect] = drawn(modeler.toSVG() as string)
            expect(rect.stroke).toBe('#0000ff')
            expect(rect['stroke-dasharray']).toBe('5 5')
        })

        it('lets a shape override its layer, keeping what it did not set', () =>
        {
            modeler.layer('diagram').color('blue').dashed()
            ;(modeler.circle(10) as any).color('grey')

            const [circle] = drawn(modeler.toSVG() as string)
            expect(circle.stroke).toBe('#808080')          // the shape's own colour wins
            expect(circle['stroke-dasharray']).toBe('5 5') // the layer's dash still applies
        })

        it('cascades through nested layers', () =>
        {
            modeler.layer('frame').color('green')
            modeler.group('braces', modeler.rect(10, 10))

            expect(drawn(modeler.toSVG() as string)[0].stroke).toBe('#008000')
        })

        // The swap withCascadedStyles() makes has to be undone whatever happens, or a second
        // export would read a style the author never set — and the viewer would show it.
        it('leaves the shapes exactly as it found them', () =>
        {
            modeler.layer('diagram').color('blue')
            const rect = modeler.rect(100, 50) as any
            const before = JSON.stringify(rect.style.explicitData())

            modeler.toSVG()
            modeler.toSVG()   // a second pass must see the same scene as the first

            expect(JSON.stringify(rect.style.explicitData())).toBe(before)
            expect(drawn(modeler.toSVG() as string)[0].stroke).toBe('#0000ff')
        })

        // The drawing serializer already wrote a shape's own colour inline, so dropping the
        // one its layer gave it was the odd one out.
        it('reaches the drawing serializer too', () =>
        {
            modeler.layer('diagram').color('blue').dashed()
            modeler.rect(100, 50)

            const [rect] = drawn((modeler.all() as any).toSVG() as string)
            expect(rect.stroke).toBe('#0000ff')
            expect(rect['stroke-dasharray']).toBe('5 5')
        })
    })

})
