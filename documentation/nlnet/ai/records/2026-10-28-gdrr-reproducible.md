# GDRR: reproducible layouts, per-part rotation, stages and first cut

| | |
|---|---|
| Dates | 2026-10-28 → (open) |
| Model | Claude Sonnet 5.5 (claude-sonnet-5-5), Claude Code agent |
| Tool | Claude Code as agent (the plan was worked out in conversation, no separate plan mode) |
| Human | Mark van der Net: asked for deterministic 2D and 3D box fitting in Rust compiled to WASM, approved the plan, reviews the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Why

`make.pack()` nests parts with `packages/gdrr2bp-wasm` (GDRR, vendored from JeroenGar/gdrr-2bp). It is
the best 2D solver of the ones compared (GDRR, `cut-optimizer-2d`, `bin-packing`) on synthetic cabinet
jobs, but it is not reproducible: `DETERMINISTIC_MODE` is hard-coded `false`, so the RNG is seeded from
the OS and every run gives another layout (6 runs, 6 layouts; on one job the sheet count moved between
20 and 21). With the flag on, the same runs gave one layout with the same sheet counts. The default
budget of 200 iterations also leaves a sheet on the table on some jobs; 2000 iterations costs about
100 ms in WASM.

### Changes

1. **Seed.** `Config.seed: Option<u64>` (default `0`, a fixed default keeps a parametric model stable when
   a dimension changes a little). `DETERMINISTIC_MODE` and the OS-seeded RNG are removed; `rand` loses
   its default features, so `getrandom` and the `wasm_js` backend leave the build.
2. **Portable PRNG.** `rand::SmallRng` is Xoshiro128++ on wasm32 and Xoshiro256++ on 64-bit, so a seed
   gave other layouts natively and in the browser. A small in-crate xoshiro256++ seeded through
   splitmix64 (`src/util/rng.rs`) replaces it, with known-answer tests. `x^2` in the leftover valuation
   becomes a multiplication, so no libm `powf` differs between native and wasm.
3. **Per-part rotation lock.** `PartType` already has `fixed_rotation`; the parser only filled it from the
   global flag. The item gets an optional `CanRotate`, falling back to the global `rotationAllowed`.
4. **Stages and first cut.** The sheet gets an optional `FirstCut` (`H` / `V`, `fixed_first_cut_orientation`
   exists in the solver); `maxStages` is already a solver option. Both reach `make.pack()`.
5. **Budget.** `BinPacker.solve()` defaults to 2000 iterations when neither `maxRRIterations` nor
   `maxRunTime` is given (the solver otherwise runs until a material bound, which can be very long).
   `make.pack()` defaults `maxIterations` from 200 to 2000. `make.boarding()` keeps 200 for its stats
   nesting, so its cost does not change. `maxTime` stays as an opt-in escape hatch and is documented as
   machine dependent.
6. **`make.pack()` options.** New `seed`, `maxStages`, `firstCut`; `rotation` also takes a function
   `(shape, index) => boolean` to lock single parts (grain). The part sizes are rounded up and the sheet
   down (with a tolerance for float noise) instead of to the nearest unit, so a 600.4 part cannot shrink
   to 600.
7. **Verification.** Rust tests (known-answer PRNG, same seed same output, per-part lock, first cut,
   stages), a native-vs-WASM check of the same instances byte for byte, the existing `make` tests, the
   sheet counts of the earlier benchmark (must not get worse), `tsc --noEmit`, regenerated API docs and
   editor completions, the rebuilt WASM blob and base64 payload.

### Added to the plan while working

8. **One WebAssembly instance.** The new tests made two `BinPacker`s in one process, and the second one
   made the first read its strings from the wrong memory (`encoded data was not valid for encoding
   utf-8`): the wasm-bindgen glue keeps the instance and cached views of its memory in module state.
   `BinPacker.init()` now shares one instance per process (a failed load is not remembered). The test
   that alternates two packers fails without it; it was checked by switching the fix off.
9. **Build.** `build.sh` regenerates `ts/gdrr2bp-wasm-binary.ts` from the wasm it builds (it was a manual
   step) and removes the `pkg/LICENSE` that wasm-pack now writes.

### Out of scope

Adding `bin-packing` for 1D and 3D: advice only, no code in this unit. Not touched either: the stale
`ARCHIYOU_CORE_VERSION` (0.9.0 against 0.10.0 in package.json) and the three cadscript tables that
miss `number_ranges_demo`; both were red before this work.

## Review and decisions by the human
- Required determinism ("deterministic algorithms preferable") and Rust compiled to WASM.
- Asked whether GDRR is guillotine-only too (yes), then approved the GDRR changes.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
