/**
 *  svgLayers.ts
 *
 *  Turns the geometry of EITHER kernel into an SVGLayer — element strings plus the room they
 *  take — for the one assembler in SVGExporter.buildSVGDocument().
 *
 *  The two kernels draw differently and that is fine: meshup emits true arcs and flips y
 *  inside toSVGElem(), brep tessellates edges to polylines and mirrors the Shape first. This
 *  module is where that difference is absorbed, so everything above it — framing, stylesheet,
 *  line weight, annotations, scale — is written once instead of once per kernel.
 */

import { buildSVGDocument, drawableFaces, type SVGLayer, type SVGFrame, type SVGStroke } from './SVGExporter'
import { annotationLayer, collectAnnotations, annotationMarginMm } from '../annotator/annotationLayer'
import type { ModelUnits } from './types'
import { isKernelShapeCollection } from './typeguards'

type Box2D = { minX: number, minY: number, maxX: number, maxY: number }

function unionBox(a: Box2D | null, b: Box2D | null): Box2D | null
{
    if (!a) return b
    if (!b) return a
    return {
        minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    }
}

/** A shape's box in SVG coordinates. SVG's y axis points down, so model y [min,max] is
 *  svg y [-max,-min] — the box must be flipped exactly like the geometry, or the frame will
 *  not contain what it frames. */
function boxSVG(shape: any): Box2D | null
{
    const bb = shape?.bbox?.()
    if (!bb?.min || !bb?.max) return null
    const min = bb.min(); const max = bb.max()
    if (![min?.x, min?.y, max?.x, max?.y].every(n => typeof n === 'number' && isFinite(n))) return null
    return { minX: min.x, minY: -max.y, maxX: max.x, maxY: -min.y }
}

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
function meshDrawableLayer(collection: any): SVGLayer
{
    const drawables = [...drawableFaces(collection), ...(collection?.curves?.()?.toArray?.() ?? [])]
    const groups = meshGroupClasses(collection)

    const elements: Array<string> = []
    let box: Box2D | null = null

    drawables.forEach((shape: any) =>
    {
        const groupName = groups.get(shape)
        const cssClass = 'line' + (groupName ? ` ${groupName}` : '')
        const elem = shape?.toSVGElem?.(cssClass, { omitDefaults: true, nonScalingStroke: false })
        if (typeof elem !== 'string' || !elem) return
        elements.push(elem)
        box = unionBox(box, boxSVG(shape))
    })

    return { elements, box }
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
export function drawableLayer(o: any, options?: { all?: boolean }): SVGLayer
{
    if (!o) return { elements: [], box: null }

    const collection = asCollection(o)
    return isBrep(collection)
            ? brepDrawableLayer(collection, options?.all === true)
            : meshDrawableLayer(collection)
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
    return renderDrawingFromLayer(drawableLayer(o, { all: options?.all }), o, options)
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
