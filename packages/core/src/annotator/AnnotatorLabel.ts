/** Label Class
 *
 *  A free-text annotation anchored at a Shape's center. Unlike DimensionLine
 *  (rendered as in-scene geometry), a Label is rendered by the viewer as an
 *  HTML/CSS element overlaid on the WebGL canvas. It travels through the same
 *  annotation pipeline: Annotator.label().fromShape() → getAnnotationsData() →
 *  GLB root extras.annotations → viewer.
 */

import { BaseAnnotation } from './AnnotatorBaseAnnotation'
import type { LabelData, LabelOptions } from './types'
import type { PointLike, Point, AnyShape, AnyShapeOrCollection } from '../modeler/types'

export class Label extends BaseAnnotation
{
    _initialized:boolean = false;
    position:Point;                 // anchor (shape center) in model coords
    targetShape:AnyShape = null;    // the shape this label is generated from
    linkedTo:any = null;            // main parent Shape/Collection
    class:string = null;            // extra CSS class for viewer styling
    line:boolean = false;           // leader line from anchor to label box
    offset:number = 40;             // leader length in screen px
    angle:number = 90;              // leader angle in deg (90 = up on screen)
    circle:boolean = false;         // circle marker at the anchor end of the leader
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
        const circle = o?.circle ?? o?.arrow; // `arrow` is a deprecated alias
        // a leader is implied when any leader option is set
        this.line = o?.line ?? (o?.offset != null || circle ? true : this.line);
        this.offset = o?.offset ?? this.offset;
        this.angle = o?.angle ?? this.angle;
        this.circle = circle ?? this.circle;
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

    toShape():any
    {
        return this.position ?? null;
    }

    toData():LabelData
    {
        return {
            type: 'label',
            position: this.position.toArray() as [number,number,number],
            value: this.value as string,
            class: this.class,
            line: this.line,
            offset: this.offset,
            angle: this.angle,
            circle: this.circle,
            param: this.param,
        } as unknown as LabelData;
    }
}
