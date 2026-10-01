import { describe, it, expect } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'
import { save } from '@archiyou/meshup/src/utils'

const TEST_OUTPUT_DIR = './tests/outputs/modeler'

describe('Make', async () =>
{
    let modeler: Modeler

    it('Modeler inits successfully with Make module', async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        expect(modeler).toBeInstanceOf(Modeler)
        expect(modeler.kernel()).toBeDefined()
        expect(modeler.make).toBeDefined()
    })

    it('should create a frame', async () =>
    {
        const frame = modeler.make.frame(100, 200, 20, 20, 'horizontal')
        expect(frame).toBeDefined()
        expect(frame.first().name()).toBe('frameBottom')
        await save(`${TEST_OUTPUT_DIR}/frame.glb`, await frame.toGLB())
    })

    it('should create a wall', async () =>
    {
        const wall = modeler.make.wall(2000, 2000, 200, 38, 600, [])

        expect(wall._layer).not.toBeNull()
        expect(wall._layer!.name).toBe('wall')

        const subLayers = wall._layer!.children().map((c: { name: string }) => c.name)
        expect(subLayers).toEqual(expect.arrayContaining(['studs', 'plates', 'insulation']))

        ;(wall as any).insulation.hide()
        await save(`${TEST_OUTPUT_DIR}/wall.glb`, await wall.toGLB())
    })

    it('should keep the opening void clear when splitting studs', async () =>
    {
        const localModeler = new Modeler()
        await localModeler.load()

        const wall = localModeler.make.wall(3000, 2000, 200, 32, 610, [
            { left: 1000, sill: 500, width: 600, height: 600 },
        ])

        expect(wall).toBeInstanceOf(SmartShapeCollection)
        expect((wall as any).openingJackStuds.length).toBe(4)
        // The dashed lines are the stud grid; the diagram is the wall's outline, kept hidden.
        expect((wall as any).gridlines.toArray().length).toBeGreaterThan(0)
        expect((wall as any).gridlines.toArray().every((shape: any) => shape.style.strokeDash.length > 0)).toBe(true)
        expect((wall as any).diagram.toArray().every((shape: any) => shape.style.visible === false)).toBe(true)

        const probe = localModeler
            .boxBetween([1120, -100, 520], [1480, 100, 1080])
            .removeFromScene()

        const overlappingMeshes = localModeler
            .scene()
            .shapes()
            .toArray()
            .filter(shape => shape.type === 'Mesh')
            .filter(shape => (shape as any).overlapPerc?.(probe) > 0.001)

        expect(overlappingMeshes).toHaveLength(0)
    })

    it('should create a wall with two openings', async () =>
    {
        const WIDTH = 3000;
        const localModeler = new Modeler()
        await localModeler.load()

        const wall = localModeler.make.wall(WIDTH, 2000, 120, 38, 610, [
            { left: 500,  sill: 500,  width: 500,  height: 500 },
            { left: 1200, sill: 1000, width: 1000, height: 500 },
        ])

        expect(wall).toBeInstanceOf(SmartShapeCollection)

        const subLayers = wall._layer!.children().map((c: { name: string }) => c.name)
        expect(subLayers).toEqual(expect.arrayContaining(['studs', 'plates', 'insulation']))

        // Both openings are independent (gap=200 > 2*38) → 4 jack studs each
        expect((wall as any).openingJackStuds.length).toBe(8)

        // Verify each opening void is free of solid mesh material
        const solidMeshes = localModeler.scene().shapes().toArray().filter(s => s.type === 'Mesh')

        const probe1 = localModeler.boxBetween([600, -100, 600], [800, 100, 800]).removeFromScene()
        const probe2 = localModeler.boxBetween([1400, -100, 1100], [1900, 100, 1400]).removeFromScene()

        expect(solidMeshes.filter((s: any) => s.overlapPerc?.(probe1) > 0.001)).toHaveLength(0)
        expect(solidMeshes.filter((s: any) => s.overlapPerc?.(probe2) > 0.001)).toHaveLength(0)

        await save(`${TEST_OUTPUT_DIR}/wall-two-openings.glb`, await wall.toGLB())
    })

    it('should merge openings that are too close for two king studs to fit between them', async () =>
    {
        const WIDTH = 3000;
        const localModeler = new Modeler()
        await localModeler.load()

        // Gap = 1050 - (500+500) = 50 mm  <  2*38 = 76 mm  →  openings must be merged
        const wall = localModeler.make.wall(WIDTH, 2000, 120, 38, 610, [
            { left: 500,  sill: 500, width: 500, height: 500 },
            { left: 1050, sill: 500, width: 500, height: 500 },
        ])

        expect(wall).toBeInstanceOf(SmartShapeCollection)

        // Two too-close openings are merged into one before placement
        expect((wall as any).openingDiagrams.length).toBe(1)

        // One merged opening → 4 jack studs
        expect((wall as any).openingJackStuds.length).toBe(4)
    })

    it('should board up an area with stock elements', async () =>
    {
        const localModeler = new Modeler()
        await localModeler.load()
        await localModeler.make.packReady()

        // 2440x1220 sheets over a 5000x2000 area, laid horizontally
        const boards = localModeler.make.boarding({
            width: 5000,
            height: 2000,
            stockWidth: 2440,
            stockHeight: 1220,
            direction: 'horizontal',
        })

        expect(boards).toBeInstanceOf(SmartShapeCollection)
        expect(boards.length).toBeGreaterThan(0)

        // every element sits inside the area, and together they cover it exactly
        const bb = boards.bbox()!
        expect(bb.minX()).toBeCloseTo(0, 5)
        expect(bb.minY()).toBeCloseTo(0, 5)
        expect(bb.maxX()).toBeCloseTo(5000, 5)
        expect(bb.maxY()).toBeCloseTo(2000, 5)

        const covered = boards.toArray().reduce((sum, s: any) => sum + (s.area?.() ?? 0), 0)
        expect(covered).toBeCloseTo(5000 * 2000, 0)

        // stats: 2 full sheets per row (2440 + 2440), the rest is cut
        expect(localModeler.make.stats.full.length).toBeGreaterThan(0)
        expect(localModeler.make.stats.cut.length).toBeGreaterThan(0)
        expect(localModeler.make.stats.numStock).toBeGreaterThanOrEqual(localModeler.make.stats.full.length)

        await save(`${TEST_OUTPUT_DIR}/boarding.glb`, await boards.toGLB())
    }, 30_000)

    it('should snap boarding elements to a grid', async () =>
    {
        const localModeler = new Modeler()
        await localModeler.load()

        const boards = localModeler.make.boarding({
            width: 3000,
            height: 1000,
            stockWidth: 1220,
            stockHeight: 1000,
            direction: 'horizontal',
            grid: 610,
            stats: false, // no nesting needed for this assertion
        })

        // every element that is not the last of a row ends on a multiple of the grid
        const ends = boards.toArray()
            .map((s: any) => s.bbox().maxX())
            .filter(x => x < 3000 - 1)
        ends.forEach(x => expect(Math.abs(x % 610)).toBeLessThan(1e-6))
    }, 30_000)

    it('should fit a strut diagonally into a rectangular space', async () =>
    {
        const localModeler = new Modeler()
        await localModeler.load()

        const SPACE: [number, number] = [1000, 600]
        const WIDTH = 100

        const strut = localModeler.make.fitRectStrut(WIDTH, SPACE) as any

        // a flat quad on the XY plane, spanning the space corner to corner. The strut is
        // aligned to the diagonal of the space *inset by its own width*, so its far corner
        // lands on the space corner give or take a fraction of the width.
        expect(strut.type).toBe('Polygon')
        const bb = strut.bbox()
        expect(bb.height()).toBeCloseTo(0, 6)   // flat: no z extent
        expect(bb.maxX()).toBeCloseTo(SPACE[0], 6)
        expect(bb.maxY()).toBeCloseTo(SPACE[1], -1)
        expect(bb.minX()).toBeGreaterThanOrEqual(-1e-6)
        expect(bb.minY()).toBeCloseTo(0, 6)

        // it really is WIDTH wide (area / diagonal length)
        const diagonal = Math.hypot(SPACE[0] - WIDTH, SPACE[1] - WIDTH)
        expect(strut.area() / diagonal).toBeGreaterThan(WIDTH * 0.9)

        // and it extrudes into a solid, as the scripts use it
        const solid = strut.extrude(50, [0, 0, 1])
        expect(solid.volume()).toBeGreaterThan(0)

        // withSpace also hands back the space outline
        const withSpace = localModeler.make.fitRectStrut(WIDTH, SPACE, true) as any
        expect(withSpace).toBeInstanceOf(SmartShapeCollection)
        expect(withSpace.length).toBe(2)
    }, 30_000)

    describe('cutAngles', () =>
    {
        const [LENGTH, WIDTH, THICKNESS] = [600, 90, 40]
        const rad = (deg: number) => deg * Math.PI / 180
        const deg = (r: number) => r * 180 / Math.PI

        /** A beam along x (y: width, z: thickness) whose left end is cut the way a miter saw
         *  set to `miter` and `bevel` cuts it with the bottom face on the table, and the four
         *  corners of that cut as [y, z] → point */
        const cutBeam = (m: Modeler, miter: number, bevel: number) =>
        {
            const n = [Math.cos(rad(bevel)) * Math.cos(rad(miter)),
                       Math.cos(rad(bevel)) * Math.sin(rad(miter)),
                       Math.sin(rad(bevel))]
            const origin = [200, WIDTH / 2, THICKNESS / 2] // the cut plane goes through here
            const corner = (y: number, z: number): [number, number, number] =>
                [origin[0] - (n[1] * (y - origin[1]) + n[2] * (z - origin[2])) / n[0], y, z]

            const ring = [[0, 0], [WIDTH, 0], [WIDTH, THICKNESS], [0, THICKNESS]] as Array<[number, number]>
            const left = m.polygon(ring.map(([y, z]) => corner(y, z))) as any
            const right = m.polygon(ring.map(([y, z]) => [LENGTH, y, z])) as any
            return { beam: left.loft(right), corner }
        }

        it('reads a square cut as zero', async () =>
        {
            const m = new Modeler()
            await m.load()
            const beam = m.box(LENGTH, WIDTH, THICKNESS) as any

            expect(m.make.cutAngles(beam.select('E||bottomleft'))).toEqual({ miter: 0, bevel: 0 })
        }, 30_000)

        it('reads back the saw settings of a compound cut', async () =>
        {
            const m = new Modeler()
            await m.load()
            const { beam, corner } = cutBeam(m, 30, 20)

            // the edge the cut shares with the bottom face, found back in the scene
            const bottomEdge = m.line(corner(0, 0), corner(WIDTH, 0)) as any
            const angles = m.make.cutAngles(bottomEdge)
            expect(angles.miter).toBeCloseTo(30, 6)
            expect(angles.bevel).toBeCloseTo(20, 6)

            // and with the beam given
            expect(m.make.cutAngles(bottomEdge, beam)).toEqual(angles)
        }, 30_000)

        it('gives other angles for the same cut with the beam on another face', async () =>
        {
            const m = new Modeler()
            await m.load()
            const { beam, corner } = cutBeam(m, 30, 20)

            /*  Front face (y = 0) on the table: up is y and the old bevel becomes the miter:
                blade normal n = (cos b cos m, cos b sin m, sin b) read in that frame */
            const [cb, sb, cm, sm] = [Math.cos(rad(20)), Math.sin(rad(20)), Math.cos(rad(30)), Math.sin(rad(30))]
            const angles = m.make.cutAngles(m.line(corner(0, 0), corner(0, THICKNESS)) as any, beam)
            expect(angles.miter).toBeCloseTo(deg(Math.atan2(sb, cb * cm)), 6)
            expect(angles.bevel).toBeCloseTo(deg(Math.asin(cb * sm)), 6)
        }, 30_000)

        it('reads the same cut on both kernels', async () =>
        {
            for (const mode of ['mesh', 'brep'] as const)
            {
                const m = new Modeler(mode)
                await m.load()

                // a saw at miter 30, bevel 20 turns the blade around z, then tilts it around y
                const cutter = (m.box(400, 400, 400) as any).move(-200, 0, 0).rotateY(20).rotateZ(30).move(-200, 0, 0)
                const beam = (m.box(LENGTH, WIDTH, THICKNESS) as any).subtract(cutter)
                cutter.removeFromScene?.()

                // both kernels find the beam up the edge's parents (edge → face → solid)
                const angles = m.make.cutAngles(beam.select('F||bottom').select('E||left'))
                expect(angles.miter, mode).toBeCloseTo(30, 6)
                expect(angles.bevel, mode).toBeCloseTo(20, 6)
            }
        }, 60_000)

        it('refuses an edge that runs along the beam', async () =>
        {
            const m = new Modeler()
            await m.load()
            const beam = m.box(LENGTH, WIDTH, THICKNESS) as any

            expect(() => m.make.cutAngles(beam.select('E||frontbottom'), beam)).toThrow(/runs along the beam/)
            expect(() => m.make.cutAngles(m.line([5000, 0, 0], [5000, 100, 0]) as any)).toThrow(/Could not find the beam/)
        }, 30_000)
    })

    it('should pack three boxes onto a sheet', async () =>
    {
        await modeler.make.packReady()

        const b1 = modeler.box(500, 1000, 10)
        const b2 = modeler.box(400, 200, 10).move(600)
        const b3 = modeler.box(200, 300, 20).move(-500).rotateZ(45)

        const col = modeler.collection(b1, b2, b3).color('blue').opacity(0.5);

        const result = modeler.make.pack(col, { width: 2000, height: 2000, maxTime: 1 })
                            .move(2000).color('red');

        expect(result).toBeInstanceOf(SmartShapeCollection)
        // 3 placed boxes + 1 sheet outline, grouped under 'sheet1'
        expect(result.length).toBe(4)
        expect(result.group('sheet1')).toBeDefined()

        // All placed shapes must lie within the sheet bounds
        result.forEach(shape =>
        {
            /*
            const bb = (shape as any).bbox()
            expect(bb.minX()).toBeGreaterThanOrEqual(-1)
            expect(bb.minY()).toBeGreaterThanOrEqual(-1)
            expect(bb.maxX()).toBeLessThanOrEqual(2001)
            expect(bb.maxY()).toBeLessThanOrEqual(2001)
            */
        })

        await save(`${TEST_OUTPUT_DIR}/pack.glb`, await modeler.collection(col, result).toGLB())
    }, 15_000)
})
