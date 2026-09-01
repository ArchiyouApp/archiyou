/**
 *  annotationLayer.ts
 *
 *  The one place that answers "which annotations belong to these Shapes, and how do they get
 *  into a drawing". Both kernels and both exporters (SVG, DXF) go through here.
 *
 *  Why it lives in core: annotations ARE core (the Annotator). meshup is a standalone package
 *  that must never import core, so it only keeps the two-sided link intact and calls the
 *  annotation's own toSVG()/toShape() structurally. brep is core's own kernel and imports
 *  this directly. Between them they used to hold two copies of this logic, which is how brep
 *  came to draw every dimension twice while meshup deduped.
 */

import type { SVGLayer } from '../modeler/SVGExporter'

/** Room around the annotations, in page millimeters, when nothing better is known.
 *  Three times the default 4mm value text — see annotationMarginMm(). */
export const ANNOTATION_MARGIN_MM = 12

/** Fallbacks for a label's reach, when the Annotator carrying the real settings cannot be
 *  reached. Mirror Annotator.LABEL_LEADER_LENGTH_MM / LABEL_TEXT_SIZE_MM. */
const LABEL_LEADER_MARGIN_MM = 8
const LABEL_TEXT_MARGIN_MM = 2.5

/** Room a drawing's annotations need beyond their own extents, in page millimeters.
 *
 *  A dimension line reports the box of the LINE. Its value text sits at the middle of that
 *  line and its arrowheads straddle the ends, so both stick out past it — by an amount that
 *  follows the text size, not a fixed number of millimeters. Derived rather than fixed so
 *  that raising `annotator.DIMENSION_TEXT_SIZE_MM` cannot quietly start clipping labels;
 *  set `DIMENSION_MARGIN_MM` to pin it.
 *
 *  A LABEL reaches further still: it reports only its anchor (see Label.toShape) and hangs a
 *  text box, and sometimes a leader, off it. Pass the annotations actually being drawn and
 *  that extra room is included — but ONLY when a label is among them, so a drawing carrying
 *  nothing but dimensions is framed exactly as it always was. Called without them, this
 *  answers the dimension question alone, which is what every existing caller meant.
 *
 *  The leader is counted only when one is actually drawn. A label sitting ON the thing it
 *  names — the page's default, see AnnotatorLabel — reaches no further than its own box, and
 *  reserving a leader's length for it shrinks every drawing on the page for nothing.
 */
export function annotationMarginMm(annotator?:any, annotations?:Array<any>):number
{
    const explicit = annotator?.DIMENSION_MARGIN_MM;
    if(typeof explicit === 'number' && explicit >= 0){ return explicit }

    const textMm = annotator?.DIMENSION_TEXT_SIZE_MM;
    const dimensionMm = (typeof textMm === 'number' && textMm > 0) ? textMm * 3 : ANNOTATION_MARGIN_MM;

    const labels = (annotations ?? []).filter(a => a?._type === 'label');
    if(!labels.length){ return dimensionMm }

    const leaderMm = annotator?.LABEL_LEADER_LENGTH_MM;
    const labelTextMm = annotator?.LABEL_TEXT_SIZE_MM;

    const drawsLeader = labels.some(a => a.line && !a._isLabelOnly?.());
    const reachMm = !drawsLeader ? 0
        : labels.reduce((longest:number, a:any) =>
            Math.max(longest, (typeof a.length === 'number' && a.length > 0) ? a.length
                : (typeof leaderMm === 'number' && leaderMm > 0) ? leaderMm
                : LABEL_LEADER_MARGIN_MM), 0);

    const labelMm = reachMm
                  + ((typeof labelTextMm === 'number' && labelTextMm > 0) ? labelTextMm : LABEL_TEXT_MARGIN_MM) * 2;

    return Math.max(dimensionMm, labelMm);
}

/** Annotations linked to a Shape or a ShapeCollection of EITHER kernel, deduped.
 *
 *  The same annotation is reachable from both ends — a dimension line links itself to the
 *  Shape it measures (DimensionLine.link) and the Annotator adds it to the collection it
 *  dimensioned — so the lists overlap by design and must be merged, not concatenated.
 *
 *  Shapes and collections answer this differently in each kernel:
 *    - meshup Shape           → annotations() (method, over _annotations)
 *    - brep Shape             → annotations (plain array property)
 *    - both ShapeCollections  → getAnnotations() (own + member Shapes')
 */
