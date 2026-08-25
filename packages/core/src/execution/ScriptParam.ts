/**
 * ScriptParam.ts
 *  Single ScriptParam class with JSON-Schema-driven behavior.
 *  param.schema is a JSON Schema object (using standard keywords: type, minimum, maximum,
 *  multipleOf, enum, properties, items, etc.) that both validates and defaults values.
 *  Use ScriptParam.fromData() to normalize and instantiate from raw data.
 */

import { Type, type TSchema } from 'typebox'
import { Check, Errors } from 'typebox/value'

import type { ModelUnits } from '../modeler/types'
import type { ParamBehaviourTarget, ParamBehaviourFn, ScriptParamType, ScriptParamData } from './types'

import { ScriptParamSchema } from './schemas'

/**
 * Pre-defined JSON Schemas for each ScriptParamType.
 *
 * These are the canonical value schemas stored in ScriptParam.schema.
 * They follow standard JSON Schema keywords so that TypeBox's Check()
 * and any JSON-Schema-aware consumer can validate and interpret them uniformly.
 *
 * When creating a param of a given type, start from the matching entry here
 * and override the fields you need (e.g. minimum, maximum, enum, …).
 */
export const PARAM_TYPE_SCHEMAS: Record<ScriptParamType, Record<string, unknown>> =
{
    number:
    {
        type:       'number',
        default:    0,
        minimum:    0,
        maximum:    100,
        multipleOf: 1,
    },
    // True / false toggle
    boolean:
    {
        type:    'boolean',
        default: false,
    },
    // Just a simple text
    text:
    {
        type:      'string',
        default:   '',
        minLength: 0,
        maxLength: 256,
    },
    // Pick one value from a fixed list (rendered as select / radio) */
    options:
    {
        type:    'string',
        enum:    [],       // caller must supply the allowed values
        default: '',
    },

    /** Ordered array of values of the same type */
    list:
    {
        type:     'array',
        items:    { type: 'string' },
        default:  [],
        minItems: 0,
    },

    /** Free-form JSON object */
    object:
    {
        type:       'object',
        properties: {},
        default:    {},
    },
}


export class ScriptParam
{
    type!: ScriptParamType; // type of Param
    name!: string // unique (lowercase) name used in script 
    label!: string // human-friendly label for UI - can be translated at app layer
    group?: string
    description?: string
    default?: any // default value

    enabled?: boolean
    visible?: boolean
    order?: number

    units?: ModelUnits
    iterable?: boolean
    
    /** JSON Schema for validating this param's value based on type
     *  This contains the boundaries following JSON schema standards. For example for number: minimum, maximum, multipleOf 
    */
    schema!: TSchema

    _value?: any // current value (run time)
    _definedProgrammatically?: boolean
    /** Dynamic behaviours keyed by target. In transit (worker→app) values are fn
     *  source strings; after app-side hydration they are live functions. Never
     *  serialized in toData()/paramToData() — applying a behaviour is NOT a
     *  definition change and never sets _definedProgrammatically. */
    _behaviours?: Partial<Record<ParamBehaviourTarget, string | ParamBehaviourFn>>

    /** Create fresh Param */
    constructor()
    {
        console.warn('ScriptParam: Direct constructor usage is not recommended. Use ScriptParam.fromData() for proper validation and defaults.')
    }

    /** Generates fresh Param of the given type, filling default values */
    static fromType(type: ScriptParamType): ScriptParam
    {
        const schema = PARAM_TYPE_SCHEMAS[type];
        if(!schema) throw new Error(`Unsupported ScriptParam type: ${type}. Supported types are: ${Object.keys(PARAM_TYPE_SCHEMAS).join(', ')}`);
        
        return ScriptParam.fromData({
            type:   type,
            schema:  { ...schema },
            default: schema.default, // get default from schema
        } as ScriptParamData);
    }

    /** Factory method to create a ScriptParam from raw data */
    static fromData(param: ScriptParamData): ScriptParam
    {
        const normalized = (param && typeof param === 'object' && typeof param.name === 'string')
            ? { ...param, name: param.name.toUpperCase() }
            : param

        // If no schema (or empty schema) is provided, fall back to the standard
        // schema for the declared type. Explicit fields in param.schema always win.
        const typeKey = (normalized as any)?.type as ScriptParamType | undefined
        const baseSchema = (typeKey && typeKey in PARAM_TYPE_SCHEMAS)
            ? PARAM_TYPE_SCHEMAS[typeKey]
            : {}

        // Normalize null → undefined for optional string fields so that older
        // script data (which uses null as "no value") passes schema validation.
        const n = normalized as any;
        const nullToUndef = <T>(v: T): T | undefined => (v === null ? undefined : v);

        // Migrate legacy flat `options` array → schema.enum (old script format compat)
        const legacyOptions = (typeKey === 'options' && Array.isArray(n?.options) && !n?.schema?.enum)
            ? n.options as string[]
            : undefined;

        const withSchema: ScriptParamData = {
            ...(normalized as ScriptParamData),
            description: nullToUndef(n?.description),
            units:       nullToUndef(n?.units),
            label:       nullToUndef(n?.label),
            group:       nullToUndef(n?.group),
            schema: {
                ...baseSchema,
                ...(legacyOptions ? { enum: legacyOptions } : {}),
                ...(normalized as any)?.schema,
            },
        }

        ScriptParam._assertSchema(ScriptParamSchema, withSchema, 'ScriptParam.fromData()')

        return new ScriptParam()._init(withSchema)
    }

