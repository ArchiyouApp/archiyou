
/** DimensionLine Class 
 * 
 *  NOTES:
 *      - Dimension lines will be rendered in different contexts (3D GLTF viewer, html/SVG, PDF) 
 *          so we need enough data to alter representation in every context, while at the same time 
 *          minimizing repeating calculations
 *      - offset length can be set by user in world coordinates
 * 
*/

import type  { MainAxis, ModelUnits, AnyShape, AnyShapeCollection, AnyShapeOrCollection } from '../modeler/types'

/**
 * TODO: Types from both kernels. Now only meshup. 
 */
import type { Vector, Point, PointLike, Curve } from '@archiyou/meshup'
import type { ArchiyouModules } from '../types'
import type { DimensionLineData, DimensionOptions, AnnotationType } from './types'
import { BaseAnnotation } from './AnnotatorBaseAnnotation'
import { detectExportFrame } from '../modeler/utils'

import { isPointLike } from '../modeler/typeguards'

import { validate, optional } from '../decorators'
import { PointLikeSchema } from '../modeler/schemas'
import { DimensionOptionsSchema } from './schemas'
import { Type } from 'typebox'

import { roundTo } from '../utils' // utils
import { MM_PER_UNIT, toMM, formatLength } from '../units/UnitConverter'
import { DOC_DEFAULT_SVG_FONT_FAMILY } from '../constants'

/*  Fallbacks for the label proportions, used only when a DimensionLine cannot reach an
    Annotator (a line built outside the app, a unit test). The real settings live on the
    Annotator — see its SETTINGS block — so a script can change them. */
const LABEL_DEFAULTS = {
    DIMENSION_SMALL_LINE_FACTOR: 2,
    DIMENSION_LEADER_LENGTH_FACTOR: 1.5,
    DIMENSION_TEXT_CHAR_WIDTH_FACTOR: 0.6,
    DIMENSION_TEXT_PADDING_FACTOR: 0.5,
    DIMENSION_TEXT_HEIGHT_FACTOR: 1.2,
    DIMENSION_TEXT_BACKGROUND_COLOR: 'white' as string|null,
}

export class DimensionLine extends BaseAnnotation
{
    //// SETTINGS
    DIMENSION_OFFSET_DEFAULT = 10; // in model units
    DIMENSION_ROUND_DEFAULT = true;

    // NOTE: line start and end is calculated when exporting toData()
    _initialized:boolean = false;
    targetStart:Point; // point on Shape
    targetEnd:Point; // point on Shape
    targetShape:AnyShape = null; // the (sub)shape (mostly an Curve) the dimension line is directly generated from
    linkedTo:any = null; // the main parent Shape or ShapeCollection this dimension is linked to
    _linkedCenterCache:[number, number, number]|null = null; // see _linkedCenter()
    _planeNormalCache:[number, number, number]|null = null; // see _planeNormal()
    // value:number; // the value of the dimension line, from BaseAnnotation
    static:boolean = false;
    units:ModelUnits = null;
    offsetVec:Vector; // Normalized Vector offset from Shape 
    offsetLength:number; // distance of DimensionLine to target Shape along offsetVec in world units: most of the time this is calculated based on view context

    ortho:boolean|MainAxis = false;
    _orthoAxis:MainAxis; // parallel to which axis it the ortho dimension line
    round:boolean = this.DIMENSION_ROUND_DEFAULT; 
    roundDecimals:number = 0;    
    textSize:number;

    interactive:boolean = false;
    showUnits:boolean = false;
    _param:string = null; // name of bound parameter
    _paramRemapSrc:string = null; // source of the optional remap function of param(name, remap)
    _hasCustomOffsetVec:boolean = false;
    _offsetComponents:[number, number, number] | null = null;

    /** @param modules - archiyou modules; needed up front because init() already resolves
     *   kernel classes (setOptions → this.classes) before the caller can setArchiyou() */
    constructor(start:PointLike=null, end:PointLike=null, options?:DimensionOptions, modules?:ArchiyouModules)
    {
        super('dimensionLine');

        if(modules){ this.setArchiyou(modules); }

        if(start && end)
        {
            this.init(start,end, options)
        }
        else {
            console.warn(`DimensionLine::constructor(): DimensionLine not initialized. Use methods init(start,end,options) or fromEdge(shape, options) later!`)
        }

    }

    /** Check if a given object is a DimensionLine  */
    static isDimensionLine(o:any):boolean
    {
        return (typeof o === 'object') && o?._type == 'DimensionLine'
    }

    /** (Re)init dimension line */
    @validate(PointLikeSchema, PointLikeSchema, optional(DimensionOptionsSchema))
    init(start:PointLike, end:PointLike, options?:DimensionOptions):this
    {
        if(!start && !end){ throw new Error(`DimensionLine::init(): Please supply start and end Point!`); }

        this.targetStart = this._toPoint(start);
        this.targetEnd = this._toPoint(end);

        this._initialized = true;
        this.setOptions(options)

        this._calculateAutoOffsetLength();
        this._calculateOffsetVec(); // don't override from options
        this.value = this._getDynamicValue();

        return this;
    }

    /** Normalize any PointLike target to a real Point.
     *  autoDim() hands us Vertices (Shapes, not Points) — the dimension math below needs
     *  Point methods (equals/copy/setComponent), which a Vertex does not have. */
    _toPoint(p:PointLike):Point
    {
        return (typeof (p as any)?.toPoint === 'function')
                    ? (p as any).toPoint() as Point
                    : new this.classes.Point(p as any) as Point;
    }

    /** Generate a dimension line from this Edge */
    fromEdge(edge:Curve, options?:DimensionOptions):this
    {
        if(!this.classes.Shape.isShape(edge)){ throw new Error(`DimensionLine::init(): Please supply an Edge Shape`); }
        
        // TODO: AFTER REFACTOR generalize modeling API's
        if(!['Edge','Curve'].includes(edge.type as string))
        { 
            throw new Error(`DimensionLine::init(): Please supply a Edge. Other Shapes are not yet supported!`); 
        }
        
        this.targetShape = edge;
        this.linkedTo = this._getParentShape(edge); // set main Shape
        this._linkedCenterCache = null; // a new link means a new centre to offset away from
        this._planeNormalCache = null;
        this.linkedTo.addAnnotations(this); // make two-sided link
        // init() validates options against an object schema — never pass undefined
        return this.init(edge.start().toPoint(), edge.end().toPoint(), options ?? {})
    }

