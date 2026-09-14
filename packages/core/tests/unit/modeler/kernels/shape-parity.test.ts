/**
 *  Mesh ↔ brep RESULT parity for solids and linear shapes.
 *
 *  parity.test.ts pins the *vocabulary* — that both kernels answer to the same method names.
 *  This file pins the *answers*: build the same shape from the same Modeler call on both
 *  kernels, then apply one operation at a time and, after every single step, measure both
 *  shapes and compare. A script must not silently change meaning when the kernel is switched,
 *  and a chain is the only way to catch an operation that is fine in isolation but leaves the
 *  two kernels drifting apart once something else is stacked on top of it.
 *
 *  How a step is judged
 *  --------------------
 *  Every measurement carries its dimensionality (length / area / volume), so tolerances scale
 *  with the shape instead of being hand-tuned per assertion:
 *
 *    allowed  = max(tol × |larger value|,  FLOOR × scale^dim)
 *    aborting = ABORT × max(|larger value|, 1% of scale^dim)
 *
 *  `scale` is the bbox diagonal, so a coordinate that ought to be 0 is compared against an
 *  absolute floor rather than a meaningless relative one. Two tolerance bands are used: EXACT
 *  for analytic primitives (a box is a box on both kernels) and TESSELATED for anything that
 *  goes through meshup's triangulation of a curved surface, where a percent or two is inherent.
 *
 *  A step that blows past ABORT stops the whole chain right there: once the two kernels are
 *  modelling different objects, every later step reports noise, so there is nothing to learn
 *  from continuing.
 *
 *  What is deliberately NOT compared here is inventoried in kernel-divergences.test.ts — the
 *  places where the two kernels genuinely answer differently today. This file routes around
 *  those (explicit rotation pivots, rebinding boolean results, open curves for start/end) so
 *  that a failure here means a NEW drift, not a known one.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { Modeler } from '../../../../src/modeler/Modeler'

//// ==== TOLERANCES ==== ////

/** Analytic primitives and their transforms: both kernels compute these in closed form, so
 *  they should agree to little more than brep's 3-decimal output rounding. */
const EXACT = 0.0005        // 0.05%
/** Anything that passes through meshup's triangulation of a curved surface. */
const TESSELATED = 0.03     // 3%
/** Past this the two kernels are no longer modelling the same object — stop the chain. */
const ABORT = 0.25          // 25%
/** Absolute floor, as a fraction of the shape's own scale, so "should be 0" survives rounding. */
const FLOOR = 1e-5

//// ==== MEASURING ==== ////

/** Dimensionality of a measurement: 0 unitless (counts, booleans), 1 length, 2 area, 3 volume.
 *  Used to raise the shape's scale to the right power when deriving an absolute floor. */
type Dim = 0 | 1 | 2 | 3

type Measurement = { value: number, dim: Dim }
type Measurements = Record<string, Measurement>

type Family = 'solid' | 'linear'

/** Call `fn`, and simply drop the measurement if this kernel cannot answer (or throws).
 *  A metric only takes part in the comparison when BOTH kernels produced a finite number. */
function put(into: Measurements, key: string, dim: Dim, fn: () => unknown): void
{
    let raw: unknown
    try { raw = fn() } catch { return }
    if (typeof raw === 'boolean') { into[key] = { value: raw ? 1 : 0, dim: 0 }; return }
    if (typeof raw !== 'number' || !isFinite(raw)) { return }
    into[key] = { value: raw, dim }
}

