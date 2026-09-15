import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as meshup from '@archiyou/meshup'

import { Modeler } from '../../../src/modeler/Modeler'
import * as brep from '../../../src/modeler/brep/index'
import { brepShapeToMeshup } from '../../../src/modeler/brep/toMeshup'
import type { ArchiyouModules } from '../../../src/types'
import {
    installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording, isRecipeRecording,
    recipeOf, resolveRecipe, verifyRecipe, explainRecipe, explainNode, isRecipeLive,
    affineInverse, affineApply, affineCompose, rotationMatrix, mirrorMatrix, affineFrame, axesToQuaternion,
    asCuboid, leafNodes, classify, mapRecipe, RecipeReport, outputsNeedRecipes, nodeBounds,
    type Recipe, type RecipeNode, type LeafNode, type RecipeMapping, type ClassificationRule,
} from '../../../src/modeler/Recipe'

/**
 * Recipe capture for the mesh kernel. See src/modeler/Recipe.ts and plans/OPENSCAD.md.
 *
 * The central assertion is `expectOnLeaves()`: every vertex of the real mesh, mapped back through
 * the inverse of its leaf's matrix, must lie on that primitive's surface. Bounds alone cannot see a
 * rotation with the wrong sign on a symmetric shape; this can.
 */
describe('Recipe', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        installRecipeRecorder()
    })

    afterAll(() => uninstallRecipeRecorder())

    beforeEach(() =>
    {
        modeler.reset()
        setRecipeRecording(true)
    })

    const mesh = (s: unknown) => s as meshup.Mesh
    // The Modeler returns the kernel-neutral shape type; these runs are mesh kernel
    const makeBox = (...a: Parameters<Modeler['box']>) => modeler.box(...a) as meshup.Mesh
    const makeCylinder = (...a: Parameters<Modeler['cylinder']>) => modeler.cylinder(...a) as meshup.Mesh
    const makeSphere = (...a: Parameters<Modeler['sphere']>) => modeler.sphere(...a) as meshup.Mesh
    const recipe = (s: unknown): Recipe =>
    {
        const r = recipeOf(s)
        expect(r, 'shape has a recipe').not.toBeNull()
        return r as Recipe
    }
    const ops = (s: unknown) => recipe(s).steps.map(step => step.op)
    const nodeBoundsOf = (n: RecipeNode) => nodeBounds(n)!
    const tree = (s: unknown) => resolveRecipe(recipe(s))

    /** Largest distance of any vertex of `shape` from the surface of the single leaf of its recipe. */
    function surfaceError(shape: meshup.Mesh | Array<{ x: number; y: number; z: number }>, leaf: LeafNode): number
    {
        const inv = affineInverse(leaf.matrix)!
        const scale = Math.max(...affineFrame(leaf.matrix).scales)
        let worst = 0
        for (const p of Array.isArray(shape) ? shape : shape.positions())
        {
            const [x, y, z] = affineApply(inv, [p.x, p.y, p.z])
            let e: number
            switch (leaf.step.op)
            {
                case 'box':
                {
                    const [hw, hd, hh] = leaf.step.size.map(s => s / 2)
                    const inside = Math.max(Math.abs(x) - hw, Math.abs(y) - hd, Math.abs(z) - hh)
                    e = Math.abs(inside) // 0 on a face, negative inside, positive outside
                    break
                }
                case 'cylinder':
                {
                    const r = Math.hypot(x, y), R = leaf.step.radius, h = leaf.step.height
                    const onCap = Math.min(Math.abs(z), Math.abs(z - h)) + Math.max(0, r - R)
                    const onWall = Math.abs(r - R) + Math.max(0, -z, z - h)
                    e = Math.min(onCap, onWall)
                    break
                }
                case 'sphere':
                    e = Math.abs(Math.hypot(x, y, z) - leaf.step.radius)
                    break
                case 'cone':
                {
                    const { r1, r2, height: h } = leaf.step
                    const rAt = r1 + (r2 - r1) * Math.min(1, Math.max(0, z / h))
                    const r = Math.hypot(x, y)
                    e = Math.min(Math.min(Math.abs(z), Math.abs(z - h)) + Math.max(0, r - Math.max(r1, r2)), Math.abs(r - rAt) + Math.max(0, -z, z - h))
                    break
                }
                default:
                    e = Infinity
            }
            worst = Math.max(worst, e * scale)
        }
        return worst
    }

    function expectOnLeaf(shape: unknown, tolerance = 1e-6)
    {
        const node = tree(shape)
        expect(node.kind, explainRecipe(shape)).toBe('leaf')
        expect(surfaceError(mesh(shape), node as LeafNode), explainRecipe(shape)).toBeLessThan(tolerance)
        expect(verifyRecipe(shape).ok, explainRecipe(shape)).toBe(true)
    }

    //// gating ////

    describe('gating', () =>
    {
        it('asks for recipes only when a recipe format is requested', () =>
        {
            expect(outputsNeedRecipes(['default/model/glb'])).toBe(false)
            expect(outputsNeedRecipes(['default/model/fcstd'])).toBe(true)
            expect(outputsNeedRecipes(['default/model/fcstd?params=true'])).toBe(true)
            expect(outputsNeedRecipes(['default/model/*'])).toBe(true)
            expect(outputsNeedRecipes(['default/tables/*/xlsx'])).toBe(false)
            expect(outputsNeedRecipes(undefined)).toBe(false)
        })

        it('records nothing while recording is off', () =>
        {
            setRecipeRecording(false)
            const box = makeBox(10)
            box.move(10, 0, 0)
            expect(isRecipeRecording()).toBe(false)
            expect(recipeOf(box)).toBeNull()
            expect(explainRecipe(box)).toContain('no recipe')
        })

        it('covers every row in the capture table (fails when meshup renames a method)', () =>
        {
            uninstallRecipeRecorder()
            const { missingRows } = installRecipeRecorder()
            expect(missingRows).toEqual([])
        })
    })

    //// leaves ////

    describe('primitives', () =>
    {
        it('records box, cylinder and sphere in their local frames', () =>
        {
            const box = makeBox(10, 20, 30)
            expect(recipe(box).steps).toEqual([{ op: 'box', size: [10, 20, 30] }])
            expectOnLeaf(box)

            const cyl = makeCylinder(5, 10)
            expect(recipe(cyl).steps).toEqual([{ op: 'cylinder', radius: 5, height: 10 }])
            expectOnLeaf(cyl)

            const sphere = makeSphere(7)
            expect(recipe(sphere).steps).toEqual([{ op: 'sphere', radius: 7 }])
            expectOnLeaf(sphere, 1e-4)
        })

        it('records the position argument as a translate', () =>
        {
            const box = makeBox(10, 10, 10, [5, 6, 7])
            expect(ops(box)).toEqual(['box', 'translate'])
            expectOnLeaf(box)
        })

        it('records Mesh.Cube and the defaults of Mesh.Box', () =>
        {
            expect(recipe(meshup.Mesh.Cube(4)).steps).toEqual([{ op: 'box', size: [4, 4, 4] }])
            expect(recipe(meshup.Mesh.Box(4)).steps).toEqual([{ op: 'box', size: [4, 4, 4] }])
            expectOnLeaf(meshup.Mesh.Cube(4))
        })
    })

    //// transforms ////

    describe('transforms', () =>
    {
        it('composes translate, rotate around the origin and rotateAround a pivot', () =>
        {
            const box = makeBox(10, 20, 30)
            box.move(50, 0, 0)
            box.rotate(30, 'z')
            box.rotateAround(45, [1, 1, 0], [10, 20, 30])
            box.rotateX(15)
            expect(ops(box)).toEqual(['box', 'translate', 'rotate', 'rotate', 'rotate'])
            expectOnLeaf(box)
        })

        it('records rotate around an arbitrary vector axis', () =>
        {
            const cyl = makeCylinder(5, 40)
            cyl.move(3, 4, 5)
            cyl.rotate(37, [1, 2, 3])
            expectOnLeaf(cyl, 1e-5)
        })

        it('records rotateQuaternion as a rotation plus the re-centring it does', () =>
        {
            const box = makeBox(10, 20, 30, [100, 0, 0])
            const s = Math.sin(Math.PI / 8), c = Math.cos(Math.PI / 8) // 45° around z
            box.rotateQuaternion(c, 0, 0, s)
            expect(ops(box)).toEqual(['box', 'translate', 'rotate', 'translate'])
            expectOnLeaf(box)
        })

        it('records composites that only call recorded rows: moveTo, align, alignByPoints, rotateSwing', () =>
        {
            const box = makeBox(10, 20, 30)
            box.moveTo(1, 2, 3)
            box.align([100, 100, 100], 'bottom')
            box.rotateSwing([1, 0, 0], [0, 1, 1])
            box.alignByPoints([[0, 0, 0], [10, 0, 0], [0, 10, 0]], [[5, 5, 5], [5, 15, 5], [0, 5, 5]])
            expect(isRecipeLive(recipe(box)), explainRecipe(box)).toBe(true)
            expectOnLeaf(box, 1e-5)
        })

        it('records uniform and per-axis scale around the centre or an origin', () =>
        {
            const sphere = makeSphere(10, [20, 0, 0])
            sphere.scale(2)
            sphere.scale(0.5, [0, 0, 0])
            expectOnLeaf(sphere, 1e-4)

            const box = makeBox(10, 10, 10)
            box.scale([1, 2, 3])
            box.rotate(20, 'y')
            expectOnLeaf(box)
            expect(asCuboid(tree(box))?.size.map(v => Math.round(v))).toEqual([10, 20, 30])
        })

        it('records mirror across an axis plane, a normal with a position, and mirrorX', () =>
        {
            const box = makeBox(10, 20, 30, [40, 5, 0])
            box.rotate(10, 'z')
            box.mirror('x', 3)
            box.mirror([0, 1, 1], [1, 2, 3])
            box.mirrorX(12)
            expect(ops(box).filter(o => o === 'mirror')).toHaveLength(3)
            expectOnLeaf(box)
            expect(affineFrame((tree(box) as LeafNode).matrix).handedness).toBe(-1)
        })

        it('records moveToCenter and place as measured translations', () =>
        {
            const cyl = makeCylinder(5, 10, [30, 30, 30])
            cyl.moveToCenter()
            cyl.place(4)
            expect(ops(cyl)).toEqual(['cylinder', 'translate', 'translate', 'translate'])
            expectOnLeaf(cyl, 1e-5)
        })
    })

    //// booleans ////

    describe('booleans', () =>
    {
        it('records subtract as a cut with the tool recipe, and verifies containment', () =>
        {
            const base = makeBox(100, 50, 20)
            const hole = makeCylinder(5, 40, [10, 0, -20])
            const result = base.subtract(hole)
            expect(result).toBe(base)
            const node = tree(base)
            expect(node.kind).toBe('boolean')
            expect((node as any).op).toBe('cut')
            expect(leafNodes(node).map(l => l.step.op)).toEqual(['box', 'cylinder'])
            expect(verifyRecipe(base).ok, explainRecipe(base)).toBe(true)
        })

        it('merges consecutive cuts and pushes a later transform down to every leaf', () =>
        {
            const base = makeBox(100, 100, 10)
            const a = makeBox(10, 10, 30, [-20, 0, 0])
            const b = makeBox(10, 10, 30, [20, 0, 0])
            base.subtract(a)
            base.subtract(b)
            base.rotate(90, 'x')
            base.move(0, 0, 500)

            const node = tree(base)
            expect(node.kind).toBe('boolean')
            expect((node as any).tools).toHaveLength(2)
            expect(verifyRecipe(base).ok, explainRecipe(base)).toBe(true)

            // The tools' own recipes are snapshots: moving a tool afterwards changes nothing
            a.move(1000, 0, 0)
            const [, toolA] = leafNodes(tree(base))
            expect(affineApply(toolA.matrix, [0, 0, 0]).map(v => Math.round(v))).toEqual([-20, 0, 500])
        })

        it('records union as fuse and intersect as common', () =>
        {
            const a = makeBox(20)
            a.union(makeSphere(12, [10, 0, 0]))
            expect(resolveRecipe(recipe(a))).toMatchObject({ kind: 'boolean', op: 'fuse' })
            expect(verifyRecipe(a).ok).toBe(true)

            const b = makeBox(20)
            b.intersect(makeSphere(12))
            expect(resolveRecipe(recipe(b))).toMatchObject({ kind: 'boolean', op: 'common' })
            expect(verifyRecipe(b).ok).toBe(true)
        })

        it('keeps intersection() non-replacing: the original keeps its own recipe', () =>
        {
            const a = makeBox(20)
            const shared = mesh(a).intersection(mesh(makeSphere(12)))
            expect(ops(a)).toEqual(['box'])
            expect(ops(shared)).toEqual(['box', 'common'])
        })

        it('bakes the parts when a cut splits the solid', () =>
        {
            const bar = makeBox(100, 10, 10)
            const parts = bar.subtract(makeBox(10, 50, 50))
            expect(meshup.ShapeCollection.isShapeCollection(parts)).toBe(true)
            for (const part of (parts as meshup.ShapeCollection<meshup.Mesh>).toArray())
            {
                const r = recipe(part)
                expect(isRecipeLive(r)).toBe(false)
                expect(r.steps[0].op).toBe('box') // still says where it came from
            }
        })

        it('records a baked tool as baked, leaving the decision to the mapping', () =>
        {
            const base = makeBox(50)
            const tool = makeBox(10)
            ;(tool as any).inverse().inverse() // unrecorded, but geometrically a no-op
            base.subtract(tool)
            const [, toolNode] = [(tree(base) as any).base, (tree(base) as any).tools[0]]
            expect(toolNode.kind).toBe('baked')
        })
    })

    //// unrecorded operations ////

    describe('unrecorded operations', () =>
    {
        it('kills the recipe with the name of the method that changed the geometry', () =>
        {
            const box = makeBox(10)
            box.move(5, 0, 0)
            ;(box as any).inverse()
            const r = recipe(box)
            expect(isRecipeLive(r)).toBe(false)
            expect(r.steps.at(-1)).toEqual({ op: 'baked', reason: 'inverse() is not recorded' })

            // a dead recipe stops growing
            box.move(1, 0, 0)
            expect(recipe(box).steps.at(-1)?.op).toBe('baked')
        })

        it('detects a direct change of the inner mesh by identity', () =>
        {
            const box = makeBox(10)
            mesh(box).update(mesh(makeBox(20)).inner().clone())
            expect(recipe(box).steps.at(-1)).toEqual({ op: 'baked', reason: 'changed by an unrecorded operation' })
        })

        it('marks new meshes from unrecorded constructors with their origin', () =>
        {
            const flat = meshup.Mesh.fromPolygons([[[0, 0, 0], [10, 0, 0], [10, 10, 0]]])
            expect(recipe(flat).steps).toEqual([{ op: 'baked', reason: 'made by Mesh.fromPolygons()' }])
        })
    })


    //// boxbetween, extrusions and cuts ////

    /** An extrusion recipe is exact: the mesh has exactly the ring and the moved ring as corners,
     *  and the prism's volume (ring area times the sweep across the ring's plane). */
    function expectExtrusion(shape: unknown, volume?: number)
    {
        const node = tree(shape) as LeafNode
        expect(node.kind, explainRecipe(shape)).toBe('leaf')
        expect(node.step.op).toBe('extrude')
        const step = node.step as Extract<LeafNode['step'], { op: 'extrude' }>
        const corners = [...step.ring, ...step.ring.map(p => [p[0] + step.vector[0], p[1] + step.vector[1], p[2] + step.vector[2]] as const)]
            .map(p => affineApply(node.matrix, p))
        const key = (p: ArrayLike<number>) => Array.from(p).map(v => Math.round(v * 1e4) / 1e4 + 0).join(',')
        const expected = new Set(corners.map(key))
        const actual = new Set(mesh(shape).positions().map(p => key([p.x, p.y, p.z])))
        expect([...actual].sort(), explainRecipe(shape)).toEqual([...expected].sort())
        expect(verifyRecipe(shape).ok, explainRecipe(shape)).toBe(true)
        if (volume !== undefined) expect(mesh(shape).volume()).toBeCloseTo(volume, 3)
    }

    describe('boxbetween', () =>
    {
        it('records a box between two corners in any order, with the midpoint as its move', () =>
        {
            const a = meshup.Mesh.BoxBetween([10, 0, 0], [0, 20, -30])
            expect(recipe(a).steps).toEqual([{ op: 'box', size: [10, 20, 30] }, { op: 'translate', v: [5, 10, -15] }])
            expectOnLeaf(a)

            const b = modeler.boxBetween([0, 0, 0], [100, 38, 89]) as meshup.Mesh
            expectOnLeaf(b)
            expect(asCuboid(tree(b))?.size).toEqual([100, 38, 89])
        })

        it('keeps a boolean on a boxbetween procedural', () =>
        {
            const panel = modeler.boxBetween([0, 0, 0], [600, 18, 800]) as meshup.Mesh
            panel.subtract(modeler.boxBetween([100, -5, 100], [500, 25, 700]) as meshup.Mesh)
            expect(tree(panel)).toMatchObject({ kind: 'boolean', op: 'cut' })
            expect(verifyRecipe(panel).ok, explainRecipe(panel)).toBe(true)
        })
    })

    describe('extrusions', () =>
    {
        it('records line → extrude → extrude as a prism of the face', () =>
        {
            const face = modeler.line([0, 0, 0], [100, 0, 0]).extrude(20, [0, 1, 0]) as unknown as meshup.Polygon
            expect(face).toBeInstanceOf(meshup.Polygon)
            const beam = face.extrude(10)
            expectExtrusion(beam, 100 * 20 * 10)
        })

        it('records a negative length and an axis direction', () =>
        {
            const face = modeler.line([0, 0, 0], [0, 0, 300]).extrude(38, [1, 0, 0]) as unknown as meshup.Polygon
            expectExtrusion(face.extrude(-89), 300 * 38 * 89)
            const other = modeler.line([0, 0, 0], [0, 0, 300]).extrude(38, [1, 0, 0]) as unknown as meshup.Polygon
            expectExtrusion(other.extrude(89, [0, -1, 0]), 300 * 38 * 89)
        })

        it('records an oblique direction as the sheared prism the kernel builds', () =>
        {
            const face = modeler.line([0, 0, 0], [100, 0, 0]).extrude(50, [0, 1, 0]) as unknown as meshup.Polygon
            const sheared = face.extrude(30, [1, 0, 1])
            // area 100 × 50, swept 30 along a 45° direction: height across the plane is 30 / √2
            expectExtrusion(sheared, 100 * 50 * 30 / Math.SQRT2)
        })

        it('records the vertex → line → face → solid chain', () =>
        {
            const edge = (modeler.vertex(10, 20, 30) as any).extrude(100, [1, 0, 0])
            const solid = edge.extrude(40, [0, 1, 0]).extrude(-5)
            expectExtrusion(solid, 100 * 40 * 5)
        })

        it('records rect, rectBetween and polyline faces, and closed curves through their face', () =>
        {
            expectExtrusion((modeler.rectBetween([0, 0, 0], [400, 300, 0]) as any).extrude(18), 400 * 300 * 18)
            const l = (modeler.polyline([[0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 80, 0]]) as any).close()
            expectExtrusion(l.extrude(10), 100 * 65 * 10)
        })

        it('records every member of an extruded collection, and a face of a mesh', () =>
        {
            const faces = new meshup.ShapeCollection([
                modeler.rectBetween([0, 0, 0], [10, 10, 0]) as any,
                modeler.rectBetween([20, 0, 0], [40, 10, 0]) as any,
            ])
            const solids = faces.extrude(5, [0, 0, 1]).toArray()
            expect(solids).toHaveLength(2)
            solids.forEach(s => expectExtrusion(s))

            const top = mesh(makeBox(10, 20, 30)).polygons().toArray().find(p => p.normal().z > 0.5)!
            expectExtrusion(top.extrude(7), 10 * 20 * 7)
        })

        it('records a single-face surface mesh, and bakes a folded one', () =>
        {
            const plate = meshup.Mesh.planeBetween([0, 0, 0], [30, 20, 0])
            expectExtrusion(plate.extrude(4), 30 * 20 * 4)

            const closed = makeBox(10)
            const hull = mesh(closed).extrude(5)!
            expect(recipe(hull).steps).toEqual([{ op: 'baked', reason: 'extrude of a surface with 6 faces' }])
        })

        it('bakes a polygon with holes, which the kernel extrudes without them', () =>
        {
            const ring = new meshup.Polygon([[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]])
            ring.addHole([[25, 25, 0], [25, 75, 0], [75, 75, 0], [75, 25, 0]])
            expect(ring.hasHoles()).toBe(true)
            const solid = ring.extrude(10)
            expect(recipe(solid).steps[0]).toEqual({ op: 'baked', reason: 'extrude of a polygon with holes (the kernel drops the holes)' })
        })

        it('keeps transforms and booleans on an extrusion procedural', () =>
        {
            const beam = (modeler.line([0, 0, 0], [100, 0, 0]).extrude(20, [0, 1, 0]) as any).extrude(10) as meshup.Mesh
            beam.rotateZ(30)
            beam.move(5, 5, 5)
            expectExtrusion(beam)
            beam.subtract(makeBox(10, 100, 100))
            expect(isRecipeLive(recipe(beam)), explainRecipe(beam)).toBe(true)
            expect(tree(beam)).toMatchObject({ kind: 'boolean', op: 'cut', base: { kind: 'leaf', step: { op: 'extrude' } } })
            expect(verifyRecipe(beam).ok, explainRecipe(beam)).toBe(true)
            expect(explainRecipe(beam)).toContain('extrude(4 corners, vector=[0, 0, 10])')
        })
    })

    describe('cutoff and cutoffBy', () =>
    {
        it('records cutoff as a cut by the half-space the kernel removed', () =>
        {
            const bar = makeBox(100, 10, 10)          // x from -50 to 50
            bar.cutoff('x', 20)                        // keeps the larger piece, x < 20
            expect(ops(bar)).toEqual(['box', 'cut'])
            expect(verifyRecipe(bar).ok, explainRecipe(bar)).toBe(true)
            const b = mesh(bar).bbox()
            expect([b.min().x, b.max().x]).toEqual([-50, 20])

            const other = makeBox(100, 10, 10)
            other.cutoff('x', 20, true)                // the smaller piece, x > 20
            expect(ops(other)).toEqual(['box', 'cut'])
            const tool = (tree(other) as any).tools[0]
            expect(nodeBoundsOf(tool).max[0]).toBeCloseTo(20, 9)
        })

        it('records nothing when cutoff misses the shape', () =>
        {
            const bar = makeBox(100, 10, 10)
            bar.cutoff('x', 80)
            expect(ops(bar)).toEqual(['box'])
        })

        it('bakes a cutoff that keeps one piece of a side that fell apart', () =>
        {
            // a U: a bottom slab with two prongs; above z = 0 only the two separate prongs remain
            const u = makeBox(100, 10, 40)
            u.subtract(makeBox(60, 20, 30).move(0, 0, 10))
            u.cutoff('z', 0, true)                     // the smallest piece is one prong
            const r = recipe(u)
            expect(isRecipeLive(r)).toBe(false)
            expect(r.steps.at(-1)).toEqual({ op: 'baked', reason: "cutoff() at z=0 kept one piece of a side that fell apart" })
        })

        it('records cutoffBy a solid as a cut or a common, whichever piece the kernel kept', () =>
        {
            const bar = makeBox(100, 10, 10)
            bar.cutoffBy(makeBox(50, 50, 50).move(50, 0, 0))            // outside (x < 25) is larger
            expect(tree(bar)).toMatchObject({ kind: 'boolean', op: 'cut' })
            expect(verifyRecipe(bar).ok, explainRecipe(bar)).toBe(true)

            const other = makeBox(100, 10, 10)
            other.cutoffBy(makeBox(50, 50, 50).move(50, 0, 0), true)    // inside (x > 25) is smaller
            expect(tree(other)).toMatchObject({ kind: 'boolean', op: 'common' })
            expect(verifyRecipe(other).ok, explainRecipe(other)).toBe(true)
        })

        it('keeps a later boolean after a cutoff procedural', () =>
        {
            const beam = (modeler.line([0, 0, 0], [100, 0, 100]).extrude(20, [0, 1, 0]) as any).extrude(10) as meshup.Mesh
            beam.cutoff('z', 20)
            expect(ops(beam)).toEqual(['extrude', 'cut'])
            beam.subtract(makeBox(5, 100, 100))
            expect(isRecipeLive(recipe(beam)), explainRecipe(beam)).toBe(true)
        })
    })

    //// copies ////

    describe('copies', () =>
    {
        it('gives every copy its own recipe', () =>
        {
            const a = makeBox(10)
            const b = a.copy()
            b.move(100, 0, 0)
            expect(ops(a)).toEqual(['box'])
            expect(ops(b)).toEqual(['box', 'translate'])
        })

        it('keeps replicated instances at their own positions', () =>
        {
            const cyl = makeCylinder(2, 10)
            const copies = mesh(cyl).replicate(4, (m, i) => m.move(i * 20, 0, 0))
            copies.toArray().forEach((m, i) =>
            {
                expectOnLeaf(m)
                const origin = affineApply((tree(m) as LeafNode).matrix, [0, 0, 0])
                expect(Math.round(origin[0])).toBe(i * 20)
            })
        })
    })

    //// the scene ////

    it('reading recipes leaves the scene untouched', () =>
    {
        const base = makeBox(100, 50, 20)
        base.subtract(makeCylinder(5, 40, [10, 0, -20]))
        makeSphere(10, [200, 0, 0])

        const snapshot = () => modeler.scene().descendants().map(n => `${n.path()}|${n.parent()?.path()}|${n.shape()?.id?.()}`)
        const before = snapshot()
        for (const node of modeler.scene().descendants())
        {
            const shape = node.shape()
            if (!shape) continue
            explainRecipe(shape)
            verifyRecipe(shape)
            const r = recipeOf(shape)
            if (r) explainNode(resolveRecipe(r))
        }
        expect(snapshot()).toEqual(before)
    })

    //// affine helpers ////

    describe('affine helpers', () =>
    {
        const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

        it('inverts and composes', () =>
        {
            const M = affineCompose(rotationMatrix(33, [1, 2, 3], [4, 5, 6]), mirrorMatrix([0, 1, 0], [0, 7, 0]))
            close(affineCompose(affineInverse(M)!, M), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])
        })

        it('turns orthonormal axes into a quaternion', () =>
        {
            const frame = affineFrame(rotationMatrix(120, [1, 1, 1]))
            const [w, x, y, z] = axesToQuaternion(frame.axes)
            const s = Math.sin(Math.PI / 3) / Math.sqrt(3)
            close([w, x, y, z], [Math.cos(Math.PI / 3), s, s, s])
        })
    })

    //// explain, classification, mapping ////

    describe('explain, classify and map', () =>
    {
        it('explains the steps and the resolved tree', () =>
        {
            const base = makeBox(100, 50, 20)
            base.rotate(30, 'z')
            base.subtract(makeCylinder(5, 40, [10, 0, -20]))
            ;(base as any).name('plate')

            const steps = explainRecipe(base)
            expect(steps).toContain('plate (Mesh)')
            expect(steps).toContain('box(size=[100, 50, 20])')
            expect(steps).toContain('rotate(30°, axis=[0, 0, 1], pivot=[0, 0, 0])')
            expect(steps).toMatch(/cut\n\s+└ cylinder\(radius=5, height=40\)/)
            expect(steps).toContain('[verified: bounds (contained)]')

            const resolved = explainNode(tree(base))
            expect(resolved).toMatch(/^cut\n  ├ base: box/)
            expect(resolved).toMatch(/└ tool: cylinder\(radius=5, height=40\) @ origin=\[/)
        })

        type Ctx = { minSlabArea: number }
        const RULES: ClassificationRule<Ctx>[] = [
            {
                tag: 'ifc:slab', rule: 'thin horizontal box',
                when: (node, _shape, ctx) =>
                {
                    const c = asCuboid(node)
                    return !!c && c.size[2] < Math.min(c.size[0], c.size[1]) / 5 && c.size[0] * c.size[1] > ctx.minSlabArea
                },
                derive: node => ({ thickness: asCuboid(node)!.size[2] }),
                evidence: node => `box ${asCuboid(node)!.size.join('×')}`,
            },
            { tag: 'ifc:proxy', rule: 'anything', when: () => true },
            { tag: 'btlx:drilling', rule: 'cylinder tool', on: 'cylinder', when: () => true },
        ]

        const MAPPING: RecipeMapping<string> = {
            'ifc:slab': (_node, _ctx, c) => `IfcSlab(${c!.params.thickness})`,
            box: node => `Box(${node.step.size.join(',')})`,
            cylinder: node => `Cylinder(${node.step.radius})`,
            cut: (node, ctx) => `Cut(${ctx.map(node.base)}, ${node.tools.map((t: RecipeNode) => ctx.map(t)).join(', ')})`,
        }

        it('classifies with first match per namespace and lets explicit tags win', () =>
        {
            const slab = makeBox(4000, 3000, 200)
            const node = tree(slab)
            const derived = classify(node, slab, RULES, { minSlabArea: 1e6 })
            expect(derived.get(node)?.map(c => c.tag)).toEqual(['ifc:slab'])
            expect(explainNode(node, derived)).toContain("⇒ ifc:slab (derived, rule 'thin horizontal box': box 4000×3000×200)")

            const explicit = classify(node, slab, RULES, { minSlabArea: 1e6 }, [{ tag: 'ifc:wall', params: {}, evidence: '.is()' }])
            expect(explicit.get(node)?.map(c => `${c.tag}:${c.origin}`)).toEqual(['ifc:wall:explicit'])
        })

        it('maps tag rows before kind rows, bakes what has no row, and reports both', () =>
        {
            const report = new RecipeReport()

            const slab = makeBox(4000, 3000, 200)
            const slabNode = tree(slab)
            const slabOut = mapRecipe(slabNode, MAPPING, {
                subject: 'slab', fallback: r => `Baked(${r})`, report,
                classifications: classify(slabNode, slab, RULES, { minSlabArea: 1e6 }),
            })
            expect(slabOut).toBe('IfcSlab(200)')

            const plate = makeBox(100, 50, 20)
            plate.subtract(makeCylinder(5, 40, [10, 0, -20]))
            expect(mapRecipe(recipe(plate), MAPPING, { subject: 'plate', fallback: r => `Baked(${r})`, report }))
                .toBe('Cut(Box(100,50,20), Cylinder(5))')

            const ball = makeSphere(5)
            expect(mapRecipe(recipe(ball), MAPPING, { subject: 'ball', fallback: r => `Baked(${r})`, report }))
                .toBe('Baked(no mapping for sphere)')

            expect(mapRecipe(null, MAPPING, { subject: 'mystery', fallback: r => `Baked(${r})`, report }))
                .toBe('Baked(shape was not recorded)')

            expect(report.summary()).toBe('2 of 4 shapes exported procedurally, 2 baked')
            expect(report.toString()).toContain('· ball: no mapping for sphere')
            expect(report.toString()).toContain('✓ slab [ifc:slab]')
        })
    })
})

