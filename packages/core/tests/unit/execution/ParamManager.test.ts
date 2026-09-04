import { describe, it, expect } from 'vitest'

import { ParamManager } from '../../../src/execution/ParamManager'
import { ScriptParam } from '../../../src/execution/ScriptParam'
import type { ScriptParamData } from '../../../src/execution/types'

// ── define() — ergonomic (name, type, options) form ──────────────────────────

describe('ParamManager.define() — ergonomic form', () =>
{
    it('builds a number param from friendly options (min/max/step/default)', () =>
    {
        const pm = new ParamManager()
        pm.define('width', 'number', { min: 50, max: 200, step: 5, default: 120, group: 'Size' })

        const p = pm.getParamsMap()['WIDTH']
        expect(p).toBeDefined()
        expect(p.name).toBe('WIDTH')                 // normalised to uppercase
        expect(p._definedProgrammatically).toBe(true)
        expect(p.group).toBe('Size')
        expect((p.schema as any).minimum).toBe(50)
        expect((p.schema as any).maximum).toBe(200)
        expect((p.schema as any).multipleOf).toBe(5)
        expect(p.default).toBe(120)
    })

    it('builds an options param from the options alias → schema.enum', () =>
    {
        const pm = new ParamManager()
        pm.define('mode', 'options', { options: ['a', 'b', 'c'], default: 'a' })

        const p = pm.getParamsMap()['MODE']
        expect((p.schema as any).enum).toEqual(['a', 'b', 'c'])
        expect(p.default).toBe('a')
    })

    it('builds a boolean param', () =>
    {
        const pm = new ParamManager()
        pm.define('show', 'boolean', { default: true })
        expect(pm.getParamsMap()['SHOW'].default).toBe(true)
    })

    it('throws when type is missing in the ergonomic form', () =>
    {
        const pm = new ParamManager()
        // @ts-expect-error intentionally omitting type
        expect(() => pm.define('foo')).toThrow()
    })
})

// ── define() — object / ScriptParamData form (back-compat) ───────────────────

describe('ParamManager.define() — object form', () =>
{
    it('still accepts a raw ScriptParamData object', () =>
    {
        const pm = new ParamManager()
        pm.define({ name: 'size', type: 'number', schema: { type: 'number', minimum: 0, maximum: 10, default: 5 } } as ScriptParamData)

        const p = pm.getParamsMap()['SIZE']
        expect(p).toBeDefined()
        expect(p._definedProgrammatically).toBe(true)
        expect((p.schema as any).maximum).toBe(10)
    })
})

// ── define() — value preservation across re-runs ─────────────────────────────

describe('ParamManager.define() — preserves the current value', () =>
{
    it('keeps an existing _value when re-defining a param', () =>
    {
        // Simulate a re-run: WIDTH comes in from request.params with the user's
        // chosen value, then the script re-defines it.
        const incoming: ScriptParamData = {
            name: 'WIDTH', type: 'number',
            schema: { type: 'number', minimum: 0, maximum: 200, multipleOf: 1, default: 100 },
            _value: 150, _definedProgrammatically: true,
        } as ScriptParamData

        const pm = new ParamManager([incoming])
        pm.define('width', 'number', { min: 0, max: 200, default: 100 })

        expect(pm.getParamsMap()['WIDTH']._value).toBe(150)
    })
})

// ── preset() ─────────────────────────────────────────────────────────────────

describe('ParamManager.preset()', () =>
{
    it('records a preset shaped like Script.presets', () =>
    {
        const pm = new ParamManager()
        pm.define('width', 'number', { min: 0, max: 200, default: 100 })
        pm.preset('SMALL', { WIDTH: 80 }, { description: 'Compact version' })

        const presets = pm.getDefinedPresets()
        expect(presets.SMALL).toBeDefined()
        expect(presets.SMALL.WIDTH._value).toBe(80)
    })

    it('throws without a values object', () =>
    {
        const pm = new ParamManager()
        // @ts-expect-error intentionally bad args
        expect(() => pm.preset('X')).toThrow()
    })
})

// ── getManagedParams() — full-sync deletions ─────────────────────────────────

describe('ParamManager.getManagedParams() — full sync', () =>
{
    const progParam = (name: string): ScriptParamData => ({
        name, type: 'number',
        schema: { type: 'number', minimum: 0, maximum: 100, multipleOf: 1, default: 0 },
        _definedProgrammatically: true,
    } as ScriptParamData)

    it('reports a previously script-defined param as deleted when not re-defined', () =>
    {
        const pm = new ParamManager([progParam('AAA'), progParam('BBB')])
        // Re-define only AAA this run → BBB was dropped by the script
        pm.define('AAA', 'number', { min: 0, max: 100, default: 0 })

        const managed = pm.getManagedParams()
        const deletedNames = managed.deleted.map(p => p.name)
        expect(deletedNames).toContain('BBB')
        expect(deletedNames).not.toContain('AAA')
    })

    it('never deletes UI-authored (non-programmatic) params', () =>
    {
        const uiParam: ScriptParamData = {
            name: 'MANUAL', type: 'number',
            schema: { type: 'number', minimum: 0, maximum: 100, multipleOf: 1, default: 0 },
        } as ScriptParamData

        const pm = new ParamManager([uiParam])
        // script defines nothing this run
        const managed = pm.getManagedParams()
        expect(managed.deleted.map(p => p.name)).not.toContain('MANUAL')
    })

    it('reports a freshly defined param as new', () =>
    {
        const pm = new ParamManager()
        pm.define('FRESH', 'number', { min: 0, max: 10, default: 1 })
        const managed = pm.getManagedParams()
        expect(managed.new.map(p => p.name)).toContain('FRESH')
    })
})

