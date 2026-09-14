# @archiyou/core

The geometry kernel and script runtime behind [Archiyou](https://archiyou.com) - *an open source open design and automation platform*: run a parametric
CAD script — a few lines of JavaScript — and get back a model, drawings, or a bill of materials.

This is a simple script on our platform:

```js
// Parameters
WIDTH = 100;
DEPTH = 80; 
HEIGHT = 70;

legHeight = HEIGHT-TOP_THICKNESS;
leg = box(LEG_SIZE, LEG_SIZE, legHeight)
        .move(LEG_SIZE/2, LEG_SIZE/2,legHeight/2); // start position of leg
     
legs = leg.array([2,2],[WIDTH-LEG_SIZE,DEPTH-LEG_SIZE]);

top = boxbetween(
    [0,0,legHeight],
    [WIDTH, DEPTH, HEIGHT])
    .color('green');
```

Scripts run in the browser, in a Web Worker, or on a server. The same script that draws a shelf in
the [editor](https://editor.archiyou.com) can produce its GLB, its cut list and its assembly
drawing from your own code.

```bash
npm install @archiyou/core
```

## Running a script

`RunnerWorker` is the one to reach for in an app: it keeps the kernel — several megabytes of
WebAssembly — off the main thread, and the worker is reused across runs.

```ts
import { RunnerWorker } from '@archiyou/core';

const runner = await new RunnerWorker().init();

const glb = await runner.execute('box(100, 100, 20).color("red")', {
  outputs: ['default/model/glb'],
});
```

`execute()` returns the output itself when you ask for one, and a record keyed by path when you
ask for several. `run()` is the lower-level call: it returns the whole result — outputs, console
messages, errors, timings — and never throws on a script error.

```ts
const result = await runner.run(script, {
  params:  { WIDTH: 1200, SHELVES: 4 },
  outputs: ['default/model/glb', 'default/docs/assembly/svg'],
});

if (result.status === 'error') { console.error(result.errors); }
```

Parameters are what make a script a product: a script declares them with `$PARAMS.define(…)`, and
anything you pass in `params` overrides the defaults.

To run on the current thread instead — in Node, in a test, in a build step — use `Runner`
directly:

```ts
import { Runner } from '@archiyou/core';

const result = await new Runner().execute('box(100, 100, 20)');
```

## Bundler notes

**Vite** needs one line, because the runner's worker uses dynamic imports to keep the brep kernel
and the WASM payloads out of the initial download — and a worker that code-splits has to be an ES
module:

```ts
// vite.config.ts
export default defineConfig({
  worker: { format: 'es' },
});
```

Without it the build fails with `Invalid value "iife" for option "worker.format"`, pointing at a
file inside `node_modules` rather than at anything of yours. Vite's default worker format is
`iife`, which cannot code-split; `es` is also what Archiyou's own editor sets.

**webpack, rollup, esbuild** need no configuration.

To sidestep bundler worker handling altogether, construct the worker yourself:

```ts
new RunnerWorker({ createWorker: () => new Worker(myWorkerUrl, { type: 'module' }) });
```

## Two kernels

| Kernel | What it is | When |
| --- | --- | --- |
| `mesh` (default) | [meshup](https://www.npmjs.com/package/@archiyou/meshup), a Rust mesh kernel compiled to WASM | everything, unless you need exact curved geometry |
| `brep` | Open CASCADE Technology 7.6 | fillets, chamfers and NURBS surfaces at full precision |

The brep kernel is an 11 MB lazy chunk: it downloads the first time a run asks for it
(`{ kernel: 'brep' }`) and never otherwise.

## Outputs

An output is addressed by path — `pipeline / category / [name] / format` — and a script decides
which ones it can produce:

| Category | Path | Formats |
| --- | --- | --- |
| model | `default/model/glb` | `glb`, `gltf`, `step`, `stl`, `svg`, `dxf`, `obj`, `dae`, `amf` |
| docs | `default/docs/spec/pdf` | `pdf`, `svg`, `svg-pages`, `json` |
| tables | `default/tables/parts/xlsx` | `xlsx`, `json` |
| metrics | `default/metrics/weight/json` | `json`, `xlsx` |

The name segment accepts a wildcard, so `default/docs/*/svg` renders every documentation page a
script defines, and `default/tables/*/xlsx` returns every table. `getOutput(result, path)` pulls
one out of a `run()` result; `execute()` does that for you.

## In Node

The published bundle targets browsers and workers: `dist/` is built for the DOM, and the brep
kernel's Emscripten glue has its Node branches stubbed out. Node users import the TypeScript
sources instead, which ship in the package:

```ts
import { Runner } from '@archiyou/core/src/runner/Runner';
```

Run those through a TypeScript-aware loader (`tsx`, `ts-node`, a bundler). Node 22 or newer.

## Script modules

Scripts can pull in optional, separately-distributed capabilities — a solver, a costing engine —
with `$module('name')`. They are inert here: nothing loads unless a run is given a module catalog,
and no such module is bundled with this package. The
[module system](https://github.com/ArchiyouApp/archiyou-web/blob/main/modules/README.md) documents
the contract.

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

This package redistributes third-party components with their own terms, and
[ATTRIBUTION.md](./ATTRIBUTION.md) records all of them. The one to know about: the brep kernel is
**Open CASCADE Technology 7.6**, under **LGPL-2.1 with the Open CASCADE exception**, shipped as
`dist/wasm/archiyou-opencascade.wasm`. Its license texts travel with it in
`src/modeler/brep/wasm/`, and ATTRIBUTION.md records the exact source revision it was built from,
how to rebuild and substitute it, and a written offer for the corresponding source. Read it before
redistributing.

---

Source, issues and the rest of the platform:
[github.com/ArchiyouApp/archiyou-web](https://github.com/ArchiyouApp/archiyou-web)
