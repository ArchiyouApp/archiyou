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
 *      - [App scope: editor or configurator] managedParams are put in store and picked up by ParamMenu to change menu params. 
 *                      It is the responsibility of receiver to compare existing params with incoming ManagedParams. 
 *                      There is a helper method on ParamManager.updateParamsWithManaged()
 */

import type { ScriptParamData, ParamOperation, ScriptParamType, ScriptParamDefineOptions, ManagedBehavioursData } from './types'
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

    //// PROGRAMMATIC PARAM DEFINITION ////

    /**
     * Programmatically define a param from the script. Two forms:
     *
     * Ergonomic (primary):
     * @example $PARAMS.define('WIDTH', 'number', { minimum: 50, maximum: 200, multipleOf: 5, default: 120, group: 'Size' })
     * @example $PARAMS.define('MODE',  'options', { options: ['a','b','c'], default: 'a' })
     * @example $PARAMS.define('SHOW',  'boolean', { default: true })
     *
     * Advanced (object / ScriptParam):
     * @example $PARAMS.define({ name: 'SIZE', type:'number', schema: { type: 'number', minimum: 0, maximum: 100, default: 50 } })
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
        if (this.parent)
        {
            this.parent[this.PARAM_SIGNIFIER + upper] = param._value ?? param.default;
        }

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
        const schema: Record<string, any> = { ...baseSchema };

        // friendly aliases → schema keywords
        if (o.options      !== undefined) schema.enum  = o.options;
        if (o.listItemType !== undefined) schema.items = { type: o.listItemType };

        // JSON-Schema keywords pass through
        for (const k of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'enum', 'items', 'properties'])
        {
            if (o[k] !== undefined) schema[k] = o[k];
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
