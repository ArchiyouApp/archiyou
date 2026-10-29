import { describe, it, expect, beforeAll } from 'vitest'

import { BinPacker, DEFAULT_ITERATIONS } from '@archiyou/gdrr2bp-wasm'
import type { CuttingNode, Instance, Part } from '@archiyou/gdrr2bp-wasm'
import { Modeler } from '../../../src/modeler/Modeler'

/** The layout as one line, `sheet:x,y,LxH#part` for every placed part in the order of the solution.
 *  packages/gdrr2bp-wasm/tests/smoke.rs asserts the same text natively (GOLDEN_LAYOUT), which is
 *  what keeps the WASM build and the native solver in step. */
const GOLDEN_LAYOUT = '0:0,0,600x100#3 0:0,100,600x100#3 0:0,200,400x300#0 0:400,200,200x300#1 0:600,0,350x150#5 0:600,150,200x300#1 0:800,150,200x300#1 1:0,0,250x250#2 1:0,250,250x250#2 1:250,0,150x450#4 1:400,0,150x450#4 1:550,0,400x300#0 1:550,300,350x150#5'

function placed(node: CuttingNode, x: number, y: number, sheet: number): string[]
{
    if (node.kind === 'item')
    {
        return [`${sheet}:${x},${y},${node.length}x${node.height}#${node.item}`]
    }
    if (node.kind !== 'structure')
    {
        return []
    }
    // a V node lays its children side by side along x, an H node stacks them along y
    const vertical = node.orientation === 'V'
    return node.children.reduce<{ out: string[], cx: number, cy: number }>((acc, child) => ({
        out: [...acc.out, ...placed(child, acc.cx, acc.cy, sheet)],
        cx: acc.cx + (vertical ? child.length : 0),
        cy: acc.cy + (vertical ? 0 : child.height),
    }), { out: [], cx: x, cy: y }).out
}

const layoutText = (patterns: { root: CuttingNode }[]): string =>
    patterns.flatMap((pattern, sheet) => placed(pattern.root, 0, 0, sheet)).join(' ')

const cutDepth = (node: CuttingNode): number =>
    node.kind === 'structure' ? 1 + Math.max(0, ...node.children.map(cutDepth)) : 0

const part = (length: number, height: number, demand: number): Part => ({ length, height, demand, value: 1 })

const GOLDEN_INSTANCE: Instance = {
    name: 'golden',
    sheets: [{ length: 1000, height: 500, cost: 1, stock: null }],
    parts: [part(400, 300, 2), part(300, 200, 3), part(250, 250, 2), part(600, 100, 2), part(150, 450, 2), part(350, 150, 2)],
}

