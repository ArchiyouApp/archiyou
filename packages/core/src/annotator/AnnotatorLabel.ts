/** Label Class
 *
 *  A free-text annotation anchored at a Shape's center. It has two renderers, and they
 *  work in different units:
 *
 *    - the VIEWER draws it as an HTML/CSS element floated over the WebGL canvas, reached
 *      through Annotator.label().fromShape() → getAnnotationsData() → GLB root
 *      extras.annotations. There `length` is screen pixels and `angle` screen degrees,
 *      because a floating box has no other unit.
 *    - a DOCUMENT draws it into the page SVG through toSVG() below, alongside dimension
 *      lines, via annotationLayer(). There it is sized in page millimeters from the
 *      Annotator's LABEL_*_MM settings — the same contract DimensionLine.toSVG() uses — so
 *      a label reads the same on an A4 whether it points at a dowel or at a truss.
 *
 *  toSVG() is why a label reaches paper at all: BaseAnnotation.toSVG() returns null, and
 *  annotationLayer() silently drops anything falsy, so before this a labelled drawing
 *  exported without a single label on it.
 *
 *  ## What a label is made of
 *
 *      shape       the box the text sits in: 'circle' (default) or 'rect'
 *      target      what marks the far end: 'circle' (default), 'arrow', or 'none'
 *      length      how far the label sits from the anchor
 *      angle       which way, in degrees: 0 is +x, 90 is up
 *      labelOnly   just the label — no leader, no marker
 *
 *  `labelOnly` is the one setting whose DEFAULT differs between the two renderers, and it is
 *  the medium that differs: on paper a circled letter can sit straight on the part it names
 *  and a leader from a dot to it is clutter, so paper draws the label alone; in the viewer the
 *  label floats over the geometry at whatever angle the model is turned to, and without a
 *  leader nothing ties it to a part. Set it and both renderers do as they are told.
 */

import { BaseAnnotation } from './AnnotatorBaseAnnotation'
import type { LabelData, LabelOptions, LabelShape, LabelTarget } from './types'
import type { PointLike, Point, AnyShape, AnyShapeOrCollection } from '../modeler/types'
import { svgLeader, svgArrow, svgCircleMarker, svgTextLabel } from './svgPrimitives'
import { DOC_DEFAULT_SVG_FONT_FAMILY } from '../constants'

/*  Fallbacks for a label's page sizes, used only when it cannot reach an Annotator (a label
    built outside the app, a unit test). The real settings live on the Annotator, where a
    script can change them. */
const LABEL_DEFAULTS = {
    LABEL_TEXT_SIZE_MM: 2.5,
    LABEL_LINE_WIDTH_MM: 0.15,
    LABEL_LEADER_LENGTH_MM: 8,
    LABEL_MARKER_SIZE_MM: 1.5,
    LABEL_ARROW_SIZE_MM: 2,
    LABEL_CIRCLE_MAX_CHARS: 3,
    DIMENSION_TEXT_CHAR_WIDTH_FACTOR: 0.6,
    DIMENSION_TEXT_PADDING_FACTOR: 0.5,
    DIMENSION_TEXT_HEIGHT_FACTOR: 1.2,
    DIMENSION_TEXT_BACKGROUND_COLOR: 'white' as string|null,
}

/*  The view width, in millimeters, that a drawing with no known scale is assumed to be
    drawn into. It is the one number that turns the millimeter settings above into model
    units when only the drawing's own size is known: `units = drawingSize * mm / 120`.
    Chosen to agree with DimensionLine's own fallbacks (0.15mm ↔ drawingSize/800,
    1.5mm ↔ drawingSize/80), so a label and a dimension on the same unscaled drawing come
    out in proportion to each other. */
const IMPLIED_VIEW_WIDTH_MM = 120

/** How many characters still read as a circled letter. Three covers 'A', 'AA' and '999' —
 *  every label scheme a manual numbers its parts with — and stops short of prose. */
export const LABEL_CIRCLE_MAX_CHARS = 3

