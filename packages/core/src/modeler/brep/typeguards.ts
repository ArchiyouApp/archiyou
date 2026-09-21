import { Point, Vector, Shape, Vertex, Edge, Wire, Face, Shell, ShapeCollection, VertexCollection } from '.'

import type { Side, Plane, CoordArray, Coord, Cursor, MainAxis, Axis, SketchPlaneName, PointLike,
          LinearShape, AnyShape, PointLikeSequence, AnyShapeCollection, AnyShapeSequence,
          AnyShapeOrCollection, MakeSolidInput, SelectionString,
          ShapeAttributes,
          LinearShapeTail, ShapeType, ShapeTypes, Pivot, ColorInput,
          PointLikeOrVertexCollection, PointLikeOrAnyShape, MakeShapeCollectionInput,
          PointLikeOrAnyShapeOrCollection, MakeWireInput, MakeFaceInput, Alignment,
          MakeShellInput, ThickenDirection, AnyShapeOrCollectionOrSelectionString,
          PointLikeOrAnyShapeOrCollectionOrSelectionString, SelectorPointRange,
          LayoutOptions, ModelUnits, DimensionOptions, DimensionLevelSettings,
          OrientationXY, AnnotationAutoDimStrategy,
        } from './types'

import { AXIS_TO_VECS, SIDES } from '.' // constants

// Import utils directly to avoid circular dependency (typeguards is re-exported by internal)
import { isNumeric } from '../../utils'
import { isRelativeCoordString } from './utils'

// The mesh kernel's point contract — brep accepts everything meshup does (see isPointLike).
// Type-only elsewhere in core, but needed as a value here.
import { isPointLike as isMeshupPointLike } from '@archiyou/meshup'



//// TYPE GUARD FUNCTIONS ////

/* NOTE: all the above types don't really exist on execution, that's why TS introduced type guards:
        functions that can test for a type during execution

  STRICT: We need to be strict here because otherwise we'll need to parse too much.
        We need to focus on conversing different values into a consistent input type

*/

export function isSide(o:any): o is Side
{
    return (typeof o === 'string') && SIDES.includes(o)
}

export function isPlane(o:any): o is Plane
{
    return ['xy','xz','yz'].includes(o)
}

export function isSketchPlaneName(o:any): o is SketchPlaneName
{
    return isPlane(o) || isSide(o);
}

//// PointLike ////

export function isCoordArray(p:any): p is CoordArray
{
    return Array.isArray(p) && p.length >= 2 && p.every(n => isCoord(n))
}

export function isCoord(c:any) : c is Coord
{
    return isNumeric(c) || isRelativeCoordString(c);
}

export function isMainAxis(o:any): o is MainAxis
{
    return (typeof o === 'string') && ['x','y','z'].includes(o);
}

export function isAxis(o:any) : o is Axis
{
    return (typeof o === 'string') && Object.keys(AXIS_TO_VECS).includes(o);
}

/** A value that can be read as a point.
 *
 *  This is the SHARED contract between the two kernels: meshup's `isPointLike` is the base,
 *  so meshup Points/Vectors/Vertices and plain `{x,y,z}` objects are accepted by brep methods
 *  unchanged. brep additionally accepts its own coord forms — relative coordinate strings
 *  ('+10', '50%') and axis shorthands ('x', 'xy') — so brep takes a strict superset.
 *  `Point.fromPointLike()` handles every form listed here. */
export function isPointLike(p: any=null) : p is PointLike
{
    return isCoord(p) // one or more Coords in args (incl. relative coord strings)
            || isAxis(p) // Axis: something like 'x' or 'xy'
            || ( Array.isArray(p) && isCoord(p[0]) ) // one or more Coords in array
            || p instanceof Vector
            || p instanceof Point
            || p instanceof Vertex
            || isMeshupPointLike(p); // meshup Point/Vector/Vertex and { x, y, z? }
}

export function isCursor(o:any) : o is Cursor
{
    if (!o) return false;

    return Point.isPoint(o.point) && Vector.isVector(o.direction);
}

//// Shapes ////

export function isAnyShape(o: any) : o is AnyShape
{
    return Shape.isShape(o); // just a clear shape
}

export function isAnyShapeCollection(o:any, ..._args: any[]) : o is AnyShapeCollection
{
    // NOTE: Removed allowing an Array - it creates too much confusion: see isAnyShapeSequence
    return ShapeCollection.isShapeCollection(o)
}

export function isAnyShapeSequence(o:any, ...args: any[]): o is AnyShapeSequence
{
    // This also included Arrays
    return isAnyShapeCollection(o) ||
        ( Array.isArray(o) && o.concat(args).every(s => isAnyShape(s)) ) ||
        ( o && [o,...args].every(s => isAnyShape(s)))
}

export function isAnyShapeOrCollection(o: any) : o is AnyShapeOrCollection
{
    return isAnyShape(o) ||  isAnyShapeCollection(o);
}

export function isLinearShape(o: any) : o is LinearShape
{
    return ( (o instanceof Edge) || (o instanceof Wire)) || (o instanceof Face) || (o instanceof Shell); // NOTE: we can convert Face/Shell to (outer) Wire
}

