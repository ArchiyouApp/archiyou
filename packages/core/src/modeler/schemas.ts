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
        maxTime:       Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: null, description: 'Solver time budget in seconds. It ends the run by the clock, so the layout then depends on the machine: prefer maxIterations' })),
        maxIterations: Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: 2000, description: 'Hard cap on ruin-&-recreate iterations' })),
        rotation:      Type.Optional(Type.Union([Type.Boolean(), Type.Function([Type.Any(), Type.Number()], Type.Boolean())], { default: true, description: 'Allow 90° rotation of parts: true or false for all, or a function (shape, index) => boolean that decides per part' })),
        seed:          Type.Optional(Type.Number({ default: 0, description: 'Seed of the solver\'s random choices: the same parts and seed give the same layout, another seed tries another one' })),
        maxStages:     Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: null, description: 'Most cutting stages per sheet (2: strips first, then pieces out of each strip); null for unlimited' })),
        firstCut:      Type.Optional(Type.Union([Type.Literal('horizontal'), Type.Literal('vertical'), Type.Null()], { default: null, description: 'Direction of the first cut on every sheet; null lets the solver choose' })),
    }
)

/** A way to load an item: 'fixed' as it is, 'upright' also turned about the vertical, 'free' in any of the six
 *  orientations, or the axes of the item that may point up and whether it may be turned about the vertical */
const Pack3DAxisSchema = Type.Union([Type.Literal('x'), Type.Literal('y'), Type.Literal('z')])

export const Pack3DOrientationsSchema = Type.Union([
    Type.Literal('fixed'),
    Type.Literal('upright'),
    Type.Literal('free'),
    Type.Object({
        up: Type.Union([Pack3DAxisSchema, Type.Array(Pack3DAxisSchema)], { description: 'The axes of the item (as modelled) that may point up' }),
        yaw: Type.Optional(Type.Boolean({ default: true, description: 'Whether the item may be turned about the vertical' })),
    }),
])

const Pack3DAxleSchema = Type.Object({
    at: Type.Number({ description: 'Where the support is, along the length of the bin from its front wall (x = 0), in model units. It may be outside the bin' }),
    maxLoad: Type.Number({ description: 'The most it may carry, in kg (lb with imperial units)' }),
})

export const Pack3DBinSchema = Type.Object({
    name:      Type.Optional(Type.String({ description: 'Name of the kind of bin, for the report' })),
    length:    Type.Number({ description: 'Inner length of the bin (x), in model units' }),
    width:     Type.Number({ description: 'Inner width of the bin (y), in model units' }),
    height:    Type.Number({ description: 'Inner height of the bin (z, up), in model units' }),
    maxWeight: Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: null, description: 'The most the load may weigh, in kg (lb with imperial units); null for no limit' })),
    cost:      Type.Optional(Type.Number({ default: 1, description: 'What one bin costs: the plan with the lowest total cost is looked for' })),
    stock:     Type.Optional(Type.Union([Type.Number(), Type.Null()], { default: null, description: 'How many bins of this kind there are; null for as many as needed' })),
    door:      Type.Optional(Type.Union([Type.Literal('+x'), Type.Literal('-x'), Type.Literal('+y'), Type.Literal('-y'), Type.Null()], { default: null, description: 'The side the load leaves by; null for from the top only' })),
    balance:   Type.Optional(Type.Object({
        cog:   Type.Optional(Type.Object({
            x: Type.Optional(Type.Number({ description: 'How far the centre of gravity may be from the middle of the floor along the length, as a fraction (0 to 0.5) of the length' })),
            y: Type.Optional(Type.Number({ description: 'The same across the width' })),
        })),
        axles: Type.Optional(Type.Tuple([Pack3DAxleSchema, Pack3DAxleSchema], { description: 'Exactly two supports along the length (the kingpin and the rear axles of a trailer): the load is shared between them by the lever rule, and neither may be lifted or overloaded' })),
    }, { description: 'The balance the load should have. Best effort: a bin that cannot meet it says so in the report' })),
})

