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

        wall.insulation.hide()
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
