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
import type { ParamOperation, ScriptParamData, ParamBehaviourTarget, ParamBehaviourFn } from "./types";
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

    constructor(manager:ParamManager, p?:ScriptParam)
    {
        if(!p){ throw new Error(`ParamManagerEntryController::constructor(): Please supply a Param obj for init`) }
        
        this.originalParam = p;  // NOTE: already validated
        this.name = this.originalParam.name;
        this.targetParam = { ...this.originalParam, _behaviours: {}} as ScriptParam; // start with copy, but reset behaviours 
        this.manager = manager;

        this._setParamProps(); // set properties of targetParam on this Controller
    }

    //// GETTERS/SETTERS ////

    setOperation(op:ParamOperation)
    {
        this.operation = op;
    }

    //// OPERATORS ON PARAM ////

    /** Set value of Parameter */
    set(v:any):any
    {
        if(!this.targetParam.validateValue(v))
        {
            throw new Error(`ParamManager: value does not match the schema for param "${this.targetParam.name}"!`);
        }
        this.targetParam._value = v;
        return v;
    }

    /** Insert a value into an array-type Param */
    push(v:any):any
    {
        const s = this.targetParam.schema as any
        if (s?.type !== 'array')
        {
            throw new Error(`ParamManager: trying to push into param "${this.targetParam.name}" which is not an array type!`)
        }

        if (s.items && !Check(Type.Unsafe(s.items), v))
        {
            throw new Error(`ParamManager: value does not match the array items schema for param "${this.targetParam.name}"!`)
        }

        if (!this._checkIfListElemExistsLast(v))
        {
            if (!Array.isArray(this.targetParam._value)) { this.targetParam._value = [] }
            this.targetParam._value = [...this.targetParam._value, v]
        }

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
        // targetParam is built via object spread ({ ...originalParam }) which drops
        // the ScriptParam prototype, so toData() may not be present. Reconstruct the
        // data shape directly (mirrors ScriptParam.toData()) when that's the case.
        if (typeof (param as any).toData === 'function') { return param.toData(); }

        const p = param as any;
        return {
            type:                     p.type,
            name:                     p.name,
            label:                    p.label,
            group:                    p.group,
            enabled:                  p.enabled,
            visible:                  p.visible,
            order:                    p.order,
            iterable:                 p.iterable,
            description:              p.description,
            units:                    p.units,
            default:                  p.default,
            _value:                   p._value,
            _definedProgrammatically: p._definedProgrammatically,
            schema:                   p.schema,
        } as ScriptParamData;
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
    _checkIfListElemExistsLast(v:Record<string,any>):boolean
    {
        const exists = deepEqual(this.targetParam._value[this.targetParam._value.length-1], v)
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