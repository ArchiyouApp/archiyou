import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import type { ScriptOutputDataWrapper } from './execution/types'


//// EQUALITY ////

/**
 * Deep structural equality — handles primitives, NaN, Date, RegExp, Array, and plain objects.
 * Equivalent to the `deep-is` package (node assert.deepEqual semantics).
 */
export function deepEqual(a: unknown, b: unknown): boolean
{
    if (a === b) return true

    // NaN
    if (typeof a === 'number' && typeof b === 'number') return isNaN(a) && isNaN(b)

    // null / undefined already handled by ===
    if (a === null || b === null || a === undefined || b === undefined) return false

    // Date
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()

    // RegExp
    if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags

    // Array
    if (Array.isArray(a) && Array.isArray(b))
    {
        if (a.length !== b.length) return false
        return a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
    }

    if (typeof a !== 'object' || typeof b !== 'object') return false

    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every(k => deepEqual((a as any)[k], (b as any)[k]))
}

//// HASHES ////

/** Generate a UUID v4 — works in Node and browser */
export function uuid4(): string
{
    return globalThis.crypto.randomUUID();
}

/** Export sha256 hashing function — works in Node and browser */
// TODO: use in Script.getVariantId
export function hash(s: string): string
{
    if (typeof s !== 'string') throw new Error('Input must be a string');
    const message = new TextEncoder().encode(s);
    return bytesToHex(sha256(message));
}

//// VALUES ////

/** Convert degrees to radians */
export function toRad(deg: number): number { return deg * (Math.PI / 180); }

/** Convert radians to degrees */
export function toDeg(rad: number): number { return rad * (180 / Math.PI); }

/** Round a number to the given number of decimal places */
export function roundTo(num: number, decimals: number): number
{
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}

/** Returns true if the value is a finite number or a string that parses to one */
export function isNumeric(v: unknown): boolean
{
    if (typeof v === 'number') return isFinite(v);
    if (typeof v === 'string' && v.trim() !== '') return isFinite(Number(v));
    return false;
}

/**
 * Converts a data object to a JS module string with export default,
 * each key on a separate line for readability.
 * @param data The data object to export
 * @returns JS module string
 * 
 *  This is used to write script.js files in the Library
 *   // TODO ==> Move to Script, because it is used only here
 */
