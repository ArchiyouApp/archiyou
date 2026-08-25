/**
 *  Script.ts
 *    The central Archiyou Script class.
 *    Combines the creation in editor and publishing into one model
 *    and adds a programmatic layer for validation.
 *
 *    Shape single-source-of-truth: the class holds private underscored raw
 *    storage whose field names & types are *derived from ScriptSchema*
 *    (see the RawScript mapped type below) and exposes public getters/setters
 *    that convert to runtime types (Date, ScriptParam instances). 
 */

import { Check, Errors } from 'typebox/value'
import semver from 'semver'; // for version validation

import type { ScriptData, ScriptParamData, ScriptMeta } from './execution/types';
import type { ScriptPublishedData, ScriptSharedData } from './ScriptSchema';
import { ScriptParam } from './execution/ScriptParam';
import { ScriptSchema, ScriptPublishedSchema } from './ScriptSchema'
import { hash, uuid4, dataToModuleString } from './utils' // utils

/** Raw wire storage — field names & types generated from ScriptSchema (ScriptData).
 *  e.g. `id → _id: string|undefined`, `created → _created: string|null|undefined`,
 *  `params → _params: Record<string, ScriptParamData>|undefined`. Zero hand-written list. */
type RawScript = { [K in keyof ScriptData as `_${string & K}`]: ScriptData[K] };

// Declaration-merges the raw `_*` storage into the class instance type.
export interface Script extends RawScript {}

export class Script
{
    // ── runtime-only fields (not part of the schema) ──
    declare _meta: ScriptMeta|null;  // To be filled in by client or server after execution
    _valid:boolean = false; // internal validation flag
    _inline:boolean = false; // if script was created inline (used in handling inline component code)
    _component:string|undefined; // keep track how this component was referenced (NOTE: can be inline code!)

    // Lazily-built + cached ScriptParam instances (preserves mutation & identity).
    // NOTE: underscore (not #private) on purpose — fromData() uses Object.create(),
    // which bypasses private-brand installation and would make #fields throw.
    _paramsCache?: Record<string, ScriptParam>;

    constructor()
    {
        console.warn("Script::constructor(): Please use Script.fromData() to create a script from data.");
    }

    //// SCHEMA-DERIVED ACCESSORS ////
    // Scalars: thin pass-throughs (wire type === runtime type).

    get id(): string { return this._id!; }
    set id(v: string|undefined) { this._id = v; }

    get fileId(): string { return this._fileId!; }
    set fileId(v: string|undefined) { this._fileId = v; }

    get name(): string|undefined { return this._name; }
    set name(v: string|undefined) { this._name = v; }

    get author(): string|undefined { return this._author; }
    set author(v: string|undefined) { this._author = v; }

    get description(): string|undefined { return this._description; }
    set description(v: string|undefined) { this._description = v; }

    get details(): string|undefined { return this._details; }
    set details(v: string|undefined) { this._details = v; }

    get tags(): string[] { return this._tags ?? (this._tags = []); }
    set tags(v: string[]) { this._tags = v; }

    get code(): string { return this._code; }
    set code(v: string) { this._code = v; }

    get units(): undefined|'metric'|'imperial' { return this._units; }
    set units(v: undefined|'metric'|'imperial') { this._units = v; }

    /** semver version — nullable. A working/unpublished script has no version.
     *  Reused by both `published` and `shared`. */
    get version(): string|null { return this._version ?? null; }
    set version(v: string|null|undefined) { this._version = v ?? null; }

    /** Information on the published script (if null, not published). */
    get published(): null|ScriptPublishedData { return this._published ?? null; }
    set published(v: null|ScriptPublishedData|undefined) { this._published = v ?? null; }

    /** Sharing metadata (if null, not shared). */
    get shared(): null|ScriptSharedData { return this._shared ?? null; }
    set shared(v: null|ScriptSharedData|undefined) { this._shared = v ?? null; }

    /** URL of this version's thumbnail image (null when none). Server-stamped; the SVG
     *  bytes live on disk, not here — see ScriptSchema.thumbnail. */
    get thumbnail(): string|null { return this._thumbnail ?? null; }
    set thumbnail(v: string|null|undefined) { this._thumbnail = v ?? null; }

    // Dates: convert wire ISO string <-> Date on the boundary.
    get created(): Date { return this._created ? new Date(this._created) : new Date(); }
    set created(v: Date|string|null|undefined) { this._created = v == null ? null : (v instanceof Date ? v.toISOString() : v); }

    get updated(): Date { return this._updated ? new Date(this._updated) : new Date(); }
    set updated(v: Date|string|null|undefined) { this._updated = v == null ? null : (v instanceof Date ? v.toISOString() : v); }

