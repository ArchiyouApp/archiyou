/**
 *  SVGExporter.ts
 *
 *  A small, self-contained SVG writer for the Modeler pipeline — the missing
 *  sibling of DXFExporter.ts and DAEExporter.ts.
 *
 *  Scope:
 *    - Serialize a ShapeCollection of 2D curves into one SVG document with a
 *      proper viewBox, padding, optional square framing and a stylesheet that
 *      works on light AND dark backgrounds.
 *    - Project the scene's 3D meshes to 2D line-work (hidden-line removal in
 *      Rust/WASM) WITHOUT touching the scenegraph, so an export never changes
 *      what the next export sees.
 *    - Produce a size-capped thumbnail via progressive degradation, so a
 *      pathologically dense model can never emit a multi-megabyte icon.
 *
 *  This file is dependency-free and pure-TS (no WASM, no meshup edits). Geometry
 *  is consumed through meshup's public accessors (bbox(), curves(), group(),
 *  toSVGElem()) and the undecorated projection entrypoints _iso()/_elevation().
 *
 *  Why the undecorated projections: ShapeCollection.iso()/elevation() carry
 *  @colSceneLayer decorators that ADD their result to the active scene. Calling
 *  those from an exporter pollutes the scenegraph of every later export in the
 *  same run (the GLB would grow a stray 'iso' layer). _iso()/_elevation() are
 *  the same maths with no scene management — see ShapeCollection.ts.
 */

import type * as meshup from '@archiyou/meshup'
import type { ModelUnits } from './types'

//// TYPES ////

export interface toSVGOptions
{
    /** Blank margin on every side, as a fraction of the drawing's largest side. Default 0.06. */
    padding?: number
    /** Normalize into a square viewBox so one asset serves 1:1 icons and 16:10 cards. Default false. */
    square?: boolean
    /** Decimals kept on emitted coordinates. Default: derived from the drawing size so
     *  ~1/2000 of the drawing is preserved (sub-pixel at any realistic render size). */
    precision?: number
    /** Stroke width in DEVICE pixels (via vector-effect), independent of model scale. Default 1.25. */
    strokeWidth?: number
    /** Emit the 'hidden' group when the projection produced one. Default true. */
    hidden?: boolean
    /** <title> for accessibility. */
    title?: string
    /** Recorded as data-units. Informational only. */
    units?: ModelUnits
}

export type ProjectionView = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

export interface toProjectionSVGOptions extends toSVGOptions
{
    /** Which projection to take. Default 'iso'. Ignored when `cam` is given. */
    view?: ProjectionView
    /** Explicit camera direction, overrides `view`. Default [-1,-1,1]. */
    cam?: [number, number, number]
    /** Tessellation samples for curved edges. Default 16 (8 for thumbnails). */
    samples?: number
    /** Facet-boundary edges below this angle are dropped. Default 10 (20 for thumbnails). */
    featureAngle?: number
    /** Which hidden-line-removal algorithm the kernel should run.
     *
     *  - `'raycast'` (default) — samples visibility along each edge. Endpoints
     *    are approximate and an occluder narrower than the sample spacing is
     *    missed.
     *  - `'exact'` — computes occlusion analytically. Correct endpoints, finds
     *    occluders of any size, and ignores `samples`.
     *  - `'clip'` / `'painter'` — per shape, no merge into a single solid.
     *    Need convex, non-interpenetrating shapes. `'painter'` emits opaque
     *    fills, so it is unsuitable for DXF export.
     */
    strategy?: 'raycast' | 'exact' | 'clip' | 'painter'
    /** Downgrade to `'raycast'` with a warning when a per-shape strategy does
     *  not apply, instead of throwing. Default false. */
    fallback?: boolean
}

export type ThumbnailDegradeStep = 'hidden' | 'precision' | 'cull'

export interface ThumbnailSVGOptions extends toProjectionSVGOptions
{
    /** Soft cap that drives the degradation ladder. Default 65536. */
    maxBytes?: number
    /** Above this even after degrading, give up and return null. Default 131072. */
    hardMaxBytes?: number
}

