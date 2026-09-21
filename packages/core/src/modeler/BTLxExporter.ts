/**
 * BTLxExporter.ts
 *
 * BTLx 2.3 (design2machine): the exchange format timber processing machines (Hundegger, Weinmann, ...)
 * and timber CAD (Cadwork, hsbCAD, Dietrich's, SEMA) read. One <Part> per stick, block or sheet, with its
 * angled saw cuts and its drillings as processings. It reads fab.operations(), so the parts, cuts and
 * drillings are exactly the ones the cut list and the estimate see. Design: plans/FAB.md (phase 5).
 *
 * Coordinates follow the BTLx manual: a part's X runs along its length, Y along its height and Z along its
 * width, from a ReferencePoint at a corner. Reference sides 1 to 4 go round the X axis (1 at Y = 0, 2 at
 * Z = 0, 3 at Y = height, 4 at Z = width), 5 is the start and 6 the end. Processing angles are computed
 * from the cut plane or drill axis the way compas_timber (ETH Zurich, MIT licence) computes them, so both
 * write the same numbers for the same geometry.
 *
 * Sections
 *   1. Frames        the part frame and its reference sides
 *   2. Processings   JackRafterCut (angled cuts, two of them for a pointed end), Drilling
 *   3. Parts         sizes, processings, identical parts counted with one Transformation each
 *   4. XML           writer, number format, stable GUIDs
 *   5. Entry         buildBTLx()
 *
 * Square cuts need no processing: the part's Length carries them. Notches, unrecognised operations, fills,
 * fastenings and parts without solid geometry are not written; the file header and the report list them.
 * The holes of the fasteners are written only with { holes: true }.
 */

import type { Modeler } from './Modeler';
import { operations, FAB_HEADER, type FabMember, type SawCut, type Drilling, type FabOperations } from './Fab';
import { dot, sub, add, scale, cross, len, unit, type Vec3 } from './exportGeometry';

/** Marker for buildscripts/check-pack.ts: only this module writes it */
const BTLX_SCHEMA = 'https://www.design2machine.com/btlx/BTLx_2_3_0.xsd';

export interface toBTLxOptions
{
    /** Project name, written as Project Name */
    name?: string
    /** Script version, written in the project comment */
    version?: string
    /** Export date; the default is now. Fixed dates give identical files for identical models. */
    timestamp?: Date | string
    /** Contact tolerance in mm, as in fab.operations() */
    tolerance?: number
    /** Also write the holes of the fasteners (ops.holes()), for pre-drilling */
    holes?: boolean
}

export interface BTLxReport
{
    parts: number
    pieces: number
    processings: number
    notExported: string[]
    summary(): string
    toString(): string
}

//// 1. FRAMES ////

interface PartFrame
{
    origin: Vec3
    x: Vec3
    y: Vec3
    z: Vec3
    /** Model units */
    length: number
    height: number
    width: number
}

interface RefSide
{
    id: number
    point: Vec3
    x: Vec3
    y: Vec3
    /** Outward normal */
    z: Vec3
}

/** X along the length. A stick stands on its narrow side: height is its larger section size. A sheet lies flat:
 *  height is its thickness. */
function partFrame(m: FabMember): PartFrame
{
    const sheet = m.kind === 'sheet';
    const x = m.axes.long;
    const y = sheet ? m.axes.thin : m.axes.wide;
    const z = unit(cross(x, y));
    const length = m.length;
    const height = sheet ? m.thickness : m.width;
    const width = sheet ? m.width : m.thickness;
    const origin = sub(sub(sub(m.center, scale(x, length / 2)), scale(y, height / 2)), scale(z, width / 2));
    return { origin, x, y, z, length, height, width };
}

function refSides(f: PartFrame): RefSide[]
{
    const at = (...parts: Vec3[]) => parts.reduce((acc, p) => add(acc, p), f.origin);
    const side = (id: number, point: Vec3, x: Vec3, y: Vec3): RefSide => ({ id, point, x, y, z: cross(x, y) });
    const neg = (v: Vec3) => scale(v, -1);
    return [
        side(1, f.origin, f.x, f.z),
        side(2, at(scale(f.y, f.height)), f.x, neg(f.y)),
        side(3, at(scale(f.y, f.height), scale(f.z, f.width)), f.x, neg(f.z)),
        side(4, at(scale(f.z, f.width)), f.x, f.y),
        side(5, f.origin, f.z, f.y),
        side(6, at(scale(f.x, f.length), scale(f.y, f.height)), f.z, neg(f.y)),
    ];
}

