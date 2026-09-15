/**
 * SCADExporter.ts
 *
 * OpenSCAD (.scad) export. A shape whose recipe the recorder captured (boxes, boxbetween, cylinders,
 * cones, spheres, extrusions, transforms and booleans) becomes OpenSCAD CSG: cube(), cylinder(),
 * sphere(), linear_extrude() under translate()/multmatrix(), inside difference()/union()/intersection().
 * Anything else becomes a closed polyhedron() of its real geometry. Design: plans/OPENSCAD.md.
 *
 * The file carries the MODEL, not the script's logic: fixed numbers, no Customizer parameters. The
 * script's parameter values are listed in a comment for reference only.
 *
 * Sections
 *   1. Options
 *   2. Text        numbers, vectors, identifiers, colours
 *   3. Frames      a 3x4 affine as nothing, translate() or multmatrix()
 *   4. Mapping     recipe nodes -> OpenSCAD CSG (SCAD_MAPPING)
 *   5. Baking      polyhedron() from a welded shell
 *   6. 2D          polygon() for closed curves and faces
 *   7. Scene walk  buildSCAD()
 *
 * Facts about OpenSCAD this file relies on (2021.01 and later):
 *
 *  - cube(size, center = true) is centred on the origin, the recipe's box frame. cylinder() stands on
 *    z = 0 along +Z, the recipe's cylinder and cone frame. sphere() is centred.
 *  - linear_extrude(height) sweeps a 2D shape from z = 0 to z = height along +Z. Under a multmatrix
 *    whose third column is any vector, that is an exact oblique (sheared) extrusion.
 *  - polyhedron() wants each face's points clockwise when looking at the face from outside.
 *  - A module named like a builtin (cube, rotate...) shadows it everywhere, so part names never are.
 *  - 2D objects render in the XY plane only; a 2D part in another plane is written in its own plane's
 *    coordinates, with the plane in a comment.
 *  - OpenSCAD has no units. Coordinates are the model's own units; STL readers assume millimetres.
 */

import * as meshup from '@archiyou/meshup'

import type { ModelUnits } from './types'
import { isBrepShape, brepShapeToMeshup, DEFAULT_MESHING_QUALITY } from './brep/toMeshup'
import { isVisible, toRgb01 } from './exportStyle'
import { weldFaces, meshFaces, signedVolume, newell, cross, dot, sub, len, unit, type Vec3, type PlanarFace } from './exportGeometry'
import {
    recipeOf, resolveRecipe, mapRecipe, affineCompose, RecipeReport,
    type Affine, type LeafNode, type BooleanNode, type RecipeMapping,
} from './Recipe'

//// 1. OPTIONS ////

export interface SCADParam
{
    name: string
    type?: string
    default?: unknown
    _value?: unknown
    value?: unknown
}

export interface toSCADOptions
{
    /** Model units of the scene, stated in the header; coordinates are not scaled */
    units?: ModelUnits
    /** Script name and version for the header */
    name?: string
    version?: string
    /** Script parameters, listed in the header for reference only */
    params?: SCADParam[]
    /** Include hidden shapes as parts */
    all?: boolean
    /** Emit CSG from recipes (default). Off bakes every shape. */
    parametric?: boolean
    /** Facets for cylinders, cones and spheres; default: the kernel's quality settings */
    fn?: number
}

export interface SCADPart
{
    /** Module name in the file, also the PART value that selects it */
    module: string
    /** The shape's own name */
    label: string
    /** Scene path of the shape's node, its identity across runs */
    path: string
    kind: 'csg' | 'baked' | '2d'
    reason?: string
}

export interface SCADResult
{
    text: string
    parts: SCADPart[]
    report: RecipeReport
}

//// 2. TEXT ////

/** A number as OpenSCAD reads it back: 12 significant digits, float noise and negative zero gone */
export function scadNumber(n: number): string
{
    if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return '0'
    return String(Number(n.toPrecision(12)))
}

export const scadVector = (v: readonly number[]) => `[${v.map(scadNumber).join(', ')}]`