    // presets are plain data (no ScriptParam instances) — pass-through.
    get presets(): Record<string, Record<string, ScriptParamData>> { return this._presets ?? (this._presets = {}); }
    set presets(v: Record<string, Record<string, ScriptParamData>>) { this._presets = v; }

    // params are ScriptParam instances — lazily built from raw + cached.
    get params(): Record<string, ScriptParam> { return (this._paramsCache ??= this._buildParams(this._params)); }
    set params(v: Record<string, ScriptParam>) { this._paramsCache = v; }

    /** Build ScriptParam instances from raw param data, skipping invalid ones. */
    _buildParams(raw: Record<string, ScriptParamData>|undefined): Record<string, ScriptParam>
    {
        if(!raw || typeof raw !== 'object'){ return {}; }
        return Object.entries(raw).reduce((acc, [key, value]) => {
            try {
                acc[key] = ScriptParam.fromData({ name:key, ...(value as object) } as any); // inject name
            }
            catch(e) {
                console.error(`Script::buildParams(): Skipping param "${key}":`, e);
            }
            return acc;
        }, {} as Record<string, ScriptParam>);
    }

    /** Simple test if obj is Script instance. Use Script.fromData() to create one with validation */
    static isScript(obj:any): obj is Script
    {
        if(obj instanceof Script) return true;
        return false;
    }

    isValid():boolean
    {
        return this._valid;
    }

    namespace():string
    {
        return `${this.author}/${this.name}`;
    }

    //// VALIDATION AND DEFAULTS ////

    validate()
    {
        const data = this.toData();

        if(!Check(ScriptSchema, data))
        {
            this._valid = false;
            const messages = Errors(ScriptSchema, data).map(e => e.message).join('; ');
            throw new Error(`Script.validate(): ${messages}`);
        }

        this._valid = true;
    }

    /** Returns actionable field-level error strings for raw (pre-transformed) script data.
     *  Checks each section independently to avoid union-type noise from TypeBox. */
    static diagnoseData(data: Record<string, any>): string[]
    {
        const errors: string[] = [];

        // Required field
        if (typeof data.code !== 'string')
        {
            errors.push('code: expected a string (required)');
        }

        // Version (optional/nullable, but if present must be a valid semver)
        const version = data.version;
        if (version !== undefined && version !== null)
        {
            if (typeof version !== 'string' || !semver.valid(semver.coerce(version)))
            {
                errors.push(`version: "${version}" is not a valid semver`);
            }
        }

        // Params
        const params = data.params;
        if (params && typeof params === 'object')
        {
            for (const [key, value] of Object.entries(params))
            {
                try
                {
                    ScriptParam.fromData({ name: key, ...(value as object) } as ScriptParamData);
                }
                catch (e)
                {
                    const msg = e instanceof Error
                        ? e.message.replace(/^ScriptParam\.fromData\(\):\s*/, '')
                        : String(e);
                    errors.push(`params.${key}: ${msg}`);
                }
            }
        }

        // Published block (optional). Version now lives at the top level (checked above).
        const pub = data.published;
        if (pub && typeof pub === 'object')
        {
            const pubParams = pub.params;
            if (pubParams && typeof pubParams === 'object')
            {
                for (const [key, value] of Object.entries(pubParams))
                {
                    try
                    {
                        ScriptParam.fromData({ name: key, ...(value as object) } as ScriptParamData);
                    }
                    catch (e)
                    {
                        const msg = e instanceof Error
                            ? e.message.replace(/^ScriptParam\.fromData\(\):\s*/, '')
                            : String(e);
                        errors.push(`published.params.${key}: ${msg}`);
                    }
                }
            }
        }

        return errors;
    }

    //// PARAM CHECKS ////

    getDefaultParamValues():Record<string,any>
    {
        if(!this.params || typeof this.params !== 'object') { return {}; }
        return Object.fromEntries(
            Object.entries(this.params).map(([key, param]) => [key, param.default])
        );
    }

    /** Check parameter values against script definition params and give back error messages
     *  @return
     *      success flag
     *      Record with valid values only
     */
    checkParamValuesVerbose(paramValues:Record<string,any>):{ success: boolean, errors: Array<string>, checkedParamValues: Record<string,any> }
    {
        let errors:Array<string> = [];
        let success: boolean = false;

        const checkedParamValues = Object.fromEntries(
            Object.entries(this.params).map(([key, param]) => {
                return [key, param.default];
            })
        );

        // empty/nullish input param values
        if(paramValues === null || typeof paramValues !== 'object'
            || (typeof paramValues === 'object' && Object.keys(paramValues).length === 0))
        {
            return { success: true, errors: [], checkedParamValues };
        }

        for(const [key, value] of Object.entries(paramValues))
        {
            console.info(`Script.checkParamValues(): Checking param "${key}" with value:`, value);

            const keyUpper = key.toUpperCase();
            const param = this.params[keyUpper];

            if(!param)
            {
                throw new Error(`Script.checkParamValuesVerbose(): Parameter "${key}" is not defined in script parameters. Check script params and published.params!`);
            }

            const { success: validateSuccess, errors: validateErrors } = param.validateValueVerbose(value)

            if(param && validateSuccess)
            {
                checkedParamValues[keyUpper] = value;
                success = validateSuccess;
            }
            else {
                success = false;
                if(!param)
                {
                    errors.push(`Script.checkParamValues(): Invalid param name "${key}", ignoring it.`);
                }
                else {
                    errors = errors.concat(validateErrors);
                }
            }
        }

        // Log all errors
        errors.forEach( (e) => console.error(e) );

        return { success, errors, checkedParamValues };
    }