/** The box a label's text goes in: what the script asked for, or — when it asked for nothing —
 *  a circle for text short enough to be one and a rectangle for anything longer.
 *
 *  A circle is CIRCUMSCRIBED about the text box (see svgTextLabel), so it grows with that
 *  box's diagonal: right for 'A' or '12', a balloon for 'Front left leg'. Hence the fallback.
 *
 *  It applies to the DEFAULT only. `shape: 'circle'` asked for explicitly is honoured at any
 *  length, because a script that says so means it — the choice is only being made here because
 *  nobody made it.
 *
 *  Shared rather than duplicated: the page and the viewer have to reach the same answer for
 *  the same label, and an instructable resolves it for its own labels the same way
 *  (Instruct._resolveLabels).
 */
export function labelShapeFor(text:string, shape?:LabelShape|null,
                              maxChars:number = LABEL_CIRCLE_MAX_CHARS):LabelShape
{
    if(shape){ return shape }
    return ((text ?? '').toString().trim().length <= maxChars) ? 'circle' : 'rect';
}

export class Label extends BaseAnnotation
{
    _initialized:boolean = false;
    position:Point;                 // anchor (shape center) in model coords
    targetShape:AnyShape = null;    // the shape this label is generated from
    linkedTo:any = null;            // main parent Shape/Collection
    class:string = null;            // extra CSS class for viewer styling
    shape:LabelShape = null;        // the box the text sits in. null = decided by its length
    target:LabelTarget = 'none';    // what marks the anchor end of the leader
    labelOnly:boolean = null;       // no leader, no marker. null = let the renderer decide
    line:boolean = false;           // leader line from anchor to label box
    length:number = null;           // leader length: screen px in the viewer, page mm on paper
    offset:number = 40;             // DEPRECATED: `length`, viewer-side only
    angle:number = 90;              // leader angle in deg (0 = +x, 90 = up on screen)
    circle:boolean = false;         // DEPRECATED: `target`
    param:string = null;            // name of bound parameter

    constructor(position:PointLike=null, value?:string, options?:LabelOptions)
    {
        super('label');

        if(position != null && value != null)
        {
            this.init(position, value, options);
        }
        else
        {
            console.warn(`Label::constructor(): Label not initialized. Use init(position,value,options) or fromShape(shape,value,options) later!`);
        }
    }

    static isLabel(o:any):boolean
    {
        return (typeof o === 'object') && o?._type === 'label';
    }

    /** (Re)init label */
    init(position:PointLike, value:string, options?:LabelOptions):this
    {
        if(position == null){ throw new Error(`Label::init(): Please supply an anchor position!`); }

        // Store a real kernel Point so toData()'s toArray() works (mirrors DimensionLine)
        this.position = ((position as any)?.toArray)
                            ? position as Point
                            : new this.classes.Point(position as any);
        this.value = (value ?? '').toString();
        this._initialized = true;
        this.setOptions(options ?? {});
        return this;
    }

    setOptions(o:LabelOptions):this
    {
        this.class = o?.class ?? this.class;
        this.shape = o?.shape ?? this.shape;
        this.labelOnly = o?.labelOnly ?? this.labelOnly;

        /*  `circle:true|false` was the whole of the target once, before there was an arrow to
            choose instead, and `arrow:true` was an alias for it from further back still — from
            when the marker WAS an arrowhead. Both still work, and `arrow` now means what it
            says. `target` wins when a script sets more than one. */
        this.target = o?.target
            ?? (o?.arrow ? 'arrow' : undefined)
            ?? ((o?.circle === undefined) ? this.target : (o.circle ? 'circle' : 'none'));
        this.circle = this.target === 'circle';

        this.length = o?.length ?? o?.offset ?? this.length;
        this.offset = o?.offset ?? o?.length ?? this.offset;
        this.angle = o?.angle ?? this.angle;

        // a leader is implied when any leader option is set
        const wantsLeader = o?.length != null || o?.offset != null
            || this.target !== 'none' || o?.circle === true || o?.labelOnly === false;
        this.line = o?.line ?? (wantsLeader ? true : this.line);

        return this;
    }

    /** Centralized creation: anchor a label at the Shape's bbox center */
    fromShape(shape:AnyShape, value:string, options?:LabelOptions):this
    {
        this.targetShape = shape;
        this.linkedTo = this._getParentShape(shape) ?? shape;
        if(this.linkedTo?.addAnnotations){ this.linkedTo.addAnnotations(this); } // two-sided link
        // Vertex → its own point; everything else → bbox center (mesh + brep)
        const anchor = ((shape as any).type === 'Vertex' && (shape as any).toPoint)
                            ? (shape as any).toPoint()
                            : (shape as any).bbox().center();
        return this.init(anchor, String(value), options);
    }

