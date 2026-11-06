/** make.foldoutView(): the plan with its elevations folded out around it.
 *
 *  The model is lopsided on purpose: a low base with a tall tower in one corner. Where the tower
 *  shows up in each view says whether the view lines up with the plan, whether it is a view
 *  rather than a mirror image, and whether its top points the right way.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { MaterialManager } from '../../../src/materials/MaterialManager'
import type { ArchiyouModules } from '../../../src/types'
import {
    FOLDOUT_SIDES, convexHull, foldoutPlacement, outermostAt, projectableCoordinates, projectionLine, rotateSheetPoint,
} from '../../../src/modeler/foldoutView'
import type { FoldoutSide, SheetPoint, SheetSegment } from '../../../src/modeler/foldoutView'

let modeler: Modeler
let annotator: Annotator

beforeAll(async () =>
{
    modeler = new Modeler()
    await modeler.load()
    annotator = new Annotator()
    const modules = { modeler, annotator, materials: new MaterialManager() } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    annotator.setArchiyou(modules)
}, 60_000)

/** A 2000 x 1000 x 500 base, with a 400 x 300 tower of 1500 high in its front left corner */
const BASE = { x: 2000, y: 1000, z: 500 }
const TOWER = { x: 400, y: 300, z: 1500 }
function model(): any
{
    modeler.scene().clear?.()
    const base = modeler.boxBetween([0, 0, 0], [BASE.x, BASE.y, BASE.z]) as any
    const tower = modeler.boxBetween([0, 0, 0], [TOWER.x, TOWER.y, TOWER.z]) as any
    return modeler.collection(base, tower)
}

const segmentsOf = (drawing: any): Array<SheetSegment> =>
    drawing.toArray().flatMap((curve: any) =>
    {
        const pts: Array<SheetPoint> = curve.points().map((p: any) => ({ x: p.x, y: p.y }))
        return pts.slice(1).map((p, i) => [pts[i], p] as SheetSegment)
    })
const pointsOf = (drawing: any): Array<SheetPoint> => segmentsOf(drawing).flat()

const near = (a: number, b: number, tolerance = 1e-3) => Math.abs(a - b) <= tolerance
const dimsSince = (count: number) => annotator.getAnnotations().slice(count) as Array<any>

describe('foldoutView geometry', () =>
{
    it('third angle puts each view on the side it looks at, first angle on the other', () =>
    {
        expect(foldoutPlacement('front').side).toBe(-1)
        expect(foldoutPlacement('right').side).toBe(1)
        expect(foldoutPlacement('front', 'first').side).toBe(1)
        expect(foldoutPlacement('right', 'first').rotation).toBe(foldoutPlacement('right').rotation)
    })

    it('turns sheet points exactly on quarter turns', () =>
    {
        expect(rotateSheetPoint({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 1 })
        expect(rotateSheetPoint({ x: 2, y: 3 }, 180)).toEqual({ x: -2, y: -3 })
    })

    it('finds the outermost point of a drawing on a line, and a slope rather than a box', () =>
    {
        const gable: Array<SheetSegment> = [[{ x: 0, y: 0 }, { x: 10, y: 5 }], [{ x: 10, y: 5 }, { x: 20, y: 0 }]]
        expect(outermostAt(gable, 'x', 5, 1, 1e-9)).toBeCloseTo(2.5)
        expect(outermostAt(gable, 'x', 30, 1, 1e-9)).toBeNull()
    })

    it('projects only the corners seen from a side', () =>
    {
        // an L: the inner corner at (10, 10) is seen from the right (+x) side only
        const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }]
        const ring = pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as SheetSegment)
        expect(convexHull(pts)).toHaveLength(5)
        expect(projectableCoordinates(pts, ring, { axis: 'y', across: 'x', side: 1 }, 1e-9)).toEqual([0, 10, 20])
        expect(projectableCoordinates(pts, ring, { axis: 'x', across: 'y', side: 1 }, 1e-9)).toEqual([0, 10, 20])
        expect(projectableCoordinates(convexHull(pts), ring, { axis: 'x', across: 'y', side: -1 }, 1e-9)).toEqual([0, 20])
    })

    it('leaves a gap at both ends of a projection line, and no line where there is no room', () =>
    {
        expect(projectionLine(5, 0, 10, { axis: 'x', side: 1 }, 1)).toEqual([{ x: 5, y: 1 }, { x: 5, y: 9 }])
        expect(projectionLine(5, 0, -10, { axis: 'x', side: -1 }, 1)).toEqual([{ x: 5, y: -1 }, { x: 5, y: -9 }])
        expect(projectionLine(5, 0, 1.5, { axis: 'x', side: 1 }, 1)).toBeNull()
    })
})

