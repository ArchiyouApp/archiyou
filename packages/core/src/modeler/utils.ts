/**
 *  utils.ts
 *
 *  Modeler helpers that no one module owns. Currently one subject: WHICH PLANE a model's 2D
 *  geometry lies on, and the frame that maps that plane onto XY.
 *
 *  Both 2D exporters draw on XY and nothing else: a DXF stores no z in an LWPOLYLINE and
 *  writes every arc with a +Z extrusion, and an SVG has no third axis at all. Model geometry
 *  is routinely drawn somewhere else though — a wall elevation lives on XZ, a section on YZ —
 *  and the answer used to be a blank drawing, or the far worse one: an elevation silently
 *  flattened to a single line, because the projection dropped z and every point shared a y.
 *
 *  So the exporters ask this module which plane the geometry is actually on and draw in that
 *  plane's frame. Nothing in the scene moves. DXF maps each coordinate on its way into the
 *  file; SVG rotates throwaway copies (see drawnInPlane), because its serializers read a
 *  shape's own geometry and there is no coordinate to intercept.
 */

//// TYPES ////

export type Vec3 = { x: number; y: number; z: number }

/** Which model plane a drawing is taken from. 'auto' detects the plane the 2D geometry
 *  actually lies on; the others force a view — 'xy' plan, 'xz' front elevation, 'yz' right. */
export type ExportPlane = 'auto' | 'xy' | 'xz' | 'yz'

/** How flat a shape has to be to count as lying on a plane, in model units. */
export const PLANE_TOLERANCE = 1e-4

/** The frame a drawing is written in: a model-space plane mapped onto the XY plane. */
export interface ExportFrame
{
    x: Vec3        // model direction that becomes drawing +X
    y: Vec3        // model direction that becomes drawing +Y
    normal: Vec3   // plane normal — the direction the drawing is seen from
    offset: number // signed distance from the world origin to the plane along `normal`
    name: string   // 'XY' | 'XZ' | 'YZ' | 'oblique', for messages
}

/** Maps model coordinates into the drawing plane. `dir()` is the same map without the
 *  translation, for vectors (a DXF ELLIPSE's major axis is one). */
export interface Projector
{
    point(p: PointIn): Vec3
    dir(p: PointIn): Vec3
    /** The drawing plane's normal, in MODEL space — the direction this maps onto +Z. Carried
     *  so a thing that has to reason in the model's own coordinates can still ask which plane
     *  the drawing is taken in: a dimension line offsets perpendicular to itself INSIDE that
     *  plane, and computing that against the plan normal pushes it out of the drawing. */
    normal: Vec3
}

type PointIn = readonly [number, number, number] | { x: number; y: number; z?: number }

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const vCross = (a: Vec3, b: Vec3): Vec3 =>
    V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const vUnit = (a: Vec3): Vec3 => { const l = vLen(a); return l > 0 ? V(a.x / l, a.y / l, a.z / l) : a }

const asVec3 = (p: PointIn): Vec3 =>
{
    const a = p as any
    return Array.isArray(a) ? V(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) : V(a.x ?? 0, a.y ?? 0, a.z ?? 0)
}

/** Straight through — what geometry already on XY gets, so the common path is untouched. */
export const IDENTITY_PROJECTOR: Projector = { point: asVec3, dir: asVec3, normal: V(0, 0, 1) }

/** Point the normal at the viewer of the standard view for its plane: from above for a
 *  horizontal plane (+Z), from the front for a vertical one (−Y), from the right otherwise
 *  (+X). This is what decides whether an elevation comes out upright or mirrored.
 *
 *  Components a hair off a cardinal axis are snapped onto it first, so a plane that is
 *  axis-aligned in intent but carries rounding from a rotation still exports as one. */
function orientNormal(n: Vec3): Vec3
{
    const snap = (v: number): number =>
        Math.abs(v) < 1e-9 ? 0 : (Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : v)
    const s = V(snap(n.x), snap(n.y), snap(n.z))
    const flip = (v: Vec3): Vec3 => V(-v.x, -v.y, -v.z)
    if (s.z !== 0) return s.z > 0 ? s : flip(s)   // horizontal plane → seen from above
    if (s.y !== 0) return s.y < 0 ? s : flip(s)   // vertical, faces Y → seen from the front
    return s.x > 0 ? s : flip(s)                  // vertical, faces X → seen from the right
}

/** The drawing frame for a plane with this normal, keeping model 'up' (+Z) up in the drawing.
 *  For the coordinate planes that works out exactly: XY → (x, y), XZ → (x, z), YZ → (y, z). */
