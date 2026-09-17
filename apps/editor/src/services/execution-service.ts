/**
 * execution-service.ts
 *
 * Thin singleton service that owns script execution and exposes a single
 * `runScript()`. Any component (editor, configurator, fulfillment
 * downloads) can import this without knowing where the work happens.
 *
 * TWO BACKENDS:
 *
 *   local (default) — the Archiyou core Web Worker, created on first use and
 *     reused. Loading it means loading the CAD kernel: ~1.9MB of worker bundle
 *     plus ~14MB of base64-inlined mesh WASM. Fine for the editor, which needs a
 *     kernel anyway.
 *
 *   server — POST /scripts/published/execute/:user/:scriptAndVersion, used by a
 *     published configurator whose version an admin has marked `validated`
 *     (apps/server/src/routes/execute.ts). The kernel is never touched, which is
 *     the entire point: a configurator only needs to show a GLB and some metrics,
 *     and should not download a CAD kernel to do it.
 *
 * The server path is opt-in per page via setServerExecutionTarget(), and it falls
 * back to the local worker if the request cannot be made — so a configurator keeps
 * working when Redis is down or validation has been withdrawn, at the cost of
 * loading the kernel that one time.
 *
 * Both backends return the same RunnerScriptExecutionResult: the server runs the
 * same core Runner and JSON-encodes the result, base64-wrapping binary outputs.
 * The viewer and the download path already unwrap that form.
 */

import type { RunnerWorker as RunnerWorkerType } from '@archiyou/core';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import type { ConsoleMessage } from '@archiyou/core/src/console/types';

import { api, ApiError } from './api.js';
import { authService } from './auth-service.js';
import { ensureModuleCatalog } from './module-service.js';

// Base URL of the backend. Same value api.ts/auth-service.ts use; '' → root-relative.
// Feeds two core lookups that have to reach the server on their own: the $import()
// asset proxy, and the shared-library fallback for $component('./name').
const API_BASE_URL = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';

//// SERVER EXECUTION TARGET ////

/** Which published script server-side runs address. */
export interface ServerExecutionTarget
{
  user: string;
  /** `name` or `name:version`, exactly as it appears in the configurator URL. */
  scriptAndVersion: string;
}

let serverTarget: ServerExecutionTarget | null = null;

/**
 * Route every subsequent runScript() at the server instead of the local worker.
 *
 * Set by <page-published-configurator> when the published version is `validated`.
 * Pass null to go back to the local worker (the fallback path does this itself).
 *
 * Module-level rather than per-request because it is a property of the PAGE, not of
 * a call: the configurator, its fulfillment downloads and anything else running in
 * that page must all agree, and none of those call sites should have to know.
 */
export function setServerExecutionTarget(target: ServerExecutionTarget | null): void
{
  serverTarget = target;
}

export function getServerExecutionTarget(): ServerExecutionTarget | null
{
  return serverTarget;
}

//// LOCAL WORKER ////

// Loaded on demand. The import itself is dynamic so a page that only ever executes
// server-side never pulls the core barrel (and its Comlink/worker plumbing) into its
// critical path — `new Worker(...)` inside RunnerWorker.init() is what would fetch
// the kernel chunks.
let workerPromise: Promise<RunnerWorkerType> | null = null;

async function getWorker(): Promise<RunnerWorkerType>
{
  if (!workerPromise)
  {
    workerPromise = import('@archiyou/core').then(({ RunnerWorker }) => new RunnerWorker());
  }
  return workerPromise;
}

function formatUnknownError(error: unknown): string
{
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try
  {
    return JSON.stringify(error);
  }
  catch
  {
    return String(error);
  }
}

/** Duck-typed rather than `instanceof`: the class lives behind the dynamic import
 *  above, so it may not have been loaded yet when this runs. */
function isCoreLoadError(error: unknown): error is Error & { details?: string[] }
{
  return error instanceof Error && error.name === 'ArchiyouCoreLoadError';
}

function createErrorConsoleMessage(message: string): ConsoleMessage
{
  return {
    type: 'error',
    time: new Date().toLocaleTimeString(),
    from: 'core',
    message,
  };
}

export function createExecutionFailureResult(
  request: RunnerScriptExecutionRequest,
  error: unknown,
): RunnerScriptExecutionResult
{
  const isLoadError = isCoreLoadError(error);
  const message = [
    formatUnknownError(error),
    ...(isLoadError ? error.details ?? [] : []),
  ].filter(Boolean).join('\n');

  return {
    created: new Date(),
    status: 'error',
    duration: 0,
    request,
    errors: [{
      status: 'error',
      message,
      code: typeof request.script === 'string' ? request.script : (request.script as any)?.code,
    }],
    warnings: isLoadError ? ['Kernel startup failed before script execution began.'] : undefined,
    messages: [createErrorConsoleMessage(message)],
    state: {} as RunnerScriptExecutionResult['state'],
  };
}

//// SERVER EXECUTION ////

interface ExecuteEnvelope
{
  success: boolean;
  error?: string;
  data?: RunnerScriptExecutionResult;
}

/**
 * Run on the server. The script itself is NOT sent — the server loads the published
 * version from its own database, which is the only copy it will trust anyway.
 *
 * Throws on a transport failure so the caller can fall back; a script that ran and
 * failed comes back normally, as a result with status 'error'.
 */
