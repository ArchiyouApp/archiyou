import { Type } from 'typebox'
import { isPointLike, type PointLike } from '@archiyou/meshup'


export const ModelModeSchema = Type.Union(
    [
        Type.Literal('mesh'),
        Type.Literal('brep'),
    ],
    { default: 'mesh' }
)

/** Model units */
export const ModelUnitsSchema = Type.Union(
    [
        Type.Literal('mm'),
        Type.Literal('cm'),
        Type.Literal('dm'),
        Type.Literal('m'),
        Type.Literal('km'),
        Type.Literal('inch'),
        Type.Literal('feet'),
        Type.Literal('yd'),
        Type.Literal('mi'),
    ],
    { default: 'mm' }
)


export const MainAxisSchema = Type.Union(
    [
        Type.Literal('x'),
        Type.Literal('y'),
        Type.Literal('z'),
    ],
    { default: 'x' }
)


/** PointLike schema — validates against meshup's isPointLike guard */
// @ts-ignore TS2589: TypeBox Refine causes excessively deep type instantiation
export const PointLikeSchema = Type.Refine(
    Type.Unknown(),
    (v): v is PointLike => isPointLike(v),
    'expected PointLike: Point, Vector, Vertex, number[], or {x,y,z}'
)
export type { PointLike }


export const PackOptionsSchema = Type.Object(
    {
        width:         Type.Number({ default: 2440, description: 'Sheet width' }),
        height:        Type.Number({ default: 1220, description: 'Sheet height' }),
        kerf:          Type.Optional(Type.Number({ default: 0, description: 'Minimum gap between placed parts (split evenly on each side)' })),
        maxTime:       Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: null, description: 'Solver time budget in seconds' })),
        maxIterations: Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: 200, description: 'Hard cap on ruin-&-recreate iterations' })),
        rotation:      Type.Optional(Type.Boolean({ default: true, description: 'Allow 90° rotation of parts' })),
    }
)