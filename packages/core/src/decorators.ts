/**
 *  decorators.ts
 *  
 *  Archiyou is code CAD so we spend some time making a forgiving developer experience for writing scripts.
 *  This file provides decorators that validate and coerce method arguments using TypeBox schemas
 *  and give sane hints when they are invalid.
 *  
 *  TODO: More work to do after switching to the Typebox method. 
 * 
 */

import { Value } from 'typebox/value'
import { Type, type TSchema } from 'typebox'

/**
 * Shallow-recursive clone for plain values and arrays.
 * Class instances (Point, Vector, …) are returned as-is — TypeBox only needs
 * to mutate plain objects/arrays when applying defaults.
 */
function clone(value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (typeof value !== 'object') return value                          // primitives
    if (Array.isArray(value)) return value.map(clone)
    if (value.constructor === Object)                                    // plain object
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
    return value                                                         // class instance — pass through
}

/**
 * Validates and coerces method arguments using TypeBox schemas.
 * Pipeline per argument: Default → Decode (validate + coerce)
 * Schemas map 1:1 to positional arguments; trailing args beyond the schema list pass through untouched.
 *
 * Compatible with experimentalDecorators (legacy TypeScript decorator standard).
 *
 * Usage: @validate(PointSchema, PointSchema)
 */
export function validate(...schemas: TSchema[]) {
    return function (
        _target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        const originalMethod = descriptor.value
        descriptor.value = function (...args: any[]) {
            const processed = args.map((arg, i) => {
                const schema = schemas[i]
                if (!schema) return arg  // no schema → pass through

                const withDefault = (Value.Default as (s: unknown, v: unknown) => unknown)(schema, clone(arg ?? undefined))
                try {
                    return (Value.Decode as (s: unknown, v: unknown) => unknown)(schema, withDefault)
                } 
                catch (e) 
                {
                    // Nice error messages - see schemas for details
                    const cause = (e as any)?.cause as
                        { value: unknown; errors: Array<{ message?: string }> } | undefined

                    let received: string
                    try { received = JSON.stringify(arg) } catch { received = String(arg) }

                    const hint: string = (schema as any).title ?? (schema as any).description ?? ''

                    const details = cause?.errors
                        ?.map(err => err.message)
                        .filter(Boolean)
                        .join('; ')
                        ?? (e as Error).message

                    throw new TypeError(
                        `${propertyKey}(): argument ${i}${hint ? ` (${hint})` : ''} is invalid` +
                        ` — received ${received}: ${details}`
                    )
                }
            })
            return originalMethod.apply(this, processed)
        }
        return descriptor
    }
}

/** utility to wrap input validation type in optional */
export function optional(schema: TSchema) {
    return Type.Union([schema, Type.Undefined()])
}