export interface ThumbnailSVGResult
{
    svg: string
    bytes: number
    /** Number of curves actually emitted (after any culling). */
    curves: number
    /** Which degradation steps had to be applied to fit the budget. */
    degraded: Array<ThumbnailDegradeStep>
}

//// DEFAULTS ////

const DEFAULT_PADDING       = 0.06
const DEFAULT_STROKE_WIDTH  = 1.25
const DEFAULT_CAM: [number, number, number] = [-1, -1, 1]

/** Thumbnail-tuned projection settings. Coarser than the library defaults because at
 *  40–220px an 8-sample arc is indistinguishable from a 16-sample one, and near-coplanar
 *  facet boundaries read as noise rather than as detail. Applied up front rather than as a
 *  degradation step: re-projecting is an unbounded HLR cost, re-serializing is cheap. */
const THUMB_SAMPLES       = 8
const THUMB_FEATURE_ANGLE = 20

const DEFAULT_MAX_BYTES      = 65_536
const DEFAULT_HARD_MAX_BYTES = 131_072

/** Relative coordinate precision: keep ~1/PRECISION_TARGET of the drawing's size.
 *  This is what makes a 3000mm model emit "2847" instead of "2847.193582" while a
 *  10mm model still gets "8.473" — a fixed decimal count can't do both. */
const PRECISION_TARGET = 2000

/** Theme-aware ink. `currentColor` + a root `color` is the only thing that works inside an
 *  <img>-loaded SVG, which is an isolated document and cannot inherit the page's color.
 *  Dark gray rather than near-black: these drawings sit as small previews in lists, where
 *  full-strength ink reads as a heavy blot. Mirrors the app's --color-gray-dark. */
const INK_LIGHT = '#666666'
const INK_DARK  = '#c9d1da'

/** Inline presentation attributes emitted by meshup's Style.toSvgAttrs(). They cost ~60 bytes
 *  per element and are all superseded by our stylesheet (CSS rules beat presentation
 *  attributes), so they are pure overhead in an export we control end to end. */
const STYLE_ATTR_RE =
    /\s(?:fill|fill-opacity|stroke|stroke-opacity|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|vector-effect)="[^"]*"/g

/** Any plain decimal number. meshup emits coordinates via toFixed(6), never exponent notation. */
const DECIMAL_RE = /-?\d*\.\d+/g

/** A path made only of moves and lines — the only shape we dare simplify. Anything with
 *  C/S/Q/T/A segments is left completely alone. */
const POLYLINE_PATH_RE = /^[MLZmlz0-9eE.,\s+-]+$/

//// GEOMETRY HELPERS ////

type Box2D = { minX: number; minY: number; maxX: number; maxY: number }

/** A curve's bounding box in SVG coordinates. meshup's toSVGElem() flips Y (SVG's Y axis
 *  points down, the model's points up), so the box must be flipped identically or the
 *  viewBox won't contain the geometry it frames. */
function curveBoxSVG(curve: any): Box2D | null
{
    const bb = curve?.bbox?.()
    if (!bb) return null
    const min = bb.min(), max = bb.max()
    if (![min?.x, min?.y, max?.x, max?.y].every((n) => typeof n === 'number' && isFinite(n))) return null
    return { minX: min.x, minY: -max.y, maxX: max.x, maxY: -min.y }
}

function unionBox(a: Box2D | null, b: Box2D | null): Box2D | null
{
    if (!a) return b
    if (!b) return a
    return {
        minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    }
}

function boxDiagonal(b: Box2D): number
{
    return Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
}

/** Decimals needed to preserve ~1/PRECISION_TARGET of a drawing this big. */
function precisionForSize(size: number): number
{
    if (!(size > 0) || !isFinite(size)) return 3
    return Math.max(0, Math.min(6, Math.ceil(-Math.log10(size / PRECISION_TARGET))))
}

//// SERIALIZATION ////