/** Everything worth comparing about a shape, keyed by a readable name. */
function measure(shape: any, family: Family, opts: { topology?: boolean, ends?: boolean } = {}): Measurements
{
    const m: Measurements = {}

    // --- the bounding box: the one thing every shape type on every kernel can answer ---
    put(m, 'bbox.width', 1, () => shape.bbox().width())
    put(m, 'bbox.depth', 1, () => shape.bbox().depth())
    put(m, 'bbox.height', 1, () => shape.bbox().height())
    for (const axis of ['x', 'y', 'z'] as const)
    {
        put(m, `bbox.min.${axis}`, 1, () => shape.bbox().min()[axis])
        put(m, `bbox.max.${axis}`, 1, () => shape.bbox().max()[axis])
        put(m, `bbox.center.${axis}`, 1, () => shape.bbox().center()[axis])
    }
    put(m, 'bbox.diagonal', 1, () => diagonalOf(shape))

    put(m, 'is2D', 0, () => shape.is2D())

    if (family === 'solid')
    {
        put(m, 'volume', 3, () => shape.volume())
        put(m, 'area', 2, () => shape.area())
        put(m, 'size', 3, () => shape.size())
        for (const axis of ['x', 'y', 'z'] as const)
        {
            put(m, `center.${axis}`, 1, () => shape.center()[axis])
        }

        // The oriented bbox: the same three extents, but the kernels order the axes differently,
        // so sort. Solids only — the two OBB fitters disagree by a fraction of a percent on a
        // curve, which says nothing about the curve.
        for (let i = 0; i < 3; i++)
        {
            put(m, `obbox.extent[${i}]`, 1, () =>
            {
                const o = shape.obbox()
                return [o.width(), o.depth(), o.height()].sort((a: number, b: number) => a - b)[i]
            })
        }
    }
    else
    {
        put(m, 'length', 1, () => shape.length())
        put(m, 'closed', 0, () => shape.isClosed?.() ?? shape.closed?.())

        // Only meaningful on an OPEN curve: a closed one starts wherever its kernel seams it.
        if (opts.ends)
        {
            for (const axis of ['x', 'y', 'z'] as const)
            {
                put(m, `start.${axis}`, 1, () => shape.start()[axis])
                put(m, `end.${axis}`, 1, () => shape.end()[axis])
            }
        }
    }

    // Entity counts only line up while every face is planar and every span is a real model edge:
    // a tessellated curved surface is hundreds of triangles on mesh and one face on brep, and a
    // circle is two arc spans on mesh against one edge on brep. Chains opt in.
    if (opts.topology)
    {
        put(m, 'topology.edges', 0, () => shape.edges().length)
        put(m, 'topology.faces', 0, () => shape.faces().length)
        put(m, 'topology.segments', 0, () => shape.segments().length)
    }

    return m
}

/** Bbox diagonal — the natural "how big is this thing" scale for deriving absolute floors. */
function diagonalOf(shape: any): number
{
    const b = shape.bbox()
    return Math.hypot(b.width(), b.depth(), b.height())
}

//// ==== COMPARING ==== ////

/** Thrown when the two kernels have drifted so far that continuing the chain is pointless. */
class KernelDivergence extends Error
{
    constructor(message: string) { super(message); this.name = 'KernelDivergence' }
}

function scaleOf(a: any, b: any): number
{
    let s = 1
    try { s = Math.max(s, diagonalOf(a)) } catch { /* unmeasurable */ }
    try { s = Math.max(s, diagonalOf(b)) } catch { /* unmeasurable */ }
    return s
}

/**
 *  Compare every metric both kernels could answer. Returns nothing; throws on mismatch —
 *  a KernelDivergence when the gap is gross (ending the chain), a plain assertion otherwise.
 */
function compare(where: string, meshShape: any, brepShape: any, tol: number,
                 family: Family, opts: { topology?: boolean, ends?: boolean, ignore?: Array<string> } = {}): void
{
    const meshM = measure(meshShape, family, opts)
    const brepM = measure(brepShape, family, opts)
    const scale = scaleOf(meshShape, brepShape)
    const ignore = new Set(opts.ignore ?? [])

    const mismatches: Array<string> = []
    let gross = false

    for (const key of Object.keys(meshM))
    {
        if (ignore.has(key) || !(key in brepM)) { continue }

        const a = meshM[key].value
        const b = brepM[key].value
        const dim = meshM[key].dim
        const delta = Math.abs(a - b)
        const magnitude = Math.max(Math.abs(a), Math.abs(b))
        const unit = Math.pow(scale, dim)            // dim 0 → 1, so counts compare exactly

        const allowed = Math.max(tol * magnitude, FLOOR * unit)
        if (delta <= allowed) { continue }

        // Gross = a big fraction of the value itself, but never less than 1% of the shape's
        // own scale — otherwise a coordinate that happens to sit near zero aborts everything.
        if (delta > ABORT * Math.max(magnitude, 0.01 * unit)) { gross = true }

        mismatches.push(
            `${key}: mesh=${round(a)} brep=${round(b)} Δ=${round(delta)} (allowed ${round(allowed)})`)
    }

    if (gross)
    {
        throw new KernelDivergence(
            `${where}: the kernels are too far apart to keep going — chain stopped here.\n  ` +
            mismatches.join('\n  '))
    }
    expect(mismatches, where).toEqual([])
}