export function frameFromNormal(normal: Vec3, offset = 0): ExportFrame
{
    const n = orientNormal(vUnit(normal))
    // 'Up' is world +Z projected into the plane. A horizontal plane has none — it is a plan,
    // and there +Y is up.
    const up = V(-n.x * n.z, -n.y * n.z, 1 - n.z * n.z)
    const y = vLen(up) > 1e-9 ? vUnit(up) : V(0, 1, 0)
    const x = vCross(y, n) // right-handed: x × y === n
    const name = Math.abs(n.z) === 1 ? 'XY'
        : Math.abs(n.y) === 1 ? 'XZ'
        : Math.abs(n.x) === 1 ? 'YZ' : 'oblique'
    return { x, y, normal: n, offset, name }
}

export function projectorFor(frame: ExportFrame): Projector
{
    if (frame.name === 'XY' && frame.normal.z === 1 && Math.abs(frame.offset) < 1e-12)
    {
        return IDENTITY_PROJECTOR
    }
    const dir = (p: PointIn): Vec3 =>
    {
        const v = asVec3(p)
        return V(vDot(v, frame.x), vDot(v, frame.y), vDot(v, frame.normal))
    }
    return { dir, normal: frame.normal, point: p => { const v = dir(p); return V(v.x, v.y, v.z - frame.offset) } }
}

/** The standard views, in the order a tie is broken: a drawing is a plan unless the geometry
 *  says otherwise, and an elevation before a section. Same preference as Curve.getOnPlane(). */
const VIEW_NORMALS: Record<Exclude<ExportPlane, 'auto'>, Vec3> = {
    xy: V(0, 0, 1),
    xz: V(0, -1, 0),
    yz: V(1, 0, 0),
}

export type Box = { min: Vec3; max: Vec3 }

export function shapeBox(shape: any): Box | null
{
    const bb = shape?.bbox?.()
    const min = bb?.min?.()
    const max = bb?.max?.()
    return (min && max) ? { min: asVec3(min), max: asVec3(max) } : null
}

/** How flat a shape has to be to count as lying on a plane. Scaled to the model so a 50 m
 *  building is not held to the same absolute flatness as a 50 mm bracket. */
export function planeTolerance(boxes: Box[]): number
{
    let size = 0
    boxes.forEach(b =>
    {
        size = Math.max(size, Math.abs(b.max.x - b.min.x), Math.abs(b.max.y - b.min.y),
            Math.abs(b.max.z - b.min.z), vLen(b.min), vLen(b.max))
    })
    return Math.max(PLANE_TOLERANCE, size * 1e-9)
}

/** Extent of a box along a *cardinal* direction. */
const extentAlong = (b: Box, n: Vec3): number => Math.abs(vDot(b.max, n) - vDot(b.min, n))

/** The most populated plane with this normal: where it sits and how many boxes lie flat on
 *  it. Shapes on a parallel plane are a different drawing and do not count towards it. */
function bestPlaneAlong(boxes: Box[], n: Vec3, tol: number): { count: number; offset: number } | null
{
    const offsets = boxes.filter(b => extentAlong(b, n) <= tol)
        .map(b => (vDot(b.min, n) + vDot(b.max, n)) / 2)
    if (offsets.length === 0) return null

    let best = { count: 0, offset: 0 }
    offsets.forEach(o =>
    {
        const count = offsets.filter(other => Math.abs(other - o) <= tol).length
        if (count > best.count) best = { count, offset: o }
    })
    return best
}

/** Points a plane can be fitted through. Curves and meshes both tessellate; a shape that
 *  cannot contributes nothing, which only costs it the oblique fallback below. */
export function samplePoints(shape: any): Vec3[]
{
    try
    {
        const pts = shape?.tessellate?.()
        return Array.isArray(pts) ? pts.map(asVec3) : []
    }
    catch { return [] }
}

/** A plane through points that are not on any coordinate plane — a sloped roof panel, a
 *  bracket rotated off axis. Normal from the first three non-collinear points, then every
 *  point checked against it, exactly as Curve.getOnPlane() does it. */
function fitObliquePlane(shapes: any[], tol: number): ExportFrame | null
{
    const pts: Vec3[] = shapes.flatMap(samplePoints)
    if (pts.length < 3) return null

    const o = pts[0]
    const ab = V(pts[1].x - o.x, pts[1].y - o.y, pts[1].z - o.z)
    let normal: Vec3 | null = null
    for (let i = 2; i < pts.length; i++)
    {
        const candidate = vCross(ab, V(pts[i].x - o.x, pts[i].y - o.y, pts[i].z - o.z))
        if (vLen(candidate) > tol) { normal = vUnit(candidate); break }
    }
    if (!normal) return null

    const n = normal
    const offset = vDot(o, n)
    const planar = pts.every(p => Math.abs(vDot(p, n) - offset) <= tol)
    return planar ? frameFromNormal(n, offset) : null
}

