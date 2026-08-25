/**
 * @archiyou/core — public entry.
 *
 * The geometry kernel and the ergonomic ways to run it:
 *   - `Runner`       — run scripts on the current thread.
 *   - `RunnerWorker` — run scripts in a Web Worker (recommended for apps).
 *   - `getOutput`    — pull a single output (e.g. a GLB) out of a result.
 *
 * ```ts
 * import { RunnerWorker } from '@archiyou/core';
 * const worker = await new RunnerWorker().init();
 * const glb = await worker.execute('box(100,100,100)', { outputs: ['default/model/glb'] });
 * ```
 */

// Runner (main thread)
export { Runner } from './runner/Runner';
export { ScriptExitSignal, isScriptExitSignal, SCRIPT_EXIT_WARNING } from './runner/ScriptExit';

// RunnerWorker (Web Worker) + helpers
export { RunnerWorker, ArchiyouCoreLoadError } from './runner/worker/RunnerWorker';
export type { RunOptions, RunnerWorkerOptions } from './runner/worker/RunnerWorker';
export { getOutput, unwrapOutput } from './runner/worker/output';
export type { OutputData } from './runner/worker/output';

// Scripts
export { Script } from './Script';

// Script modules — the extension point for separately-distributed, gated
// capabilities. Inert unless a run is given a module catalog. See modules/README.md.
export { ModuleRegistry, RESERVED_SCOPE_NAMES } from './modules/ModuleRegistry';
export type { ModuleRegistryOptions } from './modules/ModuleRegistry';
export { ModuleLoadError } from './modules/loadClientModule';
export { ServerModuleCallError } from './modules/serverModuleStub';
export { ModuleUnavailableError } from './modules/unavailableStub';
// The module contract itself, so a consumer can name what it passes in a catalog. Authored in
// packages/module-sdk and mirrored as ./modules/sdkTypes (see buildscripts/sync-sdk-types.ts):
// that package is internal to the monorepo and unpublished, so this is the only public home.
export type {
  AyModuleRuntime,
  AyModuleCompletion,
  AyModuleManifest,
  AyModuleCatalogEntry,
  AyArchiyou,
  AyModule,
  AyModuleWarmContext,
  AyModuleFactory,
  AyServerModuleMethod,
  AyServerModule,
} from './modules/sdkTypes';
export { ARCHIYOU_CORE_VERSION } from './constants';

// Key public types
export type {
  RunnerScriptExecutionRequest,
  RunnerScriptExecutionResult,
} from './runner/types';
export type {
  ScriptData,
  ScriptOutputData,
  ScriptOutputDataWrapper,
  ScriptOutputFormat,
} from './execution/types';
export type { ModelMode } from './modeler/types';
export type { ConsoleMessage, ConsoleMessageType } from './console/types';

export { Importer } from './importer/Importer';
export type { AssetImportOptions, AssetPayload, ImportContext } from './importer/Importer';
