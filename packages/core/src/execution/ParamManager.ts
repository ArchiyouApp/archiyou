/**
 *  ParamManager.ts
 *
 *  Manages Parameters from script scope
 *
 *  It can handle advanced scenario's like:
 *
 *     - Define advanced parameters from the script (like objects) where there is no UI menu implemented for the user (yet)
 *     - Different states of Parameter Menu within app. For example: Hide/Show certain parameters based on other parameters or state of script
 *     - Set parameter values: Interconnectiveness between parameters. For example: One value of a parameter changes the range of another
 *  
 *  Architecture:
 *      - [App scope] Script has params that go to ParamMenu
 *      - [Worker scope] ParamManager instance is created every run, new ParamManagerOperators are created based on current Params
 *      - [Worker scope] During script execution ParamManager is used to define or edit params
 *      - [Worker scope] At end of script execution, params that are managed are added to RunnerScriptExecutionResult at managedParams and send to app. 
 *                       The managedParams are stateless, so every run, with same param values they emit the same managedParams
 *      - [Worker scope] Values the script wrote with $PARAMS.NAME.set()/push() go back separately as managedValues:
 *                       a value is not a definition. The app keeps them as the params' values and may re-run.
 *      - [App scope: editor or configurator] managedParams are put in store and picked up by ParamMenu to change menu params. 
 *                      It is the responsibility of receiver to compare existing params with incoming ManagedParams. 
 *                      There is a helper method on ParamManager.updateParamsWithManaged()
 */

import { Type } from 'typebox'
import { Check } from 'typebox/value'

import type { ScriptParamData, ParamOperation, ScriptParamType, ScriptParamDefineOptions,
              ScriptObjectPropDef, ScriptObjectDefineOptions, ManagedBehavioursData,
              ManagedValuesData } from './types'
import { ScriptParam, PARAM_TYPE_SCHEMAS } from './ScriptParam'
import { ParamManagerOperator } from './ParamManagerOperator'

import { deepEqual } from '../utils'

/** Main ParamManager
 *  Maintains all ParamManagerOperators 
 */
export class ParamManager
{
    //// SETTINGS ////
    PARAM_SIGNIFIER = '$';

    //// END SETTINGS ////
    parent: any; // worker or app scope
    paramOperators:Array<ParamManagerOperator> = [];

    /** Names of params defined (via define()) during the current run.
     *  Used for full-sync: a previously script-defined param that is NOT
     *  re-defined this run is reported as deleted by getManagedParams(). */
    _definedThisRun:Set<string> = new Set();

    /** Presets declared from the script via preset() this run.
     *  Shaped to match Script.presets (Record<presetName, Record<paramName, ScriptParamData>>). */
    _definedPresets:Record<string, Record<string, ScriptParamData>> = {};

    /** Object types declared this run via defineObject() (name → JSON Schema).
     *  An INSTANCE field on purpose, never module-level: Runner builds a fresh
     *  ParamManager per scope per run and component scripts get their own scope,
     *  so a shared registry would leak type names between scripts in one worker.
     *  Nothing here crosses the worker boundary — the resolved schema is inlined
     *  into each param's own schema (see _resolveObjectSchema). */
    _objectSchemas:Record<string, Record<string,any>> = {};

    /** Param values this run started with (name → value). getManagedValues() only reports a
     *  set() or push() that ends on a different value, so the app does not re-run for nothing. */
    _startValues:Record<string, any> = {};

    /** Set up ParamManager with current params */
    constructor(params?:Array<ScriptParam|ScriptParamData>)
    {
        if(Array.isArray(params) && params.length > 0)
        {
            //this.paramOperators = params.map(p => new ParamManagerOperator(this, this._validateParam(ScriptParamToParam(p)))); // always make sure we use Param internally
            // Disable validation because its old
            this.paramOperators = params
                                    .map(
                                        p => {
                                            const paramDef = (p instanceof ScriptParam) ? p : ScriptParam.fromData(p);
                                            return new ParamManagerOperator(this, paramDef); // always make sure we use Param internally
                                        });
            this.paramOperators.forEach( p => this[p.name] = p) // set param access
            this.paramOperators.forEach( p => this._startValues[p.name] = p.targetParam._value ?? p.targetParam.default)
        }
    }

