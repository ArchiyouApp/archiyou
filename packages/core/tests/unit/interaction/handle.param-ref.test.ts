import { describe, it, expect, beforeEach } from 'vitest'
import { Interactor } from '../../../src/interaction/Interactor'
import { Handle } from '../../../src/interaction/Handle'
import type { ManagedHandleOp } from '../../../src/interaction/types'

/** Minimal ArchiyouModules stand-in: param() only reaches for the interactor (to validate
 *  param names) and the console (to report). */
function modulesFor(interactor: Interactor, errors: string[] = [])
{
    return { interactor, console: { error: (m: string) => errors.push(m) } } as any
}

const opById = (ops: ManagedHandleOp[], id: string) => ops.find(o => o.id === id)

describe('Handle.param() — indexed refs and axis maps', () =>
{
    let interactor: Interactor
    let errors: string[]

    beforeEach(() =>
    {
        interactor = new Interactor()
        errors = []
        interactor.setArchiyou(modulesFor(interactor, errors))
        interactor.beginRun('script-a', ['OPENINGS', 'WIDTH'])
    })

    it('parses a plain name and an indexed ref', () =>
    {
        expect(Handle.parseParamRef('WIDTH')).toEqual({ name: 'WIDTH', index: null })
        expect(Handle.parseParamRef('OPENINGS[2]')).toEqual({ name: 'OPENINGS', index: 2 })
        expect(Handle.parseParamRef(' OPENINGS[ 12 ] ')).toEqual({ name: 'OPENINGS', index: 12 })
    })

    it('defaults the handle id to the whole ref', () =>
    {
        const h = interactor.addHandle().param('OPENINGS[2]', { u: 'left' })
        expect(h.toData().id).toBe('OPENINGS[2]')
    })

    it('keeps an explicit name() over the default id', () =>
    {
        const h = interactor.addHandle().name('door').param('OPENINGS[2]', { u: 'left' })
        expect(h.toData().id).toBe('door')
    })

    it('serializes the ref and the map into toData()', () =>
    {
        const data = interactor.addHandle().param('OPENINGS[1]', { u: 'left', v: 'sill' }).toData()
        expect(data.param).toBe('OPENINGS[1]')
        expect(data.paramMap).toEqual({ u: 'left', v: 'sill' })
        expect(data.paramFnSrc).toBeNull()
    })

    it('carries a map function as source, with no map', () =>
    {
        const data = interactor.addHandle()
            .param('OPENINGS[0]', (h: any, e: any) => { e.left = h.u })
            .toData()
        expect(data.paramMap).toBeNull()
        expect(data.paramFnSrc).toContain('e.left = h.u')
    })

    it('accepts a concise arrow, which the viewer applies by its return value', () =>
    {
        const data = interactor.addHandle()
            .param('OPENINGS[0]', (h: any, e: any) => ({ ...e, left: h.u }))
            .toData()
        expect(data.paramFnSrc).toContain('left: h.u')
    })

    it('leaves a plain scalar binding exactly as it was (autoMap)', () =>
    {
        const data = interactor.addHandle().param('WIDTH').toData()
        expect(data.param).toBe('WIDTH')
        expect(data.paramMap).toBeNull()
        expect(data.paramFnSrc).toBeNull()
    })

    it('is null on a handle that never called param()', () =>
    {
        expect(interactor.addHandle().name('plain').toData().paramMap).toBeNull()
    })

    it('throws on an unknown param, naming the known ones', () =>
    {
        expect(() => interactor.addHandle().param('OPENINGZ[0]', { u: 'left' }))
            .toThrow(/unknown param "OPENINGZ".*"OPENINGS".*"WIDTH"/s)
    })

    it('validates the NAME of an indexed ref, not the whole reference', () =>
    {
        expect(() => interactor.addHandle().param('OPENINGS[3]', { u: 'left' })).not.toThrow()
    })

    it('copies the map, so a later edit of the caller object does not leak in', () =>
    {
        const map: any = { u: 'left' }
        const h = interactor.addHandle().param('OPENINGS[0]', map)
        map.v = 'sill'
        expect(h.toData().paramMap).toEqual({ u: 'left' })
    })
})