    /** Centralized dimension creation for any Shape or SmartShape.
     *  Single source of truth — brep Shape.dim() and SmartShape.dim() both route here.
     *  Switches on shape.type:
     *    - 'Edge' (brep)                  → single dimension line if open; a closed Edge
     *                                       (circle/ellipse) routes to autoDim / bbox dims
     *    - 'Curve' (mesh)                 → single line if open; bbox dims if isCuboid;
     *                                       otherwise route to Annotator.autoDim()
     *    - 'Wire' / 'Face' (brep)         → part dimensions via autoDim when closed and flat on
     *                                       XY; otherwise one dimension per visible edge
     *    - 'Mesh' (mesh)                  → bbox dims if isCuboid; otherwise autoDim
     *    - 'Solid' / 'Shell'              → bounding-box dimensions
     *    - 'Vertex'                       → error
     */
    fromShape(shape:AnyShape, options?:DimensionOptions):DimensionLine|Array<DimensionLine>
    {
        const ann = this._archiyou.annotator;
        const t = (shape as any).type as string;

        // Normalize options: init() validates against an object schema, so never
        // pass undefined; default units from the model (mirrors old Edge.dimension).
        const opts: DimensionOptions = { ...(options ?? {}) };
        if (opts.units == null && this._archiyou?.modeler?.units)
        {
            opts.units = this._archiyou.modeler.units();
        }

        switch (t)
        {
            case 'Edge':
            {
                /*  BREP's 1D shape. A CLOSED Edge (circle, ellipse) has no distinct start and
                    end: dimensioning it as a single line built a zero-length Line and threw
                    ("Start and End point are the same"). Route it the way the mesh kernel
                    routes a closed Curve. */
                if (DimensionLine.isClosedProfile(shape))
                {
                    return DimensionLine.isFlatOnXY(shape)
                                ? this._dispatchAutoDim(shape as AnyShape, opts)
                                : this._dimensionBoxFromShape(shape as AnyShape);
                }
                return this.fromEdge(shape as Curve, opts);
            }

            case 'Curve':
            {
                // Mesh-kernel Curve: an open single line still dimensions as one
                // edge; a closed cuboid (rectangle) gets axis-aligned bbox dims;
                // anything more complex routes to the Annotator's autoDim().
                const curve = shape as any;
                const isClosed = typeof curve.isClosed === 'function' && curve.isClosed();
                if (!isClosed)
                {
                    return this.fromEdge(shape as Curve, opts);
                }
                if (typeof curve.isCuboid === 'function' && curve.isCuboid())
                {
                    return this._dimensionBoxFromShape(shape as AnyShape);
                }
                return this._dispatchAutoDim(shape as AnyShape, opts);
            }

            case 'Wire':
            case 'Face':
            {
                /*  BREP's closed 2D profiles follow the same rule as the mesh kernel's
                    Curve/Polygon: a closed profile lying flat on XY gets real PART dimensions.
                    For a plain rectangle those collapse to the two bbox dims — it used to come
                    back with one dimension line per edge, so four for a rectangle, two of them
                    duplicate values. Open or tilted profiles keep the per-edge behaviour: that
                    is all autoDimPart() can handle. */
                if (DimensionLine.isClosedProfile(shape) && DimensionLine.isFlatOnXY(shape))
                {
                    return this._dispatchAutoDim(shape as AnyShape, opts);
                }

                // Skip closed edges: a circle inside the profile is a loop, not a length.
                const edges = new this.classes.ShapeCollection((shape as any).edges().onlyVisible())
                                    .toArray()
                                    .filter(e => !DimensionLine.isClosedProfile(e)) as Array<Curve>;
                if (edges.length === 0) return this;
                this.fromEdge(edges[0], opts);
                const rest = edges.slice(1).map(e => ann.dimensionLine().fromEdge(e, opts));
                return [this, ...rest];
            }

            case 'Vertex':
                throw new Error(`DimensionLine::fromShape(): cannot dimension a single Vertex`);

            case 'Polygon':
            {
                // Mesh-kernel Polygon: a plain rectangle gets axis-aligned bbox dims,
                // anything more complex (L-shapes, holes, angled edges) routes to autoDim().
                const polygon = shape as any;
                if (polygon.hasHoles?.() !== true && polygon.toCurve?.()?.isCuboid?.())
                {
                    return this._dimensionBoxFromShape(shape as AnyShape);
                }
                return this._dispatchAutoDim(shape as AnyShape, opts);
            }

            case 'Mesh':
            {
                // Mesh-kernel Mesh: 3 bbox dims if cuboid (2 if flat); otherwise
                // route to autoDim().
                const mesh = shape as any;
                if (typeof mesh.isCuboid === 'function' && mesh.isCuboid())
                {
                    return this._dimensionBoxFromShape(shape as AnyShape);
                }
                return this._dispatchAutoDim(shape as AnyShape, opts);
            }

            case 'Solid':
            case 'Shell':
            default:
            {
                return this._dimensionBoxFromShape(shape as AnyShape);
            }
        }
    }

    /** Is this a closed profile (a loop rather than a strip)?
     *  A Face always is; a Wire answers closed(), a meshup Curve isClosed(), and a BREP Edge
     *  is closed when it is a circle/ellipse — its start and end vertex coincide.
     *
     *  Static because the Annotator needs the same test when skipping edges it cannot turn
     *  into a single dimension line (see autoDimPart, level 3). */
    static isClosedProfile(shape:any):boolean
    {
        const s = shape as any;
        if(typeof s?.closed === 'function'){ return s.closed() === true }        // BREP Wire
        if(typeof s?.isClosed === 'function'){ return s.isClosed() === true }    // meshup Curve
        if(s?.type === 'Face'){ return true }
        return s?.start?.()?.equals?.(s?.end?.()) === true;                      // BREP Edge
    }

    /** Does this Shape lie flat on the XY plane? That is what Annotator.autoDimPart() needs —
     *  it dimensions in X and Y and throws for anything tilted (use layflat() first). */
    static isFlatOnXY(shape:any):boolean
    {
        const s = shape as any;
        if(typeof s?.is2DXY === 'function'){ return s.is2DXY() === true }        // BREP
        return s?.is2D?.() === true && s?.bbox?.()?.is2D() === true;             // meshup
    }

    /** Run Annotator.dimensionBox(shape) and return the new lines, dropping the
     *  empty placeholder this fromShape() created. */
    _dimensionBoxFromShape(shape:AnyShape):Array<DimensionLine>
    {
        const ann = this._archiyou.annotator;
        ann._drop(this);
        const before = ann.getAnnotations().length;
        ann.dimensionBox(shape);
        return ann.getAnnotations().slice(before) as Array<DimensionLine>;
    }

    /** Wrap the shape in a ShapeCollection and forward to Annotator.autoDim().
     *  Drops the empty placeholder this fromShape() created. */
    _dispatchAutoDim(shape:AnyShape, opts:DimensionOptions):Array<DimensionLine>
    {
        const ann = this._archiyou.annotator;
        ann._drop(this);
        const before = ann.getAnnotations().length;
        const collection = new this.classes.ShapeCollection(shape);
        ann.autoDim(collection as AnyShapeCollection, opts);
        return ann.getAnnotations().slice(before) as Array<DimensionLine>;
    }

