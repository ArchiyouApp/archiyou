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

    it('reports the param back to the app', () =>
    {
        const pm = managerWith(OPENING_LIST)
        pm.getParamController('OPENINGS').push({ width: 900, name: 'door' })

        const updated = pm.getManagedParams().updated
        expect(updated.map(p => p.name)).toContain('OPENINGS')
        expect(updated.find(p => p.name === 'OPENINGS')!._value).toHaveLength(1)
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
