/** 
 *  Types for pages
 *  TODO: is this a good pattern to defined internal state of pages?
 */

import type { RunnerScriptExecutionResult } from "@archiyou/core/src/runner/types";

export interface PageEditorState 
{
    executing: boolean;
    result: RunnerScriptExecutionResult;
}