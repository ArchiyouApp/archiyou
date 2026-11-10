/**
 * serverRun.ts — what a server-side run of a published script needs, shared by
 * POST /scripts/published/execute (routes/execute.ts) and the files of an emailed
 * fulfillment (routes/fulfillments.ts).
 *
 * The Runner has no sandbox (see config.execution), so a published version only runs
 * here when its author is allowlisted (SERVER_EXECUTION_AUTHORS) or an admin validated
 * that exact version and SERVER_EXECUTION_VALIDATED is on.
 */

import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import type { ScriptData } from '@archiyou/core/src/execution/types';
import { isLengthUnit } from '@archiyou/core/src/units/UnitConverter';

import { config } from '../config';
import { moduleHost } from '../modules/ModuleHost';
import { userService } from '../services/UserService';

/** Whether this published version may run on the server for an anonymous caller: an
 *  allowlisted author, or a validated version with the validated path on. */
export function serverRunAllowed(script: Pick<ScriptData, 'author' | 'published'>): boolean
{
  const { allowedAuthors, allowValidated } = config.execution;
  if (allowedAuthors.includes((script.author ?? '').toLowerCase())) return true;
  return allowValidated && script.published?.validated === true;
}

export interface ServerRunOptions
{
  params: Record<string, unknown>;
  outputs?: string[];
  preset?: string;
  cache?: boolean;
  forceFileResponse?: boolean;
  kernel?: string;
  unitSystem?: 'metric' | 'imperial';
  docUnitSystem?: 'metric' | 'imperial';
  modelUnits?: string;
}

/**
 * The run request for a published version: the execution context the browser client
 * fills in for itself (see apps/editor/src/services/execution-service.ts) and which a
 * server-side run has to be handed explicitly, or `$import()`, `$component('./name')` and
 * gated modules all fail. Module entitlement is the SCRIPT AUTHOR's, not the caller's —
 * the caller may be anonymous, and it is the author's script that declares the dependency.
 *
 * `scriptData` is the stored row's data (toData(), NOT a Script instance: the request is
 * JSON-serialized onto the BullMQ queue, and a serialized instance loses its private fields).
 * `params` must already be checked against the script.
 */
export async function serverRunRequest(scriptData: ScriptData, publishedScript: string, options: ServerRunOptions): Promise<RunnerScriptExecutionRequest>
{
  const { internalApiUrl } = config.execution;
  const authorModules = scriptData.author ? await userService.getModules(scriptData.author) : [];
  return {
    kernel: (options.kernel as any) || 'mesh', // geometry kernel for the whole run: 'mesh' | 'brep'
    script: scriptData,
    params: options.params,
    preset: options.preset,
    outputs: options.outputs,
    cache: options.cache !== false, // default true
    forceFileResponse: options.forceFileResponse === true,
    // Presentation only, but it silently changes every dimension and doc string if
    // dropped — so it must ride along rather than defaulting to metric.
    unitSystem: options.unitSystem ?? scriptData.units,
    docUnitSystem: options.docUnitSystem,
    modelUnits: isLengthUnit(options.modelUnits) ? options.modelUnits : undefined,
    assetProxyUrl: internalApiUrl,
    componentLibraryUrl: internalApiUrl,
    moduleApiUrl: internalApiUrl,
    modules: moduleHost.catalogFor(authorModules),
    // Client-module bundles are fetched on the author's entitlement, like the catalog above.
    publishedScript,
  } as RunnerScriptExecutionRequest;
}
