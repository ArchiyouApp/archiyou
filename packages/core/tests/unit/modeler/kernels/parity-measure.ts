/**
 *  Mesh ↔ brep measurement and comparison, shared by the parity suites.
 *
 *  shape-parity.test.ts uses this to compare one shape after every step of a chain;
 *  tests/cadscripts/kernel.parity.test.ts uses it to compare every shape a whole cadscript
 *  leaves in the scene on both kernels. Same tolerance formula in both places, so a number
 *  that is "off" means the same thing wherever it is reported.
 *
 *  How a comparison is judged
 *  --------------------------
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
 */

//// ==== TOLERANCES ==== ////

/** Analytic primitives and their transforms: both kernels compute these in closed form, so
 *  they should agree to little more than brep's 3-decimal output rounding. */
export const EXACT = 0.0005        // 0.05%
/** Anything that passes through meshup's triangulation of a curved surface. */
export const TESSELATED = 0.03     // 3%
/** Past this the two kernels are no longer modelling the same object. */
export const ABORT = 0.25          // 25%
/** Absolute floor, as a fraction of the shape's own scale, so "should be 0" survives rounding. */
export const FLOOR = 1e-5

//// ==== SHAPE FAMILIES ==== ////

/** The kernel-neutral kind of a shape: what a script means by it, whichever kernel built it.
 *  meshup Mesh ↔ brep Solid/Shell, Curve ↔ Edge/Wire, Polygon ↔ Face, Vertex ↔ Vertex. */
export type Family = 'solid' | 'linear' | 'surface' | 'point' | 'unknown'

const FAMILY_OF: Record<string, Family> = {
    Mesh: 'solid', Solid: 'solid', Shell: 'solid',
    Curve: 'linear', Edge: 'linear', Wire: 'linear',
    Polygon: 'surface', Face: 'surface',
    Vertex: 'point',
}

export function familyOf(shape: any): Family
{
    return FAMILY_OF[String(shape?.type)] ?? 'unknown'
}

/** Kernel type labels that mean the same family, for normalising scene node names such as
 *  'Mesh:Box' ↔ 'Solid:Box' or 'Curve:Line' ↔ 'Edge:Line'. */
export function familyOfTypeLabel(label: string): Family | null
{
    return FAMILY_OF[label] ?? null
}

//// ==== MEASURING ==== ////

/** Dimensionality of a measurement: 0 unitless (counts, booleans), 1 length, 2 area, 3 volume.
 *  Used to raise the shape's scale to the right power when deriving an absolute floor. */
export type Dim = 0 | 1 | 2 | 3

export type Measurement = { value: number, dim: Dim }
export type Measurements = Record<string, Measurement>

export interface MeasureOptions
{
    /** Also count edges/faces/segments — only meaningful while every face is planar. */
    topology?: boolean
    /** Also compare start()/end() — only meaningful on an OPEN curve. */
    ends?: boolean
    /** Bounding box only: the one thing every shape type on every kernel can answer. */
    bboxOnly?: boolean
}

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
export function measure(shape: any, family: Family, opts: MeasureOptions = {}): Measurements
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

    if (opts.bboxOnly) { return m }

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
    else if (family === 'linear')
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
    // circle is two arc spans on mesh against one edge on brep. Callers opt in.
    if (opts.topology)
    {
        put(m, 'topology.edges', 0, () => shape.edges().length)
        put(m, 'topology.faces', 0, () => shape.faces().length)
        put(m, 'topology.segments', 0, () => shape.segments().length)
    }

    return m
}

/** Bbox diagonal — the natural "how big is this thing" scale for deriving absolute floors. */
export function diagonalOf(shape: any): number
{
    const b = shape.bbox()
    return Math.hypot(b.width(), b.depth(), b.height())
}

//// ==== COMPARING ==== ////

/** Thrown when the two kernels have drifted so far that continuing is pointless. */
export class KernelDivergence extends Error
{
    constructor(message: string) { super(message); this.name = 'KernelDivergence' }
}

export function scaleOf(a: any, b: any): number
{
    let s = 1
    try { s = Math.max(s, diagonalOf(a)) } catch { /* unmeasurable */ }
    try { s = Math.max(s, diagonalOf(b)) } catch { /* unmeasurable */ }
    return s
}

export interface Mismatch
{
    key: string
    mesh: number
    brep: number
    delta: number
    allowed: number
    /** A big fraction of the value itself — the kernels model different objects here. */
    gross: boolean
}

export interface CompareOptions extends MeasureOptions
{
    /** Metric keys to leave out of the comparison. */
    ignore?: Array<string>
}

/**
 *  Compare every metric both kernels could answer. Returns the mismatches (empty when the
 *  shapes agree within `tol`); never throws, so a corpus report can list them.
 */
export function mismatches(meshShape: any, brepShape: any, tol: number, family: Family,
                           opts: CompareOptions = {}): Array<Mismatch>
{
    const meshM = measure(meshShape, family, opts)
    const brepM = measure(brepShape, family, opts)
    const scale = scaleOf(meshShape, brepShape)
    const ignore = new Set(opts.ignore ?? [])

    const out: Array<Mismatch> = []

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
        const gross = delta > ABORT * Math.max(magnitude, 0.01 * unit)
        out.push({ key, mesh: a, brep: b, delta, allowed, gross })
    }
    return out
}

export const round = (v: number) => (Math.abs(v) >= 1e-4 || v === 0) ? +v.toFixed(4) : v.toExponential(2)

export function formatMismatch(m: Mismatch): string
{
    return `${m.key}: mesh=${round(m.mesh)} brep=${round(m.brep)} Δ=${round(m.delta)} (allowed ${round(m.allowed)})`
}

/**
 *  Assert-style comparison for the chain suites: throws a KernelDivergence when the gap is
 *  gross (ending a chain), otherwise returns the formatted mismatches for the caller to
 *  `expect(...).toEqual([])`.
 */
export function compareOrDiverge(where: string, meshShape: any, brepShape: any, tol: number,
                                 family: Family, opts: CompareOptions = {}): Array<string>
{
    const found = mismatches(meshShape, brepShape, tol, family, opts)
    const lines = found.map(formatMismatch)

    if (found.some(m => m.gross))
    {
        throw new KernelDivergence(
            `${where}: the kernels are too far apart to keep going — chain stopped here.\n  ` +
            lines.join('\n  '))
    }
    return lines
}