const round = (v: number) => (Math.abs(v) >= 1e-4 || v === 0) ? +v.toFixed(4) : v.toExponential(2)

//// ==== THE CHAIN RUNNER ==== ////

interface Step
{
    name: string
    /** Applied to the shape of each kernel. Return a shape to rebind (booleans, segment(),
     *  extrude() hand back a NEW shape on brep), or nothing to keep mutating in place. */
    op: (shape: any, modeler: Modeler) => any
    /** Override the tolerance band from this step on (e.g. once a curved cutter is involved). */
    tol?: number
    /** Metric keys to stop comparing from this step on. */
    ignore?: Array<string>
}

interface Chain
{
    family: Family
    make: (m: Modeler) => any
    steps: Array<Step>
    tol?: number
    topology?: boolean
    ends?: boolean
}

/** Build on both kernels, then walk the steps, comparing after each one. */
function runChain(title: string, chain: Chain, modelers: () => { mesh: Modeler, brep: Modeler }): void
{
    it(title, () =>
    {
        const { mesh, brep } = modelers()
        let tol = chain.tol ?? EXACT
        const ignore: Array<string> = []
        const opts = () => ({ topology: chain.topology, ends: chain.ends, ignore })

        let a = chain.make(mesh)
        let b = chain.make(brep)
        compare(`${title} — after make()`, a, b, tol, chain.family, opts())

        chain.steps.forEach((step, i) =>
        {
            if (step.tol !== undefined) { tol = step.tol }
            if (step.ignore) { ignore.push(...step.ignore) }

            const ra = step.op(a, mesh)
            const rb = step.op(b, brep)
            if (ra && typeof ra === 'object') { a = ra }
            if (rb && typeof rb === 'object') { b = rb }

            compare(`${title} — step ${i + 1}/${chain.steps.length} "${step.name}"`,
                a, b, tol, chain.family, opts())
        })
    }, 180_000)
}

//// ==== THE SUITES ==== ////

