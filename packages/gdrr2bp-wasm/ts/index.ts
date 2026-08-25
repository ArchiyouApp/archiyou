/**
 * gdrr2bp-wasm — public entry point.
 *
 * Re-exports the {@link BinPacker} class and its types. Typical usage:
 *
 * ```ts
 * import { BinPacker } from '@archiyou/gdrr2bp-wasm';
 * const bp = await new BinPacker().init();
 * const solution = bp.solve(instance, { maxRunTime: 2 });
 * ```
 */
export * from './BinPacker';
