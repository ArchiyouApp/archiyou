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
