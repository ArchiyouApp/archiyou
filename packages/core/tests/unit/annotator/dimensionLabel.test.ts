/** How a dimension's value is written on the drawing.
 *
 *  Three drafting conventions, none of which the SVG used to follow: a metric drawing writes
 *  bare numbers (the unit is stated once, in the title block), the value reads ALONG the line
 *  it measures, and it sits on a backing box so it stays legible where something runs under
 *  it.
 */
import { describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

async function setup(unitSystem?:'metric'|'imperial')
{
    const modeler = new Modeler()
    await modeler.load()
    if(unitSystem){ modeler.unitSystem(unitSystem) }
    const annotator = new Annotator()
    const modules = { modeler, annotator } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    annotator.setArchiyou(modules)
    return { modeler, annotator }
}

/** The dimension labels in a drawing: their text, rotation and whether they are backed. */
function labelsOf(svg:string)
{
    return {
        texts: [...svg.matchAll(/class="annotation text"[\s\S]*?>([^<]*)</g)].map(m => m[1].trim()),
        rotations: [...svg.matchAll(/class="annotation dimension-label" transform="rotate\(([-\d.]+)/g)]
                        .map(m => Number(m[1])),
        backgrounds: (svg.match(/class="annotation text-background"/g) ?? []).length,
    }
}

/** A 400x500 rect with a dimension on its top edge and one on its left. */
function dimensioned(modeler:Modeler, options?:any)
{
    const r = modeler.rect(400, 500) as any
    r.bbox().back().dim(options)
    r.bbox().left().dim(options)
    return new (modeler.classes.ShapeCollection as any)(r)
}

describe('dimension value text', () =>
{
    it('writes bare numbers by default — the unit belongs in the title block', async () =>
    {
        const { modeler } = await setup('metric')
        const svg = dimensioned(modeler).toSVG()

        expect(labelsOf(svg).texts).toEqual(['400', '500'])
    })

    it('puts the unit back when asked, per dimension', async () =>
    {
        const { modeler } = await setup('metric')

        const r = modeler.rect(400, 500) as any
        r.bbox().back().dim({ showUnits: true })
        r.bbox().left().dim()
        const svg = new (modeler.classes.ShapeCollection as any)(r).toSVG()

        expect(labelsOf(svg).texts).toEqual(['400 mm', '500'])
    })

    it("keeps imperial marks whatever showUnits says — 6'-3\" is notation, not a suffix", async () =>
    {
        const { modeler } = await setup('imperial')
        const svg = dimensioned(modeler).toSVG()

        for(const text of labelsOf(svg).texts)
        {
            expect(text).toMatch(/["']/)
        }
    })
})

describe('dimension label placement', () =>
{
    it('reads along the line it measures', async () =>
    {
        const { modeler } = await setup('metric')
        const svg = dimensioned(modeler).toSVG()

        const { rotations } = labelsOf(svg)
        expect(rotations.length).toBe(2)
        expect(rotations).toContain(0)     // the horizontal dimension
        expect(rotations).toContain(-90)   // the vertical one
    })

    it('never reads upside down, and a vertical dimension reads bottom-to-top', async () =>
    {
        const { modeler, annotator } = await setup('metric')

        // a dimension in every direction, including the ones whose edge runs backwards
        const dims = [
            [[0,0,0],[100,0,0]], [[100,0,0],[0,0,0]],       // horizontal, both ways
            [[0,0,0],[0,100,0]], [[0,100,0],[0,0,0]],       // vertical, both ways
            [[0,0,0],[100,100,0]], [[100,100,0],[0,0,0]],   // diagonal, both ways
        ]
        for(const [start, end] of dims)
        {
            annotator.dimensionLine().init(start as any, end as any)
        }

        for(const a of annotator.getAnnotations())
        {
            const angle = (a as any)._labelAngle()
            expect(angle).toBeGreaterThanOrEqual(-90)
            expect(angle).toBeLessThan(90)
        }

        // a vertical dimension is -90 (bottom-to-top), never +90 (top-to-bottom)
        const vertical = annotator.getAnnotations().slice(2, 4).map((a:any) => a._labelAngle())
        expect(vertical).toEqual([-90, -90])
    })

    it('backs the value with a box so it survives what runs under it', async () =>
    {
        const { modeler } = await setup('metric')
        const svg = dimensioned(modeler).toSVG()

        const { backgrounds, texts } = labelsOf(svg)
        expect(backgrounds).toBe(texts.length)
        expect(svg).toMatch(/class="annotation text-background"[^>]*style="fill:white/)
    })

    it('can be turned off from a script', async () =>
    {
        const { modeler, annotator } = await setup('metric')
        annotator.DIMENSION_TEXT_BACKGROUND_COLOR = null

        const svg = dimensioned(modeler).toSVG()
        expect(labelsOf(svg).backgrounds).toBe(0)
    })

    it('scales its box with the text, so a bigger value is still covered', async () =>
    {
        /*  The millimeter settings only apply where a scale is KNOWN — a document view passes
            its unitsPerMm. A standalone toSVG() has no page, and falls back to sizes relative
            to the drawing itself. */
        const { modeler, annotator } = await setup('metric')
        const r = modeler.rect(400, 500) as any
        const dim = r.bbox().back().dim()

        const boxOf = (svg:string) =>
        {
            const m = svg.match(/class="annotation text-background" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!
            return { w: Number(m[3]), h: Number(m[4]) }
        }

        annotator.DIMENSION_TEXT_SIZE_MM = 4
        const normal = boxOf(dim.toSVG({ unitsPerMm: 10 }))

        annotator.DIMENSION_TEXT_SIZE_MM = 8
        const big = boxOf(dim.toSVG({ unitsPerMm: 10 }))

        expect(big.h).toBeCloseTo(normal.h * 2, 4)
        expect(big.w).toBeCloseTo(normal.w * 2, 4)
    })
})

describe('a dimension too short for its own value', () =>
{
    /** One dimension line from `start` to `end`, drawn at a known page scale. */
    async function dimSVG(start:Array<number>, end:Array<number>, unitsPerMm = 1, textMm?:number)
    {
        const { annotator } = await setup('metric')
        if(textMm !== undefined){ annotator.DIMENSION_TEXT_SIZE_MM = textMm }

        const dim:any = annotator.dimensionLine().init(start as any, end as any, { offset: 20 } as any)
        const svg = dim.toSVG({ unitsPerMm })

        const label = svg.match(/class="annotation dimension-label" transform="rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)/)!
        const line = svg.match(/class="annotation line" style="[^"]*" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/)!
        const fontSize = Number(svg.match(/font-size="([\d.]+)"/)![1])

        const mid = { x: (Number(line[1]) + Number(line[3]))/2, y: (Number(line[2]) + Number(line[4]))/2 }
        const at = { x: Number(label[1]), y: Number(label[2]) }

        return {
            svg,
            hasLeader: /class="annotation line leader"/.test(svg),
            fontSize,
            mid,
            at,
            /** how far the value sits from the middle of the line it measures */
            offset: Math.hypot(at.x - mid.x, at.y - mid.y),
        }
    }

    it('keeps the value on a line long enough to hold it', async () =>
    {
        const long = await dimSVG([0,0,0], [400,0,0], 1, 2)

        expect(long.hasLeader).toBe(false)
        expect(long.offset).toBeCloseTo(0, 4)   // written at the middle, as always
    })

    it('steps the value aside onto a leader when the line is shorter than 2 text heights', async () =>
    {
        // 2mm text at 2 units/mm is 4 units tall, so anything under 8 units is too short
        const small = await dimSVG([0,0,0], [5,0,0], 2, 2)

        expect(small.fontSize).toBeCloseTo(4, 4)
        expect(small.hasLeader).toBe(true)
        expect(small.offset).toBeCloseTo(small.fontSize * 1.5, 3)
    })

    it('runs the leader perpendicular to the dimension, away from what it measures', async () =>
    {
        const small = await dimSVG([0,0,0], [5,0,0], 2, 2)

        // the dimension is horizontal, so its leader is vertical
        expect(small.at.x).toBeCloseTo(small.mid.x, 4)
        expect(Math.abs(small.at.y - small.mid.y)).toBeCloseTo(small.offset, 4)

        /*  …and it continues OUTWARD. The measured edge lies on y=0 here, and the dimension
            line was offset off it; the value has to end up further from the edge than the
            line is, whichever side the offset happened to pick. */
        expect(Math.abs(small.at.y)).toBeGreaterThan(Math.abs(small.mid.y))
    })

    it('draws the leader from the line to the value, and nowhere else', async () =>
    {
        const small = await dimSVG([0,0,0], [5,0,0], 2, 2)

        const leader = small.svg.match(/class="annotation line leader"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/)!
        expect(Number(leader[1])).toBeCloseTo(small.mid.x, 3)
        expect(Number(leader[2])).toBeCloseTo(small.mid.y, 3)
        expect(Number(leader[3])).toBeCloseTo(small.at.x, 3)
        expect(Number(leader[4])).toBeCloseTo(small.at.y, 3)
    })

    it('follows the text size: the same dimension needs a leader once the text grows', async () =>
    {
        const fits    = await dimSVG([0,0,0], [10,0,0], 1, 2)   // 10 units vs 4 units of text
        const tooTight = await dimSVG([0,0,0], [10,0,0], 1, 8)  // 10 units vs 16 units of text

        expect(fits.hasLeader).toBe(false)
        expect(tooTight.hasLeader).toBe(true)
    })
})

describe('the number itself', () =>
{
    const valueOf = async (length:number, options?:any, system:'metric'|'imperial' = 'metric') =>
    {
        const { modeler } = await setup(system)
        const r = modeler.rect(length, 100) as any
        return (r.bbox().back().dim(options) as any)._formatValueText()
    }

    it('stays in the model unit when the unit is not printed', async () =>
    {
        /*  Auto-picking the "best" unit is right when it is PRINTED — 1200mm reads well as
            "1.2 m" — and meaningless when it is not: "1.2" on a drawing whose every other
            number is in millimeters. */
        expect(await valueOf(1200)).toBe('1200')
        expect(await valueOf(12000)).toBe('12000')
        expect(await valueOf(400)).toBe('400')
    })

    it('still picks a readable unit when it does print one', async () =>
    {
        expect(await valueOf(1200, { showUnits: true })).toBe('1.2 m')
        expect(await valueOf(400, { showUnits: true })).toBe('400 mm')
    })

    it('honours roundDecimals on the bare value', async () =>
    {
        expect(await valueOf(45.5)).toBe('46')                          // whole mm by default
        expect(await valueOf(45.5, { roundDecimals: 1 })).toBe('45.5')  // used to be ignored
    })

    it('leaves imperial alone — feet and inches are read as written', async () =>
    {
        expect(await valueOf(1200, {}, 'imperial')).toBe(`47 1/4"`)
    })
})
