/**
 *  SVGExporter.ts
 *
 *  Every SVG this package emits, in one place — the sibling of DXFExporter.ts and
 *  DAEExporter.ts.
 *
 *  Four things come out of here:
 *    - `renderDrawing` — one flat, framed technical drawing from EITHER kernel, styled
 *      through the layer cascade and dimensioned by the annotator. This is what a Shape's
 *      or a document view's toSVG() ends up calling.
 *    - `buildSVG` — a ShapeCollection of 2D curves as one SVG document with a proper
 *      viewBox, padding, optional square framing and a stylesheet that works on light AND
 *      dark backgrounds.
 *    - `buildProjectionSVG` / `buildThumbnailSVG` — the scene's 3D meshes projected to 2D
 *      line-work (hidden-line removal in Rust/WASM) WITHOUT touching the scenegraph, so an
 *      export never changes what the next export sees. The thumbnail is size-capped by
 *      progressive degradation, so a pathologically dense model can never emit a
 *      multi-megabyte icon.
 *    - `sceneSVG` — the SCENE rather than a drawing: one nested `<g>` per scene node, which
 *      is what survives into Illustrator as layers, and the one thing the flat drawing
 *      assembler cannot express.
 *
 *  Everything above the kernels — framing, stylesheet, line weight, annotations, scale — is
 *  written once here rather than once per kernel. The two kernels draw differently and that
 *  is fine: meshup emits true arcs and flips y inside toSVGElem(), brep tessellates edges to
 *  polylines and mirrors the Shape first; KERNEL LINE-WORK below is where that difference is
 *  absorbed into a common SVGLayer.
 *
 *  Why this lives in core and not in the kernel: a drawing has to be taken in the plane the
 *  model is actually ON and styled through the layer cascade, and meshup knows about neither.
 *  Its own scene serializer drew every shape from `shape.style` alone — so a model styled
 *  entirely through `layer(...)` came out uniformly red — and projected by dropping z, so a
 *  wall elevation on XZ collapsed to a single horizontal line.
 *
 *  Geometry is consumed through meshup's public accessors (bbox(), curves(), group(),
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
import { detectExportFrame, drawnInPlane, isPlanFrame, planeTolerance, projectorFor, shapeBox,
    type ExportFrame, type ExportPlane } from './utils'
import { annotationLayer, annotationMarginMm, collectAnnotations } from '../annotator/annotationLayer'
import { isKernelShapeCollection } from './typeguards'

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
    /** Visibility samples per edge, `'raycast'` only. Default 16 (8 for thumbnails). */
    samples?: number
    /** Facet-boundary edges below this angle are dropped. Default 10 (20 for thumbnails). */
    featureAngle?: number
    /** Which hidden-line-removal algorithm the kernel should run.
     *
     *  - `'exact'` (default) — computes occlusion analytically. Correct endpoints,
     *    finds occluders of any size, and ignores `samples`.
     *  - `'raycast'` — samples visibility along each edge. Endpoints are
     *    approximate and an occluder narrower than the sample spacing is missed.
     *  - `'clip'` / `'painter'` — per shape, no merge into a single solid.
     *    Need convex, non-interpenetrating shapes. `'painter'` emits opaque
     *    fills, so it is unsuitable for DXF export.
     */
    strategy?: 'raycast' | 'exact' | 'clip' | 'painter'
    /** Downgrade to `'exact'` with a warning when a per-shape strategy does
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

/** A shape's bounding box in SVG coordinates. SVG's y axis points down and the model's
 *  points up, so model y [min,max] is svg y [-max,-min] — the box has to be flipped exactly
 *  like the geometry (meshup does it inside toSVGElem(), we do it here for brep), or the
 *  viewBox will not contain what it frames. */