/** Keywords, builtin modules and builtin functions: a module with one of these names would shadow it */
const SCAD_RESERVED = new Set([
    'module', 'function', 'if', 'else', 'for', 'let', 'each', 'true', 'false', 'undef', 'include', 'use', 'assert', 'echo',
    'cube', 'sphere', 'cylinder', 'polyhedron', 'square', 'circle', 'polygon', 'text', 'import', 'surface', 'projection',
    'linear_extrude', 'rotate_extrude', 'translate', 'rotate', 'scale', 'resize', 'mirror', 'multmatrix', 'color', 'offset',
    'hull', 'minkowski', 'union', 'difference', 'intersection', 'intersection_for', 'render', 'children', 'group', 'parent_module',
    'abs', 'sign', 'sin', 'cos', 'tan', 'acos', 'asin', 'atan', 'atan2', 'floor', 'round', 'ceil', 'ln', 'log', 'pow', 'sqrt',
    'exp', 'min', 'max', 'norm', 'cross', 'len', 'concat', 'lookup', 'str', 'chr', 'ord', 'search', 'rands', 'version',
    'version_num', 'is_undef', 'is_bool', 'is_num', 'is_string', 'is_list', 'is_function', 'PART',
])

/** Unique OpenSCAD identifiers from shape names */
export class SCADNames
{
    private used = new Set<string>()