describe('Interactor: relative range vs world axes', () =>
{
    let interactor: Interactor
    let errors: string[]

    beforeEach(() =>
    {
        interactor = new Interactor()
        errors = []
        interactor.setArchiyou(modulesFor(interactor, errors))
        interactor.beginRun('script-a', ['OPENINGS'])
    })

    it('drops world axes from a relative map and explains why', () =>
    {
        interactor.addHandle()
            .param('OPENINGS[0]', { x: 'left', v: 'sill' })
            .along('xz')
            .range('-100', '+100')

        const ops = interactor.getManagedHandlesData()
        expect(opById(ops, 'OPENINGS[0]')?.data?.paramMap).toEqual({ v: 'sill' })
        expect(errors.join('\n')).toMatch(/relative range.*"x: 'left'"/)
    })

    it('leaves world axes alone under an absolute range', () =>
    {
        interactor.addHandle()
            .param('OPENINGS[0]', { x: 'left', z: 'sill' })
            .along('xz')
            .range([0, 0], [4000, 2500])

        const ops = interactor.getManagedHandlesData()
        expect(opById(ops, 'OPENINGS[0]')?.data?.paramMap).toEqual({ x: 'left', z: 'sill' })
        expect(errors).toEqual([])
    })
})

describe('Interactor: indexed param handles across re-runs', () =>
{
    let interactor: Interactor

    /** Declare one handle per entry, exactly as timberwallopenings.js does. */
    const declare = (openings: Array<{ left: number; sill: number }>) =>
        openings.forEach((o, i) =>
            interactor.addHandle()
                .param(`OPENINGS[${i}]`, { u: 'left', v: 'sill' })
                .at([o.left, 0, o.sill])
                .along('xz')
                .range(['-100', '-100'], ['+100', '+100']))

    beforeEach(() =>
    {
        interactor = new Interactor()
        interactor.setArchiyou(modulesFor(interactor))
    })

    it('adds one handle per entry on the first run', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        declare([{ left: 600, sill: 900 }, { left: 2400, sill: 0 }])
        const ops = interactor.getManagedHandlesData()

        expect(ops.map(o => [o.id, o._operation])).toEqual([
            ['OPENINGS[0]', 'add'],
            ['OPENINGS[1]', 'add'],
        ])
        expect(opById(ops, 'OPENINGS[1]')?.data?.position).toEqual([2400, 0, 0])
    })

    it('emits only a position update when an entry moves', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        declare([{ left: 600, sill: 900 }])
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        declare([{ left: 1230, sill: 900 }])
        const ops = interactor.getManagedHandlesData()

        expect(ops).toEqual([
            { id: 'OPENINGS[0]', _operation: 'update', position: [1230, 0, 900] },
        ])
    })

    it('deletes the trailing handle when an entry is removed, and moves the survivor', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        declare([{ left: 600, sill: 900 }, { left: 2400, sill: 0 }])
        interactor.getManagedHandlesData()

        // The user deletes entry 0; entry 1 becomes entry 0.
        interactor.beginRun('script-a', ['OPENINGS'])
        declare([{ left: 2400, sill: 0 }])
        const ops = interactor.getManagedHandlesData()

        expect(opById(ops, 'OPENINGS[0]')).toEqual({
            id: 'OPENINGS[0]', _operation: 'update', position: [2400, 0, 0],
        })
        expect(opById(ops, 'OPENINGS[1]')?._operation).toBe('delete')
    })

    it('re-adds when the binding itself changes under a stable handle name', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[0]', { u: 'left' }).at([0, 0, 0])
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[1]', { u: 'left' }).at([0, 0, 0])
        const ops = interactor.getManagedHandlesData()

        expect(opById(ops, 'door')?._operation).toBe('add')
        expect(opById(ops, 'door')?.data?.param).toBe('OPENINGS[1]')
    })

    it('emits nothing on a quiet re-exec, so a dragged handle stays put', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[0]', { u: 'left' }).start([0, 0, 0])
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[0]', { u: 'left' }).start([0, 0, 0])
        expect(interactor.getManagedHandlesData()).toEqual([])
    })
})
