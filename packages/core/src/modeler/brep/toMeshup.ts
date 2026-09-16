/**
 *  toMeshup.ts — the one seam between the two kernels, in both directions.
 *
 *  brep → meshup (brepShapeToMeshup): brep geometry is exact (NURBS surfaces, analytic
 *  curves); meshup geometry is discrete. Every Archiyou output — GLB, SVG, DXF, STL, DAE — is
 *  produced by the meshup-side exporters walking a SceneNode graph. Rather than duplicate all
 *  of that for OpenCascade, a brep Shape is tessellated once (it already knows how:
 *  Shape.toMeshShape) and rebuilt as the equivalent meshup Shape. From there the existing
 *  pipeline runs unchanged, so brep runs get the same GLB extras, materials, edge-visibility
 *  extensions, scene paths and animations for free.
 *
 *  What is lost: exact surfaces. A brep cylinder exports as its triangulation, at whatever
 *  MESHING_* quality was requested — the same fidelity the old viewer path had, since it also
 *  fed on toMeshShape(). What is kept: the shape's own edges, exported as Curves rather than
 *  being re-derived from mesh topology, so a brep model still draws its true silhouette.
 *
 *  meshup → brep (meshupShapeToBrep): the sketch is always a meshup.Sketch (Modeler.sketch()),
 *  so in brep mode its curves have to become brep Edges/Wires before a script can cut, extend
 *  or extrude them against brep solids — otherwise the two kernels' internals meet
 *  ("expected instance of MeshJs"). A meshup Curve is rebuilt span by span from its analytic
 *  description (lines, three-point arcs, interpolated splines), so nothing is tessellated on
 *  the way over.
 */

import * as meshup from '@archiyou/meshup'

import type { AnyShape, MeshingQualitySettings, FaceMesh, EdgeMesh } from './types'
import { MESHING_MAX_DEVIATION, MESHING_ANGULAR_DEFLECTION, MESHING_MINIMUM_POINTS,
    MESHING_TOLERANCE, MESHING_EDGE_MIN_LENGTH } from './constants'

/** The meshing quality the exporters use when the caller does not ask for something else. */
export const DEFAULT_MESHING_QUALITY: MeshingQualitySettings = {
    linearDeflection: MESHING_MAX_DEVIATION,
    angularDeflection: MESHING_ANGULAR_DEFLECTION,
    tolerance: MESHING_TOLERANCE,
    edgeMinimalPoints: MESHING_MINIMUM_POINTS,
    edgeMinimalLength: MESHING_EDGE_MIN_LENGTH,
}

/** Is this a brep Shape? Structural, so this module never has to import the brep classes
 *  (which would create a cycle through the barrel). meshup Shapes have `type` too, but only
 *  ever 'Mesh' | 'Curve' | 'Polygon' | 'Vertex'. */
export function isBrepShape(s: any): boolean
{
    return !!s && typeof s === 'object'
        && ['Vertex', 'Edge', 'Wire', 'Face', 'Shell', 'Solid'].includes(s.type)
        && typeof s.toMeshShape === 'function'
}

//// ==== MESHUP → BREP ==== ////

/** The brep classes the conversion builds with — handed in by the caller (the Modeler holds the
 *  loaded kernel), so this module still never imports the brep barrel. */
export interface BrepFactories
{
    Edge: any
    Wire: any
    Face: any
    Vertex: any
}

/** Sample count for a spline span that cannot be described analytically. The points are ON the
 *  curve (pointAtPerc), and brep interpolates through them, so the fit is exact at the samples
 *  and smooth between them. */
const SPLINE_SAMPLES = 24

const xyz = (p: any): [number, number, number] => [p.x, p.y, p.z]

/** One atomic meshup span → one brep Edge. */
function spanToEdge(span: any, brep: BrepFactories): any
{
    const start = xyz(span.start())
    const end = xyz(span.end())
    const kind = span.subtype?.()

    if (kind === 'Line' || span.isStraight?.())
    {
        return new brep.Edge().makeLine(start, end)
    }
    if (kind === 'Arc' || kind === 'Circle')
    {
        // Three points on the curve pin a circular arc exactly on both kernels
        const mid = span.pointAtPerc(0.5)
        return new brep.Edge().makeArc(start, xyz(mid), end, 'threepoint')
    }
    const points = Array.from({ length: SPLINE_SAMPLES + 1 }, (_, i) => xyz(span.pointAtPerc(i / SPLINE_SAMPLES)))
    return new brep.Edge().makeSpline(points)
}

