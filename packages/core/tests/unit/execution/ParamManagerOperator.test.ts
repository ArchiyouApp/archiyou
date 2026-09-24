import { describe, it, expect } from 'vitest'

import { ParamManager } from '../../../src/execution/ParamManager'
import type { ScriptParamData } from '../../../src/execution/types'

/** A ParamManager holding one param, as the Runner builds it each run. */
function managerWith(data: Partial<ScriptParamData>): ParamManager
{
    return new ParamManager([data as ScriptParamData])
}

const NUMBER_PARAM: Partial<ScriptParamData> = {
    name: 'WIDTH', type: 'number' as any,
    schema: { type: 'number', minimum: 0, maximum: 200, multipleOf: 1, default: 100 },
}

const OPENING_LIST: Partial<ScriptParamData> = {
    name: 'OPENINGS', type: 'list' as any,
    schema: {
        type: 'array',
        items: ParamManager.buildObjectSchema('Opening', {
            width: { type: 'number', min: 100, max: 5000, default: 1200 },
            name:  'text',
        }),
        default: [],
    },
}

// ── set() ────────────────────────────────────────────────────────────────────

describe('ParamManagerOperator.set()', () =>
{
    it('sets a valid value', () =>
    {
        // Regression: targetParam used to be built with an object spread, which drops
        // the ScriptParam prototype — so validateValue() was undefined and this threw
        // "validateValue is not a function" for every param.
        const pm = managerWith(NUMBER_PARAM)
        pm.getParamController('WIDTH').set(150)

        expect(pm.getParamsMap()['WIDTH']._value).toBe(150)
    })

    it('rejects a value outside the schema', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        expect(() => pm.getParamController('WIDTH').set(999)).toThrow()
    })

    it('does not mark the param as operated', () =>
    {
        // set() must NOT setOperation('updated'): the app stamps everything in
        // new/updated as _definedProgrammatically, which would permanently lock a
        // UI-authored param's definition in the menu.
        const pm = managerWith(NUMBER_PARAM)
        pm.getParamController('WIDTH').set(150)

        const managed = pm.getManagedParams()
        expect(managed.new).toHaveLength(0)
        expect(managed.updated).toHaveLength(0)
    })

    it('leaves the original param untouched', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        const controller = pm.getParamController('WIDTH')
        controller.set(150)

        expect(controller.originalParam._value).toBeUndefined()
    })

    it('reports the value back through managedValues, re-running by default', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        pm.getParamController('WIDTH').set(150)

        expect(pm.getManagedValues()).toEqual({ WIDTH: { value: 150, rerun: true } })
    })

    it('carries rerun: false', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        pm.getParamController('WIDTH').set(150, { rerun: false })

        expect(pm.getManagedValues()['WIDTH'].rerun).toBe(false)
    })

    it('reports nothing when the value ends where the run started', () =>
    {
        // The default (100) is the value in effect when nothing was set yet
        const pm = managerWith(NUMBER_PARAM)
        const c = pm.getParamController('WIDTH')
        c.set(100)
        expect(pm.getManagedValues()).toEqual({})

        c.set(150)
        c.set(100) // and back
        expect(pm.getManagedValues()).toEqual({})
    })

    it('updates $NAME in the scope, so code after the set() sees the new value', () =>
    {
        const scope: Record<string, any> = {}
        const pm = managerWith(NUMBER_PARAM).setParent(scope)
        expect(scope['$WIDTH']).toBe(100)

        pm.getParamController('WIDTH').set(150)
        expect(scope['$WIDTH']).toBe(150)
    })

    it('does not report a rejected value', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        expect(() => pm.getParamController('WIDTH').set(999)).toThrow()
        expect(pm.getManagedValues()).toEqual({})
    })

    it('survives a re-definition later in the same run', () =>
    {
        const pm = managerWith({ ...NUMBER_PARAM, _definedProgrammatically: true })
        pm.getParamController('WIDTH').set(150)
        pm.define('WIDTH', 'number' as any, { min: 0, max: 300, default: 100 }) // a changed definition

        expect(pm.getManagedValues()['WIDTH'].value).toBe(150)
    })
})

// ── push() ───────────────────────────────────────────────────────────────────