    /** Link this Annotation to given Shape or ShapeCollection 
     *  This helps with more advanced dimensioning and retrieving Dimension when exporting Shapes */
    link(to:AnyShapeOrCollection):this
    {
        this.linkedTo = (this.classes.Shape.isShape(to)) 
                            ? this._getParentShape(to)
                            : (this.classes.ShapeCollection.isShapeCollection(to) ? to as AnyShapeCollection : null); // Make sure we always got the top Shape

        if(!this.linkedTo)
        {
            console.warn(`AnnotatorDimensionLine::link(): No valid Shape or ShapeCollection to link to. Skipped!`)
            return this;
        }

        this.linkedTo.addAnnotations(this);

        // recalculate for offset based on main shape
        this._calculateAutoOffsetLength(); 
        this._calculateOffsetVec(true);
        return this;
    }

    /** Recurse parents to find main parent Shape of given shape */
    _getParentShape(s:AnyShapeOrCollection):AnyShapeOrCollection|null
    {
        if(!s || (typeof s !== 'object'))
        { 
            console.warn(`AnnotatorDimensionLine::_getParentShape(): Could not find a parent Shape. Did you supply a Shape to start recursion?`);
            return null;
        }
        return ((s as any)._parent) ? this._getParentShape((s as any)._parent) : s;
    }


    _getDynamicValue():number
    {
        return roundTo(
                (!this.ortho) ? this.targetDir().length() : this.dir().length(), 
                3);
    }

    type():AnnotationType
    {
        return 'dimensionLine';
    }

    /** Vector from target start to end, not normalized */
    targetDir():Vector
    {
        return this.targetEnd.toVector().subtracted(this.targetStart)
    }

    /** Vector from dimension line start to end */
    dir():Vector
    {
        return (!this.ortho) 
            ? this.targetDir()
            : this._calculatePoint('end').toVector().subtract(this._calculatePoint('start'))
    }

    /** Middle Point of this DimensionLine */
    targetMiddle():Point
    {
        return this.classes.Curve.Line(this.targetStart, this.targetEnd).middle()
    }

    /** Offset Vector of length offsetLength from target points to Dimension line */
    offset():Vector
    {
        const offsetComponents = this._getEffectiveOffsetComponents();

        return this._scaledOffset(offsetComponents, this.offsetLength)
    }

    /** Update when linked Shape is updated */
    update()
    {
        if(!this.static){ this.value = this._getDynamicValue() }
        this.updatePosition();
    }

    /** Update position after linked Shape has moved 
     *  !!!! IMPORTANT !!!! Improve this method
    */
    updatePosition()
    {
        // TODO: AFTER REFACTOR FIX
        if(this.targetShape && (this.targetShape.type === 'Curve' || (this.targetShape as any).type === 'Edge'))
        {
            const linkedEdge = (this.targetShape as Curve);
            this.targetStart = linkedEdge.start().toPoint();
            this.targetEnd = linkedEdge.end().toPoint();
            this._calculateOffsetVec(true); // force overwrite
            this._calculateAutoOffsetLength(); 
        }
    }

    /** Calculate the direction for offsetting from target  
     *  How to offset depends on dimension line type: normal, ortho
    */
    _calculateOffsetVec(overwrite:boolean=false, planeNormal?:{ x:number, y:number, z:number }|null):Vector
    {
        // Don't overwrite if already set
        if(this.offsetVec && !overwrite)
        {
            return this.offsetVec;
        }

        const normal = this._planeNormal(planeNormal);

        // A dimension running along the view direction projects to a point and has no
        // perpendicular in the drawing. Offset along an axis of the plane instead, so it is at
        // least visible: the old code did this for a z-parallel line in a plan, hardcoded to x.
        if(this.targetDir().isParallel(normal))
        {
            const inPlane = this._componentsLength(this._crossComponents(normal, [0, 0, 1])) > 1e-9
                                ? this._normalizeComponents(this._crossComponents(normal, [0, 0, 1]))
                                : [1, 0, 0] as [number, number, number];
            this.offsetVec = new this.classes.Vector(inPlane[0], inPlane[1], inPlane[2]);
            return this.offsetVec;
        }
        else 
        {
            // Determine offset from a 2D/3D Shape: So the Shape can have an outside
            const targetDir = this.targetDir().toArray() as [number, number, number];
            let newOffsetComponents = this._crossComponents(targetDir, normal);

            if(this._componentsLength(newOffsetComponents) === 0)
            {
                newOffsetComponents = this._crossComponents(targetDir, [0, 1, 0]);
            }

            // Basic: newwOffsetVec points away from center
            newOffsetComponents = this._awayFromLinked(newOffsetComponents);
            newOffsetComponents = this._normalizeComponents(newOffsetComponents);

            // If ortho the offset vector is parallel to one of the 3 axis (or reversed)
            // What axis to use can be set by user
            // We first determine what axis the Shape occupy (1D/2D/3D) 
            // If no axis given by user we pick the one that has the biggest measurement
            if(this.ortho) // true, or 'x'  or 'y' 
            {
                const dimLineHasAxes = this.targetEdge().bbox().hasAxes();
                const shapeBiggestAxis = this.targetEdge().bbox().maxSizeAxis();

                this._orthoAxis = (typeof this.ortho !== 'string') 
                                            ? shapeBiggestAxis // autopick biggest axis
                                            : dimLineHasAxes.includes(this.ortho) 
                                                ? this.ortho
                                                : shapeBiggestAxis;
                const orthoOffsetAxis = ['x','y','z'].find(a => a !== this._orthoAxis ) as MainAxis
                const axisIndex = (orthoOffsetAxis === 'x') ? 0 : (orthoOffsetAxis === 'y') ? 1 : 2;
                const axisValue = newOffsetComponents[axisIndex] >= 0 ? 1 : -1;

                newOffsetComponents = [0, 0, 0];
                newOffsetComponents[axisIndex] = axisValue;
                
            }

            this._offsetComponents = [...newOffsetComponents] as [number, number, number];
            this.offsetVec = new this.classes.Vector(
                this._offsetComponents[0],
                this._offsetComponents[1],
                this._offsetComponents[2],
            );

            return this.offsetVec
        }        
    }

    _crossVectors(a:Vector, b:Vector):Vector
    {
        return new this.classes.Vector(
            a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x,
        );
    }

    _normalizeVector(v:Vector):Vector
    {
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

        if(length === 0)
        {
            return new this.classes.Vector(0,0,0);
        }

        return new this.classes.Vector(v.x / length, v.y / length, v.z / length);
    }