//// 2. PROCESSINGS ////

const DEG = Math.PI / 180;

function angleBetween(u: Vec3, v: Vec3): number
{
    const lu = len(u), lv = len(v);
    if (lu < 1e-12 || lv < 1e-12) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv)))) / DEG;
}

function signedAngle(u: Vec3, v: Vec3, normal: Vec3): number
{
    const a = angleBetween(u, v);
    return dot(cross(u, v), normal) < 0 ? -a : a;
}

/** BTLx angles live in [0.1, 179.9] */
const clampAngle = (a: number) => Math.min(179.9, Math.max(0.1, a));

interface Processing
{
    name: string
    referencePlane: number
    params: Array<[string, string | number]>
}

/** A cut plane with its outward normal (pointing away from what is kept) as a JackRafterCut on reference side 1 */
function jackRafterCut(f: PartFrame, normal: Vec3, point: Vec3, mm: number): Processing
{
    const rs = refSides(f)[0];
    const orientation = dot(f.x, normal) > 0 ? 'end' : 'start';
    const startX = dot(normal, sub(point, rs.point)) / dot(normal, rs.x);
    const angle = 180 - Math.abs(signedAngle(rs.x, cross(rs.z, normal), rs.z));
    const inclination = 180 - Math.abs(signedAngle(rs.z, normal, cross(rs.z, normal)));
    return {
        name: 'JackRafterCut',
        referencePlane: rs.id,
        params: [
            ['Orientation', orientation],
            ['StartX', startX * mm],
            ['StartY', 0],
            ['StartDepth', 0],
            ['Angle', clampAngle(angle)],
            ['Inclination', clampAngle(inclination)],
        ],
    };
}

/** An angled cut is one JackRafterCut; a pointed end two of them, since each trims what lies beyond its plane */
function sawCutProcessings(m: FabMember, f: PartFrame, cut: SawCut, mm: number, skipped: string[]): Processing[]
{
    if (cut.kind === 'square') return [];
    if (cut.kind === 'double' && !cut.convex)
    {
        skipped.push(`${m.name}: the ${cut.end} is a V cut into the part, not written`);
        return [];
    }
    return cut.planes.map(plane => jackRafterCut(f, plane.normal, plane.point, mm));
}

function drillingProcessing(f: PartFrame, drill: Drilling, mm: number): Processing
{
    const sides = refSides(f);
    // the side the drill goes in through: its outward normal points against the drill
    const rs = sides.reduce((best, side) => dot(side.z, drill.axis) < dot(best.z, drill.axis) ? side : best);
    const entry = drill.entry;
    const startX = dot(sub(entry, rs.point), rs.x);
    const startY = dot(sub(entry, rs.point), rs.y);
    const end = add(entry, scale(drill.axis, drill.depth / mm));
    // the drill direction seen on the side, measured from -x, clockwise seen from outside
    const onSide = sub(end, scale(rs.z, dot(sub(end, entry), rs.z)));
    const flat = sub(onSide, entry);
    let angle = len(flat) < 1e-9 ? 0 : signedAngle(scale(rs.x, -1), flat, scale(rs.z, -1));
    if (angle < 0) angle += 360;
    // the tilt, in the plane the drill turns in
    const turn = (v: Vec3) =>
    {
        const a = -angle * DEG; // about -z
        const k = rs.z;
        return add(add(scale(v, Math.cos(a)), scale(cross(k, v), Math.sin(a))), scale(k, dot(k, v) * (1 - Math.cos(a))));
    };
    const refX = turn(scale(rs.x, -1));
    const refY = turn(scale(rs.y, -1));
    const inclination = signedAngle(refX, drill.axis, refY);
    const depth = drill.through ? 0 : Math.abs(dot(sub(end, entry), rs.z)) * mm;
    return {
        name: 'Drilling',
        referencePlane: rs.id,
        params: [
            ['StartX', startX * mm],
            ['StartY', startY * mm],
            ['Angle', Math.min(360, angle)],
            ['Inclination', clampAngle(Math.abs(inclination))],
            ['DepthLimited', drill.through ? 'no' : 'yes'],
            ['Depth', depth],
            ['Diameter', drill.diameter],
        ],
    };
}

