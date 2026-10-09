/**
 *  Pipeline.ts
 *      Define a series of operations on shapes for specific purposes. 
 *      Like making cutting plans or different representations of the model.
 *      Able to run automatically or manually
 *          
 *      To create a pipeline in a script. Example:
 *         
 *      $pipeline('<<unique name>>', async function(mainScope) => 
 *      { 
 *          // User defined pipeline function
 *          iso = mainScope.someShape.iso(); // Make some isometric view
 *          
 *          // e.g. push the model's numbers into a spreadsheet (cloudcalc module):
 *          //   $module('cloudcalc'); wb = cloudcalc.open(url); wb.compute({ width: mainScope.WIDTH }); wb.xlsx('offer')
 *          // Anything asynchronous inside a pipeline still needs `await` — see NOTES below.
 * 
 *          // RETURN: after pipeline is done, results are taken from pipeline scope
            // If no return value is given the current state within the pipeline scope is outputted
            // (which is the scene root Obj)
            // When one Shape or AnyShapeCollection is returned this is used as state (TODO)
 *      })
 * 
 *      
 *     NOTES:
 *          - SCOPE: a Pipeline is mostly executed after the main part of the script, so it's executed in the main scope 
 *                  We want to avoid that it adds to the global scope - otherwise other pipeline might pick it up and it will be confusing
 *          - SYNC/ASYNC: a function given to a pipeline can be sync/async - be careful when using async methods in its body:
 *               await is needed, otherwise the pipeline is done before asynchonous results are in 
 *          - INLINE FUNCTION DEFINITIONS:
 *                    TODO: () => { ...} versus function() { ... }
 *       
 *     TODO:
 *          - Can we do away with the distinction between sync/async for ease of use for the user?
 *          - Pipelines can only defined inside main scope: Protect against this
 *          - Currently pipelines are one-way and independent - consider allowing pipelines to call other pipelines?
 *
 */ 

import { ShapeCollection } from '@archiyou/meshup';            
import { analyzeFunc } from '../utils'

//// SETTINGS ////


export class Pipeline
{
    //// SETTINGS ////
    
    //// END SETTINGS ////

    name:string;
    _shapes:ShapeCollection
    _function:() => ShapeCollection


    /** Create a Pipeline */
    constructor(name?:string)
    {   
        this.name = name;
    }

    /** Things for the pipeline to do
     *   NOTE: the given function is executed in the WebWorker global scope, 
     *   IMPORTANT: While previously defined variables from the main script scope are accessible,
     *              it is STRONGLY ADVISED to only use variables defined within the pipeline function itself,
     *              or passed as arguments to it. This avoids unexpected behavior due to variable scope issues.
     *   
     */
    do(fn:() => ShapeCollection):this
    {
        if (typeof fn === 'function')
        {
            this._function = fn;
            
            // A pipeline runs later in its own scope: variables it closes over hold the values
            // they had when it was defined, so it should read the script through mainScope
            const funcInfo = analyzeFunc(fn);
            if(funcInfo.argCount !== 1 || !funcInfo.hasMainScopeParam)
            {
                console.warn(`Pipeline "${this.name}": use one argument and read the script's shapes from it: (mainScope) => { mainScope.someShape ... }`);
            }

            return this;
        }
        else {
            throw new Error(`pipeline.execute(fn): Please supply a function with structure fn(shapes) => shapes to pipeline!`);
        }
    }

    /** Run pipeline and get a ShapeCollection back */
    run():ShapeCollection
    {
        if(!this._function)
        {
            throw new Error(`pipeline.run(): No pipeline function defined. Use myPipeline.set(fn)`);
        }
        return this._function();
    }

}