/**
 *  DAEExporter — COLLADA (.dae) export for the meshup scene.
 *
 *  Structured like DXFExporter.ts, but walks the scene graph RECURSIVELY instead of a flat
 *  shape list: a meshup SceneNode (0-or-1 shape plus children) maps 1:1 onto a COLLADA
 *  <node>, so the Archiyou layer structure survives into the exported file. The traversal
 *  mirrors GLTFBuilder._sceneNodeToGLTFNode() in meshup.
 *
 *  Two things differ from the glTF path on purpose:
 *    - No axis remapping and no bbox re-centering. meshup is natively Z-up and COLLADA can
 *      declare `<up_axis>Z_UP</up_axis>`, where glTF mandates Y-up.
 *    - Meshes go out as n-gon <polylist> faces (via Mesh.toPolygons()) rather than the
 *      triangle soup Mesh.toBuffer() produces. Welding happens in the WASM writer.
 */

import * as meshup from '@archiyou/meshup'
import { Color } from '@archiyou/meshup'
import { Style } from '@archiyou/meshup'

import {
    createColladaWriter, type ColladaWriter, DEFAULT_WELD_TOLERANCE,
    GEOMETRY_DERIVED_ID_SUFFIXES, MATERIAL_DERIVED_ID_SUFFIXES,
} from '@archiyou/collada-wasm'
import { MM_PER_UNIT } from '../units/UnitConverter'
import type { ModelUnits } from './types'

//// TYPES ////

export interface toDAEOptions
{
    /** Include hidden shapes/nodes. Default false. */
    all?: boolean
    /** Model units, used for the COLLADA <unit> element. Default 'mm'. */
    units?: ModelUnits
    /** Keep meshup's n-gon faces as <polylist>. Default true; false emits <triangles>. */
    ngons?: boolean
    /** Weld tolerance in model units. Default 1e-5; 0 disables welding. */
    weld?: number
}

//// CONSTANTS ////

/** COLLADA unit names for each model unit. */
const COLLADA_UNIT_NAMES: Record<ModelUnits, string> = {
    mm: 'millimeter', cm: 'centimeter', dm: 'decimeter', m: 'meter', km: 'kilometer',
    inch: 'inch', feet: 'foot', yd: 'yard', mi: 'mile',
}

/** Fallback diffuse when a style carries no parseable colour. */
const DEFAULT_RGB: [number, number, number] = [204, 204, 204]

//// SMALL UTILS ////

/**
 *  Sanitize to an XML NCName, WITHOUT uniquifying — for `name` attributes.
 *
 *  In COLLADA 1.4.1 every `name` attribute is typed xs:NCName (it only became a free-form
 *  xs:token in 1.5), so no spaces, no ':' and no leading digit. A layer called 'my walls',
 *  a shape called 'Mesh:Box' or a material called 'Beton C30/37' makes the whole document
 *  schema-invalid — which lenient web viewers ignore but SketchUp, which validates against
 *  the 1.4.1 schema on import, rejects the file for.
 */
function ncnameLabel(raw: string): string
{
    let label = (raw || 'node').replace(/[^A-Za-z0-9_.-]/g, '_')
    if (!/^[A-Za-z_]/.test(label)) label = `_${label}`
    return label
}

/**
 *  Sanitize to a unique XML NCName. COLLADA ids must be NCNames, but the natural identity
 *  here — SceneNode.path(), e.g. 'Scene/walls/Box%5B0%5D' — contains '/' and '%'.
 *
 *  `derivedSuffixes` are ids the WASM writer will mint off this one (`geom_Box-positions`
 *  and friends). They live in the same xs:ID namespace, so they are reserved here too and
 *  a candidate whose derived names are already taken is skipped.
 */
function ncname(raw: string, used: Set<string>, derivedSuffixes: readonly string[] = []): string
{
    const base = ncnameLabel(raw)

    let id = base
    let n = 1
    while (used.has(id) || derivedSuffixes.some(suffix => used.has(id + suffix)))
    {
        id = `${base}_${n++}`
    }

    used.add(id)
    for (const suffix of derivedSuffixes) { used.add(id + suffix) }
    return id
}

/** Parse any CSS colour to 0..1 floats, falling back to grey. Reuses meshup's parser. */
function toRgb01(color: unknown): [number, number, number]
{
    let rgb = DEFAULT_RGB
    try { if (color !== undefined && color !== null) rgb = new Color(color as any).toRgb() }
    catch { /* unparseable — keep the fallback */ }
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
}

/** Cascade a node's effective style onto one of its shapes, as GLTFBuilder does. */
function cascadedStyle(node: any, shape: any): any
{
    try
    {
        const merged = new Style(node.effectiveStyle().toData())
        merged.merge(shape.style.explicitData())
        return merged
    }
    catch { return shape.style }
}

