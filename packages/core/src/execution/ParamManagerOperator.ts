/** 
 *  ParamManagerOperator
 *  
 *  Used in ParamManager to change target Params, compare and export new Param.
 *  In the ParamManager, at every run a fresh Operator instance is created and potentially modified by the script
 *  Then changed Params are registered by comparing new Param instances after changes in Operator are applied
 * 
 *  
 *  It provides a operator interface in scope of script
 * 
 *      $PARAMS(:ParamManager).SOME_PARAM(:ParamManagerOperator).visibleIf(...)
 *      $PARAMS(:ParamManager).SOME_PARAM(:ParamManagerOperator).enableIf(...)
 *      $PARAMS(:ParamManager).SOME_PARAM(:ParamManagerOperator).enableIf(...)
 *  
 *  it also provides getters and setters of properties of Param
 *      $PARAMS(:ParamManager).SOME_PARAM(:ParamManagerOperator).value
 *      $PARAMS(:ParamManager).SOME_PARAM(:ParamManagerOperator).type
 *      ...etc
 *
 * */

import { Type } from 'typebox'
import { Check } from 'typebox/value'

import { ParamManager } from "./ParamManager";
import type { ParamOperation, ScriptParamData, ParamBehaviourTarget, ParamBehaviourFn,
              ParamSetOptions, ManagedValueData } from "./types";
import { ScriptParam } from "./ScriptParam";

import { deepEqual } from '../utils'

export class ParamManagerOperator
{   
    name:string
    originalParam:ScriptParam
    targetParam:ScriptParam
    value:any // reference to targetParam.value
    manager: ParamManager
    operation:ParamOperation // undefined (none), new, update, delete
    /** Value written this run by set() or push(), reported through managedValues */
    _setValue?:ManagedValueData

    constructor(manager:ParamManager, p?:ScriptParam)
    {
        if(!p){ throw new Error(`ParamManagerEntryController::constructor(): Please supply a Param obj for init`) }
        
        this.originalParam = p;  // NOTE: already validated
        this.name = this.originalParam.name;
        // Round-trip through fromData() rather than spreading: an object spread drops the
        // ScriptParam prototype, which used to make targetParam.validateValue() undefined
        // and set() throw. It also re-runs Type.Unsafe(), so the operator gets its own deep
        // copy of the schema and can never mutate the original's.
        this.targetParam = ScriptParam.fromData(this.originalParam.toData());
        this.targetParam._behaviours = {}; // behaviours are re-declared every run
        this.manager = manager;

        this._setParamProps(); // set properties of targetParam on this Controller
    }

    //// GETTERS/SETTERS ////

    setOperation(op:ParamOperation)
    {
        this.operation = op;
    }

    //// OPERATORS ON PARAM ////

    /** Set the value of this param. The app keeps it as the param's value, and by default
     *  re-runs the script when it changed: code before the set() used the old value.
     *  Also updates `$NAME`, so code after the set() sees the new value.
     *  Throws when the value does not match the param's definition.
     *  @param options.rerun Re-run when the value changed (default true). Pass false when the
     *      script builds the model from the value it sets.
     *  @example
     *  $PARAMS.define('COUNT', 'number', { min: 0, max: 100, default: 1 });
     *  $PARAMS.COUNT.set(3, { rerun: false });
     *  print($COUNT); // 3
     */
    set(v:any, options:ParamSetOptions = {}):any
    {
        if(!Check(this.targetParam.schema, v))
        {
            throw new Error(this._describeMismatch('set', this.targetParam.schema, v));
        }
        return this._writeValue(v, options);
    }

