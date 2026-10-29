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

const solution = bp.solve(instance, { maxRRIterations: 2000, seed: 0 }); // single-threaded
console.log(solution.stats.usagePct, solution.patterns);
```

`solve(instance, options)` applies sensible defaults for any option you omit.
The returned `Solution` is fully camelCase: `patterns[].sheet`, `patterns[].root`
(a `CuttingNode` tree), `stats.usagePct`, etc.

For the raw OR-Datasets wire format there is an escape hatch:
`bp.solveRaw(instanceJson, configJson): string`.

### Reproducible layouts

The same instance, options and `seed` give the same solution on every machine, in
WASM and natively. Another `seed` (a non-negative integer, default `0`) explores
another layout. This holds while the budget is `maxRRIterations`:

> **Bound your runs by iterations.** With neither `maxRRIterations` nor `maxRunTime`
> set, `DEFAULT_ITERATIONS` (2000, about 100 ms for a few hundred parts) applies; the
> solver would otherwise run until the optimum's minimum material limit is reached,
> which may be effectively unbounded for large instances. A `maxRunTime` (whole
> seconds) ends the run by the clock, so the result then depends on how fast the
> machine is.

### Constraints per part and per sheet

- `part.canRotate: false` keeps one part in the orientation given (its length along the
  sheet's length), for parts with grain. Without it the part follows `rotationAllowed`.
- `sheet.firstCut: 'H' | 'V'` fixes the direction of the first cut on that sheet: `'H'`
  leaves strips stacked along the height, `'V'` strips side by side along the length.
- `maxStages` caps the number of guillotine stages (2: strips first, then pieces out of
  each strip, as on a panel saw).

Every layout is a guillotine pattern: a tree of cuts that run from edge to edge.

## Differences from upstream

This is a single-threaded port. The following changes were made to the vendored
source (each marked `// wasm port:` in the code):

- `std::time::Instant` → `web_time::Instant` (std `Instant` panics on wasm).
- Dropped the `mimalloc` global allocator and the `ctrlc` handler (no wasm support).
- The multi-threaded monitor is bypassed; the `lahc` loop enforces `maxRunTime`
  directly. `nThreads` from the config is ignored.
- Logging macros write to `console.log` instead of stdout.

Changes by Archiyou (marked `// archiyou:` in the code):

- Every run is seeded (`seed` in the config, `DEFAULT_SEED` without) and upstream's OS-seeded
  `SmallRng` and `DETERMINISTIC_MODE` switch are gone. `rand` is used without its default
  features, so `getrandom` and the `wasm_js` backend left the build: the module no longer
  imports `crypto.getRandomValues`.
- The generator is `util::rng::PortableRng` (xoshiro256++ seeded through splitmix64, with
  known-answer tests). rand's `SmallRng` is Xoshiro128++ on wasm32 and Xoshiro256++ on 64-bit
  targets, so one seed gave one layout natively and another in the browser.
- The default leftover valuation power 2 is computed as a product, since `powf` comes from
  another libm natively than in wasm and can differ in the last bit.
- `CanRotate` on an item and `FirstCut` on an object in the instance JSON (see above). The
  solver already had `fixed_rotation` and `fixed_first_cut_orientation`; the parser just
  never set them from the input.
- `tests/smoke.rs` pins a layout for a fixed instance and seed; `packages/core/tests/unit/make/pack.test.ts`
  asserts the same layout through the WASM build.
- `ts/BinPacker.ts` shares one WebAssembly instance between all `BinPacker`s: the wasm-bindgen glue
  keeps the instance in module state, so a second instance made the first read its strings from
  the wrong memory.
- `build.sh` regenerates `ts/gdrr2bp-wasm-binary.ts` from the wasm it builds.

Upstream algorithm, IO format and results are otherwise unchanged.
