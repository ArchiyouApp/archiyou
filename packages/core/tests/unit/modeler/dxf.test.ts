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

    it('returns null when there is no 2D-on-XY geometry', () =>
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
        // Driven through writeCurveToDXF directly: a Modeler boolean returns the lens
        // without putting it in the scene, so modeler.toDXF() would export the two source
        // circles and prove nothing about the lens.
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
