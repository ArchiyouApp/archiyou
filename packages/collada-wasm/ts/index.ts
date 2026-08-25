/**
 * collada-wasm — public entry point.
 *
 * ```ts
 * import { createColladaWriter } from '@archiyou/collada-wasm';
 * const writer = await createColladaWriter();
 * ```
 */
export * from './ColladaWriter';
export { loadAsync } from './loader';
export type { WasmModule } from './loader';
