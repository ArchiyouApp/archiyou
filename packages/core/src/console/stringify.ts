/** console/stringify.ts — turn any script value into a readable console string
 *
 *  print({ width: 10, height: 100 }) has to show `{ width: 10, height: 100 }`,
 *  not `[object Object]` (what String(obj) gives) and not a crash (what
 *  JSON.stringify gives on a circular or BigInt-holding object).
 *
 *  Rules of the house:
 *   - only *data* is serialized. Accessors are never invoked (a getter on a Shape
 *     can be expensive or have side effects), functions/promises/DOM nodes/WASM
 *     handles are rendered as a short tag instead of being walked into.
 *   - a value with its own meaningful toString() (all our Shapes have one) keeps
 *     using it.
 *   - never throws and never runs away: depth, width, string length, total length
 *     and total node count are all capped.
 */

export interface StringifyOptions
{
    /** How deep to walk nested objects/arrays before printing `[Object]`/`[Array]` */
    maxDepth?: number;
    /** Max array items / Map-Set entries / object keys shown per container */
    maxItems?: number;
    /** Max length of a single string value */
    maxStringLength?: number;
    /** Max length of the whole result */
    maxTotalLength?: number;
    /** Max number of values visited in total (runaway guard) */
    maxNodes?: number;
    /** Width at which a container is broken over multiple lines */
    wrapWidth?: number;
    /** Quote a top-level string ('hi' vs hi). Off for print()/log() output */
    quoteTopLevelString?: boolean;
}

