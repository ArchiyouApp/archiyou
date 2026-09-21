/**
 *  inputSchemas.ts
 *
 *  The type registry behind the brep `@checkInput` decorator (see ./decorators.ts).
 *
 *  Each entry describes one input type the brep API accepts, by name:
 *
 *    check           how to test a value  — a typeguard function, a Class (tested with
 *                    `instanceof`), or a `typeof` string
 *    transformInput  how to coerce a value INTO this type, when it is used as a
 *                    uniformize target. `null` means "not a conversion target"
 *    errorMessage    what to tell the user when the check fails
 *
 *  Split out of the decorator itself so the table can be read, extended and tested on its
 *  own — the decorator only cares about lookup.
 *
 *  IMPORTANT: the table is built inside a function, not at module scope. The brep classes
 *  form an import cycle through the `.` barrel, so at module-evaluation time several of the
 *  constructors below are still undefined. Building lazily (and allowing string names) is
 *  what keeps that cycle harmless.
 *
 *  PointLike: per the kernel-unification decision this uses MESHUP's `isPointLike` as the
 *  base contract, so meshup Points/Vectors/Vertices and plain `{x,y,z}` objects flow into
 *  brep methods unchanged. brep's own extra coord forms (relative strings like '+10' / '50%',
 *  and axis shorthands like 'x'/'xy') are unioned on top — brep accepts a superset, and the
 *  two kernels agree on the common core. See `isPointLike` in ./typeguards.ts.
 */

import { isNumeric } from './utils'

import { ALL_SHAPE_NAMES, SIDES, ALIGNMENTS_ADD_TO_SIDES } from './constants'

import { Point, Vector, Shape, Vertex, Edge, Wire, Face, Shell, Solid,
    ShapeCollection, VertexCollection } from '.'

import { isPointLike, isPivot, isAxis, isColorInput, isMainAxis, isSide, isCursor,
    isLinearShape, isLinearShapeTail, isShapeType, isShapeTypes, isAnyShape,
    isPointLikeOrVertexCollection, isPointLikeSequence, isPointLikeOrAnyShape,
    isAnyShapeSequence, isAnyShapeCollection, isMakeShapeCollectionInput,
    isAnyShapeOrCollection, isPointLikeOrAnyShapeOrCollection, isMakeWireInput,
    isMakeFaceInput, isAlignment, isMakeShellInput, isThickenDirection,
    isAnyShapeOrCollectionOrSelectionString, isSelectionString,
    isPointLikeOrAnyShapeOrCollectionOrSelectionString, isSelectorPointRange,
    isLayoutOptions, isModelUnits, isDimensionOptions, isDimensionLevelSettings,
    isOrientationXY, isAnnotationAutoDimStrategy } from './typeguards'

//// TYPES ////

export interface InputErrorMessage
{
    /** Value forms the user could legitimately have supplied */
    possible: Array<string>,
    /** Extra nudge appended to the error */
    hint?: string,
}

export interface InputTypeInfo
{
    /** Display name, as used in error messages and as a decorator target string */
    name: string,
    /** The Class or typeguard this entry is keyed on — decorators may reference it directly */
    obj: any,
    /** Class (instanceof), typeguard function, or a `typeof` string */
    check: any,
    errorMessage: InputErrorMessage,
    /** Coercion INTO this type, or null when this type is never a uniformize target */
    transformInput: ((v: any) => any) | null,
}

//// REGISTRY ////

let _registry: Record<string, InputTypeInfo> | null = null

