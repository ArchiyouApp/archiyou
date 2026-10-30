import { beforeAll, describe, expect, test, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { loadPack3dModule } from '../../../src/modeler/Make'

describe('Layouter.packed', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        await loadPack3dModule()
        modeler = new Modeler()
        await modeler.load()
    })

    /** Four identical legs, two identical rails, a board and a loose curve. */
    const build = () =>
    {
        modeler.reset()
        const legs = [0, 1, 2, 3].map(i => modeler.box(89, 38, 800).move(i * 200).name('leg'))
        const rails = [0, 1].map(i => modeler.box(900, 89, 38).move(0, 300 + i * 200).name('rail'))
        const board = modeler.box(1000, 600, 18).move(0, 800).name('board')
        const curve = modeler.line([0, 0, 0], [100, 0, 0])
        return { legs, rails, board, curve }
    }

    const boxOf = (shape: any) =>
    {
        const b = shape.bbox()
        return { min: [b.minX(), b.minY(), b.minZ()], max: [b.maxX(), b.maxY(), b.maxZ()] }
    }
    const overlap = (a: any, b: any) => [0, 1, 2].every(k => a.min[k] < b.max[k] - 1e-6 && b.min[k] < a.max[k] - 1e-6)

    test('piles the pieces of a part and keeps the piles apart, inside the bin', () =>
    {
        const { legs, rails, board } = build()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        modeler.layouter().packed({ length: 2400, width: 1200, height: 1200 }).apply()
        warn.mockRestore()

        const boxes = [...legs, ...rails, board].map(boxOf)
        boxes.forEach(box => [0, 1, 2].forEach(k => expect(box.min[k]).toBeGreaterThanOrEqual(-1e-6)))
        boxes.forEach(box => expect([box.max[0], box.max[1], box.max[2]].every((v, k) => v <= [2400, 1200, 1200][k] + 1e-6)).toBe(true))

        // the four legs lie flat, longest side along x or y, and stand on each other in one pile
        const legBoxes = legs.map(boxOf)
        legBoxes.forEach(box => expect(box.max[2] - box.min[2]).toBeCloseTo(38, 3))
        const footprints = new Set(legBoxes.map(b => [b.min[0], b.min[1]].map(Math.round).join()))
        expect(footprints.size).toBe(1)
        expect(legBoxes.map(b => Math.round(b.min[2])).sort((a, b) => a - b)).toEqual([0, 38, 76, 114])

        // different parts never overlap
        const parts = [legBoxes, rails.map(boxOf), [boxOf(board)]]
        parts.forEach((a, i) => parts.slice(i + 1).forEach(b => a.forEach(p => b.forEach(q => expect(overlap(p, q)).toBe(false)))))
    })

    test('says what it leaves out: curves are not parts', () =>
    {
        const { curve } = build()
        const before = boxOf(curve)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        modeler.layouter().packed().apply()
        const text = warn.mock.calls.flat().join('\n')
        warn.mockRestore()
        expect(text).toMatch(/Layouter::packed\(\): 1 shape is not packed/)
        expect(boxOf(curve)).toEqual(before)
    })

    test('uses more bins side by side when one is not enough', () =>
    {
        const { board, rails } = build()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        // a bin that holds one pile at a time
        modeler.layouter().packed({ length: 1000, width: 600, height: 40, spacing: 0, support: 1 }).apply()
        warn.mockRestore()
        const xs = [board, ...rails].map(s => boxOf(s).min[0])
        expect(Math.max(...xs)).toBeGreaterThan(1000)
    })

    test('a pile higher than the bin is split', () =>
    {
        const { legs } = build()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        modeler.layouter().packed({ length: 2400, width: 1200, height: 80 }).apply()
        warn.mockRestore()
        const tops = legs.map(s => boxOf(s).max[2])
        expect(Math.max(...tops)).toBeLessThanOrEqual(80 + 1e-6)
    })
})
