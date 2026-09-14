import { Library } from '../execution/Library';
import { ExecutionBroker } from '../execution/ExecutionBroker';
import { ExecutionWorker } from '../execution/ExecutionWorker';

//import type { RunnerScriptExecutionRequest } from '~/lib/archiyou-core/src/internal';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';


import fs from 'fs';

import { config as dotEnvConfig } from 'dotenv';
dotEnvConfig();


/**
 *  Simple script to test execution of a script in library through the queue system
 * 
 *  Use 'yarn docker:redis' to start a Redis server for the broker/worker to connect to
 *  You can run this script with: 'yarn dev:execute'
 * 
 */

//// SET SCRIPT TO EXECUTE ////
const SCRIPT_AUTHOR = 'test'; // archiyou
const SCRIPT_NAME =  'pipeline';  // 'urhousesketch'; // pipeline
//// END SETTINGS ////

const broker = await new ExecutionBroker().init(); // default Redis config is used
const worker = await new ExecutionWorker().init();

// Wait for broker/worker to initialize
await new Promise(resolve => setTimeout(resolve, 2000));

const library = new Library();

const script = await library.getLatestScriptVersion(SCRIPT_AUTHOR, SCRIPT_NAME); 

console.warn(`******* Executing script: ${script.author}/${script.name} v${script.version} *******`);
console.warn(`***********************************************************************************************`)


const taskResult = await broker.submitTask(
    {
        script: script,
        //params: { WIDTH: 560, HEIGHT: 900, ROOF_ANGLE: 45 },
        params: {},
        //  if no outputs, default is glb model
        outputs: [ 
            //'default/model/glb', 
            //'default/model/glb?data=false&pointAndLines=false&shapesAsPointAndLines=false', 
            //'default/docs/report/pdf',
            //'extra/model/glb', // pipeline defined output
            //'default/model/dae' // NOTE:text-based
            //'techdraw/model/svg' // NOTE:text-based
            //'techdraw/model/dxf' // NOTE:text-based
            //'default/model/dae'
            //'default/model/obj'
            // 'extra/model/glb'
            'techdraw/model/dxf'
        ],
        cache: false // for testing always false
    } as RunnerScriptExecutionRequest
);

//console.log('============ RAW RESULT ============');
//console.log(JSON.stringify(taskResult.result.outputs));

//// EXPORT FILE 
///*
taskResult.result.outputs.forEach((output,i) => {
    
    console.log(`Output: ${output.path.resolvedPath} -> ${output.output.length} `);

    const ext = output.path.resolvedPath.split('/').pop();
    const fileName = script.name + '_' + output.path.resolvedPath.replace(/\//g, '_') + '.' + ext;
    console.log(`File will be saved as: ${fileName}`); 

    // text based output
    let data;
    if(typeof output.output === 'string')
    {
        // Raw string
        data = output.output;
    }
    else 
    {  
        // Binary / ArrayBuffer
        // NOTE: If by any change the output is originally a string this works too (happens with conversion)
        data = Buffer.from(output.output.data as string, 'base64');
    }
    
    fs.writeFileSync(fileName, data);

});
//*/