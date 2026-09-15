/**
 * FCStdExporter.ts
 *
 * FreeCAD (.FCStd) export. A shape whose recipe maps onto FreeCAD's own parametric features
 * (Part::Box, Part::Cylinder, Part::Sphere, Part::Cut, Part::MultiFuse, Part::MultiCommon) is
 * exported as those features, so it stays editable in FreeCAD. Everything else is exported as
 * baked geometry. Design: plans/RECIPE.md.
 *
 * Sections
 *   1. Options
 *   2. Planar BRep writer   faceted OpenCascade .brp text for meshes, polygons and polylines
 *   3. Primitive facets     shape caches for primitives that are not the visible result
 *   4. Document model       FreeCAD objects and properties, Document.xml, GuiDocument.xml
 *   5. Mapping              recipe tree -> FreeCAD features (FCSTD mapping table)
 *   6. Parameters           the ArchiyouParams spreadsheet and dimension bindings
 *   7. Scene walk           buildFCStd()
 *   8. Zip                  store/deflate writer, no dependencies
 *
 * Facts about the format this file relies on, verified against FreeCAD 1.1.3 sources and the
 * FreeCAD example files (EngineBlock.FCStd):
 *
 *  - Every `Count`/`count` attribute is a loop bound in the reader and must be exact. Properties
 *    that are left out keep their defaults, so objects only carry what matters.
 *  - A feature's Placement is taken from its cached shape's location when the file loads, so a
 *    primitive's cache is written in its own frame with a BRep location equal to its Placement.
 *    (Found by opening exports in FreeCAD 1.1.1: world-space caches reset every Placement.)
 *  - FreeCAD does NOT recompute on load, so every visible object ships a cached Shape (.brp).
 *    Objects whose cache is only approximate (faceted curved surfaces) are written Touched, so
 *    one Recompute in FreeCAD makes them exact.
 *  - Zip entries are read sequentially, in the order their properties were read: Document.xml,
 *    then the .brp files in object order, then GuiDocument.xml.
 *  - Part::Box has its CORNER at the placement origin; Part::Cylinder and Part::Cone stand on
 *    their base centre along +Z; Part::Sphere is centred. Placement angles are radians and
 *    Q0..Q3 is x, y, z, w.
 *  - All lengths are millimetres; geometry is scaled from model units.
 *  - ProgramVersion below 1.1 makes every FreeCAD version read a colour's last byte as
 *    transparency (0 = opaque), which is what we write.
 */

import * as meshup from '@archiyou/meshup'
import { Color, Style } from '@archiyou/meshup'

import type { ModelUnits } from './types'
import { MM_PER_UNIT } from '../units/UnitConverter'
import { isBrepShape } from './brep/toMeshup'
import {
    recipeOf, resolveRecipe, mapRecipe, affineApply, affineFrame, affineInverse, axesToQuaternion, leafNodes,
    RecipeReport, fmt,
    type Vec3, type Affine, type RecipeNode, type LeafNode, type BooleanNode, type RecipeMapping, type MapContext,
} from './Recipe'

//// 1. OPTIONS ////

/** A script parameter as the spreadsheet needs it (a ScriptParam fits) */
export interface FCStdParam
{
    name: string
    type: string
    label?: string
    description?: string
    units?: ModelUnits
    default?: unknown
    _value?: unknown
    value?: unknown
    schema?: { minimum?: number; maximum?: number }
}

export interface toFCStdOptions
{
    /** Model units of the scene; FreeCAD geometry is always millimetres */
    units?: ModelUnits
    /** Include hidden shapes (exported with Visibility off) */
    all?: boolean
    /** Emit FreeCAD parametric features from recipes. Off bakes every shape. */
    parametric?: boolean
    /** Script parameters for the ArchiyouParams spreadsheet */
    params?: FCStdParam[]
    /** Bind primitive dimensions that equal a parameter value to that spreadsheet cell */
    bindParams?: boolean
    /** Document metadata */
    meta?: { title?: string; script?: string; version?: string; author?: string; url?: string; variant?: string }
    /** Deflate the zip entries (default true). Stored entries are larger but need no compression API. */
    compress?: boolean
    /** Fixed timestamp for byte-identical output in tests */
    timestamp?: string
}

export interface FCStdResult
{
    data: Uint8Array
    report: RecipeReport
}

//// 2. PLANAR BREP WRITER ////

export interface BRepFace
{
    outer: Vec3[]
    holes?: Vec3[][]
}

export interface BRepText
{
    text: string
    /** 'solid' when every edge is shared by exactly two faces in opposite directions */
    kind: 'solid' | 'shell' | 'wires'
    faces: number
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

/** Newell normal of a ring: its length is twice the ring's area. */
function newell(ring: Vec3[]): Vec3
{
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < ring.length; i++)
    {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        x += (a[1] - b[1]) * (a[2] + b[2]);
        y += (a[2] - b[2]) * (a[0] + b[0]);
        z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [x, y, z];
}

/** Welds points within `tolerance`, looking in neighbouring grid cells so a cell border never
 *  splits two points that belong together. */
class Welder
{
    readonly points: Vec3[] = [];
    private cells = new Map<string, number[]>();
    constructor(private tolerance: number) {}