/** The input-type table. Built on first use — see the module note on import cycles. */
export function inputTypes(): Record<string, InputTypeInfo>
{
    if (_registry) return _registry

    _registry = {
        'Boolean': {
            name: 'Boolean',
            obj: Boolean,
            check: (v: any) => typeof v === 'boolean',
            errorMessage: { possible: ['true', 'false'] },
            transformInput: Boolean,
        },
        'Number': {
            name: 'Number',
            obj: Number,
            check: isNumeric,
            errorMessage: { possible: ['Number'] },
            transformInput: Number,
        },
        'Number.isInteger': {
            name: 'Integer',
            obj: Number.isInteger,
            check: Number.isInteger,
            errorMessage: { possible: ['Integer'] },
            transformInput: (v: any) => parseInt(v),
        },
        'String': {
            name: 'String',
            obj: String,
            check: 'string', // typeof
            errorMessage: { possible: ['String'] },
            transformInput: String,
        },
        'Array': {
            name: 'Array',
            obj: Array,
            check: Array, // instanceof
            errorMessage: { possible: ['Array'] },
            transformInput: Array,
        },
        'Side': {
            name: 'Side',
            obj: isSide,
            check: isSide,
            errorMessage: { possible: SIDES },
            transformInput: null,
        },
        'isPointLike': {
            name: 'PointLike',
            obj: isPointLike,
            check: isPointLike,
            errorMessage: { possible: [`[x,y,z] or ['+x','-y','+z']`, 'Point', 'Vector', 'Vertex', '{ x, y, z }'] },
            transformInput: (v: any) => Point.fromPointLike(v),
        },
        'Vector': {
            name: 'Vector',
            obj: Vector,
            check: Vector, // instanceof
            errorMessage: { possible: ['Vector', `[x,y,z]`, 'Point', 'Vertex'] },
            transformInput: (v: any) => Vector.fromPointLike(v),
        },
        'Point': {
            name: 'Point',
            obj: Point,
            check: Point, // instanceof
            errorMessage: { possible: ['Point', `[x,y,z]`, 'Vector', 'Vertex'] },
            transformInput: (v: any) => Point.fromPointLike(v),
        },
        'isAlignment': {
            name: 'Alignment',
            obj: isAlignment,
            check: isAlignment,
            errorMessage: { possible: SIDES.concat(ALIGNMENTS_ADD_TO_SIDES) },
            transformInput: null,
        },
        'isAxis': {
            name: 'Axis',
            obj: isAxis,
            check: isAxis,
            errorMessage: { possible: ['x', 'y', 'z', 'xy', 'yz', 'xz'] },
            transformInput: null,
        },
        'isMainAxis': {
            name: 'MainAxis',
            obj: isMainAxis,
            check: isMainAxis,
            errorMessage: { possible: ['x', 'y', 'z'] },
            transformInput: null,
        },
        'isOrientationXY': {
            name: 'OrientationXY',
            obj: isOrientationXY,
            check: isOrientationXY,
            errorMessage: { possible: ['horizontal', 'vertical'] },
            transformInput: null,
        },
        'isPivot': {
            name: 'Pivot',
            obj: isPivot,
            check: isPivot,
            errorMessage: {
                possible: ['Array of relative ("+10") or absolute coordinates', 'Point', 'Vector', 'Vertex',
                    'combinations of left|right|top|bottom|front|back'],
            },
            transformInput: null,
        },
        'isPointLikeSequence': {
            name: 'PointLikeSequence',
            obj: isPointLikeSequence,
            check: isPointLikeSequence,
            errorMessage: {
                possible: ['(PointLike, PointLike) and no other arguments', 'Array<PointLike>', 'Shape', 'ShapeCollection'],
                hint: 'Also make sure you provide one or more points!',
            },
            transformInput: null,
        },
        'isColorInput': {
            name: 'ColorInput',
            obj: isColorInput,
            check: isColorInput,
            errorMessage: { possible: ['color names: blue, red, green', 'hex: #FF0000'] },
            transformInput: null,
        },
        'isShapeType': {
            name: 'ShapeType',
            obj: isShapeType,
            check: isShapeType,
            errorMessage: { possible: ALL_SHAPE_NAMES },
            transformInput: null,
        },
        'isShapeTypes': {
            name: 'ShapeTypes',
            obj: isShapeTypes,
            check: isShapeTypes,
            errorMessage: { possible: [`An array of ${ALL_SHAPE_NAMES}`] },
            transformInput: null,
        },
        'Shape': {
            name: 'Shape',
            obj: Shape,
            check: Shape, // instanceof
            errorMessage: { possible: ['Shape', 'PointLike'] },
            transformInput: null,
        },
        'isAnyShape': {
            name: 'AnyShape',
            obj: isAnyShape,
            check: isAnyShape,
            errorMessage: { possible: ALL_SHAPE_NAMES },
            transformInput: null,
        },
        'Vertex': {
            name: 'Vertex',
            obj: Vertex,
            check: Vertex, // instanceof
            errorMessage: { possible: ['Coord (number or "+-number")', 'Point', 'Vector', 'Vertex'] },
            transformInput: (v: any) => Vertex.fromPointLike(v),
        },
        'Edge': {
            name: 'Edge',
            obj: Edge,
            check: Edge, // instanceof
            errorMessage: { possible: ['Edge'] },
            transformInput: null,
        },
        'Wire': {
            name: 'Wire',
            obj: Wire,
            check: Wire, // instanceof
            errorMessage: { possible: ['Wire'] },
            transformInput: (v: any) => Wire.fromAll(v),
        },
        'isLinearShape': {
            name: 'LinearShape',
            obj: isLinearShape,
            check: isLinearShape,
            errorMessage: { possible: ['Edge', 'Wire', 'Face', 'Shell'] },
            transformInput: null,
        },
        'isPointLikeOrAnyShape': {
            name: 'PointLikeOrAnyShape',
            obj: isPointLikeOrAnyShape,
            check: isPointLikeOrAnyShape,
            errorMessage: {
                possible: ['Array of relative ("+10") or absolute coordinates', 'Point', 'Vector', 'Vertex']
                    .concat(ALL_SHAPE_NAMES),
            },
            transformInput: null,
        },
        'isLinearShapeTail': {
            name: 'LinearShapeTail',
            obj: isLinearShapeTail,
            check: isLinearShapeTail,
            errorMessage: { possible: ['start', 'end'] },
            transformInput: null,
        },
        'isAnyShapeOrCollection': {
            name: 'AnyShapeOrCollection',
            obj: isAnyShapeOrCollection,
            check: isAnyShapeOrCollection,
            errorMessage: { possible: ALL_SHAPE_NAMES.concat('ShapeCollection') },
            transformInput: null,
        },
        'isAnyShapeSequence': {
            name: 'AnyShapeSequence',
            obj: isAnyShapeSequence,
            check: isAnyShapeSequence,
            errorMessage: { possible: ['Array<Shape>', 'ShapeCollection'] },
            transformInput: null,
        },
        'isAnyShapeCollection': {
            name: 'AnyShapeCollection',
            obj: isAnyShapeCollection,
            check: isAnyShapeCollection,
            errorMessage: { possible: ['ShapeCollection', 'VertexCollection'] },
            transformInput: (v: any) => ShapeCollection.fromAll(v),
        },
        'isMakeShapeCollectionInput': {
            name: 'MakeShapeCollectionInput',
            obj: isMakeShapeCollectionInput,
            check: isMakeShapeCollectionInput,
            errorMessage: { possible: ['PointLike', 'PointLikeSequence', 'AnyShape', 'ShapeCollection', 'Array<PointLike|AnyShape>'] },
            transformInput: null,
        },
        'ShapeCollection': {
            name: 'ShapeCollection',
            obj: ShapeCollection,
            check: ShapeCollection, // instanceof
            errorMessage: { possible: ['ShapeCollection'] },
            transformInput: (v: any) => ShapeCollection.fromAll(v),
        },
        'VertexCollection': {
            name: 'VertexCollection',
            obj: VertexCollection,
            check: VertexCollection, // instanceof
            errorMessage: { possible: ['ShapeCollection', 'VertexCollection'] },
            transformInput: (v: any) => VertexCollection.fromAll(v),
        },
        'PointLikeOrVertexCollection': {
            name: 'PointLikeOrVertexCollection',
            obj: isPointLikeOrVertexCollection,
            check: isPointLikeOrVertexCollection,
            errorMessage: { possible: ['Vertex', 'VertexCollection'] },
            transformInput: (v: any) => VertexCollection.fromAll(v),
        },
        'isPointLikeOrAnyShapeOrCollection': {
            name: 'PointLikeOrAnyShapeOrCollection',
            obj: isPointLikeOrAnyShapeOrCollection,
            check: isPointLikeOrAnyShapeOrCollection,
            errorMessage: {
                possible: ALL_SHAPE_NAMES.concat(['ShapeCollection',
                    'Array of relative ("+10") or absolute coordinates', 'Point', 'Vector', 'Vertex']),
            },
            transformInput: null,
        },
        'isMakeWireInput': {
            name: 'MakeWireInput',
            obj: isMakeWireInput,
            check: isMakeWireInput,
            errorMessage: { possible: ['PointLikeSequence', 'Shape', 'ShapeCollection', 'Array of those'] },
            transformInput: null,
        },
        'isMakeFaceInput': {
            name: 'MakeFaceInput',
            obj: isMakeFaceInput,
            check: isMakeFaceInput,
            errorMessage: { possible: ['Face', 'Wire', 'PointLikeSequence', 'ShapeCollection with Edges', 'Array of Edges'] },
            transformInput: null,
        },
        'isMakeShellInput': {
            name: 'MakeShellInput',
            obj: isMakeShellInput,
            check: isMakeShellInput,
            errorMessage: { possible: ['Array<Face>', 'ShapeCollection /w Faces'] },
            transformInput: null,
        },
        'Face': {
            name: 'Face',
            obj: Face,
            check: Face,
            errorMessage: { possible: ['Face'] },
            transformInput: (v: any) => new Face(v),
        },
        'Shell': {
            name: 'Shell',
            obj: Shell,
            check: Shell,
            errorMessage: { possible: ['Shell'] },
            transformInput: (v: any) => new Shell(v),
        },
        'Solid': {
            name: 'Solid',
            obj: Solid,
            check: Solid,
            errorMessage: { possible: ['Solid'] },
            transformInput: (v: any) => new Solid(v),
        },
        'Cursor': {
            name: 'Cursor',
            obj: isCursor,
            check: isCursor,
            errorMessage: { possible: ['Cursor: { point: Point, direction: Vector }'] },
            transformInput: null,
        },
        'isThickenDirection': {
            name: 'ThickenDirection',
            obj: isThickenDirection,
            check: isThickenDirection,
            errorMessage: { possible: ['all/center', 'PointLike'].concat(SIDES) },
            transformInput: null,
        },
        'isAnyShapeOrCollectionOrSelectionString': {
            name: 'AnyShapeOrCollectionOrSelectionString',
            obj: isAnyShapeOrCollectionOrSelectionString,
            check: isAnyShapeOrCollectionOrSelectionString,
            errorMessage: { possible: ['AnyShape', 'ShapeCollection', 'SelectorString (ex: "V||front", "E[0-2]")'] },
            transformInput: null,
        },
        'isPointLikeOrAnyShapeOrCollectionOrSelectionString': {
            name: 'PointLikeOrAnyShapeOrCollectionOrSelectionString',
            obj: isPointLikeOrAnyShapeOrCollectionOrSelectionString,
            check: isPointLikeOrAnyShapeOrCollectionOrSelectionString,
            errorMessage: { possible: ['PointLike', 'AnyShape', 'ShapeCollection', 'SelectorString (ex: "V||front", "E[0-2]")'] },
            transformInput: null,
        },
        'isSelectionString': {
            name: 'SelectionString',
            obj: isSelectionString,
            check: isSelectionString,
            errorMessage: { possible: ['Any selector string: "V||front", "E|Z" (see docs!)'] },
            transformInput: null,
        },
        'isSelectorPointRange': {
            name: 'SelectorPointRange',
            obj: isSelectorPointRange,
            check: isSelectorPointRange,
            errorMessage: { possible: ['SelectorPointRange'] },
            transformInput: null,
        },
        'isLayoutOptions': {
            name: 'LayoutOptions',
            obj: isLayoutOptions,
            check: isLayoutOptions,
            errorMessage: { possible: ['LayoutOptions: { margin: number, flatten: boolean, stock: string, groupSame: boolean }'] },
            transformInput: null,
        },
        'isAnnotationAutoDimStrategy': {
            name: 'AnnotationAutoDimStrategy',
            obj: isAnnotationAutoDimStrategy,
            check: isAnnotationAutoDimStrategy,
            errorMessage: { possible: ['part', 'levels'] },
            transformInput: null,
        },
        'isDimensionOptions': {
            name: 'DimensionOptions',
            obj: isDimensionOptions,
            check: isDimensionOptions,
            errorMessage: { possible: ['DimensionOptions: { units:string, offset:number, offsetVec:Vector, ortho:boolean, roundDecimals:int }'] },
            transformInput: null,
        },
        'isDimensionLevelSettings': {
            name: 'DimensionLevelSettings',
            obj: isDimensionLevelSettings,
            check: isDimensionLevelSettings,
            errorMessage: { possible: ['DimensionLevelSettings: [{ axis:mainAxis, at:number, coordType?:relative|absolute, align?:min|max|auto, minDistance?:number, offset?:number }]'] },
            transformInput: null,
        },
        'isModelUnits': {
            name: 'ModelUnits',
            obj: isModelUnits,
            check: isModelUnits,
            errorMessage: { possible: [`ModelUnits: 'mm','cm','dm','m','km','inch','feet','yd','mi'`] },
            transformInput: null,
        },
    }

    return _registry
}

/** Look an input type up by decorator target — either its display name / registry key
 *  (`'PointLike'`, `'isPointLike'`, `'Vector'`) or the Class / typeguard itself
 *  (`Vector`, `isPointLike`). Returns null (with a warning) for unknown targets, so a
 *  mis-configured decorator degrades to "no check" rather than taking the kernel down. */
export function getInputType(target: any): InputTypeInfo | null
{
    if (target === null || target === undefined) return null

    for (const [key, info] of Object.entries(inputTypes()))
    {
        if (info.obj === target || info.name === target || key === target)
        {
            return info
        }
    }

    console.warn(`getInputType(): unknown decorator target "${target}". Supply a registered ` +
        `name, a Class, or an Array [Class|name, defaultValue] in @checkInput(). ` +
        `Known names: ${Object.values(inputTypes()).map(i => i.name).join(', ')}`)

    return null
}

/** @internal test seam — drops the memoised table so a test can rebuild it. */
export function _resetInputTypes(): void
{
    _registry = null
}
