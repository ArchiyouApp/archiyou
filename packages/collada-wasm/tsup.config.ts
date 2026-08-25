import { defineConfig } from 'tsup';
import { copyFile, mkdir } from 'node:fs/promises';

/**
 *  Build config for the published @archiyou/collada-wasm package.
 *
 *  ESM only, and `splitting` is load-bearing: ts/loader.ts reaches the base64-inlined WASM
 *  (~171 KB) through a dynamic import so it lands in its own lazy chunk. With splitting off
 *  esbuild pulls it back into the entry, and every consumer downloads the kernel whether or
 *  not they ever export a .dae — which is the whole reason the loader is written that way.
 */
export default defineConfig({
  entry: ['ts/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,

  onSuccess: async () =>
  {
    // The wasm-bindgen glue has a default branch that resolves
    // `new URL('collada_wasm_bg.wasm', import.meta.url)`. loader.ts never reaches it — it
    // always passes bytes — but esbuild keeps the expression, and a consumer's bundler
    // resolves such URLs at BUILD time. Ship the binary next to the entry so that resolution
    // finds a file instead of failing the consumer's build.
    await mkdir('dist', { recursive: true });
    await copyFile('ts/wasm/collada_wasm_bg.wasm', 'dist/collada_wasm_bg.wasm');
  },
});
