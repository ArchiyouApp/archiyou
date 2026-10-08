/**
 *  Everything that runs a script on the kernel: `run`, `sweep` and `eval`, and the checks and
 *  pictures around a run: the views sheet, photos with the model drawn over them, the clash
 *  check, the inventory check, and photos with numbered markers (`mark`).
 *
 *  One Runner per process, reused for every run like the editor does.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { type Args, DATA, columns, fail, out, paramValues, quiet, round, userPath } from './common';
import { suggestNames } from './lookup';

//// TYPES ////

type Vec3 = [number, number, number];
interface Box { min: Vec3; max: Vec3 }

interface Part
{
    path: string;   // scene path without 'Scene/', e.g. frame/frontLegL
    name: string;   // last path segment
    type: string;   // Mesh, Curve, ...
    box: Box;
    volume: number;
    shape: any;
}

interface ParamDef { name: string; type: string; value: any; default: any; min?: number; max?: number; options?: Array<any> }
interface Clash { a: string; b: string; volume: number }
interface CheckResult { rules: number; mismatches: Array<string> }
interface OverlayResult { photo: string; modelRatio: number; photoRatio: number }

interface Inventory
{
    count?: Record<string, number>;
    axis?: Record<string, 'x' | 'y' | 'z'>;
    floor?: Array<string>;
    notFloor?: Array<string>;
    relations?: Array<[string, string, string]>;
}

type ViewSpec = { label: string; cam: Vec3; ortho: boolean };
type OverlaySpec = { photo: string; view: ViewSpec; rect: [number, number, number, number] };

interface RunOptions
{
    file: string;
    code: string;
    params: Record<string, any>;
    kernel: 'mesh' | 'brep';
    views: Array<ViewSpec>;
    refs: Array<string>;
    overlays: Array<OverlaySpec>;
    clash: boolean;
    inventory?: Inventory;
    expect?: Vec3;           // the size asked for: a mismatch line when the model is off
    outDir: string | null;   // null: write no files (sweep, eval)
    verbose: boolean;
}

interface RunResult
{
    ok: boolean;
    file: string;
    kernel: string;
    seconds: number;
    units: string;
    error?: { line?: number; message: string; excerpt: Array<string> };
    size?: Vec3;
    min?: Vec3;
    params: Array<ParamDef>;
    parts: Array<Part>;
    unnamed: number;
    messages: Array<string>;
    warnings: Array<string>;
    metrics: Record<string, { value: any; unit?: string }>;
    files: Record<string, string>;
    clashes?: Array<Clash>;
    check?: CheckResult;
    overlays?: Array<OverlayResult>;
    expect?: { size: Vec3; ok: boolean };
}

//// SETTINGS ////

const DEFAULT_VIEWS = 'iso,front,right,top';
/** Named views as camera directions: from the model to the camera, z up. One way to say a view
 *  for the skill, the labels and core */
const NAMED_VIEWS: Record<string, Vec3> = {
    front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1], iso: [-1, -1, 1],
};
/** `--views around`: eight directions at 45° steps from the front, 30° up, to match a photo */
const AROUND: Array<Vec3> = [0, 45, 90, 135, 180, 225, 270, 315].map(deg =>
{
    const a = deg * Math.PI / 180;
    return [Math.round(Math.sin(a) * 100) / 100 || 0, Math.round(-Math.cos(a) * 100) / 100 || 0, 0.58] as Vec3;
});
const TILE = 600;             // px per sheet tile
const LABEL_H = 30;
const SHEET_COLUMNS = 3;
const MAX_PART_ROWS = 40;     // above this the part table groups by layer (--parts lists all)
const CLASH_FRACTION = 1e-3;  // a shared volume above 0.1 % of the smaller part is a clash
const OVERLAY_COLOR = '#e6007e';
const OVERLAY_FILE_PX = 1600;   // the longest side of the full-size overlay files
const EXPECT_TOLERANCE = 0.01;  // --expect: 1 % per axis
const MAX_CORNERS = 128;        // sweep --corners: every min/max combination, up to this many
const MARK_COLOR = '#e6007e';
/** Core warnings about its own setup, not about the script */
const INTERNAL_WARNING = /^Runner::|ShapeCollection::getGroup\(\)/;
/** Shapes with a volume: meshes, and brep solids */
const SOLIDS = new Set(['Mesh', 'Solid']);

//// RUNNER ////

let runner: any = null;

async function loadRunner(verbose: boolean): Promise<any>
{
    if (!runner)
    {
        const core: any = await quiet(verbose, () => import('@archiyou/core'));
        runner = await quiet(verbose, () => new core.Runner().load());
    }
    return runner;
}

