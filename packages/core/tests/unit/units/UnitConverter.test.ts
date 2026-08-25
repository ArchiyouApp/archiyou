import { describe, it, expect } from 'vitest'

import {
    MM_PER_UNIT, UNIT_SYSTEMS, systemOfUnit, baseUnitForSystem,
    toMM, fromMM, convert,
    pickBestUnit, toFraction, snapMMToSystem,
    formatImperial, formatMetric, formatLength, formatFromUnit,
    paramDisplayDecimals,
    stepDecimals,
} from '../../../src/units/UnitConverter'
import type { ModelUnits } from '../../../src/modeler/types'

const ALL_UNITS = Object.keys(MM_PER_UNIT) as ModelUnits[]

describe('UnitConverter', () =>
{
    describe('toMM / fromMM round-trips', () =>
    {
        it('round-trips every unit', () =>
        {
            for (const u of ALL_UNITS)
            {
                expect(fromMM(toMM(123.456, u), u)).toBeCloseTo(123.456, 6)
            }
        })

        it('has correct anchor factors', () =>
        {
            expect(toMM(1, 'inch')).toBe(25.4)
            expect(toMM(1, 'feet')).toBe(304.8)
            expect(toMM(1, 'm')).toBe(1000)
            expect(toMM(1, 'yd')).toBeCloseTo(914.4, 6)
        })

        it('converts across units', () =>
        {
            expect(convert(1, 'feet', 'inch')).toBeCloseTo(12, 6)
            expect(convert(1000, 'mm', 'm')).toBeCloseTo(1, 6)
            expect(convert(25.4, 'mm', 'inch')).toBeCloseTo(1, 6)
        })
    })

    describe('systemOfUnit / UNIT_SYSTEMS', () =>
    {
        it('classifies units', () =>
        {
            expect(systemOfUnit('mm')).toBe('metric')
            expect(systemOfUnit('m')).toBe('metric')
            expect(systemOfUnit('inch')).toBe('imperial')
            expect(systemOfUnit('feet')).toBe('imperial')
        })

        it('lists disjoint systems covering all units', () =>
        {
            const all = [...UNIT_SYSTEMS.metric, ...UNIT_SYSTEMS.imperial].sort()
            expect(all).toEqual(ALL_UNITS.slice().sort())
        })

        it('base unit is mm (metric) / inch (imperial)', () =>
        {
            expect(baseUnitForSystem('metric')).toBe('mm')
            expect(baseUnitForSystem('imperial')).toBe('inch')
        })
    })

    describe('paramDisplayDecimals', () =>
    {
        it('shows mm as integers (0 decimals)', () =>
        {
            expect(paramDisplayDecimals('mm')).toBe(0)
        })

        it('shows cm / m / inch / feet with 2 decimals', () =>
        {
            expect(paramDisplayDecimals('cm')).toBe(2)
            expect(paramDisplayDecimals('m')).toBe(2)
            expect(paramDisplayDecimals('inch')).toBe(2)
            expect(paramDisplayDecimals('feet')).toBe(2)
        })

        it('defaults unitless (null/undefined) to 2 decimals', () =>
        {
            expect(paramDisplayDecimals(null)).toBe(2)
            expect(paramDisplayDecimals(undefined)).toBe(2)
        })
    })

    describe('stepDecimals', () =>
    {
        it('derives the decimals from the step grid', () =>
        {
            expect(stepDecimals(1)).toBe(0)
            expect(stepDecimals(5)).toBe(0)
            expect(stepDecimals(0.5)).toBe(1)
            expect(stepDecimals(0.1)).toBe(1)
            expect(stepDecimals(0.25)).toBe(2)
            expect(stepDecimals(0.001)).toBe(3)
        })

        it('has no opinion on missing / invalid steps', () =>
        {
            expect(stepDecimals(0)).toBeNull()
            expect(stepDecimals(-1)).toBeNull()
            expect(stepDecimals(NaN)).toBeNull()
            expect(stepDecimals(null)).toBeNull()
            expect(stepDecimals(undefined)).toBeNull()
        })
    })

    describe('pickBestUnit', () =>
    {
        it('metric: mm below 1m, m below 1km, else km', () =>
        {
            expect(pickBestUnit(470, 'metric')).toBe('mm')
            expect(pickBestUnit(1000, 'metric')).toBe('m')
            expect(pickBestUnit(5_000_000, 'metric')).toBe('km')
        })

        it('imperial: 1000mm→inch, 10m→feet (per requirement)', () =>
        {
            expect(pickBestUnit(1000, 'imperial')).toBe('inch')
            expect(pickBestUnit(10_000, 'imperial')).toBe('feet')
        })

        it('imperial: very large → miles', () =>
        {
            expect(pickBestUnit(MM_PER_UNIT.mi, 'imperial')).toBe('mi')
        })
    })

    describe('toFraction', () =>
    {
        it('reduces to lowest terms', () =>
        {
            expect(toFraction(0.5)).toMatchObject({ whole: 0, num: 1, den: 2 })  // 8/16 → 1/2
            expect(toFraction(0.25)).toMatchObject({ whole: 0, num: 1, den: 4 }) // 4/16 → 1/4
            expect(toFraction(6.5)).toMatchObject({ whole: 6, num: 1, den: 2 })
        })

        it('carries when the fraction rounds up to a whole', () =>
        {
            // 6.97" at 1/16 → 15.52/16 → rounds to 16/16 → carry to 7
            expect(toFraction(6.97)).toMatchObject({ whole: 7, num: 0, den: 1 })
        })

        it('handles exact wholes', () =>
        {
            expect(toFraction(6)).toMatchObject({ whole: 6, num: 0, den: 1 })
        })
    })

    describe('snapMMToSystem', () =>
    {
        it('imperial: snaps to the nearest 1/16 inch (25mm → 1")', () =>
        {
            expect(snapMMToSystem(25, 'imperial')).toBeCloseTo(25.4, 6)   // 0.984" → 1"
            expect(snapMMToSystem(12, 'imperial')).toBeCloseTo(12.7, 6)   // 0.472" → 1/2" = 12.7mm
            expect(snapMMToSystem(25.4, 'imperial')).toBeCloseTo(25.4, 6) // already 1"
        })

        it('metric: snaps to the nearest whole millimetre (25.4mm → 25mm)', () =>
        {
            expect(snapMMToSystem(25.4, 'metric')).toBe(25)
            expect(snapMMToSystem(123.456, 'metric')).toBe(123)
        })
    })

    describe('formatImperial', () =>
    {
        it('formats inch-only with fractions', () =>
        {
            expect(formatImperial(toMM(6.5, 'inch'), { unit: 'inch' })).toBe('6 1/2"')
            expect(formatImperial(toMM(6, 'inch'),   { unit: 'inch' })).toBe('6"')
            expect(formatImperial(toMM(0.5, 'inch'), { unit: 'inch' })).toBe('1/2"')
        })

        it('formats feet + inch', () =>
        {
            // 18.5" = 1' 6 1/2"
            expect(formatImperial(toMM(18.5, 'inch'), { unit: 'feet' })).toBe("1' 6 1/2\"")
            // exact feet
            expect(formatImperial(toMM(24, 'inch'), { unit: 'feet' })).toBe("2'")
        })

        it('auto-picks unit when none given', () =>
        {
            // 1000mm ≈ 39 3/8" → inches (below feet threshold)
            expect(formatImperial(1000)).toContain('"')
            // 10m → feet
            expect(formatImperial(10_000)).toContain("'")
        })
    })

    describe('formatMetric', () =>
    {
        it('formats with the picked unit and label', () =>
        {
            expect(formatMetric(470)).toBe('470 mm')
            expect(formatMetric(1000)).toBe('1 m')
            expect(formatMetric(1500)).toBe('1.5 m')
        })

        it('honours withUnit:false', () =>
        {
            expect(formatMetric(470, { withUnit: false })).toBe('470')
        })
    })

    describe('formatLength / formatFromUnit', () =>
    {
        it('dispatches on system', () =>
        {
            expect(formatLength(470, 'metric')).toBe('470 mm')
            expect(formatLength(470, 'imperial')).toContain('"')
        })

        it('formats a source-unit value (inch-authored → metric)', () =>
        {
            // a model authored in inches, viewed in metric
            expect(formatFromUnit(10, 'inch', 'metric')).toBe('254 mm')
        })
    })
})