    /** Recurse parents to find the main parent Shape */
    _getParentShape(s:AnyShapeOrCollection):AnyShapeOrCollection|null
    {
        if(!s || (typeof s !== 'object')){ return null; }
        return ((s as any)._parent) ? this._getParentShape((s as any)._parent) : s;
    }

    update()
    {
        if(this.linkedTo?.bbox){ this.position = this.linkedTo.bbox().center(); }
    }

    //// EXPORTS ////

    /** An annotation setting, from the Annotator when one is reachable. */
    _setting<K extends keyof typeof LABEL_DEFAULTS>(name:K):typeof LABEL_DEFAULTS[K]
    {
        const value = (this._archiyou?.annotator as any)?.[name];
        return (value === undefined) ? LABEL_DEFAULTS[name] : value;
    }

    /** This label's on-page sizes, in the units the drawing is written in.
     *
     *  Same three-way contract as DimensionLine.toSVG(): `unitsPerMm` — how many model units
     *  make one millimeter ON THE PAGE — is the exact way and comes from a document view that
     *  knows its scale. `drawingSize` is for callers with no page, and gets the same result
     *  for a drawing fitted to a view (the view scale is page/drawing and these are
     *  drawing/N, so the two cancel). Fixed model units are the one thing that cannot work:
     *  right for a 200mm part, invisible on a 12m truss. */
    _svgSizes(options?:{ drawingSize?:number, unitsPerMm?:number })
    {
        const perMm = options?.unitsPerMm;
        const drawing = options?.drawingSize;
        const inUnits = (mm:number, fallback:number) =>
            perMm ? mm * perMm
          : drawing ? drawing * mm / IMPLIED_VIEW_WIDTH_MM
          : fallback;

        return {
            fontSize:   inUnits(this._setting('LABEL_TEXT_SIZE_MM'), 1),
            strokeW:    inUnits(this._setting('LABEL_LINE_WIDTH_MM'), 0.5),
            markerD:    inUnits(this._setting('LABEL_MARKER_SIZE_MM'), 1),
            /*  The 10-unit arrow glyph scaled to the asked-for width, the way
                DimensionLine.toSVG() sizes its own heads. */
            arrowScale: inUnits(this._setting('LABEL_ARROW_SIZE_MM'), 1) / 10,
            /*  `length` is in page millimeters here and screen pixels in the viewer — one
                name for the same measurement in each renderer's own unit (see the class
                header). With neither a scale nor a drawing size there is nothing to derive
                from, so the pixel figure is at least the right order of magnitude, which
                nothing else here would be. */
            leaderLen:  inUnits(this.length ?? this._setting('LABEL_LEADER_LENGTH_MM'),
                                this.length ?? this.offset ?? 40),
        };
    }

    /** The box this label's text goes in, with the default resolved. See labelShapeFor(). */
    _shape():LabelShape
    {
        return labelShapeFor(this.value as string, this.shape,
                             this._setting('LABEL_CIRCLE_MAX_CHARS'));
    }

    /** Whether this label draws a leader and a marker at all.
     *
     *  Left unset, the answer differs by renderer, and deliberately: on paper a label can sit
     *  ON the thing it names — a circled letter over a part is unambiguous and a leader from a
     *  dot to it is clutter — while in the viewer it floats over the geometry at whatever
     *  angle the model is turned to, and without a leader there is nothing tying it to a part.
     *  So paper defaults to the label alone, and the viewer to the full callout. */
    _isLabelOnly():boolean
    {
        return this.labelOnly ?? true;      // the SVG side; the viewer applies its own default
    }

    /** Where the text sits relative to the anchor, in SVG space.
     *
     *  `angle` is read exactly as the viewer reads it — degrees, 90 = up — and SVG's y axis
     *  points down, hence the negated sine. A label with no leader has its text on the
     *  anchor, which is what the viewer's leader-less label looks like too. */
    _svgTextOffset(leaderLen:number):[number, number]
    {
        if(!this.line || this._isLabelOnly()){ return [0, 0] }
        const a = (this.angle ?? 90) * Math.PI / 180;
        return [Math.cos(a) * leaderLen, -Math.sin(a) * leaderLen];
    }

