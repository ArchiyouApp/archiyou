/**
 * RunnerWorker.ts
 *
 * Main-thread, ergonomic handle to a {@link Runner} running inside a Web Worker.
 * This is the public standalone entry for `@archiyou/core`:
 *
 * ```ts
 * import { RunnerWorker } from '@archiyou/core';
 *
 * const worker = await new RunnerWorker().init();
 * const glb = await worker.execute('box(100,100,100)', { outputs: ['default/model/glb'] });
 * // feed the archiyou viewer: viewer.load(glb)
 * ```
 *
 * - `init()`   — create the worker + load the WASM kernel (idempotent).
 * - `run()`    — full RunnerScriptExecutionResult (errors, metrics, tables, state).
 * - `execute()`— the requested output directly (throws on execution error).
 * - `terminate()` — tear the worker down.
 *
 * The mesh kernel inlines its WASM as base64, so no `.wasm` asset handling is
 * needed by consumers. Consuming bundlers only need module workers enabled
 * (Vite: `worker: { format: 'es' }`).
 */

import * as Comlink from 'comlink';

import type { ArchiyouCoreApi } from './runner.worker';
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '../types';
import type { ScriptData } from '../../execution/types';
import type { AyModuleCatalogEntry } from '../../modules/sdkTypes';

import type { Script } from '../../Script';
import type { ModelMode } from '../../modeler/types';
import type { ConsoleMessageType } from '../../console/types';
import { getOutput, type OutputData } from './output';

/** Default output requested when a caller doesn't specify one. */
const DEFAULT_OUTPUTS = ['default/model/glb'];

/** Options for a single run/execute. */
export interface RunOptions
{
  outputs?: string[];                    // requested output paths; default ['default/model/glb']
  params?: Record<string, any>;
  kernel?: ModelMode;                    // 'mesh' | 'brep'; default from constructor
  unitSystem?: 'metric' | 'imperial';
  componentScripts?: ScriptData[];       // local $component('./name') scripts
  selection?: string[];
  messages?: ConsoleMessageType[];
  perStatement?: boolean;                // execute statement-by-statement (partial model + profiling)
  assetProxyUrl?: string;                // base URL of the asset proxy for $import(); default '' → /proxy
  componentLibraryUrl?: string;          // backend base for resolving unlinked $component('./name') from the author's shared library
  modules?: AyModuleCatalogEntry[];      // optional script modules for this run — include LOCKED ones too (see RunnerScriptExecutionRequest.modules)
  moduleApiUrl?: string;                 // backend base for module bundles and server-module calls; default '' → root-relative
  authToken?: string;                    // bearer token, required to reach entitlement-gated modules
}

/** Constructor options. */
export interface RunnerWorkerOptions
{
  kernel?: ModelMode;                    // default 'mesh'
  createWorker?: () => Worker;           // override worker creation for custom bundlers/tests
}

export class ArchiyouCoreLoadError extends Error
{
  readonly phase: 'worker' | 'init';
  override readonly cause?: unknown;
  readonly details?: string[];

  constructor(phase: 'worker' | 'init', message: string, options?: { cause?: unknown; details?: string[] })
  {
    super(message);
    this.name = 'ArchiyouCoreLoadError';
    this.phase = phase;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

function formatUnknownError(error: unknown): string
{
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); }
  catch { return String(error); }
}

function describeWorkerError(event: ErrorEvent | Event): string[]
{
  if (typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent)
  {
    return [
      event.message ? `Message: ${event.message}` : '',
      event.filename ? `Source: ${event.filename}${event.lineno ? `:${event.lineno}` : ''}${event.colno ? `:${event.colno}` : ''}` : '',
      event.error ? `Cause: ${formatUnknownError(event.error)}` : '',
    ].filter(Boolean);
  }
  return ['The worker emitted an error event before initialization completed.'];
}

/** Is this argument an already-formed execution request (vs a script)?
 *  A request always carries a `script` field; a bare Script / ScriptData / string
 *  never does. `kernel` is optional on a request (Runner defaults it), so we key
 *  off `script` here. */
function isRequest(arg: unknown): arg is RunnerScriptExecutionRequest
{
  return typeof arg === 'object' && arg !== null && 'script' in arg;
}

export class RunnerWorker
{
  private readonly _kernel: ModelMode;
  private readonly _createWorker: () => Worker;

  private _worker?: Worker;
  private _proxy?: Comlink.Remote<ArchiyouCoreApi>;
  private _ready?: Promise<this>;