describe('make.foldoutView()', () =>
{
    /** Each view lines up with the plan, is a view and not a mirror image, has its top the right
     *  way and sits on the right side: the tower is where it is in the plan. */
    function expectFoldedOut(result: any, projection: 'third' | 'first', sides: ReadonlyArray<FoldoutSide> = FOLDOUT_SIDES)
    {
        const plan = result.group('plan')
        const pb = plan.bbox()
        // the tower in the plan: its x and y ranges, from the front left corner of the plan
        const tower = { x: [pb.min().x, pb.min().x + TOWER.x], y: [pb.min().y, pb.min().y + TOWER.y] }

        sides.forEach(side =>
        {
            const placement = foldoutPlacement(side, projection)
            const view = result.group(side)
            expect(view, side).toBeDefined()
            const vb = view.bbox()

            // on the right side of the plan, the gap away
            const centre = vb.center()[placement.across]
            expect(Math.sign(centre - pb.center()[placement.across]), side).toBe(placement.side)

            // the tower is the highest part: the points furthest toward the top of the view
            const up = rotateSheetPoint({ x: 0, y: 1 }, placement.rotation)
            const height = (p: SheetPoint) => p.x * up.x + p.y * up.y
            const pts = pointsOf(view)
            const top = Math.max(...pts.map(height))
            const atTop = pts.filter(p => near(height(p), top))
            const range = tower[placement.axis]
            atTop.forEach(p => expect(p[placement.axis], `${side} tower`).toBeGreaterThanOrEqual(range[0] - 1e-3))
            atTop.forEach(p => expect(p[placement.axis], `${side} tower`).toBeLessThanOrEqual(range[1] + 1e-3))

            // third angle: the top toward the plan; first angle: the base
            const towardPlan = -placement.side
            const topIsTowardPlan = Math.sign(up[placement.across]) === towardPlan
            expect(topIsTowardPlan, `${side} top toward plan`).toBe(projection === 'third')
        })
    }

    it('third angle: every view lines up with the plan, top toward it', () =>
    {
        const result = modeler.make.foldoutView(model(), { dims: false, projectionLines: false })
        expectFoldedOut(result, 'third')
    })

    it('first angle: on the other side, base toward the plan', () =>
    {
        const result = modeler.make.foldoutView(model(), { projection: 'first', dims: false, projectionLines: false })
        expectFoldedOut(result, 'first')
    })

    it('puts the plan centre at `at` and each view `gap` away', () =>
    {
        const result = modeler.make.foldoutView(model(), { at: [5000, -3000], gap: 700, dims: false, projectionLines: false })
        const pb = result.group('plan').bbox()
        expect(pb.center().x).toBeCloseTo(5000, 6)
        expect(pb.center().y).toBeCloseTo(-3000, 6)
        expect(pb.min().y - result.group('front').bbox().max().y).toBeCloseTo(700, 6)
        expect(result.group('back').bbox().min().y - pb.max().y).toBeCloseTo(700, 6)
        expect(pb.min().x - result.group('left').bbox().max().x).toBeCloseTo(700, 6)
        expect(result.group('right').bbox().min().x - pb.max().x).toBeCloseTo(700, 6)
    })

    it('draws only the views asked for', () =>
    {
        const result = modeler.make.foldoutView(model(), { views: ['front', 'right'], dims: false })
        expect(result.groupNames()).toEqual(expect.arrayContaining(['plan', 'front', 'right']))
        expect(result.groupNames()).not.toContain('back')
        expect(result.groupNames()).not.toContain('left')
        expect(() => modeler.make.foldoutView(model(), { views: ['top' as any] })).toThrow(/unknown view/)
    })

    it('a section plan: what is cut, nothing above the cut', () =>
    {
        // cut through the tower only, above the base: the plan is the tower's cut and the base below it
        const result = modeler.make.foldoutView(model(), { cutHeight: 1000, dims: false, projectionLines: false })
        const plan = result.group('plan')
        const cut = plan.toArray().filter((c: any) => c.hasClass?.('cut') ?? true)
        expect(cut.length).toBeGreaterThan(0)
        expect(plan.bbox().width()).toBeCloseTo(BASE.x, 3)
        // a cut above everything is the plain top view; below everything there is nothing to see
        expect(modeler.make.foldoutView(model(), { cutHeight: 99999, dims: false }).group('plan').bbox().width()).toBeCloseTo(BASE.x, 3)
        expect(() => modeler.make.foldoutView(model(), { cutHeight: -100 })).toThrow(/nothing is cut/)
    })

    it('projection lines run from the outer corners of the plan to the silhouette of each view', () =>
    {
        const gap = 1000
        const result = modeler.make.foldoutView(model(), { gap, dims: false })
        const lines = result.group('projectionLines').toArray()
        // the plan is a rectangle: two outer corners projected to each of four views
        expect(lines).toHaveLength(8)

        const pb = result.group('plan').bbox()
        const front = result.group('front').bbox()
        const toFront = lines
            .map((l: any) => l.points().map((p: any) => ({ x: p.x, y: p.y })))
            .filter((pts: Array<SheetPoint>) => near(pts[0].x, pts[1].x) && pts.every(p => p.y < pb.min().y))
        expect(toFront).toHaveLength(2)
        toFront.forEach((pts: Array<SheetPoint>) =>
        {
            expect(Math.max(pts[0].y, pts[1].y)).toBeCloseTo(pb.min().y - gap * 0.06, 6) // a gap below the plan
        })
        // a gap above the silhouette: the one at the tower ends near the top of the view, the other
        // lands on the low base, not on the box around the view
        const ends = toFront.map((pts: Array<SheetPoint>) => Math.min(pts[0].y, pts[1].y))
        expect(Math.max(...ends)).toBeCloseTo(front.max().y + gap * 0.06, 6)
        expect(Math.max(...ends) - Math.min(...ends)).toBeCloseTo(TOWER.z - BASE.z, 3)
    })

    it("projects every corner seen from a side with 'features', none with false", () =>
    {
        const outline = modeler.make.foldoutView(model(), { dims: false }).group('projectionLines').toArray().length
        const features = modeler.make.foldoutView(model(), { dims: false, projectionLines: 'features' }).group('projectionLines').toArray().length
        expect(features).toBeGreaterThan(outline)
        expect(modeler.make.foldoutView(model(), { dims: false, projectionLines: false }).groupNames()).not.toContain('projectionLines')
    })

    it('dimensions the plan in the gaps and the height beside the first view', () =>
    {
        const before = annotator.getAnnotations().length
        const gap = 1000
        const result = modeler.make.foldoutView(model(), { gap })
        const dims = dimsSince(before)
        expect(dims.map(d => Math.round(d.value)).sort((a, b) => a - b)).toEqual([BASE.y, TOWER.z, BASE.x])

        // the width lies in the gap below the plan, toward the front view
        const pb = result.group('plan').bbox()
        const width = dims.find(d => Math.round(d.value) === BASE.x)
        expect(width._calculatePoint('start').y).toBeCloseTo(pb.min().y - gap * 0.4, 3)

        // the dimensions travel with the drawn lines
        expect(result.getAnnotations()).toEqual(expect.arrayContaining(dims))
    })

    it("measures a section on what it cuts, and every view with dims: 'views'", () =>
    {
        const before = annotator.getAnnotations().length
        modeler.make.foldoutView(model(), { cutHeight: 1000, dims: 'views' })
        const dims = dimsSince(before)
        // the cut is the tower: 400 x 300; then the height and width of every view
        expect(dims).toHaveLength(2 + 2 * 4)
        expect(dims.slice(0, 2).map(d => Math.round(d.value))).toEqual([TOWER.x, TOWER.y])
    })

    it('makes no dimensions with dims: false, and carries none over from the model', () =>
    {
        const shapes = model()
        modeler.line([0, 0, 0], [BASE.x, 0, 0]).dim({ offset: -300 }) // a dimension in the model
        const before = annotator.getAnnotations().length
        modeler.make.foldoutView(shapes, { dims: false })
        expect(dimsSince(before)).toHaveLength(0)
    })

    it('leaves the shapes as they are, and makes one group in the scene', () =>
    {
        const shapes = model()
        const box = shapes.bbox()
        const result = modeler.make.foldoutView(shapes)
        expect(shapes.bbox().min().toArray()).toEqual(box.min().toArray())
        expect(shapes.bbox().max().toArray()).toEqual(box.max().toArray())
        expect(result._layer?.name).toBe('foldoutView')
        expect(modeler.scene().find('elevation')).toBeUndefined()
        expect(modeler.scene().find('section')).toBeUndefined()
    })

    it('writes what each line is as a class, for the styler', () =>
    {
        const svg = modeler.make.foldoutView(model(), { cutHeight: 1000 }).toSVG() as string
        expect(svg).toMatch(/class="[^"]*\bprojection\b/)
        expect(svg).toMatch(/class="[^"]*\bcut\b/)
    })

    it('says so when there is nothing to draw', () =>
    {
        expect(() => modeler.make.foldoutView(modeler.collection())).toThrow(/nothing to draw/)
    })
})
