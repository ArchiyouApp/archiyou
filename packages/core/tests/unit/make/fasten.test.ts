import { describe, it, expect, beforeAll } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { contact, layOut, screwSize } from '../../../src/make/build/fasten'
import { Estimate } from '../../../src/make/estimate/Estimate'
import { MakeDb, snapshotFromTables } from '../../../src/make/db'
import type { ArchiyouModules } from '../../../src/types'

let modeler: Modeler

beforeAll(async () =>
{
    modeler = new Modeler()
    await modeler.load()
    modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
})

const box = (min: number[], max: number[]) => ({ min, max }) as any

describe('fasten: the geometry', () =>
{
    it('reads the size of a screw from its product id', () =>
    {
        expect(screwSize('schroef-rvs-6x100')).toEqual({ diameter: 6, length: 100 })
        expect(screwSize('schroef-rvs-4.5x50')).toEqual({ diameter: 4.5, length: 50 })
        expect(screwSize('tape-universeel-60')).toEqual({})
    })

    it('finds the face where two boxes lie against each other, and only that', () =>
    {
        const plate = box([0, 0, 0], [3000, 235, 38])
        const stud = box([0, 0, 38], [38, 235, 2624])
        expect(contact(plate, stud)).toMatchObject({ axis: 2, sign: 1, lo: [0, 0, 38], hi: [38, 235, 38] })
        expect(contact(stud, plate)).toMatchObject({ axis: 2, sign: -1 })
        expect(contact(plate, box([0, 0, 100], [38, 235, 200]))).toBeNull()        // a gap
        expect(contact(plate, box([0, 0, 10], [38, 235, 200]))).toBeNull()         // overlapping
        expect(contact(plate, box([3000, 0, 38], [3038, 235, 76]))).toBeNull()     // along an edge only: no face
        expect(contact(plate, box([3000, 0, 0], [3038, 235, 38]))).toMatchObject({ axis: 0 })   // end to end is a face
    })

    it("lays 'end' screws over the long side of each contact, through the first part", () =>
    {
        const screws = layOut([box([0, 0, 0], [3000, 235, 38])], [box([0, 0, 38], [38, 235, 2624])],
            { diameter: 6, length: 100, pattern: 'end', pitch: 150, count: 2, edge: 18 })
        expect(screws).toHaveLength(2)
        expect(screws.map(s => s.head[1])).toEqual([18, 217])          // across the 235, 18 from the edges
        expect(screws[0]).toMatchObject({ head: [19, 18, 0], direction: [0, 0, 1], tip: [19, 18, 100], through: 38, penetration: 62 })
    })

    it("lays a 'row' at most `pitch` apart, from `edge` to `edge`", () =>
    {
        const board = box([0, -16, 0], [3000, 0, 2700])
        const stud = box([0, 0, 0], [38, 235, 2700])
        const screws = layOut([board], [stud], { diameter: 4.5, length: 50, pattern: 'row', pitch: 150, count: 2, edge: 10 })
        const zs = screws.map(s => s.head[2])
        expect(screws.length).toBe(Math.ceil((2700 - 20) / 150) + 1)
        expect(zs[0]).toBe(10)
        expect(zs[zs.length - 1]).toBe(2690)
        expect(zs[1]! - zs[0]!).toBeLessThanOrEqual(150)
        expect(screws[0]).toMatchObject({ direction: [0, 1, 0], head: [19, -16, 10], penetration: 34 })
    })
})

describe('make.fasten()', () =>
{
    it('draws each screw as a circle on its work face and a line to its tip', () =>
    {
        modeler.reset()
        const plate = modeler.box(1000, 235, 38).move(500, 0, 19)
        const studs = [0, 600].map(x => modeler.box(38, 235, 1000).move(x + 19, 0, 538))
        const fastening = modeler.make.fasten(plate, studs, { product: 'schroef-rvs-6x100', pattern: 'end' }) as any

        expect(fastening.screws).toHaveLength(4)
        const curves = fastening.toArray()
        expect(curves).toHaveLength(8)
        const heads = curves.filter((c: any) => c._fastening?.head)
        expect(heads).toHaveLength(4)
        expect(heads[0]._fastening).toMatchObject({ product: 'schroef-rvs-6x100', diameter: 6, length: 100 })
        // the line runs the length of the screw
        const line = curves.find((c: any) => c._fastening && !c._fastening.head)
        const bb = line.bbox()
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(100, 6)
    })

    it('needs the size of the screw', () =>
    {
        modeler.reset()
        expect(() => modeler.make.fasten(modeler.box(10, 10, 10), modeler.box(10, 10, 10), { product: 'lijm' })).toThrow(/size of the screw/)
    })

    it('is counted by make.estimate(), by product', () =>
    {
        modeler.reset()
        const plate = modeler.box(1000, 235, 38).move(500, 0, 19)
        const studs = [0, 600].map(x => modeler.box(38, 235, 1000).move(x + 19, 0, 538))
        modeler.make.fasten(plate, studs, { product: 'schroef-rvs-6x100', pattern: 'end', count: 2 })
        const db = new MakeDb(snapshotFromTables({
            version: '2026-11-24.1', source: { sheet: 'test', title: 'TEST' },
            tables: {
                materialen: [['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'], ['staal', 'Staal', 'bevestiging', 7850, 50]],
                producten: [['product_id', 'productgroep', 'vorm', 'materiaal', 'breedte', 'lengte', 'basiseenheid'], ['schroef-rvs-6x100', 'SCHROEF', 'stuk', 'staal', 6, 100, 'st']],
                bewerkingen: [['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'], ['bevestigen', 'assemblage', 'st', 20, 0.33]],
                componenten: [['component', 'fase', 'product', 'bewerking', 'per', 'factor'], ['frame', 'materiaal', 'schroef-rvs-6x100', '', '', '']],
            },
            settings: { 'settings.rate_labor': 40, 'outputs.marges.materiaal': 0, 'outputs.marges.arbeid': 0, 'outputs.marges.algemeen': 0 },
        }))
        const est = new Estimate(db, modeler.all())
        expect(est.lines().find(l => l.id === 'schroef-rvs-6x100')).toMatchObject({ st: 4 })
    })
})

describe('fasten: which way a screw goes', () =>
{
    it('goes in from the other side where it does not fit through the first part', () =>
    {
        // a header (600 long) with its end against the side of a king stud (38 thick)
        const header = box([38, 0, 2000], [638, 235, 2038])
        const king = box([0, 0, 0], [38, 235, 2400])
        const [screw] = layOut([header], [king], { diameter: 6, length: 100, pattern: 'end', pitch: 150, count: 1, edge: 18 })
        expect(screw).toMatchObject({ direction: [1, 0, 0], through: 38, into: 600, penetration: 62 })
        expect(screw!.head[0]).toBe(0)                 // on the far face of the stud
    })

    it('leaves out a pair it fits through neither way', () =>
    {
        const beam = box([0, 0, 0], [200, 200, 1000])
        const post = box([200, 0, 0], [400, 200, 1000])
        expect(layOut([beam], [post], { diameter: 6, length: 100, pattern: 'end', pitch: 150, count: 2, edge: 18 })).toEqual([])
    })
})