/** Run a script once and gather everything the summary, checks and pictures need */
async function runOnce(o: RunOptions): Promise<RunResult>
{
    const r = await loadRunner(o.verbose);
    const name = basename(o.file, extname(o.file));
    const started = performance.now();
    const res: any = await quiet(o.verbose, () => r.execute({
        kernel: o.kernel,
        script: { name, code: o.code },
        params: o.params,
        outputs: o.outDir ? ['default/model/glb', 'default/metrics/*/json'] : ['default/metrics/*/json'],
        messages: ['user', 'warn'],
    }));
    const base = { file: o.file, kernel: o.kernel, seconds: (performance.now() - started) / 1000, params: [], parts: [], unnamed: 0, messages: [], warnings: [], metrics: {}, files: {} };

    if (res.status !== 'success')
    {
        const e = res.errors?.[0] ?? {};
        return { ...base, ok: false, units: 'mm', error: { line: e.lineStart, message: errorMessage(e.message), excerpt: excerpt(o.code, e.lineStart) } };
    }

    const scope = r.getScope('default');
    const modeler = scope.modeler;
    const parts = collectParts(modeler);
    const box = unionBox(parts.map(p => p.box));
    const messages: Array<any> = res.messages ?? [];
    const outputs: Array<any> = res.outputs ?? [];
    const result: RunResult = {
        ...base,
        ok: true,
        units: modeler.units?.() ?? res.meta?.units ?? 'mm',
        size: box ? sub(box.max, box.min) : undefined,
        min: box?.min,
        params: paramDefs(scope),
        parts,
        unnamed: parts.filter(p => /^(Mesh|Curve|Polygon|Vertex|Shape)(\[\d+\]|:\w+)$/.test(p.name)).length,
        messages: messages.filter(m => m.type === 'user').map(m => String(m.message)),
        warnings: [...new Set(messages.filter(m => m.type === 'warn' && !INTERNAL_WARNING.test(String(m.message))).map(m => String(m.message)))],
        metrics: Object.fromEntries(outputs
            .filter(op => /^default\/metrics\/.+\/json$/.test(op.path?.resolvedPath ?? ''))
            .flatMap(op => Object.values(op.output ?? {}) as Array<any>)
            .map(m => [m.label ?? m.name, { value: m.data, unit: m.options?.unit }])),
    };

    if (o.outDir)
    {
        mkdirSync(o.outDir, { recursive: true });
        const glb = outputs.find(op => op.path?.resolvedPath === 'default/model/glb')?.output;
        if (glb)
        {
            result.files.model = join(o.outDir, 'model.glb');
            writeFileSync(result.files.model, glb);
        }
        if (o.views.length > 0 || o.refs.length > 0 || o.overlays.length > 0)
        {
            const sheet = await quiet(o.verbose, () => viewsSheet(modeler, o));
            result.files.views = join(o.outDir, 'views.png');
            writeFileSync(result.files.views, sheet.png);
            result.overlays = sheet.overlays.map(ov => ov.measure);
            // the sheet's tiles are small: each overlay also full size, to read the lines
            sheet.overlays.forEach((ov, i) =>
            {
                const file = join(o.outDir as string, `overlay-${i + 1}-${basename(ov.measure.photo, extname(ov.measure.photo))}.png`);
                writeFileSync(file, ov.full);
                result.files[`overlay${i + 1}`] = file;
            });
        }
    }
    if (o.clash) { result.clashes = await quiet(o.verbose, () => findClashes(parts, box)); }
    if (o.inventory) { result.check = checkInventory(parts, o.inventory, box); }
    if (o.expect && result.size)
    {
        const size = result.size;
        result.expect = { size: o.expect, ok: o.expect.every((v, i) => Math.abs(size[i] - v) <= Math.max(EXPECT_TOLERANCE * Math.abs(v), 0.5)) };
    }
    return result;
}

/** Core formats an error as a block with the message, line and context; keep the message */
function errorMessage(raw: string | undefined): string
{
    const text = String(raw ?? 'unknown error');
    return text.match(/- error: '([\s\S]*?)'\s*\n/)?.[1] ?? text.trim().split('\n').find(l => l.trim()) ?? text;
}

function excerpt(code: string, line: number | undefined): Array<string>
{
    if (!line) { return []; }
    const lines = code.split('\n');
    return lines
        .map((text, i) => ({ text, n: i + 1 }))
        .filter(l => Math.abs(l.n - line) <= 2)
        .map(l => `${l.n === line ? '>' : ' '} ${String(l.n).padStart(4)} | ${l.text}`);
}