describe('the bin packer (WASM)', () =>
{
    let bp: BinPacker

    beforeAll(async () =>
    {
        bp = await new BinPacker().init()
    })

    it('gives in WASM the layout the native solver gives for the same instance and seed', () =>
    {
        const solution = bp.solve(GOLDEN_INSTANCE, { maxRRIterations: 300, seed: 1 })
        expect(layoutText(solution.patterns)).toBe(GOLDEN_LAYOUT)
    })

    it('gives the same layout for the same seed, whatever else ran in between', () =>
    {
        const run = (seed: number) => layoutText(bp.solve(GOLDEN_INSTANCE, { maxRRIterations: 300, seed }).patterns)
        const first = run(4)
        run(9)
        expect(run(4)).toBe(first)
    })

    it('explores other layouts with other seeds', () =>
    {
        const layouts = new Set(Array.from({ length: 12 }, (_, seed) =>
            layoutText(bp.solve(GOLDEN_INSTANCE, { maxRRIterations: 300, seed }).patterns)))
        expect(layouts.size).toBeGreaterThan(1)
    })

    it('stops by itself and is reproducible without any budget', () =>
    {
        const unbounded = layoutText(bp.solve(GOLDEN_INSTANCE).patterns)
        expect(unbounded).toBe(layoutText(bp.solve(GOLDEN_INSTANCE).patterns))
        expect(unbounded).toBe(layoutText(bp.solve(GOLDEN_INSTANCE, { maxRRIterations: DEFAULT_ITERATIONS }).patterns))
    })

    it('lets several packers work side by side on one shared instance', async () =>
    {
        const other = await new BinPacker().init()
        const options = { maxRRIterations: 300, seed: 1 }
        // alternate between the two: with two instances the first read its strings from the wrong memory
        expect(layoutText(bp.solve(GOLDEN_INSTANCE, options).patterns)).toBe(GOLDEN_LAYOUT)
        expect(layoutText(other.solve(GOLDEN_INSTANCE, options).patterns)).toBe(GOLDEN_LAYOUT)
        expect(layoutText(bp.solve(GOLDEN_INSTANCE, options).patterns)).toBe(GOLDEN_LAYOUT)
        // and two inits at the same moment load the module once
        const [a, b] = await Promise.all([new BinPacker().init(), new BinPacker().init()])
        expect(layoutText(a.solve(GOLDEN_INSTANCE, options).patterns)).toBe(layoutText(b.solve(GOLDEN_INSTANCE, options).patterns))
    })

    it('refuses a seed that is not a non-negative integer', () =>
    {
        expect(() => bp.solve(GOLDEN_INSTANCE, { maxRRIterations: 10, seed: -1 })).toThrow(/seed/)
        expect(() => bp.solve(GOLDEN_INSTANCE, { maxRRIterations: 10, seed: 1.5 })).toThrow(/seed/)
    })

    it('fixes the direction of the first cut per sheet', () =>
    {
        const solveWith = (firstCut: 'H' | 'V' | null) => bp.solve(
            { ...GOLDEN_INSTANCE, sheets: [{ ...GOLDEN_INSTANCE.sheets[0], firstCut }] },
            { maxRRIterations: 200, seed: 3 })
        const roots = (firstCut: 'H' | 'V') => solveWith(firstCut).patterns
            .filter(pattern => pattern.root.kind === 'structure')
            .map(pattern => pattern.root.orientation)

        expect(roots('V').length).toBeGreaterThan(0)
        expect(roots('V').every(o => o === 'V')).toBe(true)
        expect(roots('H').every(o => o === 'H')).toBe(true)
        expect(solveWith('V').sheets[0].firstCut).toBe('V')
    })

    it('limits the number of cutting stages', () =>
    {
        const parts = [part(130, 210, 3), part(270, 90, 3), part(310, 160, 2), part(180, 340, 2),
            part(420, 120, 2), part(90, 90, 5), part(230, 230, 2), part(360, 260, 1)]
        const instance: Instance = { name: 'stages', sheets: [{ length: 1000, height: 1000, cost: 1, stock: null }], parts }
        const deepest = (maxStages: number | null) => Math.max(...Array.from({ length: 6 }, (_, seed) =>
            Math.max(...bp.solve(instance, { maxRRIterations: 300, seed, maxStages }).patterns.map(p => cutDepth(p.root)))))

        expect(deepest(null)).toBeGreaterThanOrEqual(3) // the control: without a limit it needs more
        expect(deepest(2)).toBeLessThanOrEqual(2)
    })

    it('keeps a locked part in the orientation it has', () =>
    {
        const lockedPart: Part = { ...part(500, 200, 6), canRotate: false }
        const free: Instance = { name: 'free', sheets: [{ length: 1200, height: 600, cost: 1, stock: null }], parts: [part(500, 200, 6), part(200, 500, 6), part(300, 300, 4)] }
        const locked: Instance = { ...free, parts: [lockedPart, free.parts[1], free.parts[2]] }
        // how often part 0 comes out as 200x500, i.e. turned
        const turned = (instance: Instance, seed: number) => bp.solve(instance, { maxRRIterations: 200, seed }).patterns
            .flatMap((pattern, sheet) => placed(pattern.root, 0, 0, sheet))
            .filter(text => text.endsWith('#0') && text.includes(',200x500#')).length

        const seeds = Array.from({ length: 10 }, (_, seed) => seed)
        expect(seeds.some(seed => turned(free, seed) > 0)).toBe(true) // the control: left free, it does get turned
        expect(seeds.every(seed => turned(locked, seed) === 0)).toBe(true)
    })
})