function escapeXML(s: string): string
{
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Drop interior points that lie on the straight line between their neighbours.
 *
 * The HLR projection tessellates EVERY edge at `samples` resolution, so a box's straight
 * edge arrives as a 10-point polyline where 2 points carry all the information. On
 * rectilinear models — the common case for a configurator — this is a ~5x size win, and
 * it costs no fidelity at all because the discarded points are provably on the segment.
 *
 * Conservative by construction: paths containing any curve segment are returned untouched,
 * and `tol` is tied to the coordinate rounding step so a point can only be dropped when
 * rounding would have flattened it anyway.
 */
function simplifyPathData(d: string, tol: number): string
{
    if (!POLYLINE_PATH_RE.test(d)) return d

    const closed = /[Zz]\s*$/.test(d)
    const nums = d.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g)
    if (!nums || nums.length < 6 || nums.length % 2 !== 0) return d

    const pts: Array<[number, number]> = []
    for (let i = 0; i < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]])

    const kept: Array<[number, number]> = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++)
    {
        const a = kept[kept.length - 1], b = pts[i], c = pts[i + 1]
        const abx = b[0] - a[0], aby = b[1] - a[1]
        const acx = c[0] - a[0], acy = c[1] - a[1]
        const acLen = Math.hypot(acx, acy)
        // Perpendicular distance of b from the segment a→c.
        const dist = acLen > 0 ? Math.abs(abx * acy - aby * acx) / acLen : Math.hypot(abx, aby)
        if (dist > tol) kept.push(b)
    }
    kept.push(pts[pts.length - 1])

    if (kept.length === pts.length) return d

    const parts = kept.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
    return parts.join(' ') + (closed ? ' Z' : '')
}

/** Strip meshup's inline style attributes, simplify the geometry and round every coordinate. */
function compactElement(elem: string, decimals: number, tol: number): string
{
    return elem
        .replace(STYLE_ATTR_RE, '')
        .replace(/\sd="([^"]*)"/g, (_m, d: string) => ` d="${simplifyPathData(d, tol)}"`)
        .replace(DECIMAL_RE, (m) => String(+(+m).toFixed(decimals)))
}

/** Screen ink: theme-aware, pinned to device pixels.
 *  `scope` ('.view-3 ') confines every rule to one drawing — see BuildSVGDocumentOptions. */
function stylesheet(strokeWidth: number, scope: string = ''): string
{
    const root = scope ? scope.trim() : 'svg'
    return '<style>'
        + `${root}{color:${INK_LIGHT}}`
        + `@media (prefers-color-scheme:dark){${root}{color:${INK_DARK}}}`
        + `${scope}.line{fill:none;stroke:currentColor;`
        + `stroke-width:${strokeWidth};vector-effect:non-scaling-stroke;`
        + 'stroke-linecap:round;stroke-linejoin:round}'
        + `${scope}.hidden{opacity:.35;stroke-dasharray:6 4}`
        + '</style>'
}

/** Paper ink: a real width, in model units, that lands at the intended millimeters once the
 *  drawing is placed at its scale. Black rather than theme-aware — this is print. */
function stylesheetMm(strokeWidth: number, scope: string = ''): string
{
    // Dashes tied to the line weight, so hidden lines keep the same rhythm at any scale.
    const dash = `${+(strokeWidth * 12).toFixed(6)} ${+(strokeWidth * 8).toFixed(6)}`
    return '<style>'
        + `${scope}.line{fill:none;stroke:black;stroke-width:${strokeWidth};`
        + 'stroke-linecap:round;stroke-linejoin:round}'
        + `${scope}.hidden{stroke:#888;stroke-dasharray:${dash}}`
        // Opaque face fills, emitted only by the 'painter' HLR strategy: they exist to cover
        // the shapes drawn before them, which is that strategy's entire occlusion mechanism.
        + `${scope}.fill{fill:#fff;stroke:none}`
        + '</style>'
}