    setParent(scope:any):this
    {
        this.parent = scope;
        this.setParamGlobalsInScope();
        return this
    }

    //// CLASS METHOD ////

    /** Compare managedParams with original ones of ParamManager and update params array in place
     *  If needed forcing reactivity by creating copies
     *  returns new or changed params 
     */
    static updateParamsWithManaged(currentParams:Array<ScriptParam>, managedParams:Record<ParamOperation, Array<ScriptParam>> = { new: [], updated: [], deleted: []}, forceReactivity:boolean=true):Array<ScriptParam>
    {
        const allManagedParams = [...managedParams.new, ...managedParams.updated];
        const paramsToChange:Array<ScriptParam> = []

        allManagedParams.forEach( managedParam => 
        {
            const presentParam = currentParams.find( p => p.name === managedParam.name);
            if(!presentParam)
            {
                // new param
                paramsToChange.push(managedParam);
            }
            else {
                // existing param: check if changed
                if(!deepEqual(presentParam, managedParam))
                { 
                    paramsToChange.push(managedParam)
                }
            }
        })
        // Now update the original currentParams
        paramsToChange.forEach((pc) => {
            const i = currentParams.findIndex((p) => p.name === pc.name)
            if(i >= 0)
            {
                // update existing in place
                currentParams[i] = pc;
            }
            else {
                // new
                currentParams.push(pc);
            }
        })

        if(forceReactivity) currentParams = [...currentParams];
        return paramsToChange
    }

    /** What the app takes from managedValues: `changes` are the values of known params that
     *  match their definition and differ from the current value (`_value ?? default`).
     *  `rerun` is true when one of the valid values asked for it, also when the app already has
     *  that value: a param defined in the same run arrives with its set value in its
     *  definition, while the model was built with the value before the set(). The script only
     *  reports values that differ from the ones its run started with, so this cannot loop on a
     *  value that settled.
     *  @internal */
    static diffManagedValues(currentParams:Array<ScriptParam>, managedValues:ManagedValuesData = {}):{ changes:Array<{ name:string, value:any }>, rerun:boolean }
    {
        return Object.entries(managedValues).reduce((diff, [name, { value, rerun }]) =>
        {
            const param = currentParams.find(p => p.name === name.toUpperCase());
            if(!param)
            {
                console.warn(`ParamManager::diffManagedValues(): No param "${name}" to set a value on`);
                return diff;
            }
            if(!param.validateValue(value))
            {
                console.warn(`ParamManager::diffManagedValues(): Value for "${name}" does not match its definition`);
                return diff;
            }
            const changes = deepEqual(param._value ?? param.default, value)
                ? diff.changes
                : [...diff.changes, { name: param.name, value }];
            return { changes, rerun: diff.rerun || rerun };
        }, { changes: [], rerun: false } as { changes:Array<{ name:string, value:any }>, rerun:boolean });
    }

    //// MANAGING PARAMS ////

    /** Add or update Param and return what was done (update, new, null)  */
    addParam(p:ScriptParam):ParamOperation|null
    {
        if(this._paramNameExists(p))
        { 
            // update existing
            const updated = this.updateParam(p);
            const operation = (updated) ? 'updated' : null;
            if(operation)
            {
                this.getParamController(p.name).setOperation(operation); 
            }
            return operation
        }
        else {
            // create new
            const newParamOperator = new ParamManagerOperator(this, p);
            this.paramOperators.push(newParamOperator);
            newParamOperator.setOperation('new');
            this[newParamOperator.name] = newParamOperator; // set param access ($PARAMS.NAME)
            return 'new'
        }

    }

    deleteParam(name:string):this
    {
        this.paramOperators = this.paramOperators.filter( pc => pc.name !== name);
        delete this[name.toUpperCase()];

        return this;
    }

