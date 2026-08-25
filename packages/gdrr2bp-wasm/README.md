# gdrr2bp-wasm

WebAssembly build of [JeroenGar/gdrr-2bp](https://github.com/JeroenGar/gdrr-2bp) —
a goal-driven *ruin & recreate* heuristic for the **2D guillotine bin-packing /
nesting problem** (variable-sized bins, optional 90° rotation, guillotine cuts) —
with a small typed TypeScript wrapper.

## Install

```bash
npm install @archiyou/gdrr2bp-wasm
```

## Layout

```
src/             vendored gdrr-2bp source + the wasm `solve()` entry point (lib.rs)
ts/BinPacker.ts  the typed BinPacker class + public types and wire mapping
ts/index.ts      barrel re-export
pkg/             generated wasm + JS/TS bindings (built by build.sh)
examples/        sample instance + config
tests/smoke.rs   native end-to-end test
build.sh         wasm-pack build script
```

## Building

```bash
rustup target add wasm32-unknown-unknown   # once
cargo install wasm-pack                     # once
./build.sh
```

`./build.sh` runs `wasm-pack build --target bundler` and writes `pkg/`.

## Usage (TypeScript)

```ts
import { BinPacker, type Instance } from '@archiyou/gdrr2bp-wasm';

// 1. Load the wasm (separate, awaited step)
const bp = await new BinPacker().init();

// 2. Solve — plain camelCase objects, no JSON wrangling
const instance: Instance = {
  name: 'demo',
  sheets: [{ length: 10, height: 10, cost: 100 }],   // stock omitted = unlimited
  parts:  [{ length: 5, height: 9, demand: 1, value: 45 }],
};

const solution = bp.solve(instance, { maxRunTime: 2 }); // seconds; single-threaded
console.log(solution.stats.usagePct, solution.patterns);
```

`solve(instance, options)` applies sensible defaults for any option you omit;
only `maxRunTime` / `maxRRIterations` have no default (see note below). The
returned `Solution` is fully camelCase: `patterns[].sheet`, `patterns[].root`
(a `CuttingNode` tree), `stats.usagePct`, etc.

For the raw OR-Datasets wire format there is an escape hatch:
`bp.solveRaw(instanceJson, configJson): string`.

> **Bound your runs.** Set `maxRunTime` (seconds) and/or `maxRRIterations`. With
> neither set the solver runs until the optimum's minimum material limit is
> reached, which may be effectively unbounded for large instances.

## Differences from upstream

This is a single-threaded port. The following changes were made to the vendored
source (each marked `// wasm port:` in the code):

- `std::time::Instant` → `web_time::Instant` (std `Instant` panics on wasm).
- Dropped the `mimalloc` global allocator and the `ctrlc` handler (no wasm support).
- The multi-threaded monitor is bypassed; the `lahc` loop enforces `maxRunTime`
  directly. `nThreads` from the config is ignored.
- Logging macros write to `console.log` instead of stdout.
- `getrandom` uses the `wasm_js` backend (see `.cargo/config.toml`).

Upstream algorithm, IO format and results are otherwise unchanged.
