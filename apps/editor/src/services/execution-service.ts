/**
 * execution-service.ts
 *
 * Thin singleton service that owns the Archiyou core Web Worker and exposes
 * a single `runScript()` function.  Any component (editor, configurator, etc.)
 * can import this without knowing anything about Comlink or the worker lifecycle.
 *
 * The underlying worker is created lazily on the first call and re-used for
 * every subsequent call — the shared `RunnerWorker` from `@archiyou/core` owns
 * the worker lifecycle.
 */

import { RunnerWorker, ArchiyouCoreLoadError } from '@archiyou/core';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types';
import type { ConsoleMessage } from '@archiyou/core/src/console/types';

import { authService } from './auth-service.js';
import { ensureModuleCatalog } from './module-service.js';

// Shared, lazily-initialised worker for the whole app (editor, plugins, etc.).
const worker = new RunnerWorker();

// Base URL of the backend. Same value api.ts/auth-service.ts use; '' → root-relative.
// Feeds two core lookups that have to reach the server on their own: the $import()
// asset proxy, and the shared-library fallback for $component('./name').
const API_BASE_URL = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';

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
  const normalizedError = error instanceof ArchiyouCoreLoadError
    ? error
    : new Error(formatUnknownError(error));

  const detailLines = normalizedError instanceof ArchiyouCoreLoadError
    ? normalizedError.details ?? []
    : [];

  const message = [
    normalizedError.message,
    ...detailLines,
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
    warnings: normalizedError instanceof ArchiyouCoreLoadError
      ? ['Kernel startup failed before script execution began.']
      : undefined,
    messages: [createErrorConsoleMessage(message)],
    state: {} as RunnerScriptExecutionResult['state'],
  };
}

/**
 * Execute a script request in the shared Archiyou core worker.
 * Lazily initialises the worker on the first call.
 */
export async function runScript(request: RunnerScriptExecutionRequest): Promise<RunnerScriptExecutionResult | undefined>
{
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
    return await worker.run(request);
  }
  catch (error)
  {
    console.error('runScript(): failed:', error);
    return createExecutionFailureResult(request, error);
  }
}

/**
 * Pre-warm the worker without running a script.
 * Call this as early as possible (e.g. in connectedCallback) so the WASM
 * kernel is loaded before the user triggers the first execution.
 */
export async function warmupWorker(): Promise<void>
{
  // Fetch the module catalog alongside the kernel so the first run doesn't wait
  // on it. Deliberately not awaited together with a failure path: a missing
  // catalog is not an error (see module-service).
  void ensureModuleCatalog();
  await worker.init();
}
