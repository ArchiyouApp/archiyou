/**
 * exportGeometry.ts
 *
 * Faceted geometry shared by the exporters that write solids as faces: FreeCAD's planar .brp writer
 * and OpenSCAD's polyhedron(). Both need the same thing from a mesh: welded points, faces that share
 * their edges exactly (booleans leave T-junctions), no degenerate faces, and an outward orientation.
 * Getting that once, in one place, is what makes a baked shape a closed solid in both formats.
 *
 * Sections
 *   1. Vectors and the welder
 *   2. weldFaces()   clean, repaired, oriented faces as indices into one point list
 *   3. meshFaces()   the planar faces of a meshup mesh, coplanar triangles merged
 */

export type Vec3 = readonly [number, number, number]

/** A planar face: an outer ring and optional hole rings, as points */
export interface PlanarFace
{
    outer: Vec3[]
    holes?: Vec3[][]
}

/** A face of a welded shell: rings as indices into `WeldedFaces.points` */
export interface WeldedFace
{
    outer: number[]
    /** Wound the opposite way round `normal` from the outer ring */
    holes: number[][]
    /** Unit normal; outward when the shell is closed */
    normal: Vec3
}

export interface WeldedFaces
{
    points: Vec3[]
    faces: WeldedFace[]
    /** Every edge used exactly once in each direction: a watertight, consistently wound solid */
    closed: boolean
}

//// 1. VECTORS AND THE WELDER ////

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const unit = (a: Vec3): Vec3 => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0] }

/** Newell normal of a ring: its length is twice the ring's area, its direction follows the winding. */
export function newell(ring: readonly Vec3[]): Vec3
{
    let x = 0, y = 0, z = 0
    for (let i = 0; i < ring.length; i++)
    {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        x += (a[1] - b[1]) * (a[2] + b[2])
        y += (a[2] - b[2]) * (a[0] + b[0])
        z += (a[0] - b[0]) * (a[1] + b[1])
    }
    return [x, y, z]
}

/** Welds points within `tolerance`, looking in neighbouring grid cells so a cell border never
 *  splits two points that belong together. */
export class Welder
{
    readonly points: Vec3[] = []
    private cells = new Map<string, number[]>()
    constructor(private tolerance: number) {}

    id(p: Vec3): number
    {
        const t = this.tolerance
        const c = [Math.floor(p[0] / t), Math.floor(p[1] / t), Math.floor(p[2] / t)]
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        {
            for (const i of this.cells.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? [])
            {
                if (len(sub(this.points[i], p)) <= t) return i
            }
        }
        const i = this.points.length
        this.points.push(p)
        const key = `${c[0]},${c[1]},${c[2]}`
        if (!this.cells.has(key)) this.cells.set(key, [])
        this.cells.get(key)!.push(i)
        return i
    }
}

//// 2. WELDED FACES ////

/** Planar faces as a welded shell: points merged within `tolerance`, zero-length edges and
 *  zero-area faces dropped, T-junctions split so neighbouring faces share their edges exactly,
 *  holes wound against their face, and a closed shell turned outward. Null when nothing is left. */
export function weldFaces(input: readonly PlanarFace[], tolerance = 1e-6): WeldedFaces | null
{
    const welder = new Welder(tolerance)
    const cleanRing = (ring: readonly Vec3[]): number[] =>
    {
        const ids: number[] = []
        for (const p of ring)
        {
            const id = welder.id(p)
            if (ids[ids.length - 1] !== id) ids.push(id)
        }
        while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop()
        return ids
    }

    let rings = input
        .map(f => ({ outer: cleanRing(f.outer), holes: (f.holes ?? []).map(cleanRing).filter(h => h.length >= 3) }))
        .filter(f => f.outer.length >= 3)

    // Booleans leave T-junctions: a vertex of one face sitting in the middle of a neighbour's
    // edge. Split those edges so the two faces share their boundary exactly and the shell closes.
    rings = splitTJunctions(rings, welder.points, tolerance)

    const P = welder.points
    const ringPoints = (ids: number[]) => ids.map(i => P[i])
    let faces: WeldedFace[] = []
    for (const f of rings)
    {
        const n = newell(ringPoints(f.outer))
        if (len(n) < tolerance * tolerance) continue // zero area
        const normal = unit(n)
        // holes run the other way round the normal than the outer boundary
        const holes = f.holes.map(h => dot(newell(ringPoints(h)), normal) > 0 ? [...h].reverse() : h)
        faces.push({ outer: f.outer, holes, normal })
    }
    if (!faces.length) return null

    // Directed edge use decides closedness
    const uses = new Map<string, number>()
    const allRings = (f: WeldedFace) => [f.outer, ...f.holes]
    for (const f of faces) for (const ring of allRings(f)) for (let i = 0; i < ring.length; i++)
    {
        const key = `${ring[i]}>${ring[(i + 1) % ring.length]}`
        uses.set(key, (uses.get(key) ?? 0) + 1)
    }
    let closed = true
    for (const [key, count] of uses)
    {
        const [a, b] = key.split('>')
        if (count !== 1 || uses.get(`${b}>${a}`) !== 1) { closed = false; break }
    }

    // A closed shell whose faces point inwards is turned inside out
    if (closed && signedVolume(P, faces) < 0)
    {
        faces = faces.map(f => ({ outer: [...f.outer].reverse(), holes: f.holes.map(h => [...h].reverse()), normal: scale(f.normal, -1) }))
    }

    return { points: P, faces, closed }
}