    /** Add an entry to a list param: its value becomes the current list plus this entry,
     *  handled like set(). The script runs again on every re-run, so an unconditional push()
     *  adds its entry every time: guard it, for example on an empty list.
     *  An entry equal to the last one is not added again.
     *  @param options.rerun Re-run when the list changed (default true)
     *  @example
     *  $PARAMS.defineObject('Hole', { size: { type: 'number', min: 1, max: 100, default: 10 } });
     *  $PARAMS.define('HOLES', 'list', { of: 'Hole' });
     *  if ($HOLES.length === 0)
     *  {
     *      $PARAMS.HOLES.push({ size: 20 });
     *  }
     */
    push(v:any, options:ParamSetOptions = {}):any
    {
        const s = this.targetParam.schema as any
        if (s?.type !== 'array')
        {
            throw new Error(`ParamManager: trying to push into param "${this.targetParam.name}" which is not an array type!`)
        }

        if (s.items && !Check(Type.Unsafe(s.items), v))
        {
            throw new Error(this._describeMismatch('push', Type.Unsafe(s.items), v))
        }

        // Onto the value in effect: an untouched list param has only its default
        const current = this.targetParam._value ?? this.targetParam.default;
        const list = Array.isArray(current) ? current : [];
        if (!this._checkIfListElemExistsLast(list, v))
        {
            this._writeValue([...list, v], options);
        }

        return v;
    }

    /** The error of a set() or push() whose value does not fit: which call, which param, and
     *  every problem (see ScriptParam.describeSchemaErrors). One line, problems separated by
     *  "; ": error displays that show a single line (the editor's error header) keep them all. */
    _describeMismatch(call: 'set'|'push', schema: any, value: any): string
    {
        const typeName = schema?.title ?? schema?.items?.title;
        const what = (call === 'push')
            ? `the entry does not fit${typeName ? ` the "${typeName}" type` : ''}`
            : `the value does not fit its definition${typeName ? ` (a list of "${typeName}")` : ''}`;
        const problems = ScriptParam.describeSchemaErrors(schema, value);
        return `$PARAMS.${this.targetParam.name}.${call}(): ${what}: ${problems.join('; ')}`;
    }

    /** The one write path of set() and push(). Deliberately no setOperation('updated'):
     *  everything in managedParams gets _definedProgrammatically in the app, which would
     *  permanently lock a param the user made in the menu. Values go through managedValues. */
    _writeValue(v:any, options:ParamSetOptions):any
    {
        this.targetParam._value = v;
        this.value = v;
        this._setValue = { value: v, rerun: options?.rerun !== false };
        this.manager.setParamGlobal(this.name, v);
        return v;
    }

    /** Directly make Param visible */
    visible()
    {
        this.targetParam.visible = true;
        this.setOperation('updated');
    }

    /** Directly make Param invisible */
    hide()
    {
        this.targetParam.visible = false;
        this.setOperation('updated');
    }

    /** Directly enable Param */
    enable()
    {
        console.info(`ParamManagerOperator::enable(): Enabled param "${this.targetParam.name}"`)
        this.targetParam.enabled = true;
        this.setOperation('updated');
    }

    /** Directly disable Param */
    disable()
    {
        console.info(`ParamManagerOperator::disable(): Disabled "${this.targetParam.name}"`)
        this.targetParam.enabled = false;
        this.setOperation('updated');
    }

    /** Conditional visibility.
     *  - boolean: immediate toggle (definition update, backward compatible)
     *  - function: dynamic behaviour, evaluated app-side; NOT a definition change */
    visibleIf(arg:boolean|ParamBehaviourFn)
    {
        if(typeof arg === 'function') { this._setBehaviour('visible', arg); return this; }
        if(arg) this.visible();
        else this.hide();
        return this;
    }

    /** Set behaviour that controls enable flag of this Param.
     *  - boolean: immediate toggle (definition update, backward compatible)
     *  - function: dynamic behaviour, evaluated app-side; NOT a definition change */
    enableIf(arg:boolean|ParamBehaviourFn)
    {
        if(typeof arg === 'function') { this._setBehaviour('enable', arg); return this; }
        if(arg) this.enable();
        else this.disable();
        return this;
    }

    /** Set behaviour that controls the runtime value (_value) of this Param. */
    valueOn(fn:ParamBehaviourFn)
    {
        return this._setBehaviour('value', fn);
    }

    /** Set behaviour that controls the available options (schema.enum) of this Param. */
    optionsOn(fn:ParamBehaviourFn)
    {
        return this._setBehaviour('options', fn);
    }