const DEFAULTS: Required<StringifyOptions> = {
    maxDepth: 4,
    maxItems: 100,
    maxStringLength: 400,
    maxTotalLength: 10000,
    maxNodes: 1000,
    wrapWidth: 72,
    quoteTopLevelString: false,
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface Ctx
{
    opts: Required<StringifyOptions>;
    seen: Set<any>; // ancestors only - so a value used twice side by side is not called circular
    nodes: number;
}

/** Readable, bounded string for any value. Never throws. */
export function stringifyValue(value:any, options?:StringifyOptions):string
{
    const opts = { ...DEFAULTS, ...(options || {}) };
    const ctx:Ctx = { opts, seen: new Set(), nodes: 0 };

    let str:string;
    try {
        str = format(value, 0, ctx);
    }
    catch(e)
    {
        // last resort - formatting itself must never break a script run
        str = `[Unserializable: ${errorText(e)}]`;
    }

    return truncate(str, opts.maxTotalLength, '… (truncated)');
}

/** Join console arguments the way console.log does: values separated by a space */
export function stringifyArgs(args:Array<any>, options?:StringifyOptions):string
{
    if (!Array.isArray(args) || args.length === 0) return '';
    return args.map(a => (typeof a === 'string') ? a : stringifyValue(a, options)).join(' ');
}

//// FORMATTING ////

function format(value:any, depth:number, ctx:Ctx):string
{
    if (ctx.nodes++ > ctx.opts.maxNodes) return '…';

    //// primitives ////
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const type = typeof value;

    if (type === 'string')
    {
        const s = truncate(value, ctx.opts.maxStringLength, '…');
        return (depth === 0 && !ctx.opts.quoteTopLevelString) ? s : quote(s);
    }
    if (type === 'number') return formatNumber(value);
    if (type === 'boolean') return String(value);
    if (type === 'bigint') return `${value}n`;
    if (type === 'symbol') return safeString(value, '[Symbol]');
    if (type === 'function') return formatFunction(value);

    //// objects ////
    if (ctx.seen.has(value)) return '[Circular]';

    const builtin = formatBuiltin(value, ctx);
    if (builtin !== null) return builtin;

    // anything with its own meaningful toString() (Shape, Vector, Bbox, ...) wins
    const own = ownToString(value);
    if (own !== null) return own;

    if (depth >= ctx.opts.maxDepth) return Array.isArray(value) ? '[Array]' : '[Object]';

    ctx.seen.add(value);
    try {
        return Array.isArray(value) ? formatArray(value, depth, ctx) : formatObject(value, depth, ctx);
    }
    finally {
        ctx.seen.delete(value);
    }
}

function formatNumber(n:number):string
{
    if (Number.isNaN(n)) return 'NaN';
    if (n === Infinity) return 'Infinity';
    if (n === -Infinity) return '-Infinity';
    if (Object.is(n, -0)) return '-0';
    // avoid 0.30000000000000004 noise, keep integers and short decimals exact
    return (Number.isInteger(n)) ? String(n) : String(parseFloat(n.toPrecision(12)));
}

function formatFunction(fn:Function):string
{
    const name = (typeof fn.name === 'string' && fn.name) ? fn.name : null;
    const isClass = /^class[\s{]/.test(safeString(fn, ''));
    if (isClass) return name ? `[class ${name}]` : '[class (anonymous)]';
    return name ? `[Function: ${name}]` : '[Function (anonymous)]';
}

/** Known non-plain objects. Returns null when `value` is not one of them. */
function formatBuiltin(value:any, ctx:Ctx):string|null
{
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    if (value instanceof RegExp) return safeString(value, '[RegExp]');
    if (value instanceof Error) return `${value.name || 'Error'}: ${value.message}`;
    if (typeof Promise !== 'undefined' && value instanceof Promise) return '[Promise]';
    if (typeof WeakMap !== 'undefined' && value instanceof WeakMap) return '[WeakMap]';
    if (typeof WeakSet !== 'undefined' && value instanceof WeakSet) return '[WeakSet]';
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return `[ArrayBuffer(${value.byteLength})]`;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
    {
        return `[${constructorName(value) || 'TypedArray'}(${(value as any).length ?? value.byteLength})]`;
    }
    // DOM nodes, WASM handles and other host objects: tag them, never walk them
    // (property access itself can throw on a Proxy, hence the try)
    try {
        if (typeof value.nodeType === 'number' && typeof value.nodeName === 'string') return `[${value.nodeName}]`;
        if (typeof value.__wbg_ptr === 'number' || (typeof value.$$ === 'object' && value.$$?.ptr !== undefined))
        {
            return `[${constructorName(value) || 'Native'}]`;
        }
    }
    catch(e){ return `[${constructorName(value) || 'Object'}]`; }

    if (value instanceof Map)
    {
        const entries = takeIterable(value, ctx).map(([k,v]) => `${format(k, 1, ctx)} => ${format(v, 1, ctx)}`);
        return wrapContainer(`Map(${value.size}) {`, entries, '}', value.size, 0, ctx);
    }
    if (value instanceof Set)
    {
        const entries = takeIterable(value, ctx).map(v => format(v, 1, ctx));
        return wrapContainer(`Set(${value.size}) {`, entries, '}', value.size, 0, ctx);
    }

    return null;
}

/** The value's own (non-Object.prototype) toString(), if it produces something useful */
function ownToString(value:any):string|null
{
    let fn:any;
    try { fn = value.toString; } catch(e){ return null; } // exotic proxies can throw on access

    if (typeof fn !== 'function') return null;
    if (fn === Object.prototype.toString || fn === Array.prototype.toString) return null;

    let str:any;
    try { str = fn.call(value); } catch(e){ return null; }

    if (typeof str !== 'string' || str.length === 0) return null;
    if (/^\[object [A-Za-z]*\]$/.test(str)) return null; // the useless default

    return str;
}

function formatArray(arr:Array<any>, depth:number, ctx:Ctx):string
{
    const shown = Math.min(arr.length, ctx.opts.maxItems);
    const parts:Array<string> = [];
    for (let i = 0; i < shown; i++)
    {
        parts.push(!(i in arr) ? '<empty>' : format(arr[i], depth + 1, ctx));
    }
    return wrapContainer('[', parts, ']', arr.length, depth, ctx);
}

function formatObject(obj:any, depth:number, ctx:Ctx):string
{
    const prefix = objectPrefix(obj);

    let keys:Array<string>;
    try { keys = Object.keys(obj); }
    catch(e){ return `${prefix}{ [unreadable] }`; }

    const parts:Array<string> = [];
    for (const key of keys.slice(0, ctx.opts.maxItems))
    {
        parts.push(`${formatKey(key)}: ${formatProperty(obj, key, depth, ctx)}`);
    }

    if (keys.length === 0) return `${prefix}{}`;
    return wrapContainer(`${prefix}{`, parts, '}', keys.length, depth, ctx);
}

/** Read one property - accessors are reported, never invoked */
function formatProperty(obj:any, key:string, depth:number, ctx:Ctx):string
{
    let descriptor:PropertyDescriptor|undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(obj, key); }
    catch(e){ return '[unreadable]'; }

    if (!descriptor) return 'undefined';
    if (!('value' in descriptor))
    {
        if (descriptor.get && descriptor.set) return '[Getter/Setter]';
        return (descriptor.get) ? '[Getter]' : '[Setter]';
    }

    return format(descriptor.value, depth + 1, ctx);
}

/** `Bbox ` for class instances, `[Object: null prototype] ` for bare objects, '' for plain ones */
function objectPrefix(obj:any):string
{
    const proto = Object.getPrototypeOf(obj);
    if (proto === null) return '[Object: null prototype] ';
    const name = constructorName(obj);
    return (!name || name === 'Object') ? '' : `${name} `;
}

function constructorName(value:any):string|null
{
    try {
        const name = value?.constructor?.name;
        return (typeof name === 'string' && name) ? name : null;
    }
    catch(e){ return null; }
}

function takeIterable(iterable:Iterable<any>, ctx:Ctx):Array<any>
{
    const out:Array<any> = [];
    try {
        for (const entry of iterable)
        {
            if (out.length >= ctx.opts.maxItems) break;
            out.push(entry);
        }
    }
    catch(e){ /* half a list is better than none */ }
    return out;
}

/** Put the parts on one line, or over several when that gets too wide */
function wrapContainer(open:string, parts:Array<string>, close:string, total:number, depth:number, ctx:Ctx):string
{
    const all = (total > parts.length) ? [...parts, `… ${total - parts.length} more`] : parts;
    if (all.length === 0) return `${open}${close}`;

    const oneLine = `${open} ${all.join(', ')} ${close}`;
    if (oneLine.length <= ctx.opts.wrapWidth && !oneLine.includes('\n')) return oneLine;

    const indent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);
    return `${open}\n${all.map(p => indent + p.split('\n').join(`\n${indent}`)).join(',\n')}\n${closeIndent}${close}`;
}

//// HELPERS ////

function formatKey(key:string):string
{
    return IDENTIFIER_RE.test(key) ? key : quote(key);
}

function quote(str:string):string
{
    try { return JSON.stringify(str); }
    catch(e){ return `'${str}'`; }
}

function truncate(str:string, max:number, suffix:string):string
{
    return (typeof str === 'string' && str.length > max) ? `${str.slice(0, max)}${suffix}` : str;
}

function safeString(value:any, fallback:string):string
{
    try { return String(value); }
    catch(e){ return fallback; }
}

function errorText(e:any):string
{
    try { return (e instanceof Error) ? e.message : String(e); }
    catch(err){ return 'unknown error'; }
}