describe('ParamManagerOperator.push()', () =>
{
    it('pushes onto a param whose value was never set', () =>
    {
        // Regression: the duplicate-check indexed _value before it was normalized to
        // an array, so the very first push threw.
        const pm = managerWith(OPENING_LIST)
        pm.getParamController('OPENINGS').push({ width: 900, name: 'door' })

        expect(pm.getParamsMap()['OPENINGS']._value).toEqual([{ width: 900, name: 'door' }])
    })

    it('reports the list back through managedValues, not as a definition', () =>
    {
        // Through managedParams it would get _definedProgrammatically in the app, which
        // locks a param the user made in the menu
        const pm = managerWith(OPENING_LIST)
        pm.getParamController('OPENINGS').push({ width: 900, name: 'door' })

        expect(pm.getManagedValues()['OPENINGS']).toEqual({ value: [{ width: 900, name: 'door' }], rerun: true })
        expect(pm.getManagedParams().updated).toHaveLength(0)
    })

    it('carries rerun: false', () =>
    {
        const pm = managerWith(OPENING_LIST)
        pm.getParamController('OPENINGS').push({ width: 900 }, { rerun: false })

        expect(pm.getManagedValues()['OPENINGS'].rerun).toBe(false)
    })

    it('pushes onto a value set earlier in the same run', () =>
    {
        const pm = managerWith(OPENING_LIST)
        const c = pm.getParamController('OPENINGS')
        c.set([{ width: 900, name: 'door' }])
        c.push({ width: 1200 })

        expect(pm.getManagedValues()['OPENINGS'].value).toEqual([{ width: 900, name: 'door' }, { width: 1200 }])
    })

    it('pushes onto the default of an untouched list', () =>
    {
        const pm = managerWith({ ...OPENING_LIST, schema: { ...OPENING_LIST.schema, default: [{ width: 600 }] } })
        pm.getParamController('OPENINGS').push({ width: 900 })

        expect(pm.getParamsMap()['OPENINGS']._value).toEqual([{ width: 600 }, { width: 900 }])
    })

    it('appends in order and accepts a partial entry', () =>
    {
        // No `required` on the object schema, so a partial entry is legal — the form
        // renders the missing key from the property's own default.
        const pm = managerWith(OPENING_LIST)
        const c = pm.getParamController('OPENINGS')
        c.push({ width: 900, name: 'door' })
        c.push({ width: 1200 })

        expect(pm.getParamsMap()['OPENINGS']._value).toEqual([{ width: 900, name: 'door' }, { width: 1200 }])
    })

    it('rejects an entry that does not match the item schema', () =>
    {
        const pm = managerWith(OPENING_LIST)
        expect(() => pm.getParamController('OPENINGS').push({ width: 10 })).toThrow() // below minimum
    })

    it('refuses to push into a non-array param', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        expect(() => pm.getParamController('WIDTH').push(1)).toThrow(/not an array/)
    })

    it('blocks an immediate duplicate of the last entry', () =>
    {
        const pm = managerWith(OPENING_LIST)
        const c = pm.getParamController('OPENINGS')
        c.push({ width: 900, name: 'door' })
        c.push({ width: 900, name: 'door' })

        expect(pm.getParamsMap()['OPENINGS']._value).toHaveLength(1)
    })
})

// ── error messages ───────────────────────────────────────────────────────────

describe('ParamManagerOperator — what a rejected value says', () =>
{
    const OPENINGS_TYPED: Partial<ScriptParamData> = {
        name: 'OPENINGS', type: 'list' as any,
        schema: {
            type: 'array',
            items: ParamManager.buildObjectSchema('Opening', {
                name:  'text',
                wall:  ['front', 'right', 'back', 'left'],
                left:  { type: 'number', min: 0, max: 12000, step: 10, default: 1000 },
                sill:  { type: 'number', min: 0, max: 3000,  step: 10, default: 900 },
                width: { type: 'number', min: 300, max: 3000, step: 10, default: 1200 },
            }),
            default: [],
        },
    }

    it('names every entry, property and value that does not fit, and the rule it breaks', () =>
    {
        const pm = managerWith(OPENINGS_TYPED)
        const value = [
            { name: 'door', wall: 'front', left: 1500, sill: 0, width: 1000 },
            { name: 'windowleft1', wall: 'left', left: -200, sill: 3500, width: 800 },
            { name: 'odd', wall: 'up', left: 1234.5, sill: 0, width: 800 },
        ]
        let message = ''
        try { pm.getParamController('OPENINGS').set(value) } catch (e) { message = (e as Error).message }

        expect(message).toContain('$PARAMS.OPENINGS.set(): the value does not fit its definition (a list of "Opening")')
        expect(message).toContain('entry 1 ("windowleft1"): left is -200 — must be >= 0')
        expect(message).toContain('entry 1 ("windowleft1"): sill is 3500 — must be <= 3000')
        expect(message).toContain('entry 2 ("odd"): wall is "up" — must be one of "front", "right", "back", "left"')
        expect(message).toContain('entry 2 ("odd"): left is 1234.5 — must be a multiple of 10')
        expect(message).not.toContain('entry 0')
    })

    it('says what is wrong with a plain value', () =>
    {
        const pm = managerWith(NUMBER_PARAM)
        expect(() => pm.getParamController('WIDTH').set(999)).toThrow(/\$PARAMS\.WIDTH\.set\(\):[\s\S]*the value is 999 — must be <= 200/)
    })

    it('says what is wrong with a pushed entry', () =>
    {
        const pm = managerWith(OPENINGS_TYPED)
        expect(() => pm.getParamController('OPENINGS').push({ name: 'tiny', width: 10 }))
            .toThrow(/\$PARAMS\.OPENINGS\.push\(\): the entry does not fit the "Opening" type:[\s\S]*width is 10 — must be >= 300/)
    })

    it('keeps a long list of problems short', () =>
    {
        const pm = managerWith(OPENINGS_TYPED)
        const value = Array.from({ length: 8 }, (_, i) => ({ name: `w${i}`, wall: 'left', left: -10, sill: 0, width: 800 }))
        let message = ''
        try { pm.getParamController('OPENINGS').set(value) } catch (e) { message = (e as Error).message }
        expect(message.split('; ').length).toBe(6)
        expect(message).toContain('…and 3 more')
        expect(message).not.toContain('\n') // one line: the editor's error header shows a single line
    })
})

