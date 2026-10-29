import { describe, it, expect, beforeAll, vi } from 'vitest'

import { loadPack3dModule } from '../../../src/modeler/Make'
import { Modeler } from '../../../src/modeler/Modeler'
import { fromGrams, put, toGrams, turn } from '../../../src/modeler/pack3d'

/** The planner's six orientations: orientation o puts the item's axis PERMS[o][k] along world axis k. */
const PERMS = [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]]

const extentsOf = (shape: any): [number, number, number] =>
{
    const box = shape.bbox()
    return [box.width(), box.depth(), box.height()]
}

const near = (a: number[], b: number[], tolerance = 1e-6): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance)

/** Whether two shapes share volume, by their bounding boxes. */
const overlap = (a: any, b: any): boolean =>
{
    const [p, q] = [a.bbox(), b.bbox()]
    const eps = 1e-6
    return p.minX() < q.maxX() - eps && q.minX() < p.maxX() - eps
        && p.minY() < q.maxY() - eps && q.minY() < p.maxY() - eps
        && p.minZ() < q.maxZ() - eps && q.minZ() < p.maxZ() - eps
}

describe('make.pack3d (before the planner is loaded)', () =>
{
    it('says how to get it, instead of failing somewhere inside', async () =>
    {
        const modeler = new Modeler()
        await modeler.load()
        const parts = modeler.collection(modeler.box(100, 100, 100))
        expect(() => modeler.make.pack3d(parts, { bins: [{ length: 1000, width: 1000, height: 1000 }] })).toThrow(/not loaded.*await loadPack3dModule\(\)/)
    })
})