/** Carry name and explicit style over, so the scene reads the same whichever kernel built it. */
function carryToBrep(source: any, target: any): void
{
    if (!target) return
    const name = source.name?.()
    if (name) { target.name(name) }
    const style = source.style?.explicitData?.()
    if (style && Object.keys(style).length) { target.setStyle?.(style) }
}

/**
 *  Rebuild a meshup Shape as the equivalent brep Shape. Returns null when there is nothing to
 *  convert (an empty curve, an unknown type).
 *
 *  - Curve   → Edge (one span) or Wire (several spans; closed when the curve is)
 *  - Polygon → Face through its vertices
 *  - Vertex  → Vertex
 *  - Mesh    → null: a tessellated solid has no exact brep description; callers keep the Mesh.
 */
export function meshupShapeToBrep(shape: any, brep: BrepFactories): any | null
{
    if (!shape || typeof shape !== 'object') return null

    let out: any = null
    switch (shape.type)
    {
        case 'Curve':
        {
            const spans = (shape.segments?.() ?? shape.spans?.())?.toArray?.() ?? []
            if (spans.length === 0) return null
            const edges = spans.map((s: any) => spanToEdge(s, brep)).filter(Boolean)
            out = (edges.length === 1) ? edges[0] : new brep.Wire().fromEdges(edges)
            break
        }
        case 'Polygon':
        {
            const points = (shape.vertices?.()?.toArray?.() ?? []).map(xyz)
            if (points.length < 3) return null
            out = new brep.Face().fromVertices(points)
            break
        }
        case 'Vertex':
            out = new brep.Vertex(shape.x, shape.y, shape.z)
            break
        default:
            return null
    }

    carryToBrep(shape, out)
    return out
}

/** Flat [x,y,z,x,y,z,…] → meshup Points. */
function coordsToPoints(coords: Array<number>): Array<meshup.Point>
{
    const points: Array<meshup.Point> = []
    for (let i = 0; i + 2 < coords.length; i += 3)
    {
        points.push(new meshup.Point(coords[i], coords[i + 1], coords[i + 2]))
    }
    return points
}

/** Unit normal of the triangle a→b→c, or null when it is degenerate. Used only for nodes
 *  the tessellation left without one — see facesToMesh. */
function triangleNormal(a: meshup.Point, b: meshup.Point, c: meshup.Point): [number, number, number] | null
{
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    return (len > POINT_TOLERANCE) ? [nx / len, ny / len, nz / len] : null
}

/** Tessellated faces → one meshup Mesh.
 *  Each FaceMesh carries its own node buffer plus 0-based triangle indices into it, so the
 *  triangles are resolved per face and concatenated.
 *
 *  The node NORMALS come along, and that matters: meshup's Mesh.fromPolygons() builds every
 *  polygon vertex with a zero normal, and a zero-normal surface takes no light — it renders
 *  as flat grey whatever colour it carries, while the (unlit) edge lines still show their
 *  colour. Carrying OpenCascade's own per-node normals also keeps curved surfaces smooth
 *  rather than faceted, which is what the tessellation computed them for. */
function facesToMesh(faces: Array<FaceMesh>): meshup.Mesh | null
{
    const csgrs = meshup.getCsgrs() as any
    const polygons: Array<any> = []

    faces.forEach(face =>
    {
        if (!face?.vertices?.length || !face?.triangleIndices?.length) return
        const nodes = coordsToPoints(face.vertices)
        const normals = face.normals ?? []

        /** The node's own normal, when the tessellation produced a usable one. */
        const normalAt = (node: number): [number, number, number] | null =>
        {
            const [nx, ny, nz] = [normals[node * 3], normals[node * 3 + 1], normals[node * 3 + 2]]
            if (![nx, ny, nz].every(v => typeof v === 'number' && isFinite(v))) return null
            const len = Math.hypot(nx, ny, nz)
            return (len > POINT_TOLERANCE) ? [nx / len, ny / len, nz / len] : null
        }

        for (let i = 0; i + 2 < face.triangleIndices.length; i += 3)
        {
            const idx = [face.triangleIndices[i], face.triangleIndices[i + 1], face.triangleIndices[i + 2]]
            const [a, b, c] = idx.map(n => nodes[n])
            if (!a || !b || !c) continue        // guard against a truncated index buffer

            // Fall back to the triangle's own plane for any node OC left without a normal.
            const flat = triangleNormal(a, b, c)
            const verts = idx.map((node, n) =>
                [a, b, c][n].toVertexJs(normalAt(node) ?? flat ?? [0, 0, 1]))

            polygons.push(new csgrs.PolygonJs(verts, {}))
        }
    })

    if (polygons.length === 0) return null

    return meshup.Mesh.from(csgrs.MeshJs.fromPolygons(polygons, {}))
}

