import type { ModelUnits } from "../modeler/types";
import type { ComputedFooterRow } from "../calc/types";
import { type Static } from 'typebox';

import { ScriptParamSchema } from './schemas';

//// SCRIPT ////

// The Script-level schema/types now live in packages/core/src/ScriptSchema.ts.
// Re-exported here so existing `execution/types` consumers keep working.
export type { ScriptData, ScriptPublishedData, ScriptPublishedFulfillmentData, ScriptSharedData as ScriptShared } from '../ScriptSchema'

export type ScriptOutputCategory = 'model'|'metrics'|'tables'|'docs'
export type ScriptOutputFormatInternal = 'internal'; // basics

export type ScriptOutputFormatModel = 'buffer'|'gltf'|'glb'|'step'|'stl'|'svg'|'dae'|'obj'|'dxf'|'amf'|'fcstd'|'ifc'|'scad'|'btlx'; // TODO:brep,dxf
export type ScriptOutputFormatMetric = 'json'|'xlsx';
export type ScriptOutputFormatTable = 'json'|'xlsx';
export type ScriptOutputFormatDoc = 'json'|'pdf'|'svg'|'svg-pages';
export type ScriptOutputFormat = ScriptOutputFormatInternal|ScriptOutputFormatModel
                                |ScriptOutputFormatMetric|ScriptOutputFormatTable|
                                ScriptOutputFormatDoc

export type ModelFormat = 'buffer'|'glb'|'svg'


/** The Script seperated into statements */
export interface ScriptStatement
{
    code:string; // the real code
    startIndex?: number;
    endIndex?: number;
    lineStart?:number; // the line the statement starts (it can actually span multiple lines)
    lineEnd?:number;
    columnStartIndex?:number;
    columnEndIndex?:number;
}

export interface ScriptStatementResult extends ScriptStatement
{
    status: 'error'|'success'
    message?: string,
    duration?: number
    durationPerc?:number // share of total statement time; set by Runner in per-statement mode
    /** Serial ids (see Shape `_sid`) of the shapes that entered the scene during this statement:
     *  an inclusive range, absent when it added none. Set by Runner in per-statement mode, so the
     *  app can go from a shape in the scenegraph (`SceneNodeData.sid`) to the statement that made it. */
    sidFirst?:number
    sidLast?:number
}

/** After execution of the script (on client or server) we fill in some metadata */
export interface ScriptMeta
{
    // Information after execution of script
    units: ModelUnits, // units of the script
    pipelines: Array<string>, // pipelines that are part of the script
    metrics: Array<string>, // metric names that are part of the script
    tables: Array<string>, // table names that are part of the script
    docs: Array<string>, // names of docs that are part of the script
    numShapes?: number
    bbox?: Array<number|number|number|number|number|number>, // bbox of scene [minX, minY, minZ, maxX, maxY, maxZ]
}

/** Data only representation of ScriptOutputPath class */
export interface ScriptOutputPathData
{
    requestedPath: string;
    resolvedPath: string;
    pipeline: string | null;
    category: ScriptOutputCategory | null;
    entityName: string | null;
    format: ScriptOutputFormat | null;
    formatOptions: Record<string, any>;
}

/** Data output of a script based on given path */
export interface ScriptOutputData
{
    path:ScriptOutputPathData
    output: string|ArrayBuffer|Record<string,any>|Array<any>|ScriptOutputDataWrapper // raw data or wrapped data with metadata
    footer?: Array<ComputedFooterRow> // optional computed table footer rows (aggregations), kept separate from output rows
}


/** Wraps different output data with information 
 *  When we apply an encoding (like base64) we apply extra data to the wrapper
*/
export interface ScriptOutputDataWrapper
{
    type?: string // original type (string, ArrayBuffer etc)
    encoding?: 'base64'  // any special encoding
    //binary?:boolean // if true, data is binary format
    //mime?: string // mime type of data
    data: any|string|ArrayBuffer // internal, string (and base64) and ArrayBuffer for binary data
    length?: number // length of data in bytes
}

export interface ExecutionRequestOutputFormatGLTFOptions
{
    // gltf basics
    edges?: boolean // include edge geometry with GLTF extension
    animations?: boolean // all layout animations: exploded view etc
    
    /* archiyou extra data: 
        this can be handly to serve all data within one GLTF file 
        when flag is true, data is included in GLTF extras field
    */
    annotations?: boolean // include annotations (dimensions etc) in output
    /** Bake an instructable in: `default/model/glb?instruct=assembly`. See Instruct. */
    instruct?: string | boolean
    instructCameras?: boolean
    docs?: boolean, // include data raw doc data
    tables?: boolean, // include data tables
    metrics?: boolean, // include metrics data
    scenegraph?: boolean // include scenegraph data (for now included in docs, but can be separate)
    
    // NOTE: for all outputs the user can use export paths. 
    // For example 'default/docs/*.svg' for all docs in svg format
    // the only drawback: you get the non-file, verbose result data
}

