/**
 *  DXFExporter.ts
 *
 *  A small, self-contained ASCII DXF writer for the Modeler pipeline.
 *
 *  Scope:
 *    - Emits DXF R2000 (AC1015) so we can use true-colour (group 420) styling and
 *      real ALIGNED DIMENSION entities (which reference an anonymous *D block).
 *    - Native geometry entities: LINE, LWPOLYLINE (with bulges), CIRCLE, ARC, ELLIPSE,
 *      SPLINE (spans the kernel cannot describe fall back to chords).
 *    - Aligned dimensions are written both as a DIMENSION entity (CAD-editable)
 *      AND as a baked *D block (lines + arrow SOLIDs + MTEXT) so every viewer
 *      renders them even without regenerating.
 *
 *  This file is dependency-free and pure-TS (no WASM, no meshup edits). Geometry comes
 *  from meshup Curve's exportSpans(), which reports what each exact span is along with
 *  the circle or ellipse it lies on. Deliberately not subtype(): that names the whole
 *  curve and has no name for "lines and arcs mixed", so it answers "Spline" for a filleted
 *  rectangle — which is how this exporter used to emit malformed SPLINE entities built
 *  from the arcs' chords.
 *
 *  See buildDXF() for the top-level assembly used by ShapeCollection.toDXF(),
 *  SceneNode.toDXF() and Modeler.toDXF() (all via shapeAnnotations.ts).
 */

import type * as meshup from '@archiyou/meshup'
import type { SpanParams, SpanPoint } from '@archiyou/meshup'
import type { ModelUnits } from './types'
import type { AnyShape } from './types'

//// TYPES ////

export interface toDXFOptions
{
    all?: boolean          // also export hidden shapes
    annotations?: boolean  // include dimension lines
    units?: ModelUnits     // model unit (for $INSUNITS)
}

type Vec3 = { x: number; y: number; z: number }
type RGB = [number, number, number]

/** DXF $INSUNITS codes. Decimeter has no standard code → unitless (0). */
const UNITS_TO_INSUNITS: Record<ModelUnits, number> = {
    mm: 4, cm: 5, dm: 0, m: 6, km: 7, inch: 1, feet: 2, yd: 10, mi: 3,
}

const XY_TOLERANCE = 1e-4 // z within this of 0 counts as "on the XY plane"

//// SMALL UTILS ////

const fmt = (n: number): string => (Object.is(n, -0) ? 0 : +n.toFixed(6)).toString()
const degOf = (rad: number): number => (rad * 180) / Math.PI