//// 3. PARTS ////

interface PartOut
{
    member: FabMember
    frame: PartFrame
    processings: Processing[]
    /** Everything but the placement: identical parts share it */
    key: string
    /** The name, and which piece of that name: the placement GUID keeps it while other parts change */
    seed: string
}

function partOf(m: FabMember, mm: number, skipped: string[], holes: Drilling[]): PartOut
{
    const frame = partFrame(m);
    const processings = [...m.ops, ...holes].flatMap(op =>
    {
        switch (op.op)
        {
            case 'sawCut': return sawCutProcessings(m, frame, op, mm, skipped);
            case 'drilling': return [drillingProcessing(frame, op, mm)];
            case 'sheathe': return [];
            default:
                skipped.push(`${m.name}: ${op.op} (${op.evidence}), not written`);
                return [];
        }
    });
    const size = [frame.length, frame.height, frame.width].map(v => num(v * mm)).join('x');
    const key = [m.kind, size, m.material?.name ?? '', designation(m), processings.map(xmlProcessing).join('')].join('|');
    return { member: m, frame, processings, key, seed: m.name };
}

/** The name without its number; an unnamed part is called by its kind */
const designation = (m: FabMember) => (/^solid#\d+$/.test(m.name) ? '' : m.name.replace(/\d+$/, '')) || m.kind;

//// 4. XML ////

/** Lengths and angles to 0.001. Directions need more: 0.001 off turns a 3 m part's far end 3 mm. */
const num = (v: number, digits = 3) =>
{
    const k = 10 ** digits;
    const r = Math.round(v * k) / k;
    return String(Object.is(r, -0) ? 0 : r);
};

const escape = (text: string) => text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** XML comments may not contain -- */
const comment = (text: string) => `<!-- ${text.replace(/--+/g, '-')} -->`;

const attrs = (values: Array<[string, string | number | undefined]>) => values
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? num(v) : escape(v)}"`)
    .join('');

function xmlProcessing(p: Processing, id = 0): string
{
    const params = p.params.map(([k, v]) => `<${k}>${typeof v === 'number' ? num(v) : escape(v)}</${k}>`).join('');
    return `<${p.name}${attrs([['Name', p.name], ['ProcessID', id], ['ReferencePlaneID', p.referencePlane]])}>${params}</${p.name}>`;
}

const coordinate = (tag: string, v: Vec3, factor: number, digits = 3) =>
    `<${tag} X="${num(v[0] * factor, digits)}" Y="${num(v[1] * factor, digits)}" Z="${num(v[2] * factor, digits)}"/>`;