    allocate(label: string): string
    {
        let base = String(label ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
        if (!base) base = 'part'
        if (/^[0-9]/.test(base)) base = `part_${base}`
        if (SCAD_RESERVED.has(base) || base.startsWith('$')) base = `${base}_part`
        let name = base
        for (let n = 2; this.used.has(name); n++) name = `${base}_${n}`
        this.used.add(name)
        return name
    }
}

const indent = (text: string, by = '    ') => text.split('\n').map(l => (l ? by + l : l)).join('\n')
const block = (head: string, children: string[]) => `${head} {\n${children.map(c => indent(c)).join('\n')}\n}`

/** color() for the colour and opacity someone chose, on the shape or a layer above it. Nothing when
 *  neither was chosen: the viewer's default shape colour is not the model's colour. */
function colorOf(node: any, shape: any): string | null
{
    const explicit = (o: any) => { try { return o?.explicitData?.() ?? {} } catch { return {} } }
    const own = explicit(shape?.style)
    const inherited = explicit((() => { try { return node?.effectiveStyle?.() } catch { return null } })())
    const color = own.color ?? inherited.color
    const opacity = own.opacity ?? inherited.opacity ?? 1
    if ((color === undefined || color === null) && opacity >= 1) return null
    const channel = (c: number) => Math.round(c * 1000) / 1000
    const [r, g, b] = toRgb01(color ?? '#cccccc').map(channel)
    return `color(${scadVector(opacity < 1 ? [r, g, b, channel(opacity)] : [r, g, b])})`
}

//// 3. FRAMES ////

const TINY = 1e-12

/** `body` placed by the affine: nothing for the identity, translate() for a pure move, else multmatrix() */
export function placed(M: Affine, body: string): string
{
    const linearIdentity = [0, 1, 2].every(r => [0, 1, 2].every(c => Math.abs(M[r * 4 + c] - (r === c ? 1 : 0)) < TINY))
    const moved = [3, 7, 11].some(i => Math.abs(M[i]) >= TINY)
    if (linearIdentity && !moved) return body
    if (linearIdentity) return `translate(${scadVector([M[3], M[7], M[11]])}) ${body}`
    const rows = [0, 1, 2].map(r => scadVector([M[r * 4], M[r * 4 + 1], M[r * 4 + 2], M[r * 4 + 3]]))
    return `multmatrix([${rows.join(', ')}, [0, 0, 0, 1]]) ${body}`
}

//// 4. MAPPING ////

interface MappingEnv { sphereFn: number; fileFn: number }

/** A leaf's primitive in its recipe frame */
function leaf(node: LeafNode, body: string): string
{
    return placed(node.matrix, body)
}

/** The extrusion frame of a ring: x along its first edge, y in its plane, z along the sweep side of its normal */
function extrusionFrame(ring: readonly Vec3[], vector: Vec3): { origin: Vec3; u: Vec3; v: Vec3; n: Vec3; points: Array<[number, number]> } | null
{
    const nRaw = newell(ring)
    if (len(nRaw) < TINY) return null
    let n = unit(nRaw)
    if (dot(n, vector) < 0) n = [-n[0], -n[1], -n[2]]
    const origin = ring[0]
    const edge = ring.map((p, i) => sub(ring[(i + 1) % ring.length], p)).find(e => len(sub(e, [dot(e, n) * n[0], dot(e, n) * n[1], dot(e, n) * n[2]])) > TINY)
    if (!edge) return null
    const inPlane = sub(edge, [dot(edge, n) * n[0], dot(edge, n) * n[1], dot(edge, n) * n[2]])
    const u = unit(inPlane)
    const v = cross(n, u)
    const points = ring.map(p => { const d = sub(p, origin); return [dot(d, u), dot(d, v)] as [number, number] })
    return { origin, u, v, n, points }
}

function createSCADMapping(env: MappingEnv): RecipeMapping<string>
{
    const boolean = (head: string) => (node: BooleanNode, ctx: any) => block(head, [ctx.map(node.base), ...node.tools.map((t: any) => ctx.map(t))])
    return {
        box: (node: LeafNode) =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'box' }>
            return leaf(node, `cube(${scadVector(step.size)}, center = true);`)
        },
        cylinder: (node: LeafNode) =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'cylinder' }>
            return leaf(node, `cylinder(h = ${scadNumber(step.height)}, r = ${scadNumber(step.radius)});`)
        },
        cone: (node: LeafNode) =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'cone' }>
            return leaf(node, `cylinder(h = ${scadNumber(step.height)}, r1 = ${scadNumber(step.r1)}, r2 = ${scadNumber(step.r2)});`)
        },
        sphere: (node: LeafNode) =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'sphere' }>
            const fn = env.sphereFn !== env.fileFn ? `, $fn = ${env.sphereFn}` : ''
            return leaf(node, `sphere(r = ${scadNumber(step.radius)}${fn});`)
        },
        extrude: (node: LeafNode, ctx) =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'extrude' }>
            const frame = extrusionFrame(step.ring, step.vector)
            if (!frame) return ctx.bake('extrusion profile without area')
            const { origin, u, v, n } = frame
            const height = len(step.vector)
            const perpendicular = Math.abs(dot(unit(step.vector), n) - 1) < 1e-9
            // local x, y in the profile plane; local z along the sweep: the normal (readable) or the sweep vector itself (oblique)
            const z: Vec3 = perpendicular ? n : step.vector
            const local: Affine = [u[0], v[0], z[0], origin[0], u[1], v[1], z[1], origin[1], u[2], v[2], z[2], origin[2]]
            const profile = `polygon([${frame.points.map(p => scadVector(p)).join(', ')}]);`
            return placed(affineCompose(node.matrix, local), `linear_extrude(height = ${perpendicular ? scadNumber(height) : '1'}) ${profile}`)
        },
        cut: boolean('difference()'),
        fuse: boolean('union()'),
        common: boolean('intersection()'),
    }
}

//// 5. BAKING ////

/** A shape's real geometry as a closed polyhedron, or null when it has no faces */
function polyhedronOf(shape: any): { text: string; closed: boolean } | null
{
    const meshes: any[] = isBrepShape(shape)
        ? [brepShapeToMeshup(shape, DEFAULT_MESHING_QUALITY, { edges: false })].flatMap((m: any) => m?.isShapeCollection?.() ? m.toArray() : [m]).filter((m: any) => m?.type === 'Mesh')
        : [shape]
    let faces: PlanarFace[] = meshes.flatMap(m => meshFaces(m))
    // polyhedron faces cannot have holes: fall back to the kernel's own polygons, which never do
    if (faces.some(f => f.holes?.length)) faces = meshes.flatMap(m => meshFaces(m, 1, false))
    const span = Math.max(1, ...faces.flatMap(f => f.outer.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])))))
    const welded = weldFaces(faces, 1e-9 * span)
    if (!welded) return null
    // clockwise from outside: the reverse of the outward (counter-clockwise) rings
    const rings = welded.faces.map(f => [...f.outer].reverse())
    const text = `polyhedron(\n    points = [${welded.points.map(p => scadVector(p)).join(', ')}],\n    faces = [${rings.map(r => `[${r.join(', ')}]`).join(', ')}]\n);`
    return { text, closed: welded.closed }
}

