import { defineConfig, type Options } from 'tsup';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

/**
 *  Build config for the published @archiyou/core package.
 *
 *  Replaces the old vite lib build, which had `rollupOptions.external: []` and therefore
 *  inlined every dependency — 48 MB of ESM plus 80 MB of UMD, with jspdf, html2canvas and
 *  the material textures baked in twice over.
 *
 *  What ships and why:
 *    - ESM only. Nothing in the monorepo consumes a CJS or UMD build of core, and a second
 *      format would duplicate the multi-MB lazy chunks on disk.
 *    - `dependencies` are external (tsup's default), so consumers dedupe them rather than
 *      carrying private copies. @archiyou/collada-wasm and @archiyou/gdrr2bp-wasm used to be
 *      devDependencies so esbuild would BUNDLE them, which kept them unpublished — but core
 *      also ships src/, and that source imported them by name, leaving the published sources
 *      pointing at packages nobody could install. They are published now, and ordinary
 *      dependencies here.
 *    - `splitting: true` is load-bearing. The base64-inlined WASM blobs (gdrr2bp ~330 KB,
 *      collada ~171 KB) and the brep/OpenCascade kernel are reached through dynamic imports
 *      so they land in lazy chunks. With splitting off, esbuild inlines them back into the
 *      entry and every consumer downloads them whether or not they nest parts or export .dae.
 */
const browser: Options = {
    entry: {
        'index': 'src/index.ts',
        // Second entry so the Web Worker has a real .js to point at in dist/. See the
        // specifier rewrite in onSuccess below.
        'runner.worker': 'src/runner/worker/runner.worker.ts',
    },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    splitting: true,
    sourcemap: false,
    // Both builds write into dist/ at the same time, so neither cleans: the `build` script
    // empties dist/ first
    clean: false,
    // Declarations come from `tsc --emitDeclarationOnly` (see the `build:types` script), not
    // from tsup. src/ still carries ~88 pre-existing type errors against the repo's
    // typecheck budget, and tsup's dts step treats any of them as fatal.
    dts: false,

    /**
     *  Stub Node builtins out to an empty module, the way the old vite build did via its
     *  `__vite-browser-external` shim.
     *
     *  Two places in the brep kernel reach for them:
     *    - the Emscripten glue (src/modeler/brep/wasm/archiyou-opencascade.js) has a dead
     *      `if (ENVIRONMENT_IS_NODE) require('fs')` branch that esbuild still has to resolve;
     *    - OcLoader._getAbsPath() dynamically imports 'url'/'path' on its Node-only path.
     *
     *  A browser bundle cannot resolve either, and leaving them external makes webpack 5 fail
     *  the consumer's build. Stubbing keeps parity with what core already shipped — with the
     *  same consequence: this bundle runs brep in browsers/workers, not in Node. Node gets
     *  the second build below (`dist/node/`, the `node` export condition).
     */
    esbuildPlugins: [
        {
            name: 'node-builtins-empty-stub',
            setup(build)
            {
                const BUILTINS = /^(node:)?(fs|path|url|os|module|worker_threads|crypto)$/;
                build.onResolve({ filter: BUILTINS }, (args) => ({ path: args.path, namespace: 'node-stub' }));
                build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
                    contents: 'export default {}; export const fileURLToPath = undefined;',
                    loader: 'js',
                }));
            },
        },
    ],

    onSuccess: async () =>
    {
        // RunnerWorker.ts spells the worker as `new URL('./runner.worker.ts', import.meta.url)`,
        // which is what Vite needs to find it when the monorepo imports core from src/. esbuild
        // does not rewrite `new URL(..., import.meta.url)`, so the built entry would ship a
        // pointer to a .ts file that is not in dist/. Retarget it at the built worker.
        const entry = 'dist/index.js';
        const before = await readFile(entry, 'utf8');
        const after = before.replaceAll('./runner.worker.ts', './runner.worker.js');
        if (before === after)
        {
            throw new Error(
                `[tsup] expected './runner.worker.ts' in ${entry} to retarget at the built worker. ` +
                `If RunnerWorker.ts changed how it spells the worker URL, update this rewrite.`);
        }
        await writeFile(entry, after);

        // Both of these are addressed with `new URL(..., import.meta.url)` from code that ends
        // up in dist/, so the files have to sit alongside the chunks. Consumer bundlers resolve
        // those URLs at BUILD time — a missing file is their build error, not a runtime fallback.
        //   - textures: src/materials/MaterialManager.ts
        //   - opencascade wasm: src/modeler/brep/OcLoader.js (lands in the lazy brep chunk)
        await cp('src/materials/textures', 'dist/textures', { recursive: true });
        await mkdir('dist/wasm', { recursive: true });
        await cp('src/modeler/brep/wasm/archiyou-opencascade.wasm', 'dist/wasm/archiyou-opencascade.wasm');
    },
};

/**
 *  The Node build: `dist/node/`, picked by the `node` export condition. For the `archiyou` CLI
 *  and anything else that runs core in plain Node, which the browser build cannot: it stubs
 *  the Node builtins, so the brep kernel has no way to load there.
 *
 *    - Node builtins stay real imports (platform 'node'); dependencies stay external as above.
 *    - A `require` for the ESM output: esbuild turns a require() in bundled code into a shim
 *      that throws in ESM unless one exists.
 *    - No second copy of the 21 MB of textures or the 11 MB wasm: the Node chunks point one
 *      directory up, at the browser build's dist/textures and dist/wasm. The brep kernel loads
 *      in Node through wasm/node.js (OcLoader._loadOcNodeAsync), which imports the Emscripten
 *      glue next to it and finds the wasm next to itself, so both go into dist/wasm.
 */
const node: Options = {
    entry: { 'index': 'src/index.ts' },
    outDir: 'dist/node',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    splitting: true,
    sourcemap: false,
    clean: false,
    dts: false,
    banner: { js: "import { createRequire as __archiyouCreateRequire } from 'node:module'; const require = __archiyouCreateRequire(import.meta.url);" },

    onSuccess: async () =>
    {
        // Each specifier must be found exactly once across the Node chunks: a refactor that
        // changes how one is spelled fails the build here instead of the first Node run
        const REWRITES: Array<[string, string]> = [
            ['`./wasm/node.js`', '`../wasm/node.js`'],      // OcLoader.ocJsNodeModulePath
            ['`./textures/${', '`../textures/${'],          // MaterialManager.textureUrl()
        ];
        const files = (await readdir('dist/node')).filter(f => f.endsWith('.js')).map(f => `dist/node/${f}`);
        const sources = await Promise.all(files.map(f => readFile(f, 'utf8')));
        REWRITES.forEach(([from]) =>
        {
            const hits = sources.reduce((n, src) => n + src.split(from).length - 1, 0);
            if (hits !== 1)
            {
                throw new Error(`[tsup] expected ${from} once in dist/node/*.js, found it ${hits} times. ` +
                    `If its spelling changed in src/, update the Node rewrite in tsup.config.ts.`);
            }
        });
        await Promise.all(files.map((f, i) =>
        {
            const after = REWRITES.reduce((src, [from, to]) => src.replaceAll(from, to), sources[i]);
            return after === sources[i] ? Promise.resolve() : writeFile(f, after);
        }));

        await mkdir('dist/wasm', { recursive: true });
        await cp('src/modeler/brep/wasm/node.js', 'dist/wasm/node.js');
        await cp('src/modeler/brep/wasm/archiyou-opencascade.js', 'dist/wasm/archiyou-opencascade.js');
    },
};

export default defineConfig([browser, node]);
