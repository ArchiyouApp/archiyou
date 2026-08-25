/**
 * 
 *  ExecutionManager.ts
 *      Manages the requests of script execution by coordinating between:
 *      - ApiServer - where requests come in - has an instance of ExecutionManager
 *      - Library - where scripts are saved and retrieved
 *      - ExecutionBroker - where requests are sent to the queuing system   
 *           and returned when done by ExecutionWorker instances
 *  
 *  Because ExecutionManager get execution requests coming in and captures its results
 *  It can add functionality to the execution process:
 *      - caching
 *      - logging
 */


import { type RunnerScriptExecutionRequest,
         type RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import { isRunnerScriptExecutionResult } from '@archiyou/core/src/runner/typeguards';
import { restoreBinaryFromBase64 } from '@archiyou/core/src/utils';
import { isScriptOutputDataWrapper } from '@archiyou/core/src/execution/typeguards';
import { type ScriptOutputPathData,
        type ScriptOutputDataWrapper,
        type ScriptOutputFormat,
        type ScriptOutputData } from '@archiyou/core/src/execution/types';

import type { ApiExecutionResponse, CacheResult, QueueTaskResult, ApiExecutionFileResponse } from './types'

import { Library } from './Library';
import { ExecutionBroker } from './ExecutionBroker';
import { mergeObjects } from './utils'

import archiver from 'archiver'

export class ExecutionManager
{
    library:Library
    broker:ExecutionBroker

    constructor()
    {
        this.library = new Library();

        this.broker = new ExecutionBroker();

        console.warn(`ExecutionManager::constructor(): Initialized ExecutionManager. Please start with init()!`);
    }

    async init(): Promise<this>
    {
        await this.broker.init();
        return this;
    }

    /**
     * Execute a script with the given parameters
     * @param request The execution request
     * @returns The execution response either ApiExecutionResponse or string/Buffer (when request.forceFileResponse)
     *
     *  NOTE: if outputs is empty or not set, default output is 'default/model.glb'
     *
     */
    async execute(request: RunnerScriptExecutionRequest): Promise<ApiExecutionResponse|ApiExecutionFileResponse|null>
    {   
        const DEFAULT_OUTPUTS = ['default/model/glb'];

        // If no outputs set, use default
        if(!request.outputs || request.outputs.length === 0)
        {
            console.warn(`ExecutionManager::execute(): No outputs requested, using default outputs: ["${DEFAULT_OUTPUTS.join(', ')}"]`);
            request.outputs = DEFAULT_OUTPUTS;
        }
        const originalOutputs = request.outputs;

        let cacheResult = null;
        let noExecutionNeeded = false;
        let queueResult:QueueTaskResult|null = null;        
        
        if(request.cache)
        {
            console.info(`ExecutionManager::execute(): Checking cache for outputs: ["${request?.outputs?.join(', ')}]". Request with cache=false to avoid.`);
            // this function removes request output paths from request
            cacheResult = await this.checkResultsInCache(request); 
        }

        // If everything is cached we skip execution
        if(cacheResult && cacheResult.outputsInCache.length === originalOutputs.length)
        {
            console.info(`ExecutionManager::execute(): All outputs are cached: "${request?.outputs?.join(',')}". Skipping execution.`);
            noExecutionNeeded = true;
        }
        else {
            // execution needed
            console.info(`ExecutionManager::execute(): Submitting script "${request.script.name}" for execution with outputs: ["${request.outputs.join(', ')}]`);

            queueResult = await this.broker.submitTask(request) as QueueTaskResult;
            // Now check result
            // No response somehow
            if(!queueResult)
            {
                return {
                    success: false,
                    error: `Failed to submit task to broker.`,
                    data: queueResult,
                } as ApiExecutionResponse;
            }

            // Execution error
            if(!queueResult?.success)
            {
                return {
                    success: false,
                    error: queueResult?.error,
                    data: queueResult,
                } as ApiExecutionResponse;
            }

            const isExecResult = isRunnerScriptExecutionResult(queueResult?.result);
            if(!isExecResult)
            { 
                throw new Error(`Invalid execution result: ${JSON.stringify(queueResult?.result)}`); 
            }
        }

        // If anything executed this forms the base of the result, otherwise if everything from cache
        let execResult;
        if(noExecutionNeeded)
        {
            execResult = {
                status: 'success',
                request:request,
                outputs: [] as Array<ScriptOutputData>,
                errors: [],
            }
        }
        else {
            execResult = queueResult?.result as RunnerScriptExecutionResult;
        }

        // Combine cached and computed results RunnerScriptExecutionResult.outputs
        const computedOutputs = execResult?.outputs;
        const combinedOutputs = (computedOutputs)
            ? (cacheResult?.cachedResults)
                ? [...computedOutputs, ...cacheResult.cachedResults] as Array<ScriptOutputData>
                : computedOutputs
            : queueResult as any; // raw result (probably debug data)

        execResult.outputs = combinedOutputs;

        const result: ApiExecutionResponse = {
            success: (queueResult?.result as RunnerScriptExecutionResult)?.status === 'success',
            // Take the first error message from RunnerScriptExecutionResult
            error: (queueResult?.result as RunnerScriptExecutionResult)?.errors?.[0]?.message || queueResult?.error || null,
            data: execResult
        } as ApiExecutionResponse

        // Always cache the result (cache flag is only for reading cache)
        if(!noExecutionNeeded && result.success)
        {
            await this.library.writeResultCache(execResult);
        }

        // Normal verbose output
        if(!request.forceFileResponse)
        {
            return result;
        }
        else {
            // file response 
            return await this._generateFileResponse(execResult);
        }
    
    }

    /** Sometimes the user wants a direct file response
     *   the flag RunnerScriptExecutionRequest.forceFileResponse makes this possible
     *  If this is set, we compress the ExecutionResult.outputs into one or multiple files (inside a zip)
     */
    async _generateFileResponse(result: RunnerScriptExecutionResult): Promise<ApiExecutionFileResponse | null>
    {
        if(!result || !result.outputs)
        {
            console.error(`_generateFileResponse(): Invalid result or outputs`);
            return null;
        }

        const outputsByFilePath = {}; // file path => data
        result.outputs.forEach((o) => 
        {
            // make sure we get the raw data - if needed convert from base64 to binary 
            const data = o.output as ScriptOutputDataWrapper;

            console.info(`ExecutionManager::_generateFileResponse(): Processing output from path "${o.path.resolvedPath}" of type "${typeof data.type}[encoding=${data?.encoding || 'none'}]"`);

            const rawData = (isScriptOutputDataWrapper(data) && data?.encoding === 'base64')
                                        ? restoreBinaryFromBase64(data, true) // true => force Buffer output
                                        : data // raw data (string of objects)

            const outputPath = o?.path as ScriptOutputPathData;

            if(outputPath)
            {
                // pretty random virtual name, used as id and as file name in zip
                const virtualName = `${result.request.script.name}_${outputPath.pipeline}_${outputPath.category}${outputPath?.entityName ? '_' + outputPath.entityName : ''}.${outputPath.format}`;
                console.info(`ExecutionManager::_generateFileResponse(): Mapped output path "${o.path.resolvedPath}" to virtual file name "${virtualName}"`);
                outputsByFilePath[virtualName] = rawData;
            }
        });

        // If we only have one file output return that, otherwise zip
        if(Object.values(outputsByFilePath).length === 1)
        {
            console.info(`ExecutionManager::_generateFileResponse(): Single output file detected`);

            const singleOutput = Object.values(outputsByFilePath)[0];

            // We can only export files as string or Buffer
            // If it's already a string (for example STEP) or Buffer (any binary) return that
            const dataStrOrBuffer = (typeof singleOutput === 'string' || singleOutput instanceof Buffer)
                ? singleOutput
                : JSON.stringify(singleOutput); // convert object to JSON string 

            return { 
                ext: Object.keys(outputsByFilePath)[0].split('.').pop() as ScriptOutputFormat,
                data: dataStrOrBuffer
            };
        }
        else 
        {
            // Save all output files in zip
            console.info(`_generateFileResponse(): Multiple output files detected, zipping files in paths: "${Object.keys(outputsByFilePath).join(', ')}"`);

            return {
                ext: 'zip',
                data: await this.zipRawDataToBuffer(
                        Object.entries(outputsByFilePath)
                        .map(([path, data]) => 
                        {
                            // path is {pipeline}_{model|tables|metrics|docs}_*{entity}.{script name}{format}
                            console.info(`ExecutionManager::_generateFileResponse(): Adding to zip: "${path}" of data type "${typeof data}/${data?.constructor?.name || 'unknown'}"`);

                            try {
                                const zipFileData = (typeof data === 'string' || data instanceof Buffer) ? data : JSON.stringify(data);
                                return {
                                    name: path,
                                    data: zipFileData
                                };
                            } 
                            catch(e)
                            {
                                console.error(`ExecutionManager::_generateFileResponse(): Failed to add file to zip: "${path}" of data type "${typeof data}/${data?.constructor?.name || 'unknown'}" - ${e}`);
                            }
                        })
                )
            }
        }
    }

    /**
     * Zips raw data (Buffer or string) and returns a Buffer containing the zip archive.
     * @param files Array of { name: string, data: Buffer | string }
     */
    async zipRawDataToBuffer(files: { name: string, data: Buffer | string }[]): Promise<Buffer> 
    {
        return new Promise((resolve, reject) => 
        {
            const archiverLib = archiver('zip', { zlib: { level: 9 } });
            const chunks: Buffer[] = [];

            archiverLib.on('error', err => reject(err));
            archiverLib.on('data', chunk => chunks.push(chunk));
            archiverLib.on('end', () => resolve(Buffer.concat(chunks)));

            files.forEach(file => {
                archiverLib.append(file.data, { name: file.name });
            });

            archiverLib.finalize();
        });
    }

    /** Check if any requested outputs in RunnerScriptExecutionRequest are cached
     *  @param request The RunnerScriptExecutionRequest to check
     *  @returns CacheResult if any outputs are cached, null otherwise
     */
    async checkResultsInCache(request: RunnerScriptExecutionRequest): Promise<CacheResult|null>
    {
        const cacheResult = await this.library.checkRequestInCache(request);

        // cacheResult contains:
        //  - outputsInCache: the original outputs that have cached results available
        //  - cachedResults: the cached results for the outputs per pipeline
        if(cacheResult && cacheResult?.outputsInCache?.length > 0)
        {
            // We can omit the requested outputs that are cached from the request
            // And return its results to be added to the resulting RunnerScriptExecutionResult after executing
            const originalOutputs = request.outputs;
            const cachedOutputs = request.outputs.filter((output) => cacheResult.outputsInCache.includes(output));
            if(cachedOutputs.length > 0)
            {
                console.info(`ExecutionManager::checkResultsInCache(): Removed [${cachedOutputs.length}/${originalOutputs.length}] requested outputs because they are in cache!`);
            }

            return cacheResult;
        }
        return null;
    }

    /** Cache results per output */
    async writeResultCache(result: RunnerScriptExecutionResult): Promise<void>
    {
        if(result.status !== 'success' && Object.keys(result.outputs).length > 0)
        {
            await this.library.writeResultCache(result);
        }
    }


}