describe('mesh ↔ brep parity', () =>
{
    let mesh: Modeler
    let brep: Modeler

    // Loading the OpenCascade WASM is slow and global — do it once for the file.
    beforeAll(async () =>
    {
        mesh = new Modeler('mesh')
        await mesh.load()
        brep = new Modeler('brep')
        await brep.load()
    }, 120_000)

    const modelers = () => ({ mesh, brep })

    describe('solids (meshup Mesh ↔ brep Solid)', () =>
    {
        /*  Rotations pass an explicit pivot throughout. Both kernels now DEFAULT that pivot to the
            shape's own centre (meshup Curve used to default to the world origin — that divergence
            is fixed and gone), but the two disagree on where the centre of a solid IS: brep reports
            the surface centroid rather than the centre of mass, which is still pinned. An explicit
            pivot keeps that out of the rotation steps, and keeps the solid and linear chains
            reading the same way. Boolean results are rebound (`s = s.union(o)`) because brep's
            union()/intersection() hand back a new Shape instead of mutating — also pinned in
            kernel-divergences.test.ts. */

        runChain('box: move → rotate → scale → mirror → booleans', {
            family: 'solid',
            topology: true,
            make: m => m.box(100, 50, 20),
            steps: [
                { name: 'move(10,20,30)', op: s => s.move(10, 20, 30) },
                { name: 'moveX/Y/Z', op: s => { s.moveX(5); s.moveY(-5); s.moveZ(15) } },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'rotateZ(30) about origin', op: s => s.rotateZ(30, [0, 0, 0]) },
                { name: 'rotateX(90) about origin', op: s => s.rotateX(90, [0, 0, 0]) },
                { name: 'rotateY(45) about origin', op: s => s.rotateY(45, [0, 0, 0]) },
                { name: 'scale(2) about origin', op: s => s.scale(2, [0, 0, 0]) },
                { name: 'mirrorX(0)', op: s => s.mirrorX(0) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },

                /*  Booleans against boxes only: the result stays all-planar, so even the edge and
                    face counts have to line up. Each cutter leaves the solid in ONE connected
                    piece — a cut that severs it in two throws on brep (pinned as a divergence),
                    and a disjoint union answers with a ShapeCollection rather than a Shape.

                    center() drops out from here on: brep reports the SURFACE centroid rather than
                    the centre of mass, which only starts to show once the solid loses symmetry. */
                {
                    name: 'subtract(box 100³ at +x — takes a bite out of one end)',
                    op: (s, m) => s.subtract(m.box(100, 100, 100).move(150, 0, 0)),
                    // …and the oriented bbox, which is a FITTED box: the two fitters land on
                    // slightly different orientations once the solid stops being a cuboid.
                    ignore: ['center.x', 'center.y', 'center.z',
                             'obbox.extent[0]', 'obbox.extent[1]', 'obbox.extent[2]'],
                },
                { name: 'union(box 80³ at −x)', op: (s, m) => s.union(m.box(80, 80, 80).move(-120, 0, 0)) },
                { name: 'intersection(box 180×180×180)', op: (s, m) => s.intersection(m.box(180, 180, 180)) },
                { name: 'move(40,0,0)', op: s => s.move(40, 0, 0) },
            ],
        }, modelers)

        runChain('boxBetween: two corners → transforms', {
            family: 'solid',
            topology: true,
            make: m => m.boxBetween([0, 0, 0], [120, 60, 40]),
            steps: [
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'scale(0.5) about origin', op: s => s.scale(0.5, [0, 0, 0]) },
                { name: 'rotateZ(90) about origin', op: s => s.rotateZ(90, [0, 0, 0]) },
                { name: 'mirrorY(10)', op: s => s.mirrorY(10) },
                { name: 'mirrorZ(0)', op: s => s.mirrorZ(0) },
            ],
        }, modelers)

        /*  Curved solids: meshup triangulates, brep keeps the exact surface, so volume and area
            differ by a percent or two by construction. The bounding box, on the other hand, still
            has to be exact — a tessellation may lose volume but it may not overshoot the shape. */
        runChain('cylinder: transforms and a planar cut (tessellated)', {
            family: 'solid',
            tol: TESSELATED,
            make: m => m.cylinder(30, 80),
            steps: [
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'move(5,5,5)', op: s => s.move(5, 5, 5) },
                { name: 'rotateY(90) about origin', op: s => s.rotateY(90, [0, 0, 0]) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                {
                    name: 'subtract(box 200×200×100 above z=10)',
                    op: (s, m) => s.subtract(m.box(200, 200, 100).move(0, 0, 60)),
                    ignore: ['center.x', 'center.y', 'center.z'],
                },
                { name: 'scale(2) about origin', op: s => s.scale(2, [0, 0, 0]) },
            ],
        }, modelers)

        runChain('sphere: transforms and a planar cut (tessellated)', {
            family: 'solid',
            tol: TESSELATED,
            make: m => m.sphere(50),
            steps: [
                { name: 'move(10,0,0)', op: s => s.move(10, 0, 0) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                {
                    name: 'subtract(box 200×200×50 above z=40)',
                    op: (s, m) => s.subtract(m.box(200, 200, 50).move(0, 0, 40)),
                    ignore: ['center.x', 'center.y', 'center.z'],
                },
                { name: 'mirrorZ(0)', op: s => s.mirrorZ(0) },
                { name: 'scale(1.5) about origin', op: s => s.scale(1.5, [0, 0, 0]) },
            ],
        }, modelers)
    })

    describe('linear shapes (meshup Curve ↔ brep Edge/Wire)', () =>
    {
        /*  A closed outline is seamed differently by the two kernels — brep's rect starts at a
            different corner and runs the other way round — so start()/end()/middle() are left out
            (`ends` stays off) and only the whole-shape measurements are compared. */
        runChain('rect outline: move → rotate → scale → mirror → offset', {
            family: 'linear',
            topology: true,      // an all-straight outline: 4 edges and 4 spans on both kernels
            make: m => m.rect(100, 50),
            steps: [
                { name: 'move(10,20,0)', op: s => s.move(10, 20, 0) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'rotateZ(45) about origin', op: s => s.rotateZ(45, [0, 0, 0]) },
                { name: 'rotateX(30) about origin', op: s => s.rotateX(30, [0, 0, 0]) },
                { name: 'scale(2) about origin', op: s => s.scale(2, [0, 0, 0]) },
                { name: 'mirrorX(0)', op: s => s.mirrorX(0) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'offset(10)', op: s => s.offset(10) },
                { name: 'offset(-5)', op: s => s.offset(-5) },
            ],
        }, modelers)

        /*  Open curves keep their start and end, so those are compared too — and they are the
            sharpest test there is that the two kernels ran the same transform in the same order. */
        runChain('polyline: move → rotate → scale → segment', {
            family: 'linear',
            ends: true,
            topology: true,
            make: m => m.polyline([[0, 0, 0], [100, 0, 0], [100, 50, 0], [160, 50, 0]]),
            steps: [
                { name: 'move(0,0,10)', op: s => s.move(0, 0, 10) },
                { name: 'rotateZ(90) about origin', op: s => s.rotateZ(90, [0, 0, 0]) },
                { name: 'rotateY(20) about origin', op: s => s.rotateY(20, [0, 0, 0]) },
                { name: 'scale(2) about origin', op: s => s.scale(2, [0, 0, 0]) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'segment(0) — first edge only', op: s => s.segment(0) },
                { name: 'move(10,10,10)', op: s => s.move(10, 10, 10) },
            ],
        }, modelers)

        /*  Two ordering constraints, both from brep bugs pinned in kernel-divergences.test.ts:
            extend() has to come BEFORE any rotation (brep extends along the underlying curve's
            ORIGINAL direction, ignoring the transform the edge has picked up), and scale() has to
            come LAST (brep's scale() leaves the shape as an untyped TopoDS_Shape, so the next
            curve-specific call throws). */
        runChain('line: an atomic segment through every transform', {
            family: 'linear',
            ends: true,
            topology: true,
            make: m => m.line([0, 0, 0], [100, 0, 0]),
            steps: [
                { name: 'move(0,50,0)', op: s => s.move(0, 50, 0) },
                { name: 'extend(50)', op: s => s.extend(50) },
                { name: 'rotateZ(37) about origin', op: s => s.rotateZ(37, [0, 0, 0]) },
                { name: 'mirrorY(0)', op: s => s.mirrorY(0) },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'scale(3) about origin', op: s => s.scale(3, [0, 0, 0]) },
            ],
        }, modelers)

        /*  A circle is one analytic curve on brep and two arc spans on meshup, so `segments`
            drops out — but length and the bounding box are exact on both, and they are what a
            script actually reads. */
        runChain('circle outline: transforms (tessellated bbox)', {
            family: 'linear',
            tol: TESSELATED,
            make: m => m.circle(40),
            steps: [
                { name: 'move(10,0,0)', op: s => s.move(10, 0, 0) },
                { name: 'scale(2) about origin', op: s => s.scale(2, [0, 0, 0]) },
                {
                    name: 'rotateX(90) about origin',
                    op: s => s.rotateX(90, [0, 0, 0]),
                    // meshup's Curve.is2D()/Mesh.is2D() test the bbox extents with `=== 0` instead
                    // of the tolerant Bbox.is2D() sitting right next to them, so the float residue
                    // of rotating a tessellated circle onto the XZ plane reads as 3D.
                    ignore: ['is2D'],
                },
                { name: 'moveTo(0,0,0)', op: s => s.moveTo(0, 0, 0) },
                { name: 'mirrorZ(0)', op: s => s.mirrorZ(0) },
            ],
        }, modelers)
    })

    describe('the chain runner itself', () =>
    {
        it('aborts a chain instead of reporting noise once the kernels diverge grossly', () =>
        {
            const a = mesh.box(100, 50, 20)
            const b = brep.box(100, 50, 20).scale(3)     // deliberately not the same shape

            expect(() => compare('deliberate mismatch', a, b, EXACT, 'solid'))
                .toThrow(KernelDivergence)
        })

        it('passes a shape against itself', () =>
        {
            const a = mesh.box(100, 50, 20)
            expect(() => compare('self', a, a, EXACT, 'solid', { topology: true })).not.toThrow()
        })
    })
})
