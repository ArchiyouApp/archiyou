import { describe, it, expect } from 'vitest'

import { ScriptParam, PARAM_TYPE_SCHEMAS } from '../../../src/execution/ScriptParam'
import type { ScriptParamData } from '../../../src/execution/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParam(overrides: Partial<ScriptParamData> & { name: string }): ScriptParam
{
    return ScriptParam.fromData({ schema: {}, ...overrides } as ScriptParamData)
}

// ── PARAM_TYPE_SCHEMAS ───────────────────────────────────────────────────────

describe('PARAM_TYPE_SCHEMAS', () =>
{
    it('covers every ScriptParamType', () =>
    {
        const expected = ['number', 'boolean', 'text', 'options', 'list', 'object']
        expected.forEach(t => expect(PARAM_TYPE_SCHEMAS).toHaveProperty(t))
    })

    it('every entry has a type field', () =>
    {
        Object.entries(PARAM_TYPE_SCHEMAS).forEach(([, schema]) =>
        {
            expect(schema).toHaveProperty('type')
        })
    })

    it('every entry has a default value', () =>
    {
        Object.entries(PARAM_TYPE_SCHEMAS).forEach(([, schema]) =>
        {
            expect(schema).toHaveProperty('default')
        })
    })
})

// ── fromData: name normalisation ─────────────────────────────────────────────

describe('ScriptParam.fromData() — name normalisation', () =>
{
    it('uppercases the param name', () =>
    {
        const p = makeParam({ name: 'myParam', type: 'number' })
        expect(p.name).toBe('MYPARAM')
    })

    it('keeps an already-uppercase name unchanged', () =>
    {
        const p = makeParam({ name: 'WIDTH', type: 'number' })
        expect(p.name).toBe('WIDTH')
    })

    it('uppercases a mixed-case name with underscores', () =>
    {
        const p = makeParam({ name: 'wall_height', type: 'number' })
        expect(p.name).toBe('WALL_HEIGHT')
    })
})

// ── fromData: default label ───────────────────────────────────────────────────

describe('ScriptParam.fromData() — label', () =>
{
    it('uses the provided label', () =>
    {
        const p = makeParam({ name: 'width', type: 'number', label: 'Width (mm)' })
        expect(p.label).toBe('Width (mm)')
    })

    it('falls back to the normalised name when no label given', () =>
    {
        const p = makeParam({ name: 'depth', type: 'number' })
        expect(p.label).toBe('DEPTH')
    })
})

// ── fromData: schema merging with PARAM_TYPE_SCHEMAS ─────────────────────────

describe('ScriptParam.fromData() — schema merging', () =>
{
    it('fills in the standard number schema when no schema is provided', () =>
    {
        const p = ScriptParam.fromData({ name: 'size', type: 'number', schema: {} } as ScriptParamData)
        const s = p.schema as any
        expect(s.type).toBe('number')
        expect(s).toHaveProperty('minimum')
        expect(s).toHaveProperty('maximum')
    })

    it('caller schema fields override the standard schema', () =>
    {
        const p = ScriptParam.fromData({
            name:   'height',
            type:   'number',
            schema: { type: 'number', minimum: 5, maximum: 200 },
        } as ScriptParamData)
        const s = p.schema as any
        expect(s.minimum).toBe(5)
        expect(s.maximum).toBe(200)
    })

    it('fills in the standard boolean schema', () =>
    {
        const p = ScriptParam.fromData({ name: 'visible', type: 'boolean', schema: {} } as ScriptParamData)
        const s = p.schema as any
        expect(s.type).toBe('boolean')
    })

    it('fills in the standard text schema', () =>
    {
        const p = ScriptParam.fromData({ name: 'label', type: 'text', schema: {} } as ScriptParamData)
        const s = p.schema as any
        expect(s.type).toBe('string')
    })

    it('fills in the standard options schema', () =>
    {
        const p = ScriptParam.fromData({
            name:   'color',
            type:   'options',
            schema: { enum: ['red', 'blue', 'green'] },
        } as ScriptParamData)
        const s = p.schema as any
        expect(s.type).toBe('string')
        expect(s.enum).toEqual(['red', 'blue', 'green'])
    })
})

// ── fromData: default resolution ─────────────────────────────────────────────

describe('ScriptParam.fromData() — default resolution', () =>
{
    it('uses the explicit default field when provided', () =>
    {
        const p = ScriptParam.fromData({ name: 'size', type: 'number', default: 42, schema: {} } as ScriptParamData)
        expect(p.default).toBe(42)
    })

    it('falls back to schema.default when no explicit default', () =>
    {
        const p = ScriptParam.fromData({
            name:   'count',
            type:   'number',
            schema: { type: 'number', default: 7 },
        } as ScriptParamData)
        expect(p.default).toBe(7)
    })

    it('falls back to PARAM_TYPE_SCHEMAS default for the type', () =>
    {
        const p = ScriptParam.fromData({ name: 'flag', type: 'boolean', schema: {} } as ScriptParamData)
        expect(p.default).toBe(false)
    })
})