/** Frame a box: pad it, optionally square it, and render the viewBox attribute value. */
function viewBoxFor(box: Box2D, padding: number, square: boolean, decimals: number): string
{
    let { minX, minY, maxX, maxY } = box
    let w = maxX - minX
    let h = maxY - minY

    // A degenerate drawing (a single straight line, or nothing) still needs a sane frame.
    if (!(w > 0)) { const c = (minX + maxX) / 2; w = Math.max(h, 1); minX = c - w / 2 }
    if (!(h > 0)) { const c = (minY + maxY) / 2; h = Math.max(w, 1); minY = c - h / 2 }

    if (square)
    {
        const side = Math.max(w, h)
        minX -= (side - w) / 2
        minY -= (side - h) / 2
        w = side
        h = side
    }

    const pad = Math.max(w, h) * padding
    minX -= pad; minY -= pad; w += 2 * pad; h += 2 * pad

    const f = (n: number) => +n.toFixed(decimals)
    return `${f(minX)} ${f(minY)} ${f(w)} ${f(h)}`
}

//// CURVE COLLECTION ////

interface PreparedCurve
{
    curve: any
    box: Box2D
    /** In the projection's 'hidden' group — occluded edges. */
    isHidden: boolean
}

/** A Shape a drawing can write out as a FACE: a Mesh or Polygon lying on a plane parallel to
 *  XY — what flatten() answers with. It carries exactly the drawing its outline would, and
 *  was previously dropped by every exporter here, so a footprint-only script got no drawing
 *  and no thumbnail at all.
 *
 *  A shape with real height is NOT one: drawn from above it collapses to a line, which is
 *  what the projections (isometry/elevation/section) exist to avoid.
 *
 *  Duck-typed rather than `instanceof meshup.Mesh`: this module draws for either kernel and
 *  so never commits to one's classes. */
export function isDrawableFace(shape: any): boolean
{
    return (shape?.type === 'Mesh' || shape?.type === 'Polygon') && shape.isFlatOnXY?.() === true
}

/** Every Shape of a collection that draws as a face. */
export function drawableFaces(collection: any): Array<any>
{
    const shapes = collection?.shapes?.() ?? []
    return (Array.isArray(shapes) ? shapes : []).filter(isDrawableFace)
}

/** Flatten a ShapeCollection into renderable shapes, tagged by projection group.
 *
 *  Curves AND flat faces — see isDrawableFace().
 *
 *  NOTE: the 'silhouette' group tags the SAME Curve objects as 'visible' (it is a
 *  classification, not a separate edge set), so it must never be emitted as its own
 *  path list — that would draw every silhouette edge twice.
 */
function prepareCurves(collection: any): Array<PreparedCurve>
{
    const curveList: Array<any> = collection?.curves?.()?.toArray?.()
        ?? collection?.curves?.()
        ?? []

    const curves: Array<any> = [...drawableFaces(collection), ...(Array.isArray(curveList) ? curveList : [])]

    // Ask for the 'hidden' group only when it is actually there: ShapeCollection.group()
    // logs an ERROR for a missing group, and it is missing in both common cases — authored
    // 2D geometry has no groups at all, and a projection taken with hidden lines off only
    // has 'visible'/'silhouette'. That console error is exactly the kind of noise that
    // makes a working thumbnail look like a failed one. Read through `_groups` rather than
    // importing meshup, which this module deliberately does not do at runtime.
    const groups = collection?._groups
    const hiddenGroup = (groups?.has ? groups.has('hidden') : true) ? collection?.group?.('hidden') : undefined
    const hiddenSet = new Set<any>(hiddenGroup?.toArray?.() ?? [])

    const out: Array<PreparedCurve> = []
    for (const curve of curves)
    {
        const box = curveBoxSVG(curve)
        if (!box) continue
        out.push({ curve, box, isHidden: hiddenSet.has(curve) })
    }
    return out
}

//// DOCUMENT ASSEMBLY ////