/** A node/shape is exportable unless its style says hidden. */
function isVisible(styleOwner: any): boolean
{
    // NOTE: SceneNode.visible(v) is a SETTER — calling it bare would throw. Read the Style.
    return styleOwner?.style?.visible !== false
}

//// MATERIALS ////

interface ResolvedMaterial { id: string; name: string; rgba: [number, number, number, number] }

/**
 *  Resolve a shape's cascaded style to a COLLADA material, registering it with the writer
 *  the first time each distinct one is seen.
 *
 *  `style.material` is either a MaterialRenderSpec object or a bare material-name string —
 *  see shapeAnnotations.ts, which writes whichever it can resolve. Shapes with no material
 *  at all still get one, built from the style colour, so colours are never lost.
 */
function resolveMaterial(
    writer: ColladaWriter,
    style: any,
    cache: Map<string, ResolvedMaterial>,
    usedIds: Set<string>): ResolvedMaterial
{
    const spec = style?.material
    const isSpec = spec && typeof spec === 'object'

    const name: string = (isSpec ? spec.name : (typeof spec === 'string' ? spec : undefined)) ?? 'color'
    const pbr = isSpec ? spec.pbr : undefined

    // Colours stay sRGB here — COLLADA's convention — unlike Style.toGltfMaterial(), which
    // converts to linear for glTF.
    const [r, g, b] = toRgb01(pbr?.color ?? style?.color)
    const a: number = pbr?.alpha ?? style?.opacity ?? 1

    const key = `${name}|${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)},${a.toFixed(4)}`
    const hit = cache.get(key)
    if (hit) return hit

    const resolved: ResolvedMaterial = {
        id: ncname(`mat_${name}`, usedIds, MATERIAL_DERIVED_ID_SUFFIXES),
        name: ncnameLabel(name),
        rgba: [r, g, b, a],
    }
    writer.addMaterial(resolved.id, resolved.name, r, g, b, a)
    cache.set(key, resolved)
    return resolved
}

//// GEOMETRY ////

/**
 *  Emit a mesh as n-gon faces.
 *
 *  Reads the RAW PolygonJs handles from Mesh.toPolygons() rather than Mesh.polygons(), which
 *  allocates a wrapped Polygon shape per face and carries scene decorators. Faces with holes
 *  are triangulated first — <polylist> has no way to express a hole.
 */
function addPolylistMesh(writer: ColladaWriter, mesh: any, id: string, name: string, weld: number): boolean
{
    const polygons = mesh.toPolygons?.() ?? []
    if (!polygons.length) return false

    const positions: number[] = []
    const normals: number[] = []
    const vcount: number[] = []

    for (const polygon of polygons)
    {
        let faces = [polygon]
        try { if (polygon.hasHoles?.()) faces = polygon.triangulate() ?? [] }
        catch { faces = [polygon] }

        for (const face of faces)
        {
            // flat [x,y,z, nx,ny,nz] per vertex of the outer ring
            const arr: Float64Array = face.toArray?.()
            if (!arr || arr.length < 18) continue // fewer than 3 vertices — degenerate

            // Take the normal from the face PLANE, not from the per-vertex normals in
            // toArray(). Those lose their sign — a box reports only 3 distinct vertex
            // normals instead of 6, so half its faces would be lit inside-out — whereas
            // plane().normal() gives the correct outward direction. A polygon face is
            // planar by definition, so one normal for the whole face is also correct.
            let nx = 0, ny = 0, nz = 0
            let havePlaneNormal = false
            try
            {
                const pn = face.plane?.()?.normal?.()
                if (pn && Number.isFinite(pn.x))
                {
                    ;({ x: nx, y: ny, z: nz } = pn)
                    havePlaneNormal = true
                }
            }
            catch { /* fall through to the per-vertex normals */ }

            const n = Math.floor(arr.length / 6)
            for (let i = 0; i < n; i++)
            {
                const o = i * 6
                positions.push(arr[o], arr[o + 1], arr[o + 2])
                if (havePlaneNormal) { normals.push(nx, ny, nz) }
                else { normals.push(arr[o + 3], arr[o + 4], arr[o + 5]) }
            }
            vcount.push(n)
        }
    }

    if (!vcount.length) return false

    // The writer has the last word: it drops faces that welding leaves degenerate, and says
    // so when that empties the mesh out entirely.
    return writer.addPolylistGeometry(
        id, name,
        Float32Array.from(positions), Float32Array.from(normals), Uint32Array.from(vcount),
        weld)
}