function boxSVG(shape: any): Box2D | null
{
    const bb = shape?.bbox?.()
    if (!bb?.min || !bb?.max) return null
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

//// STYLE CASCADE ////

/** Run `body` with every shape drawn in its CASCADED style, then put the originals back.
 *
 *  What an author calls a layer is a SceneNode, and the colour and linetype set on it
 *  (`layer('diagram').color('blue').dashed()`) cascade to the shapes beneath it — resolved
 *  only at export time. meshup's toSVGElem() reads `shape.style` directly and has no channel
 *  for another style, so a shape under a blue layer drew itself in SHAPE_DEFAULT_STYLE's red
 *  and every layer colour in the model was lost on the way out.
 *
 *  The resolution is the one the DXF exporter does (see DXFExporter's LAYERS & STYLE) and the
 *  one the viewer does (GLTFBuilder): the node's effectiveStyle() with the shape's own
 *  explicit style merged on top, so a shape that colours itself still beats its layer.
 *
 *  meshup has its own version of this in SceneNode.applyStyle(), which makes the merge
 *  PERMANENT — right for handing shapes to a foreign library, wrong for an export, which has
 *  to leave the scene exactly as it found it. Hence the swap and the finally: `body()` is
 *  synchronous, so no one can observe the scene mid-swap.
 */
export function withCascadedStyles<T>(shapes: Array<any>, body: () => T): T
{
    const swapped: Array<[any, any]> = []
    shapes.forEach(shape =>
    {
        const cascaded = shape?.node?.()?.effectiveStyle?.()
        if (!cascaded) return                       // no scene node → nothing to cascade from
        cascaded.merge(shape.style?.explicitData?.() ?? {})
        swapped.push([shape, shape.style])
        shape.style = cascaded
    })

    try { return body() }
    finally { swapped.forEach(([shape, original]) => { shape.style = original }) }
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

    // Turned onto the drawing's own plane first, or a model built on XZ draws as the single
    // flat line a plan view of it really is. Copies, so nothing the caller holds moves — see
    // drawnInPlane(). The hidden-line lookup stays keyed by the original.
    const inPlane = drawnInPlane(curves, detectExportFrame(curves))

    const out: Array<PreparedCurve> = []
    for (const curve of curves)
    {
        const drawn = inPlane?.get(curve) ?? curve
        const box = boxSVG(drawn)
        if (!box) continue
        out.push({ curve: drawn, box, isHidden: hiddenSet.has(curve) })
    }
    return out
}

//// KERNEL LINE-WORK ////

/** Which drawing group each curve belongs to, as meshup's own exporter decides it: a curve
 *  can be in several, later ones win, and the per-shape provenance tags (`shape-0`, …) only
 *  fill a gap — they say where a curve came from, not how to draw it. */
function meshGroupClasses(collection: any): Map<any, string>
{
    const curveToGroup = new Map<any, string>()
    collection?._groups?.forEach?.((groupCol: any, groupName: string) =>
    {
        const isProvenance = /^shape-\d+$/.test(groupName)
        groupCol?.toArray?.().forEach((shape: any) =>
        {
            if (isProvenance && curveToGroup.has(shape)) return
            curveToGroup.set(shape, groupName)
        })
    })
    return curveToGroup
}

/** The 2D line-work of a mesh-kernel Shape or ShapeCollection: its curves, and the faces
 *  lying flat on the XY plane (see drawableFaces) — a flattened footprint is a collection of
 *  Meshes, and used to come out of a view completely blank. */
function meshDrawableLayer(collection: any, plane: ExportPlane): SVGLayer
{
    const drawables = [...drawableFaces(collection), ...(collection?.curves?.()?.toArray?.() ?? [])]
    const groups = meshGroupClasses(collection)

    // The drawing's own plane, and a turned copy of anything that is not on XY already. The
    // copies are what gets serialized; the originals stay the key for everything looked up
    // per shape (its drawing group) and are what the caller still holds.
    const frame = detectExportFrame(drawables, plane)
    const copies = drawnInPlane(drawables, frame)
    const drawn = drawables.map((shape: any) => copies?.get(shape) ?? shape)

    const elements: Array<string> = []
    let box: Box2D | null = null

    // Drawn in the cascaded style: this layer already writes a shape's own colour inline, so
    // dropping the colour its LAYER gave it was the odd one out.
    withCascadedStyles(drawn, () =>
    {
        drawables.forEach((shape: any, i: number) =>
        {
            const groupName = groups.get(shape)
            const cssClass = 'line' + (groupName ? ` ${groupName}` : '')
            const elem = drawn[i]?.toSVGElem?.(cssClass, { omitDefaults: true, nonScalingStroke: false })
            if (typeof elem !== 'string' || !elem) return
            elements.push(elem)
            box = unionBox(box, boxSVG(drawn[i]))
        })
    })

    return { elements, box, frame }
}

/** The 2D line-work of a brep Shape or ShapeCollection.
 *
 *  brep writes a `<path>` per Edge and mirrors the Shape into SVG space beforehand (meshup
 *  flips inside toSVGElem instead). Each mirrored Edge keeps pointing at the Shape it came
 *  from: that link is where its styling is read from, since an Edge of a styled Wire carries
 *  no style of its own. */
function brepDrawableLayer(collection: any, all: boolean): SVGLayer
{
    const edges = collection?._get2DXYShapeEdges?.(all)

    const elements: Array<string> = []
    let box: Box2D | null = null

    edges?.forEach?.((edge: any) =>
    {
        const flipped = edge._mirroredY(0)
        flipped._parent = edge._parent ?? edge

        const elem = flipped?.toSVG?.()
        if (typeof elem !== 'string' || !elem) return
        elements.push(elem)

        // already mirrored, so this box is in SVG space as it stands
        const bb = flipped?.bbox?.()
        const min = bb?.min?.(); const max = bb?.max?.()
        if (typeof min?.x === 'number' && typeof max?.x === 'number')
        {
            box = unionBox(box, { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y })
        }
    })

    return { elements, box }
}

/** True for a brep Shape/ShapeCollection — it is the kernel that mirrors before drawing. */
function isBrep(o: any): boolean
{
    return typeof o?._get2DXYShapeEdges === 'function' || o?.mode === 'brep'
}

/** A single Shape, as a collection of one.
 *
 *  Both kernels' line-work extraction is a collection operation (curves(), the 2D-XY edge
 *  filter), and a Shape has neither. A view handed a Shape directly — `.shapes(rect)` rather
 *  than `.shapes(collection(rect))` — therefore yielded no line-work at all, which the
 *  renderer read as "nothing to scale" and quietly fell back to drawing it unscaled.
 *
 *  The collection has to come from the shape's OWN kernel: a brep Shape in a meshup
 *  collection draws nothing, and the reverse is just as empty. */
function asCollection(o: any): any
{
    if (isKernelShapeCollection(o)) return o

    const Col = o?._modeler?.classes?.ShapeCollection
    if (typeof Col === 'function')
    {
        try { return new Col(o) } catch { /* fall through to the shape itself */ }
    }
    return o
}

/** The drawable 2D line-work of a Shape or ShapeCollection from EITHER kernel.
 *  @param all include Shapes that are hidden (brep only — meshup draws what it is given)
 */
export function drawableLayer(o: any, options?: { all?: boolean, plane?: ExportPlane }): SVGLayer
{
    if (!o) return { elements: [], box: null }

    const collection = asCollection(o)
    return isBrep(collection)
            ? brepDrawableLayer(collection, options?.all === true)
            : meshDrawableLayer(collection, options?.plane ?? 'auto')
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
    /** The model plane this line-work was drawn in. Carried so anything drawn ALONGSIDE it
     *  later — a view's annotations, re-drawn per page — lands in the same plane. */
    frame?: ExportFrame | null
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

    // Settings left undefined — the camera, samples, feature angle and hidden-line
    // algorithm — take meshup's own defaults, so there is one set of them.
    const settings = {
        hiddenLines: o.hidden !== false,
        samples: o.samples,
        featureAngle: o.featureAngle,
        method: o.strategy,
        fallback: o.fallback,
    }
    const view = o.view ?? 'iso'
    if (!o.cam && view !== 'iso')
    {
        return meshCollection._elevation(view, settings)
    }
    return meshCollection._iso(o.cam, settings)
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

//// ONE DRAWING, EITHER KERNEL ////

export interface RenderDrawingOptions
{
    /** Draw the linked dimension lines and labels. Default true. */
    annotations?: boolean
    /** Include Shapes that are hidden (brep). Default false. */
    all?: boolean
    /** Model units per page millimeter, when the drawing is going somewhere with a known
     *  scale (a document view). Sizes annotations and line weight in real millimeters. */
    unitsPerMm?: number
    /** Line weight on paper. Default DRAWING_LINE_WIDTH_MM. Only used with `unitsPerMm`. */
    lineWidthMm?: number
    /** Framing. Default: the drawing's own extents plus room for its dimension text. */
    frame?: SVGFrame
    /** Blank margin on every side, as a fraction of the drawing's largest side. Default none:
     *  a technical drawing is placed by its frame, not floated in air. */
    padding?: number
    /** Normalize into a square viewBox, so one asset serves both 1:1 and wide slots. */
    square?: boolean
    /** Which model plane the drawing is taken from. Default 'auto' — detected from the
     *  geometry, so an elevation modelled on XZ draws as an elevation. See ./utils. */
    plane?: ExportPlane
    /** Confine the stylesheet to this class — see BuildSVGDocumentOptions.scoped. */
    scoped?: string
    units?: ModelUnits
    title?: string
}

/** Line weight on paper, in millimeters. A normal technical drawing weight. */
export const DRAWING_LINE_WIDTH_MM = 0.25

/** The width, in model units, of a drawing with no scale to speak of.
 *
 *  A drawing that is about to be fitted into a view has no size of its own yet, so the only
 *  weights that make sense are relative to the drawing itself. This is the view width the
 *  old kernel exporters implicitly assumed (drawingSize/800 for a 0.25mm line), written down
 *  rather than left in a magic divisor. */
const IMPLIED_VIEW_WIDTH_MM = 200

/** Draw a Shape or ShapeCollection of either kernel as one SVG document.
 *  Returns null when there is nothing to draw. */
export function renderDrawing(o: any, options?: RenderDrawingOptions): string | null
{
    return renderDrawingFromLayer(drawableLayer(o, { all: options?.all, plane: options?.plane }), o, options)
}

/** The same, from line-work that has already been drawn.
 *
 *  A document view re-draws its annotations for every page it lands on — they are sized in
 *  page millimeters, so they depend on the view's scale — while the geometry does not change
 *  at all. Handing back the layer means the drawing is serialized ONCE per view, however many
 *  times it is framed: the difference between a 300ms page and a 3s one.
 *
 *  @param annotationSource the Shapes whose annotations to draw (the geometry layer is only
 *      strings by now, and no longer knows what it was drawn from).
 */
export function renderDrawingFromLayer(
    geometry: SVGLayer,
    annotationSource: any,
    options?: RenderDrawingOptions): string | null
{
    const o = annotationSource

    const size = geometry.box
                    ? Math.max(geometry.box.maxX - geometry.box.minX, geometry.box.maxY - geometry.box.minY) || 1
                    : 1

    const layers: Array<SVGLayer> = [geometry]

    let annotated = false
    if (options?.annotations !== false)
    {
        const annotations = annotationLayer(collectAnnotations(o), {
            unitsPerMm: options?.unitsPerMm,
            drawingSize: size,
            // A dimension has to travel to the drawing's plane with the geometry it measures,
            // or it lands flat on the floor beside an elevation. The layer carries the frame
            // it was drawn in so a view that re-draws its annotations per page still agrees
            // with line-work it serialized once.
            projector: isPlanFrame(geometry.frame ?? null) ? undefined : projectorFor(geometry.frame!),
        })
        annotated = annotations.elements.length > 0
        layers.push(annotations)
    }

    /*  Room for the value text at the middle of a dimension line — a few characters wide.
        In real page millimeters when the scale is known; otherwise a fraction of the drawing,
        since a flat number of model units cropped anything bigger than a small part. */
    const margin = !annotated ? 0
                    : (options?.unitsPerMm) ? options.unitsPerMm * annotationMarginMm(o?._modeler?.modules?.annotator)
                    : Math.max(10, size / 30)

    const stroke: SVGStroke = (options?.unitsPerMm)
        ? { mode: 'mm', widthMm: options?.lineWidthMm ?? DRAWING_LINE_WIDTH_MM, unitsPerMm: options.unitsPerMm }
        // No scale known: a weight relative to the drawing, which is the same thing once the
        // drawing is fitted to a view — the fit is (view/drawing) and this is (drawing/N).
        : { mode: 'units', width: size / (IMPLIED_VIEW_WIDTH_MM / (options?.lineWidthMm ?? DRAWING_LINE_WIDTH_MM)) }

    return buildSVGDocument({
        layers,
        stroke,
        // An explicitly framed drawing (a view at a fixed scale) still needs the room its
        // annotations do not report — see buildSVGDocument.
        frame: options?.frame
                ? { ...options.frame, margin: (options.frame as any).margin ?? margin }
                : { mode: 'fit', padding: options?.padding ?? 0, square: options?.square === true, margin },
        scoped: options?.scoped,
        units: options?.units ?? o?._modeler?.units?.(),
        title: options?.title,
    })
}

//// THE SCENE AS SVG ////

/*  The scene rather than a drawing: one nested `<g>` per scene node, shapes drawn inside the
 *  node that holds them. That hierarchy is the point — it is what survives into Illustrator
 *  as layers — and it is the one thing the drawing assembler above, which frames one flat
 *  drawing, cannot express. The output shape is meshup's, element for element, so nothing
 *  downstream can tell. */

/** Room left around the drawing, as a fraction of its largest side. */
const SCENE_PADDING = 0.05

const fmt = (n: number): number => +n.toFixed(6)

/** Is this shape flat enough to draw — on the drawing's plane, or one parallel to it?
 *
 *  Deliberately not `is2D()`: that asks for a bbox extent of exactly 0, which a shape turned
 *  onto the drawing plane never has (a quarter turn is cos/sin, not an axis swap) and which a
 *  shape the SCRIPT rotated does not have either. Parallel planes all count — an SVG is a
 *  projection, so geometry off the plane still belongs in the picture, exactly as it did when
 *  every drawing was a plan. */
function isDrawable(shape: any, frame: ExportFrame, tol: number): boolean
{
    const box = shapeBox(shape)
    if (!box) return false
    const n = frame.normal
    const extent = Math.abs((box.max.x - box.min.x) * n.x)
        + Math.abs((box.max.y - box.min.y) * n.y)
        + Math.abs((box.max.z - box.min.z) * n.z)
    return extent <= tol
}

/** `<g>` for one node and everything under it, shapes taken from `drawn`. */
function nodeElem(node: any, drawn: Map<any, any>): string
{
    const visible = node.effectiveStyle?.()?.visible !== false
    const lines: string[] = [`<g id="${node.name}"${visible ? '' : ' display="none"'}>`]

    const shape = node.shape?.()
    const target = shape ? drawn.get(shape) : undefined
    if (target?.toSVGElem) { lines.push('  ' + target.toSVGElem()) }

    node.children?.().forEach((child: any) =>
    {
        lines.push(...nodeElem(child, drawn).split('\n').map((l: string) => '  ' + l))
    })

    lines.push('</g>')
    return lines.join('\n')
}

/** The scene under `root` as a self-contained SVG, or null when it holds nothing drawable.
 *
 *  @param plane forces a view instead of detecting one. Default 'auto'.
 */
export function sceneSVG(root: any, plane: ExportPlane = 'auto'): string | null
{
    const shapes: Array<any> = root?.shapes?.()?.toArray?.() ?? []
    const frame = detectExportFrame(shapes, plane)
    if (!frame) return null

    const boxes = shapes.map(shapeBox).filter((b): b is NonNullable<ReturnType<typeof shapeBox>> => b !== null)
    const tol = planeTolerance(boxes)
    const drawable = shapes.filter(s => isDrawable(s, frame, tol))
    if (drawable.length === 0) return null

    // Turned onto the drawing plane, as throwaway copies — nothing in the scene moves. The
    // map is keyed by the original, which is what the node still holds.
    const copies = drawnInPlane(drawable, frame)
    const drawn = new Map<any, any>(drawable.map(s => [s, copies?.get(s) ?? s]))

    return withCascadedStyles([...drawn.values()], () =>
    {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
        drawn.forEach(shape =>
        {
            const bb = shapeBox(shape)
            if (!bb) return
            minX = Math.min(minX, bb.min.x)
            maxX = Math.max(maxX, bb.max.x)
            minY = Math.min(minY, -bb.max.y)   // SVG's y axis points down
            maxY = Math.max(maxY, -bb.min.y)
        })
        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1 }

        const w = maxX - minX
        const h = maxY - minY
        const pad = Math.max(w, h) * SCENE_PADDING || 1

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX - pad)} ${fmt(minY - pad)} `
            + `${fmt(w + 2 * pad)} ${fmt(h + 2 * pad)}">\n${nodeElem(root, drawn)}\n</svg>`
    })
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
