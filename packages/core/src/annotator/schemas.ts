import { Type } from 'typebox'
import { ModelUnitsSchema, PointLikeSchema } from '../modeler/schemas'

export const DimensionOptionsSchema = Type.Optional(
    Type.Object({
        /** The model unit the VALUE is in (mm, inch, …) — not whether to print it. */
        units:        Type.Optional(ModelUnitsSchema),
        /** Print the unit after the value. Off by default: a metric drawing writes bare
         *  numbers and states the unit once in the title block. Imperial marks (6'-3") are
         *  notation rather than a unit suffix and are always kept. */
        showUnits:    Type.Optional(Type.Boolean()),
        offset:       Type.Optional(Type.Number()),
        offsetVec:    Type.Optional(PointLikeSchema),
        // Use inline literals (no `default`) to prevent TypeBox from injecting
        // 'x' via MainAxisSchema's { default: 'x' } when ortho is not supplied.
        ortho:        Type.Optional(Type.Union([
                          Type.Boolean(),
                          Type.Literal('x'),
                          Type.Literal('y'),
                          Type.Literal('z'),
                      ])),
        roundDecimals:Type.Optional(Type.Integer({ minimum: 0 })),
    })
)

export const LabelOptionsSchema = Type.Optional(
    Type.Object({
        class:      Type.Optional(Type.String()),  // extra CSS class for styling the HTML label
        line:       Type.Optional(Type.Boolean()),  // draw a leader line from the anchor to the label
        offset:     Type.Optional(Type.Number()),   // leader length in screen px (default 40)
        angle:      Type.Optional(Type.Number()),   // leader angle in degrees, 90 = up on screen (default)
        circle:     Type.Optional(Type.Boolean()),  // draw a circle marker at the anchor end of the leader
    })
)
