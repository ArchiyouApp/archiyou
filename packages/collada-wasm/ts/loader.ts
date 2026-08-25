/**
 * WASM loader.
 *
 * Mirrors packages/meshup/src/loader.ts: decode the inlined base64 and hand the bytes to
 * the generated `init({ module_or_path })`. Deliberately NOT the `__wbg_set_wasm` hand-wiring
 * used by packages/gdrr2bp-wasm/ts/BinPacker.ts, which reaches into wasm-bindgen internals
 * and breaks whenever the generated glue changes shape.
 *
 * ./collada-wasm-binary is reached through a DYNAMIC import so the ~171 KB base64 blob lands
 * in its own lazy chunk instead of the importer's entry — the same split BinPacker.init()
 * gets from its `await import('./gdrr2bp-wasm-binary')`. A static import here put the whole
 * blob in @archiyou/core's main bundle for every consumer, including the ones that never
 * export a .dae. Keep it dynamic.
 */

import init, * as WasmExports from './wasm/collada_wasm.js';

export type WasmModule = typeof WasmExports;

const decodeBase64 = (str: string): Uint8Array =>
{
    if (typeof Buffer !== 'undefined')
    {
        return Buffer.from(str, 'base64');
    }

    // Browser fallback
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
    return bytes;
};

// Memoised so concurrent callers share one instantiation
let wasmReady: Promise<WasmModule> | null = null;

/** Load (once) and return the WASM exports. */
export const loadAsync = async (): Promise<WasmModule> =>
{
    if (wasmReady) { return wasmReady; }

    wasmReady = (async () =>
    {
        const { WASM_BASE64 } = await import('./collada-wasm-binary');
        const bytes = decodeBase64(WASM_BASE64);
        await init({ module_or_path: bytes });
        return WasmExports;
    })();

    return wasmReady;
};