export function dataToModuleString(data: Record<string, any>): string {
    function serialize(val: any, indent: string = '  '): string {
        if (typeof val === 'string')
        {
            if (val.includes('${')) val = val.replace(/\$\{/g, '\\${'); // Escape ${...} to prevent evaluation when imported
            // Use backticks for multiline strings or strings with backticks
            if (val.includes('\n')) return '`' + val.replace(/`/g, '\\`') + '`';
            // Otherwise just use JSON.stringify which results in double quotes
            return JSON.stringify(val);
        }
        if (typeof val === 'number' || typeof val === 'boolean' || val === null)
        {
            return String(val);
        }
        if (Array.isArray(val))
        {
            if (val.length === 0) return '[]';
            return '[\n' + val.map(v => indent + serialize(v, indent + '  ')).join(',\n') + '\n' + indent.slice(2) + ']';
        }
        if (typeof val === 'object' && val !== null)
        {
            const entries = Object.entries(val);
            if (entries.length === 0) return '{}';
            // Don't stringify keys, assume they are valid identifiers
            return '{\n' + entries.map(([k, v]) => `${indent}${k}: ${serialize(v, indent + '  ')}`).join(',\n') + '\n' + indent.slice(2) + '}';
        }
        return undefined;
    }

    return `export default ${serialize(data)};\n`;
}


 /**
 * Convert a string value to its native type if possible.
 * - "true"/"false" (case-insensitive) => boolean
 * - Numeric strings => number
 * - Otherwise, return as string
 */
export function convertStringValue(value: string): string | number | boolean {
    if (typeof value !== 'string') return value;
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (!isNaN(Number(value)) && value.trim() !== '') return Number(value);
    return value;
}


/**
 * Converts a record object to a URL parameter string.
 * Example: { foo: 'bar', baz: 1 } => 'foo=bar&baz=1'
 * @param params Record<string, any>
 * @returns URL parameter string
 * 
 * TODO: Move to appropriate place
 */
export function recordToUrlParams(params: Record<string, any>): string {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
}

/**
 * Converts a URL parameter string to a record object.
 * Example: 'foo=bar&baz=1' => { foo: 'bar', baz: '1' }
 * @param paramString URL parameter string
 * @returns Record<string, string>
 */
export function urlParamsToRecord(paramString: string): Record<string, string> {
    const params: Record<string, string> = {};
    if (!paramString) return params;
    paramString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key) params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    });
    return params;
}

//// ASSET PROXY ////

/**
 * URL for fetching a remote asset through the Archiyou asset proxy:
 * `${base}/proxy?url=<encoded>`; base '' → root-relative `/proxy?url=…`.
 *
 * Everything a browser-side run fetches from a third-party host has to go through
 * this — $import() assets AND document images. A direct cross-origin fetch fails on
 * CORS, and on a deployment with a strict CSP it never even leaves the page:
 * `connect-src 'self'` blocks it outright. The proxy is same-origin, so both hold.
 *
 * The one definition of the contract — it is the server's `GET /proxy?url=…`
 * (apps/server/src/routes/proxy.ts). A second, drifting copy of it is exactly how
 * document images ended up POSTing to a route that answers GET.
 */
export function assetProxyUrlFor(url: string, proxyBase = ''): string
{
    return `${proxyBase.replace(/\/$/, '')}/proxy?url=${encodeURIComponent(url)}`;
}

//// ENCODING BINARY DATA ////

export const arrayBufferToBase64 = (arraybuffer: ArrayBuffer): string =>
{
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    let bytes = new Uint8Array(arraybuffer),
        i,
        len = bytes.length,
        base64 = '';

    for (i = 0; i < len; i += 3)
    {
        base64 += chars[bytes[i] >> 2];
        base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
        base64 += chars[bytes[i + 2] & 63];
    }

    if (len % 3 === 2) {
        base64 = base64.substring(0, base64.length - 1) + '=';
    } else if (len % 3 === 1) {
        base64 = base64.substring(0, base64.length - 2) + '==';
    }

    return base64;
};

/**
 * Recursively transforms binary data in an object to base64 strings for JSON serialization
 *  We use an instance of ScriptOutputDataWrapper to keep track of original type and length for easy decoding
 *
 * @param obj - The object to transform
 * @param maxDepth - Maximum recursion depth to prevent infinite loops (default: 10)
 * @param currentDepth - Current recursion depth (internal use)
 * @returns Transformed object with binary data as base64 strings
 */
export function convertBinaryToBase64<T>(obj: T, maxDepth: number = 10, currentDepth: number = 0): number|string|Array<any>|Object|ScriptOutputDataWrapper
{
    // Prevent infinite recursion
    if (currentDepth >= maxDepth) {
        console.warn('convertBinaryToBase64: Maximum recursion depth reached');
        return obj;
    }

    // Handle null or undefined
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle ArrayBuffer
    if (obj instanceof ArrayBuffer)
    {
        return {
            type: 'ArrayBuffer',
            encoding: 'base64',
            data: arrayBufferToBase64(obj),
            length: obj.byteLength
        } as ScriptOutputDataWrapper;
    }

    // Handle Uint8Array and other TypedArrays
    if (obj instanceof Uint8Array || obj instanceof Int8Array ||
        obj instanceof Uint16Array || obj instanceof Int16Array ||
        obj instanceof Uint32Array || obj instanceof Int32Array ||
        obj instanceof Float32Array || obj instanceof Float64Array) {
        return {
            type: obj.constructor.name,
            encoding: 'base64',
            data: arrayBufferToBase64(obj.buffer.slice(obj.byteOffset, obj.byteOffset + obj.byteLength) as ArrayBuffer),
            length: obj.length
        } as ScriptOutputDataWrapper;
    }

    // Handle Buffer (Node.js)
    if (typeof Buffer !== 'undefined' && obj instanceof Buffer) {
        return {
            type: 'Buffer',
            encoding: 'base64',
            data: obj.toString('base64'),
            length: obj.length
        } as ScriptOutputDataWrapper;
    }

    // Don't do functions
    if (typeof obj === 'function')
    {
        console.warn('convertBinaryToBase64: Function serialization is not supported!');
    }

    // Handle original primitives
    if (typeof obj !== 'object')
    {
        return obj;
    }

    // Arrays - resurse
    if (Array.isArray(obj))
    {
        return obj.map(item => convertBinaryToBase64(item, maxDepth, currentDepth + 1));
    }

    // Object
    if(typeof obj === 'object')
    {
        // Avoid any instances of classes
        if (Object.getPrototypeOf(obj) !== Object.prototype)
        {
            console.warn('convertBinaryToBase64: Class instances are not supported! Returned null');
            return null;
        }

        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip non-enumerable properties and functions (unless explicitly handling them above)
            if (typeof value === 'function') {
                continue; // Skip functions in objects unless we want to serialize them
            }
            result[key] = convertBinaryToBase64(value, maxDepth, currentDepth + 1);
        }
        return result;
    }
}

/**
 * Restores binary data from base64 strings after JSON parsing
 * @param obj - The object to restore
 * @returns Object with restored binary data
 */
export function restoreBinaryFromBase64(obj: ScriptOutputDataWrapper, forceBuffer: boolean=false): Buffer|ArrayBuffer|Uint8Array|null
{
    if (obj === null || obj === undefined)
    {
        console.error('utils::restoreBinaryFromBase64(): Invalid input');
        return null;
    }
    console.info(`utils::restoreBinaryFromBase64(): Restoring to binary "${obj?.type}" with length ${obj?.length}`);

    // Handle primitives
    if (typeof obj !== 'object')
    {
        return obj;
    }
    // Check if this is a serialized binary object
    if (obj.type && obj.data !== undefined)
    {
        switch (obj.type)
        {
            case 'ArrayBuffer':
                const binaryString = atob(obj.data);
                const buffer = new ArrayBuffer(binaryString.length);
                const view = new Uint8Array(buffer);
                for (let i = 0; i < binaryString.length; i++) {
                    view[i] = binaryString.charCodeAt(i);
                }
                return (forceBuffer)
                        ? Buffer.from(buffer)
                        : buffer as any;
            case 'Uint8Array':
                const b = restoreBinaryFromBase64({ type: 'ArrayBuffer', data: obj.data, length: obj.length } as ScriptOutputDataWrapper) as ArrayBuffer;
                const u8 = new Uint8Array(b, 0, obj.length)
                return (forceBuffer)
                        ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
                        : u8;
            case 'Buffer':
                if (typeof Buffer !== 'undefined' && Buffer.from)
                {
                    return Buffer.from(obj.data, 'base64') as any;
                }
                break;

            default:
                console.warn(`restoreBinaryFromBase64: Unknown type ${obj.type}`);
                return null;
        }
    }
    // Handle Arrays
    if (Array.isArray(obj)) {
        return obj.map(item => restoreBinaryFromBase64(item)) as any;
    }
    // Handle plain objects
    const result: any = {};
    for (const [key, value] of Object.entries(obj))
    {
        result[key] = restoreBinaryFromBase64(value as ScriptOutputDataWrapper);
    }

    return result;
}

//// FUNCTIONS ////

export function _getArgNames(func:any):Array<string>
{
     // taken from: https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically?page=1&tab=votes#tab-top
     var STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,\)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,\)]*))/mg;
     const ARGUMENT_NAMES = /([^\s,]+)/g;
     
     let fnStr = func.toString().replace(STRIP_COMMENTS, '');
     let result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
     if(result === null)
         result = [];
     return result;
}

export function analyzeFunc(func:(any) => any)
    : { argCount: number, argNames: string[], isAsync: boolean, 
        hasMainScopeParam: boolean, returnsPromise: boolean }
{
    const funcStr = func.toString();
    
    // Get argument names (reuse your existing logic)
    const argNames = _getArgNames(func);
    
    // Check if async
    const isAsync = funcStr.startsWith('async ') || funcStr.includes('async function');
    
    // Check if first parameter looks like mainScope
    const hasMainScopeParam = argNames.length > 0 && 
        (argNames[0].toLowerCase().includes('scope') || argNames[0] === 'mainScope');
    
    // Detect return statements and promises
    const returnMatches = funcStr.match(/return\s+([^;}\n]+)/g) || [];
    const returnsPromise = isAsync || returnMatches.some(r => r.includes('Promise'));
    
    return {
        argCount: argNames.length,
        argNames,
        isAsync,
        hasMainScopeParam, // this is indicative
        returnsPromise
    };
}