    /** Validate param definition and return its canonical form */
    static validate(param: ScriptParamData): ScriptParamData
    {
        return ScriptParam.fromData(param).toData()
    }

    _init(data: ScriptParamData): this
    {
        this.type                     = data.type as unknown as ScriptParamType
        this.name                     = data.name
        this.label                    = data.label ?? data.name
        this.group                    = data.group
        this.enabled                  = data.enabled
        this.visible                  = data.visible
        this.order                    = data.order
        this.description              = data.description
        this.units                    = data.units as unknown as ModelUnits
        this._value                   = data._value
        this._definedProgrammatically = data._definedProgrammatically
        this._behaviours              = data._behaviours

        this.schema  = Type.Unsafe(data.schema)
        this.default = data.default ?? (data.schema as any).default
        this.iterable = this.isIterable()

        return this
    }

    /** Validate value against the parameter's value schema */
    validateValue(v: any): boolean
    {
        return this.validateValueVerbose(v).success
    }

    /** Validate value against the parameter's value schema, returning errors */
    validateValueVerbose(v: any): { success: boolean; errors: Array<string> }
    {
        const success = Check(this.schema, v)
        const errors = success
            ? []
            : ScriptParam._getSchemaErrors(this.schema, v).map(msg => `ScriptParam: ${msg} for "${this.name}"`)

        errors.forEach(error => console.error(error))
        return { success, errors }
    }

    /** The value schema is the param schema itself */
    getValueSchema(): TSchema
    {
        return this.schema
    }

    isIterable(): boolean
    {
        const s = this.schema as any
        return s.type === 'number' || s.type === 'boolean' || Array.isArray(s.enum)
    }

    numValues(): number
    {
        const s = this.schema as any
        if (s.type === 'number') return Math.floor(((s.maximum ?? 0) - (s.minimum ?? 0)) / (s.multipleOf ?? 1))
        if (s.type === 'boolean') return 2
        if (Array.isArray(s.enum)) return s.enum.length
        return 1
    }

    *iterateValues(): Generator<any>
    {
        const s = this.schema as any

        if (s.type === 'number')
        {
            for (let i = s.minimum ?? 0; i <= (s.maximum ?? 0); i += s.multipleOf ?? 1)
            {
                yield i
            }
            return
        }
        if (s.type === 'boolean')
        {
            yield true
            yield false
            return
        }
        if (Array.isArray(s.enum))
        {
            for (const v of s.enum) yield v
            return
        }
        yield this.default
    }

    toData(): ScriptParamData
    {
        return {
            type:                     this.type as unknown as ScriptParamData['type'],
            name:                     this.name,
            label:                    this.label,
            group:                    this.group,
            enabled:                  this.enabled,
            visible:                  this.visible,
            order:                    this.order,
            iterable:                 this.iterable,
            description:              this.description,
            units:                    this.units,
            default:                  this.default,
            _value:                   this._value,
            _definedProgrammatically: this._definedProgrammatically,
            schema:                   this.schema as unknown as Record<string, unknown>,
        }
    }

    /** Serialize this param as a $PARAMS.define() call for self-contained JS export.
     *  Only UI-defined params are meaningful here; programmatic params are already
     *  in the script code. */
    toScriptJs(): string
    {
        const s = this.schema as any;
        const opts: Record<string, any> = {};

        // top-level fields — skip defaults / empty values
        if (this.label && this.label !== this.name) opts.label      = this.label;
        if (this.group)                              opts.group      = this.group;
        if (this.description)                        opts.description = this.description;
        if (this.units)                              opts.units      = this.units;
        if (this.order     !== undefined)            opts.order      = this.order;
        if (this.visible   === false)                opts.visible    = false;
        if (this.enabled   === false)                opts.enabled    = false;
        if (this.default   !== undefined)            opts.default    = this.default;

        // schema keywords — per type
        switch (this.type as string)
        {
            case 'number':
                if (s.minimum   !== undefined) opts.minimum   = s.minimum;
                if (s.maximum   !== undefined) opts.maximum   = s.maximum;
                if (s.multipleOf !== undefined) opts.multipleOf = s.multipleOf;
                break;
            case 'text':
                if (s.minLength !== undefined && s.minLength !== 0) opts.minLength = s.minLength;
                if (s.maxLength !== undefined) opts.maxLength = s.maxLength;
                break;
            case 'options':
                if (Array.isArray(s.enum)) opts.enum = s.enum;
                break;
            case 'list':
                opts.listItemType = s.items?.type ?? 'string';
                break;
        }

        const entries = Object.entries(opts)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ');
        const optsStr = entries ? `{ ${entries} }` : '{}';

        return `$PARAMS.define('${this.name}', '${this.type}', ${optsStr});`;
    }

    //// VALIDATION ////

    static _getSchemaErrors(schema: TSchema, value: unknown): Array<string>
    {
        // @ts-ignore TS2589: TypeBox Errors can trigger excessively deep type instantiation
        return Errors(schema, value).map(error => error.message)
    }

    static _assertSchema(schema: TSchema, value: unknown, context: string): void
    {
        if (!Check(schema, value))
        {
            // @ts-ignore TS2589
            throw new Error(`${context}: ${ScriptParam._getSchemaErrors(schema, value).join('; ')}`)
        }
    }
}

