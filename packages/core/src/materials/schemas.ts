/**
 *  materials/schemas.ts
 *
 *  Runtime schema for the materials database. Defined with TypeBox so it can be
 *  validated with Check()/Errors() from 'typebox/value' — the same pattern as
 *  ScriptSchema and calc/schemas.ts.
 *
 *  MaterialManager.load() validates the bundled database against this and warns on
 *  failure rather than throwing: a malformed entry must never break a user's script.
 *  The generator (tools/materials-generator) emits materials.schema.json from this
 *  so the `$schema` pointer in materials.json actually resolves.
 */

import { Type, type TSchema, type TLiteral } from 'typebox'

import { LCA_MODULES, MATERIAL_PROPERTY_KEYS } from './types'

type LiteralTuple<T extends readonly string[]> = { -readonly [K in keyof T]: TLiteral<T[K] & string> }

/** A measurable property with its canonical unit and citation. */
export const MaterialPropertySchema = Type.Object({
    value:       Type.Number(),
    unit:        Type.String(),
    description: Type.Optional(Type.String()),
    source:      Type.Optional(Type.String()),
})

/** A texture image mapped at a real-world size (mm). */
export const MaterialTextureSchema = Type.Object({
    image:      Type.String(),
    realWidth:  Type.Number({ exclusiveMinimum: 0 }),
    realHeight: Type.Number({ exclusiveMinimum: 0 }),
    repeat:     Type.Optional(Type.Boolean()),
})

export const MaterialPBRSchema = Type.Object({
    color:     Type.Optional(Type.String()),
    alpha:     Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    metallic:  Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    roughness: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
})

export const MaterialVizSchema = Type.Object({
    textures: Type.Optional(Type.Object({
        section:   Type.Optional(MaterialTextureSchema),
        sides:     Type.Optional(MaterialTextureSchema),
        thinSides: Type.Optional(MaterialTextureSchema),
    })),
    pbr: Type.Optional(MaterialPBRSchema),
})

/** Per-module kgCO2e values, keyed by EN 15804 module. Sparse — absent ≠ zero. */
const LCAModulesSchema = Type.Object(
    Object.fromEntries(LCA_MODULES.map(m => [m, Type.Optional(MaterialPropertySchema)])),
)

export const MaterialLCASchema = Type.Object({
    standard:          Type.Union([Type.Literal('EN 15804+A2'), Type.Literal('EN 15804+A1')]),
    indicator:         Type.Union([Type.Literal('GWP-total'), Type.Literal('GWP-fossil')]),
    declaredUnit:      Type.String(),
    declaredUnitValue: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    density:           Type.Optional(MaterialPropertySchema),
    modules:           LCAModulesSchema,
    biogenic:          Type.Optional(LCAModulesSchema),
    // Provenance is required: unsourced life-cycle numbers are worse than none.
    source: Type.Object({
        dataset:    Type.String({ minLength: 1 }),
        uuid:       Type.String({ minLength: 1 }),
        version:    Type.String({ minLength: 1 }),
        url:        Type.String({ minLength: 1 }),
        retrieved:  Type.String({ minLength: 1 }),
        validUntil: Type.Optional(Type.String()),
    }),
})

export const MATERIAL_GROUPS = [
    'wood', 'metal', 'stone', 'concrete', 'masonry', 'glass',
    'plastic', 'insulation', 'finish', 'membrane', 'composite', 'other',
] as const

export const MaterialSchema = Type.Object({
    name:        Type.String({ minLength: 1 }),
    // `as LiteralTuple` — see ScriptSchema.ts: mapping a const array yields an
    // array, not a tuple, and Type.Union over a non-tuple infers `never`.
    group:       Type.Union(MATERIAL_GROUPS.map(g => Type.Literal(g)) as LiteralTuple<typeof MATERIAL_GROUPS>),
    aliases:     Type.Optional(Type.Array(Type.String())),
    description: Type.Optional(Type.String()),

    ...Object.fromEntries(MATERIAL_PROPERTY_KEYS.map(k => [k, Type.Optional(MaterialPropertySchema)])),

    lca: Type.Optional(MaterialLCASchema),
    viz: Type.Optional(MaterialVizSchema),
})

/** The materials.json document as a whole. */
export const MaterialsDbSchema = Type.Object({
    $schema:   Type.Optional(Type.String()),
    meta:      Type.Optional(Type.Unknown()),
    materials: Type.Array(MaterialSchema),
})

/** Registry, addressable by name — mirrors calc/schemas.ts. */
export const MATERIAL_SCHEMAS: Record<string, TSchema> = {
    material: MaterialSchema,
    lca:      MaterialLCASchema,
    db:       MaterialsDbSchema,
}