    id(p: Vec3): number
    {
        const t = this.tolerance;
        const c = [Math.floor(p[0] / t), Math.floor(p[1] / t), Math.floor(p[2] / t)];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        {
            for (const i of this.cells.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? [])
            {
                if (len(sub(this.points[i], p)) <= t) return i;
            }
        }
        const i = this.points.length;
        this.points.push(p);
        const key = `${c[0]},${c[1]},${c[2]}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key)!.push(i);
        return i;
    }
}

/** Number for the .brp text: shortest exact form, which OpenCascade's strtod reads back exactly. */
const brepNum = (n: number) => (Object.is(n, -0) || Math.abs(n) < 1e-300) ? '0' : String(n);

/** Serialises OpenCascade TShapes. Records are written children first and numbered from the
 *  END (the last record is 1), which is what BRepTools_ShapeSet expects. */
class BRepShapeSet
{
    readonly curves2d: string[] = [];
    readonly curves: string[] = [];
    readonly surfaces: string[] = [];
    private records: Array<(index: (pos: number) => number) => string> = [];

    add(write: (index: (pos: number) => number) => string): number
    {
        this.records.push(write);
        return this.records.length - 1;
    }

    /** `location`: a rigid 3x4 placement of the root shape, geometry being in its local frame */
    toString(root: number, location?: Affine): string
    {
        const n = this.records.length;
        const index = (pos: number) => n - pos;
        const section = (title: string, rows: string[]) => `${title} ${rows.length}\n${rows.map(r => `${r}\n`).join('')}`;
        const locations = location
            ? `Locations 1\n1\n${[0, 1, 2].map(r => location.slice(r * 4, r * 4 + 4).map(brepNum).join(' ') + ' \n').join('')}`
            : 'Locations 0\n';
        return 'CASCADE Topology V1, (c) Matra-Datavision\n'
            + locations
            + section('Curve2ds', this.curves2d)
            + section('Curves', this.curves)
            + 'Polygon3D 0\n'
            + 'PolygonOnTriangulations 0\n'
            + section('Surfaces', this.surfaces)
            + 'Triangulations 0\n'
            + `\nTShapes ${n}\n`
            + this.records.map(write => write(index)).join('')
            + `\n+${index(root)} ${location ? 1 : 0}\n`;
    }
}

/** Faceted solid (or shell, when the faces do not close) from planar polygons with holes. Returns
 *  null when nothing non-degenerate is left. Coordinates are written as given; with a `location`
 *  they are local coordinates and the shape is placed by it. */
export function writePlanarBRep(input: BRepFace[], tolerance = 1e-6, location?: Affine): BRepText | null
{
    const welder = new Welder(tolerance);
    const cleanRing = (ring: Vec3[]): number[] =>
    {
        const ids: number[] = [];
        for (const p of ring)
        {
            const id = welder.id(p);
            if (ids[ids.length - 1] !== id) ids.push(id);
        }
        while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
        return ids;
    };

    let faces = input
        .map(f => ({ outer: cleanRing(f.outer), holes: (f.holes ?? []).map(cleanRing).filter(h => h.length >= 3) }))
        .filter(f => f.outer.length >= 3);

    // Booleans leave T-junctions: a vertex of one face sitting in the middle of a neighbour's
    // edge. Split those edges so the two faces share their boundary exactly and the shell closes.
    faces = splitTJunctions(faces, welder.points, tolerance);

    const P = welder.points;
    const ringPoints = (ids: number[]) => ids.map(i => P[i]);
    type Face = { outer: number[]; holes: number[][]; normal: Vec3 };
    let planar: Face[] = [];
    for (const f of faces)
    {
        const n = newell(ringPoints(f.outer));
        if (len(n) < tolerance * tolerance) continue; // zero area
        const normal = unit(n);
        // holes run the other way round the normal than the outer boundary
        const holes = f.holes.map(h => dot(newell(ringPoints(h)), normal) > 0 ? [...h].reverse() : h);
        planar.push({ outer: f.outer, holes, normal });
    }
    if (!planar.length) return null;

    // Directed edge use decides closedness
    const uses = new Map<string, number>();
    const rings = (f: Face) => [f.outer, ...f.holes];
    for (const f of planar) for (const ring of rings(f)) for (let i = 0; i < ring.length; i++)
    {
        const key = `${ring[i]}>${ring[(i + 1) % ring.length]}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    let closed = true;
    for (const [key, count] of uses)
    {
        const [a, b] = key.split('>');
        if (count !== 1 || uses.get(`${b}>${a}`) !== 1) { closed = false; break; }
    }

    // A closed shell whose faces point inwards is turned inside out
    if (closed)
    {
        let volume = 0;
        for (const f of planar) for (const ring of rings(f))
        {
            const pts = ringPoints(ring);
            for (let i = 1; i < pts.length - 1; i++) volume += dot(pts[0], cross(pts[i], pts[i + 1]));
        }
        if (volume < 0)
        {
            planar = planar.map(f => ({ outer: [...f.outer].reverse(), holes: f.holes.map(h => [...h].reverse()), normal: scale(f.normal, -1) }));
        }
    }

    const set = new BRepShapeSet();
    const tol = brepNum(Math.max(1e-7, tolerance));

    // Surfaces: one plane per face, X along its first edge
    const frames = planar.map(f =>
    {
        const origin = P[f.outer[0]];
        const e = sub(P[f.outer[1]], origin);
        const x = unit(sub(e, scale(f.normal, dot(e, f.normal))));
        const y = cross(f.normal, x);
        set.surfaces.push(`1 ${[...origin, ...f.normal, ...x, ...y].map(brepNum).join(' ')}`);
        return { origin, x, y, surface: set.surfaces.length };
    });

    // Vertices
    const vertexPos = new Map<number, number>();
    const vertex = (id: number) =>
    {
        if (!vertexPos.has(id))
        {
            const p = P[id];
            vertexPos.set(id, set.add(() => `Ve\n${tol}\n${p.map(brepNum).join(' ')}\n0 0\n\n0101101\n*\n`));
        }
        return vertexPos.get(id)!;
    };

    // Edges: one per unordered vertex pair, running from the lower id to the higher
    const edgeFaces = new Map<string, number[]>();
    planar.forEach((f, fi) => rings(f).forEach(ring => ring.forEach((a, i) =>
    {
        const b = ring[(i + 1) % ring.length];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        const list = edgeFaces.get(key)!;
        if (!list.includes(fi)) list.push(fi);
    })));

    const edgePos = new Map<string, number>();
    for (const [key, faceIds] of edgeFaces)
    {
        const [a, b] = key.split('-').map(Number);
        const pa = P[a], pb = P[b];
        const length = len(sub(pb, pa));
        const dir = unit(sub(pb, pa));
        set.curves.push(`1 ${[...pa, ...dir].map(brepNum).join(' ')}`);
        const curve = set.curves.length;
        const pcurves = faceIds.map(fi =>
        {
            const fr = frames[fi];
            const rel = sub(pa, fr.origin);
            const d = [dot(dir, fr.x), dot(dir, fr.y)];
            const dl = Math.hypot(d[0], d[1]) || 1;
            set.curves2d.push(`1 ${[dot(rel, fr.x), dot(rel, fr.y), d[0] / dl, d[1] / dl].map(brepNum).join(' ')}`);
            return `2  ${set.curves2d.length} ${fr.surface} 0 0 ${brepNum(length)}\n`;
        }).join('');
        const va = vertex(a), vb = vertex(b);
        edgePos.set(key, set.add(idx =>
            `Ed\n ${tol} 1 1 0\n1  ${curve} 0 0 ${brepNum(length)}\n${pcurves}0\n\n0101000\n+${idx(va)} 0 -${idx(vb)} 0 *\n`));
    }

    const wire = (ring: number[]) =>
    {
        const edges = ring.map((a, i) =>
        {
            const b = ring[(i + 1) % ring.length];
            return { pos: edgePos.get(a < b ? `${a}-${b}` : `${b}-${a}`)!, forward: a < b };
        });
        return set.add(idx => `Wi\n\n0101100\n${edges.map(e => `${e.forward ? '+' : '-'}${idx(e.pos)} 0`).join(' ')} *\n`);
    };

    const facePos = planar.map((f, fi) =>
    {
        const wires = rings(f).map(wire);
        return set.add(idx => `Fa\n0  ${tol} ${frames[fi].surface} 0\n\n0111000\n${wires.map(w => `+${idx(w)} 0`).join(' ')} *\n`);
    });

    const shell = set.add(idx => `Sh\n\n${closed ? '0101100' : '0101000'}\n${facePos.map(f => `+${idx(f)} 0`).join(' ')} *\n`);
    const root = closed ? set.add(idx => `So\n\n1100000\n+${idx(shell)} 0 *\n`) : shell;

    return { text: set.toString(root, location), kind: closed ? 'solid' : 'shell', faces: planar.length };
}

function splitTJunctions(faces: Array<{ outer: number[]; holes: number[][] }>, P: Vec3[], tolerance: number)
{
    const uses = new Map<string, number>();
    const all = (f: { outer: number[]; holes: number[][] }) => [f.outer, ...f.holes];
    for (const f of faces) for (const ring of all(f)) for (let i = 0; i < ring.length; i++)
    {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    const open = [...uses].filter(([, c]) => c === 1).map(([k]) => k.split('-').map(Number));
    if (!open.length) return faces;

    // T-junction vertices are endpoints of other open edges
    const candidates = [...new Set(open.flat())];
    const splitRing = (ring: number[]) =>
    {
        const out: number[] = [];
        ring.forEach((a, i) =>
        {
            const b = ring[(i + 1) % ring.length];
            out.push(a);
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            if (uses.get(key) !== 1) return;
            const pa = P[a], d = sub(P[b], pa), l2 = dot(d, d);
            if (l2 === 0) return;
            const inner = candidates
                .filter(c => c !== a && c !== b)
                .map(c => ({ c, t: dot(sub(P[c], pa), d) / l2 }))
                .filter(({ c, t }) => t > 0 && t < 1 && len(sub(P[c], add(pa, scale(d, t)))) <= tolerance)
                .sort((u, v) => u.t - v.t);
            inner.forEach(({ c }) => out.push(c));
        });
        return out;
    };
    return faces.map(f => ({ outer: splitRing(f.outer), holes: f.holes.map(splitRing) }));
}

/** Wires from polylines (closed when the last point repeats the first), as a compound. */
export function writePolylineBRep(polylines: Vec3[][], tolerance = 1e-6): BRepText | null
{
    const welder = new Welder(tolerance);
    const lines = polylines
        .map(pts => pts.map(p => welder.id(p)).filter((id, i, ids) => i === 0 || ids[i - 1] !== id))
        .filter(ids => ids.length >= 2);
    if (!lines.length) return null;

    const P = welder.points;
    const set = new BRepShapeSet();
    const tol = brepNum(Math.max(1e-7, tolerance));
    const vertexPos = new Map<number, number>();
    const vertex = (id: number) =>
    {
        if (!vertexPos.has(id))
        {
            const p = P[id];
            vertexPos.set(id, set.add(() => `Ve\n${tol}\n${p.map(brepNum).join(' ')}\n0 0\n\n0101101\n*\n`));
        }
        return vertexPos.get(id)!;
    };

    const wires = lines.map(ids =>
    {
        const edges = ids.slice(0, -1).map((a, i) =>
        {
            const b = ids[i + 1];
            const pa = P[a], length = len(sub(P[b], pa));
            set.curves.push(`1 ${[...pa, ...unit(sub(P[b], pa))].map(brepNum).join(' ')}`);
            const curve = set.curves.length;
            const va = vertex(a), vb = vertex(b);
            return set.add(idx => `Ed\n ${tol} 1 1 0\n1  ${curve} 0 0 ${brepNum(length)}\n0\n\n0101000\n+${idx(va)} 0 -${idx(vb)} 0 *\n`);
        });
        const closed = ids[0] === ids[ids.length - 1];
        return set.add(idx => `Wi\n\n${closed ? '0101100' : '0101000'}\n${edges.map(e => `+${idx(e)} 0`).join(' ')} *\n`);
    });
    const root = set.add(idx => `Co\n\n1100000\n${wires.map(w => `+${idx(w)} 0`).join(' ')} *\n`);
    return { text: set.toString(root), kind: 'wires', faces: 0 };
}

//// 3. PRIMITIVE FACETS ////

/** Facets of a primitive in its world placement, in millimetres. Used as the shape cache of
 *  operands, which are hidden and replaced by FreeCAD's exact shape on Recompute. */
function leafFaces(node: LeafNode, mm: number, segments: number): BRepFace[]
{
    const M = node.matrix;
    const world = (p: Vec3): Vec3 => scale(affineApply(M, p), mm);
    const mirrored = affineFrame(M).handedness < 0;
    const face = (ring: Vec3[]): BRepFace => ({ outer: (mirrored ? [...ring].reverse() : ring).map(world) });
    const step = node.step;
    const n = Math.max(8, segments);

    switch (step.op)
    {
        case 'box':
        {
            const [x, y, z] = step.size.map(s => s / 2);
            const c = (i: number, j: number, k: number): Vec3 => [i ? x : -x, j ? y : -y, k ? z : -z];
            return [
                face([c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)]), // -z
                face([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]), // +z
                face([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]), // -y
                face([c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)]), // +y
                face([c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)]), // -x
                face([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]), // +x
            ];
        }
        case 'cylinder':
        case 'cone':
        {
            const [r1, r2, h] = step.op === 'cylinder' ? [step.radius, step.radius, step.height] : [step.r1, step.r2, step.height];
            const ring = (r: number, z: number) => Array.from({ length: n }, (_, i): Vec3 =>
                [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), z]);
            const bottom = ring(r1, 0), top = ring(r2, h);
            const faces: BRepFace[] = [];
            if (r1 > 0) faces.push(face([...bottom].reverse()));
            if (r2 > 0) faces.push(face(top));
            for (let i = 0; i < n; i++)
            {
                const j = (i + 1) % n;
                if (r1 > 0 && r2 > 0) faces.push(face([bottom[i], bottom[j], top[j], top[i]]));
                else if (r1 > 0) faces.push(face([bottom[i], bottom[j], top[0]]));
                else faces.push(face([bottom[0], top[j], top[i]]));
            }
            return faces;
        }
        case 'sphere':
        {
            const rings = Math.max(4, Math.round(n / 2));
            const point = (i: number, j: number): Vec3 =>
            {
                const theta = Math.PI * i / rings, phi = 2 * Math.PI * j / n;
                return [step.radius * Math.sin(theta) * Math.cos(phi), step.radius * Math.sin(theta) * Math.sin(phi), step.radius * Math.cos(theta)];
            };
            const faces: BRepFace[] = [];
            for (let i = 0; i < rings; i++) for (let j = 0; j < n; j++)
            {
                const a = point(i, j), b = point(i + 1, j), c = point(i + 1, j + 1), d = point(i, j + 1);
                if (i === 0) faces.push(face([a, b, c]));
                else if (i === rings - 1) faces.push(face([a, b, d]));
                else faces.push(face([a, b, c, d]));
            }
            return faces;
        }
    }
}

