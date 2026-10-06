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
import type { ParamBehaviourTarget, ParamBehaviourFn, ScriptParamType, ScriptParamData, NumberRangesMode } from './types'

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

    /** A slider with two handles. minimum/maximum/multipleOf are the track: on an
     *  array they are ignored by Check(), so they only say where the handles can go.
     *  The item count, the bounds of each number and the default follow from the
     *  track; see ScriptParam.normalizeRangesSchema() */
    'number-ranges':
    {
        type:       'array',
        mode:       'range',
        minimum:    0,
        maximum:    100,
        multipleOf: 1,
        default:    [0, 100], // a split has 3 numbers, so it replaces this with its own
    },
}

/** The settings of a 'number-ranges' param, read from its schema */
export interface NumberRangesConfig
{
    mode:       NumberRangesMode
    minimum:    number
    maximum:    number
    multipleOf: number
    minSpan:    number
    labels:     Array<string>
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

    /** Set while fromData() constructs, so its own `new ScriptParam()` does not trip the warning below. */
    private static _viaFactory = false

    /** Create fresh Param */
    constructor()
    {
        if (!ScriptParam._viaFactory)
        {
            console.warn('ScriptParam: Direct constructor usage is not recommended. Use ScriptParam.fromData() for proper validation and defaults.')
        }
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

        const mergedSchema = {
            ...baseSchema,
            ...(legacyOptions ? { enum: legacyOptions } : {}),
            ...(normalized as any)?.schema,
        }
        const isRanges = (typeKey as string) === 'number-ranges'
        const schema = (isRanges) ? ScriptParam.normalizeRangesSchema(mergedSchema) : mergedSchema

        const withSchema: ScriptParamData = {
            ...(normalized as ScriptParamData),
            description: nullToUndef(n?.description),
            units:       nullToUndef(n?.units),
            label:       nullToUndef(n?.label),
            group:       nullToUndef(n?.group),
            // a ranges default is fitted to the track, so the top-level one has to follow
            ...((isRanges && n?.default !== undefined) ? { default: schema.default } : {}),
            schema,
        }

        ScriptParam._assertSchema(ScriptParamSchema, withSchema, 'ScriptParam.fromData()')

        ScriptParam._viaFactory = true
        try { return new ScriptParam()._init(withSchema) }
        finally { ScriptParam._viaFactory = false }
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
        // Check() first: the rules of a 'number-ranges' param assume an array of numbers
        const problems = (!Check(this.schema, v))
            ? ScriptParam._getSchemaErrors(this.schema, v)
            : ((this.type as string) === 'number-ranges') ? ScriptParam._rangesErrors(this.schema, v as Array<number>) : []
        const errors = problems.map(msg => `ScriptParam: ${msg} for "${this.name}"`)

        errors.forEach(error => console.error(error))
        return { success: problems.length === 0, errors }
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
            case 'number-ranges':
                opts.mode       = s.mode ?? 'range';
                opts.minimum    = s.minimum;
                opts.maximum    = s.maximum;
                opts.multipleOf = s.multipleOf;
                if (s.minSpan) opts.minSpan = s.minSpan;
                if (Array.isArray(s.labels) && s.labels.length > 0) opts.labels = s.labels;
                break;
        }

        const entries = Object.entries(opts)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ');
        const optsStr = entries ? `{ ${entries} }` : '{}';