/** Parse a CSS hex colour ('#rrggbb' / '#rgb') to [r,g,b]. Returns null on miss. */
function hexToRgb(hex: string | undefined | null): RGB | null
{
    if (typeof hex !== 'string') return null
    let h = hex.trim().replace(/^#/, '')
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}


//// DXF DOCUMENT ////

interface LayerDef { name: string; colorRgb: RGB | null; dashed: boolean; handle: string }
interface DimBlock { blockName: string; recordHandle: string; body: string }

/**
 *  Minimal DXF R2000 (AC1015) document. Handles are allocated monotonically as
 *  hex strings; owner pointers (group 330) are wired so strict readers accept it.
 */
export class DXFDocument
{
    // Settings for dimension styling (model units).
    ARROW_SIZE = 2.5
    TEXT_HEIGHT = 2.5
    EXT_GAP = 0.625 // gap between shape and start of extension line

    private _units: ModelUnits = 'mm'
    private _handleSeq = 0x100

    private _layers = new Map<string, LayerDef>()
    private _entities: string[] = []          // ENTITIES section body (geometry + DIMENSION)
    private _dimBlocks: DimBlock[] = []        // anonymous *D blocks
    private _dimSeq = 0

    // Forward-referenced handles.
    private _modelSpaceRecord!: string
    private _paperSpaceRecord!: string

    constructor(units: ModelUnits = 'mm')
    {
        this._units = units
        // Pre-allocate block-record handles referenced by ENTITIES owners and BLOCKS.
        this._modelSpaceRecord = this._nextHandle()
        this._paperSpaceRecord = this._nextHandle()
        // Layer '0' always exists.
        this.ensureLayer('0')
    }

    private _nextHandle(): string { return (this._handleSeq++).toString(16).toUpperCase() }

    private _pair(code: number, value: string | number): string { return `${code}\n${value}\n` }

    //// LAYERS ////

    ensureLayer(name: string, opts: { colorRgb?: RGB | null; dashed?: boolean } = {}): string
    {
        const key = name || '0'
        const existing = this._layers.get(key)
        if (existing) return existing.name
        this._layers.set(key, {
            name: key,
            colorRgb: opts.colorRgb ?? null,
            dashed: Boolean(opts.dashed),
            handle: this._nextHandle(),
        })
        return key
    }

    //// GEOMETRY ENTITIES ////

    private _entityHeader(type: string, layer: string, subclass: string): string
    {
        return this._pair(0, type)
            + this._pair(5, this._nextHandle())
            + this._pair(330, this._modelSpaceRecord)
            + this._pair(100, 'AcDbEntity')
            + this._pair(8, layer)
            + this._pair(100, subclass)
    }

    addLine(a: Vec3, b: Vec3, layer = '0'): void
    {
        this._entities.push(
            this._entityHeader('LINE', layer, 'AcDbLine')
            + this._pair(10, fmt(a.x)) + this._pair(20, fmt(a.y)) + this._pair(30, fmt(a.z ?? 0))
            + this._pair(11, fmt(b.x)) + this._pair(21, fmt(b.y)) + this._pair(31, fmt(b.z ?? 0)),
        )
    }

    /** A lightweight polyline, optionally with per-vertex bulges.
     *
     *  `bulges[i]` is `tan(theta / 4)` for the arc leaving vertex `i` — the DXF way of
     *  storing line and arc runs in one entity, and what a filleted outline should be
     *  written as. Group 42 is emitted only where a bulge is non-zero, and the spec's
     *  order within a vertex (10, 20, [40], [41], [42]) is what readers expect. */
    addLWPolyline(pts: Vec3[], closed: boolean, layer = '0', bulges?: number[]): void
    {
        if (pts.length < 2) return
        let s = this._entityHeader('LWPOLYLINE', layer, 'AcDbPolyline')
            + this._pair(90, pts.length)
            + this._pair(70, closed ? 1 : 0)
        pts.forEach((p, i) =>
        {
            s += this._pair(10, fmt(p.x)) + this._pair(20, fmt(p.y))
            const b = bulges?.[i]
            if (b !== undefined && b !== 0 && Number.isFinite(b)) { s += this._pair(42, fmt(b)) }
        })
        this._entities.push(s)
    }

    /** An exact ellipse or elliptical arc.
     *
     *  `majorAxis` is the centre-to-major-axis-endpoint vector (groups 11/21/31) and
     *  `ratio` the minor/major ratio (40); the parameters (41/42) are eccentric anomalies
     *  running counter-clockwise from start to end, with `0 .. 2*PI` meaning a full
     *  ellipse. */
    addEllipse(c: Vec3, majorAxis: Vec3, ratio: number, startParam: number, endParam: number,
        layer = '0'): void
    {
        this._entities.push(
            this._entityHeader('ELLIPSE', layer, 'AcDbEllipse')
            + this._pair(10, fmt(c.x)) + this._pair(20, fmt(c.y)) + this._pair(30, fmt(c.z ?? 0))
            + this._pair(11, fmt(majorAxis.x)) + this._pair(21, fmt(majorAxis.y))
            + this._pair(31, fmt(majorAxis.z ?? 0))
            + this._pair(210, 0) + this._pair(220, 0) + this._pair(230, 1)
            + this._pair(40, fmt(ratio))
            + this._pair(41, fmt(startParam))
            + this._pair(42, fmt(endParam)),
        )
    }

    addCircle(c: Vec3, r: number, layer = '0'): void
    {
        this._entities.push(
            this._entityHeader('CIRCLE', layer, 'AcDbCircle')
            + this._pair(10, fmt(c.x)) + this._pair(20, fmt(c.y)) + this._pair(30, fmt(c.z ?? 0))
            + this._pair(40, fmt(r)),
        )
    }

    /** startAngle/endAngle in degrees, CCW (DXF convention). */
    addArc(c: Vec3, r: number, startAngleDeg: number, endAngleDeg: number, layer = '0'): void
    {
        this._entities.push(
            this._entityHeader('ARC', layer, 'AcDbCircle')
            + this._pair(10, fmt(c.x)) + this._pair(20, fmt(c.y)) + this._pair(30, fmt(c.z ?? 0))
            + this._pair(40, fmt(r))
            + this._pair(100, 'AcDbArc')
            + this._pair(50, fmt(startAngleDeg))
            + this._pair(51, fmt(endAngleDeg)),
        )
    }

    addSpline(degree: number, ctrlPts: Vec3[], knots: number[], weights: number[] | null, closed: boolean, layer = '0'): void
    {
        // A clamped B-spline of degree d over n control points has exactly n + d + 1 knots.
        // This used to be assumed rather than checked, and the assumption was wrong for any
        // curve with a fillet in it: subtype() called it "Spline", the kernel had no spline
        // data to give, and what reached the file was 71=2, 72=2, 73=8 — two knots where
        // eleven were needed, over control points that were really the arcs' chords.
        // Readers reject that outright, so a polyline through the same points is strictly
        // better than emitting it.
        if (ctrlPts.length === 0 || knots.length !== ctrlPts.length + degree + 1
            || ctrlPts.length <= degree)
        {
            console.warn(`DXFExporter: refusing to write a SPLINE with ${knots.length} knots for `
                + `${ctrlPts.length} control points at degree ${degree} `
                + `(expected ${ctrlPts.length + degree + 1}); writing a polyline instead.`)
            this.addLWPolyline(ctrlPts, closed, layer)
            return
        }
        const rational = Array.isArray(weights) && weights.some(w => Math.abs(w - 1) > 1e-8)
        // 70: 1=closed, 2=periodic, 4=rational, 8=planar (bit flags)
        const flag = (closed ? 1 : 0) | (rational ? 4 : 0) | 8
        let s = this._entityHeader('SPLINE', layer, 'AcDbSpline')
            + this._pair(210, 0) + this._pair(220, 0) + this._pair(230, 1) // normal (planar XY)
            + this._pair(70, flag)
            + this._pair(71, degree)
            + this._pair(72, knots.length)
            + this._pair(73, ctrlPts.length)
            + this._pair(74, 0)
        knots.forEach(k => { s += this._pair(40, fmt(k)) })
        if (rational) weights!.forEach(w => { s += this._pair(41, fmt(w)) })
        ctrlPts.forEach(p =>
        {
            s += this._pair(10, fmt(p.x)) + this._pair(20, fmt(p.y)) + this._pair(30, fmt(p.z ?? 0))
        })
        this._entities.push(s)
    }

    /** Filled triangle (used for dimension arrowheads inside a *D block). */
    private _solidTriangle(p0: Vec3, p1: Vec3, p2: Vec3, layer: string): string
    {
        // SOLID vertex order is a "bow-tie": 0,1,3,2 — repeat p2 as the 4th point.
        return this._pair(0, 'SOLID')
            + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbEntity')
            + this._pair(8, layer)
            + this._pair(100, 'AcDbTrace')
            + this._pair(10, fmt(p0.x)) + this._pair(20, fmt(p0.y)) + this._pair(30, 0)
            + this._pair(11, fmt(p1.x)) + this._pair(21, fmt(p1.y)) + this._pair(31, 0)
            + this._pair(12, fmt(p2.x)) + this._pair(22, fmt(p2.y)) + this._pair(32, 0)
            + this._pair(13, fmt(p2.x)) + this._pair(23, fmt(p2.y)) + this._pair(33, 0)
    }

    private _blockLine(a: Vec3, b: Vec3, layer: string): string
    {
        return this._pair(0, 'LINE')
            + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbEntity')
            + this._pair(8, layer)
            + this._pair(100, 'AcDbLine')
            + this._pair(10, fmt(a.x)) + this._pair(20, fmt(a.y)) + this._pair(30, 0)
            + this._pair(11, fmt(b.x)) + this._pair(21, fmt(b.y)) + this._pair(31, 0)
    }

    private _blockMText(at: Vec3, text: string, angleRad: number, layer: string): string
    {
        return this._pair(0, 'MTEXT')
            + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbEntity')
            + this._pair(8, layer)
            + this._pair(100, 'AcDbMText')
            + this._pair(10, fmt(at.x)) + this._pair(20, fmt(at.y)) + this._pair(30, 0)
            + this._pair(40, fmt(this.TEXT_HEIGHT))
            + this._pair(71, 5) // attachment: middle-center
            + this._pair(7, 'STANDARD')
            + this._pair(1, text)
            + this._pair(50, fmt(angleRad)) // MTEXT rotation, group 50 is in radians (unlike TEXT, which is degrees)
    }

    /**
     *  Add an ALIGNED dimension between two definition points, plus a baked *D block.
     *  @param defStart first extension-line origin (on the measured shape)
     *  @param defEnd   second extension-line origin
     *  @param dimStart offset dimension-line endpoint above defStart
     *  @param dimEnd   offset dimension-line endpoint above defEnd
     *  @param textPos  MTEXT insertion point (midpoint of the dimension line)
     *  @param valueText text to show (already formatted, incl. units if wanted)
     */
    addAlignedDim(
        defStart: Vec3, defEnd: Vec3,
        dimStart: Vec3, dimEnd: Vec3,
        textPos: Vec3, valueText: string,
        layer = 'dimensions',
    ): void
    {
        this.ensureLayer(layer)
        const blockName = `*D${this._dimSeq++}`
        const recordHandle = this._nextHandle()

        // ---- Baked block body (visible geometry) ----
        const dir = { x: dimEnd.x - dimStart.x, y: dimEnd.y - dimStart.y }
        const len = Math.hypot(dir.x, dir.y) || 1
        const ux = dir.x / len, uy = dir.y / len          // along dim line
        const px = -uy, py = ux                            // perpendicular
        const a = this.ARROW_SIZE
        const arrow = (tip: Vec3, sign: number): string =>
        {
            const bx = tip.x + sign * ux * a, by = tip.y + sign * uy * a
            const p1 = { x: bx + px * a * 0.3, y: by + py * a * 0.3, z: 0 }
            const p2 = { x: bx - px * a * 0.3, y: by - py * a * 0.3, z: 0 }
            return this._solidTriangle(tip, p1, p2, layer)
        }

        const textAngle = Math.atan2(dir.y, dir.x)
        let body = ''
        body += this._blockLine(defStart, dimStart, layer)   // extension line 1
        body += this._blockLine(defEnd, dimEnd, layer)       // extension line 2
        body += this._blockLine(dimStart, dimEnd, layer)     // dimension line
        body += arrow(dimStart, +1)
        body += arrow(dimEnd, -1)
        body += this._blockMText(textPos, valueText, textAngle, layer)

        this._dimBlocks.push({ blockName, recordHandle, body })

        // ---- DIMENSION entity referencing the block ----
        this._entities.push(
            this._pair(0, 'DIMENSION')
            + this._pair(5, this._nextHandle())
            + this._pair(330, this._modelSpaceRecord)
            + this._pair(100, 'AcDbEntity')
            + this._pair(8, layer)
            + this._pair(100, 'AcDbDimension')
            + this._pair(2, blockName)
            + this._pair(10, fmt(dimStart.x)) + this._pair(20, fmt(dimStart.y)) + this._pair(30, 0)
            + this._pair(11, fmt(textPos.x)) + this._pair(21, fmt(textPos.y)) + this._pair(31, 0)
            + this._pair(70, 1)           // aligned
            + this._pair(1, valueText)    // text override
            + this._pair(3, 'AY')         // dimstyle
            + this._pair(100, 'AcDbAlignedDimension')
            + this._pair(13, fmt(defStart.x)) + this._pair(23, fmt(defStart.y)) + this._pair(33, 0)
            + this._pair(14, fmt(defEnd.x)) + this._pair(24, fmt(defEnd.y)) + this._pair(34, 0),
        )
    }

    //// SERIALISATION ////

    private _headerSection(): string
    {
        return this._pair(0, 'SECTION') + this._pair(2, 'HEADER')
            + this._pair(9, '$ACADVER') + this._pair(1, 'AC1015')
            + this._pair(9, '$HANDSEED') + this._pair(5, (this._handleSeq + 0x1000).toString(16).toUpperCase())
            + this._pair(9, '$INSUNITS') + this._pair(70, UNITS_TO_INSUNITS[this._units] ?? 0)
            + this._pair(9, '$MEASUREMENT') + this._pair(70, 1) // 1 = metric
            + this._pair(0, 'ENDSEC')
    }

    private _tablesSection(): string
    {
        const layers = [...this._layers.values()]
        let s = this._pair(0, 'SECTION') + this._pair(2, 'TABLES')

        // --- LTYPE table (CONTINUOUS + DASHED) ---
        s += this._pair(0, 'TABLE') + this._pair(2, 'LTYPE') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTable') + this._pair(70, 2)
        const ltype = (name: string, pattern: number[]): string =>
        {
            const total = pattern.reduce((t, p) => t + Math.abs(p), 0)
            let e = this._pair(0, 'LTYPE') + this._pair(5, this._nextHandle())
                + this._pair(100, 'AcDbSymbolTableRecord') + this._pair(100, 'AcDbLinetypeTableRecord')
                + this._pair(2, name) + this._pair(70, 0) + this._pair(3, '') + this._pair(72, 65)
                + this._pair(73, pattern.length) + this._pair(40, fmt(total))
            pattern.forEach(p => { e += this._pair(49, fmt(p)) + this._pair(74, 0) })
            return e
        }
        s += ltype('CONTINUOUS', [])
        s += ltype('DASHED', [5, -2.5])
        s += this._pair(0, 'ENDTAB')

        // --- LAYER table ---
        s += this._pair(0, 'TABLE') + this._pair(2, 'LAYER') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTable') + this._pair(70, layers.length)
        layers.forEach(l =>
        {
            s += this._pair(0, 'LAYER') + this._pair(5, l.handle)
                + this._pair(100, 'AcDbSymbolTableRecord') + this._pair(100, 'AcDbLayerTableRecord')
                + this._pair(2, l.name) + this._pair(70, 0)
                + this._pair(62, 7) // ACI colour (7 = white/black); true colour below overrides
            if (l.colorRgb) s += this._pair(420, (l.colorRgb[0] << 16) | (l.colorRgb[1] << 8) | l.colorRgb[2])
            s += this._pair(6, l.dashed ? 'DASHED' : 'CONTINUOUS')
                + this._pair(370, 0) // lineweight
        })
        s += this._pair(0, 'ENDTAB')

        // --- STYLE table (one text style) ---
        s += this._pair(0, 'TABLE') + this._pair(2, 'STYLE') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTable') + this._pair(70, 1)
            + this._pair(0, 'STYLE') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTableRecord') + this._pair(100, 'AcDbTextStyleTableRecord')
            + this._pair(2, 'STANDARD') + this._pair(70, 0) + this._pair(40, 0) + this._pair(41, 1)
            + this._pair(50, 0) + this._pair(71, 0) + this._pair(42, this.TEXT_HEIGHT)
            + this._pair(3, 'txt') + this._pair(4, '')
            + this._pair(0, 'ENDTAB')

        // --- DIMSTYLE table (one style "AY") ---
        s += this._pair(0, 'TABLE') + this._pair(2, 'DIMSTYLE') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTable') + this._pair(70, 1)
            + this._pair(0, 'DIMSTYLE') + this._pair(105, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTableRecord') + this._pair(100, 'AcDbDimStyleTableRecord')
            + this._pair(2, 'AY') + this._pair(70, 0)
            + this._pair(41, fmt(this.ARROW_SIZE))   // DIMASZ arrow size
            + this._pair(140, fmt(this.TEXT_HEIGHT)) // DIMTXT text height
            + this._pair(147, fmt(this.EXT_GAP))     // DIMGAP
            + this._pair(0, 'ENDTAB')

        // --- BLOCK_RECORD table ---
        const dimRecords = this._dimBlocks
        s += this._pair(0, 'TABLE') + this._pair(2, 'BLOCK_RECORD') + this._pair(5, this._nextHandle())
            + this._pair(100, 'AcDbSymbolTable') + this._pair(70, 2 + dimRecords.length)
        const blockRecord = (name: string, handle: string): string =>
            this._pair(0, 'BLOCK_RECORD') + this._pair(5, handle)
            + this._pair(100, 'AcDbSymbolTableRecord') + this._pair(100, 'AcDbBlockTableRecord')
            + this._pair(2, name) + this._pair(70, 0)
        s += blockRecord('*Model_Space', this._modelSpaceRecord)
        s += blockRecord('*Paper_Space', this._paperSpaceRecord)
        dimRecords.forEach(d => { s += blockRecord(d.blockName, d.recordHandle) })
        s += this._pair(0, 'ENDTAB')

        s += this._pair(0, 'ENDSEC')
        return s
    }

    private _blocksSection(): string
    {
        let s = this._pair(0, 'SECTION') + this._pair(2, 'BLOCKS')
        const block = (name: string, recordHandle: string, body: string): string =>
            this._pair(0, 'BLOCK') + this._pair(5, this._nextHandle()) + this._pair(330, recordHandle)
            + this._pair(100, 'AcDbEntity') + this._pair(8, '0') + this._pair(100, 'AcDbBlockBegin')
            + this._pair(2, name) + this._pair(70, 0)
            + this._pair(10, 0) + this._pair(20, 0) + this._pair(30, 0)
            + this._pair(3, name) + this._pair(1, '')
            + body
            + this._pair(0, 'ENDBLK') + this._pair(5, this._nextHandle()) + this._pair(330, recordHandle)
            + this._pair(100, 'AcDbEntity') + this._pair(8, '0') + this._pair(100, 'AcDbBlockEnd')

        s += block('*Model_Space', this._modelSpaceRecord, '')
        s += block('*Paper_Space', this._paperSpaceRecord, '')
        this._dimBlocks.forEach(d => { s += block(d.blockName, d.recordHandle, d.body) })
        s += this._pair(0, 'ENDSEC')
        return s
    }

    private _entitiesSection(): string
    {
        return this._pair(0, 'SECTION') + this._pair(2, 'ENTITIES')
            + this._entities.join('')
            + this._pair(0, 'ENDSEC')
    }

    private _objectsSection(): string
    {
        // Minimal root dictionary — required by R2000 consumers.
        const rootHandle = this._nextHandle()
        return this._pair(0, 'SECTION') + this._pair(2, 'OBJECTS')
            + this._pair(0, 'DICTIONARY') + this._pair(5, rootHandle) + this._pair(330, 0)
            + this._pair(100, 'AcDbDictionary') + this._pair(281, 1)
            + this._pair(0, 'ENDSEC')
    }

    stringify(): string
    {
        // Order matters: sections that allocate handles run before HEADER emits $HANDSEED.
        const tables = this._tablesSection()
        const blocks = this._blocksSection()
        const entities = this._entitiesSection()
        const objects = this._objectsSection()
        return this._headerSection() + tables + blocks + entities + objects + this._pair(0, 'EOF')
    }
}

//// CURVE → DXF ////

const toVec = (p: { x: number; y: number; z?: number }): Vec3 => ({ x: p.x, y: p.y, z: (p as any).z ?? 0 })

/** Write a single meshup Curve as native DXF geometry on `layer`.
 *
 *  Driven by `exportSpans()`, which reports what each exact span *is* and the parameters
 *  of the circle or ellipse it lies on. The previous version dispatched on `subtype()`,
 *  which names the whole curve and has no name for "lines and arcs mixed" — it answered
 *  "Spline" for a filleted rectangle, and the exporter dutifully asked for spline data the
 *  kernel could not provide.
 */
export function writeCurveToDXF(doc: DXFDocument, curve: meshup.Curve, layer: string): void
{
    const c = curve as any
    const spans: SpanParams[] = typeof c.exportSpans === 'function' ? c.exportSpans() : []
    const closed: boolean = c.isClosed?.() ?? false

    if (spans.length === 0)
    {
        const pts = (c.tessellate() as Vec3[]).map(toVec)
        doc.addLWPolyline(pts, closed, layer)
        return
    }

    // A closed run of arcs on one circle, covering a full turn.
    const circle = asCircle(spans, closed)
    if (circle)
    {
        doc.addCircle(pt(circle.center), circle.radius, layer)
        return
    }

    // A lone span is always better as its own entity: LINE, ARC, ELLIPSE or SPLINE says
    // more than a one-segment polyline, and readers can edit it as the shape it is.
    if (spans.length === 1)
    {
        writeSpanToDXF(doc, spans[0], closed, layer)
        return
    }

    // Everything is straight: one polyline, no bulges needed.
    if (spans.every(s => s.kind === 'line'))
    {
        doc.addLWPolyline(vertexRun(spans, closed), closed, layer)
        return
    }

    // Lines and arcs together — a fillet, a slot, a rounded outline. LWPOLYLINE stores
    // exactly this with a bulge per vertex, and it is what CAD tools write for the shape.
    // Writing it as a SPLINE was the single worst thing this exporter did: the entity was
    // malformed *and* the corners were replaced by their chords.
    if (spans.every(s => s.kind === 'line' || s.kind === 'arc'))
    {
        const bulges = spans.map(s => (s.kind === 'arc' ? s.bulge : 0))
        if (!closed) { bulges.push(0) }   // the trailing vertex closes no segment
        doc.addLWPolyline(vertexRun(spans, closed), closed, layer, bulges)
        return
    }

    // Otherwise emit each span as its own entity.
    spans.forEach(span => writeSpanToDXF(doc, span, closed, layer))
}

/** One exact span as its own DXF entity. */
function writeSpanToDXF(doc: DXFDocument, span: SpanParams, closed: boolean, layer: string): void
{
    switch (span.kind)
    {
        case 'line':
            doc.addLine(pt(span.start), pt(span.end), layer)
            break

        case 'arc':
        {
            // Exact centre and radius. This used to be re-derived from three points of a
            // tessellation via a circumcircle, so the radius written to the file carried
            // the chord error of a polyline the curve never needed to build.
            const a0 = Math.atan2(span.start[1] - span.center[1], span.start[0] - span.center[0])
            const a1 = Math.atan2(span.end[1] - span.center[1], span.end[0] - span.center[0])
            // DXF arcs always run counter-clockwise from start to end, so a clockwise span
            // is written by swapping its ends rather than by negating anything.
            const [s, e] = span.ccw ? [a0, a1] : [a1, a0]
            doc.addArc(pt(span.center), span.radius, degOf(s), degOf(e), layer)
            break
        }

        case 'conic':
        {
            const el = span.ellipse
            if (!el) { doc.addLine(pt(span.start), pt(span.end), layer); break }
            // DXF wants the major axis as a vector and the parameters counter-clockwise,
            // which is exactly how spanParams reports them.
            doc.addEllipse(pt(el.center), pt(el.majorAxis), el.ratio,
                el.startParam, el.endParam, layer)
            break
        }

        case 'spline':
            doc.addSpline(span.degree, span.controlPoints.map(pt), span.knots,
                span.rational ? span.weights : null, closed, layer)
            break

        case 'quadratic':
        case 'cubic':
        {
            // A Bezier is a clamped spline whose knots sit entirely at its ends.
            const cps = span.kind === 'cubic'
                ? [span.start, span.control1, span.control2, span.end]
                : [span.start, span.control, span.end]
            const degree = cps.length - 1
            const knots = [...Array(degree + 1).fill(0), ...Array(degree + 1).fill(1)]
            doc.addSpline(degree, cps.map(pt), knots, null, false, layer)
            break
        }

        default:
            // Kernel-flagged as undescribable; a chord is all that is left.
            doc.addLine(pt(span.start), pt(span.end), layer)
            break
    }
}

/** A span-list point as a DXF vector. */
const pt = (p: readonly [number, number, number]): Vec3 => ({ x: p[0], y: p[1], z: p[2] })

/** The vertices of a connected span run: each span's start, plus the final end when open. */
function vertexRun(spans: SpanParams[], closed: boolean): Vec3[]
{
    const out = spans.map(s => pt(s.start))
    if (!closed) { out.push(pt(spans[spans.length - 1].end)) }
    return out
}

/** The circle these spans describe, or null if they describe anything else.
 *
 *  Every span must be an arc about one common centre and radius, and together they must
 *  close a full turn. Checked from the spans because `subtype()` calls *any* closed
 *  arcs-only contour a "Circle" — a two-arc lens included, which was being written as a
 *  CIRCLE of its bounding box. */
function asCircle(spans: SpanParams[], closed: boolean): { center: SpanPoint, radius: number } | null
{
    if (!closed || spans.length === 0) return null
    const first = spans[0]
    if (first.kind !== 'arc') return null

    let total = 0
    for (const s of spans)
    {
        if (s.kind !== 'arc') return null
        if (Math.abs(s.radius - first.radius) > first.radius * 1e-9) return null
        const d = Math.hypot(s.center[0] - first.center[0], s.center[1] - first.center[1],
            s.center[2] - first.center[2])
        if (d > first.radius * 1e-9) return null
        total += s.sweep
    }
    return Math.abs(Math.abs(total) - Math.PI * 2) < 1e-9
        ? { center: first.center, radius: first.radius }
        : null
}

//// TOP-LEVEL ASSEMBLY ////

/** Is this shape 2D and lying on the XY plane (all z ≈ 0)? */
function is2DOnXY(shape: any): boolean
{
    if (typeof shape?.is2D === 'function' && !shape.is2D()) return false
    const bb = shape?.bbox?.()
    if (!bb) return false
    const minZ = bb.min?.().z ?? 0
    const maxZ = bb.max?.().z ?? 0
    return Math.abs(minZ) <= XY_TOLERANCE && Math.abs(maxZ) <= XY_TOLERANCE
}

/** A shape counts as "curve-like" (has DXF geometry) if it exposes subtype(). */
function toCurve(shape: any): meshup.Curve | null
{
    if (typeof shape?.subtype === 'function') return shape as meshup.Curve
    // SmartMeshPolygon / closed faces → export boundary as tessellated polyline via a Curve-like.
    if (typeof shape?.tessellate === 'function') return shape as meshup.Curve
    return null
}

/**
 *  Assemble a full DXF string from a set of meshup shapes + dimension annotations.
 *  Returns null (with a warning) when there are no 2D-on-XY shapes to export.
 */
export function buildDXF(
    shapes: meshup.ShapeCollection | AnyShape[],
    annotations: Array<any>,
    opts: toDXFOptions = {},
): string | null
{
    const options = { all: false, annotations: true, units: 'mm' as ModelUnits, ...opts }
    const shapeArr: any[] = Array.isArray(shapes) ? shapes : (shapes as any).all?.() ?? (shapes as any).toArray?.() ?? []

    const exportShapes = shapeArr.filter(s =>
    {
        if (!options.all && typeof s?.visible === 'function' && !s.visible()) return false
        return is2DOnXY(s)
    })

    if (exportShapes.length === 0)
    {
        console.warn('buildDXF(): No 2D shapes on the XY plane found to export to DXF.')
        return null
    }

    const doc = new DXFDocument(options.units)

    exportShapes.forEach(shape =>
    {
        const layerName = (typeof shape.name === 'function' ? shape.name() : undefined) || '0'
        const colorRgb = hexToRgb(shape?.style?.color)
        const dashed = Array.isArray(shape?.style?.stroke?.dash) && shape.style.stroke.dash.length > 0
        doc.ensureLayer(layerName, { colorRgb, dashed })

        const curve = toCurve(shape)
        if (curve) writeCurveToDXF(doc, curve, layerName)
    })

    if (options.annotations && Array.isArray(annotations))
    {
        annotations.forEach(a =>
        {
            if (a && typeof a.toDXF === 'function' && (a._type === 'DimensionLine' || a.type?.() === 'dimensionLine'))
            {
                try { a.toDXF(doc, 'dimensions') }
                catch (e) { console.warn('buildDXF(): failed to write a dimension line:', e) }
            }
        })
    }

    return doc.stringify()
}