describe('make.pack3d', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        await loadPack3dModule()
        modeler = new Modeler()
        await modeler.load()
    })

    const boxes = (sizes: [number, number, number][], name = 'b') =>
        modeler.collection(...sizes.map(([x, y, z], i) => modeler.box(x, y, z).name(`${name}${i + 1}`)))

    const BIN = { name: 'pallet', length: 1200, width: 800, height: 1800 }

    /** The placed copies of every bin, by bin, without the outline of the bin. */
    const placed = (result: any): any[][] =>
        [1, 2, 3, 4, 5, 6].map(i => result.getGroup(`bin${i}`)).filter(Boolean).map((group: any) => group.toArray().filter((shape: any) => shape.type === 'Mesh'))

    const signature = (result: any): string => result.toArray().filter((s: any) => s.type === 'Mesh')
        .map((shape: any) => { const b = shape.bbox(); return [b.minX(), b.minY(), b.minZ(), b.maxX(), b.maxY(), b.maxZ()].map(v => Math.round(v * 1e6) / 1e6).join(',') }).join(' ')

    it('puts the six orientations of a box where the planner means them', () =>
    {
        // the property that ties the planner to the meshes: turned into orientation o, a box has the extents of that permutation
        const dims: [number, number, number] = [200, 300, 500]
        PERMS.forEach((perm, o) =>
        {
            const shape = modeler.box(dims[0], dims[1], dims[2])
            const original = extentsOf(shape)
            turn(shape, o)
            expect(near(extentsOf(shape), [original[perm[0]], original[perm[1]], original[perm[2]]]), `orientation ${o}`).toBe(true)
        })
    })

    it('moves a turned box so that its lowest corner is where the plan says, whatever the unit', () =>
    {
        const shape = modeler.box(200, 300, 500)
        put(shape, 3, [100, 40, 20], 5000, { mmPerUnit: 1, imperial: false })
        const box = shape.bbox()
        expect(near([box.minX(), box.minY(), box.minZ()], [5100, 40, 20])).toBe(true)
        const metres = modeler.box(0.2, 0.3, 0.5)
        put(metres, 0, [100, 40, 20], 0, { mmPerUnit: 1000, imperial: false })
        expect(near([metres.bbox().minX(), metres.bbox().minY(), metres.bbox().minZ()], [0.1, 0.04, 0.02])).toBe(true)
    })

    it('loads shapes into a bin: inside it, side by side without overlap, on the floor or on each other', () =>
    {
        const sizes: [number, number, number][] = [[400, 300, 250], [400, 300, 250], [600, 400, 300], [600, 400, 300], [300, 300, 300], [500, 200, 200], [500, 200, 200], [400, 400, 100]]
        const result = modeler.make.pack3d(boxes(sizes), { bins: [BIN], maxIterations: 0 })
        const bins = placed(result)
        expect(bins.flat().length).toBe(sizes.length)
        bins.forEach(bin =>
        {
            bin.forEach(shape =>
            {
                const b = shape.bbox()
                expect(b.minX()).toBeGreaterThanOrEqual(-1e-6 + bin.reduce((m: number, s: any) => Math.min(m, s.bbox().minX()), Infinity))
                expect(b.maxZ() - 0).toBeLessThanOrEqual(1800 + 1e-6)
            })
            bin.forEach((a, i) => bin.slice(i + 1).forEach(c => expect(overlap(a, c), 'two shapes share volume').toBe(false)))
        })
        expect((modeler as any).stats.unplaced).toEqual([])
        expect((modeler as any).stats.bins.reduce((n: number, b: any) => n + b.items, 0)).toBe(sizes.length)
    })

    it('keeps the shapes it was given where they are', () =>
    {
        const parts = boxes([[400, 300, 250], [400, 300, 250]])
        const before = parts.toArray().map(extentsOf)
        const corners = parts.toArray().map((s: any) => s.bbox().minX())
        modeler.make.pack3d(parts, { bins: [BIN], maxIterations: 0 })
        expect(parts.toArray().map(extentsOf)).toEqual(before)
        expect(parts.toArray().map((s: any) => s.bbox().minX())).toEqual(corners)
    })

    it('gives the same plan every time it is asked', () =>
    {
        const sizes: [number, number, number][] = [[500, 400, 300], [500, 400, 300], [500, 400, 300], [300, 300, 300], [300, 300, 300], [700, 200, 100], [250, 250, 250], [250, 250, 250], [250, 250, 250]]
        const plan = () => signature(modeler.make.pack3d(boxes(sizes), { bins: [{ ...BIN, length: 1000, width: 800, height: 700 }], maxIterations: 20 }))
        expect(plan()).toBe(plan())
    })

    it('searches for a plan with fewer bins, and another seed takes another way to it', () =>
    {
        // nine boxes that two bins hold without the search and one bin holds with it (the job of the planner's own tests)
        const job: [number, number, number][] = [...Array(2).fill([482, 165, 323]), ...Array(4).fill([267, 201, 257]), ...Array(3).fill([585, 468, 308])]
        const bin = { length: 1000, width: 800, height: 900 }
        const bins = (maxIterations: number, seed = 0) => placed(modeler.make.pack3d(boxes(job), { bins: [bin], maxIterations, seed })).length
        expect(bins(0)).toBe(2)
        expect(bins(200)).toBe(1)
        const plan = (seed: number) => signature(modeler.make.pack3d(boxes(job), { bins: [bin], maxIterations: 60, seed }))
        expect(plan(3)).toBe(plan(3))
        expect(new Set([0, 1, 2, 3, 4, 5].map(plan)).size).toBeGreaterThan(1)
    })

    it('turns a shape only as far as it may', () =>
    {
        // a rod 1000 x 200 x 200 into a bin 600 long and 1100 wide: it has to lie across
        const rod = () => boxes([[1000, 200, 200]])
        const bin = { length: 600, width: 1100, height: 300 }
        const fixed = modeler.make.pack3d(rod(), { bins: [bin], rotation: 'fixed' })
        expect((modeler as any).stats.unplaced).toEqual([0])
        expect(placed(fixed).flat().length).toBe(0)

        const upright = modeler.make.pack3d(rod(), { bins: [bin], rotation: 'upright' })
        const [copy] = placed(upright).flat()
        expect(near(extentsOf(copy), [200, 1000, 200])).toBe(true)
        expect((modeler as any).stats.unplaced).toEqual([])

        // a rotation function decides per shape: the first may not be turned, the second may
        const two = modeler.make.pack3d(boxes([[1000, 200, 200], [1000, 200, 200]]), { bins: [bin], rotation: (_shape: any, index: number) => index === 1 ? 'upright' : 'fixed' })
        expect(placed(two).flat().length).toBe(1)
        expect((modeler as any).stats.unplaced).toEqual([0])
    })

    it('keeps a bin under its weight limit and reports the weights in kg', () =>
    {
        const result = modeler.make.pack3d(boxes([[300, 300, 300], [300, 300, 300], [300, 300, 300]]), { bins: [{ ...BIN, maxWeight: 100 }], weight: 40, maxIterations: 0 })
        const stats = (modeler as any).stats
        expect(placed(result).map(bin => bin.length)).toEqual([2, 1])
        expect(stats.bins.map((b: any) => b.weight)).toEqual([80, 40])
        expect(stats.bins[0].fill).toBeCloseTo(2 * 300 ** 3 / (1200 * 800 * 1800), 9)
    })

    it('takes the weight of a shape from a function, by shape and index', () =>
    {
        modeler.make.pack3d(boxes([[300, 300, 300], [300, 300, 300]]), { bins: [BIN], weight: (_shape: any, index: number) => 10 * (index + 1), maxIterations: 0 })
        expect((modeler as any).stats.bins[0].weight).toBe(30)
    })

    it('does not put anything on a shape that may carry nothing', () =>
    {
        // a bin one box high is full after one box; two boxes need two bins whatever else, and a fragile one cannot be stacked under
        const parts = boxes([[400, 400, 400], [400, 400, 400]])
        const stacked = modeler.make.pack3d(parts, { bins: [{ length: 400, width: 400, height: 800 }], weight: 5, maxIterations: 0 })
        expect(placed(stacked).length).toBe(1)
        const fragile = modeler.make.pack3d(parts, { bins: [{ length: 400, width: 400, height: 800 }], weight: 5, maxLoad: 0, maxIterations: 0 })
        expect(placed(fragile).length).toBe(2)
    })

    it('unloads the earlier stop nearer the door', () =>
    {
        const bin = { length: 1200, width: 400, height: 400, door: '+x' as const }
        const parts = boxes([[400, 400, 400], [400, 400, 400], [400, 400, 400]])
        const result = modeler.make.pack3d(parts, { bins: [bin], stop: (_shape: any, index: number) => index + 1, maxIterations: 0 })
        const xs = placed(result).flat().sort((a: any, b: any) => a.name().localeCompare(b.name())).map((s: any) => s.bbox().minX())
        expect(xs).toEqual([800, 400, 0]) // b1 is unloaded first and sits next to the door
    })

    it('reports a balance that cannot be met, in the stats and as a warning', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        modeler.make.pack3d(boxes([[2000, 1000, 1000]]), {
            bins: [{ length: 2000, width: 1000, height: 1000, balance: { axles: [{ at: 0, maxLoad: 1000 }, { at: 2000, maxLoad: 1000 }] } }],
            weight: 9000, maxIterations: 0,
        })
        const bin = (modeler as any).stats.bins[0]
        expect(bin.balanceOk).toBe(false)
        expect(bin.axleLoads).toEqual([4500, 4500])
        expect(warn.mock.calls.flat().join('\n')).toMatch(/balance asked for is not met in 1 bin/)
        warn.mockRestore()
    })

    it('lists the shapes that fit nowhere and says so', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const result = modeler.make.pack3d(boxes([[300, 300, 300], [5000, 100, 100]], 'part'), { bins: [BIN], rotation: 'free', maxIterations: 0 })
        expect(placed(result).flat().length).toBe(1)
        expect((modeler as any).stats.unplaced).toEqual([1])
        expect(warn.mock.calls.flat().join('\n')).toMatch(/1 shape\(s\) could not be loaded.*part2/)
        warn.mockRestore()
    })

    it('warns when a weight limit has no weights to work with', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        modeler.make.pack3d(boxes([[300, 300, 300]]), { bins: [{ ...BIN, maxWeight: 100 }], maxIterations: 0 })
        expect(warn.mock.calls.flat().join('\n')).toMatch(/no shape has a weight/)
        warn.mockRestore()
    })

    it('works in the units of the model', async () =>
    {
        const metric = new Modeler()
        await metric.load()
        metric.units('m')
        const parts = metric.collection(metric.box(0.4, 0.3, 0.25), metric.box(0.4, 0.3, 0.25), metric.box(0.6, 0.4, 0.3))
        const result = metric.make.pack3d(parts, { bins: [{ length: 1.2, width: 0.8, height: 1.8, maxWeight: 600 }], weight: 10, maxIterations: 0 })
        const copies = result.toArray().filter((s: any) => s.type === 'Mesh')
        expect(copies.length).toBe(3)
        copies.forEach((s: any) => { expect(s.bbox().maxX()).toBeLessThanOrEqual(1.2 + 1e-9); expect(s.bbox().maxY()).toBeLessThanOrEqual(0.8 + 1e-9) })
        expect((metric as any).stats.bins[0].weight).toBe(30)
    })

    it('converts between kilograms, pounds and grams', () =>
    {
        expect(toGrams(2.5, { mmPerUnit: 1, imperial: false })).toBe(2500)
        expect(toGrams(1, { mmPerUnit: 25.4, imperial: true })).toBeCloseTo(453.59237, 8)
        expect(fromGrams(453.59237, { mmPerUnit: 25.4, imperial: true })).toBeCloseTo(1, 12)
    })

    it('says what is wrong with the options', () =>
    {
        const parts = () => boxes([[100, 100, 100]])
        expect(() => modeler.make.pack3d(parts(), {} as any)).toThrow(/please give the bins/)
        expect(() => modeler.make.pack3d(parts(), { bins: [] })).toThrow(/please give the bins/)
        expect(() => modeler.make.pack3d(parts(), { bins: [{ length: 0, width: 800, height: 800 }] })).toThrow(/needs a length, a width and a height above 0/)
        expect(() => modeler.make.pack3d(parts(), { bins: [BIN], weight: -1 })).toThrow(/the weight of shape 1 \(b1\) has to be a number of 0 or more/)
        expect(() => modeler.make.pack3d(parts(), { bins: [BIN], stop: 1.5 })).toThrow(/stop of shape 1.*whole number/)
        expect(() => modeler.make.pack3d(parts(), { bins: [{ ...BIN, balance: { cog: { x: 0.9 } } }] })).toThrow(/fraction between 0 and 0.5/)
    })

    it('returns nothing for nothing', () =>
    {
        expect(modeler.make.pack3d(modeler.collection(), { bins: [BIN] }).toArray()).toEqual([])
    })
})