// ── validate: definition ─────────────────────────────────────────────────────

describe('ScriptParam.validate()', () =>
{
    it('returns canonical data for a valid param', () =>
    {
        const data: ScriptParamData = {
            name:   'width',
            type:   'number',
            schema: { type: 'number', minimum: 0, maximum: 100 },
        }
        const out = ScriptParam.validate(data)
        expect(out.name).toBe('WIDTH')
        expect(out.schema).toMatchObject({ type: 'number' })
    })

    it('throws for a param missing the required name', () =>
    {
        expect(() => ScriptParam.validate({ name: '', schema: {} } as ScriptParamData)).toThrow()
    })
})

// ── validateValue: number ─────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): number', () =>
{
    const p = ScriptParam.fromData({
        name:   'width',
        type:   'number',
        schema: { type: 'number', minimum: 0, maximum: 100, multipleOf: 1 },
    } as ScriptParamData)

    it('accepts an in-range integer', () =>  { expect(p.validateValue(50)).toBe(true)  })
    it('accepts the boundary values',   () =>  { expect(p.validateValue(0)).toBe(true); expect(p.validateValue(100)).toBe(true) })
    it('rejects a value above maximum', () =>  { expect(p.validateValue(101)).toBe(false) })
    it('rejects a value below minimum', () =>  { expect(p.validateValue(-1)).toBe(false)  })
    it('rejects a string',              () =>  { expect(p.validateValue('50')).toBe(false) })
    it('rejects null',                  () =>  { expect(p.validateValue(null)).toBe(false) })
})

// ── validateValue: boolean ────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): boolean', () =>
{
    const p = ScriptParam.fromData({ name: 'enabled', type: 'boolean', schema: {} } as ScriptParamData)

    it('accepts true',    () => { expect(p.validateValue(true)).toBe(true)  })
    it('accepts false',   () => { expect(p.validateValue(false)).toBe(true) })
    it('rejects 1',       () => { expect(p.validateValue(1)).toBe(false)    })
    it('rejects a string',() => { expect(p.validateValue('true')).toBe(false) })
})

// ── validateValue: text ───────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): text', () =>
{
    const p = ScriptParam.fromData({
        name:   'label',
        type:   'text',
        schema: { type: 'string', minLength: 1, maxLength: 10 },
    } as ScriptParamData)

    it('accepts a valid string',        () => { expect(p.validateValue('hello')).toBe(true)      })
    it('rejects an empty string',       () => { expect(p.validateValue('')).toBe(false)           })
    it('rejects a string over maxLength', () => { expect(p.validateValue('12345678901')).toBe(false) })
    it('rejects a number',              () => { expect(p.validateValue(42)).toBe(false)           })
})

// ── validateValue: options ────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): options', () =>
{
    const p = ScriptParam.fromData({
        name:   'color',
        type:   'options',
        schema: { type: 'string', enum: ['red', 'green', 'blue'] },
    } as ScriptParamData)

    it('accepts a value in the enum',      () => { expect(p.validateValue('red')).toBe(true)    })
    it('rejects a value not in the enum',  () => { expect(p.validateValue('yellow')).toBe(false) })
    it('rejects a number',                 () => { expect(p.validateValue(0)).toBe(false)        })
})

// ── validateValue: list ───────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): list', () =>
{
    const p = ScriptParam.fromData({
        name:   'tags',
        type:   'list',
        schema: { type: 'array', items: { type: 'string' }, minItems: 1 },
    } as ScriptParamData)

    it('accepts a non-empty string array',  () => { expect(p.validateValue(['a', 'b'])).toBe(true)  })
    it('rejects an empty array (minItems)', () => { expect(p.validateValue([])).toBe(false)          })
    it('rejects an array with wrong types', () => { expect(p.validateValue([1, 2])).toBe(false)      })
    it('rejects a plain string',            () => { expect(p.validateValue('a')).toBe(false)         })
})

// ── validateValue: object ─────────────────────────────────────────────────────