//// 6. 2D ////

/** A closed curve or face as polygon(points, paths), in its own plane's 2D coordinates */
function polygonOf(shape: any): { text: string; plane: string | null } | null
{
    let outer: Vec3[] = []
    let holes: Vec3[][] = []
    if (shape.type === 'Polygon')
    {
        const poly = shape.inner?.()
        if (!poly) return null
        const position = (v: any): Vec3 => { const p = v.position(); return [p.x, p.y, p.z] }
        outer = (poly.vertices() as any[]).map(position)
        holes = ((poly.holes?.() ?? []) as any[][]).map(h => h.map(position))
    }
    else if (shape.type === 'Curve' && shape.isClosed?.())
    {
        const ring = (curve: any): Vec3[] => (curve.tessellate?.() ?? []).map((p: any) => [p.x, p.y, p.z])
        outer = ring(shape)
        holes = ((shape._holes ?? []) as any[]).map(ring)
    }
    else return null

    const dropClosing = (r: Vec3[]) => (r.length > 1 && len(sub(r[0], r[r.length - 1])) < 1e-9) ? r.slice(0, -1) : r
    outer = dropClosing(outer)
    holes = holes.map(dropClosing).filter(h => h.length >= 3)
    if (outer.length < 3) return null

    return planarText([{ outer, holes }])
}

/** Planar faces (each an outer ring with holes) as 2D polygons in the plane of the first face: world
 *  x and y when that plane is horizontal, else its own 2D frame. Null when there is no plane. */
function planarText(faces: Array<{ outer: Vec3[]; holes: Vec3[][] }>): { text: string; plane: string | null } | null
{
    const first = faces.find(f => len(newell(f.outer)) >= TINY)
    if (!first) return null
    const n = unit(newell(first.outer))
    const flat = Math.abs(Math.abs(n[2]) - 1) < 1e-9
    const origin: Vec3 = flat ? [0, 0, 0] : first.outer[0]
    const edge = first.outer.map((p, i) => sub(first.outer[(i + 1) % first.outer.length], p)).find(e => len(e) > TINY)!
    const u: Vec3 = flat ? [1, 0, 0] : unit(sub(edge, [dot(edge, n) * n[0], dot(edge, n) * n[1], dot(edge, n) * n[2]]))
    const v: Vec3 = flat ? [0, 1, 0] : cross(n, u)
    const to2d = (p: Vec3): [number, number] => { const d = sub(p, origin); return [dot(d, u), dot(d, v)] }

    const polygons = faces.filter(f => f.outer.length >= 3).map(f =>
    {
        const rings = [f.outer, ...f.holes]
        const points = rings.flat().map(to2d)
        if (rings.length === 1) return `polygon(${`[${points.map(p => scadVector(p)).join(', ')}]`});`
        let offset = 0
        const paths = rings.map(r => { const path = r.map((_, i) => offset + i); offset += r.length; return path })
        return `polygon(points = [${points.map(p => scadVector(p)).join(', ')}], paths = [${paths.map(p => `[${p.join(', ')}]`).join(', ')}]);`
    })
    if (!polygons.length) return null
    const text = polygons.length === 1 ? polygons[0] : block('union()', polygons)
    const height = first.outer[0][2]
    const plane = flat
        ? (Math.abs(height) > 1e-9 ? `in the plane z = ${scadNumber(height)}` : null)
        : `drawn in its own plane: origin ${scadVector(origin)}, x ${scadVector(u)}, y ${scadVector(v)}`
    return { text, plane }
}