    /** Update ParamEntryController if needed and return updated or not */
    updateParam(p:ScriptParam):boolean
    {
        if(this._paramNameExists(p))
        {
            const existingParamController = this.paramOperators.find(pc => pc.name === p.name );

            if(!this.equalParams(p,existingParamController.targetParam))
            {
                p.name = p.name.toUpperCase(); // names are always uppercase
                const index = this.paramOperators.indexOf(existingParamController);
                this.paramOperators[index] =  new ParamManagerOperator(this, p);
                // A set() before this re-definition still has to be reported
                this.paramOperators[index]._setValue = existingParamController?._setValue;
                this[p.name] = this.paramOperators[index]; // keep param access ($PARAMS.NAME) pointing at the new operator
                return true;
            }
            else {
                console.info(`ParamManager::updateParam: No update needed. Same params!"`);
                return false;
            }
        }
        else {
            console.warn(`ParamManager::updateParam: Can't update: No param with name ${p.name}"`);
            return false;
        }
    }

    _paramNameExists(p:ScriptParam):boolean
    {
        return Object.keys(this.getParamsMap()).includes(p.name.toUpperCase()) 
    }

    /** Utility to easily get target Params */
    getParams():Array<ScriptParam>
    {
        return this.paramOperators.map(pc => pc.targetParam)
    }

    /** Utility to easily get target Params by name */
    getParamsMap():Record<string,ScriptParam>
    {
        const map = {};
        this.paramOperators.forEach(pc => { map[pc.name] = pc.targetParam })
        return map;
    }

    getParamController(name:string):ParamManagerOperator
    {
        return this.paramOperators.find(pc => pc.name === name)
    }

    //// OBJECT SCHEMAS ////

    /** Friendly aliases → JSON Schema keywords, shared by define() and defineObject(). */
    static SCHEMA_KEYWORD_ALIASES:Record<string,string> =
    {
        min:     'minimum',
        max:     'maximum',
        step:    'multipleOf',
        options: 'enum',
    }

    /** JSON Schema keywords that pass through define()/defineObject() untouched.
     *  NOTE: 'description' is deliberately NOT here. It is already a top-level
     *  ScriptParamData field; copying it into the schema too would change
     *  toData() for every existing param and force a save on the next run of
     *  every script. */
    static SCHEMA_KEYWORDS:Array<string> =
    [
        'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'pattern',
        'enum', 'items', 'properties', 'required', 'additionalProperties',
        'minItems', 'maxItems',
    ]

    /** Archiyou param type → JSON Schema type, for object properties */
    static PROP_TYPE_MAP:Record<string,string> =
    {
        number:  'number',
        integer: 'integer',
        text:    'string',
        string:  'string',
        boolean: 'boolean',
    }

    /** Collect JSON Schema keywords out of a friendly options object.
     *  Aliases are applied first so an explicit JSON Schema keyword always wins. */
    static schemaKeywordsFrom(options:Record<string,any> = {}):Record<string,any>
    {
        const out:Record<string,any> = {};

        Object.entries(ParamManager.SCHEMA_KEYWORD_ALIASES)
            .forEach(([alias, keyword]) =>
            {
                if(options[alias] !== undefined){ out[keyword] = options[alias]; }
            });

        ParamManager.SCHEMA_KEYWORDS
            .forEach((keyword) =>
            {
                if(options[keyword] !== undefined){ out[keyword] = options[keyword]; }
            });

        return out;
    }