/**
 * The same capture for the brep kernel. Moves and rotations are not rows there: OpenCascade changes
 * a shape's Location in place, and the recorder reads it back as a placement.
 */
describe('Recipe on the brep kernel', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        await brep.init()
        modeler = new Modeler('brep')
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        expect(installRecipeRecorder({ mesh: meshup, brep }).missingRows).toEqual([])
    }, 60000)

    afterAll(() => uninstallRecipeRecorder())

    beforeEach(() =>
    {
        modeler.reset()
        setRecipeRecording(true)
    })

    const recipe = (s: unknown): Recipe =>
    {
        const r = recipeOf(s)
        expect(r, 'shape has a recipe').not.toBeNull()
        return r as Recipe
    }
    const tree = (s: unknown) => resolveRecipe(recipe(s))

    /** Vertices of the brep shape's tessellation: they lie on the exact surfaces */
    function vertices(shape: any): Array<{ x: number; y: number; z: number }>
    {
        const out = brepShapeToMeshup(shape) as any
        const mesh = meshup.ShapeCollection.isShapeCollection(out) ? out.toArray().find((m: any) => m instanceof meshup.Mesh) : out
        return mesh.positions()
    }

    function leafError(shape: any, leaf: LeafNode): number
    {
        const inv = affineInverse(leaf.matrix)!
        let worst = 0
        for (const p of vertices(shape))
        {
            const [x, y, z] = affineApply(inv, [p.x, p.y, p.z])
            let e = Infinity
            const step = leaf.step
            if (step.op === 'box')
            {
                const [hw, hd, hh] = step.size.map(v => v / 2)
                e = Math.abs(Math.max(Math.abs(x) - hw, Math.abs(y) - hd, Math.abs(z) - hh))
            }
            else if (step.op === 'cylinder')
            {
                const r = Math.hypot(x, y)
                e = Math.min(Math.min(Math.abs(z), Math.abs(z - step.height)) + Math.max(0, r - step.radius), Math.abs(r - step.radius) + Math.max(0, -z, z - step.height))
            }
            else if (step.op === 'sphere') e = Math.abs(Math.hypot(x, y, z) - step.radius)
            else if (step.op === 'cone')
            {
                const r = Math.hypot(x, y), rAt = step.r1 + (step.r2 - step.r1) * Math.min(1, Math.max(0, z / step.height))
                e = Math.min(Math.min(Math.abs(z), Math.abs(z - step.height)) + Math.max(0, r - Math.max(step.r1, step.r2)), Math.abs(r - rAt) + Math.max(0, -z, z - step.height))
            }
            worst = Math.max(worst, e)
        }
        return worst
    }

    function expectOnLeaf(shape: any, tolerance = 1e-5)
    {
        const node = tree(shape)
        expect(node.kind, explainRecipe(shape)).toBe('leaf')
        expect(leafError(shape, node as LeafNode), explainRecipe(shape)).toBeLessThan(tolerance)
        expect(verifyRecipe(shape).ok, `${explainRecipe(shape)}\n${JSON.stringify(verifyRecipe(shape))}`).toBe(true)
    }

    it('records primitives with the moves the kernel makes while building them', () =>
    {
        const box = modeler.box(10, 20, 30, [5, 6, 7]) as any
        expect(recipe(box).steps[0]).toEqual({ op: 'box', size: [10, 20, 30] })
        expectOnLeaf(box)

        expectOnLeaf(modeler.cylinder(5, 40, [3, 4, 5]))
        expectOnLeaf(modeler.sphere(7, [10, 0, 0]))
        expectOnLeaf(modeler.cone(20, 5, 30, [0, 0, 10]))
    })

    it('records makeBoxBetween with corners in any order', () =>
    {
        const box = modeler.boxBetween([10, 0, 0], [0, 20, 30]) as any
        expect(recipe(box).steps[0]).toEqual({ op: 'box', size: [10, 20, 30] })
        expectOnLeaf(box)
    })

    it('reads moves and rotations back from the Location', () =>
    {
        const box = modeler.box(10, 20, 30) as any
        box.move(50, 0, 0)
        box.rotateAround(30, [0, 0, 1], [0, 0, 0])
        box.rotateX(15)
        box.moveTo(1, 2, 3)
        expectOnLeaf(box)
        expect(recipe(box).steps.map(s => s.op)).toContain('rotate')
    })

    it('records mirror, which returns a new shape, and scale, which rebuilds in place', () =>
    {
        const cyl = modeler.cylinder(5, 40, [30, 0, 0]) as any
        cyl.rotateY(20)
        const mirrored = cyl._mirrored([10, 0, 0], [1, 0, 0])
        expect(recipeOf(cyl)!.steps.some(s => s.op === 'mirror')).toBe(false)
        expectOnLeaf(mirrored)

        const box = modeler.box(10, 10, 10, [20, 0, 0]) as any
        box.scale(2)
        expectOnLeaf(box)
    })

    it('records subtract in place, and union and intersect as new shapes', () =>
    {
        const plate = modeler.box(100, 50, 20) as any
        plate.subtract(modeler.cylinder(5, 40, [10, 0, -20]))
        expect(tree(plate)).toMatchObject({ kind: 'boolean', op: 'cut' })
        expect(verifyRecipe(plate).ok, explainRecipe(plate)).toBe(true)

        const a = modeler.box(20) as any
        const fused = a.union(modeler.sphere(12, [10, 0, 0]))
        expect(tree(fused)).toMatchObject({ kind: 'boolean', op: 'fuse' })
        expect(verifyRecipe(fused).ok, explainRecipe(fused)).toBe(true)

        const b = modeler.box(20) as any
        const common = b.intersect(modeler.sphere(12))
        expect(tree(common)).toMatchObject({ kind: 'boolean', op: 'common' })
        expect(verifyRecipe(common).ok, explainRecipe(common)).toBe(true)
    })

    it('gives copies their own recipe', () =>
    {
        const a = modeler.box(10) as any
        const b = a.copy()
        b.move(100, 0, 0)
        expectOnLeaf(a)
        expectOnLeaf(b)
        expect(affineApply((tree(b) as LeafNode).matrix, [0, 0, 0])[0]).toBeCloseTo(100, 9)
    })

    it('bakes partial primitives and geometry rebuilt by unrecorded operations', () =>
    {
        const segment = new brep.Solid().makeCylinder(5, 10, [0, 0, 0], 90)
        expect(recipe(segment).steps).toEqual([{ op: 'baked', reason: 'a 90° cylinder segment' }])

        const box = modeler.box(20) as any
        box.fillet(2)
        const r = recipe(box)
        expect(isRecipeLive(r)).toBe(false)
        expect(r.steps.at(-1)).toEqual({ op: 'baked', reason: 'fillet() is not recorded' })
    })
})