/** A mesh that encloses no volume is a surface, which OpenSCAD cannot represent as a solid. A flat one
 *  becomes 2D polygons in its plane; anything else has no OpenSCAD form.
 *
 *  "Encloses no volume": the signed volume of its faces is zero, or it changes when the faces are
 *  moved. A closed solid's enclosed volume does not depend on where it is; an open surface's sum does,
 *  while a solid with a tiny gap barely moves, so it stays a (slightly open) polyhedron. */
function surfaceOf(shape: any): { flat: { text: string; plane: string | null } | null } | null
{
    const welded = weldFaces(meshFaces(shape, 1, false), 1e-9)
    if (!welded) return null
    const span = Math.max(1, ...welded.points.flatMap(p => p.map(Math.abs)))
    const shifted = welded.points.map(p => [p[0] + span, p[1] + 2 * span, p[2] + 3 * span] as unknown as Vec3)
    const here = signedVolume(welded.points, welded.faces) / 6
    const there = signedVolume(shifted, welded.faces) / 6
    const encloses = Math.abs(here) > 1e-9 * span ** 3 && Math.abs(there - here) <= 1e-6 * Math.abs(here)
    if (encloses || welded.closed) return null
    const faces = meshFaces(shape).map(f => ({ outer: [...f.outer], holes: (f.holes ?? []).map(h => [...h]) }))
    const first = faces.find(f => len(newell(f.outer)) >= TINY)
    if (!first) return { flat: null }
    const n = unit(newell(first.outer))
    const o = first.outer[0]
    const reach = Math.max(1, ...faces.flatMap(f => f.outer.map(p => len(sub(p, o)))))
    const planar = faces.every(f => f.outer.every(p => Math.abs(dot(sub(p, o), n)) <= 1e-6 * reach))
    return { flat: planar ? planarText(faces) : null }
}

//// 7. SCENE WALK ////