// ── defineObject() + the `of:` alias ─────────────────────────────────────────

describe('ParamManager.defineObject()', () =>
{
    const OPENING = {
        wall:   ['left', 'right', 'front', 'back'],
        left:   { type: 'number', min: 0, max: 20000, step: 10, default: 1000, units: 'mm' },
        width:  { type: 'number', min: 100, max: 5000, step: 10, default: 1200 },
        name:   'text',
    }

    it('registers a type and inlines it into a list param via of:', () =>
    {
        const pm = new ParamManager()
        pm.defineObject('Opening', OPENING)
        pm.define('openings', 'list', { of: 'Opening', default: [{ wall: 'front', left: 500, width: 900, name: 'a' }] })

        const p = pm.getParamsMap()['OPENINGS']
        const schema = p.schema as any

        expect(schema.type).toBe('array')
        // Inlined, not referenced: the app has to validate with no ParamManager around.
        expect(schema.items.type).toBe('object')
        expect(schema.items.title).toBe('Opening')
        expect(schema.items.properties.left.maximum).toBe(20000)
        expect(schema.items.properties.wall.enum).toEqual(['left', 'right', 'front', 'back'])
        expect(p.validateValue(p.default)).toBe(true)
    })

    it('gives each param its own copy, so one cannot mutate the other', () =>
    {
        const pm = new ParamManager()
        pm.defineObject('Opening', OPENING)
        pm.define('alpha', 'list', { of: 'Opening' })
        pm.define('beta',  'list', { of: 'Opening' })

        const a = pm.getParamsMap()['ALPHA'].schema as any
        const b = pm.getParamsMap()['BETA'].schema as any

        a.items.properties.left.maximum = 1
        expect(b.items.properties.left.maximum).toBe(20000)
        expect((pm.getDefinedObjects()['Opening'] as any).properties.left.maximum).toBe(20000)
    })

    it('throws on an unknown type, naming what IS defined', () =>
    {
        const pm = new ParamManager()
        pm.defineObject('Opening', OPENING)
        expect(() => pm.define('holes', 'list', { of: 'Hole' })).toThrow(/Opening/)
    })

    it('accepts an inline properties map without registering a type', () =>
    {
        const pm = new ParamManager()
        pm.define('points', 'list', { of: { x: 'number', y: 'number' } })
        expect((pm.getParamsMap()['POINTS'].schema as any).items.properties.x.type).toBe('number')
    })

    it('still accepts a raw items schema (back-compat)', () =>
    {
        const pm = new ParamManager()
        pm.define('points', 'list', { items: { type: 'object', properties: { x: { type: 'number' } } } })
        expect((pm.getParamsMap()['POINTS'].schema as any).items.properties.x.type).toBe('number')
    })

    it('rejects a seeded default that does not fit, pointing at the entry', () =>
    {
        const pm = new ParamManager()
        pm.defineObject('Opening', OPENING)

        expect(() => pm.define('openings', 'list', {
            of: 'Opening',
            default: [
                { wall: 'front', left: 500,  width: 900 },
                { wall: 'ceiling', left: 500, width: 900 }, // not an allowed wall
            ],
        })).toThrow(/entry 1/)
    })

    it('builds an object param, defaulting to a fully populated value', () =>
    {
        const pm = new ParamManager()
        pm.defineObject('Opening', OPENING)
        pm.define('main', 'object', { of: 'Opening' })

        const p = pm.getParamsMap()['MAIN']
        expect(p.default).toEqual({ wall: 'left', left: 1000, width: 1200, name: '' })
        expect(p.validateValue(p.default)).toBe(true)
    })

    it('keeps a user-edited list across a re-definition', () =>
    {
        const edited = [{ wall: 'back', left: 20, width: 300, name: 'edited' }]

        const pm = new ParamManager([{
            name: 'OPENINGS', type: 'list',
            schema: {
                type: 'array',
                items: ParamManager.buildObjectSchema('Opening', OPENING),
                default: [],
            },
            _value: edited, _definedProgrammatically: true,
        } as unknown as ScriptParamData])

        pm.defineObject('Opening', OPENING)
        pm.define('openings', 'list', { of: 'Opening', default: [{ wall: 'front', left: 10, width: 200 }] })

        expect(pm.getParamsMap()['OPENINGS']._value).toEqual(edited)
    })
})