    /** Simple flag version */
    checkParamValues(paramValues:Record<string,any>):boolean
    {
        return this.checkParamValuesVerbose(paramValues).success;
    }


    //// PUBLISH ////

    /** Set publish data */
    publish(data: ScriptPublishedData): this
    {
        if (!Check(ScriptPublishedSchema, data))
        {
            const messages = Errors(ScriptPublishedSchema, data).map(e => e.message).join('; ');
            throw new Error(`Script.publish(): ${messages}`);
        }

        this.published = data;
        return this;
    }

     /** Used by library to set public url of this script */
    setPublishedUrl(rootUrl:string):this
    {
        if(this.published)
        {
            this.published.library = rootUrl; // without trailing slash
            this.published.url = `/${this.author}/${this.name}:${this.version}`;
        }
        else {
            console.warn("Script.setPublishedUrl(): Cannot set published URL, script is not published yet.");
        }
        return this;
    }

    //// PARAM VALUES ////

    validateParamValues(paramValues:Record<string,any>):boolean
    {
        for(const [key, value] of Object.entries(paramValues))
        {
            const param = this.params[key];

            if(!param)
            {
                console.error(`Script.validateParamValues(): Invalid param name "${key}"`);
                return false;
            }
            else if(!param.validateValue(value))
            {
                console.error(`Script.validateParamValues(): Invalid value for param "${key}": ${value}`);
                return false;
            }
        }
        return true;
    }

    /** When a script is executed with a set of params we generate a hash
     *  to uniquely identify the variant of the script. For example for caching
     */
    async getVariantId(paramValues: Record<string,any>): Promise<string>
    {
        const HASH_LENGTH_TRUNCATE = 11;

        // generate string based on the param names and values
        // in format: {param1:value1,param2:value2,...}
        // NOTE: We use param definitions in script.params and default values if not set in paramValues
        const paramValuesDefault = Object.fromEntries(Object.entries(this.params).map(([paramName, paramObj]) => [paramName.toUpperCase(), paramObj?.default]));
        // Only accept param names that are also in definition
        const paramValuesUpper = Object.fromEntries(
            Object.entries(paramValues)
                .map(([k, v]) => [k.toUpperCase(), v])
                .filter(([k, v]) => Object.keys(this.params).map(p => p.toUpperCase()).includes(k))
        );
        const input = JSON.stringify({...paramValuesDefault, ...paramValuesUpper}); // incoming overwrite default
        const variantHash = hash(input);

        // TODO: see is this still works after change to hash function instead of crypto
        const id = variantHash.substring(0, HASH_LENGTH_TRUNCATE);

        console.log(`Script::getVariantId(): Generated variant id "${id}" for param values: ${input}`);

        return id;
    }

    /** Get number of possible variants */
    getNumVariants():number
    {
        // No parameters, only one variant
        if(!this.params || typeof this.params !== 'object') return 1;

        if(Object.values(this.params).find(param => !param.isIterable()))
        {
            return Infinity;
        }

        return Object.values(this.params).reduce((acc, param) => {
            acc *= param.numValues();
            return acc;
        }, 1);
    }

    /** Iterate over all possible parameter variants
     *  @params params Array of parameter names to iterate over, others are kept to default
     */
    *iterateVariants(only?:Array<string>):Generator<Record<string,any>>
    {
        if(!this.params){ throw new Error("Script::iterateVariants: No parameters defined"); }

        only = only || Object.keys(this.params); // all

        // The params that we iterate
        const iterParams = Object.values(this.params).filter(p => p.isIterable() && only.includes(p.name));
        const staticParams = Object.values(this.params).filter(p => !p.isIterable() || !only.includes(p.name));
        const staticParamValues = Object.fromEntries(staticParams.map(p => [p.name, p.default]));

        // No params to iterate through
        if(iterParams.length === 0)
        {
            // No iterable parameters, return static variant
            yield staticParamValues;
            return;
        }

        // Now start iterating along every parameter
        yield* this._generateCombinations(iterParams, staticParamValues);

    }