//// 4. DOCUMENT MODEL ////

const xmlAttr = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

/** Property numbers at 15 significant digits: exact enough for any model, and it keeps the float
 *  noise of composed rotations (5.000000000000001) out of FreeCAD's property editor. */
const fcNum = (n: number) => Number.isFinite(n) ? String(Number(n.toPrecision(15)) || 0) : '0';

export interface FcPlacement { position: Vec3; quaternion: [number, number, number, number] /* w, x, y, z */ }

const IDENTITY_PLACEMENT: FcPlacement = { position: [0, 0, 0], quaternion: [1, 0, 0, 0] };

/** One property, serialised the way FreeCAD writes it. */
export const prop = {
    string: (name: string, value: string) => `<Property name="${name}" type="App::PropertyString">\n<String value="${xmlAttr(value)}"/>\n</Property>`,
    bool: (name: string, value: boolean) => `<Property name="${name}" type="App::PropertyBool">\n<Bool value="${value ? 'true' : 'false'}"/>\n</Property>`,
    length: (name: string, value: number) => `<Property name="${name}" type="App::PropertyLength">\n<Float value="${fcNum(value)}"/>\n</Property>`,
    angle: (name: string, value: number) => `<Property name="${name}" type="App::PropertyAngle">\n<Float value="${fcNum(value)}"/>\n</Property>`,
    link: (name: string, target: string) => `<Property name="${name}" type="App::PropertyLink">\n<Link value="${xmlAttr(target)}"/>\n</Property>`,
    linkList: (name: string, targets: string[]) => `<Property name="${name}" type="App::PropertyLinkList">\n<LinkList count="${targets.length}">\n${targets.map(t => `<Link value="${xmlAttr(t)}"/>\n`).join('')}</LinkList>\n</Property>`,
    map: (name: string, values: Record<string, string>) => `<Property name="${name}" type="App::PropertyMap">\n<Map count="${Object.keys(values).length}">\n${Object.entries(values).map(([k, v]) => `<Item key="${xmlAttr(k)}" value="${xmlAttr(v)}"/>\n`).join('')}</Map>\n</Property>`,
    shape: (name: string, file: string) => `<Property name="${name}" type="Part::PropertyPartShape">\n<Part file="${xmlAttr(file)}"/>\n</Property>`,
    placement: (name: string, p: FcPlacement) =>
    {
        const [w, x, y, z] = p.quaternion;
        const s = Math.sqrt(Math.max(0, 1 - w * w));
        const angle = 2 * Math.acos(Math.max(-1, Math.min(1, w)));
        const axis: Vec3 = s < 1e-12 ? [0, 0, 1] : [x / s, y / s, z / s];
        return `<Property name="${name}" type="App::PropertyPlacement">\n<PropertyPlacement Px="${fcNum(p.position[0])}" Py="${fcNum(p.position[1])}" Pz="${fcNum(p.position[2])}" `
            + `Q0="${fcNum(x)}" Q1="${fcNum(y)}" Q2="${fcNum(z)}" Q3="${fcNum(w)}" A="${fcNum(angle)}" Ox="${fcNum(axis[0])}" Oy="${fcNum(axis[1])}" Oz="${fcNum(axis[2])}"/>\n</Property>`;
    },
    expressions: (bindings: Array<{ path: string; expression: string }>) =>
        `<Property name="ExpressionEngine" type="App::PropertyExpressionEngine">\n<ExpressionEngine count="${bindings.length}">\n${bindings.map(b => `<Expression path="${xmlAttr(b.path)}" expression="${xmlAttr(b.expression)}"/>\n`).join('')}</ExpressionEngine>\n</Property>`,
};

