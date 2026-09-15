/**
 * scad.roundtrip.test.ts — exported OpenSCAD rendered by real OpenSCAD, compared with the model.
 *
 * One scene holds a part for every construct the mesh kernel records (it has no cone): primitives in every kind of frame
 * (moved, rotated, sheared by a non-uniform scale, mirrored), booleans with hidden tools, extrusions
 * (perpendicular, oblique, negative, rotated), cuts, faces that touch exactly, and baked polyhedra.
 * Every part is rendered on its own with OpenSCAD 2025.01 (WASM build, a devDependency), with both
 * geometry engines, and must have the model's volume and bounds.
 *
 * Checked with tests/unit/modeler/scad.render.ts. The corpus round trip is tests/cadscripts/scad.roundtrip.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as meshup from '@archiyou/meshup'

import { Modeler } from '../../../src/modeler/Modeler'
import type { ArchiyouModules } from '../../../src/types'
import { installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording } from '../../../src/modeler/Recipe'
import { buildSCAD, type SCADResult } from '../../../src/modeler/SCADExporter'
import { renderPart, compareWithShape, type SCADBackend } from './scad.render'

describe('OpenSCAD round trip', () =>
{
    let modeler: Modeler
    let result: SCADResult
    const shapes = new Map<string, any>()

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        installRecipeRecorder()
        setRecipeRecording(true)

        const box = (...a: Parameters<Modeler['box']>) => modeler.box(...a) as any
        const line = (a: number[], b: number[]) => modeler.line(a as any, b as any) as any

        box(100, 50, 20).move(10, 20, 30).name('moved')
        box(100, 50, 20).rotateZ(30).rotateX(20).move(0, 200, 0).name('rotated')
        box(40, 40, 40).rotateZ(45).scale([2, 1, 0.5], [0, 0, 0]).move(300, 0, 0).name('sheared')
        box(60, 30, 10).move(50, 0, 0).mirror('x', 0).name('mirrored')
        ;(modeler.cylinder(15, 80) as any).rotateY(30).move(0, 400, 0).name('cylinder')
        ;(modeler.sphere(25, [0, 800, 0]) as any).name('sphere')

        const main = box(50).color('red').name('startScript')
        main.subtract(box(25).moveTo(main.bbox().corner('leftfronttop')).hide())
        main.move(500, 0, 0)

        box(20).union((modeler.sphere(12, [10, 0, 0]) as any).hide()).move(700, 0, 0).name('union')
        box(20).intersect((modeler.sphere(12) as any).hide()).move(900, 0, 0).name('intersection')

        line([0, 1000, 0], [100, 1000, 50]).extrude(20, [0, 1, 0]).extrude(10).name('beam')
        line([200, 1000, 0], [300, 1000, 0]).extrude(50, [0, 1, 0]).extrude(30, [1, 0, 1]).name('oblique')
        line([400, 1000, 0], [400, 1000, 300]).extrude(38, [1, 0, 0]).extrude(-89).name('negative')
        const board = (modeler.rectBetween([0, 0, 0], [400, 300, 0]) as any).extrude(18).name('board')
        board.rotateX(20); board.move(600, 1000, 0)

        box(100, 10, 10).cutoff('x', 20).move(0, 1200, 0).name('cutoff')
        box(100, 10, 10).cutoffBy(box(50, 50, 50).move(50, 0, 0).hide(), true).move(200, 1200, 0).name('cutoffBy')

        // tools flush with the base: faces coincide exactly (slidercabinet's backplate and rebates)
        const panel = (modeler.boxBetween([0, 1400, 0], [600, 1418, 800]) as any).name('flush')
        panel.subtract((modeler.boxBetween([0, 1409, 0], [600, 1418, 800]) as any).hide())
        const back = (modeler.boxBetween([0, 1409, 0], [600, 1418, 800]) as any).name('flushBack')
        back.subtract((modeler.boxBetween([0, 1400, 0], [18, 1418, 800]) as any).hide())

        const plate = box(100, 100, 10).move(0, 1600, 0).name('bakedPlate')
        plate.subtract(box(20, 20, 50).move(0, 1600, 0).hide())
        plate.inverse().inverse()   // unrecorded: exported as a polyhedron, its top and bottom faces have a hole

        result = buildSCAD(modeler.scene(), { units: 'mm' })!
        for (const node of modeler.scene().descendants())
        {
            const shape = node.shape()
            if (shape) shapes.set(node.path(), shape)
        }
    }, 120_000)

    afterAll(() => uninstallRecipeRecorder())

    it('writes every construct as the part it should be', () =>
    {
        const kinds = Object.fromEntries(result.parts.map(p => [p.label, p.kind]))
        expect(result.parts).toHaveLength(Object.keys(kinds).length)   // no tool leaked out as a part of its own
        expect(kinds).toMatchObject({ moved: 'csg', rotated: 'csg', sheared: 'csg', mirrored: 'csg', cylinder: 'csg', sphere: 'csg',
            startScript: 'csg', union: 'csg', intersection: 'csg', beam: 'csg', oblique: 'csg', negative: 'csg', board: 'csg',
            cutoff: 'csg', cutoffBy: 'csg', flush: 'csg', flushBack: 'csg', bakedPlate: 'baked' })
    })

    /** Spheres are the one construct whose facets differ: meshup puts vertices on the poles, OpenSCAD
     *  offsets its rings by half a step. Everything else is the same polygons, so the volume is exact. */
    const curved = new Set(['sphere', 'union', 'intersection'])
    const volumeTolerance = (label: string) => curved.has(label) ? 1e-3 : 1e-5
    const boundsTolerance = (label: string) => curved.has(label) ? 1e-2 : 1e-5

    for (const backend of ['Manifold', 'CGAL'] as SCADBackend[])
    {
        it(`renders every part with ${backend} to the model's volume and bounds`, async () =>
        {
            const rows: string[] = []
            for (const part of result.parts)
            {
                const rendered = await renderPart(result.text, part.module, backend)
                const c = compareWithShape(rendered, shapes.get(part.path), volumeTolerance(part.label), boundsTolerance(part.label))
                if (!c.match) rows.push(`${part.module} (${part.kind}): ${c.detail}${rendered.warnings.length ? `; ${rendered.warnings.join('; ')}` : ''}`)
            }
            expect(rows).toEqual([])
            expect(result.parts).toHaveLength(18)
        }, 600_000)
    }
})