/** A set of SVG elements that belong together, with the box they occupy in SVG coordinates.
 *
 *  This is the whole contract between what DRAWS (a geometry kernel, the annotator, a view's
 *  caption) and what FRAMES (the assembler below). A contributor emits element strings and
 *  says how much room they take; it never decides a viewBox, a stylesheet or a line weight —
 *  those are properties of the document, and a document has exactly one of each. */
export interface SVGLayer
{
    elements: Array<string>
    /** In SVG coordinates (y already flipped). Null for elements that take no room of their
     *  own — a caption drawn in page space, say — which then never grow the frame. */
    box: Box2D | null
    /** Wrapped in `<g class="…">` when given, so a layer can be styled or found as a whole. */
    cssClass?: string
}

/** How thick the lines are drawn.
 *   - `device`: pinned to screen pixels via vector-effect, whatever the model scale. Right
 *     for previews and thumbnails, where the drawing is fitted to an unknown box.
 *   - `mm`: a real width on paper. Right for a document view, which knows its scale
 *     (`unitsPerMm` = model units per page millimeter), so a 0.25mm line is 0.25mm. */
export type SVGStroke =
    | { mode: 'device', width?: number }
    | { mode: 'mm', widthMm: number, unitsPerMm: number }
    /** A width in MODEL units. For a drawing with no known scale, where the only sensible
     *  weight is one derived from the drawing's own size. */
    | { mode: 'units', width: number }

/** How the drawing is framed.
 *   - `fit`: the box, padded — the drawing decides its own scale.
 *   - `scale`: an imposed scale. The viewBox spans exactly the page area the drawing is
 *     given (`wMm` x `hMm` at `unitsPerMm`), anchored on the box per `align`, so the drawing
 *     comes out at that scale and anything outside is simply outside the frame. */
export type SVGFrame =
    | { mode: 'fit', padding?: number, square?: boolean, /** extra room in MODEL units */ margin?: number }
    | { mode: 'scale', unitsPerMm: number, wMm: number, hMm: number, align?: [SVGAlignH, SVGAlignV],
        /** extra room in MODEL units */ margin?: number }

export type SVGAlignH = 'left' | 'center' | 'right'
export type SVGAlignV = 'top' | 'center' | 'bottom'

export interface BuildSVGDocumentOptions
{
    layers: Array<SVGLayer>
    stroke?: SVGStroke
    frame?: SVGFrame
    units?: ModelUnits
    title?: string
    precision?: number
    /** Scope the stylesheet to `.<scoped>` and wrap the content in it. A document page holds
     *  several drawings, and an unscoped `.line{stroke-width:…}` from one of them applies to
     *  all of the others — last one wins, for the browser and for svg2pdf alike. */
    scoped?: string
    /** Extra `data-*` attributes on the root element. */
    data?: Record<string, string | number>
}

/** Frame a set of layers into one SVG document — the single writer of an Archiyou drawing.
 *  Returns null when there is nothing to draw. */
