/** Drawing scale: reading it, resolving it, and writing it under the drawing.
 *
 *  A scale RATIO is page length over model length (1/100 = one millimeter of paper per
 *  hundred millimeters of building). What a renderer needs is unitsPerMm — model units per
 *  page millimeter — which is that ratio inverted and converted through the model's own unit.
 */
import { describe, expect, it, vi } from 'vitest'

import { parseScaleRatio, scaleLabel, resolveScale } from '../../../src/docs/scale'
import { isScaleInput } from '../../../src/docs/typeguards'
import { Docs } from '../../../src/docs/Docs'

describe('parseScaleRatio', () =>
{
    it('reads the forms a script might use', () =>
    {
        expect(parseScaleRatio(1/100)).toBeCloseTo(0.01, 12)
        expect(parseScaleRatio(2)).toBe(2)
        expect(parseScaleRatio('1:100')).toBeCloseTo(0.01, 12)
        expect(parseScaleRatio('1 : 50')).toBeCloseTo(0.02, 12)
        expect(parseScaleRatio('2:1')).toBe(2)
        expect(parseScaleRatio('1/100')).toBeCloseTo(0.01, 12)
        expect(parseScaleRatio('0.01')).toBeCloseTo(0.01, 12)
    })

    it("reads the architect's inches-per-foot form", () =>
    {
        expect(parseScaleRatio(`1/4"=1'`)).toBeCloseTo(1/48, 12)   // 1:48
        expect(parseScaleRatio(`1/8" = 1'`)).toBeCloseTo(1/96, 12)
        expect(parseScaleRatio(`1" = 1'`)).toBeCloseTo(1/12, 12)
        expect(parseScaleRatio(`1 1/2" = 1 ft`)).toBeCloseTo(1.5/12, 12)
        expect(parseScaleRatio(`3 in = 1 foot`)).toBeCloseTo(3/12, 12)
    })

    it('refuses what is not a scale', () =>
    {
        for(const bad of ['', 'big', '1:0', '0', '-1/50', 'fit', 'auto', null as any, {} as any])
        {
            expect(parseScaleRatio(bad)).toBeNull()
        }
    })
})

describe('isScaleInput', () =>
{
    it('accepts every documented form and rejects the rest', () =>
    {
        for(const good of ['fit', 'auto', 1/100, 2, '1:100', `1/4"=1'`, [1/50, 1/100], ['1:50', 1/100]])
        {
            expect(isScaleInput(good)).toBe(true)
        }
        for(const bad of [0, -1, NaN, 'huge', [], [1/50, 'nope'], {}, null, undefined])
        {
            expect(isScaleInput(bad)).toBe(false)
        }
    })
})

describe('scaleLabel', () =>
{
    it('writes metric scales as a ratio', () =>
    {
        expect(scaleLabel(1/100)).toBe('1:100')
        expect(scaleLabel(1/50)).toBe('1:50')
        expect(scaleLabel(1)).toBe('1:1')
        expect(scaleLabel(2)).toBe('2:1')
    })

    it("writes imperial scales the way they are read", () =>
    {
        expect(scaleLabel(1/48, 'imperial')).toBe(`1/4" = 1'-0"`)
        expect(scaleLabel(1/96, 'imperial')).toBe(`1/8" = 1'-0"`)
        expect(scaleLabel(1/12, 'imperial')).toBe(`1" = 1'-0"`)
        // not a standard inches-per-foot scale: the plain ratio is clearer
        expect(scaleLabel(1/100, 'imperial')).toBe('1:100')
    })
})