export interface ScriptImportStatement
{
    code: string,
    userName: string
    name: string,
    versionTag: string,
    paramValues?: {[key:string]:string|number},
    statement: ScriptStatement, // reference to original statement
}


//// PARAMS ////

export type ScriptParamData = Static<typeof ScriptParamSchema>

export enum ScriptParamType
{
    number  = 'number',
    boolean = 'boolean',
    text    = 'text',
    options = 'options',
    list    = 'list',
    object  = 'object',
}


//// PARAM MANAGEMENT ////

/** Options accepted by the ergonomic $PARAMS.define(name, type, options) form.
 *  Use JSON-Schema keywords directly; friendly aliases (options/listItemType) are
 *  mapped into the JSON Schema. */
export interface ScriptParamDefineOptions
{
    // top-level param fields
    label?: string
    group?: string
    description?: string
    units?: string
    order?: number
    visible?: boolean
    enabled?: boolean
    default?: any
    // friendly schema aliases
    options?: Array<any>  // → schema.enum
    listItemType?: 'string'|'number'|'boolean' // → schema.items.type
    min?: number  // → schema.minimum
    max?: number  // → schema.maximum
    step?: number // → schema.multipleOf
    /** Name of a $PARAMS.defineObject() type (or an inline object schema / props map).
     *  For 'list' it becomes schema.items; for 'object' it becomes the schema itself. */
    of?: string|Record<string, any>
    /** Property of an object entry to use as its label in the UI. Falls back to `name`. */
    labelProp?: string
    // JSON-Schema keywords (pass-through)
    minimum?: number
    maximum?: number
    multipleOf?: number
    minLength?: number
    maxLength?: number
    enum?: Array<any>
    items?: Record<string, any>
    properties?: Record<string, any>
    [key: string]: any
}

/** One property of an object type declared with $PARAMS.defineObject().
 *  Accepts three spellings:
 *      - a bare type:      'number' | 'text' | 'boolean' | 'string' | 'integer'
 *      - an array:         ['left','right'] → an enum of allowed values
 *      - a full defintion: { type:'number', min:0, max:5000, step:10, default:100, units:'mm' }
 */
export type ScriptObjectPropDef = string | Array<string|number> | Record<string, any>

/** Options for $PARAMS.defineObject() */
export interface ScriptObjectDefineOptions
{
    /** Human name for the type. Defaults to the registered name. */
    title?: string
    /** Property used as an entry's label in the UI. Falls back to `name`, then '<Title> <n>'. */
    labelProp?: string
    /** Opt-in ONLY. Defaulting either of these makes schema evolution destructive: add one
     *  property next week and every list the user already edited fails validation, which
     *  silently replaces it with the script's default. */
    required?: Array<string>
    additionalProperties?: boolean
}

export type ParamOperation = 'new'|'updated'|'deleted'
export type ParamBehaviourTarget = 'visible' | 'enable' | 'value' | 'values' | 'start' | 'end' | 'options'

/** A param behaviour function as authored in the script.
 *  Receives a snapshot map of current param VALUES ({ NAME: value }) and returns
 *  the value to apply to the behaviour's target attribute (e.g. a boolean for
 *  'enable'/'visible', an array for 'options', a value for 'value'). */
export type ParamBehaviourFn = (params: Record<string, any>) => any

/** Behaviours declared this run, ready to ship to the app via the dedicated
 *  managedBehaviours channel. Function bodies are serialized to source strings
 *  (structured-clone- and GLB-JSON-safe) and re-hydrated + evaluated app-side.
 *  Shape: paramName → target → fn source string. */
export type ManagedBehavioursData = Record<string, Partial<Record<ParamBehaviourTarget, string>>>

/** Options of $PARAMS.NAME.set() and push() */
export interface ParamSetOptions
{
    /** Re-run the script when the value changed (default true). Code before the set() used the
     *  old value, so model and menu disagree until the next run. Pass false when the script
     *  builds the model from the value it sets. */
    rerun?: boolean
}

/** A value the script wrote with set() or push() this run, for the app to keep */
export interface ManagedValueData
{
    value: any
    rerun: boolean
}

/** Values written this run, sent to the app through their own channel: a value is not a
 *  definition, so applying one never sets _definedProgrammatically. Shape: paramName → value. */
export type ManagedValuesData = Record<string, ManagedValueData>
export type PublishLicense = 'unknown' | 'copyright' | 'trademarked' | 'CC BY' | 'CC BY-SA' | 'CC BY-ND' | 'CC BY-NC' | 'CC BY-NC-SA' | 'CC BY-NC-ND' | 'CC0'


//// SCRIPT EXECUTION RESULTS ////

export interface SceneGraphNode {
    name: string,
    type: string,
    nodes: Array<SceneGraphNode>,
    details?: SceneGraphNodeDetails,
}

export interface SceneGraphNodeDetails {
    visible?: boolean,
    color?: number,
    subType?: string, 
    numVertices?:number,
    numEdges?:number,
    numWires?:number,
}