export interface FcObject
{
    name: string
    type: string
    label: string
    props: string[]
    bindings: Array<{ path: string; expression: string }>
    /** The cached shape; null writes an empty cache (FreeCAD fills it on Recompute); left out,
     *  the object has no Shape property at all (groups, spreadsheets) */
    brep?: string | null
    visible: boolean
    touched: boolean
    color?: [number, number, number]
    transparency?: number
}

/** FreeCAD object names are identifiers and unique per document; labels are free text. */
class NameAllocator
{
    private used = new Set<string>();

    allocate(label: string, fallback = 'Shape'): string
    {
        let base = String(label ?? '').normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        if (!base || !/^[A-Za-z_]/.test(base)) base = `${fallback}${base ? `_${base}` : ''}`;
        let name = base, n = 0;
        while (this.used.has(name)) name = `${base}${String(++n).padStart(3, '0')}`;
        this.used.add(name);
        return name;
    }
}

function documentXml(objects: FcObject[], docProps: string[]): string
{
    const lines: string[] = [
        `<?xml version='1.0' encoding='utf-8'?>`,
        `<!--`,
        ` FreeCAD Document, see https://www.freecad.org for more information...`,
        ` Written by Archiyou.`,
        `-->`,
        `<Document SchemaVersion="4" ProgramVersion="0.21R0 (Archiyou)" FileVersion="1">`,
        `<Properties Count="${docProps.length}" TransientCount="0">`,
        ...docProps,
        `</Properties>`,
        `<Objects Count="${objects.length}">`,
        ...objects.map((o, i) => `<Object type="${o.type}" name="${o.name}" id="${i + 1}"${o.touched ? ' Touched="1"' : ''}/>`),
        `</Objects>`,
        `<ObjectData Count="${objects.length}">`,
    ];
    for (const o of objects)
    {
        const props = [
            prop.string('Label', o.label),
            ...o.props,
            ...(o.brep !== undefined ? [prop.shape('Shape', o.brep === null ? '' : shapeFile(o))] : []),
            ...(o.bindings.length ? [prop.expressions(o.bindings)] : []),
            prop.bool('Visibility', o.visible),
        ];
        lines.push(`<Object name="${o.name}">`, `<Properties Count="${props.length}" TransientCount="0">`, ...props, `</Properties>`, `</Object>`);
    }
    lines.push(`</ObjectData>`, `</Document>`, '');
    return lines.join('\n');
}