describe('resolveScale', () =>
{
    // a 1000 x 500mm drawing in a 200 x 150mm view, no margin
    const base = {
        extents: { width: 1000, height: 500 },
        wMm: 200, hMm: 150,
        modelUnits: 'mm' as const,
    }

    it('fits by default, filling the binding dimension', () =>
    {
        const r = resolveScale({ ...base })
        expect(r.fitted).toBe(true)
        expect(r.ratio).toBeCloseTo(200/1000, 12)     // width-bound
        expect(r.unitsPerMm).toBeCloseTo(5, 12)       // 1000 units over 200mm
        expect(r.fits).toBe(true)
    })

    it('honours an exact ratio: 1000mm of model is 10mm of paper at 1:100', () =>
    {
        const r = resolveScale({ ...base, input: 1/100 })
        expect(r.fitted).toBe(false)
        expect(r.label).toBe('1:100')
        expect(r.unitsPerMm).toBeCloseTo(100, 12)
        expect(1000 / r.unitsPerMm).toBeCloseTo(10, 12) // mm on the page
    })

    it('converts through the model unit, so 1:100 of metres is not 1:100 of millimetres', () =>
    {
        const mm = resolveScale({ ...base, input: 1/100, modelUnits: 'mm' })
        const m  = resolveScale({ ...base, input: 1/100, modelUnits: 'm' })
        expect(mm.unitsPerMm).toBeCloseTo(100, 12)
        expect(m.unitsPerMm).toBeCloseTo(0.1, 12)      // 1 page mm is 0.1m of model
    })

    it("'auto' takes the largest standard scale that still fits", () =>
    {
        // fit would be 1:5; the ladder step at or below that is 1:5 exactly
        const r = resolveScale({ ...base, input: 'auto' })
        expect(r.fitted).toBe(false)
        expect(r.label).toBe('1:5')
        expect(r.fits).toBe(true)

        // a drawing that only just misses 1:5 drops to the next standard step
        const tighter = resolveScale({ ...base, wMm: 199, input: 'auto' })
        expect(tighter.label).toBe('1:10')
    })

    it('picks the largest entry that fits from a list', () =>
    {
        const r = resolveScale({ ...base, input: [1/100, 1/10, 1/2] })
        expect(r.label).toBe('1:10')
        expect(r.fits).toBe(true)
    })

    it('honours a scale that does not fit, but says so and reports the largest that would', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const r = resolveScale({ ...base, input: 1/2, name: 'elevation' })

        expect(r.ratio).toBe(1/2)
        expect(r.fits).toBe(false)
        expect(r.largestFitting).toBeCloseTo(1/5, 12)
        expect(warn).toHaveBeenCalledOnce()
        expect(warn.mock.calls[0][0]).toContain('elevation')
        expect(warn.mock.calls[0][0]).toContain('1:5')    // what would have fitted
        warn.mockRestore()
    })

    it('falls back to fitting when there are no model units to convert through', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const r = resolveScale({ ...base, modelUnits: undefined, input: 1/100 })

        expect(r.fitted).toBe(true)
        expect(warn).toHaveBeenCalledOnce()
        warn.mockRestore()
    })

    it('falls back to fitting when the input is not a scale at all', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const r = resolveScale({ ...base, input: 'enormous' as any })

        expect(r.fitted).toBe(true)
        expect(r.ratio).toBeCloseTo(0.2, 12)
        warn.mockRestore()
    })

    it('leaves room for the annotations when fitting', () =>
    {
        const r = resolveScale({ ...base, marginMm: 12 })
        // 1000 units into (200 - 2*12)mm
        expect(r.unitsPerMm).toBeCloseTo(1000/176, 12)
    })
})

describe('Container.scale() / zoom()', () =>
{
    const viewOf = (doc:any) => (doc.getDoc('d') as any)._pages[0]._containers[0]

    const makeDoc = () =>
    {
        const doc = new Docs(null, { runner: { getActiveScope: () => ({}) }, calc: { metrics: () => ({}) } } as any)
        doc.create('d').page('p').view('v')
        return doc
    }

    it('keeps scale and zoom apart', () =>
    {
        // They shared one field, told apart by a second: .scale(x).zoom(y) dropped the scale.
        const doc = makeDoc()
        doc.scale(1/100).zoom(2)

        const view = viewOf(doc)
        expect(view._scale).toBe(1/100)
        expect(view._zoom).toBe(2)
    })

    it('rejects what is not a scale', () =>
    {
        // The guard read `if(!isScaleInput)` — the function object — so it never fired.
        const doc = makeDoc()
        expect(() => doc.scale('enormous' as any)).toThrow(/Invalid input/)
        expect(() => doc.scale(-1 as any)).toThrow(/Invalid input/)
        expect(() => doc.scale([1/50, 'nope'] as any)).toThrow(/Invalid input/)
        expect(() => doc.zoom(0 as any)).toThrow(/Invalid input/)
        // NOTE: Document.scale() with no argument (or any falsy one) means 'auto'
        expect(() => doc.scale()).not.toThrow()
    })

    it('reports both in the container data', async () =>
    {
        const doc = makeDoc()
        doc.scale('auto').zoom(1.5)

        // _toContainerData(), not toData(): the latter also renders the drawing, and this
        // view deliberately has no shapes.
        const data:any = viewOf(doc)._toContainerData()
        expect(data.scale).toBe('auto')
        expect(data.zoom).toBe(1.5)
    })
})
