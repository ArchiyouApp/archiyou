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

describe('Handle.param() — indexed refs and map functions', () =>
{
    let interactor: Interactor
    let errors: string[]
    const moveLeft = (param: any, handle: any) => { param.left += handle.du }

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
        const h = interactor.addHandle().param('OPENINGS[2]', moveLeft)
        expect(h.toData().id).toBe('OPENINGS[2]')
    })

    it('keeps an explicit name() over the default id', () =>
    {
        const h = interactor.addHandle().name('door').param('OPENINGS[2]', moveLeft)
        expect(h.toData().id).toBe('door')
    })

    it('carries the ref and the map function as source', () =>
    {
        const data = interactor.addHandle()
            .param('OPENINGS[1]', (param: any, handle: any) => { param.left += handle.du; param.sill += handle.dv })
            .toData()
        expect(data.param).toBe('OPENINGS[1]')
        expect(data.paramFnSrc).toContain('param.left += handle.du')
    })

    it('accepts a concise arrow, which the viewer applies by its return value', () =>
    {
        const data = interactor.addHandle()
            .param('OPENINGS[0]', (param: any, handle: any) => ({ ...param, left: handle.u }))
            .toData()
        expect(data.paramFnSrc).toContain('left: handle.u')
    })

    it('leaves a plain scalar binding without a function (autoMap)', () =>
    {
        const data = interactor.addHandle().param('WIDTH').toData()
        expect(data.param).toBe('WIDTH')
        expect(data.paramFnSrc).toBeNull()
    })

    it('rejects a map object, pointing to the function form', () =>
    {
        expect(() => interactor.addHandle().param('OPENINGS[0]', { du: 'left' } as any))
            .toThrow(/must be a function.*param\.left \+= handle\.du.*"du":"left"/)
        expect(errors.length).toBe(1)
    })

    it('throws on an unknown param, naming the known ones', () =>
    {
        expect(() => interactor.addHandle().param('OPENINGZ[0]', moveLeft))
            .toThrow(/unknown param "OPENINGZ".*"OPENINGS".*"WIDTH"/s)
    })

    it('validates the NAME of an indexed ref, not the whole reference', () =>
    {
        expect(() => interactor.addHandle().param('OPENINGS[3]', moveLeft)).not.toThrow()
    })
})

describe('Interactor: indexed param handles across re-runs', () =>
{
    let interactor: Interactor

    /** Declare one handle per entry, exactly as timberwallopenings.js does. */
    const declare = (openings: Array<{ left: number; sill: number }>) =>
        openings.forEach((o, i) =>
            interactor.addHandle()
                .param(`OPENINGS[${i}]`, (param: any, handle: any) => { param.left += handle.du; param.sill += handle.dv })
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
        interactor.addHandle().name('door').param('OPENINGS[0]', (param: any, handle: any) => { param.left += handle.du }).at([0, 0, 0])
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[1]', (param: any, handle: any) => { param.left += handle.du }).at([0, 0, 0])
        const ops = interactor.getManagedHandlesData()

        expect(opById(ops, 'door')?._operation).toBe('add')
        expect(opById(ops, 'door')?.data?.param).toBe('OPENINGS[1]')
    })

    it('emits nothing on a quiet re-exec, so a dragged handle stays put', () =>
    {
        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[0]', (param: any, handle: any) => { param.left += handle.du }).start([0, 0, 0])
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        interactor.addHandle().name('door').param('OPENINGS[0]', (param: any, handle: any) => { param.left += handle.du }).start([0, 0, 0])
        expect(interactor.getManagedHandlesData()).toEqual([])
    })
})

describe('Handle placement and range checks', () =>
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

    it('takes flat coordinates as well as an array', () =>
    {
        expect(interactor.addHandle().at(10, 20, 30).toData().position).toEqual([10, 20, 30])
        expect(interactor.addHandle().at([10, 20, 30]).toData().position).toEqual([10, 20, 30])
        expect(interactor.addHandle().start(5, 6).toData().position).toEqual([5, 6, 0])
        expect(interactor.addHandle().position(1, 2, 3).toData().position).toEqual([1, 2, 3])
    })

    it('accepts number and relative string bounds', () =>
    {
        expect(() => interactor.addHandle().along('x').range(0, 4000)).not.toThrow()
        expect(() => interactor.addHandle().along('xz').range(['-100', '-0'], ['+200', '+300'])).not.toThrow()
    })

    it('throws on a bound that is not a number, naming it as written', () =>
    {
        const left = undefined as any
        const h = () => interactor.addHandle().param('OPENINGS[0]', (param: any, handle: any) => { param.left += handle.du }).along('xz')
        expect(() => h().range([`-${left}`, '-0'], ['+100', '+100'])).toThrow(/OPENINGS\[0\].*range\(\).*'-undefined'/)
        expect(() => h().range(0, NaN)).toThrow(/max NaN/)
        expect(() => h().range(null as any, 100)).toThrow(/min null/)
        expect(errors.length).toBe(3) // also reported in the script console
    })
})