export function buildSVGDocument(o: BuildSVGDocumentOptions): string | null
{
    const layers = (o.layers ?? []).filter(l => l && l.elements?.length > 0)
    if (layers.length === 0) return null

    let box: Box2D | null = null
    for (const l of layers) box = unionBox(box, l.box)
    if (!box) return null

    const size = Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1
    const decimals = o.precision ?? precisionForSize(size)

    const frame: SVGFrame = o.frame ?? { mode: 'fit' }
    // The frame owns the margin, not the layer that needs it: a dimension's value text is
    // quoted in page millimeters and only the frame knows the scale. It is added here rather
    // than to `box` so `data-extents` below keeps describing the drawing itself.
    /*  The margin is room the CONTENT needs but does not report: a dimension line's value
        text sits at the middle of the line and its arrowheads straddle the ends, so both
        stick out past the line's own box. It is quoted in page millimeters and only the frame
        knows the scale, so the frame adds it — to the box used for FRAMING, never to `box`
        itself, which goes on describing the drawing (see data-extents below).

        It applies to a scaled frame just as much as to a fitted one. Leaving it out there
        anchored the drawing flush against the frame and cut every label and arrowhead on the
        leading edges; the scale is unaffected either way, since only the window MOVES. */
    const framed = frame.margin
                        ? { minX: box.minX - frame.margin, minY: box.minY - frame.margin,
                            maxX: box.maxX + frame.margin, maxY: box.maxY + frame.margin }
                        : box
    const viewBox = (frame.mode === 'scale')
                        ? scaledViewBox(framed, frame, decimals)
                        : viewBoxFor(framed, frame.padding ?? DEFAULT_PADDING, frame.square === true, decimals)

    const stroke: SVGStroke = o.stroke ?? { mode: 'device' }
    const scope = o.scoped ? `.${o.scoped} ` : ''
    const style = (stroke.mode === 'device')
                    ? stylesheet(stroke.width ?? DEFAULT_STROKE_WIDTH, scope)
                    : stylesheetMm(
                        +(stroke.mode === 'mm' ? stroke.widthMm * stroke.unitsPerMm : stroke.width).toFixed(4),
                        scope)

    const content = layers.map(l =>
        {
            const body = l.elements.join('')
            return l.cssClass ? `<g class="${escapeXML(l.cssClass)}">${body}</g>` : body
        }).join('')

    const dataAttrs = Object.entries(o.data ?? {})
                        .map(([k, v]) => ` data-${escapeXML(k)}="${escapeXML(String(v))}"`).join('')
    const unitsAttr = o.units ? ` data-units="${escapeXML(o.units)}"` : ''
    const titleElem = o.title ? `<title>${escapeXML(o.title)}</title>` : ''

    // The drawing's own extents, before framing — a document view needs them to work out the
    // scale it can fit the drawing at, without re-deriving them from the geometry.
    const extents = [box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY]
                        .map(n => +n.toFixed(decimals)).join(' ')

    const inner = o.scoped ? `<g class="${escapeXML(o.scoped)}">${content}</g>` : content

    return '<svg xmlns="http://www.w3.org/2000/svg"'
        + ` viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img"`
        + `${unitsAttr} data-extents="${extents}"${dataAttrs}>`
        + titleElem
        + style
        + inner
        + '</svg>'
}

/** The viewBox for an imposed scale: exactly the page area the drawing is given, in model
 *  units, anchored on the drawing per `align` (default: centered). */
function scaledViewBox(box: Box2D, frame: Extract<SVGFrame, { mode: 'scale' }>, decimals: number): string
{
    const w = frame.wMm * frame.unitsPerMm
    const h = frame.hMm * frame.unitsPerMm
    const [alignH, alignV] = frame.align ?? ['center', 'center']

    const slack = (available: number, used: number, at: 'start' | 'middle' | 'end') =>
        at === 'start' ? 0 : at === 'end' ? available - used : (available - used) / 2

    const x = box.minX - slack(w, box.maxX - box.minX, alignH === 'left' ? 'start' : alignH === 'right' ? 'end' : 'middle')
    // SVG's y axis points down, so 'top' is the START of the box in this space
    const y = box.minY - slack(h, box.maxY - box.minY, alignV === 'top' ? 'start' : alignV === 'bottom' ? 'end' : 'middle')

    const f = (n: number) => +n.toFixed(decimals)
    return `${f(x)} ${f(y)} ${f(w)} ${f(h)}`
}

//// PUBLIC API ////

/** Serialize a ShapeCollection of 2D curves to one SVG document.
 *  Returns null when there is nothing to draw. */
export function buildSVG(collection: any, options?: toSVGOptions): string | null
{
    return buildSVGFromPrepared(prepareCurves(collection), options ?? {})
}