/** Points that are distinct enough to build a curve from: drops consecutive duplicates.
 *  Necessary because a tessellated brep edge can be fully degenerate — a cone's apex, for
 *  instance, produces a "circle" of 64 coincident points, which Curve.Polyline rejects. */
const POINT_TOLERANCE = 1e-6

function distinctPoints(points: Array<meshup.Point>): Array<meshup.Point>
{
    const out: Array<meshup.Point> = []
    points.forEach(p =>
    {
        const prev = out[out.length - 1]
        if (!prev || prev.distance(p) > POINT_TOLERANCE) { out.push(p) }
    })
    return out
}

/** Tessellated edges → meshup Curves (one per brep Edge). Degenerate edges are skipped. */
function edgesToCurves(edges: Array<EdgeMesh>): Array<meshup.Curve>
{
    const curves: Array<meshup.Curve> = []

    edges.forEach(edge =>
    {
        const points = distinctPoints(coordsToPoints(edge?.vertices ?? []))
        if (points.length < 2) return          // a degenerate edge draws nothing
        curves.push(meshup.Curve.Polyline(points as any))
    })

    return curves
}

/** Copy the brep Shape's resolved style and identity onto its meshup stand-in, so the export
 *  is styled and named exactly as the scene says. */
function carryPresentation(source: any, target: any): void
{
    if (!target) return
    const styleData = source._getObjStyle?.()
    if (styleData) { target.style.merge(styleData) }
    if (source._material) { target._material = source._material }
    const name = source.getName?.()
    if (name) { target.name(name) }
}

/**
 *  Rebuild a brep Shape as the equivalent meshup Shape (or a ShapeCollection when it needs
 *  more than one). Returns null when the Shape holds no exportable geometry.
 *
 *  - Solid / Shell / Face → a Mesh of the tessellated faces, plus the shape's own edges as
 *    Curves so the drawing keeps the real silhouette rather than triangulation artefacts.
 *  - Wire / Edge         → Curve(s)
 *  - Vertex              → Vertex
 */
export function brepShapeToMeshup(
    shape: AnyShape | any,
    quality: MeshingQualitySettings = DEFAULT_MESHING_QUALITY,
    options: { edges?: boolean } = {}): meshup.Shape | meshup.ShapeCollection | null
{
    const meshShape = shape?.toMeshShape?.(quality)
    if (!meshShape) return null

    const withEdges = options.edges !== false

    const mesh = facesToMesh(meshShape.faces ?? [])
    const curves = edgesToCurves(meshShape.edges ?? [])

    // A solid/surface: the Mesh is the shape. Its edges ride along as separate Curves when
    // asked for, matching what the mesh kernel exports for a Mesh (edge visibility lines).
    if (mesh)
    {
        carryPresentation(shape, mesh)
        if (!withEdges || curves.length === 0) return mesh

        curves.forEach(c => carryPresentation(shape, c))
        return new meshup.ShapeCollection(mesh, ...curves)
    }

    // Linear shapes
    if (curves.length === 1)
    {
        carryPresentation(shape, curves[0])
        return curves[0]
    }
    if (curves.length > 1)
    {
        // One Curve per brep Edge keeps them individually selectable in the scene
        curves.forEach(c => carryPresentation(shape, c))
        return new meshup.ShapeCollection(...curves)
    }

    // Points
    const vertexCoords = meshShape.vertices?.[0]?.vertices
    if (vertexCoords?.length >= 3)
    {
        const v = new meshup.Vertex(new meshup.Point(vertexCoords[0], vertexCoords[1], vertexCoords[2]))
        carryPresentation(shape, v)
        return v
    }

    return null
}