    /** Draw this label into a drawing's SVG. See the class header for the two renderers.
     *
     *  The text is NOT rotated with the leader: a dimension reads along the line it measures,
     *  but a callout is prose and reads horizontally however it is pointing. */
    toSVG(options?:{ drawingSize?:number, unitsPerMm?:number }):string
    {
        if(!this._initialized || !this.position){ return '' }

        const text = (this.value ?? '').toString();
        if(!text){ return '' }

        const { fontSize, strokeW, markerD, arrowScale, leaderLen } = this._svgSizes(options);

        // flip y-axis for the SVG coordinate system, exactly as DimensionLine.toSVG() does
        const anchor:[number, number] = [this.position.x, -this.position.y];
        const [dx, dy] = this._svgTextOffset(leaderLen);
        const textAt:[number, number] = [anchor[0] + dx, anchor[1] + dy];

        const bare = this._isLabelOnly();
        const leader = (!bare && this.line) ? svgLeader(anchor, textAt, strokeW) : '';
        const marker = bare ? '' : this._svgTarget(anchor, [dx, dy], markerD, strokeW, arrowScale);

        return `<g class="label${this.class ? ` ${this.class}` : ''}">
                ${leader}
                ${marker}
                ${svgTextLabel(textAt, text, fontSize, {
                    shape: this._shape(),
                    cssClass: 'label-text',
                    background: this._setting('DIMENSION_TEXT_BACKGROUND_COLOR'),
                    /*  A label's box is drawn, both shapes of it. A dimension's value box is
                        not — it is a knockout behind the digits, and svgTextLabel leaves it
                        unstroked unless asked, which is why the stroke is set HERE. */
                    strokeWidth: strokeW,
                    charWidthFactor: this._setting('DIMENSION_TEXT_CHAR_WIDTH_FACTOR'),
                    paddingFactor: this._setting('DIMENSION_TEXT_PADDING_FACTOR'),
                    heightFactor: this._setting('DIMENSION_TEXT_HEIGHT_FACTOR'),
                    fontFamily: DOC_DEFAULT_SVG_FONT_FAMILY,
                })}
            </g>
        `
    }

    /** The mark at the anchor end: a dot that says WHERE, or an arrowhead that also says which
     *  way to look.
     *
     *  The arrow glyph points up in SVG space (tip at the origin, y down) at rotation 0, and
     *  has to point from the label back at the anchor — down the leader, which runs the other
     *  way. Hence the offset, negated, read as an SVG rotation. */
    _svgTarget(anchor:[number, number], offset:[number, number],
               markerD:number, strokeW:number, arrowScale:number):string
    {
        if(this.target === 'arrow')
        {
            const [dx, dy] = offset;
            const rotation = (Math.hypot(dx, dy) < 1e-9)
                                ? 0
                                : Math.atan2(-dx, dy) * 180 / Math.PI;
            return svgArrow(anchor, rotation, strokeW, arrowScale);
        }

        return (this.target === 'circle') ? svgCircleMarker(anchor, markerD, strokeW) : '';
    }

    /** The label's anchor, as a Shape.
     *
     *  A Vertex rather than the bare Point it used to be: callers ask a Shape for its bbox to
     *  work out how much room a drawing needs (View._drawingBox, annotationLayer), and a
     *  Point has no bbox() — so a label contributed nothing and one near the edge of a
     *  drawing was cropped away. The leader and the text still reach further than this; that
     *  extra room is the frame's business, and annotationMarginMm() accounts for it. */
    toShape():any
    {
        if(!this.position){ return null }
        const Vertex = (this.classes as any)?.Vertex;
        return (typeof Vertex === 'function') ? new Vertex(this.position) : this.position;
    }

    toData():LabelData
    {
        return {
            type: 'label',
            position: this.position.toArray() as [number,number,number],
            value: this.value as string,
            class: this.class,
            // resolved, not raw: the viewer has to draw the same box the page does
            shape: this._shape(),
            target: this.target,
            labelOnly: this.labelOnly,      // left null on purpose: each renderer has its own
            line: this.line,
            length: this.length,
            offset: this.offset,
            angle: this.angle,
            circle: this.circle,
            param: this.param,
        } as unknown as LabelData;
    }
}