    /** Generate all parameter combinations
     *  This function uses recursion to generate all possible combinations of parameter values.
    */
    *_generateCombinations(params: Array<ScriptParam>, staticValues: Record<string,any>): Generator<Record<string,any>>
    {
        if (params.length === 0) {
            yield staticValues;
            return;
        }

        const [firstParam, ...restParams] = params;

        for (const value of firstParam.iterateValues())
        {
            const currentValues = { ...staticValues, [firstParam.name]: value };

            if (restParams.length === 0)
            {
                yield currentValues;
            }
            else
            {
                yield* this._generateCombinations(restParams, currentValues);
            }
        }
    }



    //// IO ////

    /** Load from raw data
     *  Some backwards compatibility
     */
    static fromData(data:Script|ScriptData|Record<string, any>):Script|null
    {
        // if already is a Script
        if (data instanceof Script){ return data as Script;}

        const script = Object.create(this.prototype) as Script;

        // start flags
        script._valid = false;
        script._inline = false;
        script._paramsCache = undefined;

        // Raw storage — already wire-shaped; getters convert on read.
        script._id = data.id ?? uuid4(); // scripts should always have an id
        script._fileId = (data as any).fileId ?? script._id; // fileId is same as id on first creation, but doesn't change when script is updated or new version is created

        script._name = data.name?.toLowerCase(); // some scripts don't have names
        script._author = data.author?.toLowerCase();
        script._description = data.description;
        script._details = (data as any).details;
        script._tags = Array.isArray(data.tags) ? data.tags : [];
        script._units = (data as any).units;
        script._version = (data as any).version ?? null; // no default — version stays null until published/shared
        script._created = data.created ? new Date(data.created).toISOString() : new Date().toISOString();
        script._updated = data.updated ? new Date(data.updated).toISOString() : new Date().toISOString();
        script._code = data.code;

        // params/presets stay raw here; params instances are built lazily by the getter
        script._params = (data.params && typeof data.params === 'object') ? data.params : {};
        script._presets = data.presets || {};
        script._published = data.published || null; // will be validated in validate()
        script._shared = (data as any).shared || null;
        script._thumbnail = (data as any).thumbnail || null;

        // Validate the script after loading
        try {
            script.validate();
        }
        catch(e)
        {
            return null;
        }

        return script;
    }

    fixSemver(v:string)
    {
        return semver.valid(semver.coerce(v));
    }

    /** To raw data */
    toData():ScriptData
    {
        return {
            id: this.id,
            fileId: this.fileId,
            name: this.name,
            author: this.author,
            description: this.description,
            details: this.details,
            tags: this.tags,
            units: this.units,
            version: this.version,
            created: this._created ?? null,
            updated: this._updated ?? null,
            code: this.code,
            params: (typeof this.params === 'object')
                ? Object.entries(this.params).reduce((acc, [key, value]) => {
                    acc[key] = { name:key, ...value.toData() }; // inject name into ParamData
                    return acc;
                }, {} as Record<string, ScriptParamData>) : {},
            presets: this.presets,
            published: this.published,
            shared: this.shared,
            thumbnail: this.thumbnail,
        };
    }

    /** Export to module string - in this format the Script is saved in the library */
    toModuleString():string
    {
        return dataToModuleString(this.toData());
    }

    /** Export as a self-contained JS file.
     *  UI-defined params are emitted as $PARAMS.define() calls prepended to the script code.
     *  Programmatically-defined params are already in the code and are skipped. */
    toScriptJs(): string
    {
        const headerLines: string[] = [];
        if (this.name)        headerLines.push(`// ${this.name}`);
        if (this.description) headerLines.push(`// ${this.description}`);

        const uiParams = Object.values(this.params)
            .filter(p => !p._definedProgrammatically)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const paramBlock = uiParams.map(p => p.toScriptJs()).join('\n');

        const parts: string[] = [];
        if (headerLines.length) parts.push(headerLines.join('\n'));
        if (paramBlock)         parts.push(paramBlock);
        parts.push(this.code);

        return parts.join('\n\n');
    }

    //// UTILS ////

    /** Test if a given string could be a valid Script path
     *  {{author}}/{{scriptname}}?:{{version}}
    */
    static isPath(s:string)
    {
        const regex = /^\s*([\w-]+)\/([\w-]+)(?::([\d.]+))?\s*$/;
        return regex.test(s);
    }

    /** Test if a string is probably script code
     *  WARNING: unsafe!
    */
    static isProbablyCode(s:string)
    {
        const signs = ['box(','sphere(','cylinder(','plane(', 'sketch(', 'layer('];
        return signs.find(sign => s.toLowerCase().includes(sign));
    }
}