    /** JSON Schema type that fits a list of allowed values */
    static _enumJsonType(values:Array<any>):string
    {
        const allNumeric = values.length > 0
                            && values.every( v => typeof v === 'number'
                                                    || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))));
        return (allNumeric) ? 'number' : 'string';
    }

    /** One property shorthand → a JSON Schema fragment.
     *
     *  IMPORTANT: a bare type deliberately does NOT inherit PARAM_TYPE_SCHEMAS.
     *  The 'number' entry there carries maximum:100, which would reject anything a
     *  real model needs (a 3000mm wall). Bare properties stay unbounded and the UI
     *  renders them without a slider — see param-item-number's `bare` mode.
     */
    static normalizeProperty(def:ScriptObjectPropDef):Record<string,any>
    {
        if(Array.isArray(def))
        {
            const type = ParamManager._enumJsonType(def);
            return {
                type: type,
                enum: (type === 'number') ? def.map(Number) : def.map(String),
            };
        }

        if(typeof def === 'string')
        {
            if(def === 'options')
            {
                throw new Error(`the 'options' shorthand needs values — write the allowed values as an array instead, like ['a','b','c']`);
            }
            const jsonType = ParamManager.PROP_TYPE_MAP[def];
            if(!jsonType)
            {
                throw new Error(`unknown type "${def}". Use one of: ${Object.keys(ParamManager.PROP_TYPE_MAP).join(', ')} — or an array of allowed values`);
            }
            return { type: jsonType };
        }

        if(def && typeof def === 'object')
        {
            const o = def as Record<string,any>;
            const schema:Record<string,any> = ParamManager.schemaKeywordsFrom(o);

            if(Array.isArray(schema.enum))
            {
                // values win: { type:'options', options:[...] } and { options:[...] } both land here
                schema.type = ParamManager._enumJsonType(schema.enum);
            }
            else if(o.type !== undefined)
            {
                if(o.type === 'options')
                {
                    throw new Error(`type 'options' needs values — add options: ['a','b'] (or use a plain array)`);
                }
                const jsonType = ParamManager.PROP_TYPE_MAP[o.type];
                if(!jsonType)
                {
                    throw new Error(`unknown type "${o.type}". Use one of: ${Object.keys(ParamManager.PROP_TYPE_MAP).join(', ')}`);
                }
                schema.type = jsonType;
            }
            else
            {
                schema.type = 'string';
            }

            // Archiyou extras ride along as non-standard keywords — TypeBox ignores what it does not know
            if(o.default !== undefined){ schema.default = o.default; }
            if(o.label   !== undefined){ schema.label   = o.label; }
            if(o.units   !== undefined){ schema.units   = o.units; }

            return schema;
        }

        throw new Error(`expected a type name, an array of values or a definition object — got "${typeof def}"`);
    }

    /** Build the JSON Schema for a named object type */
    static buildObjectSchema(name:string, props:Record<string,ScriptObjectPropDef>, options:ScriptObjectDefineOptions = {}):Record<string,any>
    {
        if(!props || typeof props !== 'object' || Array.isArray(props) || Object.keys(props).length === 0)
        {
            throw new Error(`ParamManager::defineObject(): Please supply the properties of "${name}"! For example: { width: 'number', name: 'text' }`);
        }

        const properties = Object.entries(props).reduce(
            (acc, [key, def]) =>
            {
                try { acc[key] = ParamManager.normalizeProperty(def); }
                catch(e){ throw new Error(`ParamManager::defineObject(): property "${key}" of "${name}": ${(e as Error).message}`); }
                return acc;
            },
            {} as Record<string,any>);

        const schema:Record<string,any> = {
            type:       'object',
            title:      options.title ?? name,
            properties: properties,
        };

        // Both are opt-in ONLY — see ScriptObjectDefineOptions for why defaulting them is destructive.
        if(Array.isArray(options.required)){ schema.required = options.required; }
        if(options.additionalProperties !== undefined){ schema.additionalProperties = options.additionalProperties; }
        if(options.labelProp !== undefined){ schema.labelProp = options.labelProp; }

        return schema;
    }

    /** The default value of a single object property */
    static propertyDefault(propSchema:Record<string,any>):any
    {
        if(propSchema?.default !== undefined){ return propSchema.default; }
        if(Array.isArray(propSchema?.enum)){ return propSchema.enum[0]; }

        switch(propSchema?.type)
        {
            case 'number':
            case 'integer': return propSchema.minimum ?? 0;
            case 'boolean': return false;
            case 'array':   return [];
            case 'object':  return ParamManager.objectDefaults(propSchema);
            default:        return '';
        }
    }

    /** A fully populated entry for an object schema.
     *  Used by the param menu's "add" and "duplicate" buttons, and by defineObject()
     *  when the author supplies no default of their own. */
    static objectDefaults(objectSchema:Record<string,any>):Record<string,any>
    {
        return Object.entries(objectSchema?.properties ?? {}).reduce(
            (acc, [key, propSchema]) =>
            {
                acc[key] = ParamManager.propertyDefault(propSchema as Record<string,any>);
                return acc;
            },
            {} as Record<string,any>);
    }

    /** Label for one entry of an object list: an explicit labelProp beats the
     *  conventional `name` property, which beats a positional fallback. */
    static objectEntryLabel(itemSchema:Record<string,any>, entry:Record<string,any>, index:number):string
    {
        const clean = (v:any):string|null =>
        {
            const s = (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : '';
            return (s !== '') ? s : null;
        };

        const byProp = (itemSchema?.labelProp) ? clean(entry?.[itemSchema.labelProp]) : null;

        return byProp
                ?? clean(entry?.name)
                ?? `${itemSchema?.title ?? 'Item'} ${index + 1}`;
    }

    /** Programmatically declare a named object type, for use as the items of a list param.
     *
     *  @example
     *  $PARAMS.defineObject('Opening', {
     *      wall:   ['left','right','front','back'],
     *      width:  { type:'number', min:100, max:5000, step:10, default:1200 },
     *      name:   'text',
     *  });
     *  $PARAMS.define('OPENINGS', 'list', { of: 'Opening', default: [
     *      { wall: 'front', width: 900, name: 'door' },
     *  ] });
     */
    defineObject(name:string, props:Record<string,ScriptObjectPropDef>, options:ScriptObjectDefineOptions = {}):Record<string,any>
    {
        if(!name || typeof name !== 'string')
        {
            throw new Error(`ParamManager::defineObject(): Please supply a name for this object type!`);
        }

        const schema = ParamManager.buildObjectSchema(name, props, options);
        this._objectSchemas[name] = schema;

        return schema;
    }

    /** Object types declared this run (name → JSON Schema) */
    getDefinedObjects():Record<string, Record<string,any>>
    {
        return this._objectSchemas;
    }

    /** Resolve a define() `of:` into a real object schema.
     *  A string looks up defineObject(); an object is either a schema already or a
     *  props map we build on the fly. Always returns a deep copy, so two params can
     *  never share (and mutate) one registered schema.
     */
    _resolveObjectSchema(of:string|Record<string,any>):Record<string,any>
    {
        if(typeof of === 'string')
        {
            const schema = this._objectSchemas[of];
            if(!schema)
            {
                const known = Object.keys(this._objectSchemas);
                // Throwing beats warning here: falling back would leave items at the list
                // base schema ({type:'string'}), which then rejects the whole default and
                // leaves the user staring at an empty list with no explanation.
                throw new Error(`ParamManager::define(): Unknown object type "${of}". ${
                    (known.length > 0)
                        ? `Defined so far: ${known.join(', ')}`
                        : `Declare it first with $PARAMS.defineObject('${of}', { ... })`}`);
            }
            return JSON.parse(JSON.stringify(schema));
        }

        if(of && typeof of === 'object' && !Array.isArray(of))
        {
            const asSchema = of as Record<string,any>;
            return (asSchema.type === 'object')
                    ? JSON.parse(JSON.stringify(asSchema))
                    : ParamManager.buildObjectSchema('Item', of as Record<string,ScriptObjectPropDef>);
        }

        throw new Error(`ParamManager::define(): "of" needs the name of a defineObject() type, an object schema or a properties map. Got "${typeof of}"`);
    }

    //// PROGRAMMATIC PARAM DEFINITION ////

    /**
     * Add a parameter to the script: a control in the Parameters panel (and in a published
     * configurator) whose value the code reads as `$NAME`. Give a name, a type
     * (`'number'`, `'boolean'`, `'options'`, `'text'`, `'list'`, …) and options such as the
     * default and the range. An object with the full definition also works, for advanced use.
     *
     * @example
     * $PARAMS.define('WIDTH', 'number', { minimum: 50, maximum: 200, multipleOf: 5, default: 120, group: 'Size' })
     * $PARAMS.define('MODE',  'options', { options: ['a','b','c'], default: 'a' })
     * $PARAMS.define('SHOW',  'boolean', { default: true })
     * if ($SHOW) box($WIDTH, 50, 20)
     *
     * @example
     * // Advanced: the whole definition as one object
     * $PARAMS.define({ name: 'SIZE', type:'number', schema: { type: 'number', minimum: 0, maximum: 100, default: 50 } })
     */
    define(p: ScriptParam | ScriptParamData): this
    define(name: string, type: ScriptParamType, options?: ScriptParamDefineOptions): this
    define(
        nameOrParam: string | ScriptParam | ScriptParamData,
        type?: ScriptParamType,
        options?: ScriptParamDefineOptions,
    ): this
    {
        let param: ScriptParam;

        if (typeof nameOrParam === 'string')
        {
            // Ergonomic (name, type, options) form
            if (!type) { throw new Error(`ParamManager::define(): Please supply a type (e.g. 'number') for param "${nameOrParam}"!`); }
            param = ScriptParam.fromData(this._buildParamData(nameOrParam, type, options));
        }
        else
        {
            // Object / ScriptParam form
            const p = nameOrParam;
            if (!p) { throw new Error(`ParamManager::define(): Please supply a valid Param object or data. Got ${JSON.stringify(p)}`); }
            if (!p?.name) { throw new Error(`ParamManager::define(): Please supply at least a name for this Param!`); }
            param = (p instanceof ScriptParam) ? p : ScriptParam.fromData(p as ScriptParamData);
        }

        param._definedProgrammatically = true;
        this._checkObjectDefault(param);
        const upper = param.name.toUpperCase();
        this._definedThisRun.add(upper); // register even if definition is unchanged (full-sync)

        // Preserve the user's current value across re-runs: if a param with this
        // name already exists (e.g. fed in from request.params with a chosen
        // _value), keep that value when it still validates against the new
        // definition. Without this, re-defining each run would reset the slider
        // back to the script default.
        const existing = this.getParamController(upper);
        const curVal = existing?.targetParam?._value;
        if (curVal !== undefined && param.validateValue(curVal))
        {
            param._value = curVal;
        }

        this.addParam(param);

        // Set the scope global ($NAME) immediately so the SAME run can use the
        // value right after defining it — this is what lets a script spawn and
        // use its own params with no external data.
        this.setParamGlobal(upper, param._value ?? param.default);

        return this;
    }

    /** Maps define() options onto a canonical ScriptParamData.
     *  Friendly aliases (options/listItemType) map into the JSON Schema;
     *  JSON-Schema keywords (minimum, maximum, multipleOf, …) pass through directly. */
    _buildParamData(name: string, type: ScriptParamType, options: ScriptParamDefineOptions = {}): ScriptParamData
    {
        const baseSchema = PARAM_TYPE_SCHEMAS[type];
        if (!baseSchema) { throw new Error(`ParamManager::define(): Unsupported param type "${type}". Supported: ${Object.keys(PARAM_TYPE_SCHEMAS).join(', ')}`); }

        const o = options as Record<string, any>;

        // friendly aliases (min/max/step/options) + JSON-Schema keywords, in one table
        const schema: Record<string, any> = { ...baseSchema, ...ParamManager.schemaKeywordsFrom(o) };

        if (o.listItemType !== undefined) schema.items = { type: o.listItemType };

        // `of:` — a defineObject() type, an inline object schema, or a properties map.
        // The resolved schema is INLINED here: ScriptParamData.schema is the only param
        // channel back to the app, and validateValue() has to work app-side with no
        // ParamManager around, so a $ref would need a resolver at every call site.
        if (o.of !== undefined)
        {
            const objectSchema = this._resolveObjectSchema(o.of);

            if (type === 'object')
            {
                Object.assign(schema, objectSchema, { type: 'object' });
                if (o.default === undefined) schema.default = ParamManager.objectDefaults(objectSchema);
            }
            else
            {
                schema.items = objectSchema;
            }
        }

        if (o.labelProp !== undefined)
        {
            if (type === 'object') schema.labelProp = o.labelProp;
            else if (schema.items) (schema.items as Record<string, any>).labelProp = o.labelProp;
        }

        if (o.default !== undefined) schema.default = o.default;

        return {
            name,
            type,
            schema,
            label:       o.label,
            group:       o.group,
            description: o.description,
            units:       o.units,
            order:       o.order,
            visible:     o.visible,
            enabled:     o.enabled,
            default:     o.default,
        } as ScriptParamData;
    }

    /** Seeded defaults of object(-list) params are easy to get subtly wrong, and the
     *  failure is silent and late: the value is dropped, the menu shows an empty list
     *  and nothing says why. Check at define() time and name the offending entry.
     *  Deliberately checks `default` only — `_value` is the user's, and the caller
     *  already validates it before preserving it. */
    _checkObjectDefault(param:ScriptParam):void
    {
        const s = param.schema as any;
        const isObjectList = s?.type === 'array' && s?.items?.type === 'object';
        const isObject     = s?.type === 'object' && Object.keys(s?.properties ?? {}).length > 0;

        if(!isObjectList && !isObject){ return; }

        const value = param.default;
        if(value === undefined || param.validateValue(value)){ return; }

        if(isObjectList && Array.isArray(value))
        {
            const itemSchema = Type.Unsafe(s.items);
            const badIndex = value.findIndex( entry => !Check(itemSchema, entry));

            if(badIndex !== -1)
            {
                throw new Error(`ParamManager::define(): entry ${badIndex} of "${param.name}" does not match the "${s.items.title ?? 'object'}" definition: ${JSON.stringify(value[badIndex])}`);
            }
        }

        throw new Error(`ParamManager::define(): the default of "${param.name}" does not match its definition: ${JSON.stringify(value)}`);
    }

    /** Programmatically declare a preset (named set of param values) from the script.
     *  @example $PARAMS.preset('SMALL', { WIDTH: 80, MODE: 'a' }, { description: 'Compact version' })
     */
    preset(name: string, values: Record<string, any>, _options?: { description?: string; label?: string }): this
    {
        if (!name) { throw new Error(`ParamManager::preset(): Please supply a name for the preset!`); }
        if (!values || typeof values !== 'object') { throw new Error(`ParamManager::preset(): Please supply a values object for preset "${name}"!`); }

        const rec: Record<string, ScriptParamData> = {};
        for (const [pname, value] of Object.entries(values))
        {
            const upper = pname.toUpperCase();
            const ctrl = this.getParamController(upper);
            // Base the preset entry on the param's current definition where known,
            // so it carries a valid schema/type; otherwise store a minimal entry.
            const base: ScriptParamData = ctrl
                ? ctrl.toData()
                : ({ name: upper, type: 'number', schema: {} } as unknown as ScriptParamData);
            rec[upper] = { ...base, _value: value };
        }
        // NOTE: _options.description/label have no home in Script.presets yet — accepted for forward-compat.
        this._definedPresets[name] = rec;

        return this;
    }

    /** Presets declared from the script this run (shaped like Script.presets). */
    getDefinedPresets(): Record<string, Record<string, ScriptParamData>>
    {
        return this._definedPresets;
    }

    /** Dynamic param behaviours declared this run (via $PARAMS.NAME.enableIf()/visibleIf()/...).
     *  Collected from ALL operators (not just operated ones), since a behaviour can decorate
     *  a UI-authored param that has no definition operation. Full-sync: returns the complete
     *  set declared this run as serialized fn sources; the app replaces behaviours wholesale.
     *  Shape: paramName → target → fn source string. */
    getManagedBehaviours(): ManagedBehavioursData
    {
        const out: ManagedBehavioursData = {};
        this.paramOperators.forEach((po) =>
        {
            const behaviours = po.getBehaviours();
            if(behaviours && Object.keys(behaviours).length > 0)
            {
                out[po.name] = { ...behaviours };
            }
        });
        return out;
    }

    //// EVALUATE ////

    /** Return Params that we operated upon */
    getOperatedParamsByOperation():Record<ParamOperation, Array<ScriptParamData>>
    {
        const changedParamsByOperation = this.paramOperators
                                    .filter((po) => po.paramOperated())
                                    .reduce(
                                        (acc,po) => {
                                            acc[po.operation as ParamOperation].push((po as any).toData()) // TODO: Fix TS
                                            return acc
                                        }, 
                                        { new: [] as Array<ScriptParamData>, updated: [] as Array<ScriptParamData>, deleted: [] as Array<ScriptParamData> })

        console.info('**** ParamManager::getOperatedParamsByOperation ****')
        console.info(changedParamsByOperation);

        return changedParamsByOperation
    }

    /** Values written this run with set() or push() that differ from the value the run
     *  started with. Setting the same value, or setting and setting back, reports nothing.
     *  @internal */
    getManagedValues():ManagedValuesData
    {
        return this.paramOperators
            .filter((po) => po._setValue && !deepEqual(po._setValue.value, this._startValues[po.name]))
            .reduce<ManagedValuesData>((values, po) => ({ ...values, [po.name]: { ...po._setValue! } }), {});
    }

    /** Managed params to send back to the app after a run.
     *  Extends getOperatedParamsByOperation() with full-sync deletions:
     *  any param that was previously script-defined (_definedProgrammatically)
     *  but is NOT re-defined this run is reported as deleted, so the app removes
     *  it from the menu. UI-authored params are never auto-deleted.
     */
    getManagedParams():Record<ParamOperation, Array<ScriptParamData>>
    {
        const operated = this.getOperatedParamsByOperation();

        const droppedProgrammatic = this.paramOperators
            .filter((po) => po.originalParam?._definedProgrammatically
                            && !this._definedThisRun.has(po.name.toUpperCase())
                            && !po.paramOperated())
            .map((po) => po.toData());

        return {
            new:     operated.new,
            updated: operated.updated,
            deleted: [...operated.deleted, ...droppedProgrammatic],
        };
    }
 
    //// UTILS ////

    /** If this ParamManager is in a worker scope */
    inWorker():boolean
    {
        return typeof this?.parent?.postMessage === 'function';
    }

    /** Set Param read and write as globals on worker scope (in this.parent) 
     *  NOTE: We can not really work with Proxies here because we can not really set a Param global (ie. $TEST)
     *      on this scope that is not a Proxy. Proxies can only target Objects
            Use $PARAMS.$TEST.set() to set a value
    */
    setParamGlobalsInScope(scope?:any):boolean
    {
        const curParams = this.getParams();

        if(typeof scope !== 'object' || !scope)
        { 
            scope = this.parent; // set to parent scope (worker or app)
        } 

        if (!Array.isArray(curParams)){ return false; }

        // Set value of param reference ${PARAM_NAME} on scope
        curParams.forEach( p => 
        {
            console.info(`ParamManager::setParamGlobalsInScope(): Setting global param "${this.PARAM_SIGNIFIER + p.name}" with value "${p._value ?? p.default}"`);
            scope[this.PARAM_SIGNIFIER + p.name] = p._value ?? p.default;
        })
    }

    /** Set the scope global of one param ($NAME), when there is a scope
     *  @internal */
    setParamGlobal(name:string, value:any):void
    {
        if(this.parent)
        {
            this.parent[this.PARAM_SIGNIFIER + name.toUpperCase()] = value;
        }
    }

    /** Compare two params (either Param or ScriptParam) */
    equalParams(param1:ScriptParam, param2:ScriptParam):boolean
    {
        const ScriptParam1 = JSON.parse(JSON.stringify(param1));
        const ScriptParam2 = JSON.parse(JSON.stringify(param2));
        return deepEqual(ScriptParam1,ScriptParam2);
    }

    /** Set quick references from this instance to the values of params 
        This is used to control Params directly (through ParamManagerOperator)
        The user can write values for example with $PARAMS.$TEST.set(50)
    */
    setParamControlRefs()
    {
        this.paramOperators.forEach( pc =>
        {
            this[pc.name] = pc;
        })
    }
}