function collectParts(modeler: any): Array<Part>
{
    return modeler.scene().descendants()
        .filter((n: any) => !n.isLayer())
        .flatMap((n: any) =>
        {
            const shapes = n.shapes().toArray().filter((s: any) => s.style?.visible !== false);
            const path = decodeURIComponent(n.path()).replace(/^Scene\//, '');
            const name = path.split('/').pop() as string;
            return shapes
                .map((s: any, i: number) => ({ s, i, box: shapeBox(s) }))
                .filter(x => x.box)
                .map(x => ({
                    path: shapes.length > 1 ? `${path}[${x.i}]` : path,
                    name,
                    type: String(x.s.type ?? x.s.constructor?.name ?? 'Shape').replace(/^_/, ''),
                    box: x.box as Box,
                    volume: SOLIDS.has(x.s.type) ? Math.abs(x.s.volume() ?? 0) : 0,
                    shape: x.s,
                }));
        });
}

function shapeBox(s: any): Box | null
{
    const b = s.bbox?.();
    if (!b) { return null; }
    const min = b.min(), max = b.max();
    return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
}

function unionBox(boxes: Array<Box>): Box | null
{
    if (boxes.length === 0) { return null; }
    return boxes.reduce((u, b) => ({
        min: u.min.map((v, i) => Math.min(v, b.min[i])) as Vec3,
        max: u.max.map((v, i) => Math.max(v, b.max[i])) as Vec3,
    }));
}

function sub(a: Vec3, b: Vec3): Vec3
{
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function paramDefs(scope: any): Array<ParamDef>
{
    return (scope._paramManager?.getParams?.() ?? []).map((p: any) => ({
        name: p.name,
        type: p.type,
        value: p._value ?? p.default,
        default: p.default,
        min: p.schema?.minimum,
        max: p.schema?.maximum,
        options: p.schema?.enum,
    }));
}

//// CLASHES ////

/** Pairs of solids that share volume. Bboxes first, then the boolean intersection; parts that
 *  only touch measure about zero, so laths against each other are fine */
function findClashes(parts: Array<Part>, model: Box | null): Array<Clash>
{
    const eps = model ? Math.max(...sub(model.max, model.min)) * 1e-6 : 1e-6;
    const meshes = parts.filter(p => SOLIDS.has(p.type));
    return meshes.flatMap((p, i) => meshes.slice(i + 1)
        .filter(q => [0, 1, 2].every(k => p.box.min[k] < q.box.max[k] - eps && q.box.min[k] < p.box.max[k] - eps))
        .map(q => ({ a: p.path, b: q.path, volume: sharedVolume(p.shape, q.shape), limit: CLASH_FRACTION * Math.min(p.volume, q.volume) }))
        .filter(c => c.volume < 0 || c.volume > c.limit)
        .map(c => ({ a: c.a, b: c.b, volume: c.volume })));
}

/** -1 when the boolean fails */
function sharedVolume(a: any, b: any): number
{
    try
    {
        // intersection() adds its result to the scene. A mesh result is detached with tmp(); brep's
        // _intersection() is a variant that never adds it. Not for meshes: Mesh._intersection()
        // REPLACES the mesh by the shared volume, and every later check would see that instead
        const shared = a.type === 'Mesh' ? a.intersection(b) : a._intersection(b);
        const volume = Math.abs(shared?.volume?.() ?? 0);
        if (a.type === 'Mesh') { shared?.tmp?.(); }
        return volume;
    }
    catch
    {
        return -1;
    }
}

//// INVENTORY CHECK ////

const RELATIONS: Record<string, (a: Box, b: Box, tol: number) => boolean> = {
    behind: (a, b, t) => a.min[1] >= b.max[1] - t,     // y grows to the back
    inFront: (a, b, t) => a.max[1] <= b.min[1] + t,
    above: (a, b, t) => a.min[2] >= b.max[2] - t,
    below: (a, b, t) => a.max[2] <= b.min[2] + t,
    leftOf: (a, b, t) => a.max[0] <= b.min[0] + t,
    rightOf: (a, b, t) => a.min[0] >= b.max[0] - t,
    touches: (a, b, t) => [0, 1, 2].every(k => a.min[k] <= b.max[k] + t && b.min[k] <= a.max[k] + t),
};

/** Bounding boxes first; for two solids then their real distance, so a tilted board that only
 *  shares a bbox with a lath does not count. Falls back to the boxes when a kernel cannot measure */
function touching(a: Part, b: Part, tol: number): boolean
{
    if (!RELATIONS.touches(a.box, b.box, tol)) { return false; }
    if (!SOLIDS.has(a.type) || !SOLIDS.has(b.type)) { return true; }
    try
    {
        if (a.shape.hits?.(b.shape)) { return true; }
        const d = a.shape.distance?.(b.shape);
        return typeof d === 'number' ? d <= tol : true;
    }
    catch
    {
        return true;
    }
}

/** * and ? wildcards, | between alternatives: "frontLeg*|rearPost*" */
function globRe(glob: string): RegExp
{
    const escape = (s: string) => s.replace(/[.+^${}()[\]\\]/g, '\\$&');
    const one = (g: string) => g.split('*').map(s => s.split('?').map(escape).join('.')).join('.*');
    return new RegExp('^(' + glob.split('|').map(one).join('|') + ')$', 'i');
}

/** The model against the parts read from the photos: counts, long axes, floor contact and
 *  relations, all from bounding boxes. Axis convention: x width, y depth (front at y = 0),
 *  z up, floor at z = 0 */
function checkInventory(parts: Array<Part>, inv: Inventory, model: Box | null): CheckResult
{
    const tol = model ? Math.max(...sub(model.max, model.min)) * 1e-3 : 0.5;
    const matching = (glob: string) => parts.filter(p => globRe(glob).test(p.name) || globRe(glob).test(p.path));
    const longAxis = (b: Box) => { const d = sub(b.max, b.min); return 'xyz'[d.indexOf(Math.max(...d))]; };
    const onFloor = (p: Part) => Math.abs(p.box.min[2]) <= tol;
    const none = (glob: string) => [`no part matches "${glob}"`];

    const rules: Array<() => Array<string>> = [
        ...Object.entries(inv.count ?? {}).map(([glob, n]) => () =>
        {
            const found = matching(glob).length;
            return found === n ? [] : [`${glob}: ${found}, expected ${n}`];
        }),
        ...Object.entries(inv.axis ?? {}).map(([glob, axis]) => () =>
        {
            const ps = matching(glob);
            return ps.length === 0 ? none(glob) : ps.filter(p => longAxis(p.box) !== axis).map(p => `${p.path} runs along ${longAxis(p.box)}, expected ${axis}`);
        }),
        ...(inv.floor ?? []).map(glob => () =>
        {
            const ps = matching(glob);
            return ps.length === 0 ? none(glob) : ps.filter(p => !onFloor(p)).map(p => `${p.path} does not reach the floor (lowest point z ${round(p.box.min[2], 1)})`);
        }),
        ...(inv.notFloor ?? []).map(glob => () =>
        {
            const ps = matching(glob);
            return ps.length === 0 ? none(glob) : ps.filter(onFloor).map(p => `${p.path} touches the floor`);
        }),
        ...(inv.relations ?? []).map(([ga, rel, gb]) => () =>
        {
            const test = RELATIONS[rel];
            if (!test) { return [`unknown relation "${rel}" (use ${Object.keys(RELATIONS).join(', ')})`]; }
            const as = matching(ga), bs = matching(gb);
            if (as.length === 0) { return none(ga); }
            if (bs.length === 0) { return none(gb); }
            const holds = (pa: Part, pb: Part) => rel === 'touches' ? touching(pa, pb, tol) : test(pa.box, pb.box, tol);
            const fails = rel === 'touches' ? 'does not touch' : `is not ${rel}`;
            return as.flatMap(a => bs.filter(b => b !== a && !holds(a, b)).map(b => `${a.path} ${fails} ${b.path}`));
        }),
    ];
    return { rules: rules.length, mismatches: rules.flatMap(rule => rule()) };
}

//// PICTURES ////

function esc(s: string): string
{
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPng(svg: string, fit: { mode: 'width' | 'height' | 'zoom'; value: number }): Buffer
{
    return new Resvg(svg, {
        fitTo: fit,
        background: '#ffffff',
        font: { fontFiles: [DATA.font], loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
    }).render().asPng();
}

/** Pixel size and data URI of a photo; resvg decodes PNG, JPEG and GIF */
function readPhoto(path: string): { width: number; height: number; href: string }
{
    const buf = readFileSync(path);
    const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isGif = buf.subarray(0, 3).toString() === 'GIF';
    if (!isPng && !isJpeg && !isGif)
    {
        const kind = buf.subarray(8, 12).toString() === 'WEBP' ? 'WebP' : 'this format';
        throw new Error(`${basename(path)}: ${kind} is not supported, convert it to PNG or JPEG`);
    }
    const size = isPng ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
        : isGif ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
        : jpegSize(buf, 2);
    const mime = isPng ? 'image/png' : isGif ? 'image/gif' : 'image/jpeg';
    return { ...size, href: `data:${mime};base64,${buf.toString('base64')}` };
}

/** Walk the JPEG segments to the frame header (SOF0-15, not DHT/JPG/DAC) */
function jpegSize(buf: Buffer, at: number): { width: number; height: number }
{
    if (at + 9 > buf.length || buf[at] !== 0xff) { throw new Error('could not read the JPEG size'); }
    const marker = buf[at + 1];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    return isFrame
        ? { width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5) }
        : jpegSize(buf, at + 2 + buf.readUInt16BE(at + 2));
}

/** A rectangle or point given as fractions of the photo (all values <= 1) or in pixels */
function toPixels(values: Array<number>, width: number, height: number): Array<number>
{
    const fractions = values.every(v => v >= 0 && v <= 1);
    return fractions ? values.map((v, i) => v * (i % 2 === 0 ? width : height)) : values;
}

/** `iso,front,cam:-1,-0.3,0.25` → view specs; the commas inside cam: are its coordinates.
 *  `around` is the eight AROUND directions */
function parseViews(spec: string): Array<ViewSpec>
{
    if (spec === 'none') { return []; }
    const tokens = spec.split(',').map(t => t.trim()).filter(Boolean)
        .flatMap(t => t === 'around' ? AROUND.map(c => `cam:${c[0]},${c[1]},${c[2]}`).join(',').split(',') : [t]);
    return tokens.reduce((acc, t, i) =>
    {
        if (acc.skip > 0) { return { ...acc, skip: acc.skip - 1 }; }
        if (t.startsWith('cam:'))
        {
            const cam = [t.slice(4), tokens[i + 1], tokens[i + 2]].map(Number) as Vec3;
            if (cam.some(v => !Number.isFinite(v))) { throw new Error(`cam: takes three numbers, as in cam:-1,-0.3,0.25`); }
            return { views: [...acc.views, { label: `cam ${cam.join(',')}`, cam, ortho: false }], skip: 2 };
        }
        if (!NAMED_VIEWS[t]) { throw new Error(`unknown view "${t}" (use ${Object.keys(NAMED_VIEWS).join(', ')}, around or cam:x,y,z)`); }
        return { views: [...acc.views, { label: t, cam: NAMED_VIEWS[t], ortho: t !== 'iso' }], skip: 0 };
    }, { views: [] as Array<ViewSpec>, skip: 0 }).views;
}

/** photo.jpg@cam:-1,0,0@x0,y0,x1,y1 (or a named view in the middle) */
function parseOverlay(spec: string): OverlaySpec
{
    const [photo, view, rect] = spec.split('@');
    const nums = (rect ?? '').split(',').map(Number);
    if (!photo || !view || nums.length !== 4 || nums.some(v => !Number.isFinite(v)))
    {
        throw new Error(`--overlay takes photo@view@x0,y0,x1,y1 (the object's rectangle in the photo, as fractions or pixels), got "${spec}"`);
    }
    return { photo: userPath(photo), view: parseViews(view)[0], rect: nums as [number, number, number, number] };
}

function projection(modeler: any, v: ViewSpec): { svg: string; extents: [number, number, number, number] } | null
{
    const svg: string | null = modeler.toProjectionSVG({ cam: v.cam });
    if (!svg) { return null; }
    const extents = (svg.match(/data-extents="([^"]+)"/)?.[1] ?? svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 1 1').split(/\s+/).map(Number);
    return { svg, extents: extents as [number, number, number, number] };
}

/** Core's projection styles its lines for a browser (non-scaling stroke); resvg ignores that,
 *  so stroke width and dashes are set in model units for the size they are drawn at */
function restyle(svg: string, unit: number, color: string, hidden: boolean): string
{
    const styled = svg
        .replace(/vector-effect:\s*non-scaling-stroke;?/g, '')
        .replace(/stroke-width:\s*[\d.]+/g, `stroke-width:${1.4 * unit}`)
        .replace(/stroke-dasharray:\s*[\d.]+[ ,]+[\d.]+/g, `stroke-dasharray:${5 * unit} ${3.5 * unit}`)
        .replace(/svg\{color:#[0-9a-fA-F]+\}/, `svg{color:${color}}`)
        .replace(/@media \(prefers-color-scheme:dark\)\{[^}]*\}\}/, '');
    return hidden ? styled : styled.replace(/<path[^>]*class="line hidden"[^>]*\/>/g, '');
}

type Tile = { label: string; href: string; w?: number; h?: number };

function viewBox(svg: string): Array<number>
{
    return (svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 1 1').split(/\s+/).map(Number);
}

/** A view filling its tile, or at `zoom` px per model unit (the shared scale of the
 *  orthographic views, so their sizes compare) */
function viewTile(v: ViewSpec, p: ReturnType<typeof projection>, zoom?: number): Tile
{
    if (!p) { return { label: `${v.label}: no 3D geometry`, href: '' }; }
    const vb = viewBox(p.svg);
    const size = TILE - 8;
    const pxPerUnit = zoom ?? size / Math.max(vb[2], vb[3]);
    const svg = restyle(p.svg, 1 / pxPerUnit, '#1a1a1a', true);
    const png = renderPng(svg, { mode: 'zoom', value: pxPerUnit } as any);
    // the size only means something in an orthographic view
    const label = v.ortho ? `${v.label}   ${round(p.extents[2])} x ${round(p.extents[3])}${zoom ? '   same scale' : ''}`
        : v.label === 'iso' ? `iso (cam ${v.cam.join(',')})` : v.label;
    return { label, href: `data:image/png;base64,${png.toString('base64')}`, w: vb[2] * pxPerUnit, h: vb[3] * pxPerUnit };
}

/** iso and camera views fill their tiles; the orthographic ones share the largest scale that
 *  fits them all */
function viewTiles(modeler: any, views: Array<ViewSpec>): Array<Tile>
{
    const projections = views.map(v => projection(modeler, v));
    const ortho = (v: ViewSpec) => v.ortho;
    const zoom = Math.min(...projections
        .filter((p, i) => p && ortho(views[i]))
        .map(p => { const vb = viewBox(p!.svg); return (TILE - 8) / Math.max(vb[2], vb[3]); }));
    return views.map((v, i) => viewTile(v, projections[i], ortho(v) && Number.isFinite(zoom) ? zoom : undefined));
}

/** The photo with the model's visible lines over it, fitted into the object's rectangle in the
 *  photo on its height: a difference in width means the proportions differ */
function overlayTile(modeler: any, o: OverlaySpec): { tile: Tile; full: Buffer; measure: OverlayResult }
{
    const photo = readPhoto(o.photo);
    const p = projection(modeler, o.view);
    if (!p) { throw new Error('no 3D geometry to draw over the photo'); }
    const [x0, y0, x1, y1] = toPixels(o.rect, photo.width, photo.height);
    const [ex, ey, ew, eh] = p.extents;
    const scale = (y1 - y0) / eh;
    const drawW = ew * scale, drawH = eh * scale;
    const x = (x0 + x1) / 2 - drawW / 2, y = y1 - drawH;

    /** The photo with the lines over it; `px` is one output pixel in photo pixels */
    const compose = (px: number) =>
    {
        const lines = restyle(p.svg, 1.4 * px / scale, OVERLAY_COLOR, false)
            .replace(/^<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${drawW}" height="${drawH}" viewBox="${ex} ${ey} ${ew} ${eh}" overflow="visible" preserveAspectRatio="none">`);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${photo.width}" height="${photo.height}" viewBox="0 0 ${photo.width} ${photo.height}">`
            + `<image width="${photo.width}" height="${photo.height}" href="${photo.href}"/>`
            + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#00a0e0" stroke-width="${px}" stroke-dasharray="${4 * px} ${3 * px}"/>`
            + lines + '</svg>';
    };
    const longest = Math.max(photo.width, photo.height);
    const fit = (size: number) => (photo.width >= photo.height ? { mode: 'width' as const, value: size } : { mode: 'height' as const, value: size });
    const fileSize = Math.min(OVERLAY_FILE_PX, longest);
    const png = renderPng(compose(longest / (TILE - 8)), fit(TILE - 8));
    const full = renderPng(compose(longest / fileSize), fit(fileSize));
    const measure = { photo: basename(o.photo), modelRatio: ew / eh, photoRatio: (x1 - x0) / (y1 - y0) };
    return { tile: { label: `overlay ${basename(o.photo)} ${o.view.label}`, href: `data:image/png;base64,${png.toString('base64')}` }, full, measure };
}

function sheet(tiles: Array<Tile>): Buffer
{
    const cols = Math.min(SHEET_COLUMNS, tiles.length);
    const rows = Math.ceil(tiles.length / cols);
    const W = cols * TILE, H = rows * (TILE + LABEL_H);
    const cells = tiles.map((t, i) =>
    {
        const x = (i % cols) * TILE, y = Math.floor(i / cols) * (TILE + LABEL_H);
        const size = TILE - 8;
        const [w, h] = (t.w && t.h) ? [t.w, t.h] : [size, size];   // own size (shared scale), else fit
        const image = t.href ? `<image x="${4 + (size - w) / 2}" y="${LABEL_H + (size - h) / 2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="${t.href}"/>` : '';
        return `<g transform="translate(${x},${y})"><rect x="1" y="1" width="${TILE - 2}" height="${TILE + LABEL_H - 2}" fill="none" stroke="#d0d0d0"/>`
            + `<text x="10" y="21" font-family="Plus Jakarta Sans" font-size="15" fill="#222222">${esc(t.label)}</text>${image}</g>`;
    });
    return renderPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${cells.join('')}</svg>`, { mode: 'width', value: W });
}

/** One labelled sheet: the reference photos, the overlays, then the views */
function viewsSheet(modeler: any, o: RunOptions): { png: Buffer; overlays: Array<{ full: Buffer; measure: OverlayResult }> }
{
    const refs = o.refs.map(path => ({ label: `photo ${basename(path)}`, href: readPhoto(path).href }));
    const overlays = o.overlays.map(spec => overlayTile(modeler, spec));
    const views = viewTiles(modeler, o.views);
    return { png: sheet([...refs, ...overlays.map(ov => ov.tile), ...views]), overlays };
}

//// TEXT OUTPUT ////

function fmt(n: number): string
{
    const a = Math.abs(n);
    return round(n, a < 10 ? 2 : a < 100 ? 1 : 0);
}

function fmtSize(v: Vec3 | undefined): string
{
    return v ? v.map(fmt).join(' x ') : '-';
}

function fmtValue(v: any): string
{
    return typeof v === 'string' ? v : JSON.stringify(v);
}

function printRun(r: RunResult, allParts: boolean): void
{
    if (!r.ok)
    {
        out(`ERROR  ${basename(r.file)}  ${r.error?.line ? `line ${r.error.line}: ` : ''}${r.error?.message}`);
        r.error?.excerpt.forEach(l => out(l));
        const missing = r.error?.message.match(/(\w+) is not a function/)?.[1];
        const suggestions = missing ? suggestNames(missing) : [];
        if (suggestions.length > 0) { out(`did you mean ${suggestions.join(', ')}? (archiyou api ${suggestions[0]})`); }
        return;
    }
    out(`OK  ${basename(r.file)}  ${r.kernel}  ${round(r.seconds, 2)}s  units ${r.units}`);
    out(`size ${fmtSize(r.size)}   min ${r.min ? r.min.map(fmt).join(', ') : '-'}   parts ${r.parts.length}`);
    if (r.params.length > 0) { out(`params ${r.params.map(p => `${p.name}=${fmtValue(p.value)}`).join(' ')}`); }

    const grouped = !allParts && r.parts.length > MAX_PART_ROWS;
    const rows = grouped
        ? Object.entries(r.parts.reduce((g, p) =>
        {
            const key = p.path.includes('/') ? p.path.split('/')[0] + '/' : p.path;
            (g[key] ??= []).push(p);
            return g;
        }, {} as Record<string, Array<Part>>)).map(([key, ps]) =>
        {
            const box = unionBox(ps.map(p => p.box)) as Box;
            return [key, ps.length > 1 ? `${ps.length} parts` : ps[0].type, fmtSize(sub(box.max, box.min)), fmt(ps.reduce((v, p) => v + p.volume, 0))];
        })
        : r.parts.map(p => [p.path, p.type, fmtSize(sub(p.box.max, p.box.min)), p.volume ? fmt(p.volume) : '-']);
    columns([['part', 'type', 'size', 'volume'], ...rows]).forEach(l => out(l));
    if (grouped) { out(`(${r.parts.length} parts grouped by layer; --parts lists each)`); }
    if (r.unnamed > 0) { out(`${r.unnamed} unnamed parts: name them with .name() so reports and checks can refer to them`); }

    r.messages.forEach(m => out(`print: ${m}`));
    r.warnings.slice(0, 5).forEach(w => out(`warn: ${w.split('\n')[0].trim()}`));
    if (r.warnings.length > 5) { out(`warn: ... ${r.warnings.length - 5} more (--json for all)`); }
    Object.entries(r.metrics).forEach(([name, m]) => out(`metric ${name}: ${fmtValue(m.value)}${m.unit ? ' ' + m.unit : ''}`));
    printChecks(r);
    if (Object.keys(r.files).length > 0) { out(`files ${Object.values(r.files).join('  ')}`); }
}

function printChecks(r: RunResult): void
{
    if (r.expect)
    {
        const diff = r.expect.size.map((v, i) => `${'xyz'[i]} ${r.size![i] - v >= 0 ? '+' : ''}${fmt(r.size![i] - v)}`).join(', ');
        out(r.expect.ok ? `expect ok (${fmtSize(r.expect.size)})` : `expect: size ${fmtSize(r.size)}, expected ${fmtSize(r.expect.size)} (${diff})`);
    }
    if (r.clashes)
    {
        out(`clashes ${r.clashes.length}`);
        r.clashes.forEach(c => out(`  ${c.a} x ${c.b}  ${c.volume < 0 ? 'boolean failed' : fmt(c.volume) + ' ' + r.units + '3'}`));
    }
    if (r.check)
    {
        out(r.check.mismatches.length === 0 ? `check ok (${r.check.rules} rules)` : `check ${r.check.mismatches.length} mismatches (${r.check.rules} rules)`);
        r.check.mismatches.forEach(m => out(`  ${m}`));
    }
    (r.overlays ?? []).forEach(ov =>
    {
        const diff = (ov.modelRatio / ov.photoRatio - 1) * 100;
        out(`overlay ${ov.photo}: width/height model ${round(ov.modelRatio, 2)}, photo ${round(ov.photoRatio, 2)} (${diff >= 0 ? '+' : ''}${round(diff)} %)`);
    });
}

/** The result without the live shapes, for --json */
function plain(r: RunResult): any
{
    return { ...r, parts: r.parts.map(({ shape, ...p }) => p) };
}

//// COMMANDS ////

function readInventory(path: string | undefined): Inventory | undefined
{
    return path ? JSON.parse(readFileSync(userPath(path), 'utf8')) : undefined;
}

/** `200x120x20` → [200, 120, 20] */
function parseSize(spec: string | undefined): Vec3 | undefined
{
    if (!spec) { return undefined; }
    const v = spec.split(/[x,]/).map(Number);
    if (v.length !== 3 || v.some(n => !Number.isFinite(n))) { throw new Error(`--expect takes WxDxH, as in 200x120x20, got "${spec}"`); }
    return v as Vec3;
}

function optionsFrom(args: Args, file: string, outDir: string | null): RunOptions
{
    const kernel = (args.values.kernel?.[0] ?? 'mesh') as 'mesh' | 'brep';
    if (kernel !== 'mesh' && kernel !== 'brep') { throw new Error(`--kernel is mesh or brep, got "${kernel}"`); }
    return {
        file,
        code: readFileSync(file, 'utf8'),
        params: paramValues(args.values.param),
        kernel,
        views: parseViews(args.values.views?.[0] ?? DEFAULT_VIEWS),
        refs: (args.values.ref ?? []).map(userPath),
        overlays: (args.values.overlay ?? []).map(parseOverlay),
        clash: args.bools.has('clash'),
        inventory: readInventory(args.values.check?.[0]),
        expect: parseSize(args.values.expect?.[0]),
        outDir,
        verbose: args.bools.has('verbose'),
    };
}

function scriptFile(args: Args, usage: string): string | null
{
    const file = args.positional[0];
    if (!file) { fail(`usage: ${usage}`); return null; }
    const path = userPath(file);
    if (!existsSync(path)) { fail(`no such file: ${path}`); return null; }
    return path;
}

/** `run <file.js>`: exit 1 when the script fails */
export async function run(args: Args): Promise<number>
{
    const file = scriptFile(args, 'archiyou run <file.js> [-p NAME=value]... [--views iso,front,cam:x,y,z] [--ref photo]... [--overlay photo@view@x0,y0,x1,y1]... [--clash] [--check inventory.json]');
    if (!file) { return 1; }
    const outDir = userPath(args.values.out?.[0] ?? join(tmpdir(), 'archiyou', basename(file, extname(file))));
    const result = await runOnce(optionsFrom(args, file, outDir));
    if (args.bools.has('json')) { out(JSON.stringify(plain(result), null, 2)); }
    else { printRun(result, args.bools.has('parts')); }
    return result.ok ? 0 : 1;
}

interface SweepRow { param: string; value: any; result: RunResult }

/** The defaults, then each parameter at its extremes: numbers at minimum and maximum,
 *  booleans flipped, options each. `corners`: every combination of the numbers' extremes and
 *  both booleans instead, where parameters that are fine one at a time break together */
async function sweepRuns(base: RunOptions, corners: boolean = false): Promise<Array<SweepRow>>
{
    const defaults = await runOnce(base);
    const extremes = (p: ParamDef): Array<any> => p.type === 'boolean' ? (corners ? [false, true] : [!p.value])
        : Array.isArray(p.options) ? (corners ? [] : p.options.filter(v => v !== p.value).slice(0, 6))
        : (Number.isFinite(p.min) && Number.isFinite(p.max)) ? [p.min, p.max]
        : [];
    const axes = defaults.params.map(p => ({ name: p.name, values: extremes(p) })).filter(a => a.values.length > 0);
    const variants: Array<{ param: string; value: any; params: Record<string, any> }> = corners
        ? axes.reduce((combos, axis) => combos.flatMap(c => axis.values.map(v => ({ ...c, [axis.name]: v }))), [{}] as Array<Record<string, any>>)
            .map(combo => ({ param: 'corner', value: Object.entries(combo).map(([k, v]) => `${k}=${fmtValue(v)}`).join(' '), params: combo }))
        : axes.flatMap(a => a.values.map(value => ({ param: a.name, value, params: { [a.name]: value } })));
    if (variants.length > MAX_CORNERS)
    {
        throw new Error(`--corners would make ${variants.length} runs (more than ${MAX_CORNERS}); fix some parameters with -p, or sweep without --corners`);
    }
    const rows = await variants.reduce(async (acc, v) =>
    {
        const done = await acc;
        const result = await runOnce({ ...base, params: { ...base.params, ...v.params } });
        return [...done, { param: v.param, value: v.value, result }];
    }, Promise.resolve([] as Array<SweepRow>));
    return [{ param: '(defaults)', value: '', result: defaults }, ...rows];
}

function sweepClean(rows: Array<SweepRow>): boolean
{
    return rows.every(r => r.result.ok && (r.result.clashes ?? []).length === 0 && (r.result.check?.mismatches ?? []).length === 0);
}

/** `sweep <file.js>`: exit 1 unless every run builds without clashes or check mismatches */
export async function sweep(args: Args): Promise<number>
{
    const file = scriptFile(args, 'archiyou sweep <file.js> [--corners] [--clash] [--check inventory.json] [-p NAME=value]...');
    if (!file) { return 1; }
    const started = performance.now();
    const rows = await sweepRuns({ ...optionsFrom(args, file, null), views: [], refs: [], overlays: [] }, args.bools.has('corners'));
    const clean = sweepClean(rows);
    if (args.bools.has('json'))
    {
        out(JSON.stringify(rows.map(r => ({ param: r.param, value: r.value, result: plain(r.result) })), null, 2));
        return clean ? 0 : 1;
    }
    out(`sweep ${basename(file)}  ${rows.length} runs  ${round((performance.now() - started) / 1000, 1)}s`);
    const table = rows.map(r => [
        r.param,
        fmtValue(r.value),
        r.result.ok ? 'OK' : `ERROR${r.result.error?.line ? ' line ' + r.result.error.line : ''}`,
        r.result.ok ? fmtSize(r.result.size) : (r.result.error?.message ?? '').slice(0, 60),
        r.result.clashes ? String(r.result.clashes.length) : '-',
        r.result.check ? String(r.result.check.mismatches.length) : '-',
        r.result.messages.join('; '),
    ]);
    columns([['param', 'value', 'result', 'size', 'clashes', 'check', 'print'], ...table]).forEach(l => out(l));
    // The defaults' problems once; for a variant only what is new there
    const issues = (r: RunResult) => [...(r.clashes ?? []).map(c => `clash ${c.a} x ${c.b}`), ...(r.check?.mismatches ?? []).map(m => `check ${m}`)];
    const atDefaults = new Set(issues(rows[0].result));
    rows.forEach((r, i) =>
    {
        const list = i === 0 ? issues(r.result) : issues(r.result).filter(x => !atDefaults.has(x));
        if (list.length === 0) { return; }
        out(i === 0 ? 'defaults:' : `${r.param}=${fmtValue(r.value)} (besides the defaults'):`);
        list.forEach(x => out(`  ${x}`));
    });
    out(clean ? 'sweep clean' : 'sweep NOT clean');
    return clean ? 0 : 1;
}

interface EvalItem
{
    id: string;
    prompt: string;
    size: Vec3;
    tolerance?: number;
    volume?: number;
    volumeTolerance?: number;   // a hole is a small share of the volume: often tighter than the size
    minParams?: number;
    images?: Array<string>;
    sweepClean?: boolean;
    inventory?: string;
}

/** `eval <dir>`: score an agent's solutions (<dir>/<id>.js) against the eval set */
export async function evaluate(args: Args): Promise<number>
{
    const dir = args.positional[0];
    const evalsFile = args.values.evals?.[0] ? userPath(args.values.evals[0]) : DATA.evals;
    if (!dir || !evalsFile || !existsSync(evalsFile))
    {
        fail('usage: archiyou eval <dir> [--evals evals.json]   (the solutions are <dir>/<id>.js)');
        return 1;
    }
    const items: Array<EvalItem> = JSON.parse(readFileSync(evalsFile, 'utf8')).items;
    const verbose = args.bools.has('verbose');
    const within = (actual: number, expected: number, tol: number) => Math.abs(actual - expected) <= tol * Math.abs(expected);
    const mark = (ok: boolean | undefined) => ok === undefined ? '-' : ok ? 'yes' : 'NO';

    const scored = await items.reduce(async (acc, item) =>
    {
        const done = await acc;
        const file = join(userPath(dir), `${item.id}.js`);
        if (!existsSync(file)) { return [...done, { id: item.id, missing: true } as any]; }
        const base: RunOptions = {
            file, code: readFileSync(file, 'utf8'), params: {}, kernel: 'mesh', views: [], refs: [], overlays: [],
            clash: Boolean(item.sweepClean),
            inventory: item.inventory ? JSON.parse(readFileSync(resolve(dirname(evalsFile), item.inventory), 'utf8')) : undefined,
            outDir: null, verbose,
        };
        const rows = item.sweepClean ? await sweepRuns(base) : [{ param: '(defaults)', value: '', result: await runOnce(base) }];
        const r = rows[0].result;
        const tol = item.tolerance ?? 0.05;
        return [...done, {
            id: item.id,
            builds: r.ok,
            size: r.ok ? r.size!.every((v, i) => within(v, item.size[i], tol)) : false,
            actual: r.ok ? fmtSize(r.size) : (r.error?.message ?? '').slice(0, 40),
            volume: item.volume === undefined ? undefined : r.ok && within(r.parts.reduce((v, p) => v + p.volume, 0), item.volume, item.volumeTolerance ?? tol),
            params: item.minParams === undefined ? undefined : r.params.length >= item.minParams,
            sweep: item.sweepClean ? sweepClean(rows) : undefined,
            check: base.inventory ? (r.check?.mismatches.length === 0) : undefined,
        }];
    }, Promise.resolve([] as Array<any>));

    const table = scored.map(s => s.missing
        ? [s.id, 'missing', '', '', '', '', '', '']
        : [s.id, mark(s.builds), mark(s.size), s.actual, mark(s.volume), mark(s.params), mark(s.sweep), mark(s.check)]);
    columns([['id', 'builds', 'size', 'actual', 'volume', 'params', 'sweep', 'check'], ...table]).forEach(l => out(l));
    const total = (key: string) =>
    {
        const scoredFor = scored.filter(s => !s.missing && s[key] !== undefined);
        return `${key} ${scoredFor.filter(s => s[key]).length}/${scoredFor.length}`;
    };
    out(`total ${items.length}: ${['builds', 'size', 'volume', 'params', 'sweep', 'check'].map(total).join('  ')}  missing ${scored.filter(s => s.missing).length}`);
    return 0;
}

interface Mark { n?: number; at: [number, number]; label: string }

/** `mark <photo> <marks.json>`: the photo with numbered markers and a legend, for the user to
 *  check what the agent counted */
export async function markPhoto(args: Args): Promise<number>
{
    const [photoArg, marksArg] = args.positional;
    if (!photoArg || !marksArg)
    {
        fail('usage: archiyou mark <photo> <marks.json> [--out dir]   marks: [{ "at": [x, y], "label": "..." }], x/y as fractions or pixels');
        return 1;
    }
    const photo = readPhoto(userPath(photoArg));
    const json = JSON.parse(readFileSync(userPath(marksArg), 'utf8'));
    const marks: Array<Mark> = Array.isArray(json) ? json : json.marks;
    const r = Math.max(photo.width, photo.height) * 0.018;
    const legendW = Math.round(Math.max(photo.width, photo.height) * 0.42);
    const lineH = r * 2.4;
    const H = Math.max(photo.height, Math.round((marks.length + 2) * lineH));
    const W = photo.width + legendW;
    const numbered = marks.map((m, i) => ({ ...m, n: m.n ?? i + 1, px: toPixels(m.at, photo.width, photo.height) }));
    const markers = numbered.map(m =>
        `<circle cx="${m.px[0]}" cy="${m.px[1]}" r="${r}" fill="${MARK_COLOR}" fill-opacity="0.85" stroke="#ffffff" stroke-width="${r * 0.15}"/>`
        + `<text x="${m.px[0]}" y="${m.px[1] + r * 0.38}" font-size="${r * 1.1}" text-anchor="middle" font-family="Plus Jakarta Sans" fill="#ffffff">${m.n}</text>`).join('');
    const legend = numbered.map((m, i) =>
        `<text x="${photo.width + r}" y="${(i + 1.5) * lineH}" font-size="${r * 1.15}" font-family="Plus Jakarta Sans" fill="#222222">${m.n}  ${esc(m.label)}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`
        + `<image width="${photo.width}" height="${photo.height}" href="${photo.href}"/>${markers}${legend}</svg>`;
    const outDir = userPath(args.values.out?.[0] ?? join(tmpdir(), 'archiyou', 'marks'));
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `${basename(photoArg, extname(photoArg))}.marked.png`);
    writeFileSync(file, renderPng(svg, { mode: 'width', value: Math.min(W, 1600) }));
    out(`${numbered.length} marks  files ${file}`);
    return 0;
}