  constructor(opts: RunnerWorkerOptions = {})
  {
    this._kernel = opts.kernel ?? 'mesh';
    this._createWorker = opts.createWorker
      ?? (() => new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' }));
  }

  /** Create the worker and load its WASM kernel. Idempotent — safe to call repeatedly. */
  init(): Promise<this>
  {
    if (this._ready) return this._ready;

    this._ready = (async () =>
    {
      let worker: Worker;
      try
      {
        worker = this._createWorker();
      }
      catch (err)
      {
        throw new ArchiyouCoreLoadError('worker', `Archiyou core worker failed to start: ${formatUnknownError(err)}`, {
          cause: err,
          details: err instanceof Event ? describeWorkerError(err) : undefined,
        });
      }

      worker.onerror = (event) =>
      {
        console.group('RunnerWorker: worker startup error');
        describeWorkerError(event).forEach(d => console.error(d));
        console.groupEnd();
        this._ready = undefined; // allow a retry
      };

      const proxy = Comlink.wrap<ArchiyouCoreApi>(worker);

      try
      {
        await proxy.init();
      }
      catch (err)
      {
        worker.terminate();
        this._ready = undefined;
        throw new ArchiyouCoreLoadError('init', `Archiyou core failed during initialization: ${formatUnknownError(err)}`, {
          cause: err,
          details: [
            'The worker was created, but kernel initialization did not complete.',
            'Check the console for the original stack trace from the worker.',
          ],
        });
      }

      this._worker = worker;
      this._proxy = proxy;
      return this;
    })().catch((err) =>
    {
      this._ready = undefined; // reset so a retry is possible
      if (err instanceof ArchiyouCoreLoadError) throw err;
      throw new ArchiyouCoreLoadError('worker', `Archiyou core worker failed to start: ${formatUnknownError(err)}`, { cause: err });
    });

    return this._ready;
  }

  /** Normalize (script, opts) or a raw request into a full RunnerScriptExecutionRequest. */
  private _buildRequest(script: string | ScriptData | Script | RunnerScriptExecutionRequest, opts: RunOptions = {}): RunnerScriptExecutionRequest
  {
    if (isRequest(script))
    {
      // Already a request — fill only the defaults it is missing.
      // `kernel` has to be defaulted here too: the editor sends a full request and does not
      // always set it, and Runner uses it to decide which kernel to load.
      return { kernel: this._kernel, outputs: DEFAULT_OUTPUTS, ...script };
    }
    // A bare string is source code — wrap it as ScriptData ({ code }); a
    // ScriptData / Script is passed through as the request's script.
    const scriptField = typeof script === 'string' ? { code: script } : script;
    return {
      kernel: opts.kernel ?? this._kernel,
      script: scriptField as any,
      outputs: opts.outputs ?? DEFAULT_OUTPUTS,
      params: opts.params,
      unitSystem: opts.unitSystem,
      componentScripts: opts.componentScripts,
      selection: opts.selection,
      messages: opts.messages,
      perStatement: opts.perStatement,
      assetProxyUrl: opts.assetProxyUrl,
      componentLibraryUrl: opts.componentLibraryUrl,
      modules: opts.modules,
      moduleApiUrl: opts.moduleApiUrl,
      authToken: opts.authToken,
    };
  }

  /** Execute and return the full RunnerScriptExecutionResult (errors, metrics, tables, state). */
  async run(script: string | ScriptData | Script | RunnerScriptExecutionRequest, opts: RunOptions = {}): Promise<RunnerScriptExecutionResult>
  {
    await this.init();
    const request = this._buildRequest(script, opts);
    const result = await this._proxy!.execute(request);
    if (!result) throw new Error('RunnerWorker.run(): worker returned no result');
    return result;
  }

  /**
   * Execute and return the requested output(s) directly. Throws on execution error.
   * - One requested output → its unwrapped data (e.g. a GLB ArrayBuffer).
   * - Multiple → a Record keyed by requested path.
   */
  async execute(script: string | ScriptData | Script | RunnerScriptExecutionRequest, opts: RunOptions = {}): Promise<OutputData | Record<string, OutputData | undefined>>
  {
    const request = this._buildRequest(script, opts);
    const result = await this.run(request);

    if (result.status === 'error')
    {
      const msg = (result.errors ?? []).map(e => e.message).filter(Boolean).join('\n')
        || (result.messages ?? []).filter(m => m.type === 'error').map(m => m.message).join('\n')
        || 'Script execution failed';
      throw new Error(msg);
    }

    const paths = request.outputs ?? DEFAULT_OUTPUTS;
    if (paths.length === 1) return getOutput(result, paths[0]) as OutputData;

    const out: Record<string, OutputData | undefined> = {};
    for (const p of paths) out[p] = getOutput(result, p);
    return out;
  }

  /** Terminate the worker. A subsequent init() will spin up a fresh one. */
  terminate(): void
  {
    this._worker?.terminate();
    this._worker = undefined;
    this._proxy = undefined;
    this._ready = undefined;
  }
}
