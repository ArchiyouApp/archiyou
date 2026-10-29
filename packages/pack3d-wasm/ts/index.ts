/**
 * pack3d-wasm: public entry point.
 *
 * Re-exports the {@link Packer3D} class and its types. Typical usage:
 *
 * ```ts
 * import { Packer3D } from '@archiyou/pack3d-wasm';
 * const packer = await new Packer3D().init();
 * const plan = packer.solve(instance, { iterations: 100 });
 * ```
 */
export * from './Packer3D';