/** Six times the signed volume enclosed by the faces (positive when they point outward) */
export function signedVolume(points: readonly Vec3[], faces: readonly WeldedFace[]): number
{
    let volume = 0
    for (const f of faces) for (const ring of [f.outer, ...f.holes])
    {
        const pts = ring.map(i => points[i])
        for (let i = 1; i < pts.length - 1; i++) volume += dot(pts[0], cross(pts[i], pts[i + 1]))
    }
    return volume
}

function splitTJunctions(faces: Array<{ outer: number[]; holes: number[][] }>, P: Vec3[], tolerance: number)
{
    const uses = new Map<string, number>()
    const all = (f: { outer: number[]; holes: number[][] }) => [f.outer, ...f.holes]
    for (const f of faces) for (const ring of all(f)) for (let i = 0; i < ring.length; i++)
    {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        uses.set(key, (uses.get(key) ?? 0) + 1)
    }
    const open = [...uses].filter(([, c]) => c === 1).map(([k]) => k.split('-').map(Number))
    if (!open.length) return faces

    // T-junction vertices are endpoints of other open edges
    const candidates = [...new Set(open.flat())]
    const splitRing = (ring: number[]) =>
    {
        const out: number[] = []
        ring.forEach((a, i) =>
        {
            const b = ring[(i + 1) % ring.length]
            out.push(a)
            const key = a < b ? `${a}-${b}` : `${b}-${a}`
            if (uses.get(key) !== 1) return
            const pa = P[a], d = sub(P[b], pa), l2 = dot(d, d)
            if (l2 === 0) return
            const inner = candidates
                .filter(c => c !== a && c !== b)
                .map(c => ({ c, t: dot(sub(P[c], pa), d) / l2 }))
                .filter(({ c, t }) => t > 0 && t < 1 && len(sub(P[c], add(pa, scale(d, t)))) <= tolerance)
                .sort((u, v) => u.t - v.t)
            inner.forEach(({ c }) => out.push(c))
        })
        return out
    }
    return faces.map(f => ({ outer: splitRing(f.outer), holes: f.holes.map(splitRing) }))
}

//// 3. MESH FACES ////

/** The planar faces of a meshup Mesh, every coordinate multiplied by `factor` (FreeCAD writes
 *  millimetres). With `merge` (the default) coplanar triangles are merged into n-gons, which can have
 *  holes; without it the kernel's own polygons come back as they are, never with holes.
 *
 *  Reads the raw kernel mesh: Mesh.reconstructNgons() is @sceneReplace and would detach the shape
 *  from the scene. */
export function meshFaces(mesh: any, factor = 1, merge = true): PlanarFace[]
{
    const inner = mesh?.inner?.()
    if (!inner) return []
    const ngons = merge ? (inner.reconstructNgons?.() ?? inner) : inner
    const position = (v: any): Vec3 => { const p = v.position(); return [p.x * factor, p.y * factor, p.z * factor] }
    return (ngons.polygons?.() ?? []).map((poly: any) => ({
        outer: (poly.vertices() as any[]).map(position),
        holes: ((poly.holes?.() ?? []) as any[][]).map(h => h.map(position)),
    }))
}