        return `$PARAMS.define('${this.name}', '${this.type}', ${optsStr});`;
    }

    //// NUMBER RANGES ////

    /** The settings of a 'number-ranges' schema, with their defaults */
    static rangesConfig(schema: Record<string, any>): NumberRangesConfig
    {
        const num = (v: any, fallback: number): number => (typeof v === 'number' && Number.isFinite(v)) ? v : fallback
        const minimum = num(schema?.minimum, 0)
        const multipleOf = num(schema?.multipleOf, 1)

        return {
            mode:       (schema?.mode === 'split') ? 'split' : 'range',
            minimum,
            maximum:    Math.max(minimum, num(schema?.maximum, 100)),
            multipleOf: (multipleOf > 0) ? multipleOf : 1,
            minSpan:    Math.max(0, num(schema?.minSpan, 0)),
            labels:     Array.isArray(schema?.labels) ? schema.labels.map(String) : [],
        }
    }

    /** Complete a 'number-ranges' schema from its track (minimum, maximum, multipleOf):
     *      range → 2 numbers, each within [minimum, maximum]
     *      split → 3 parts, each within [minSpan, maximum - minimum]
     *  Always derived, never taken from the input, so an edit of the track cannot
     *  leave them stale. A default that does not fit is fitted: with a track that
     *  follows another param (`maximum: $LENGTH`) no fixed default fits every run. */
    static normalizeRangesSchema(schema: Record<string, any>): Record<string, any>
    {
        const c = ScriptParam.rangesConfig(schema)
        const split = c.mode === 'split'
        const total = c.maximum - c.minimum
        const count = (split) ? 3 : 2
        // Handles snap to the grid from minimum (as the number slider does). The numbers are
        // then multiples of multipleOf only when minimum (range) or the total (split) is one;
        // demanding it otherwise would leave no valid value at all
        const onGrid = ScriptParam._isMultiple((split) ? total : c.minimum, c.multipleOf)

        const out: Record<string, any> = {
            ...schema,
            mode:       c.mode,
            minimum:    c.minimum,
            maximum:    c.maximum,
            multipleOf: c.multipleOf,
            minItems:   count,
            maxItems:   count,
            items: {
                type:    'number',
                minimum: (split) ? c.minSpan : c.minimum,
                maximum: (split) ? total : c.maximum,
                ...(onGrid ? { multipleOf: c.multipleOf } : {}),
            },
        }
        out.default = ScriptParam.fitRanges(out, schema.default) ?? ScriptParam._rangesDefault(c)

        return out
    }

    /** Bring a 'number-ranges' value within the schema: snapped to multipleOf, inside
     *  the track, ranges at least minSpan long, split parts scaled to add up to the total.
     *  A value that already fits comes back unchanged. Returns undefined for anything
     *  that is not two (range) or three (split) numbers. */
    static fitRanges(schema: Record<string, any>, value: any): Array<number> | undefined
    {
        const c = ScriptParam.rangesConfig(schema)
        const split = c.mode === 'split'
        const count = (split) ? 3 : 2
        const usable = Array.isArray(value) && value.length === count && value.every(v => typeof v === 'number' && Number.isFinite(v))
        if (!usable) { return undefined }

        const decimals = (String(c.multipleOf).split('.')[1] ?? '').length
        const round = (v: number): number => Number(v.toFixed(decimals))
        const snap = (v: number): number => round(c.minimum + Math.round((v - c.minimum) / c.multipleOf) * c.multipleOf)
        const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

        // Both modes are two handles on the track; work on those
        const sum = (value as Array<number>).reduce((acc, v) => acc + Math.max(0, v), 0)
        const total = c.maximum - c.minimum
        const handles = (split)
            ? (sum > 0)
                ? [c.minimum + Math.max(0, value[0]) / sum * total, c.minimum + (Math.max(0, value[0]) + Math.max(0, value[1])) / sum * total]
                : [c.minimum + total / 3, c.minimum + total * 2 / 3]
            : [Math.min(value[0], value[1]), Math.max(value[0], value[1])]

        // Split keeps minSpan to the ends as well, a range only between the handles
        const edge = (split) ? c.minSpan : 0
        const lo = c.minimum + edge
        const hi = c.maximum - edge
        const h1 = clamp(snap(handles[0]), lo, hi)
        const h2 = clamp(Math.max(snap(handles[1]), h1 + c.minSpan), lo, hi)
        const first = clamp(Math.min(h1, h2 - c.minSpan), lo, hi)

        return (split)
            ? [round(first - c.minimum), round(h2 - first), round(c.maximum - h2)]
            : [round(first), round(h2)]
    }

    /** Without a default: the whole track (range) or three parts as equal as the grid allows (split) */
    static _rangesDefault(c: NumberRangesConfig): Array<number>
    {
        if (c.mode === 'range') { return [c.minimum, c.maximum] }

        const total = c.maximum - c.minimum
        return ScriptParam.fitRanges({ ...c }, [total / 3, total / 3, total / 3]) as Array<number>
    }

    /** What Check() cannot say about a 'number-ranges' value (it already has the right
     *  count of numbers within their bounds) */
    static _rangesErrors(schema: Record<string, any>, value: Array<number>): Array<string>
    {
        const c = ScriptParam.rangesConfig(schema)
        const eps = 1e-9 * Math.max(1, Math.abs(c.minimum), Math.abs(c.maximum))

        if (c.mode === 'split')
        {
            const total = c.maximum - c.minimum
            const sum = value.reduce((acc, v) => acc + v, 0)
            return (Math.abs(sum - total) > eps)
                ? [`the parts ${JSON.stringify(value)} add up to ${sum} — must add up to ${total}`]
                : []
        }

        const [from, to] = value
        if (to < from - eps) { return [`the range ${JSON.stringify(value)} runs backwards — from must be <= to`] }
        return (to - from < c.minSpan - eps)
            ? [`the range ${JSON.stringify(value)} is ${to - from} long — must be at least ${c.minSpan}`]
            : []
    }

    static _isMultiple(v: number, step: number): boolean
    {
        const ratio = v / step
        return Math.abs(ratio - Math.round(ratio)) < 1e-9 * Math.max(1, Math.abs(ratio))
    }

    //// VALIDATION ////

    static _getSchemaErrors(schema: TSchema, value: unknown): Array<string>
    {
        // @ts-ignore TS2589: TypeBox Errors can trigger excessively deep type instantiation
        return Errors(schema, value).map(error => error.message)
    }

    /** Why a value does not fit a schema, one readable line per problem, naming where it is
     *  and what it holds: `entry 3 ("windowleft1"): sill is 3500 — must be <= 3000`. A list
     *  entry is named by its `name` (or the schema's labelProp) when it has one.
     *  @param max  lines to return at most; the rest is summed up in a last line */
    static describeSchemaErrors(schema: TSchema, value: unknown, max: number = 5): Array<string>
    {
        const labelProp = (schema as any)?.items?.labelProp ?? 'name';
        const at = (path: string): Array<string> => path.split('/').filter(p => p !== '');
        const valueAt = (parts: Array<string>): unknown => parts.reduce((v: any, key) => v?.[key], value);
        const show = (v: unknown): string => (typeof v === 'string') ? `"${v}"` : JSON.stringify(v) ?? String(v);

        // @ts-ignore TS2589: TypeBox Errors can trigger excessively deep type instantiation
        const lines = [...new Set((Errors(schema, value) as Array<any>).map((error) =>
        {
            const parts = at(error.instancePath ?? '');
            // Where: a list entry by its number (and name), then the property path inside it
            const isEntry = Array.isArray(value) && parts.length > 0 && /^\d+$/.test(parts[0]);
            const entry = isEntry ? (value as Array<any>)[Number(parts[0])] : undefined;
            const entryName = (entry && typeof entry[labelProp] === 'string' && entry[labelProp]) ? ` (${show(entry[labelProp])})` : '';
            const where = isEntry ? `entry ${parts[0]}${entryName}: ` : '';
            const property = (isEntry ? parts.slice(1) : parts).join('.');

            const rule =
                (error.keyword === 'multipleOf') ? `must be a multiple of ${error.params?.multipleOf}` :
                (error.keyword === 'enum') ? `must be one of ${(error.params?.allowedValues ?? []).map(show).join(', ')}` :
                (error.keyword === 'required') ? `misses ${(error.params?.requiredProperties ?? []).join(', ')}` :
                (error.keyword === 'additionalProperties') ? `has no property ${(error.params?.additionalProperties ?? []).join(', ')}` :
                error.message;

            return (error.keyword === 'required' || error.keyword === 'additionalProperties')
                ? `${where}${property || 'the value'} ${rule}`
                : `${where}${property || 'the value'} is ${show(valueAt(parts))} — ${rule}`;
        }))];

        return (lines.length > max)
            ? [...lines.slice(0, max), `…and ${lines.length - max} more`]
            : lines;
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


//// PARAM VALUES IN A QUERY STRING ////

/*
 * A configurator link carries its configuration in the query string:
 *
 *     /configurators/archiyou/shelf:1.2?WIDTH=1200&SHELVES=4&lang=de
 *
 * Values are written with the param's own name, in the plainest form the type allows, so
 * the link stays readable and hand-editable. Only values that differ from what the
 * configurator opens with are written, and anything unreadable (an unknown param, a value
 * the schema rejects) is ignored with a warning, never applied: a link shared before the
 * script was re-published must degrade to the defaults, not break the page.
 *
 * Here rather than in the editor because the server reads the same links (the social card
 * of a configurator), and it must read them exactly as the page does.
 */

/** Query keys the configurator itself owns; never treated as a param. Params are matched
 *  by name anyway, but a script is free to call a param LANG. */
const RESERVED_QUERY_KEYS = ['lang']

/**
 * Param values from a query string, coerced by each param's declared type and checked
 * against its schema. Keys that name no param, and values the param rejects, are left
 * out. Param names are matched case-insensitively: people retype these by hand.
 */
export function decodeParamValues(search: string, params: Array<ScriptParam>): Record<string, any>
{
    const byName = new Map(params.map(p => [p.name.toUpperCase(), p]))
    const values: Record<string, any> = {}

    new URLSearchParams(search).forEach((raw, key) =>
    {
        if (RESERVED_QUERY_KEYS.includes(key.toLowerCase())) return

        const param = byName.get(key.toUpperCase())
        if (!param) return

        const value = coerceQueryValue(raw, param)
        if (value === undefined)
        {
            console.warn(`decodeParamValues(): ignoring "${key}=${raw}" — not a valid ${param.type} value.`)
            return
        }
        if (!param.validateValue(value))
        {
            console.warn(`decodeParamValues(): ignoring "${key}=${raw}" — outside what "${param.name}" allows.`)
            return
        }

        values[param.name] = value
    })

    return values
}

/**
 * The query string for a set of values: every key that was already in `search` and is not
 * a param is kept as it stands (?lang=, campaign tags, whatever the link carried), every
 * param that differs from its default is added, every param at its default is dropped.
 */
export function encodeParamValues(search: string, params: Array<ScriptParam>, values: Record<string, any>): string
{
    const isParam = new Set(params.map(p => p.name.toUpperCase()))
    const next = new URLSearchParams()

    new URLSearchParams(search).forEach((raw, key) =>
    {
        const reserved = RESERVED_QUERY_KEYS.includes(key.toLowerCase())
        if (reserved || !isParam.has(key.toUpperCase())) next.append(key, raw)
    })

    params.forEach((param) =>
    {
        const value = values[param.name]
        if (value === undefined || sameParamValue(value, openingValue(param))) return
        next.set(param.name, serializeQueryValue(value, param))
    })

    return next.toString()
}

/** What the configurator opens with for this param when the URL says nothing. A published
 *  script can carry a saved `_value`, and writing that into the link would pin a value
 *  nobody chose. */
function openingValue(param: ScriptParam): any
{
    return param._value ?? param.default
}

/** One raw query value → a typed param value, or undefined when it cannot be read as one.
 *  Kept deliberately literal: `?WIDTH=1200`, not `?WIDTH=%221200%22`. */
function coerceQueryValue(raw: string, param: ScriptParam): any
{
    switch (param.type)
    {
        case 'number':
        {
            const n = Number(raw)
            return (raw.trim() !== '' && Number.isFinite(n)) ? n : undefined
        }
        case 'boolean':
        {
            const v = raw.trim().toLowerCase()
            if (['true', '1', 'yes', 'on'].includes(v)) return true
            if (['false', '0', 'no', 'off'].includes(v)) return false
            return undefined
        }
        case 'number-ranges':
        {
            // ?BAYS=25,50,25 — plain numbers; the param's validation decides whether they fit
            const numbers = raw.split(',').map(part => (part.trim() === '') ? NaN : Number(part))
            return numbers.every(Number.isFinite) ? numbers : undefined
        }
        case 'list':
        case 'object':
        {
            // The only types a URL cannot express plainly; JSON keeps them exact.
            try { return JSON.parse(raw) }
            catch { return undefined }
        }
        default:
            // text / options — the string IS the value
            return raw
    }
}

function serializeQueryValue(value: any, param: ScriptParam): string
{
    switch (param.type)
    {
        case 'number-ranges':
            return Array.isArray(value) ? value.join(',') : String(value)
        case 'list':
        case 'object':
            return JSON.stringify(value)
        default:
            return String(value)
    }
}

/** Structural equality, so a list/object at its default is recognised as untouched. */
function sameParamValue(a: any, b: any): boolean
{
    if (a === b) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    try { return JSON.stringify(a) === JSON.stringify(b) }
    catch { return false }
}