describe('make.pack', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        await modeler.make.packReady()
    })

    const panels = (sizes: [number, number][], name = 'panel') =>
        modeler.collection(...sizes.map(([w, h], i) => modeler.box(w, h, 18).name(`${name}${i + 1}`)))

    /** Where every placed shape ended up, as text */
    const signature = (result: any): string => result.toArray()
        .map((shape: any) =>
        {
            const bb = shape.bbox()
            return [bb.minX(), bb.minY(), bb.maxX(), bb.maxY()].map((v: number) => Math.round(v * 1e6) / 1e6).join(',')
        })
        .join(' ')

    const SHEET = { width: 2440, height: 1220 }

    const CABINET: [number, number][] = [[800, 400], [800, 400], [600, 400], [564, 600], [300, 300], [450, 250],
        [450, 250], [700, 120], [120, 700], [380, 380], [1100, 500], [1100, 500]]

    it('gives the same layout every time it is asked', () =>
    {
        const first = signature(modeler.make.pack(panels(CABINET), { ...SHEET, kerf: 4 }))
        const second = signature(modeler.make.pack(panels(CABINET), { ...SHEET, kerf: 4 }))
        expect(second).toBe(first)
    })

    it('gives the same layout in another modeler', async () =>
    {
        const other = new Modeler()
        await other.load()
        const here = signature(modeler.make.pack(panels(CABINET), { ...SHEET, kerf: 4 }))
        const there = signature(other.make.pack(other.collection(...CABINET.map(([w, h]) => other.box(w, h, 18))), { ...SHEET, kerf: 4 }))
        expect(there).toBe(here)
    }, 30_000)

    it('accepts a seed, the stages and the first cut, and places every part', () =>
    {
        const total = CABINET.length
        const result = modeler.make.pack(panels(CABINET), { ...SHEET, kerf: 4, seed: 7, maxStages: 3, firstCut: 'vertical' })
        const placedParts = result.toArray().length - (modeler as any).stats.objectsUsed // minus the sheet outlines
        expect(placedParts).toBe(total)
    })

    it('keeps the parts a rotation function locks in the orientation they have', () =>
    {
        // 500x200 doors may not be turned, the 200x500 and 300x300 panels may
        const sizes: [number, number][] = [...Array(6).fill([500, 200]), ...Array(6).fill([200, 500]), ...Array(4).fill([300, 300])]
        const isDoor = (shape: any): boolean => (shape.name?.() ?? '').startsWith('door')
        const doorsStayPut = (seed: number) =>
        {
            const col = modeler.collection(...sizes.map(([w, h], i) => modeler.box(w, h, 18).name(i < 6 ? `door${i}` : `panel${i}`)))
            const result = modeler.make.pack(col, { width: 1200, height: 600, seed, rotation: (shape: any) => !isDoor(shape) })
            const doors = result.toArray().filter(isDoor)
            return doors.length === 6 && doors.every((door: any) => Math.round(door.bbox().width()) === 500 && Math.round(door.bbox().depth()) === 200)
        }
        expect(Array.from({ length: 6 }, (_, seed) => doorsStayPut(seed)).every(Boolean)).toBe(true)
    })

    it('rounds a part up, so two parts of 600.4 do not share a sheet 1200 wide', () =>
    {
        // rounded to the nearest unit they were 600 and 600, and "fitted" with 0.8 sticking out
        const result = modeler.make.pack(panels([[600.4, 300], [600.4, 300]]), { width: 1200, height: 300, rotation: false })
        expect(result).toBeDefined()
        expect((modeler as any).stats.objectsUsed).toBe(2)
    })

    it('does not let float noise cost a unit', () =>
    {
        modeler.make.pack(panels([[600 + 1e-7, 300], [600 + 1e-7, 300]]), { width: 1200, height: 300, rotation: false })
        expect((modeler as any).stats.objectsUsed).toBe(1)
    })
})
