/**
 *  schemas.ts
 *      Standard row schemas for Calc Tables. A schema describes a single row;
 *      a Table validates each of its rows against it (see Table.schema/validate).
 *      Defined with TypeBox so they can be validated at runtime with
 *      Check()/Errors() from 'typebox/value' (same pattern as ScriptParam).
 */

import { Type, type TSchema } from 'typebox'

/** One row of a `parts` table (as emitted by Make.partList). */
export const PartsRowSchema = Type.Object({
    part:     Type.String(),
    subpart:  Type.Optional(Type.String()),
    type:     Type.Union([Type.Literal('beam'), Type.Literal('plate')]),
    section:  Type.String(),
    length:   Type.Number(),
    quantity: Type.Number(),
})   // TypeBox Object allows extra props by default → footer/extra columns pass

/** One row of a `carbon` table (as emitted by MaterialManager.totals().byMaterial).
 *  `carbon` is optional on purpose: a material with no usable EPD data yields an
 *  undefined impact, which must stay distinguishable from a genuine zero. */
export const CarbonRowSchema = Type.Object({
    name:    Type.String(),
    group:   Type.String(),
    count:   Type.Number(),
    volume:  Type.Number(),
    mass:    Type.Number(),
    carbon:  Type.Optional(Type.Number()),
    partial: Type.Optional(Type.Boolean()),
})

/** Registry of standard schemas, addressable by name: table.schema('parts') */
export const STANDARD_SCHEMAS:Record<string, TSchema> = {
    parts: PartsRowSchema,
    carbon: CarbonRowSchema,
}
