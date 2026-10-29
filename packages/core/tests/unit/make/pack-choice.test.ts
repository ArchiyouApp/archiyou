import { describe, it, expect, beforeAll, vi } from 'vitest'

import { loadBinPackerModule, loadPack3dModule } from '../../../src/modeler/Make'
import { Modeler } from '../../../src/modeler/Modeler'
import { dimensionOf, vote } from '../../../src/modeler/packChoice'

describe('make.pack: 2D or 3D, by the shapes', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        await Promise.all([loadBinPackerModule(), loadPack3dModule()])
        modeler = new Modeler()
        await modeler.load()
    })

    const board = (name: string) => modeler.box(800, 400, 18).name(name)
    const carton = (name: string) => modeler.box(400, 300, 250).name(name)
    const BINS = { bins: [{ name: 'pallet', length: 1200, width: 800, height: 1800 }] }

    const warnings = () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        return { warn, text: () => warn.mock.calls.flat().join('\n'), done: () => warn.mockRestore() }
    }
    const kind = (result: any): '2d' | '3d' => (result.getGroup('bin1') ? '3d' : '2d')

    it('lets every shape vote: curves and plates are flat, other solids are 3D', () =>
    {
        expect(dimensionOf(modeler.rect(400, 300))).toBe('2d')
        expect(dimensionOf(board('board'))).toBe('2d')
        expect(dimensionOf(carton('carton'))).toBe('3d')
        // a plate is at most a tenth as thick as it is wide
        expect(dimensionOf(modeler.box(100, 100, 10))).toBe('2d')
        expect(dimensionOf(modeler.box(100, 100, 11))).toBe('3d')
        const { flat, solid, dimension } = vote([board('a'), carton('b'), carton('c'), modeler.rect(10, 10)])
        expect({ flat, solid, dimension }).toEqual({ flat: [0, 3], solid: [1, 2], dimension: '2d' })
    })

    it('nests boards onto sheets without a word, with the default sheet', () =>
    {
        const w = warnings()
        const result = modeler.make.pack(modeler.collection(board('a'), board('b'), board('c')))
        expect(kind(result)).toBe('2d')
        expect(result.getGroup('sheet1')).toBeDefined()
        expect(w.text()).toBe('')
        w.done()
    })

    it('loads cartons into bins without a word', () =>
    {
        const w = warnings()
        const result = modeler.make.pack(modeler.collection(carton('a'), carton('b'), carton('c')), BINS)
        expect(kind(result)).toBe('3d')
        expect((modeler as any).stats.bins[0].items).toBe(3)
        expect(w.text()).toBe('')
        w.done()
    })

    it('takes the majority of a mix, and says so with the counts', () =>
    {
        const w = warnings()
        const threeD = modeler.make.pack(modeler.collection(board('a'), carton('b'), carton('c'), carton('d')), BINS)
        expect(kind(threeD)).toBe('3d')
        expect(w.text()).toMatch(/mixed: 1 flat.*and 3 solid.*Packing in 3D, into bins.*make\.pack2d\(\) or make\.pack3d\(\)/)
        expect((modeler as any).stats.bins[0].items).toBe(4) // a plate is loaded as a box
        w.warn.mockClear()

        const twoD = modeler.make.pack(modeler.collection(board('a'), board('b'), board('c'), carton('d')), { width: 2440, height: 1220 })
        expect(kind(twoD)).toBe('2d')
        expect(w.text()).toMatch(/mixed: 3 flat.*and 1 solid.*Packing in 2D, onto sheets.*1 solid\(s\) are laid flat/)
        w.done()
    })

    it('goes to 2D on a tie', () =>
    {
        const w = warnings()
        expect(kind(modeler.make.pack(modeler.collection(board('a'), carton('b'))))).toBe('2d')
        expect(w.text()).toMatch(/mixed: 1 flat.*and 1 solid.*Packing in 2D/)
        w.done()
    })

    it('leaves out the curves when the solids win, and reports them as not loaded', () =>
    {
        const w = warnings()
        const result = modeler.make.pack(modeler.collection(modeler.rect(300, 200), carton('b'), carton('c'), carton('d')), BINS)
        expect(kind(result)).toBe('3d')
        expect(w.text()).toMatch(/1 curve\(s\) and polygon\(s\) cannot be loaded and are left out/)
        expect((modeler as any).stats.bins[0].items).toBe(3)
        expect((modeler as any).stats.unplaced).toEqual([0])
        w.done()
    })

    it('asks for bins when the solids win and none were given, and says how to nest them instead', () =>
    {
        expect(() => modeler.make.pack(modeler.collection(carton('a'), carton('b')))).toThrow(/no bins were given.*make\.pack2d\(\)/)
    })

    it('ignores bins, with a warning, when the shapes are flat', () =>
    {
        const w = warnings()
        expect(kind(modeler.make.pack(modeler.collection(board('a'), board('b')), BINS))).toBe('2d')
        expect(w.text()).toMatch(/packed onto sheets and the bins are ignored.*make\.pack3d\(\)/)
        w.done()
    })

    it('still lets you choose with pack2d and pack3d', () =>
    {
        const w = warnings()
        expect(kind(modeler.make.pack2d(modeler.collection(carton('a'), carton('b')), { width: 2440, height: 1220 }))).toBe('2d')
        expect(kind(modeler.make.pack3d(modeler.collection(board('a'), board('b')), BINS))).toBe('3d')
        w.done()
    })
})