function buildSVGFromPrepared(prepared: Array<PreparedCurve>, options: toSVGOptions): string | null
{
    const includeHidden = options.hidden !== false
    const drawn = includeHidden ? prepared : prepared.filter((p) => !p.isHidden)
    if (drawn.length === 0) return null

    let box: Box2D | null = null
    for (const p of drawn) box = unionBox(box, p.box)
    if (!box) return null

    const size = Math.max(box.maxX - box.minX, box.maxY - box.minY)
    const decimals = options.precision ?? precisionForSize(size)
    // Collinear tolerance = the coordinate rounding step, so simplification can only
    // remove points that rounding was about to collapse onto the line anyway.
    const tol = size / PRECISION_TARGET

    const elements: Array<string> = []
    for (const p of drawn)
    {
        const raw = p.curve?.toSVGElem?.(p.isHidden ? 'line hidden' : 'line')
        if (typeof raw !== 'string' || !raw) continue
        elements.push(compactElement(raw, decimals, tol))
    }
    if (elements.length === 0) return null

    // A preview is a drawing like any other: same assembler, different dials. It is fitted
    // into an unknown box on a screen, so the ink is theme-aware and pinned to device pixels,
    // and there are no annotations — a dimension line in a 40px list icon is noise.
    return buildSVGDocument({
        layers: [{ elements, box }],
        stroke: { mode: 'device', width: options.strokeWidth ?? DEFAULT_STROKE_WIDTH },
        frame: { mode: 'fit', padding: options.padding ?? DEFAULT_PADDING, square: options.square === true },
        precision: decimals,
        units: options.units,
        title: options.title,
    })
}

/** Hidden-line-project a collection of meshes to 2D curves.
 *
 *  Takes the ShapeCollection rather than a mesh array so this module needs no runtime
 *  import of meshup (a type-only dependency, like DXFExporter) — the caller already
 *  holds one via `scene().shapes().meshes()`.
 *
 *  Does NOT mutate the scene: it calls the undecorated _iso()/_elevation(). See the header. */
export function projectMeshes(meshCollection: any, options?: toProjectionSVGOptions): any
{
    if (!meshCollection || meshCollection.length === 0) return null

    const o = options ?? {}
    const samples = o.samples ?? 16
    const featureAngle = o.featureAngle ?? 10
    const hiddenLines = o.hidden !== false

    const view = o.view ?? 'iso'
    // Which hidden-line algorithm to run. Undefined means the kernel default
    // ('raycast'), so nothing changes for a caller that does not ask.
    const viewOpts = { strategy: o.strategy, fallback: o.fallback }
    if (!o.cam && view !== 'iso')
    {
        return meshCollection._elevation(view, hiddenLines, false, samples, featureAngle, viewOpts)
    }
    return meshCollection._iso(o.cam ?? DEFAULT_CAM, hiddenLines, false, samples, featureAngle, viewOpts)
}

/** Projection + serialization in one step. Null when there are no meshes / nothing visible. */
export function buildProjectionSVG(meshCollection: any, options?: toProjectionSVGOptions): string | null
{
    const projected = projectMeshes(meshCollection, options)
    if (!projected) return null
    return buildSVG(projected, options)
}

/**
 * Size-capped projection SVG for use as a thumbnail or list icon.
 *
 * Degradation ladder, re-measuring after each step:
 *   0. base render (coarse projection settings, relative precision, hidden lines off by default)
 *   1. drop the 'hidden' group
 *   2. one decimal less precision
 *   3. cull: keep the largest curves that fit the budget (always converges)
 *   4. still over hardMaxBytes → null, and the caller shows a placeholder icon
 *
 * Returning null rather than emitting a broken or enormous asset is deliberate: a missing
 * thumbnail degrades to the existing placeholder, a 3MB one degrades the whole list.
 */
export function buildThumbnailSVG(meshCollection: any, options?: ThumbnailSVGOptions): ThumbnailSVGResult | null
{
    const o = options ?? {}
    const projected = projectMeshes(meshCollection, {
        ...o,
        samples: o.samples ?? THUMB_SAMPLES,
        featureAngle: o.featureAngle ?? THUMB_FEATURE_ANGLE,
        // Only pay for hidden-line computation when hidden lines were actually asked for.
        hidden: o.hidden === true,
    })
    if (!projected) return null
    return thumbnailFromPrepared(prepareCurves(projected), o)
}

