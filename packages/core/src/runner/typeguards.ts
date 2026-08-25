/** Runner type guards */

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from './types'

export function isRunnerScriptExecutionResult(r:any): r is RunnerScriptExecutionResult
{
    return !!r && typeof r === 'object'
        && typeof r.status === 'string'
        && typeof r.duration === 'number'
        && !!r.state && typeof r.state === 'object';
}

export function isRunnerScriptExecutionRequest(o:any): o is RunnerScriptExecutionRequest
{
    return o && typeof o === 'object'
        && typeof o.script === 'object' && 
        typeof o?.script?.name === 'string' &&
        (!o?.component || typeof o?.component === 'string') &&
        (typeof o?.mode === 'string' || !o?.mode) &&
        (!o?.params || typeof o.params === 'object') &&
        (!o?.outputs || Array.isArray(o.outputs)) &&
        (!o?.onDone || typeof o.onDone === 'function');
}