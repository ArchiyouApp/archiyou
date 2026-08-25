/**
 * runner.worker.ts
 *
 * The Web Worker entry that owns a {@link Runner} instance and exposes it over
 * Comlink. This is the transport half of {@link RunnerWorker} — all ergonomics
 * (script normalization, output extraction) live on the main-thread class.
 *
 * Keep {@link ArchiyouCoreApi} in sync with the `wrap<ArchiyouCoreApi>` call in
 * RunnerWorker.ts.
 */

import * as Comlink from 'comlink';

import { Runner } from '../Runner';
import { Script } from '../../Script';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '../types';

let runner: Runner | null = null;

/** Comlink API exposed by this worker — keep in sync with RunnerWorker.ts. */
export interface ArchiyouCoreApi
{
  /** Create the Runner and load its WASM kernel. */
  init(): Promise<void>;
  /** Execute a fully-formed request and return the raw result. */
  execute(request: RunnerScriptExecutionRequest): Promise<RunnerScriptExecutionResult | undefined>;
}

const api: ArchiyouCoreApi = {
  async init(): Promise<void>
  {
    try
    {
      const t = performance.now();
      console.info('runner.worker: init() called. Starting Archiyou core Runner');
      runner = new Runner();
      await runner.load();
      console.info(`runner.worker: Archiyou core Runner initialized in ${(performance.now() - t).toFixed(2)} ms`);
    }
    catch (err)
    {
      console.error('runner.worker: init failed:', err);
      throw err;
    }
  },

  async execute(request: RunnerScriptExecutionRequest): Promise<RunnerScriptExecutionResult>
  {
    if (!runner) throw new Error('runner.worker: Runner not initialized — call init() first');

    // Hydrate any local component scripts the main thread sent along and link
    // them on the Runner so $component('./name') can resolve them. Sent as
    // ScriptData because it is structured-clone-safe across the worker boundary.
    if (Array.isArray(request.componentScripts))
    {
      const hydrated = request.componentScripts
        .map(d => Script.fromData(d))
        .filter((s): s is Script => s !== null);
      runner.linkComponentScripts(hydrated);
    }

    return runner.execute(request); // return the raw result for maximum flexibility
  },
};

Comlink.expose(api);