async function runOnServer(
  target: ServerExecutionTarget,
  request: RunnerScriptExecutionRequest,
): Promise<RunnerScriptExecutionResult>
{
  const path = `/scripts/published/execute/${encodeURIComponent(target.user)}/${encodeURIComponent(target.scriptAndVersion)}`;

  const response = await api.post<ExecuteEnvelope>(path, {
    params: request.params,
    preset: request.preset,
    outputs: request.outputs,
    // Presentation only, but omitting it silently renders an imperial configurator
    // in metric — the server has no other way to know.
    unitSystem: request.unitSystem,
  });

  if (!response.data)
  {
    // 2xx with no payload: treat as a script/pipeline error rather than a transport
    // one, so we surface it instead of quietly loading a 26MB kernel.
    return createExecutionFailureResult(request, new Error(response.error ?? 'The server returned no result.'));
  }

  return {
    ...response.data,
    // JSON has no Date. Nothing downstream reads this today, but the type says Date
    // and a string here would be a trap for whatever reads it next.
    created: new Date(response.data.created ?? Date.now()),
    // Echo back the request the CALLER made. The server echoes its own, which carries
    // the full stored script and would otherwise replace the caller's view of it.
    request,
  };
}

//// FOREGROUND ACTIVITY ////

// What the background thumbnail work (services/thumbnails.ts) yields to: a run someone is
// waiting on. Counted here, on the one funnel every run goes through, so the thumbnail
// service never has to know who runs scripts. Its own runs pass `background: true` and
// are not counted.
let foregroundRuns = 0;
let lastForegroundRunAt = 0;

/** Is a foreground run (editor, configurator, download) in flight right now? */
export function isExecutionBusy(): boolean
{
  return foregroundRuns > 0;
}

/** When the last foreground run started (epoch ms; 0 when none has). */
export function lastExecutionAt(): number
{
  return lastForegroundRunAt;
}

//// PUBLIC API ////

export interface RunScriptOptions
{
  /** Nobody is waiting on this run (a thumbnail backfill): it is not counted as
   *  foreground activity, so it never holds up the background work's own idle gate. */
  background?: boolean;
}

/**
 * Execute a script request — on the server when a target is set, otherwise in the
 * shared local worker (initialising it on first use).
 */
export async function runScript(request: RunnerScriptExecutionRequest, options: RunScriptOptions = {}): Promise<RunnerScriptExecutionResult | undefined>
{
  if (!options.background)
  {
    foregroundRuns++;
    lastForegroundRunAt = Date.now();
  }
  try
  {
    const target = serverTarget;
    if (target)
    {
      try
      {
        return await runOnServer(target, request);
      }
      catch (error)
      {
        // Transport failure: the pipeline is down (503), validation was withdrawn
        // (401/403), we are being throttled (429), or the network is gone. Drop to the
        // local worker and stop trying — retrying per keystroke would just be slow.
        // NOTE a 422 lands here too, which self-heals but would also mask a genuine
        // client/server disagreement about params; check the console if geometry is
        // fine locally but never runs server-side.
        const status = error instanceof ApiError ? ` (HTTP ${error.status})` : '';
        console.warn(
          `runScript(): server-side execution failed${status}; falling back to the local kernel.`,
          error,
        );
        setServerExecutionTarget(null);
      }
    }

    try
    {
      // Point $import() at the backend asset proxy unless the caller set one.
      request.assetProxyUrl ??= API_BASE_URL;
      // Let $component('./name') fall back to the author's shared library when the caller
      // linked no local scripts — the published-configurator case. Harmless in the editor:
      // linked workspace scripts always take precedence, so this is never reached there.
      request.componentLibraryUrl ??= API_BASE_URL;

      // Gated script modules. The catalog is cached per user, so this is a no-op
      // after the first call (and warmupWorker() primes it). Locked modules are
      // included on purpose — the runner needs them to explain itself when a
      // script uses one. The token is what lets the runner fetch a gated bundle;
      // the server re-checks entitlement on every such request regardless.
      request.modules ??= await ensureModuleCatalog();
      request.moduleApiUrl ??= API_BASE_URL;
      request.authToken ??= (await authService.getToken()) ?? undefined;

      // The viewer needs the full result (scenegraph/annotations/handles), so use run().
      const worker = await getWorker();
      return await worker.run(request);
    }
    catch (error)
    {
      console.error('runScript(): failed:', error);
      return createExecutionFailureResult(request, error);
    }
  }
  finally
  {
    if (!options.background) foregroundRuns--;
  }
}

/**
 * Pre-warm the local worker without running a script, so the WASM kernel is loaded
 * before the first execution.
 *
 * A NO-OP when a server target is set: warming up is exactly the ~26MB download the
 * server path exists to avoid. Callers can therefore keep calling this
 * unconditionally — <page-configurator> does.
 */
export async function warmupWorker(): Promise<void>
{
  if (serverTarget) return;

  // Fetch the module catalog alongside the kernel so the first run doesn't wait
  // on it. Deliberately not awaited together with a failure path: a missing
  // catalog is not an error (see module-service).
  void ensureModuleCatalog();
  const worker = await getWorker();
  await worker.init();
}