/**
 * As {@link buildThumbnailSVG}, but for a scene that has no meshes to project: the 2D
 * curves the script authored ARE the drawing.
 *
 * Without this a 2D-only script — a plate layout, a nesting sheet, anything built from
 * rect/circle/offset — got no thumbnail at all, because the thumbnail path only ever
 * consumed a hidden-line projection of 3D geometry. Those scripts are a large share of the
 * library, and their preview is exactly what `toSVG()` would draw.
 *
 * `view`/`cam` do not apply here (there is nothing to project, so the geometry is taken as
 * it lies in XY); everything else — square framing, the byte budget and its degradation
 * ladder — is identical, so both kinds of thumbnail are interchangeable to a caller.
 */
export function buildThumbnailSVGFromCurves(collection: any, options?: ThumbnailSVGOptions): ThumbnailSVGResult | null
{
    return thumbnailFromPrepared(prepareCurves(collection), options ?? {})
}

/** The size-capped serialization + degradation ladder, shared by both thumbnail entry
 *  points. Everything above this line decides WHAT to draw; this decides how to fit it. */
function thumbnailFromPrepared(prepared: Array<PreparedCurve>, o: ThumbnailSVGOptions): ThumbnailSVGResult | null
{
    const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES
    const hardMaxBytes = Math.max(o.hardMaxBytes ?? DEFAULT_HARD_MAX_BYTES, maxBytes)

    if (prepared.length === 0) return null

    const base: toSVGOptions = {
        padding: o.padding, square: o.square !== false, precision: o.precision,
        strokeWidth: o.strokeWidth, title: o.title, units: o.units,
        hidden: o.hidden === true,
    }

    const degraded: Array<ThumbnailDegradeStep> = []

    const attempt = (curves: Array<PreparedCurve>, opts: toSVGOptions) =>
    {
        const svg = buildSVGFromPrepared(curves, opts)
        return svg ? { svg, bytes: byteLength(svg), curves: curves.length } : null
    }

    // 0. base
    let best = attempt(prepared, base)
    if (!best) return null
    if (best.bytes <= maxBytes) return { ...best, degraded }

    // 1. drop hidden lines (a no-op when they were already off)
    if (base.hidden)
    {
        base.hidden = false
        degraded.push('hidden')
        best = attempt(prepared, base) ?? best
        if (best.bytes <= maxBytes) return { ...best, degraded }
    }

    // 2. one decimal less
    const drawn = base.hidden ? prepared : prepared.filter((p) => !p.isHidden)
    let box: Box2D | null = null
    for (const p of drawn) box = unionBox(box, p.box)
    const currentPrecision = base.precision
        ?? precisionForSize(box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 1)
    if (currentPrecision > 0)
    {
        base.precision = currentPrecision - 1
        degraded.push('precision')
        best = attempt(prepared, base) ?? best
        if (best.bytes <= maxBytes) return { ...best, degraded }
    }

    // 3. cull the smallest curves — they contribute the least at icon size
    const ranked = [...drawn].sort((a, b) => boxDiagonal(b.box) - boxDiagonal(a.box))
    let lo = 1, hi = ranked.length, keep = 0
    while (lo <= hi)
    {
        const mid = (lo + hi) >> 1
        const trial = attempt(ranked.slice(0, mid), base)
        if (trial && trial.bytes <= maxBytes) { keep = mid; lo = mid + 1 }
        else { hi = mid - 1 }
    }
    if (keep > 0 && keep < ranked.length)
    {
        const culled = attempt(ranked.slice(0, keep), base)
        if (culled) { degraded.push('cull'); return { ...culled, degraded } }
    }

    // 4. give up rather than store something unusable
    return best.bytes <= hardMaxBytes ? { ...best, degraded } : null
}

/** Byte length of a UTF-8 string, without assuming Node's Buffer (core runs in a Worker too). */
function byteLength(s: string): number
{
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const B = (globalThis as any).Buffer
    return B ? B.byteLength(s, 'utf8') : s.length
}

export type { meshup }
