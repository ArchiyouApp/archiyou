import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { DXFDocument, writeCurveToDXF } from '../../../src/modeler/DXFExporter'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

/**
 * DXF export for the Modeler pipeline (SmartSceneNode / SmartShapeCollection).
 * Covers native geometry entities, ALIGNED dimensions, unit header, 2D-only
 * filtering, and structural well-formedness. See src/modeler/DXFExporter.ts.
 */
describe('Modeler DXF export', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    /** Count occurrences of a DXF entity type in the ENTITIES / BLOCKS body. */
    const countEntity = (dxf: string, type: string): number =>
        (dxf.match(new RegExp(`^0\\n${type}\\n`, 'gm')) ?? []).length

    it('emits native geometry entities for 2D shapes', () =>
    {
        modeler.rect(100, 50)          // Rect → LWPOLYLINE (closed)
        modeler.circle(20, [200, 0, 0])  // Circle → CIRCLE
        modeler.arc([300, 0, 0], [320, 20, 0], [340, 0, 0]) // Arc → ARC
        modeler.line([0, 100, 0], [100, 100, 0])            // Line → LINE

        const dxf = modeler.toDXF()
        expect(dxf).not.toBeNull()
        const s = dxf as string

        expect(s).toContain('AC1015')                 // R2000
        expect(countEntity(s, 'LWPOLYLINE')).toBeGreaterThanOrEqual(1)
        expect(countEntity(s, 'CIRCLE')).toBe(1)
        expect(countEntity(s, 'ARC')).toBe(1)
        expect(countEntity(s, 'LINE')).toBeGreaterThanOrEqual(1)
    })

    it('writes ALIGNED DIMENSION entities + baked *D block + DIMSTYLE', () =>
    {
        const line = modeler.line([0, 0, 0], [120, 0, 0])
        ;(line as any).dim()

        const dxf = modeler.toDXF() as string
        expect(dxf).not.toBeNull()

        expect(countEntity(dxf, 'DIMENSION')).toBe(1)
        expect(dxf).toContain('AcDbAlignedDimension')
        expect(dxf).toContain('*D0')      // anonymous dim block
        expect(dxf).toContain('DIMSTYLE') // dimstyle table
        expect(dxf).toContain('AY')       // our dimstyle name
        // The measured value (120) should surface as dimension text.
        expect(dxf).toMatch(/120/)
    })

    it('skips 3D shapes (box) but keeps 2D shapes', () =>
    {
        modeler.rect(100, 100)     // 2D
        modeler.box(50, 50, 50)    // 3D → skipped

        const dxf = modeler.toDXF() as string
        expect(dxf).not.toBeNull()
        expect(countEntity(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(1)
        // A box would only ever appear as 3DFACE/MESH/POLYLINE — none of which we emit.
        expect(countEntity(dxf, '3DFACE')).toBe(0)
    })

    it('sets $INSUNITS from the model unit', () =>
    {
        modeler.units('cm')
        modeler.rect(10, 10)
        const dxf = modeler.toDXF() as string
        // $INSUNITS \n 70 \n 5  (5 = centimeters)
        expect(dxf).toMatch(/\$INSUNITS\n70\n5\n/)
    })

    it('returns null when there is no 2D geometry at all', () =>
    {
        modeler.box(50, 50, 50)
        expect(modeler.toDXF()).toBeNull()
    })

    it('produces a structurally balanced DXF (SECTION/ENDSEC + EOF)', () =>
    {
        modeler.rect(100, 100)
        const dxf = modeler.toDXF() as string
        const sections = (dxf.match(/^0\nSECTION\n/gm) ?? []).length
        const endsecs = (dxf.match(/^0\nENDSEC\n/gm) ?? []).length
        expect(sections).toBe(endsecs)
        expect(sections).toBeGreaterThanOrEqual(4) // HEADER, TABLES, BLOCKS, ENTITIES, OBJECTS
        expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    })

    it('SmartShapeCollection.toDXF() exports its own shapes', () =>
    {
        const col = modeler.collection(modeler.rect(40, 40), modeler.circle(10, [100, 0, 0]))
        const dxf = (col as any).toDXF() as string
        expect(dxf).not.toBeNull()
        expect(countEntity(dxf, 'CIRCLE')).toBe(1)
        expect(countEntity(dxf, 'LWPOLYLINE')).toBeGreaterThanOrEqual(1)
    })

    /**
     * Layers and styling. What an author calls a layer is a SceneNode, and its colour and
     * linetype cascade to the shapes beneath it — so both have to be read off the scene tree,
     * not off the shape. See the LAYERS & STYLE section of src/modeler/DXFExporter.ts.
     */
    describe('layers and styling', () =>
    {
        /** Group code/value pairs of every entity or table record of the given type. */
        const records = (dxf: string, type: string): Array<Array<[number, string]>> =>
        {
            const lines = dxf.split('\n')
            const out: Array<Array<[number, string]>> = []
            let cur: Array<[number, string]> | null = null
            for (let i = 0; i + 1 < lines.length; i += 2)
            {
                const code = Number(lines[i])
                const value = lines[i + 1]
                if (code === 0)
                {
                    if (cur) { out.push(cur); cur = null }
                    if (value === type) cur = []
                    continue
                }
                cur?.push([code, value])
            }
            if (cur) out.push(cur)
            return out
        }

        const value = (body: Array<[number, string]>, code: number): string | undefined =>
            body.find(([c]) => c === code)?.[1]

        /** The LAYER table records, keyed by name. */
        const layers = (dxf: string): Record<string, { rgb?: string; linetype?: string }> =>
            Object.fromEntries(records(dxf, 'LAYER')
                .map(b => [value(b, 2)!, { rgb: value(b, 420), linetype: value(b, 6) }]))

        /** Layer name + any per-entity override, one row per geometry entity. */
        const drawn = (dxf: string): Array<{ layer?: string; rgb?: string; linetype?: string }> =>
            ['LWPOLYLINE', 'LINE', 'CIRCLE', 'ARC'].flatMap(t => records(dxf, t))
                .map(b => ({ layer: value(b, 8), rgb: value(b, 420), linetype: value(b, 6) }))

        const rgb = (hex: number): string => String(hex)

        it('names DXF layers after the scene layer, not the shape', () =>
        {
            modeler.layer('walls')
            const shape = modeler.rect(100, 50) as any
            shape.name('southWall')   // the variable, not the layer

            const dxf = modeler.toDXF() as string
            expect(Object.keys(layers(dxf))).toContain('walls')
            expect(Object.keys(layers(dxf))).not.toContain('southWall')
            expect(drawn(dxf)[0].layer).toBe('walls')
        })

        it('puts shapes that are in no layer on the default layer 0', () =>
        {
            modeler.rect(100, 50)
            expect(drawn(modeler.toDXF() as string)[0].layer).toBe('0')
        })

        // A DXF layer name is flat, so a nested scene layer is spelled out with the same dot
        // notation addLayer('walls.inner') already uses.
        it('spells a nested scene layer as a dotted path', () =>
        {
            modeler.layer('walls')
            const inner = modeler.group('inner', modeler.rect(10, 10)) as any
            expect(inner).toBeTruthy()

            const dxf = modeler.toDXF() as string
            expect(Object.keys(layers(dxf))).toContain('walls.inner')
        })

        // The whole point: a colour set on the LAYER reaches the file. Reading it off the
        // shape (which is what used to happen) finds only SHAPE_DEFAULT_STYLE's red.
        it('gives a layer the colour and linetype set on it', () =>
        {
            modeler.layer('diagram').color('blue').dashed()
            modeler.rect(100, 50)

            const dxf = modeler.toDXF() as string
            expect(layers(dxf).diagram).toEqual({ rgb: rgb(0x0000ff), linetype: 'DASHED' })
            // The shape agrees with its layer, so it is drawn ByLayer — no override at all.
            expect(drawn(dxf)[0]).toEqual({ layer: 'diagram', rgb: undefined, linetype: undefined })
        })

        it('cascades a layer colour through a nested layer', () =>
        {
            modeler.layer('frame').color('green')
            modeler.group('braces', modeler.rect(10, 10))

            const dxf = modeler.toDXF() as string
            expect(layers(dxf)['frame.braces'].rgb).toBe(rgb(0x008000))
        })

        it('overrides the layer on a shape that styles itself', () =>
        {
            modeler.layer('main').color('green')
            modeler.rect(100, 50)                      // ByLayer green
            ;(modeler.circle(10, [200, 0, 0]) as any).color('grey').dashed()

            const dxf = modeler.toDXF() as string
            expect(layers(dxf).main.rgb).toBe(rgb(0x008000))

            const circle = drawn(dxf).find(e => e.rgb !== undefined)
            expect(circle).toEqual({ layer: 'main', rgb: rgb(0x808080), linetype: 'DASHED' })
            // The rect still says nothing: it is its layer's colour.
            expect(drawn(dxf).filter(e => e.rgb === undefined).length).toBe(1)
        })

        // An unstyled shape must not be flooded with SHAPE_DEFAULT_STYLE's red: CAD's own
        // default (index 7, no true colour) is what an author who set no colour means.
        it('writes no colour for a shape nobody styled', () =>
        {
            modeler.rect(100, 50)
            const dxf = modeler.toDXF() as string
            expect(layers(dxf)['0'].rgb).toBeUndefined()
            expect(drawn(dxf)[0].rgb).toBeUndefined()
        })

        // A Shape has no visible() method — only hide()/show() setting style.visible — so the
        // old filter never excluded anything and `all` did nothing.
        it('skips hidden shapes unless asked for all of them', () =>
        {
            modeler.rect(100, 50)
            const template = modeler.rect(10, 10) as any
            template.hide()

            expect(drawn(modeler.toDXF() as string).length).toBe(1)
            expect(drawn(modeler.toDXF({ all: true }) as string).length).toBe(2)
        })

        it('skips everything on a hidden layer', () =>
        {
            modeler.rect(100, 50)
            modeler.layer('hidden').hide()
            modeler.rect(10, 10)

            expect(drawn(modeler.toDXF() as string).length).toBe(1)
        })
    })

    /**
     * A DXF is a drawing on XY, but models are not: a wall elevation is built on XZ, a
     * section on YZ. The exporter finds the plane the 2D geometry lies on and writes the
     * drawing in that plane's frame — nothing in the scene moves. See the EXPORT PLANE
     * section of src/modeler/DXFExporter.ts.
     */
    describe('drawing plane detection', () =>
    {
        /** The DXF with handles (5 / 330) dropped, so two drawings of the same geometry
         *  compare equal regardless of how many entities were written before them. */
        const skeleton = (dxf: string): string =>
        {
            const lines = dxf.split('\n')
            const out: string[] = []
            for (let i = 0; i + 1 < lines.length; i += 2)
            {
                const code = Number(lines[i])
                if (code !== 5 && code !== 330) out.push(`${code}:${lines[i + 1]}`)
            }
            return out.join('|')
        }

        /** One of each entity the exporter can write: bulged polyline, circle, arc,
         *  ellipse, line and spline. Every one of them has to survive the mapping. */
        const drawEverything = (place: (shape: any) => void): void =>
        {
            const rect = modeler.rect(100, 50) as any
            rect.fillet(10)                                    // LWPOLYLINE + bulges
            place(rect)
            place(modeler.circle(20, [200, 0, 0]))             // CIRCLE
            place(modeler.arc([300, 0, 0], [320, 20, 0], [340, 0, 0])) // ARC
            const ellipse = modeler.circle(50, [-200, 0, 0]) as any
            ellipse.scale([2, 1, 1])                           // ELLIPSE
            place(ellipse)
            place(modeler.line([0, 100, 0], [100, 100, 0]))    // LINE
            place(modeler.spline([0, -100, 0], [50, -50, 0], [100, -150, 0], [150, -100, 0])) // SPLINE
        }

        const drawingOf = (place: (shape: any) => void): string =>
        {
            modeler.reset()
            annotator.reset()
            drawEverything(place)
            return skeleton(modeler.toDXF() as string)
        }

        it('exports geometry modelled on the XZ plane', () =>
        {
            // A 100 x 50 rect stood up on XZ: x runs -50..50, z runs -25..25.
            ;(modeler.rect(100, 50) as any).rotateX(90)

            const dxf = modeler.toDXF() as string
            expect(dxf).not.toBeNull()
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(1)
            // Model x stays x and model z (height) becomes y, so the elevation is upright.
            expect(dxf).toMatch(/\n10\n-50\n20\n-25\n/)
            expect(dxf).toMatch(/\n10\n50\n20\n25\n/)
        })

        // The sharpest statement of what "rotate into the drawing plane" has to mean: the
        // same shapes, stood up on XZ, must produce the same drawing they do lying on XY —
        // arc directions and polyline bulge signs included, which flip if the plane is read
        // from the wrong side.
        it('draws an XZ model exactly as it draws the same model on XY', () =>
        {
            // explicit pivot: the whole scene must turn as one rigid body, where the default
            // pivot is each shape's own centre (which would turn each where it stands)
            expect(drawingOf(shape => shape.rotateX(90, [0, 0, 0]))).toBe(drawingOf(() => {}))
        })

        it('draws a YZ model exactly as it draws the same model on XY', () =>
        {
            // 120 degrees about [1,1,1] cycles x -> y -> z -> x, landing XY on YZ.
            expect(drawingOf(shape => shape.rotateAround(120, [1, 1, 1], [0, 0, 0]))).toBe(drawingOf(() => {}))
        })

        it('leaves the scene untouched', () =>
        {
            const rect = (modeler.rect(100, 50) as any).rotateX(90)
            const before = [rect.bbox().min().toArray(), rect.bbox().max().toArray()]

            expect(modeler.toDXF()).not.toBeNull()

            expect([rect.bbox().min().toArray(), rect.bbox().max().toArray()]).toEqual(before)
        })

        it('draws a plane that is offset from the origin at the origin', () =>
        {
            ;(modeler.rect(100, 50) as any).rotateX(90).moveY(500)
            const offset = modeler.toDXF() as string

            modeler.reset()
            ;(modeler.rect(100, 50) as any).rotateX(90)
            expect(skeleton(offset)).toBe(skeleton(modeler.toDXF() as string))
        })

        it('ignores 3D shapes when detecting the plane', () =>
        {
            modeler.box(50, 50, 50)
            ;(modeler.rect(100, 50) as any).rotateX(90)

            const dxf = modeler.toDXF() as string
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(1)
            expect(dxf).toMatch(/\n10\n-50\n20\n-25\n/)
        })

        // A drawing is one plane. Shapes on a *parallel* plane are a second drawing, and
        // stacking them would silently overlay two floors on top of each other.
        it('picks the plane most of the geometry is on', () =>
        {
            modeler.rect(100, 50)
            modeler.rect(20, 20)
            ;(modeler.rect(10, 10) as any).moveZ(500)   // a storey up — not this drawing

            expect(countEntity(modeler.toDXF() as string, 'LWPOLYLINE')).toBe(2)
        })

        it('draws a plane at neither of the coordinate planes true-size', () =>
        {
            ;(modeler.rect(100, 50) as any).rotateX(45)

            const dxf = modeler.toDXF() as string
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(1)
            // Seen normal to its own plane, the rect is its full 100 x 50 — not the
            // foreshortened 100 x 35.4 a plan view would show.
            expect(dxf).toMatch(/\n10\n-50\n20\n-25\n/)
            expect(dxf).toMatch(/\n10\n50\n20\n25\n/)
        })

        it('takes dimension lines to the drawing plane with their shapes', () =>
        {
            const line = modeler.line([0, 0, 0], [120, 0, 0]) as any
            line.dim()
            line.rotateX(90)

            const dxf = modeler.toDXF() as string
            expect(countEntity(dxf, 'DIMENSION')).toBe(1)
            expect(dxf).toContain('AcDbAlignedDimension')
            expect(dxf).toMatch(/120/)
        })

        // The line has to turn into the drawing AND stand off inside it: an offset computed
        // against the plan normal points out of an elevation, so the dimension used to be
        // written straight on top of the geometry it measures.
        it('stands a dimension off the elevation it measures', () =>
        {
            modeler.line([0, 0, 0], [4000, 0, 0]).dim()   // on XZ, at z = 0
            modeler.line([0, 0, 0], [0, 0, 2500])

            const dxf = modeler.toDXF() as string
            const dim = dxf.slice(dxf.indexOf('\nDIMENSION\n'))
            // Groups 10/20 are the dimension line's own point. The wall's bottom edge is at
            // y = 0 in the drawing, so a dimension standing off it cannot be there too.
            const y = Number(dim.match(/\n20\n([-\d.]+)\n/)?.[1])
            expect(dxf).toContain('AcDbAlignedDimension')
            expect(Math.abs(y)).toBeGreaterThan(0)
        })

        it('honours an explicit plane instead of detecting one', () =>
        {
            ;(modeler.rect(100, 50) as any).rotateX(90)   // on XZ
            expect(modeler.toDXF({ plane: 'xz' })).not.toBeNull()
            // Asked for a plan of a model that has no plan, the answer is nothing — not a
            // silently foreshortened elevation.
            expect(modeler.toDXF({ plane: 'xy' })).toBeNull()
        })
    })

    /**
     * Guard rails for exact-curve export. The exporter dispatches on `subtype()`, which
     * answers a coarser question than the exporter is asking — see each case below.
     * Flip `it.fails` to `it` in the stage that fixes it.
     */
    describe('exact curve geometry (pinned defects)', () =>
    {
        /**
         * Group code/value pairs of every entity of the given type.
         *
         * Deliberately not a regex over lines: a DXF group *value* can be "0" (the x and y
         * of an extrusion vector, for one), so scanning for `^0\n` splits entities apart
         * mid-body. Likewise a coordinate of 42 would read as a bulge. DXF is strictly
         * alternating code/value lines, so pair them up first and only then look for
         * entity boundaries.
         */
        const entities = (dxf: string, type: string): Array<Array<[number, string]>> =>
        {
            const lines = dxf.split('\n')
            const out: Array<Array<[number, string]>> = []
            let cur: Array<[number, string]> | null = null
            for (let i = 0; i + 1 < lines.length; i += 2)
            {
                const code = Number(lines[i])
                const value = lines[i + 1]
                if (code === 0)
                {
                    if (cur) { out.push(cur); cur = null }
                    if (value === type) cur = []
                    continue
                }
                cur?.push([code, value])
            }
            if (cur) out.push(cur)
            return out
        }

        /** All values for one group code within an entity body. */
        const group = (body: Array<[number, string]>, code: number): number[] =>
            body.filter(([c]) => c === code).map(([, v]) => Number(v))

        /** Non-zero group-42 (bulge) values across every LWPOLYLINE. */
        const bulges = (dxf: string): number[] =>
            entities(dxf, 'LWPOLYLINE').flatMap(b => group(b, 42)).filter(b => b !== 0)

        // A filleted rect is 4 lines + 4 arcs. `subtype()` has no name for that, so it
        // falls through to "Spline" — the same string a real NURBS gets. The exporter
        // takes it at its word and asks for spline data, but the kernel has none to give:
        // controlPoints() returns span endpoints (i.e. the arcs as chords), knots() is
        // empty and the TS wrapper substitutes [0,1]. What lands in the file is a SPLINE
        // claiming 2 knots for N control points at degree 2 — a clamped B-spline needs
        // N+3 — built from chords. The corners are gone and the entity is malformed.
        //
        // The right entity is a LWPOLYLINE with bulges, which stores line and arc runs
        // exactly and is what every CAD tool writes for this shape.
        it('writes a filleted rect as a LWPOLYLINE with bulges, not a SPLINE', () =>
        {
            const r = modeler.rect(100, 50) as any
            r.fillet(10)

            const dxf = modeler.toDXF() as string
            expect(countEntity(dxf, 'SPLINE')).toBe(0)
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(1)
            // tan(90°/4) for each quarter-circle corner.
            const bs = bulges(dxf)
            expect(bs.length).toBe(4)
            // 6 decimals is the writer's own precision (fmt rounds there).
            bs.forEach(b => expect(Math.abs(b)).toBeCloseTo(Math.SQRT2 - 1, 6))
        })

        // Whatever else it emits, a SPLINE must at least be structurally valid: for a
        // clamped B-spline, knots (72) == control points (73) + degree (71) + 1.
        // A filleted rect used to yield 71=2, 72=2, 73=8 — 2 knots where 11 are needed —
        // and now writes no SPLINE at all, so a real spline is what exercises this.
        it('emits only structurally valid SPLINE entities', () =>
        {
            modeler.spline([0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0])
            const r = modeler.rect(100, 50) as any
            r.fillet(10)
            const dxf = modeler.toDXF() as string

            const splines = entities(dxf, 'SPLINE')
            expect(splines.length).toBeGreaterThan(0) // else this rail proves nothing
            for (const body of splines)
            {
                const [degree] = group(body, 71)
                const [knotCount] = group(body, 72)
                const [ctrlCount] = group(body, 73)
                expect(knotCount).toBe(ctrlCount + degree + 1)
                expect(group(body, 40).length).toBe(knotCount) // declared count matches reality
            }
        })

        // DXF has a native ELLIPSE entity (centre, major-axis vector, minor/major ratio,
        // start/end parameter). The exporter has no 'Ellipse' case, so the four conic
        // spans each fall to the tessellating default: one chorded LWPOLYLINE per span,
        // four disjoint polylines where the file should hold a single exact ellipse.
        //
        // There is no modeler.ellipse(); a non-uniform scale of a circle is the supported
        // route and yields exact rational conics (see meshup exactness.test.ts).
        it('writes an ellipse as an ELLIPSE entity', () =>
        {
            const e = modeler.circle(50) as any
            e.scale([2, 1, 1])                       // radii 100 x 50
            expect(e.subtype()).toBe('Ellipse')      // guard the premise

            const dxf = modeler.toDXF() as string
            expect(countEntity(dxf, 'ELLIPSE')).toBe(1)
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(0)

            const [body] = entities(dxf, 'ELLIPSE')
            expect(group(body, 11)[0]).toBeCloseTo(100, 9) // major-axis endpoint, x
            expect(group(body, 40)[0]).toBeCloseTo(0.5, 9) // minor/major ratio
        })

        // `subtype()` calls any closed arcs-only contour "Circle", and the exporter then
        // took the radius from the bbox width. A lens (two arcs about different centres)
        // satisfies that test but is not a circle, and was written as one.
        //
        // Driven through writeCurveToDXF directly: intersection() is non-replacing, so the
        // scene holds the two source circles alongside the lens and modeler.toDXF() would
        // export all three - proving nothing about the lens on its own.
        it('does not write a two-arc lens as a CIRCLE', () =>
        {
            const lens = (modeler.circle(50) as any)
                .intersection(modeler.circle(50, [60, 0, 0]) as any)
            expect(lens.subtype()).toBe('Circle')            // guard the premise
            // Four arc spans, alternating between the two source centres — which is
            // precisely why they cannot be one circle.
            const centres = lens.exportSpans().map((s: any) => s.center[0])
            expect(new Set(centres).size).toBe(2)

            const doc = new DXFDocument('mm')
            writeCurveToDXF(doc, lens, '0')
            const dxf = doc.stringify()
            expect(countEntity(dxf, 'CIRCLE')).toBe(0)
            // A bulged polyline holds every arc exactly.
            expect(countEntity(dxf, 'LWPOLYLINE')).toBe(1)
            expect(bulges(dxf).length).toBe(lens.segmentCount())
        })

        it('still writes a real circle as CIRCLE when driven the same way', () =>
        {
            const doc = new DXFDocument('mm')
            writeCurveToDXF(doc, modeler.circle(50) as any, '0')
            const dxf = doc.stringify()
            expect(countEntity(dxf, 'CIRCLE')).toBe(1)
            const [body] = entities(dxf, 'CIRCLE')
            expect(group(body, 40)[0]).toBeCloseTo(50, 6) // exact radius, not from a bbox
        })
    })
})