/** Build an OpenSCAD file from a scene. Returns null when nothing exportable was found. */
export function buildSCAD(root: meshup.SceneNode, opts: toSCADOptions = {}): SCADResult | null
{
    const options = { units: 'mm' as ModelUnits, all: false, parametric: true, ...opts }
    const quality: any = (meshup as any).getQuality?.() ?? {}
    const fileFn = Math.max(3, Math.round(options.fn ?? quality.cylinderSegmentsRadial ?? 32))
    const sphereFn = Math.max(3, Math.round(options.fn ?? quality.sphereSegmentsWidth ?? fileFn))
    const mapping = createSCADMapping({ fileFn, sphereFn })
    const report = new RecipeReport()
    const names = new SCADNames()
    const parts: SCADPart[] = []
    const modules: string[] = []
    const skipped: string[] = []

    const exportShape = (node: any, shape: any, layer: string) =>
    {
        const label = String(shape.name?.() || node.name || shape.type || 'part')
        const color = colorOf(node, shape)
        const withColor = (body: string) => color ? `${color} ${body}` : body
        /** A comment above the module when it says more than the module name does */
        const heading = (module: string, note?: string): string[] =>
            (module !== label || layer || note) ? [`// ${label}${layer ? `  (layer ${layer})` : ''}${note ? `: ${note}` : ''}`] : []

        const surface = shape.type === 'Mesh' ? surfaceOf(shape) : null
        if (surface)
        {
            if (!surface.flat)
            {
                skipped.push(`${label} (a curved surface: OpenSCAD has no surfaces)`)
                return
            }
            const module = names.allocate(label)
            parts.push({ module, label, path: node.path?.() ?? '', kind: '2d', reason: 'a surface without volume' })
            modules.push([...heading(module, `2D, a surface without volume${surface.flat.plane ? `, ${surface.flat.plane}` : ''}`), block(`module ${module}()`, [withColor(surface.flat.text)])].join('\n'))
            return
        }

        if (shape.type === 'Mesh' || isBrepShape(shape))
        {
            const module = names.allocate(label)
            let reason: string | undefined
            const baked = (why: string): string =>
            {
                reason = why
                const poly = polyhedronOf(shape)
                if (!poly) return ''
                if (!poly.closed) reason = `${why}; the shell is not closed (render with --enable=lazy-union if it drops out)`
                return poly.text
            }
            const recipe = options.parametric ? recipeOf(shape) : null
            const body = recipe
                ? mapRecipe<string>(resolveRecipe(recipe), mapping, { subject: module, fallback: baked, report })
                : baked(options.parametric ? 'shape was not recorded' : 'parametric export is off')
            if (!recipe) report.add({ subject: module, status: 'baked', reason, notes: [], tags: [] })
            if (!body)
            {
                skipped.push(`${label} (no faces)`)
                return
            }
            const kind = reason === undefined ? 'csg' : 'baked'
            parts.push({ module, label, path: node.path?.() ?? '', kind, ...(reason ? { reason } : {}) })
            modules.push([...heading(module, reason ? `baked, ${reason}` : undefined), block(`module ${module}()`, [withColor(body)])].join('\n'))
            return
        }

        if (shape.type === 'Polygon' || shape.type === 'Curve')
        {
            const poly = polygonOf(shape)
            if (!poly)
            {
                skipped.push(`${label} (${shape.type === 'Curve' ? 'open curve' : 'degenerate face'})`)
                return
            }
            const module = names.allocate(label)
            parts.push({ module, label, path: node.path?.() ?? '', kind: '2d' })
            modules.push([...heading(module, poly.plane ? `2D, ${poly.plane}` : '2D'), block(`module ${module}()`, [withColor(poly.text)])].join('\n'))
        }
    }

    const visit = (node: any, layer: string, isRoot: boolean) =>
    {
        if (!options.all && !isVisible(node)) return
        const shape = node.shape?.()
        if (shape && (options.all || isVisible(shape))) exportShape(node, shape, layer)
        const here = isRoot || shape ? layer : [layer, node.name].filter(Boolean).join('/')
        for (const child of node.children?.() ?? []) visit(child, here, false)
    }
    visit(root, '', true)

    if (!parts.length)
    {
        console.warn('buildSCAD(): no exportable geometry in the scene.')
        return null
    }

    const solids = parts.filter(p => p.kind !== '2d')
    const flat = parts.filter(p => p.kind === '2d')
    const params = (options.params ?? []).map(p => ({ name: p.name, value: p._value ?? p.value ?? p.default })).filter(p => p.value !== undefined)
    const header = [
        `// Archiyou -> OpenSCAD${options.name ? `  |  script: ${options.name}${options.version ? ` ${options.version}` : ''}` : ''}  |  units: ${options.units}`,
        `// OpenSCAD has no units: coordinates are in ${options.units}${options.units === 'mm' ? '' : ' (STL readers assume millimetres)'}.`,
        `// Parts: ${solids.filter(p => p.kind === 'csg').length} CSG, ${solids.filter(p => p.kind === 'baked').length} baked, ${flat.length} 2D`,
        ...solids.filter(p => p.kind === 'baked').map(p => `//   baked: ${p.module} (${p.reason})`),
        ...(skipped.length ? [`// Skipped: ${skipped.join(', ')}`] : []),
        ...(params.length ? ['// Parameters at export, for reference only (nothing in this file is linked to them):', ...params.map(p => `//   ${p.name} = ${JSON.stringify(p.value)}`)] : []),
    ]
    const selectors = [
        ...(solids.length ? ['// 3D parts', ...solids.map(p => `if (PART == "" || PART == "${p.module}") ${p.module}();`)] : []),
        ...(flat.length ? ['// 2D parts: select one with PART (OpenSCAD cannot render 2D and 3D together)', ...flat.map(p => `if (PART == "${p.module}") ${p.module}();`)] : []),
    ]
    const text = [
        ...header,
        '',
        `$fn = ${fileFn};`,
        'PART = "";',
        '',
        modules.join('\n\n'),
        '',
        ...selectors,
        '',
    ].join('\n')

    return { text, parts, report }
}
