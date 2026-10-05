import { describe, it, expect, vi, afterEach } from 'vitest'

import { convertValueFromToUnit, pointsToMm, mmToPoints, MM_PER_PNT } from '../../../src/docs/utils'
import { convert } from '../../../src/units/UnitConverter'
import type { DocUnits } from '../../../src/docs/types'

const PAPER_UNITS:Array<DocUnits> = ['mm', 'cm', 'inch', 'pnt']

/** A paper unit as UnitConverter knows it, or null for points (paper-only) */
const modelUnitOf = (u:DocUnits) => (u === 'pnt') ? null : u

describe('Doc units: convertValueFromToUnit()', () =>
{
    afterEach(() => { vi.restoreAllMocks() })

    it('agrees with UnitConverter for every pair of model units', () =>
    {
        PAPER_UNITS.filter(modelUnitOf).forEach(from =>
        {
            PAPER_UNITS.filter(modelUnitOf).forEach(to =>
            {
                expect(convertValueFromToUnit(123.456, from, to)).toBeCloseTo(convert(123.456, modelUnitOf(from), modelUnitOf(to)), 9)
            })
        })
    })

    it('round-trips every pair, points included', () =>
    {
        PAPER_UNITS.forEach(from =>
        {
            PAPER_UNITS.forEach(to =>
            {
                const there = convertValueFromToUnit(42.5, from, to)
                expect(convertValueFromToUnit(there, to, from)).toBeCloseTo(42.5, 9)
            })
        })
    })

    it('converts millimeters to inches (was 10x too large)', () =>
    {
        expect(convertValueFromToUnit(25.4, 'mm', 'inch')).toBe(1)
        expect(convertValueFromToUnit(297, 'mm', 'inch')).toBeCloseTo(11.693, 3)
    })

    it('converts centimeters to points (was 100x too small)', () =>
    {
        expect(convertValueFromToUnit(1, 'cm', 'pnt')).toBeCloseTo(28.3465, 4)
        expect(convertValueFromToUnit(1, 'inch', 'pnt')).toBe(72)
    })

    it('relates percentages to a number, both ways', () =>
    {
        expect(convertValueFromToUnit(50, 'mm', '%', 200)).toBe(25)
        expect(convertValueFromToUnit(25, '%', 'inch', 8)).toBe(2)
    })

    it('warns and returns the original value on bad input', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(convertValueFromToUnit(10, 'mm', '%')).toBe(10)
        expect(convertValueFromToUnit(10, 'mm', 'feet' as any)).toBe(10)
        expect(convertValueFromToUnit({} as any, 'mm', 'cm')).toBe(null)
        expect(warn).toHaveBeenCalledTimes(3)
    })

    it('keeps points and millimeters on one constant', () =>
    {
        expect(MM_PER_PNT).toBeCloseTo(25.4/72, 12)
        expect(pointsToMm(72)).toBeCloseTo(25.4, 9)
        expect(mmToPoints(pointsToMm(10))).toBeCloseTo(10, 9)
    })
})
