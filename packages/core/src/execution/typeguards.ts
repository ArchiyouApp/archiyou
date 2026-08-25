import type { ScriptParam } from "./ScriptParam";
import type { ScriptOutputPathData, ScriptParamData, ScriptParamType, ScriptOutputFormat, ScriptOutputCategory, ScriptOutputDataWrapper } from "./types";

import { SCRIPT_OUTPUT_MODEL_FORMATS, SCRIPT_OUTPUT_METRIC_FORMATS, SCRIPT_OUTPUT_TABLE_FORMATS, SCRIPT_OUTPUT_DOC_FORMATS } from "../constants";

export function isScriptOutputPathData(o:any): o is ScriptOutputPathData
{
    return o && typeof o === 'object'
        && typeof o.requestedPath === 'string'
        && typeof o.resolvedPath === 'string'
        && typeof o.pipeline === 'string'
        && typeof o.category === 'string'
}


export function isScriptScriptParamType(o:any): o is ScriptParamType
{
    return ['number','text','options','boolean','list','object'].includes(o)
}

export function isScriptParam(o:any): o is ScriptParam
{
    return (typeof o === 'object') &&
        isScriptScriptParamType(o?.type) &&
        typeof o?.name  === 'string'
        // NOTE: value and default are optional
        // TODO: add _behaviours?
}

export function isScriptParamData(o:any): o is ScriptParamData
{
    return isScriptParam(o) && 
        o?._behaviours &&
        typeof o?._behaviours === 'object' &&
        Object.values(o._behaviours).every(v => typeof v === 'string') // function stringified
}

/** Main typeguard for OutputFormat - Please update constants.ts when introducing a new format! */
export function isScriptOutputFormat(o:any):o is ScriptOutputFormat
{
    const ALL_FORMATS = [...SCRIPT_OUTPUT_MODEL_FORMATS, ...SCRIPT_OUTPUT_METRIC_FORMATS, ...SCRIPT_OUTPUT_TABLE_FORMATS, ...SCRIPT_OUTPUT_DOC_FORMATS, 'internal']
    const r = typeof o === "string" && ALL_FORMATS.includes(o);
    if(!r){
        console.error(`isScriptOutputFormat: Unknown output format "${o}". Valid formats: ${ALL_FORMATS.join(', ')}`);
    }
    return r;
}

export function isScriptOutputCategory(o:any):o is ScriptOutputCategory
{
    return typeof o === "string" && ['model','metrics','tables','docs'].includes(o);
}

export function isScriptOutputDataWrapper(o:any): o is ScriptOutputDataWrapper
{
    return o && typeof o === 'object'
        && o.data // can be string, object, Buffer
        && typeof o.type === 'string';
}