    _crossComponents(a:[number, number, number], b:[number, number, number]):[number, number, number]
    {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ];
    }

    _componentsLength(components:[number, number, number]):number
    {
        return Math.sqrt(
            components[0] * components[0]
            + components[1] * components[1]
            + components[2] * components[2],
        );
    }

    _normalizeComponents(components:[number, number, number]):[number, number, number]
    {
        const length = this._componentsLength(components);

        if(length === 0)
        {
            return [0, 0, 0];
        }

        return [
            components[0] / length,
            components[1] / length,
            components[2] / length,
        ];
    }

    _scaleComponents(components:[number, number, number], factor:number):[number, number, number]
    {
        return [
            components[0] * factor,
            components[1] * factor,
            components[2] * factor,
        ];
    }

    _addComponents(a:[number, number, number], b:[number, number, number]):[number, number, number]
    {
        return [
            a[0] + b[0],
            a[1] + b[1],
            a[2] + b[2],
        ];
    }

    _distanceBetween(a:[number, number, number], b:[number, number, number]):number
    {
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];

        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** The normal of the plane this dimension offsets INSIDE.
     *
     *  A dimension stands off perpendicular to itself, and "perpendicular" only means
     *  something once you say in which plane. This used to answer XY for every dimension in
     *  every model: on a wall elevation drawn on XZ the offset came out along Y, which points
     *  straight out of the drawing, so the dimension line landed exactly on top of the
     *  geometry it measures — and in the 3D viewer it floated off the face of the wall.
     *
     *  `override` is the DRAWING's plane, which an exporter knows exactly (see Projector).
     *  Without one — the viewer, and toData() — the model's own 2D plane is the same answer
     *  by another route. A model with no 2D plane at all is 3D, and there the plan normal is
     *  as good as any, which is what this always used to assume.
     */
    _planeNormal(override?:{ x:number, y:number, z:number }|null):[number, number, number]
    {
        if(override){ return [override.x, override.y, override.z] }
        if(this._planeNormalCache){ return this._planeNormalCache }

        const shapes = this._archiyou?.modeler?.all?.()?.toArray?.() ?? [];
        const frame = detectExportFrame(shapes);
        this._planeNormalCache = frame
                                    ? [frame.normal.x, frame.normal.y, frame.normal.z]
                                    : [0, 0, 1];
        return this._planeNormalCache;
    }

    /** Unit vector perpendicular to the dimension line, inside `planeNormal`'s plane, or null
     *  when the two are parallel — a dimension running along the view direction, which has no
     *  perpendicular in the drawing at all. */
    _perpendicularInPlane(planeNormal:[number, number, number]):[number, number, number]|null
    {
        const dir:[number, number, number] = [
            this.targetEnd.x - this.targetStart.x,
            this.targetEnd.y - this.targetStart.y,
            this.targetEnd.z - this.targetStart.z,
        ];
        const perp = this._crossComponents(dir, planeNormal);
        const length = this._componentsLength(perp);
        return (length < 1e-9) ? null : this._normalizeComponents(perp);
    }

    /** Flip `components` to point AWAY from the shape this dimension is linked to, so the
     *  line stands outside the thing it measures rather than through it. */
    _awayFromLinked(components:[number, number, number]):[number, number, number]
    {
        const insidePoint = this._linkedCenter();
        const targetMiddle = this._targetMiddleComponents();
        const d1 = this._distanceBetween(this._addComponents(targetMiddle, components), insidePoint);
        const d2 = this._distanceBetween(this._addComponents(targetMiddle, this._scaleComponents(components, -1)), insidePoint);
        return (d1 < d2) ? this._scaleComponents(components, -1) : components;
    }

    _getEffectiveOffsetComponents(planeNormal?:{ x:number, y:number, z:number }|null):[number, number, number]
    {
        if(this._hasCustomOffsetVec && this.offsetVec)
        {
            return [this.offsetVec.x, this.offsetVec.y, this.offsetVec.z];
        }

        this._calculateOffsetVec(true, planeNormal);

        if(!this._offsetComponents)
        {
            return [0, 0, 0];
        }

        return [...this._offsetComponents] as [number, number, number];
    }

    /** The offset for a dimension that LIES IN the drawing plane: straight perpendicular to
     *  itself, pointing outward. Null when it does not lie in that plane (a dimension across a
     *  3D model, which the general path handles) or when it is `ortho`, which offsets along an
     *  axis rather than perpendicular. */
    _getPlanarOffsetComponents(planeNormal?:{ x:number, y:number, z:number }|null):[number, number, number] | null
    {
        if(this.ortho)
        {
            return null;
        }

        const normal = this._planeNormal(planeNormal);
        const targetDir = [
            this.targetEnd.x - this.targetStart.x,
            this.targetEnd.y - this.targetStart.y,
            this.targetEnd.z - this.targetStart.z,
        ] as [number, number, number];

        const length = this._componentsLength(targetDir);
        if(length === 0)
        {
            return null;
        }

        // Out of the drawing plane: this dimension is not a planar one, whatever plane it is
        // in. Measured on the unit direction so the test does not scale with the model.
        const outOfPlane = Math.abs(
            (targetDir[0] * normal[0] + targetDir[1] * normal[1] + targetDir[2] * normal[2]) / length);
        if(outOfPlane > 1e-9)
        {
            return null;
        }

        const perpendicular = this._perpendicularInPlane(normal);
        return perpendicular ? this._awayFromLinked(perpendicular) : null;
    }

    _resolveOffsetComponents(planeNormal?:{ x:number, y:number, z:number }|null):[number, number, number]
    {
        // An offset the author set outranks every rule below it. Checked here rather than only
        // in _getEffectiveOffsetComponents(), which the planar path used to skip straight past:
        // a custom offsetVec was quietly ignored for any dimension lying in the drawing plane,
        // which is most of them.
        if(this._hasCustomOffsetVec && this.offsetVec)
        {
            return [this.offsetVec.x, this.offsetVec.y, this.offsetVec.z];
        }
        return this._getPlanarOffsetComponents(planeNormal) ?? this._getEffectiveOffsetComponents(planeNormal);
    }

    _scaledOffset(components:[number, number, number], distance:number):Vector
    {
        return new this.classes.Vector(
            components[0] * distance,
            components[1] * distance,
            components[2] * distance,
        );
    }

    /** Calculate a offset length */
    _calculateAutoOffsetLength():number
    {
        const l = this.DIMENSION_OFFSET_DEFAULT;
        if(this.offsetLength === undefined || this.offsetLength === null){ this.offsetLength = l; }
        return this.offsetLength;
    }

    /** The start and end point of DimensionLine in original coordinate system  
     *  Where the points are depends on type of dimension line. Normal or othogonal
    */
    /** Centre of the Shape/collection this dimension is linked to, for deciding which side of
     *  the measured edge to offset to. Cached: the centre comes from a bounding box, and on a
     *  collection that is a pass over every Shape in it — this is called for both ends of
     *  every dimension, on every draw. Invalidated by link() and by an explicit offset. */
    _linkedCenter():[number, number, number]
    {
        if(this._linkedCenterCache){ return this._linkedCenterCache }

        // A Shape or collection always has a centre; without one (no link yet) the world
        // origin decides the side, as before. The old `is2D() || is3D()` guard answered the
        // same question, but on a collection both walk every Shape's bounding box.
        const center = (typeof (this.linkedTo as any)?.center === 'function')
                            ? (this.linkedTo as any).center()
                            : new this.classes.Point(0,0,0);

        this._linkedCenterCache = center.toArray() as [number, number, number];
        return this._linkedCenterCache;
    }

    /** Midpoint of the measured edge, as plain components. */
    _targetMiddleComponents():[number, number, number]
    {
        return [
            (this.targetStart.x + this.targetEnd.x) / 2,
            (this.targetStart.y + this.targetEnd.y) / 2,
            (this.targetStart.z + this.targetEnd.z) / 2,
        ];
    }

    /** One end of the dimension LINE — the target point, stepped off by the offset.
     *
     *  @param planeNormal the drawing's plane, when the caller is an exporter that knows it.
     *      See _planeNormal(): without one this falls back to the model's own 2D plane.
     *
     *  There used to be a copy of the planar case inlined here, gated on both ends sharing a
     *  z and on the line being diagonal, computing the same perpendicular in XY that
     *  _getPlanarOffsetComponents() computes below. Two implementations of one rule is one too
     *  many when the rule is about to learn a second plane.
     */
    _calculatePoint(at:'start'|'end', planeNormal?:{ x:number, y:number, z:number }|null):Point
    {   
        if(!this.offsetLength) { this._calculateAutoOffsetLength(); }

        const sourcePoint = (at === 'start') ? this.targetStart : this.targetEnd;
        const offsetComponents = this._resolveOffsetComponents(planeNormal);
        const curPoint = sourcePoint.copy(); // Make sure we use copies!
        const offsetPoint = this._offsetPoint(curPoint, offsetComponents, this.offsetLength);

        // simple offset parallel to dimension line
        if(!this.ortho)
        {
            return offsetPoint;
        }
        else if(this.ortho)
        {
            // Offset from the point that has the biggest coordinate component parallel to offset vector
            const offsetAxis = this._largestAxis(offsetComponents)

            const offsetMainComponent = this._componentAt(offsetComponents, offsetAxis)
            
            const pointsOrdered = [this.targetStart.copy(), this.targetEnd.copy()].sort((a,b) => b[offsetAxis] - a[offsetAxis]); // order DESC
            if( offsetMainComponent < 0 ){ pointsOrdered.reverse(); }
            
            const offsetFromPoint = pointsOrdered[0];
            const offsettedPoint = this._offsetPoint(offsetFromPoint, offsetComponents, this.offsetLength);

            return (offsetFromPoint.equals(curPoint)) 
                        ? offsettedPoint  // curPoint is the point from which to offset
                        : curPoint.setComponent(offsetAxis, offsettedPoint[offsetAxis])
        }
    }

    _offsetPoint(p:Point, components:[number, number, number], distance:number):Point
    {
        return new this.classes.Point(
            p.x + components[0] * distance,
            p.y + components[1] * distance,
            p.z + components[2] * distance,
        );
    }

    _largestAxis(components:[number, number, number]):MainAxis
    {
        const [x, y, z] = components.map(c => Math.abs(c));

        if(x >= y && x >= z) { return 'x'; }
        if(y >= z) { return 'y'; }
        return 'z';
    }

    _componentAt(components:[number, number, number], axis:MainAxis):number
    {
        return (axis === 'x') ? components[0] : (axis === 'y') ? components[1] : components[2];
    }

    
    /** Direction of this dimension in SVG space, in degrees, as `rotate()` measures it
     *  (counter-clockwise from +x in a y-DOWN coordinate system). Drives the arrowheads.
     *
     *  It said "mirror y" but mirrored across the plane with normal [1,0,0], which negates
     *  X — the same direction turned by 180°, so every arrowhead in an exported drawing
     *  pointed the wrong way. Computed here rather than through the kernel Vector classes:
     *  their angleXY() disagree (meshup measures counter-clockwise in (-180,180], brep
     *  clockwise in [0,360)), so the shared code has to do its own trigonometry to behave the
     *  same in both. */
    getSVGRotation():number
    {
        const dx = this.targetEnd.x - this.targetStart.x;
        const dy = -(this.targetEnd.y - this.targetStart.y); // SVG's y axis points down
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    //// OPERATIONS ////

    /** Set static value  */
    setValue(v:number|string):this
    {
        this.value = (typeof v === 'number') ? v : Number(v);
        this.static = true; // set this flag so we know if we need to update it in update()

        return this;
    }

    setOptions(o:DimensionOptions):this
    {
        this.ortho = o?.ortho ?? false;
        const optionsOffsetVec = (isPointLike(o?.offsetVec)) ? new this.classes.Vector(o.offsetVec) : null; // Transform any PointLikes of user into a Vector
        this._hasCustomOffsetVec = !!optionsOffsetVec;
        this.offsetVec = optionsOffsetVec || this.offsetVec || this._calculateOffsetVec();
        this._offsetComponents = this.offsetVec ? [this.offsetVec.x, this.offsetVec.y, this.offsetVec.z] : this._offsetComponents;
        this.offsetLength = o?.offset // Can also be 0, only if undefined/null we do something
        this.offsetLength = (this.offsetLength === undefined || o?.offset === null) ? this._calculateAutoOffsetLength() : this.offsetLength;

        this.units = o?.units || this.units;
        this.showUnits = o?.showUnits ?? this.showUnits;
        this.roundDecimals = o?.roundDecimals || this.roundDecimals;
        // TODO: more: color, linethickness etc.
        return this;
    }

    @validate(PointLikeSchema)
    setOffsetVec(v:PointLike):this
    {
        this._hasCustomOffsetVec = true;
        this.offsetVec = v as Vector; // auto converted
        this._offsetComponents = [this.offsetVec.x, this.offsetVec.y, this.offsetVec.z];
        return this;
    }

    /** Bind a script parameter to this dimension line, making the value text
     *  editable in the viewer overlay. The bound parameter is exported in
     *  toData() so the overlay can route edits back to the param-menu.
     *
     *  @param paramName name of the script parameter ($PARAMS.define(...)) to write to
     *  @param remap optional function mapping the edited dimension value to the
     *      parameter value: `(value, currentParamValue) => newParamValue`.
     *      Without it the typed value is written to the parameter as-is, which is
     *      only right when the parameter is in model units. Use it whenever the
     *      parameter is scaled or derived - a model in mm with a parameter in cm
     *      is `.param('DEPTH', (v) => v/10)`.
     *
     *  NOTE: the remap function is serialized to source here and re-created in the
     *      viewer (the main thread, where the script scope no longer exists), so it
     *      has to be self-contained: use its arguments and globals like Math only,
     *      never a variable or function from the script around it. That is checked
     *      at bind time - see _toRemapSrc().
     */
    @validate(Type.String())
    bindParam(paramName:string, remap?:(value:number, current?:any) => any):this
    {
        this._param = paramName;
        this.interactive = true;
        this._paramRemapSrc = (remap === undefined || remap === null)
                                ? null
                                : this._toRemapSrc(remap, paramName);
        return this;
    }

    /** alias for bindParam */
    param(paramName:string, remap?:(value:number, current?:any) => any):this
    {
        return this.bindParam(paramName, remap);
    }

    /** Serialize a remap function to source, checking up front that it survives the trip.
     *  The viewer rebuilds the function from this string in the main thread: a closure over
     *  a script variable is a ReferenceError there, thrown on an edit long after the
     *  .param() call that caused it. Rebuilding it here in the same detached way surfaces
     *  that while the script runs, where the author can see it. */
    _toRemapSrc(remap:any, paramName:string):string
    {
        if(typeof remap !== 'function')
        {
            throw new Error(`DimensionLine::param(): remap of param "${paramName}" must be a function, like (v) => v/10. Received: ${typeof remap}`);
        }

        const src = remap.toString();

        try {
            // Rebuild in an empty scope - exactly what the viewer does
            const detached = (new Function(`return (${src})`))() as (v:number, c?:any) => any;
            const probe = (typeof this.value === 'number') ? this.value : 1;
            const out = detached(probe, undefined);

            // A remap may legitimately return a string (a text param), just not nothing
            if(out === undefined || out === null || (typeof out === 'number' && !isFinite(out)))
            {
                this._archiyou?.console?.warn(
                    `DimensionLine::param(): remap of param "${paramName}" returned ${String(out)} for value ${probe}. ` +
                    `Edits with a value the remap cannot map are dropped.`);
            }
        }
        catch(e)
        {
            if (e instanceof ReferenceError)
            {
                const msg = `DimensionLine::param(): remap of param "${paramName}" cannot run outside the script (${(e as Error).message}). ` +
                    `It is re-created in the viewer, so keep it self-contained: use only its arguments, like (v) => v/10 - ` +
                    `no variables or functions from the script around it.`;
                this._archiyou?.console?.error(msg);
                throw new Error(msg);
            }
            // Anything else is the function's own doing on a probe value: not fatal
            this._archiyou?.console?.warn(
                `DimensionLine::param(): remap of param "${paramName}" threw on value ${this.value}: ${(e as Error).message}`);
        }

        return src;
    }

    /** Generic Shape method (every Annotation class should have this!) */
    toShape(): Curve 
    {
        return this.toEdge();
    }

    /** Make a Line Edge out this DimensionLine */
    toEdge(): Curve
    {
        return this.classes.Curve.Line(this._calculatePoint('start'), this._calculatePoint('end')) as Curve;
    }

    targetEdge(): Curve
    {
        return this.classes.Curve.Line(this.targetStart, this.targetEnd) as Curve;
    }

    //// RELATIONS WITH OTHER DIMENSION LINES ////

    /* Generate an id to compare with other dimension lines */
    sameId(flags:Record<string,boolean>={}):string|null
    {
        /* 
            TODO: DimensionLines that are parallel to each other based on positioning is not taken into account!
                For now we see dimensionlines with same offset and length as same. This is a problem!
        */

        const DEFAULT_FLAGS = {
                compareOffsetAbs : true,
                compareOffsetLength : false ,
                compareValue: true,
                compareWithShape: true,
                compareProjYAxis: true, // y coord of projection of offset Vector from position
            }

        flags = { ...DEFAULT_FLAGS, ...flags }

        let ov = this.offsetVec.copy().round();

        if(flags.compareOffsetAbs) ov = ov.abs();
        
        const l = (flags.compareOffsetLength) ? this.offsetLength : 1;
        const v = (flags.compareValue) ? Math.round((typeof this.value === 'string') ? parseFloat(this.value) : this.value ) : ''; // round to full units by default
        const sId = (flags.compareWithShape) ? (this.linkedTo?.hashcode?.() || this.linkedTo?._hashcode?.() || this.uuid) : '';
        const y = (flags.compareProjYAxis) ? Math.round(this._projYAxis()) : ''

        return `${ov}-${l}-${v}-${sId}-${y}`;
    }

    isSame(other:DimensionLine, flags:Record<string,boolean>={}):boolean
    {
       if(!DimensionLine.isDimensionLine(other)){ return false; }

       const id1 = this.sameId(flags);
       const id2 = other.sameId(flags);

       return id1 === id2;
    }

    /** To distinguish between Dimension Lines we can calculate the y coord of the offset projected from the position  */
    _projYAxis():number
    {
        const offsetComponents = this._resolveOffsetComponents();
        const absOffset = offsetComponents.map(c => Math.abs(c)) as [number, number, number];
        const offsetAngle = Math.atan2(absOffset[1], absOffset[0]) * 180 / Math.PI;
        const targetMiddle = this.targetMiddle();

        return (Math.round(offsetAngle) === 90)
            ? 0 // exception
            : (Math.round(offsetAngle) === 0)
                ? Math.abs(targetMiddle.y)
                : (Math.round(offsetComponents[0]) === 0)
                    ? 0 
                    : Math.round(Math.abs(targetMiddle.y) - (absOffset[1] * Math.abs(targetMiddle.x) / absOffset[0]))
    }

    //// EXPORT ////

    /** Output to data (to be send from Webworker to main app) */
    toData():DimensionLineData
    {
        const offsetComponents = this._resolveOffsetComponents();

        const d = {
            type: 'dimensionLine',
            targetStart: this.targetStart.toArray(), // raw target start
            targetEnd: this.targetEnd.toArray(), // raw target end
            targetDir: this.targetDir().toArray(),
            start: this._calculatePoint('start').toArray(), // start of real line (i.e. the arrow!)
            end: this._calculatePoint('end').toArray(),
            dir: this.dir().toArray(),
            value: this.value,
            static: this.static,
            units: this.units,
            offsetVec: offsetComponents,
            offsetLength: this.offsetLength,
            offset: [
                offsetComponents[0] * this.offsetLength,
                offsetComponents[1] * this.offsetLength,
                offsetComponents[2] * this.offsetLength,
            ],
            interactive: this.interactive,
            round: this.round,
            roundDecimals: this.roundDecimals,
            param: this._param,
            paramRemapSrc: this._paramRemapSrc,
            showUnits: this.showUnits,
        } as unknown as DimensionLineData

        return d;
    }

    /** Generate SVG for this dimension line
     *     if 3D the Dimension Line is projected to XY plane
     *     NOTE: we need to transform from Archiyou coordinate system to the SVG one (flip y)
     */
    toSVG(options?:{ drawingSize?:number, unitsPerMm?:number,
        projector?:{ point:(p:any) => {x:number, y:number, z:number}, normal?:{x:number, y:number, z:number} } }):string
    {   
        /*  Size the line weight, arrowheads and value text for the page.

            `unitsPerMm` — how many model units make one millimeter ON THE PAGE — is the exact
            way: a document view knows the scale it fits its drawing at, so the sizes below
            land at the millimeters set on the Annotator (DIMENSION_TEXT_SIZE_MM and friends)
            whatever the model measures. Callers without a page (a standalone toSVG(), an
            editor preview) pass `drawingSize` instead, which gets the same result for a
            drawing fitted to a ~200mm-wide view: view scale is page/drawing and these are
            drawing/N, so the two cancel. Fixed model units - the 0.5/1/1 this started with -
            are the one thing that cannot work: right for a 200mm part, invisible on a 1.5m
            elevation, where 1-unit text lands at ~0.08mm on paper. */
        const ann = this._archiyou?.annotator;
        const perMm = options?.unitsPerMm;
        const drawing = options?.drawingSize;

        const strokeW = perMm ? (ann?.DIMENSION_LINE_WIDTH_MM ?? 0.25) * perMm
                      : drawing ? drawing / 800 : 0.5;
        const fontSize = perMm ? (ann?.DIMENSION_TEXT_SIZE_MM ?? 4) * perMm
                      : drawing ? drawing / 80 : 1;
        // The arrow glyph is drawn 10 units wide (see _makeSvgArrow), so a 5mm arrowhead is
        // half a millimeter of scale per glyph unit.
        const arrowScale = perMm ? ((ann?.DIMENSION_ARROW_SIZE_MM ?? 5) * perMm) / 10
                      : drawing ? drawing / 667 : 1;

        /*  Into the drawing's plane, then into SVG's. `projector` is given when the drawing is
            taken from somewhere other than XY (an elevation modelled on XZ): a dimension has
            to turn with the geometry it measures, or it lands flat on the floor beside it. It
            also carries that plane's normal, which is what the offset stands off INSIDE — the
            two have to agree, or the line turns into the drawing and then steps out of it. */
        const to = options?.projector;

        const lineStart = this._calculatePoint('start', to?.normal);
        const lineEnd = this._calculatePoint('end', to?.normal);
        const lineMid = lineStart.copy()
                            .move(lineEnd.toVector()
                            .subtract(lineStart)
                            .scale(0.5));

        const flat = (p:any):[number,number,number] =>
        {
            const v = to ? to.point(p) : p;
            return [v.x, -v.y, 0]; // SVG's y axis points down
        };

        const lineStartArr = flat(lineStart);
        const lineEndArr = flat(lineEnd);
        const lineMidArr = flat(lineMid);

        // Convert the raw value (in this.units, the model unit) into the active
        // display system with an auto-picked unit + fractional inches. Always
        // labelled so the value is unambiguous when metric/imperial is toggled.
        const dimText = this._formatValueText();

        /*  A dimension shorter than its own value text has nowhere to put it: written at the
            middle it spills over both arrowheads and, with a backing box, hides the very
            distance it measures. So it steps aside — a short leader perpendicular to the
            line, with the value at the end of it, which is what a draughtsman does with a
            run of narrow dimensions. */
        const lineLength = Math.hypot(lineEndArr[0] - lineStartArr[0], lineEndArr[1] - lineStartArr[1]);
        const isSmall = lineLength < fontSize * this._setting('DIMENSION_SMALL_LINE_FACTOR');
        const labelAt = isSmall ? this._offsetLabelPoint(lineMidArr, lineStartArr, lineEndArr, fontSize) : lineMidArr;

        return `<g class="dimensionline">
                ${this._makeSvgLinePath(lineStartArr,lineEndArr,strokeW)}
                ${this._makeSvgArrow(lineStartArr, false, strokeW, arrowScale)}
                ${this._makeSvgArrow(lineEndArr, true, strokeW, arrowScale)}
                ${isSmall ? this._makeSvgLabelLeader(lineMidArr, labelAt, strokeW) : ''}
                ${this._makeSvgTextLabel(labelAt,dimText,fontSize)}
            </g>
        `
    }

    /** x/y of a PointLike, whatever shape it arrives in.
     *
     *  The SVG writers below are fed plain `[x,y,z]` arrays by toSVG() (it flips y on the
     *  array). @validate only VALIDATES — unlike the old @checkInput it does not convert its
     *  arguments — so reading `.x` off one silently produced `x1="undefined"`, i.e. dimension
     *  lines that were emitted but could never be drawn. */
    _svgXY(p:PointLike):{ x:number, y:number }
    {
        const a = p as any;
        if (Array.isArray(a)){ return { x: a[0] ?? 0, y: a[1] ?? 0 } }
        return { x: a?.x ?? 0, y: a?.y ?? 0 };
    }

    /** Where the value goes when it does not fit on the line: off to the side, on a leader.
     *
     *  Perpendicular to the dimension, on the side the dimension was already offset to — so
     *  it moves further AWAY from the shape being measured, never back over it. */
    _offsetLabelPoint(mid:Array<number>, start:Array<number>, end:Array<number>, fontSize:number):Array<number>
    {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const length = Math.hypot(dx, dy) || 1;

        let px = -dy / length;
        let py = dx / length;

        // SVG's y axis points down, so the offset vector flips with it
        const o = this._offsetComponents ?? [this.offsetVec?.x ?? 0, this.offsetVec?.y ?? 0, 0];
        if(px * (o[0] ?? 0) + py * -(o[1] ?? 0) < 0){ px = -px; py = -py }

        const distance = fontSize * this._setting('DIMENSION_LEADER_LENGTH_FACTOR');
        return [mid[0] + px*distance, mid[1] + py*distance, 0];
    }

    /** The leader from a too-short dimension line out to its value. */
    _makeSvgLabelLeader(from:Array<number>, to:Array<number>, strokeWidth:number=0.5):string
    {
        return `<line class="annotation line leader" style="stroke:black;stroke-width:${+strokeWidth.toFixed(4)}" `
            + `x1="${+from[0].toFixed(4)}" y1="${+from[1].toFixed(4)}" `
            + `x2="${+to[0].toFixed(4)}" y2="${+to[1].toFixed(4)}"/>`;
    }

    /** Generate a line segment in SVG (with SVG coords) */
    @validate(PointLikeSchema, PointLikeSchema)
    _makeSvgLinePath(start:PointLike, end:PointLike, strokeWidth:number=0.5)
    {  
       const startPoint = this._svgXY(start);
       const endPoint = this._svgXY(end);
       // stroke:black inline — the kernels' `.line` rule covers this too, but a dimension has
       // to survive being pulled out of that stylesheet (a DOM-less SVG rasterizer, a copy of
       // just the <g class="dimensionline">).
       return `<line class="annotation line" style="stroke:black;stroke-width:${+strokeWidth.toFixed(4)}" x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}"/>`
    }

    /** Place SVG arrow on position and rotation. Tip of the arrow is pivot */
    // NOTE: Arrow itself is already in SVG space (so y-axis is pointing downwards)
    @validate(PointLikeSchema, Type.Optional(Type.Boolean({ default: false })))
    _makeSvgArrow(at:PointLike, flip?:boolean, strokeWidth:number=0.5, arrowScale:number=1)
    {
       /*   Arrows in raw SVG
            - Pivot of arrow is at [0,0] pointing upwards (in SVG coordinate system of course)
            - use style for fill/stroke, so we can override it later (not tags fill="..")
            - TODO: different arrow styles
        */
       const SIZE = '10 5'; // Size of non-rotated graphic, use this for scaling
       // stroke:black — nothing else styles `.arrow-path`, and SVG's default stroke is `none`,
       // so without it the arrowheads were simply not drawn.
       const ARROWS_SVG  = {
            default: `<path class="arrow-path" style="fill:none;stroke:black;stroke-width:${+(strokeWidth / arrowScale).toFixed(4)}" d="M -5 5 L 0 0 L 5 5" />`
       }
       const DEFAULT_ARROW_SVG = 'default'

       const atPoint = this._svgXY(at);
        
       const rotation = (flip) ? this.getSVGRotation() - 90 + 180: this.getSVGRotation() - 90;
       
       // NOTE: underscores _ in attributes are omitted (_worldSize => worldSize)
       return `
          <g 
                class="annotation arrow ${(flip) ? 'end' : 'start'}"
                worldSize="${SIZE}"
                transform="translate(${atPoint.x} ${atPoint.y}) 
                            rotate(${rotation})
                            scale(${+arrowScale.toFixed(4)} ${+arrowScale.toFixed(4)})
                            ">
                            ${ARROWS_SVG[DEFAULT_ARROW_SVG]}
          </g>`
        
    }

    /** An annotation setting, from the Annotator when one is reachable. */
    _setting<K extends keyof typeof LABEL_DEFAULTS>(name:K):typeof LABEL_DEFAULTS[K]
    {
        const value = (this._archiyou?.annotator as any)?.[name];
        return (value === undefined) ? LABEL_DEFAULTS[name] : value;
    }

    /** The label's rotation in SVG space, in degrees.
     *
     *  A dimension reads ALONG the line it measures — that is what makes a drawing legible
     *  when it is full of them. Normalized into [-90,90) so the text is never upside down,
     *  which also makes a vertical dimension read bottom-to-top rather than top-to-bottom,
     *  as ISO drafting has it. */
    _labelAngle():number
    {
        let a = this.getSVGRotation();
        while(a >= 90){ a -= 180 }
        while(a < -90){ a += 180 }
        return a;
    }

    @validate(PointLikeSchema, Type.String())
    _makeSvgTextLabel(at:PointLike, text:string, fontSize:number=1): string
    {
        const atPoint = this._svgXY(at);
        const angle = this._labelAngle();

        /*  A backing box, so the value stays readable where the dimension line, the geometry
            or another dimension runs under it. Sized by glyph count rather than measured:
            there are no font metrics here (this runs in a worker and in node alike), and the
            legacy code only got them because it measured inside jsPDF at draw time. An
            over-wide box merely hides a little more of the line it sits on. */
        const background = this._setting('DIMENSION_TEXT_BACKGROUND_COLOR');

        const w = Math.max(1, text.trim().length) * fontSize * this._setting('DIMENSION_TEXT_CHAR_WIDTH_FACTOR')
                    + fontSize * this._setting('DIMENSION_TEXT_PADDING_FACTOR');
        const h = fontSize * this._setting('DIMENSION_TEXT_HEIGHT_FACTOR');

        const rect = (!background) ? '' :
            `<rect class="annotation text-background" `
            + `x="${+(atPoint.x - w/2).toFixed(4)}" y="${+(atPoint.y - h/2).toFixed(4)}" `
            + `width="${+w.toFixed(4)}" height="${+h.toFixed(4)}" `
            + `style="fill:${background};stroke:none" />`;

        /*  NOTE: the rotation is applied HERE, not left on a `data-angle` for a renderer to
            pick up later. There is no later any more — this SVG is the drawing, in the editor
            and in the PDF alike. */
        return `<g class="annotation dimension-label" transform="rotate(${+angle.toFixed(4)} ${atPoint.x} ${atPoint.y})">
                    ${rect}
                    <text
                        class="annotation text"
                        text-anchor="middle"
                        alignment-baseline="middle"
                        font-family="${DOC_DEFAULT_SVG_FONT_FAMILY}"
                        font-size="${+fontSize.toFixed(4)}"
                        style="fill:black;stroke-opacity:0;stroke-width:0"
                        x="${atPoint.x}"
                        y="${atPoint.y}"
                        dominant-baseline="central">${text}</text>
                </g>`;
    }

    // NOTE: do very little styling here to be able to easily style with CSS. Only stroke-width is good to set (default is 1, 0.5 sets it apart from Shapes)

    /** Formatted value text — shared by toSVG() and toDXF().
     *  Uses the active unit system (metric/imperial) when available, else falls
     *  back to the rounded raw value with optional unit suffix. */
    _formatValueText():string
    {
        const v = (typeof this.value === 'string') ? parseFloat(this.value) : this.value;
        const system = this._archiyou?.modeler?.unitSystem?.();
        const src = this.units;
        if (system && src && (src as string) in MM_PER_UNIT && typeof v === 'number')
        {
            /*  A metric drawing writes bare numbers — the unit is stated once, in the title
                block — so units are off unless the script asks (`dim({ showUnits: true })`).
                Imperial keeps its marks whatever that says: 6'-3" is how the number is
                WRITTEN, not a unit appended to it, and dropping them leaves 6 3. */
            const withUnit = (system === 'imperial') ? true : this.showUnits;

            /*  Auto-picking the "best" unit only makes sense when that unit is PRINTED:
                1200mm reads well as "1.2 m", and as plain "1.2" it means nothing at all on a
                drawing whose every other number is in millimeters. So with the unit hidden
                the value stays in the model's own unit — which is the one the title block
                names — and 1200 is written 1200. */
            return formatLength(toMM(v, src), system, {
                withUnit,
                unit: withUnit ? undefined : src,
                /*  `roundDecimals` was dead here — this branch runs whenever a unit system is
                    known, which is always, so `dim({ roundDecimals: 2 })` silently did
                    nothing. It applies to the bare model-unit value; with the unit printed the
                    formatter keeps its own decimals for the unit it picked, or "1.2 m" would
                    round to "1 m". */
                metricDecimals: withUnit ? undefined : this.roundDecimals,
            });
        }
        let text = ((this.round) ? roundTo(v, this.roundDecimals) : this.value).toString();
        if (this.showUnits) text += this.units;
        return text;
    }

    /** Export this dimension line as a real ALIGNED DXF dimension.
     *  Delegates the DXF encoding (DIMENSION entity + baked *D block) to the
     *  DXFDocument; this method only supplies the geometry + value text.
     *  See DXFExporter.DXFDocument.addAlignedDim(). */
    /** Write this dimension into a DXF document.
     *
     *  `to` maps model coordinates into the drawing's plane (DXFExporter's Projector) — a
     *  dimension on a wall elevation modelled on XZ has to travel to XY with the wall, or it
     *  lands flat on the floor. Without one the points are taken as they are, which is right
     *  for a drawing already on XY.
     */
    toDXF(doc:any /* DXFDocument */, layer:string='dimensions',
        to?:{ point:(p:any) => {x:number, y:number, z:number}, normal?:{x:number, y:number, z:number} }):this
    {
        const flat = (p:any) => { const v = to ? to.point(p) : p; return { x: v.x, y: v.y, z: 0 }; };

        const dimStart = flat(this._calculatePoint('start', to?.normal));
        const dimEnd = flat(this._calculatePoint('end', to?.normal));
        const textPos = {
            x: (dimStart.x + dimEnd.x) / 2,
            y: (dimStart.y + dimEnd.y) / 2,
            z: 0,
        };

        doc.addAlignedDim(
            flat(this.targetStart), // extension origin 1
            flat(this.targetEnd),   // extension origin 2
            dimStart,               // dim-line endpoint 1
            dimEnd,                 // dim-line endpoint 2
            textPos,
            this._formatValueText(),
            layer,
        );
        return this;
    }
}