/** The plane this set of shapes should be drawn in, or null when none of them is flat.
 *
 *  Coordinate planes are tried first (they are what models actually use, and their frames
 *  come out exact), most populated first; only then a free-floating plane fitted through the
 *  geometry. `want` forces a view instead of detecting one. */
export function detectExportFrame(shapes: any[], want: ExportPlane = 'auto'): ExportFrame | null
{
    const boxes = shapes.map(shapeBox).filter((b): b is Box => b !== null)
    if (boxes.length === 0) return null
    const tol = planeTolerance(boxes)

    if (want !== 'auto')
    {
        const n = VIEW_NORMALS[want]
        return frameFromNormal(n, bestPlaneAlong(boxes, n, tol)?.offset ?? 0)
    }

    let best: { count: number; offset: number; normal: Vec3 } | null = null
    for (const key of Object.keys(VIEW_NORMALS) as Array<Exclude<ExportPlane, 'auto'>>)
    {
        const normal = VIEW_NORMALS[key]
        const plane = bestPlaneAlong(boxes, normal, tol)
        if (plane && (best === null || plane.count > best.count)) { best = { ...plane, normal } }
    }

    return best ? frameFromNormal(best.normal, best.offset) : fitObliquePlane(shapes, tol)
}

/** Does this shape lie on the drawing's plane (within tolerance)? */
export function isOnPlane(shape: any, frame: ExportFrame, tol: number): boolean
{
    // A bounding box answers this exactly for a coordinate plane — its min and max ARE the
    // shape's extremes along a cardinal normal. For an oblique plane it is not the shape, so
    // the points are.
    if (frame.name === 'oblique')
    {
        const pts = samplePoints(shape)
        return pts.length > 0 && pts.every(p => Math.abs(vDot(p, frame.normal) - frame.offset) <= tol)
    }
    const box = shapeBox(shape)
    if (!box) return false
    return Math.abs(vDot(box.min, frame.normal) - frame.offset) <= tol
        && Math.abs(vDot(box.max, frame.normal) - frame.offset) <= tol
}



//// DRAWING IN THE PLANE ////

/** The frame's rotation as a unit quaternion (w, x, y, z).
 *
 *  The frame's three axes ARE the rows of the rotation that takes the model onto XY, so this
 *  is the textbook matrix-to-quaternion conversion, taking the largest diagonal term first so
 *  the divisor is never near zero. */
export function frameQuaternion(frame: ExportFrame): { w: number; x: number; y: number; z: number }
{
    const [m00, m01, m02] = [frame.x.x, frame.x.y, frame.x.z]
    const [m10, m11, m12] = [frame.y.x, frame.y.y, frame.y.z]
    const [m20, m21, m22] = [frame.normal.x, frame.normal.y, frame.normal.z]

    const trace = m00 + m11 + m22
    if (trace > 0)
    {
        const s = Math.sqrt(trace + 1) * 2
        return { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }
    }
    if (m00 > m11 && m00 > m22)
    {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2
        return { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s }
    }
    if (m11 > m22)
    {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2
        return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s }
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 }
}

/** True for the frame that leaves the model where it is — a plan of geometry already on XY,
 *  which is the overwhelmingly common case and must cost nothing. */
export function isPlanFrame(frame: ExportFrame | null): boolean
{
    return !frame || (frame.name === 'XY' && frame.normal.z === 1)
}

/** Throwaway copies of these shapes, rotated so the drawing plane lands on XY, keyed by the
 *  shape each was made from. Returns null when no rotation is needed.
 *
 *  Why copies at all: an SVG serializer reads a shape's own geometry and projects it with a
 *  bare (x, -y), so unlike DXF there is no coordinate on its way out to intercept. Rotating
 *  is the only way to tell it about the plane — which is exactly why it has to be a copy.
 *  `_copy()` is meshup's pure kernel clone and never touches the scene graph, and the copies
 *  are dropped as soon as the drawing is a string.
 *
 *  Each copy is pointed back at the ORIGINAL's scene node, so the style cascade still resolves
 *  through it (see withCascadedStyles) — the node is only read, never written.
 */
export function drawnInPlane(shapes: Array<any>, frame: ExportFrame | null): Map<any, any> | null
{
    if (isPlanFrame(frame)) return null
    const q = frameQuaternion(frame!)

    const copies = new Map<any, any>()
    shapes.forEach(shape =>
    {
        const copy = shape?._copy?.()
        if (!copy || typeof copy.rotateQuaternion !== 'function') return
        copy.rotateQuaternion(q.w, q.x, q.y, q.z)
        copy._node = shape._node ?? null
        copy._modeler = shape._modeler
        copies.set(shape, copy)
    })
    return copies.size > 0 ? copies : null
}
