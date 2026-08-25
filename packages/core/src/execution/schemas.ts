/**
 * execution/schemas.ts
 * TypeBox schemas for ScriptParam validation.
 *      Import these into classes that need structural validation.
 *      The Script-level schema (ScriptSchema/ScriptPublishedSchema/…) lives in
 *      packages/core/src/ScriptSchema.ts and imports the param helpers below.
 */

import { Type } from 'typebox'

import { ScriptParamType } from './types'

//// PARAMS ////

export const ScriptParamSchema = Type.Object(
{
    type:                     Type.Enum(ScriptParamType),
    name:                     Type.Optional(Type.String({ minLength: 3 })), // can be null on creation
    label:                    Type.Optional(Type.String()),
    group:                    Type.Optional(Type.String()),
    enabled:                  Type.Optional(Type.Boolean()),
    visible:                  Type.Optional(Type.Boolean()),
    order:                    Type.Optional(Type.Number()),
    iterable:                 Type.Optional(Type.Boolean()),
    description:              Type.Optional(Type.String()),
    units:                    Type.Optional(Type.String()),
    default:                  Type.Optional(Type.Unknown()),
    schema: Type.Record(Type.String(), Type.Unknown()),
    
    _value:                   Type.Optional(Type.Unknown()),
    _definedProgrammatically: Type.Optional(Type.Boolean()),
    _behaviours:              Type.Optional(Type.Record(Type.String(), Type.String())),
})

// Param record + preset helpers — exported for ScriptSchema.ts to reuse.
export const ParamRecordSchema = Type.Record(Type.String(), ScriptParamSchema)
export const ParamPresetsSchema = Type.Record(Type.String(), ParamRecordSchema)