export const Pack3DOptionsSchema = Type.Object(
    {
        bins:           Type.Array(Pack3DBinSchema, { description: 'The kinds of bin (pallet, crate, trailer) the shapes are loaded into; one entry is one fixed kind' }),
        rotation:       Type.Optional(Type.Union([Type.Boolean(), Pack3DOrientationsSchema, Type.Function([Type.Any(), Type.Number()], Type.Any())], { default: 'upright', description: "How shapes may be turned: 'upright' (default: as modelled, z up, also turned about the vertical), 'fixed', 'free', the axes that may point up, true (upright) or false (fixed), or a function (shape, index) => any of these that decides per shape" })),
        weight:         Type.Optional(Type.Union([Type.Number(), Type.Function([Type.Any(), Type.Number()], Type.Number())], { description: "Weight of a shape in kg (lb with imperial units): a number for all, or a function (shape, index) => number. Default: shape.weight(), from its material, or 0" })),
        maxLoad:        Type.Optional(Type.Union([Type.Number(), Type.Null(), Type.Function([Type.Any(), Type.Number()], Type.Any())], { default: null, description: 'The weight that may rest on a shape, directly or through others, in kg: a number for all, or a function (shape, index) => number; 0 for fragile; null for no limit' })),
        stop:           Type.Optional(Type.Union([Type.Number(), Type.Function([Type.Any(), Type.Number()], Type.Number())], { default: 0, description: 'At which stop a shape is unloaded: lower stops are unloaded first, so they end up nearer the door and on top; 0 for no order' })),
        support:        Type.Optional(Type.Number({ default: 0.8, description: 'The share (0 to 1) of the base of a shape that has to rest on the floor or on other shapes; its centre also has to be over that contact. 1 for full support' })),
        gap:            Type.Optional(Type.Number({ default: 0, description: 'Clearance kept between shapes along x and y, in model units' })),
        seed:           Type.Optional(Type.Number({ default: 0, description: "Seed of the search's random choices: the same shapes, options and seed give the same plan on every machine" })),
        maxIterations:  Type.Optional(Type.Number({ default: 100, description: 'Steps of the search that tries to improve the plan; 0 for the first plan found' })),
        maxEvaluations: Type.Optional(Type.Number({ default: 40000000, description: 'A limit on the work, in placements tried (not on the time): a big job ends with a valid plan that is less tight rather than late, and the same plan on every machine' })),
    }
)

/** Options of make.foldoutView(): the plan with its elevations folded out around it */
export const FoldoutViewOptionsSchema = Type.Object(
    {
        cutHeight:       Type.Optional(Type.Number({ description: 'Height (z) of a horizontal section for the plan, like 1500 for a floor plan. Left out: the plan is the plain top view' })),
        views:           Type.Optional(Type.Array(Type.Union([Type.Literal('front'), Type.Literal('back'), Type.Literal('left'), Type.Literal('right')]), { default: ['front', 'back', 'left', 'right'], description: 'The elevations around the plan' })),
        projection:      Type.Optional(Type.Union([Type.Literal('third'), Type.Literal('first')], { default: 'third', description: "'third' angle: each view on the side it looks at, its top toward the plan. 'first' angle (ISO): on the opposite side, its base toward the plan" })),
        gap:             Type.Optional(Type.Number({ description: 'Distance between the plan and each view, in model units. Default: a fifth of the largest side of the plan' })),
        projectionLines: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('outline'), Type.Literal('features')], { default: true, description: "Thin lines from the plan to each view: true or 'outline' from the outer corners, 'features' from every corner seen from that side, false for none" })),
        dims:            Type.Optional(Type.Union([Type.Boolean(), Type.Literal('overall'), Type.Literal('views')], { default: true, description: "Dimension lines: true or 'overall' for the width and depth of the plan and the height, 'views' also the width and height of every view, false for none" })),
        at:              Type.Optional(Type.Union([Type.Array(Type.Number()), Type.Object({ x: Type.Number(), y: Type.Number() })], { default: [0, 0], description: 'Where the centre of the plan goes. Use this rather than moving the result afterwards: dimension lines do not follow a move' })),
        hiddenLines:     Type.Optional(Type.Boolean({ default: false, description: 'Draw hidden lines too (dashed)' })),
        method:          Type.Optional(Type.String({ description: "Hidden-line method of the projections, like 'exact' or 'raycast'" })),
        featureAngle:    Type.Optional(Type.Number({ description: 'Draw an edge between two faces when they meet at more than this angle (degrees)' })),
    }
)
