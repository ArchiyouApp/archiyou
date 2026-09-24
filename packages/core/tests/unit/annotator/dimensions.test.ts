import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { DimensionLine } from '../../../src/annotator/AnnotatorDimensionLine'
import type { ArchiyouModules } from '../../../src/types'
import type { DimensionLineData } from '../../../src/annotator/types'

/**
 * Dimension lines: SmartShape.dim() → centralized Annotator.DimensionLine.fromShape().
 * Regression cover for "init(): argument 2 is invalid — received undefined"
 * (calling .dim() with no options).
 */
describe('Dimensions', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()

        annotator = new Annotator()
        // Minimal module wiring — the .dim() path only touches modeler + annotator
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    it('line(...).dim() with NO options works (regression: undefined options)', () =>
    {
        const line = modeler.line([0, 0], [100, 0])

        expect(() => line.dim()).not.toThrow()

        const anns = annotator.getAnnotations()
        expect(anns.length).toBe(1)
        expect(anns[0]).toBeInstanceOf(DimensionLine)
    })

    it('produces correct value, units and point data', () =>
    {
        modeler.line([0, 0], [100, 0]).dim()

        const data = annotator.getAnnotationsData() as DimensionLineData[]
        expect(data.length).toBe(1)

        const d = data[0]
        expect(d.value).toBeCloseTo(100)
        expect(d.units).toBe('mm') // defaulted from the model
        expect(d.start).toHaveLength(3)
        expect(d.end).toHaveLength(3)
        expect(Array.isArray(d.targetStart)).toBe(true)
    })

    it('keeps a diagonal dimension line parallel to the source line', () =>
    {
        modeler.line([0, 0, 0], [100, 100, 0]).dim()

        const data = annotator.getAnnotationsData() as DimensionLineData[]
        expect(data.length).toBe(1)

        const d = data[0]
        const targetDir = [
            d.targetEnd[0] - d.targetStart[0],
            d.targetEnd[1] - d.targetStart[1],
            d.targetEnd[2] - d.targetStart[2],
        ]
        const dimDir = [
            d.end[0] - d.start[0],
            d.end[1] - d.start[1],
            d.end[2] - d.start[2],
        ]
        const offsetStart = [
            d.start[0] - d.targetStart[0],
            d.start[1] - d.targetStart[1],
            d.start[2] - d.targetStart[2],
        ]
        const offsetEnd = [
            d.end[0] - d.targetEnd[0],
            d.end[1] - d.targetEnd[1],
            d.end[2] - d.targetEnd[2],
        ]

        expect(dimDir[0]).toBeCloseTo(targetDir[0], 6)
        expect(dimDir[1]).toBeCloseTo(targetDir[1], 6)
        expect(dimDir[2]).toBeCloseTo(targetDir[2], 6)

        expect(offsetStart[0]).toBeCloseTo(offsetEnd[0], 6)
        expect(offsetStart[1]).toBeCloseTo(offsetEnd[1], 6)
        expect(offsetStart[2]).toBeCloseTo(offsetEnd[2], 6)

        const dot = targetDir[0] * offsetStart[0]
            + targetDir[1] * offsetStart[1]
            + targetDir[2] * offsetStart[2]
        expect(dot).toBeCloseTo(0, 6)
    })

    it('computes a diagonal planar offset vector before export', () =>
    {
        const dl = modeler.line([0, 0, 0], [100, 100, 0]).dim() as DimensionLine

        expect(dl.targetDir().toArray()).toEqual([100, 100, 0])

        const offsetComponents = (dl as unknown as {
            _resolveOffsetComponents(): [number, number, number]
        })._resolveOffsetComponents()

        expect(offsetComponents[0]).toBeCloseTo(Math.SQRT1_2, 6)
        expect(offsetComponents[1]).toBeCloseTo(-Math.SQRT1_2, 6)
        expect(offsetComponents[2]).toBeCloseTo(0, 6)
    })

    it('accepts an explicit options object', () =>
    {
        const dl = modeler.line([0, 0], [50, 0]).dim({ units: 'cm', roundDecimals: 1 }) as DimensionLine

        expect(dl).toBeInstanceOf(DimensionLine)
        expect((dl.toData() as DimensionLineData).units).toBe('cm')
        expect(annotator.getAnnotations().length).toBe(1)
    })

    it('returns the same DimensionLine instance for a single Edge/Curve', () =>
    {
        const dl = modeler.line([0, 0], [10, 0]).dim()
        expect(dl).toBe(annotator.getAnnotations()[0])
    })

    it('a mesh body (box) dimensions its bounding box (no empty placeholder)', () =>
    {
        const result = modeler.box(20, 30, 40).dim()

        const anns = annotator.getAnnotations()
        // width/depth/height → 3 lines, and never the empty placeholder
        expect(anns.length).toBe(3)
        expect(Array.isArray(result)).toBe(true)
        expect((result as DimensionLine[]).length).toBe(3)

        const values = (annotator.getAnnotationsData() as DimensionLineData[])
            .map(d => Math.round(Number(d.value)))
            .sort((a, b) => a - b)
        expect(values).toEqual([20, 30, 40])
    })

    it('multiple .dim() calls accumulate on the annotator', () =>
    {
        modeler.line([0, 0], [10, 0]).dim()
        modeler.line([0, 0], [0, 20]).dim()
        expect(annotator.getAnnotations().length).toBe(2)
    })

    it('annotator.reset() clears annotations', () =>
    {
        modeler.line([0, 0], [10, 0]).dim()
        expect(annotator.getAnnotations().length).toBe(1)
        annotator.reset()
        expect(annotator.getAnnotations().length).toBe(0)
    })

    it('bbox().back().dim() on a collection creates a dimension (regression: silent no-op)', () =>
    {
        /*  Regression: Bbox.getSide()/planes() handed back Shapes with no `_modeler`, so
            `.dim()` could not reach the Annotator and returned undefined without a word —
            every `elevation().bbox().back().dim()` in a doc pipeline silently vanished. */
        const col = modeler.collection(
            modeler.rect(400, 200).moveTo(200, 100, 0),
            modeler.rect(100, 100).moveTo(600, 50, 0),
        ) as any

        const side = col.bbox().back()
        expect((side as any)._modeler).toBeTruthy()

        const dim = side.dim()
        expect(dim).toBeInstanceOf(DimensionLine)
        expect(annotator.getAnnotations().length).toBe(1)
        expect((annotator.getAnnotationsData()[0] as DimensionLineData).value).toBeCloseTo(650) // bbox width
    })

    it('dim() on a shape with no modeler warns instead of silently doing nothing', () =>
    {
        const orphan = modeler.rect(100, 100) as any
        orphan._modeler = null // as if built outside the modeler

        const warnings: Array<string> = []
        const orig = console.warn
        console.warn = (...args: Array<any>) => { warnings.push(args.join(' ')) }
        try { expect(orphan.dim()).toBe(null) }
        finally { console.warn = orig }

        expect(annotator.getAnnotations().length).toBe(0)
        expect(warnings.join(' ')).toContain('no Annotator reachable')
    })

    describe('param() remapping', () =>
    {
        /*  A dimension is measured in model units, the parameter it writes back to need not
            be: a model in mm dimensioning a param in cm needs (v) => v/10 in between. The
            function is serialized here and re-created in the viewer's main thread, so what
            toData() carries is its SOURCE. */

        it('param(name) without a remap carries no source', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim().param('DEPTH')

            const data = dim.toData() as DimensionLineData
            expect(data.param).toBe('DEPTH')
            expect(data.interactive).toBe(true)
            expect(data.paramRemapSrc).toBe(null)
        })

        it('param(name, fn) serializes the remap function to source', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim().param('DEPTH', (v: number) => v / 10)

            const data = dim.toData() as DimensionLineData
            expect(data.param).toBe('DEPTH')
            expect(data.paramRemapSrc).toContain('=>')

            // What the viewer does with it: rebuild from source, in an empty scope
            const fn = (new Function(`return (${data.paramRemapSrc})`))() as (v: number) => number
            expect(fn(800)).toBe(80)
        })

        it('bindParam(name, fn) is the same call', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim().bindParam('DEPTH', (v: number) => v / 10)

            expect((dim.toData() as DimensionLineData).paramRemapSrc).toContain('/ 10')
        })

        it('the remap gets the current param value as second argument', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim().param('DEPTH', (v: number, current: number) => v / 10 + current)

            const fn = (new Function(`return (${(dim.toData() as DimensionLineData).paramRemapSrc})`))() as
                            (v: number, c: number) => number
            expect(fn(800, 5)).toBe(85)
        })

        it('rejects a remap that closes over the script scope', () =>
        {
            /*  The viewer rebuilds the function without the script around it, so a closure
                variable is a ReferenceError there - on an edit, long after this call. Bind
                time is where the author can still see it. */
            const scriptVariable = 10
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim()

            expect(() => dim.param('DEPTH', (v: number) => v / scriptVariable))
                .toThrow(/uses "scriptVariable".*Pass it along: \.param\('DEPTH', remap, \{ scriptVariable \}\)/)
        })

        it('finds a script variable in a branch the probe run would not take', () =>
        {
            const hidden = 10
            const dim = (modeler.line([0, 0], [800, 0]) as any).dim()
            expect(() => dim.param('DEPTH', (v: number) => (v > 1e9) ? v / hidden : v / 10))
                .toThrow(/uses "hidden"/)
        })

        it('takes the values it uses as a third argument, and carries them to the viewer', () =>
        {
            const SCALE = 10
            const dim = (modeler.line([0, 0], [800, 0]) as any).dim().param('DEPTH', (v: number) => v / SCALE, { SCALE })

            const data = dim.toData() as DimensionLineData
            expect(data.paramRemapVars).toEqual({ SCALE: 10 })
            const fn = new Function('SCALE', `return (${data.paramRemapSrc})`)(data.paramRemapVars!.SCALE) as (v: number) => number
            expect(fn(800)).toBe(80)
        })

        it('rejects a passed value that is not plain data', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim()
            expect(() => dim.param('DEPTH', (v: number) => v / line.length(), { line }))
                .toThrow(/"line" must hold plain data/)
        })

        it('rejects a remap that is not a function', () =>
        {
            const line = modeler.line([0, 0], [800, 0]) as any
            const dim = line.dim()

            expect(() => dim.param('DEPTH', 10 as any)).toThrow(/must be a function/)
        })
    })

    it('toSVG() writes real coordinates and scales with the drawing (regression: x1="undefined")', () =>
    {
        /*  Regression: the SVG writers took PointLike arrays from toSVG() and read `.x` off
            them. @validate only validates — unlike the old @checkInput it does not convert —
            so every dimension line came out as x1="undefined", i.e. present in the SVG but
            impossible to draw. Line weight/text/arrows also scale with the drawing now:
            fixed 0.5/1 model units are invisible on a metre-sized elevation. */
        const line = modeler.line([0, 0], [1000, 0]) as any
        line.dim()

        const dim = annotator.getAnnotations()[0] as any
        const svg = dim.toSVG({ drawingSize: 1000 })

        expect(svg).not.toContain('undefined')
        expect(svg).toContain('class="dimensionline"')
        const coords = [...svg.matchAll(/x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)]
        expect(coords.length).toBe(1)
        coords[0].slice(1).forEach((c: string) => expect(Number.isFinite(Number(c))).toBe(true))

        expect(svg).toContain('stroke:black')                 // arrows have no other styling
        expect(svg).toContain(`font-size="${1000 / 80}"`)     // 2.5mm-on-paper text
        expect(svg).toContain(`stroke-width:${1000 / 800}`)   // 0.25mm-on-paper lines

        // Without a drawing size the old fixed sizes are kept (callers that do not pass one)
        expect(dim.toSVG()).toContain('font-size="1"')
    })

    /**
     * A dimension stands off perpendicular to itself, and "perpendicular" only means something
     * once you say in which plane. This used to answer XY for every dimension in every model.
     * See _planeNormal() in src/annotator/AnnotatorDimensionLine.ts.
     */
    describe('offsets inside the drawing plane', () =>
    {
        /** A wall elevation on XZ: 4m along the ground, 2.5m up. */
        const elevation = () =>
        {
            const bottom = modeler.line([0, 0, 0], [4000, 0, 0])
            modeler.line([0, 0, 0], [0, 0, 2500])
            return bottom as any
        }

        it('offsets a dimension on an XZ elevation inside XZ, not out of the drawing', () =>
        {
            const dl = elevation().dim() as DimensionLine
            const [x, y, z] = (dl as any)._resolveOffsetComponents()

            // Perpendicular to a horizontal line, in the plane of the wall: straight down or up.
            expect(Math.abs(z)).toBeCloseTo(1, 6)
            expect(x).toBeCloseTo(0, 6)
            expect(y).toBeCloseTo(0, 6)   // y is OUT of an XZ drawing — the old answer
        })

        it('steps the dimension line off the geometry it measures', () =>
        {
            const dl = elevation().dim() as DimensionLine
            const start = (dl as any)._calculatePoint('start')

            // The wall's bottom edge is at z = 0; the dimension may not sit on top of it.
            expect(Math.abs(start.z)).toBeGreaterThan(0)
            expect(start.y).toBeCloseTo(0, 6)
        })

        it('still offsets a plan dimension inside XY', () =>
        {
            modeler.rect(400, 200)
            const dl = (modeler.line([-200, -100, 0], [200, -100, 0]) as any).dim() as DimensionLine
            const [x, y, z] = (dl as any)._resolveOffsetComponents()

            expect(Math.abs(y)).toBeCloseTo(1, 6)
            expect(x).toBeCloseTo(0, 6)
            expect(z).toBeCloseTo(0, 6)
        })

        it('lets an explicit offset vector win over the plane', () =>
        {
            const dl = elevation().dim({ offsetVec: [0, 1, 0] }) as DimensionLine
            expect((dl as any)._resolveOffsetComponents()).toEqual([0, 1, 0])
        })

        // The line has to turn into the drawing AND step off inside it: the projection and the
        // offset have to agree about which plane that is, or it turns in and then steps out.
        it('draws the dimension beside the elevation, not on it', () =>
        {
            elevation().dim()

            const svg = (modeler.all() as any).toSVG() as string
            const dimLine = svg.match(/<line class="annotation line"[^>]*>/)?.[0] ?? ''
            const y1 = Number(dimLine.match(/y1="([-\d.]+)"/)?.[1])

            expect(dimLine).toMatch(/x1="0"/)
            expect(dimLine).toMatch(/x2="4000"/)
            expect(Math.abs(y1)).toBeGreaterThan(0)   // 0 is the bottom edge itself
        })
    })

})
