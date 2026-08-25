import { defineConfig } from 'tsup';

/**
 *  Build config for the published @archiyou/gdrr2bp-wasm package.
 *
 *  ESM only. `splitting` is load-bearing for the same reason as in collada-wasm:
 *  ts/BinPacker.ts reaches both the base64 WASM (~324 KB) and the wasm-bindgen glue through
 *  dynamic imports, so they land in lazy chunks and only download when something is actually
 *  packed. The glue is imported for its `__wbg_set_wasm` hook rather than instantiating
 *  itself, so no .wasm file is resolved at build time and none needs to ship.
 */
export default defineConfig({
  entry: ['ts/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
});