/** Emit a mesh as indexed triangles — the `ngons: false` fallback. */
function addTriangleMesh(writer: ColladaWriter, mesh: any, id: string, name: string, weld: number): boolean
{
    const buffer = mesh.toBuffer?.()
    if (!buffer || !buffer.indices?.length) return false

    return writer.addMeshGeometry(
        id, name,
        Float32Array.from(buffer.positions), Float32Array.from(buffer.normals),
        Uint32Array.from(buffer.indices),
        weld)
}

/** Emit a curve as a tessellated polyline. */
function addCurve(writer: ColladaWriter, curve: any, id: string, name: string): boolean
{
    const points: Float32Array = curve.toBuffer?.()
    if (!points || points.length < 6) return false // need at least 2 points

    return writer.addLinesGeometry(id, name, points)
}

//// MAIN ////

/**
 *  Build a COLLADA document from a scene graph, preserving its node hierarchy.
 *  Returns null (with a warning) when nothing exportable was found.
 */
export async function buildDAE(root: meshup.SceneNode, opts: toDAEOptions = {}): Promise<string | null>
{
    const options = { all: false, units: 'mm' as ModelUnits, ngons: true, weld: DEFAULT_WELD_TOLERANCE, ...opts }
    if (!root) return null

    const units = options.units ?? 'mm'
    const writer = await createColladaWriter({
        unitName: COLLADA_UNIT_NAMES[units] ?? 'millimeter',
        meter: (MM_PER_UNIT[units] ?? 1) / 1000,
        upAxis: 'Z_UP',
    })

    try
    {
        // Drop empty layers so they don't become empty <node>s (Modeler.toGLB does the same).
        root.pruneEmptyNodes?.()

        const usedIds = new Set<string>()
        const materials = new Map<string, ResolvedMaterial>()
        /** shape id -> geometry id, so an instanced shape emits its buffers once. */
        const geometryIds = new Map<string, string>()
        let geometryCount = 0

        const emitGeometry = (shape: any): string | null =>
        {
            const shapeId: string | undefined = shape.id?.()
            if (shapeId && geometryIds.has(shapeId)) return geometryIds.get(shapeId)!

            const name: string = ncnameLabel(shape.name?.() || shape.type || 'shape')
            const id = ncname(`geom_${name}`, usedIds, GEOMETRY_DERIVED_ID_SUFFIXES)

            let ok = false
            try
            {
                switch (shape.type)
                {
                    case 'Mesh':
                        ok = options.ngons
                            ? addPolylistMesh(writer, shape, id, name, options.weld)
                            : addTriangleMesh(writer, shape, id, name, options.weld)
                        break

                    case 'Polygon':
                    {
                        const mesh = shape.toMesh?.()
                        if (mesh)
                        {
                            ok = options.ngons
                                ? addPolylistMesh(writer, mesh, id, name, options.weld)
                                : addTriangleMesh(writer, mesh, id, name, options.weld)
                        }
                        break
                    }

                    case 'Curve':
                        ok = addCurve(writer, shape, id, name)
                        break

                    // Vertex has no COLLADA primitive here — skipped, as DXF skips non-2D shapes
                    default:
                        ok = false
                }
            }
            catch (e)
            {
                console.warn(`buildDAE(): failed to export shape '${name}':`, e)
                ok = false
            }

            if (!ok) return null

            geometryCount++
            if (shapeId) geometryIds.set(shapeId, id)
            return id
        }

        const visit = (node: any): void =>
        {
            if (!options.all && !isVisible(node)) return // whole subtree drops out

            // The `node_` prefix keeps node ids in their own corner of the single xs:ID
            // namespace, alongside `geom_` and `mat_` — without it the root node's path
            // ('Scene') collides with the `<visual_scene id="Scene">` the writer emits.
            const nodeId = ncname(`node_${node.path?.() ?? node.name ?? 'node'}`, usedIds)
            writer.beginNode(nodeId, ncnameLabel(node.name ?? nodeId))

            const shape = node.shape?.()
            if (shape && (options.all || isVisible(shape)))
            {
                const geomId = emitGeometry(shape)
                if (geomId)
                {
                    // Resolved per INSTANCE, not per geometry: the same shape instanced
                    // twice can carry different materials, which is what the symbol
                    // indirection in <bind_material> is for.
                    const material = resolveMaterial(writer, cascadedStyle(node, shape), materials, usedIds)
                    writer.attachGeometry(geomId, material.id)
                }
            }

            const children = node.children?.() ?? []
            for (const child of children) { visit(child) }

            writer.endNode()
        }

        visit(root)

        if (geometryCount === 0)
        {
            console.warn('buildDAE(): No exportable geometry in scene. Nothing to export.')
            return null
        }

        return writer.toStringDae()
    }
    finally
    {
        writer.free()
    }
}