describe('Handle mapping functions run outside the script', () =>
{
    /*  The viewer rebuilds a mapping function from its source text, where the script's
        variables do not exist. A function using one used to fail silently on the drag;
        now it is an error while the script runs, unless the value is passed along. */
    let interactor: Interactor
    let errors: string[]

    beforeEach(() =>
    {
        interactor = new Interactor()
        errors = []
        interactor.setArchiyou(modulesFor(interactor, errors))
        interactor.beginRun('script-a', ['OPENINGS', 'WIDTH'])
    })

    it('rejects a script variable the function uses, naming it and how to pass it along', () =>
    {
        const dragDir = -1
        expect(() => interactor.addHandle().param('OPENINGS[0]', (param: any, handle: any) => { param.left += dragDir * handle.du }))
            .toThrow(/param\('OPENINGS\[0\]'\): the function uses "dragDir".*Pass it along: \.param\('OPENINGS\[0\]', fn, \{ dragDir \}\)/)
        expect(errors.length).toBe(1) // also in the script console
    })

    it('finds a name in a branch that would not run', () =>
    {
        const limit = 100
        expect(() => interactor.addHandle().param('WIDTH', (param: any, handle: any) => (handle.du > 1e9) ? limit : param + handle.du))
            .toThrow(/uses "limit"/)
    })

    it('allows the arguments, locals and JavaScript built-ins', () =>
    {
        expect(() => interactor.addHandle().param('WIDTH', (param: any, handle: any) =>
        {
            const step = 10
            return Math.round((param + handle.du) / step) * step
        })).not.toThrow()
    })

    it('carries passed values along as plain data', () =>
    {
        const dragDir = -1
        const data = interactor.addHandle()
            .param('OPENINGS[0]', (param: any, handle: any) => { param.left += dragDir * handle.du }, { dragDir })
            .toData()
        expect(data.fnVars).toEqual({ dragDir: -1 })

        // What the viewer does: rebuild the function with the values as its variables
        const fn = new Function(...Object.keys(data.fnVars!), `return (${data.paramFnSrc})`)(...Object.values(data.fnVars!))
        const entry = { left: 1000 }
        fn(entry, { du: 200 })
        expect(entry.left).toBe(800)
    })

    it('rejects a passed value that cannot be sent', () =>
    {
        const shapeLike = new (class Mesh { volume() { return 1 } })()
        expect(() => interactor.addHandle().param('WIDTH', (param: any) => param + shapeLike.volume(), { shapeLike }))
            .toThrow(/"shapeLike" must hold plain data/)
    })

    it('checks params() the same way', () =>
    {
        const offset = 100
        expect(() => interactor.addHandle().params((params: any, handle: any) => { params.WIDTH = handle.u - offset }))
            .toThrow(/params\(\): the function uses "offset".*\.params\(fn, \{ offset \}\)/)
        const data = interactor.addHandle().params((params: any, handle: any) => { params.WIDTH = handle.u - offset }, { offset }).toData()
        expect(data.fnVars).toEqual({ offset: 100 })
    })

    it('sends the handle again when a passed value changes between runs', () =>
    {
        const declare = (dragDir: number) => interactor.addHandle().name('door')
            .param('OPENINGS[0]', (param: any, handle: any) => { param.left += dragDir * handle.du }, { dragDir }).start(0, 0, 0)

        declare(1)
        interactor.getManagedHandlesData()

        interactor.beginRun('script-a', ['OPENINGS'])
        declare(1)
        expect(interactor.getManagedHandlesData()).toEqual([])

        interactor.beginRun('script-a', ['OPENINGS'])
        declare(-1)
        const ops = interactor.getManagedHandlesData()
        expect(opById(ops, 'door')?.data?.fnVars).toEqual({ dragDir: -1 })
    })
})