    /** Store a dynamic behaviour as serialized source. Crucially this does NOT call
     *  setOperation(): a behaviour is not a definition change, so the param does not
     *  enter programmatic mode and is not pushed through managedParams. Behaviours
     *  travel via the dedicated managedBehaviours channel (getManagedBehaviours()). */
    _setBehaviour(target:ParamBehaviourTarget, fn:ParamBehaviourFn):this
    {
        if(typeof fn !== 'function')
        {
            console.error(`ParamManagerOperator::_setBehaviour(): Behaviour for "${target}" on param "${this.targetParam.name}" must be a function, got "${typeof fn}". Ignored.`);
            return this;
        }
        if(!this.targetParam._behaviours){ this.targetParam._behaviours = {}; }
        (this.targetParam._behaviours as Record<string,string>)[target] = fn.toString();
        return this;
    }

    /** Behaviours declared on this operator's target param (target → fn source). */
    getBehaviours():Partial<Record<ParamBehaviourTarget,string>>
    {
        return (this.targetParam._behaviours ?? {}) as Partial<Record<ParamBehaviourTarget,string>>;
    }

    //// TODO: delete
    //// TODO: changes of properties specific to types (min,max,step for number etc)

    //// INTERNAL STATE MANAGEMENT ////

    /** Forward properties on this controller to target Param obj */
    _setParamProps()
    {
        /*
        for (const [k,v] of Object.entries(this.targetParam))
        {
            this[k] = this.targetParam[k];
        }
        */
        // only place reference to value
        this.value = this.targetParam._value;
    }

    //// COMPARE WITH ORIGINAL PARAM ////

    /** Had this operator any operations */
    paramOperated():boolean
    {
        return this.operation !== undefined;
    }
    
    /** Compare target Param with original one */
    paramChanged():boolean
    {
        return (this.operation !== 'new')
        ? !deepEqual(this.paramToData(this.originalParam), this.paramToData(this.targetParam))
        : true;
    }

    //// BEHAVIOURS BASED ON PROGRAMMATIC CONTROLS ////
    
    /** Evaluate behaviour and return changed param 
     *  @params a map for easy access: params.TEST.value
    */
   /*
    evaluateBehaviours(params:Record<ParamBehaviourTarget,ScriptParam>):null|Param
    {
        let changedParam = null;
        if(this?.target?._behaviours)
        {
            for (const [propName, fn] of Object.entries(this?.target?._behaviours))
            {
                // IMPORTANT: We used some black magic to convert string to Function, typeof does not work 
                if( (typeof fn === 'function') || (fn as any)?.constructor?.name === 'Function')
                {
                    const newValue = fn(this.targetParam, params);
                    this.targetParam[propName] = newValue; // directly plug in the test result to target param
                    changedParam = this.targetParam;
                    console.info(`ParamEntryController::evaluateBehaviours: Updated Param "${this.targetParam.name}" attribute "${propName}" = "${newValue}"`);
                }
                else {
                    console.error(`ParamEntryController::evaluateBehaviours [${this.getScope()}]: Given behaviour for property "${propName}" is not a function, but a "${typeof fn}"`);
                }
                
            }
        }

        return changedParam;
    }
        */
    
    //// IO ////

    paramToData(param:ScriptParam):ScriptParamData
    {
        // Both originalParam and targetParam keep the ScriptParam prototype (see the
        // constructor), so toData() is always available. The hand-written field mirror
        // that used to live here was a drift hazard against ScriptParam.toData().
        return param.toData();
    }

    /** Export to raw Param data for output 
     *  NOTE: We use ScriptParam here that is used for IO, but in App it is transformed back to Param
    */
    toData():ScriptParamData
    {
        return this.paramToData(this.targetParam);
    }


    //// UTILS ////

    /** Adding to lists create unending loops 
     *  We check if the last element is the same
     *  TODO: Make a better solution
    */
    _checkIfListElemExistsLast(list:Array<any>, v:Record<string,any>):boolean
    {
        const exists = list.length > 0 && deepEqual(list[list.length-1], v)
        if (exists)
        {
            console.warn(`ParamManager::_checkIfListElemExistsLast(): We blocked an element that already exists in the list!`)
        }
        return exists;
    }

    /** Delegate value validation to the param's own schema */
    _checkParamInput(v:any, p?:ScriptParam):boolean
    {
        return (p ?? this.targetParam).validateValue(v);
    }

    getScope():string
    {
        return (this?.manager.inWorker()) ? 'worker' : 'app'
    }
    

}