describe('ScriptParam — validateValue(): object', () =>
{
    const p = ScriptParam.fromData({
        name:   'config',
        type:   'object',
        schema: {
            type:       'object',
            properties: {
                x: { type: 'number', minimum: 0, maximum: 10 },
                y: { type: 'number', minimum: 0, maximum: 10 },
            },
        },
    } as ScriptParamData)

    it('accepts a valid object',           () => { expect(p.validateValue({ x: 1, y: 2 })).toBe(true)   })
    it('accepts an empty object (no required props)', () => { expect(p.validateValue({})).toBe(true) })
    it('rejects a property value out of range', () => { expect(p.validateValue({ x: 99, y: 0 })).toBe(false) })
    it('rejects a non-object',             () => { expect(p.validateValue('config')).toBe(false)          })
})

// ── isIterable ────────────────────────────────────────────────────────────────

describe('ScriptParam.isIterable()', () =>
{
    it('is true for a number param',   () =>
    {
        const p = makeParam({ name: 'num', type: 'number', schema: { type: 'number' } })
        expect(p.isIterable()).toBe(true)
    })

    it('is true for a boolean param',  () =>
    {
        const p = makeParam({ name: 'flag', type: 'boolean', schema: { type: 'boolean' } })
        expect(p.isIterable()).toBe(true)
    })

    it('is true for an options param (enum)', () =>
    {
        const p = makeParam({ name: 'choice', type: 'options', schema: { type: 'string', enum: ['a', 'b'] } })
        expect(p.isIterable()).toBe(true)
    })

    it('is false for a text param',    () =>
    {
        const p = makeParam({ name: 'txt', type: 'text', schema: { type: 'string' } })
        expect(p.isIterable()).toBe(false)
    })
})

// ── numValues ─────────────────────────────────────────────────────────────────

describe('ScriptParam.numValues()', () =>
{
    it('counts steps for a number param', () =>
    {
        const p = makeParam({ name: 'num', type: 'number', schema: { type: 'number', minimum: 0, maximum: 10, multipleOf: 2 } })
        expect(p.numValues()).toBe(5)
    })

    it('returns 2 for a boolean param', () =>
    {
        const p = makeParam({ name: 'flag', type: 'boolean', schema: { type: 'boolean' } })
        expect(p.numValues()).toBe(2)
    })

    it('returns enum length for an options param', () =>
    {
        const p = makeParam({ name: 'choice', type: 'options', schema: { type: 'string', enum: ['x', 'y', 'z'] } })
        expect(p.numValues()).toBe(3)
    })
})

// ── iterateValues ─────────────────────────────────────────────────────────────

describe('ScriptParam.iterateValues()', () =>
{
    it('iterates over number steps', () =>
    {
        const p = makeParam({ name: 'num', type: 'number', schema: { type: 'number', minimum: 0, maximum: 4, multipleOf: 2 } })
        expect([...p.iterateValues()]).toEqual([0, 2, 4])
    })

    it('iterates over boolean values', () =>
    {
        const p = makeParam({ name: 'flag', type: 'boolean', schema: { type: 'boolean' } })
        expect([...p.iterateValues()]).toEqual([true, false])
    })

    it('iterates over enum values', () =>
    {
        const p = makeParam({ name: 'choice', type: 'options', schema: { type: 'string', enum: ['a', 'b', 'c'] } })
        expect([...p.iterateValues()]).toEqual(['a', 'b', 'c'])
    })

    it('yields the default for a non-iterable param', () =>
    {
        const p = makeParam({ name: 'txt', type: 'text', default: 'hello', schema: { type: 'string' } })
        expect([...p.iterateValues()]).toEqual(['hello'])
    })
})

// ── toData round-trip ─────────────────────────────────────────────────────────

describe('ScriptParam — toData() round-trip', () =>
{
    it('serialises and deserialises without data loss', () =>
    {
        const original: ScriptParamData = {
            name:        'radius',
            type:        'number',
            label:       'Radius',
            description: 'Sphere radius',
            order:       1,
            schema:      { type: 'number', minimum: 1, maximum: 50, multipleOf: 1 },
            default:     10,
        }
        const p    = ScriptParam.fromData(original)
        const data = p.toData()

        expect(data.name).toBe('RADIUS')
        expect(data.label).toBe('Radius')
        expect(data.description).toBe('Sphere radius')
        expect(data.order).toBe(1)
        expect(data.default).toBe(10)
        expect((data.schema as any).minimum).toBe(1)
    })

    it('re-instantiating from toData() yields an equivalent param', () =>
    {
        const p1 = ScriptParam.fromData({ name: 'size', type: 'number', schema: { type: 'number', minimum: 0, maximum: 10 } } as ScriptParamData)
        const p2 = ScriptParam.fromData(p1.toData())

        expect(p2.name).toBe(p1.name)
        expect(p2.default).toBe(p1.default)
        expect(p2.validateValue(5)).toBe(true)
    })
})
