/**
 * Types and interfaces for the Archiyou Script Library API
 */

import type { ScriptData, ScriptOutputFormat,
    ScriptOutputData } from '@archiyou/core/src/execution/types';
import type { RunnerScriptExecutionRequest,
    RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import type { ConsoleMessage } from '@archiyou/core/src/console/types';

import { isScriptOutputFormat } from '@archiyou/core/src/execution/typeguards'

//// REQUEST TYPES ////

export interface ScriptExecuteRequest 
{
    Body: {
        params?: Record<string, any>;
        preset?: string;
    };
}

export interface LoginRequest 
{
    Body: {
        username: string;
        password: string;
    };
}

//// RESPONSE TYPES ////

export interface ApiAuthResponse 
{
    success: boolean;
    token?: string;
    error?: string;
}

export interface ApiLibraryInfoResponse
{
    name: string;
    version: string;
    maintainer: string;
    email: string;   
}

export interface GetResponse 
{
    success: boolean;
    error?: string;
    data?: ApiLibraryInfoResponse|ScriptData|Array<ScriptData>|Array<string>; // Array<string> for versions 
}

export interface ApiExecutionResponse 
{
    success: boolean;
    error?: string;
    warnings?: Array<string>;
    data?: any|RunnerScriptExecutionResult;
}

// When request.forceFileResponse is set we return buffer with file or zip
export interface ApiExecutionFileResponse
{
    ext: 'zip' | ScriptOutputFormat; // either zip or format of one file
    data: Buffer|string; // file data
}

export function isApiExecutionFileResponse(o:any): o is ApiExecutionFileResponse
{
    return o && o?.ext && (o.ext === 'zip' || isScriptOutputFormat(o.ext))
    && (o.data instanceof Buffer || typeof o.data === 'string' || typeof o.data === 'object');
}

/// EXECUTION INTERFACES ////

export interface RedisConfig 
{
    host?: string;
    port?: number;
    password?: string;
}

/** Test Queue Debug Task */
export interface QueueDebugTask
{
    message: string; // test message
    data: any; // test data, can be anything
    wait: number; // dynamic wait time in milliseconds
}

/** Check if the something is a QueueDebugTask */
export const isQueueDebugTask = (task: any): task is QueueDebugTask => 
{
    return task && typeof task.message === 'string' && typeof task.wait === 'number';
};

/** General Queue Task Data */
export interface QueueTaskData 
{
    id: string;
    payload: any|QueueDebugTask|RunnerScriptExecutionRequest; // Can be any data, typically a RunnerScriptExecutionRequest
    timestamp: number;
    timeout?: number; // Optional timeout in milliseconds. Is used on the worker side
}

/** Abstract Queue Task Result */
export interface QueueTaskResult 
{
    success: boolean;
    error?: string;
    messages?:Array<ConsoleMessage>; // for debug on error mostly
    result: any|RunnerScriptExecutionResult|null // Can be any data, typically RunnerScriptExecutionResult
    duration: number; // Duration in milliseconds
    request?: RunnerScriptExecutionRequest | null; // Original request in response for debugging
}

//// EXECUTION CACHE ////

export interface CacheResult
{
    outputsInCache: Array<string> // requested outputs available
    cachedResults:Array<ScriptOutputData> // cached results per pipeline
}