export function collectAnnotations(o:any):Array<any>
{
    if(!o || typeof o !== 'object'){ return [] }

    const found:Array<any> = [];

    // A collection knows how to gather its members' annotations as well as its own.
    if(typeof o.getAnnotations === 'function')
    {
        const fromCollection = o.getAnnotations();
        if(Array.isArray(fromCollection)){ found.push(...fromCollection) }
    }
    else
    {
        // A single Shape. meshup exposes a method, brep a property — accept both, and read
        // the collection-ish `shapes` array too so a collection without getAnnotations()
        // (an older or foreign one) still gives up what its members carry.
        const own = (typeof o.annotations === 'function') ? o.annotations() : o.annotations;
        if(Array.isArray(own)){ found.push(...own) }

        const members = Array.isArray(o.shapes) ? o.shapes : null;
        members?.forEach((s:any) =>
        {
            const a = (typeof s?.annotations === 'function') ? s.annotations() : s?.annotations;
            if(Array.isArray(a)){ found.push(...a) }
        });
    }

    found.push(...regroupedAnnotations(o, found));

    return [...new Set(found.filter(Boolean))];
}

/** The Shapes a drawable holds, whichever kernel and shape of API it came from. */
function shapesOf(o:any):Array<any>|null
{
    const s = (typeof o?.shapes === 'function') ? o.shapes() : o?.shapes;
    if(Array.isArray(s)){ return s }
    if(Array.isArray(s?.toArray?.())){ return s.toArray() }
    return null;
}

/** The Annotator that owns the global annotation list, reached from a drawable. */
function annotatorOf(o:any, shapes:Array<any>):any
{
    const from = (x:any) => x?._modeler?.modules?.annotator ?? x?._ay?.annotator;
    return from(o) ?? shapes.map(from).find(Boolean);
}

/** Annotations that belong to this drawing but hang off a collection it no longer IS.
 *
 *  A dimension links itself to the collection it measured, not to that collection's member
 *  Shapes. group()/collection()/add() re-parent the Shapes into a NEW collection and leave
 *  the annotations behind on the old one — so the doc-pipeline idiom
 *
 *      tableTop.autoDim(...);  elevations = group(tableTop, frame)
 *
 *  drew every dimension when the view was handed `tableTop`, and none at all when it was
 *  handed `elevations`: the geometry moved and its dimensions did not follow.
 *
 *  Resolved by MEMBERSHIP rather than by the link: an annotation on another collection is
 *  this drawing's when every Shape that collection holds is in this drawing. `every`, not
 *  `some` — a view showing one beam of a dimensioned frame is not showing that frame, and
 *  should not inherit measurements that run off its edge.
 */
function regroupedAnnotations(o:any, already:Array<any>):Array<any>
{
    const shapes = shapesOf(o);
    if(!shapes || shapes.length === 0){ return [] }

    const annotator = annotatorOf(o, shapes);
    const global = annotator?.getAnnotations?.();
    if(!Array.isArray(global) || global.length === 0){ return [] }

    const seen = new Set(already);
    const mine = new Set(shapes);

    return global.filter((a:any) =>
    {
        if(!a || seen.has(a)){ return false }

        const linked = a.linkedTo;
        if(!linked){ return false }
        if(mine.has(linked)){ return true } // linked straight to a Shape of this drawing

        const linkedShapes = shapesOf(linked);
        return !!linkedShapes && linkedShapes.length > 0 && linkedShapes.every(s => mine.has(s));
    });
}

/** Draw annotations as one layer of a drawing.
 *
 *  Annotations draw THEMSELVES — they are core objects that already write SVG in the same
 *  y-flipped space the geometry is written in, and answer toShape() for their extents. This
 *  only asks them, and reports the room they need so the frame can grow: a dimension line
 *  sits OUTSIDE the geometry it measures by design, and would otherwise be cropped away.
 *
 *  @param unitsPerMm model units per page millimeter, when the drawing has a known scale —
 *      annotations size their text, arrowheads and line weight in real millimeters from it.
 *  @param drawingSize the drawing's largest side, used instead when there is no page.
 *
 *  NOTE: the box is the annotations' own extents, with no room added for the value text that
 *  sits at the middle of a dimension line. That margin is a property of the FRAME (it is
 *  quoted in page millimeters, and only the frame knows the scale), so the assembler adds it.
 */
export function annotationLayer(
    annotations:Array<any>,
    options?:{ unitsPerMm?:number, drawingSize?:number }):SVGLayer
{
    const elements:Array<string> = [];
    let box:{ minX:number, minY:number, maxX:number, maxY:number } | null = null;

    (annotations ?? []).forEach(a =>
    {
        const elem = a?.toSVG?.({ drawingSize: options?.drawingSize, unitsPerMm: options?.unitsPerMm });
        if(typeof elem !== 'string' || elem.length === 0){ return }
        elements.push(elem);

        const bb = a.toShape?.()?.bbox?.();
        const min = bb?.min?.(); const max = bb?.max?.();
        if(typeof min?.x !== 'number' || typeof max?.x !== 'number'){ return }

        // SVG's y axis points down: model y [min,max] is svg y [-max,-min]
        const b = { minX: min.x, minY: -max.y, maxX: max.x, maxY: -min.y };
        box = (!box) ? b : {
            minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY),
        };
    });

    return { elements, box, cssClass: elements.length ? 'annotations' : undefined };
}