function guiDocumentXml(objects: FcObject[]): string
{
    const lines = [
        `<?xml version='1.0' encoding='utf-8'?>`,
        `<Document SchemaVersion="1">`,
        `<ViewProviderData Count="${objects.length}">`,
    ];
    for (const o of objects)
    {
        const props = [`<Property name="Visibility" type="App::PropertyBool">\n<Bool value="${o.visible ? 'true' : 'false'}"/>\n</Property>`];
        if (o.color)
        {
            const [r, g, b] = o.color.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255));
            const packed = ((r << 24) | (g << 16) | (b << 8)) >>> 0; // last byte: transparency, 0 = opaque
            props.push(`<Property name="ShapeColor" type="App::PropertyColor">\n<PropertyColor value="${packed}"/>\n</Property>`);
            props.push(`<Property name="Transparency" type="App::PropertyPercent">\n<Integer value="${Math.round(o.transparency ?? 0)}"/>\n</Property>`);
        }
        lines.push(`<ViewProvider name="${o.name}">`, `<Properties Count="${props.length}" TransientCount="0">`, ...props, `</Properties>`, `</ViewProvider>`);
    }
    lines.push(`</ViewProviderData>`, `<Camera settings=""/>`, `</Document>`, '');
    return lines.join('\n');
}

const shapeFile = (o: FcObject) => `${o.name}.Shape.brp`;

//// 5. MAPPING ////

/** What a mapping row produced: the FreeCAD object that stands for the node */
interface Emitted
{
    name: string
    /** The node's cached shape is exact (no faceted curved surfaces, no empty caches) */
    exact: boolean
}

interface MappingEnv
{
    subject: string
    mm: number
    segments: number
    allocate: (label: string, fallback: string) => string
    /** Objects created for the shape being mapped; discarded if the shape bakes */
    draft: FcObject[]
    bind: (value: number, axisScale: number, ctx: MapContext<Emitted>) => string | null
}

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(['Part::Box', 'Part::Cylinder', 'Part::Cone', 'Part::Sphere']);

/** A FreeCAD Placement as a 3x4 matrix: x -> R(q) x + position */
export function placementMatrix(p: FcPlacement): Affine
{
    const [w, x, y, z] = p.quaternion;
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), p.position[0],
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), p.position[1],
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), p.position[2],
    ];
}

function placementFromAxes(origin: Vec3, axes: [Vec3, Vec3, Vec3]): FcPlacement
{
    return { position: origin, quaternion: axesToQuaternion(axes) };
}

/** The FreeCAD mapping table. A row per node kind; everything without a row bakes. */
function createFCStdMapping(env: MappingEnv): RecipeMapping<Emitted>
{
    const primitive = (node: LeafNode, type: string, ctx: MapContext<Emitted>, props: (frame: ReturnType<typeof leafFrame>) => { props: string[]; bindings: Array<{ path: string; expression: string }>; placement: FcPlacement }): Emitted =>
    {
        const frame = leafFrame(node, env.mm, ctx);
        const built = props(frame);
        const name = env.allocate(`${env.subject}_${node.step.op}`, node.step.op);
        // FreeCAD takes a feature's Placement from its cached shape's location when it loads the
        // file, so the cache is written in the feature's own frame and placed by the Placement
        const placement = placementMatrix(built.placement);
        const toLocal = affineInverse(placement)!;
        const localFaces = leafFaces(node, env.mm, env.segments).map(f => ({
            outer: f.outer.map(p => affineApply(toLocal, p)),
            holes: (f.holes ?? []).map(h => h.map(p => affineApply(toLocal, p))),
        }));
        env.draft.push({
            name, type, label: `${env.subject} · ${node.step.op}`,
            props: [...built.props, prop.placement('Placement', built.placement)],
            bindings: built.bindings,
            brep: writePlanarBRep(localFaces, 1e-6 * Math.max(1, Math.max(...frame.scales) * env.mm * leafExtent(node)), placement)?.text ?? null,
            visible: false, touched: node.step.op !== 'box',
        });
        return { name, exact: node.step.op === 'box' };
    };

    const binding = (path: string, value: number, axisScale: number, ctx: MapContext<Emitted>) =>
    {
        const expression = env.bind(value, axisScale, ctx);
        return expression ? [{ path, expression }] : [];
    };

    const boolean = (type: string, node: BooleanNode, ctx: MapContext<Emitted>, props: (base: Emitted, tools: Emitted[]) => string[]): Emitted =>
    {
        const base = ctx.map(node.base);
        const tools = node.tools.map(t => ctx.map(t));
        const name = env.allocate(`${env.subject}_${node.op}`, node.op);
        env.draft.push({
            name, type, label: `${env.subject} · ${node.op}`,
            props: props(base, tools), bindings: [], brep: null, visible: false, touched: true,
        });
        return { name, exact: false };
    };

    return {
        box: (node: LeafNode, ctx) => primitive(node, 'Part::Box', ctx, f =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'box' }>;
            const size = [0, 1, 2].map(i => step.size[i] * f.scales[i] * env.mm) as unknown as Vec3;
            // Part::Box grows from its corner, our box from its centre
            const corner = f.axes.reduce((p, axis, i) => sub(p, scale(axis, size[i] / 2)), f.origin);
            return {
                props: [prop.length('Length', size[0]), prop.length('Width', size[1]), prop.length('Height', size[2])],
                bindings: [
                    ...binding('Length', step.size[0], f.scales[0], ctx),
                    ...binding('Width', step.size[1], f.scales[1], ctx),
                    ...binding('Height', step.size[2], f.scales[2], ctx),
                ],
                placement: placementFromAxes(corner, f.axes),
            };
        }),

        cylinder: (node: LeafNode, ctx) => primitive(node, 'Part::Cylinder', ctx, f =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'cylinder' }>;
            if (Math.abs(f.scales[0] - f.scales[1]) > 1e-9 * f.scales[0]) ctx.bake('cylinder scaled differently across its radius (elliptic)');
            return {
                props: [prop.length('Radius', step.radius * f.scales[0] * env.mm), prop.length('Height', step.height * f.scales[2] * env.mm), prop.angle('Angle', 360)],
                bindings: [...binding('Radius', step.radius, f.scales[0], ctx), ...binding('Height', step.height, f.scales[2], ctx)],
                placement: placementFromAxes(f.origin, f.axes),
            };
        }),

        cone: (node: LeafNode, ctx) => primitive(node, 'Part::Cone', ctx, f =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'cone' }>;
            if (Math.abs(f.scales[0] - f.scales[1]) > 1e-9 * f.scales[0]) ctx.bake('cone scaled differently across its radius (elliptic)');
            return {
                props: [prop.length('Radius1', step.r1 * f.scales[0] * env.mm), prop.length('Radius2', step.r2 * f.scales[0] * env.mm), prop.length('Height', step.height * f.scales[2] * env.mm), prop.angle('Angle', 360)],
                bindings: [],
                placement: placementFromAxes(f.origin, f.axes),
            };
        }),

        sphere: (node: LeafNode, ctx) => primitive(node, 'Part::Sphere', ctx, f =>
        {
            const step = node.step as Extract<LeafNode['step'], { op: 'sphere' }>;
            const s = f.scales[0];
            if (Math.abs(f.scales[1] - s) > 1e-9 * s || Math.abs(f.scales[2] - s) > 1e-9 * s) ctx.bake('sphere scaled non-uniformly (ellipsoid)');
            return {
                props: [prop.length('Radius', step.radius * s * env.mm)],
                bindings: binding('Radius', step.radius, s, ctx),
                placement: placementFromAxes(f.origin, f.axes),
            };
        }),

        // Part::Cut is binary: several tools are fused first, as FreeCAD users do
        cut: (node: BooleanNode, ctx) => boolean('Part::Cut', node, ctx, (base, tools) =>
        {
            let tool = tools[0].name;
            if (tools.length > 1)
            {
                tool = env.allocate(`${env.subject}_tools`, 'tools');
                env.draft.push({
                    name: tool, type: 'Part::MultiFuse', label: `${env.subject} · tools`,
                    props: [prop.linkList('Shapes', tools.map(t => t.name))], bindings: [], brep: null, visible: false, touched: true,
                });
            }
            return [prop.link('Base', base.name), prop.link('Tool', tool)];
        }),
        fuse: (node: BooleanNode, ctx) => boolean('Part::MultiFuse', node, ctx, (base, tools) => [prop.linkList('Shapes', [base.name, ...tools.map(t => t.name)])]),
        common: (node: BooleanNode, ctx) => boolean('Part::MultiCommon', node, ctx, (base, tools) => [prop.linkList('Shapes', [base.name, ...tools.map(t => t.name)])]),
    };
}