/** A GUID from a seed, the same for the same seed: files do not change when the model does not */
function guid(seed: string): string
{
    const hex = [0, 1, 2, 3].map(round =>
    {
        const h = [...`${round}:${seed}`].reduce((acc, ch) => Math.imul(acc ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
        return h.toString(16).padStart(8, '0');
    }).join('');
    return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}}`;
}

function xmlPart(group: PartOut[], number: number, project: string, mm: number, indent: string): string
{
    const [first] = group;
    const { member: m, frame: f } = first;
    const names = group.map(p => p.member.name);
    const transformations = group.map(p => [
        `${indent}    <Transformation GUID="${guid(`${project}|piece|${p.seed}`)}">`,
        `${indent}      <Position>${coordinate('ReferencePoint', p.frame.origin, mm)}${coordinate('XVector', p.frame.x, 1, 9)}${coordinate('YVector', p.frame.y, 1, 9)}</Position>`,
        `${indent}    </Transformation>`,
    ].join('\n'));
    const processings = first.processings.map((p, i) => `${indent}    ${xmlProcessing(p, i + 1)}`);
    return [
        `${indent}<Part${attrs([
            ['SingleMemberNumber', number],
            ['Count', group.length],
            ['Length', f.length * mm],
            ['Height', f.height * mm],
            ['Width', f.width * mm],
            ['Designation', designation(m)],
            ['Annotation', names.length > 6 ? `${names.slice(0, 6).join(', ')} +${names.length - 6}` : names.join(', ')],
            ['Material', m.material?.name],
            ['Comment', `${m.kind} ${m.section}, ${m.recipe === 'live' ? 'cuts confirmed by the recipe' : 'cuts measured from the geometry'}`],
        ])}>`,
        `${indent}  <Transformations>`,
        ...transformations,
        `${indent}  </Transformations>`,
        ...(processings.length ? [`${indent}  <Processings>`, ...processings, `${indent}  </Processings>`] : []),
        `${indent}</Part>`,
    ].join('\n');
}

//// 5. ENTRY ////

export function buildBTLx(modeler: Modeler, shapes: any, options: toBTLxOptions = {}): { text: string, report: BTLxReport, operations: FabOperations } | null
{
    let ops: FabOperations;
    try
    {
        ops = operations(modeler, shapes, { detail: 'none', ...(options.tolerance !== undefined ? { tolerance: options.tolerance } : {}) });
    }
    catch (e)
    {
        throw new Error(`BTLx export: ${(e as Error).message}`);
    }
    const s = ops.settings;
    const mm = s.mm;
    const skipped: string[] = [];
    const members = ops.members();
    const fills = members.filter(m => m.kind === 'fill');
    const machined = members.filter(m => m.kind !== 'fill');
    if (!machined.length) return null;
    const holes = ops.holes();
    const parts = machined.map(m => partOf(m, mm, skipped, options.holes ? holes.filter(h => h.member === m) : [])).map((p, i, all) =>
        ({ ...p, seed: `${p.seed}#${all.slice(0, i).filter(q => q.member.name === p.member.name).length}` }));
    const groups = [...parts.reduce((acc, p) =>
    {
        acc.set(p.key, [...(acc.get(p.key) ?? []), p]);
        return acc;
    }, new Map<string, PartOut[]>()).values()];
    const project = options.name || 'archiyou';
    const date = new Date(options.timestamp ?? Date.now());
    const day = Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
    const fastenings = ops.fastenings().filter(f => f.count > 0);
    const notExported = [
        ...(fills.length ? [`${fills.length} fills (insulation) are not machined`] : []),
        ...(fastenings.length ? [`${fastenings.reduce((n, f) => n + f.count, 0)} fasteners in ${fastenings.length} joints are assembly, not machining`] : []),
        ...(holes.length && !options.holes ? [`${holes.length} fastener holes (toBTLx({ holes: true }) writes them for pre-drilling)`] : []),
        ...skipped,
    ];
    const processings = groups.reduce((n, g) => n + g[0].processings.length, 0);
    const report: BTLxReport = {
        parts: groups.length,
        pieces: parts.length,
        processings,
        notExported,
        summary: () => `${groups.length} parts (${parts.length} pieces) with ${processings} processings; ${notExported.length} things not written`,
        toString: () => [report.summary(), ...notExported.map(n => `  · ${n}`)].join('\n'),
    };
    const text = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        comment(`${FAB_HEADER}: BTLx 2.3 from ${project}${options.version ? ` ${options.version}` : ''}, norm book ${ops.book.version}. ${report.summary()}`),
        ...notExported.map(n => comment(`not written: ${n}`)),
        `<BTLx xmlns="https://www.design2machine.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `
            + `xsi:schemaLocation="https://www.design2machine.com ${BTLX_SCHEMA}" Version="2.3.0" Language="en">`,
        '  <FileHistory>',
        `    <InitialExportProgram${attrs([
            ['CompanyName', 'Archiyou'],
            ['ProgramName', 'Archiyou'],
            ['FileName', `${project}.btlx`],
            ['Date', day],
            ['Comment', 'parts, cuts and drillings read with fab.operations()'],
        ])}/>`,
        '  </FileHistory>',
        `  <Project${attrs([['Name', project], ['GUID', guid(`${project}|project`)], ['Comment', `${options.version ? `version ${options.version}, ` : ''}norm book ${ops.book.version}`]])}>`,
        '    <Parts>',
        ...groups.map((group, i) => xmlPart(group, i + 1, project, mm, '      ')),
        '    </Parts>',
        '  </Project>',
        '</BTLx>',
        '',
    ].join('\n');
    return { text, report, operations: ops };
}
