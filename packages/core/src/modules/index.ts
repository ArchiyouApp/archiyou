/**
 * Script modules — the extension point that lets separately-distributed,
 * entitlement-gated capabilities add a global to the script scope.
 *
 * This directory contains only the machinery. The modules themselves live
 * outside this repository; see modules/README.md.
 */

export { ModuleRegistry, RESERVED_SCOPE_NAMES } from './ModuleRegistry';
export type { ModuleRegistryOptions } from './ModuleRegistry';

export { loadClientModule, clientBundleUrl, ModuleLoadError } from './loadClientModule';
export type { LoadClientModuleOptions } from './loadClientModule';

export { serverModuleStub, ServerModuleCallError } from './serverModuleStub';
export { canCallSync } from './serverModuleStub';
export type { ServerModuleStubOptions, SyncTransport } from './serverModuleStub';

export { unavailableStub, ModuleUnavailableError } from './unavailableStub';

/** The module contract itself. Authored in packages/module-sdk, mirrored here as sdkTypes.ts
 *  (see buildscripts/sync-sdk-types.ts) — that package is internal and unpublished, so this
 *  re-export is how a consumer of @archiyou/core names the types its module API speaks in. */
export type {
    AyModuleRuntime,
    AyModuleCompletion,
    AyModuleManifest,
    AyModuleCatalogEntry,
    AyArchiyou,
    AyModule,
    AyModuleWarmContext,
    AyModuleFactory,
    AyModuleFactoryContext,
    AyServerModuleMethod,
    AyServerModule,
} from './sdkTypes';