/** Largest local dimension of a primitive, for weld tolerances */
function leafExtent(node: LeafNode): number
{
    const step = node.step;
    switch (step.op)
    {
        case 'box': return Math.max(...step.size);
        case 'cylinder': return Math.max(2 * step.radius, step.height);
        case 'cone': return Math.max(2 * step.r1, 2 * step.r2, step.height);
        case 'sphere': return 2 * step.radius;
    }
}

/** A primitive's frame in millimetres, with a mirror folded into a flipped local x axis (every
 *  primitive is symmetric across its local YZ plane, so the shape is the same). */
function leafFrame(node: LeafNode, mm: number, ctx: MapContext<Emitted>)
{
    const frame = affineFrame(node.matrix);
    if (!frame.orthogonal) ctx.bake(`${node.step.op} is sheared by a non-uniform scale after a rotation`);
    if (frame.scales.some(s => s < 1e-12)) ctx.bake(`${node.step.op} is scaled to zero`);
    const axes: [Vec3, Vec3, Vec3] = [frame.axes[0], frame.axes[1], frame.axes[2]];
    if (frame.handedness < 0)
    {
        axes[0] = scale(axes[0], -1);
        ctx.note(`mirrored ${node.step.op} written as a rotation`);
    }
    return { origin: scale(frame.origin, mm), axes, scales: frame.scales };
}

//// 6. PARAMETERS ////

const SHEET_NAME = 'ArchiyouParams';

/** FreeCAD expression unit per Archiyou model unit */
const FC_UNITS: Record<string, string> = { mm: 'mm', cm: 'cm', dm: 'dm', m: 'm', km: 'km', inch: 'in', feet: 'ft', yd: 'yd', mi: 'mi' };

/** Tokens the FreeCAD expression lexer reads as units or constants; an alias may not be one. */
const RESERVED_ALIASES = new Set(('nm um mm cm dm m km l ml Hz kHz MHz GHz THz ug mg g kg t s min h A mA kA MA K mK uK mol mmol cd in ft thou mil yd mi mph sqft cft '
    + 'lb lbm oz st cwt lbf N mN kN MN Pa kPa MPa GPa bar mbar Torr mTorr uTorr psi ksi Mpsi W mW kW VA V kV mV MS kS S mS uS Ohm kOhm MOhm C T G Wb F mF uF nF pF '
    + 'H mH uH nH J mJ kJ Nm VAs CV Ws kWh eV keV MeV cal kcal deg rad gon M AS pi e None True true False false').split(' '));

function aliasFor(name: string, used: Set<string>): string
{
    let alias = String(name).replace(/[^A-Za-z0-9_]/g, '_');
    const invalid = (a: string) => !/^[A-Za-z][_A-Za-z0-9]*$/.test(a) || /^[A-Za-z]{1,3}[0-9]+$/.test(a) || RESERVED_ALIASES.has(a) || used.has(a);
    if (invalid(alias)) alias = `P_${alias}`;
    let candidate = alias, n = 1;
    while (invalid(candidate)) candidate = `${alias}_${n++}`;
    used.add(candidate);
    return candidate;
}

interface SheetParam { param: FCStdParam; alias: string; value: unknown }

function paramValue(p: FCStdParam): unknown
{
    return p._value ?? p.value ?? p.default;
}

function buildSheet(params: FCStdParam[], allocate: (label: string, fallback: string) => string): { object: FcObject; entries: SheetParam[] } | null
{
    const scalars = params.filter(p => p && p.name);
    if (!scalars.length) return null;
    const used = new Set<string>();
    const entries = scalars.map(param => ({ param, alias: aliasFor(param.name, used), value: paramValue(param) }));

    const cell = (address: string, content: string, extra = '') => `<Cell address="${address}" content="${xmlAttr(content)}"${extra}/>`;
    const text = (s: unknown) => `'${String(s ?? '')}`; // a leading quote makes FreeCAD store text
    const cells: string[] = [
        cell('A1', text('Parameter'), ' style="bold"'), cell('B1', text('Value'), ' style="bold"'),
        cell('C1', text('Units'), ' style="bold"'), cell('D1', text('Min'), ' style="bold"'),
        cell('E1', text('Max'), ' style="bold"'), cell('F1', text('Description'), ' style="bold"'),
    ];
    entries.forEach(({ param, alias, value }, i) =>
    {
        const row = i + 2;
        let content: string;
        if (param.type === 'number' && typeof value === 'number' && Number.isFinite(value))
        {
            content = param.units && FC_UNITS[param.units] ? `=${fcNum(value)} ${FC_UNITS[param.units]}` : fcNum(value);
        }
        else if (param.type === 'boolean') content = value ? '=1' : '=0';
        else content = text(typeof value === 'object' ? JSON.stringify(value) : value);

        cells.push(cell(`A${row}`, text(param.label || param.name)));
        cells.push(cell(`B${row}`, content, ` alias="${alias}"`));
        if (param.units) cells.push(cell(`C${row}`, text(param.units)));
        if (param.schema?.minimum !== undefined) cells.push(cell(`D${row}`, fcNum(param.schema.minimum)));
        if (param.schema?.maximum !== undefined) cells.push(cell(`E${row}`, fcNum(param.schema.maximum)));
        if (param.description) cells.push(cell(`F${row}`, text(param.description)));
    });

    const object: FcObject = {
        name: allocate(SHEET_NAME, 'Sheet'), type: 'Spreadsheet::Sheet', label: 'Parameters',
        props: [`<Property name="cells" type="Spreadsheet::PropertySheet">\n<Cells Count="${cells.length}">\n${cells.join('\n')}\n</Cells>\n</Property>`],
        bindings: [], visible: true, touched: false,
    };
    return { object, entries };
}

