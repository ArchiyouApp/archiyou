import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isPack3dLoaded, loadPack3dModule } from '../../../src/modeler/Make'
import { Packer3D, orientationMask } from '@archiyou/pack3d-wasm'
import type { Instance, Solution } from '@archiyou/pack3d-wasm'

/** The fixtures of the Rust crate, and the hash of the solution that its native build gives for each:
 *  packages/pack3d-wasm/tests/fixtures (`cargo run --release --example fixtures` writes them). */
const FIXTURES = fileURLToPath(new URL('../../../../pack3d-wasm/tests/fixtures/', import.meta.url))

type Fixture = { name: string, instance: Instance, config: Record<string, unknown> }

const names = (): string[] => readdirSync(FIXTURES).filter(f => f.endsWith('.json') && f !== 'expected.json').map(f => f.slice(0, -5)).sort()
const fixture = (name: string): Fixture => JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'))
const expected: Record<string, { hash: string, bins: number, unplaced: number }> = JSON.parse(readFileSync(`${FIXTURES}expected.json`, 'utf8'))

/** FNV-1a 64 over the UTF-8 bytes, the same as the Rust side. */
const fnv = (text: string): string =>
    Buffer.from(text).reduce((h, byte) => ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn, 0xcbf29ce484222325n).toString(16).padStart(16, '0')

describe('the 3D load planner (WebAssembly)', () =>
{
    it('is not loaded until something asks for it, and loads once however often it is asked', async () =>
    {
        expect(isPack3dLoaded()).toBe(false)
        const [first, second] = await Promise.all([loadPack3dModule(), loadPack3dModule()])
        expect(first).toBe(second)
        expect(isPack3dLoaded()).toBe(true)
        expect(await loadPack3dModule()).toBe(first)
        expect(first.ready).toBe(true)
    })

    it('gives, for every fixture, the bytes that the native build gives', async () =>
    {
        const packer = await loadPack3dModule()
        const all = names()
        expect(all.length).toBeGreaterThanOrEqual(12)
        expect(all).toEqual(Object.keys(expected).sort())
        all.forEach(name =>
        {
            const { instance, config } = fixture(name)
            const solution = packer.solveRaw(JSON.stringify(instance), JSON.stringify(config))
            expect(fnv(solution), `${name}: the WebAssembly build differs from the native one`).toBe(expected[name].hash)
            const parsed = JSON.parse(solution) as Solution
            expect([parsed.bins.length, parsed.unplaced.length]).toEqual([expected[name].bins, expected[name].unplaced])
        })
    }, 60_000)

    it('gives the same plan through the typed wrapper, and the same plan again', async () =>
    {
        const packer = await loadPack3dModule()
        const { instance } = fixture('pallet-mix')
        const first = packer.solve(instance, { iterations: 0 })
        const second = packer.solve(instance, { iterations: 0 })
        expect(second).toEqual(first)
        expect(first.bins.length).toBe(4)
        expect(packer.validate(instance, { iterations: 0 }, first)).toEqual([])
    })

    it('searches by default and the seed decides which of the equally good plans is taken', async () =>
    {
        const packer = await loadPack3dModule()
        const { instance } = fixture('search-job')
        expect(packer.solve(instance, { iterations: 0 }).bins.length).toBe(2)
        const searched = packer.solve(instance)
        expect(searched.bins.length).toBe(1)
        expect(searched.stats.iterations).toBeGreaterThan(0)
        const layouts = new Set([0, 1, 2, 3, 4, 5].map(seed => JSON.stringify(packer.solve(instance, { iterations: 20, seed }).bins)))
        expect(layouts.size).toBeGreaterThan(1)
    })

    it('finds the rules that a changed plan breaks', async () =>
    {
        const packer = await loadPack3dModule()
        const { instance } = fixture('three-kinds')
        const good = packer.solve(instance, { iterations: 0 })
        expect(packer.validate(instance, { iterations: 0 }, good)).toEqual([])
        const broken: Solution = JSON.parse(JSON.stringify(good))
        broken.bins[0].placements[1].x = broken.bins[0].placements[0].x
        broken.bins[0].placements[1].y = broken.bins[0].placements[0].y
        broken.bins[0].placements[1].z = broken.bins[0].placements[0].z
        expect(packer.validate(instance, { iterations: 0 }, broken).join('\n')).toMatch(/overlaps/)
    })

    it('says what is wrong with input that makes no sense', async () =>
    {
        const packer = await loadPack3dModule()
        const bins = [{ dims: [1000, 1000, 1000] as [number, number, number] }]
        expect(() => packer.solve({ items: [{ dims: [0, 10, 10] }], bins })).toThrow(/item 0: side x has to be a whole number of at least 1/)
        expect(() => packer.solve({ items: [{ dims: [10.5, 10, 10] }], bins })).toThrow(/whole number/)
        expect(() => packer.solve({ items: [{ dims: [10, 10, 10] }], bins: [] })).toThrow(/at least one bin type/)
        expect(() => packer.solve({ items: [{ dims: [10, 10, 10] }], bins }, { seed: -1 })).toThrow(/seed/)
        expect(() => packer.solve({ items: [{ dims: [10, 10, 10], orientations: 0 }], bins })).toThrow(/orientations/)
        expect(() => packer.solve({ items: [{ dims: [10, 10, 10] }], bins: [{ ...bins[0], balance: { cog: { x: 0.9 } } }] })).toThrow(/fraction between 0 and 0.5/)
        expect(() => packer.solve({ items: [{ dims: [10, 10, 10] }], bins }, { support: 2 })).toThrow(/support/)
    })

    it('refuses to solve before it is loaded', () =>
    {
        expect(() => new Packer3D().solve({ items: [], bins: [{ dims: [1, 1, 1] }] })).toThrow(/WebAssembly module is not loaded/)
    })

    it('shares one WebAssembly instance between packers, whatever order they work in', async () =>
    {
        const [a, b] = await Promise.all([new Packer3D().init(), new Packer3D().init()])
        const { instance } = fixture('orientations-gap')
        const options = { iterations: 0, support: 1, gap: 5 }
        const plan = (packer: Packer3D) => JSON.stringify(packer.solve(instance, options))
        const first = plan(a)
        expect(plan(b)).toBe(first)
        expect(plan(a)).toBe(first)
    })
})

describe('orientationMask', () =>
{
    it('turns the ways an item may be put into the bits the solver reads', () =>
    {
        expect(orientationMask('fixed')).toBe(0b000001)
        expect(orientationMask('upright')).toBe(0b000011)
        expect(orientationMask('free')).toBe(0b111111)
        expect(orientationMask({ up: 'z' })).toBe(0b000011)
        expect(orientationMask({ up: 'z', yaw: false })).toBe(0b000001)
        expect(orientationMask({ up: 'x' })).toBe(0b110000)
        expect(orientationMask({ up: ['y', 'z'] })).toBe(0b001111)
        expect(orientationMask({ up: ['x', 'y', 'z'], yaw: false })).toBe(0b010101)
        expect(() => orientationMask({ up: [] })).toThrow(/at least one axis/)
        expect(() => orientationMask({ up: 'w' as never })).toThrow(/unknown axis/)
    })
})