export  function isShapeAttributes(o:any): o is ShapeAttributes
{
    const SHAPE_ATTRIBUTE_KEYS = ['hidden','outline', 'visible'];

    return typeof o === 'object'
        && Object.keys(o).every(key => SHAPE_ATTRIBUTE_KEYS.includes(key))
}

//// PointLikeSequence ////

export function isPointLikeSequence(o: any, ...args: any[]) : o is PointLikeSequence
{
    // NOTE: a sequence if 2 points or more!
    return  (Array.isArray(o) && o.filter( e => isPointLike(e)).length >= 2) || // conventional: just an array of PointLike
            (isAnyShapeCollection(o) && o.getShapesByType('Vertex').length >= 2) ||
            (isPointLike(o) && args.some(e => isPointLike(e))) // allow single PointLike too with other PointLike args

}

//// Test Shape Constructor Inputs ////

export function isMakeSolidInput(o:any): o is MakeSolidInput
{
    return Array.isArray(o) && o.every( s => isAnyShape(s) && s.type == 'Shell') ||
        isAnyShapeCollection(o) && o.getShapesByType('Shell').length >= 1

}

//// SELECTIONS ////

export function isSelectionString(o:any): o is SelectionString
{
    return (typeof(o) === 'string')
}

//// ADDITIONAL TYPEGUARDS ////

export function isLinearShapeTail(o: any): o is LinearShapeTail
{
    return o === 'start' || o === 'end';
}

export function isShapeType(o: any): o is ShapeType
{
    return typeof o === 'string' && ['Vertex','Edge','Wire','Face','Shell','Solid'].includes(o);
}

export function isShapeTypes(o: any): o is ShapeTypes
{
    return Array.isArray(o) && o.every(isShapeType);
}

export function isPivot(o: any): o is Pivot
{
    return isPointLike(o) || typeof o === 'string';
}

export function isColorInput(o: any): o is ColorInput
{
    return typeof o === 'string' || typeof o === 'number';
}

export function isPointLikeOrVertexCollection(o: any): o is PointLikeOrVertexCollection
{
    return isPointLike(o) || (o instanceof VertexCollection);
}

export function isPointLikeOrAnyShape(o: any): o is PointLikeOrAnyShape
{
    return isPointLike(o) || isAnyShape(o);
}

export function isPointLikeOrAnyShapeOrCollection(o: any): o is PointLikeOrAnyShapeOrCollection
{
    return isPointLike(o) || isAnyShape(o) || isAnyShapeCollection(o);
}

export function isMakeShapeCollectionInput(o: any): o is MakeShapeCollectionInput
{
    return isPointLikeOrAnyShapeOrCollection(o) || isPointLikeSequence(o) || Array.isArray(o);
}

export function isMakeWireInput(o: any): o is MakeWireInput
{
    return isPointLikeSequence(o) || isAnyShapeOrCollection(o) || Array.isArray(o);
}

export function isMakeFaceInput(o: any): o is MakeFaceInput
{
    return (o instanceof Wire) || isPointLikeSequence(o) || isAnyShapeSequence(o);
}

export function isAlignment(o: any): o is Alignment
{
    return typeof o === 'string' || isPointLike(o);
}

export function isMakeShellInput(o: any): o is MakeShellInput
{
    return Array.isArray(o) || isAnyShapeCollection(o);
}

export function isThickenDirection(o: any): o is ThickenDirection
{
    return o === 'all' || o === 'center' || isPointLike(o) || isSide(o);
}

export function isAnyShapeOrCollectionOrSelectionString(o: any): o is AnyShapeOrCollectionOrSelectionString
{
    return isAnyShapeOrCollection(o) || typeof o === 'string';
}

export function isPointLikeOrAnyShapeOrCollectionOrSelectionString(o: any): o is PointLikeOrAnyShapeOrCollectionOrSelectionString
{
    return isPointLikeOrAnyShapeOrCollection(o) || typeof o === 'string';
}

export function isSelectorPointRange(o: any): o is SelectorPointRange
{
    return o !== null && typeof o === 'object' && ('point' in o || 'operator' in o || 'range' in o);
}

export function isLayoutOptions(o: any): o is LayoutOptions
{
    return o !== null && typeof o === 'object' && !isPointLike(o) && !isAnyShape(o)
        && ('autoRotate' in o || 'flatten' in o || 'stockWidth' in o || 'margin' in o || 'center' in o || 'algo' in o);
}

export function isModelUnits(o: any): o is ModelUnits
{
    return typeof o === 'string' && ['mm','cm','dm','m','km','in','ft','yd','mi'].includes(o);
}

export function isDimensionOptions(o: any): o is DimensionOptions
{
    return o !== null && typeof o === 'object' && !isAnyShape(o)
        && ('units' in o || 'offset' in o || 'offsetVec' in o || 'ortho' in o || 'roundDecimals' in o);
}

export function isDimensionLevelSettings(o: any): o is DimensionLevelSettings
{
    return o !== null && typeof o === 'object' && Array.isArray(o.levels);
}

export function isOrientationXY(o: any): o is OrientationXY
{
    return o === 'horizontal' || o === 'vertical';
}

export function isAnnotationAutoDimStrategy(o: any): o is AnnotationAutoDimStrategy
{
    return o === 'part' || o === 'levels';
}