//// 7. SCENE WALK ////

function toRgb01(color: unknown): [number, number, number]
{
    let rgb: number[] = [0x99, 0x99, 0x99];
    try { if (color !== undefined && color !== null) rgb = new Color(color as any).toRgb(); }
    catch { /* unparseable: keep grey */ }
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/** The node's effective style cascaded onto its shape, as the DAE and glTF exporters do */
function cascadedStyle(node: any, shape: any): any
{
    try
    {
        const merged = new Style(node.effectiveStyle().toData());
        merged.merge(shape.style.explicitData());
        return merged;
    }
    catch { return shape?.style; }
}

const isVisible = (owner: any) => owner?.style?.visible !== false;

function meshFaces(mesh: any, mm: number): BRepFace[]
{
    const inner = mesh.inner?.();
    if (!inner) return [];
    // Merge coplanar triangles into real faces. Called on the raw kernel mesh: the Mesh method
    // is @sceneReplace and would detach the shape from the scene.
    const ngons = inner.reconstructNgons?.() ?? inner;
    const position = (v: any): Vec3 => { const p = v.position(); return [p.x * mm, p.y * mm, p.z * mm]; };
    return (ngons.polygons?.() ?? []).map((poly: any) => ({
        outer: (poly.vertices() as any[]).map(position),
        holes: ((poly.holes?.() ?? []) as any[][]).map(h => h.map(position)),
    }));
}

async function brepShapeText(shape: any, mm: number): Promise<string | null>
{
    const { getOc } = await import('./brep/index');
    const oc = getOc();
    let ocShape = shape._ocShape;
    if (!ocShape) return null;
    if (mm !== 1)
    {
        const trsf = new oc.gp_Trsf_1();
        trsf.SetScale(new oc.gp_Pnt_3(0, 0, 0), mm);
        ocShape = new oc.BRepBuilderAPI_Transform_2(ocShape, trsf, true).Shape();
    }
    const file = `/archiyou_fcstd_${Math.random().toString(36).slice(2)}.brp`;
    oc.BRepTools.Write_3(ocShape, file, new oc.Message_ProgressRange_1());
    try { return oc.FS.readFile(file, { encoding: 'utf8' }); }
    finally { try { oc.FS.unlink(file); } catch { /* already gone */ } }
}

/** Build a FreeCAD document from a scene. Returns null when nothing exportable was found. */
export async function buildFCStd(root: meshup.SceneNode, opts: toFCStdOptions = {}): Promise<FCStdResult | null>
{
    const options = { units: 'mm' as ModelUnits, all: false, parametric: true, bindParams: true, compress: true, ...opts };
    const mm = MM_PER_UNIT[options.units] ?? 1;
    const quality: any = (meshup as any).getQuality?.() ?? {};
    const segments = quality.cylinderSegmentsRadial ?? 32;
    const report = new RecipeReport();
    const names = new NameAllocator();
    const allocate = (label: string, fallback: string) => names.allocate(label, fallback);
    const objects: FcObject[] = [];

    const sheet = buildSheet(options.params ?? [], allocate);
    const numberParams = (sheet?.entries ?? []).filter(e => e.param.type === 'number' && typeof e.value === 'number');

    /** Bind a dimension to a parameter when exactly one parameter has its value. A heuristic:
     *  without value tracing we cannot know the dimension came from the parameter. */
    const bind = (value: number, axisScale: number, ctx: MapContext<Emitted>): string | null =>
    {
        if (!options.bindParams || !sheet || Math.abs(axisScale - 1) > 1e-12 || !(value > 0)) return null;
        const hits = numberParams.filter(e => Math.abs((e.value as number) - value) <= 1e-9 * Math.max(1, Math.abs(value)));
        if (hits.length !== 1)
        {
            if (hits.length > 1) ctx.note(`${fmt(value)} equals ${hits.map(h => h.param.name).join(', ')}: not bound`);
            return null;
        }
        const { param, alias } = hits[0];
        const ref = `${sheet.object.name}.${alias}`;
        if (!param.units) return `${ref} * 1 ${FC_UNITS[options.units] ?? 'mm'}`;
        if (param.units === options.units) return ref;
        return null; // the cell carries different units than the model: equality is a coincidence
    };

    const exportShape = async (node: any, shape: any): Promise<string | null> =>
    {
        const label = String(shape.name?.() || node.name || shape.type || 'Shape');
        const style = cascadedStyle(node, shape);
        const color = toRgb01(style?.color);
        const transparency = Math.round((1 - (style?.opacity ?? 1)) * 100);
        const visible = isVisible(node) && isVisible(shape);

        // The visible result's cache is always the real geometry
        let brep: string | null = null;
        let kind = 'shape';
        if (isBrepShape(shape))
        {
            brep = await brepShapeText(shape, mm);
            kind = 'exact brep';
        }
        else if (shape.type === 'Mesh')
        {
            const b = writePlanarBRep(meshFaces(shape, mm), 1e-6 * mm * Math.max(1, bboxSize(shape)));
            brep = b?.text ?? null;
            kind = b?.kind ?? 'mesh';
        }
        else if (shape.type === 'Polygon')
        {
            const poly = shape.inner?.();
            const position = (v: any): Vec3 => { const p = v.position(); return [p.x * mm, p.y * mm, p.z * mm]; };
            brep = poly ? writePlanarBRep([{ outer: poly.vertices().map(position), holes: (poly.holes?.() ?? []).map((h: any[]) => h.map(position)) }], 1e-6 * mm)?.text ?? null : null;
            kind = 'face';
        }
        else if (shape.type === 'Curve')
        {
            const pts: Vec3[] = (shape.tessellate?.() ?? []).map((p: any) => [p.x * mm, p.y * mm, p.z * mm]);
            if (shape.isClosed?.() && pts.length > 2) pts.push(pts[0]);
            brep = writePolylineBRep([pts], 1e-6 * mm)?.text ?? null;
            kind = 'wire';
        }
        if (brep === null)
        {
            report.add({ subject: label, status: 'baked', reason: `${shape.type ?? 'shape'} has no exportable geometry`, notes: [], tags: [] });
            return null;
        }

        const draft: FcObject[] = [];
        let wasBaked = false;
        const baked = (): Emitted =>
        {
            wasBaked = true;
            draft.length = 0;
            draft.push({ name: allocate(label, 'Shape'), type: 'Part::Feature', label, props: [], bindings: [], brep, visible, touched: false });
            return { name: draft[0].name, exact: true };
        };

        let emitted: Emitted;
        const recipe = options.parametric && (shape.type === 'Mesh' || isBrepShape(shape)) ? recipeOf(shape) : null;
        if (recipe)
        {
            const tree = resolveRecipe(recipe);
            const env: MappingEnv = { subject: label, mm, segments, allocate, draft, bind };
            emitted = mapRecipe<Emitted>(tree, createFCStdMapping(env), { subject: label, fallback: baked, report });

            if (!wasBaked)
            {
                // The top feature is what the user sees: real geometry, name, style
                const top = draft.find(o => o.name === emitted.name)!;
                // A lone primitive keeps its own placed cache (see primitive()); a boolean has an
                // identity placement, so it can carry the real geometry in world coordinates
                Object.assign(top, { label, visible }, PRIMITIVE_TYPES.has(top.type) ? {} : { brep });
                const exact = emitted.exact && leafNodes(tree).every(l => l.step.op === 'box') && !draft.some(o => o !== top && o.brep === null);
                draft.forEach(o => { o.color = color; o.transparency = transparency; o.touched = !exact; });
                top.touched = !exact;
            }
        }
        else
        {
            emitted = baked();
            report.add({ subject: label, status: 'baked', reason: options.parametric ? (shape.type === 'Mesh' || isBrepShape(shape) ? 'shape was not recorded' : `${kind} is exported as geometry`) : 'parametric export is off', notes: [], tags: [] });
        }

        for (const o of draft) { o.color ??= color; o.transparency ??= transparency; }
        objects.push(...draft);
        return emitted.name;
    };

    const visit = async (node: any, isRoot: boolean): Promise<string[]> =>
    {
        if (!options.all && !isVisible(node)) return [];
        const own: string[] = [];
        const shape = node.shape?.();
        if (shape && (options.all || isVisible(shape)))
        {
            const name = await exportShape(node, shape);
            if (name) own.push(name);
        }
        const children: string[] = [];
        for (const child of node.children?.() ?? []) children.push(...await visit(child, false));

        // A node that only wraps its shape is not a layer: its shape goes straight to the parent
        if (isRoot || !children.length) return [...own, ...children];
        const group = allocate(node.name || 'Layer', 'Layer');
        objects.push({
            name: group, type: 'App::DocumentObjectGroup', label: node.name || 'Layer',
            props: [prop.linkList('Group', [...own, ...children])], bindings: [],
            visible: true, touched: false,
        });
        return [group];
    };

    await visit(root, true);
    const exported = objects.filter(o => o.type !== 'App::DocumentObjectGroup');
    if (!exported.length)
    {
        console.warn('buildFCStd(): no exportable geometry in the scene.');
        return null;
    }
    if (sheet) objects.push(sheet.object);

    const meta = options.meta ?? {};
    const timestamp = options.timestamp ?? new Date().toISOString();
    const docMeta: Record<string, string> = Object.fromEntries(Object.entries({
        'archiyou.script': meta.script, 'archiyou.version': meta.version, 'archiyou.author': meta.author,
        'archiyou.url': meta.url, 'archiyou.variant': meta.variant, 'archiyou.units': options.units,
        'archiyou.report': report.summary(),
    }).filter(([, v]) => v !== undefined && v !== null && v !== '') as Array<[string, string]>);

    const docProps = [
        prop.string('Comment', `Exported by Archiyou. ${report.toString()}\nShapes marked for recompute have faceted caches of curved surfaces: press Recompute to rebuild them exactly.`),
        prop.string('CreatedBy', meta.author ?? 'Archiyou'),
        prop.string('CreationDate', timestamp),
        prop.string('Label', meta.title ?? meta.script ?? 'Archiyou model'),
        prop.string('LastModifiedDate', timestamp),
        prop.map('Meta', docMeta),
    ];

    // Entry order is the read order: Document.xml, shape files in object order, GuiDocument.xml
    const encoder = new TextEncoder();
    const entries: Array<{ name: string; data: Uint8Array }> = [{ name: 'Document.xml', data: encoder.encode(documentXml(objects, docProps)) }];
    for (const o of objects)
    {
        if (typeof o.brep === 'string') entries.push({ name: shapeFile(o), data: encoder.encode(o.brep) });
    }
    entries.push({ name: 'GuiDocument.xml', data: encoder.encode(guiDocumentXml(objects)) });

    return { data: await zip(entries, options.compress, timestamp), report };
}

function bboxSize(shape: any): number
{
    try
    {
        const b = shape.bbox();
        return Math.hypot(b.width(), b.depth(), b.height());
    }
    catch { return 1; }
}

//// 8. ZIP ////

const CRC_TABLE = (() =>
{
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++)
    {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Uint8Array): number
{
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null>
{
    if (typeof CompressionStream === 'undefined') return null;
    try
    {
        const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    catch { return null; }
}

/** A plain zip: sizes in the local headers (FreeCAD reads the archive as a stream), deflated where
 *  the runtime can, stored otherwise. */
export async function zip(files: Array<{ name: string; data: Uint8Array }>, compress = true, timestamp?: string): Promise<Uint8Array>
{
    const date = timestamp ? new Date(timestamp) : new Date();
    const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const file of files)
    {
        const name = encoder.encode(file.name);
        const crc = crc32(file.data);
        const deflated = compress ? await deflateRaw(file.data) : null;
        const useDeflate = !!deflated && deflated.length < file.data.length;
        const body = useDeflate ? deflated! : file.data;
        const method = useDeflate ? 8 : 0;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);   // UTF-8 names
        local.setUint16(8, method, true);
        local.setUint16(10, dosTime, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, file.data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        chunks.push(new Uint8Array(local.buffer), name, body);

        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, method, true);
        entry.setUint16(12, dosTime, true);
        entry.setUint16(14, dosDate, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, body.length, true);
        entry.setUint32(24, file.data.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(new Uint8Array(entry.buffer), name);

        offset += 30 + name.length + body.length;
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const out = new Uint8Array(offset + centralSize + 22);
    let pos = 0;
    for (const c of [...chunks, ...central, new Uint8Array(end.buffer)]) { out.set(c, pos); pos += c.length; }
    return out;
}
