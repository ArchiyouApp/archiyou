# pack3d-wasm

Stable 3D load planning: boxes into pallets, crates and trailers. Rust, built for WebAssembly, with
a typed TypeScript wrapper. The work and its measurements are recorded in
`documentation/nlnet/ai/records/2026-10-29-pack3d.md`.

What sets it apart from a plain bin packer: every item in a plan **stands**. At least a given share
of its base rests on the floor or on the tops of other items, and its centre lies over that contact.
The plan is the same, byte for byte, for the same input on every machine, and an independent
validator re-checks every plan before it is returned.

## Layout

```
src/              the solver (lib.rs is the entry: `solve_json`, and the wasm exports `solve` and `validate`)
ts/Packer3D.ts    the typed wrapper: Packer3D, the types, orientationMask, input checks
ts/index.ts       barrel
pkg/              generated wasm-bindgen glue (committed); pkg/pack3d_wasm_bg.d.ts is hand-written
ts/pack3d-wasm-binary.ts   the wasm as base64 (generated, committed: CI has no Rust)
tests/            behaviour, fuzz and fixture tests; tests/fixtures holds the instances shared with core's tests
examples/         bench (the benchmark families) and fixtures (writes tests/fixtures)
build.sh          wasm-pack build + the base64 payload
```

## Usage (TypeScript)

```ts
import { Packer3D } from '@archiyou/pack3d-wasm';

const packer = await new Packer3D().init();            // the module loads once per process
const plan = packer.solve({
  items: [{ dims: [400, 300, 250], count: 12, weight: 8000, maxLoad: 40000 }],
  bins: [{ dims: [1200, 800, 1800], maxWeight: 600_000, cost: 25 }],
}, { support: 1, iterations: 100 });
// plan.bins[0].placements: { item, copy, orientation, x, y, z }, plan.unplaced, plan.stats
```

Lengths are whole millimetres, weights whole grams. An item's `orientations` is `'fixed'`, `'upright'`,
`'free'`, `{ up: ['x', 'z'], yaw: false }` (the axes that may point up and whether it may be turned about
the vertical) or the bit mask itself (`orientationMask` makes one). `solve` throws for input that makes no
sense, and never returns a plan that breaks a hard rule. The module is loaded from an inlined base64 string, so it
works in every bundler; `ts/Packer3D.ts` reaches it and the glue through dynamic imports, which is what
lets `@archiyou/core` load it only for scripts that plan a load.

### In Archiyou scripts

`@archiyou/core` wraps this in `make.pack3d(shapes, { bins: [...] })`: it measures the shapes (their
bounding boxes, z up, in the units of the model), takes weights in kg from the options or from a shape's
material, calls `solve`, and returns copies of the shapes turned and moved into place, one group per bin with
the outline of the bin, with the report at `modeler.stats`. Core loads this package on demand, only for a
script that calls `pack3d(`; see the TSDoc of `Make.pack3d` for the options and three worked examples.

## Building

```bash
rustup target add wasm32-unknown-unknown   # once
cargo install wasm-pack                     # once
./build.sh                                  # writes pkg/ and ts/pack3d-wasm-binary.ts
cargo run --release --example fixtures      # only when the solver's behaviour changed on purpose
```

The WebAssembly build gives the same bytes as the native one: `tests/fixtures` holds the instances and the
hash of the native solution of each, `cargo test` checks the native build against them, and the tests of
`@archiyou/core` check this build against them. 270 KB of WebAssembly (`opt-level` 3: 2 gives the same
speed at 265 KB, `s` is twice as slow at 249 KB).

## What is enforced

| Rule | In |
|---|---|
| Items inside the bin, no two overlapping | now |
| Orientation: per item, which of the six orientations are allowed | now |
| Support: `support` (default 0.8) of the base on the floor or on box tops, and the centre inside the convex hull of the contact | now |
| `gap`: clearance kept between items along x and y | now |
| Several bin types with a cost and an optional stock | now |
| Weight limit per bin (`maxWeight`) | now |
| Load limit on top of an item (`maxLoad`, 0 for fragile): a box passes its weight and what it carries to the boxes under it, shared by contact area and rounded up to the gram | now |
| Unloading order (`stop`, `door`): what is unloaded earlier is not under, and not between the door and, what is unloaded later | now |
| Load balance (`balance`: centre of gravity band, two supports with load limits), best effort and always reported | now |

Axes: x is the length of the bin, y its width, z its height (up). Lengths are whole millimetres,
weights whole grams.

## How it works

Items are put in one at a time, from a sequence, into the first open bin that takes them (else a new
bin: of the kind that costs least per volume, or in a second run of the portfolio the one that costs
least, whichever gives the cheaper plan; afterwards every bin tries to move its content into a
cheaper kind). The positions tried in a bin are the extreme points of the boxes already
in it (Crainic, Perboli & Tadei 2008): the corners of each box, both as they are and moved along the
other axes until they touch a box or a wall. (The corner itself matters: the moved copy of the corner
on top of a box slides off it, and the supported place on that box is then never offered. Keeping both
took the 196-box pallet job from 5 pallets to 4.) A position is taken when the item fits there and stands. A portfolio of
runs (four sequences by volume, base, longest side and height, each in two fill orders, layers and
walls, with two ways to pick among the free positions) is tried and the best plan by the objective
wins: fewest unplaced items, then lowest cost, then fewest bins, then the fullest bins.

The sequences put the items of the later stops first, so that they end up deepest and lowest; items
without a stop come last. With weights, heavy-first and sturdy-first sequences join the portfolio.
A bin whose door is at the low end of an axis is decoded mirrored and flipped back afterwards, so
the load is built from the far wall towards the door whichever side that is; a door on y adds a
third fill order that runs its walls along y.

**Balance.** A bin may ask for the centre of gravity of its load to be within a band around the middle of the floor
(`cog`, as a fraction of the length and of the width) and for two supports along the length (`axles`: the
kingpin and the rear axles of a trailer) to carry no more than their limits and not to be lifted; the load
is shared between the supports by the lever rule. Moving the whole load along the bin changes the centre of
gravity without touching any other rule, so every finished bin is moved the least that brings it into the
band, within the room it has. A piece is also kept out of a bin when it would make a balance impossible that
is possible now. What cannot be met is reported, not refused: the bin says `balanceOk: false` with the centre
of gravity and the support loads, and plans with fewer such bins win over cheaper ones.

While some item has a load limit, loads are tracked as boxes are placed, and a box is never slipped
in under one that is already there (its weight would then have been shared out without it).

## Search

With `iterations` above 0, the best constructive plan is improved by late acceptance hill climbing
(Burke & Bykov 2008) over the sequence in which the items are put in: two items swapped, one moved, or
a piece of the emptiest bin moved forward so that it may fit into a bin before that. Items only move
within the run of items with the same stop. A step is a full decode, a candidate is kept when it is no
worse than the current plan or than the plan 40 steps ago, and the plan is judged by the same
objective as the constructive runs. The generator is seeded by `seed`.

It helps on some jobs and not on others. On 40 random jobs of about 60 boxes, 300 steps took the bins
from 112 to 106 (6 jobs better) at 86 ms a job; the gain flattens out (24 jobs: 71 bins, 66 at 300
steps, 63 at 3 000 steps for 1.2 s a job). On the 196-box pallet jobs it found nothing in 1 000
steps; on the trailer it saved a whole trailer at 300 steps (support 0.8).

`maxEvaluations` (default 40 million placements tried) is a limit on the work, not on the time: no
constructive run after the first and no search step is started past it, so a big instance ends with a
valid plan that is less tight, and the same plan on every machine.

## Reproducible

No clock, no operating-system randomness, no floating-point arithmetic in any rule, no hash-map
iteration. The same instance and config give the same bytes. `src/rng.rs` holds the generator of the
search (xoshiro256++ seeded through splitmix64, known-answer tests from a separate Python port).

## Limits

- Items are their bounding boxes, with uniform density. A part that is not a box wastes its corners.
- Stability is static. Nothing is checked about braking, sliding or tipping in transport; straps and
  dunnage are not modelled. The load a box carries is a statics estimate from contact areas, not a
  structural calculation.
- A fragile item (`maxLoad` 0) needs a flat top to sit on or a floor space of its own; the first-fit
  portfolio does not plan flat tops, so such items can cost extra bins until the search is in.
- A few thousand items per call (`MAX_PIECES` is 20 000).

## Testing

```bash
cargo test                                   # unit, behaviour and 200 random instances (some with search steps)
cargo test --release -- --ignored            # 5 000 random instances against the validator
cargo run --release --example bench          # the benchmark families
```

`src/validate.rs` is the oracle: it re-reads the instance and checks the finished plan pair by pair.
`solve` runs it on every result and returns an error instead of a plan that breaks a rule.

## References

- T. G. Crainic, G. Perboli, R. Tadei, "Extreme point-based heuristics for three-dimensional bin packing",
  INFORMS Journal on Computing 20(3), 2008: the candidate positions.
- E. K. Burke, Y. Bykov, "The late acceptance hill-climbing heuristic", European Journal of Operational
  Research 258(1), 2017 (first presented at PATAT 2008): the search.
- A. Bortfeldt, G. Wäscher, "Constraints in container loading: a state-of-the-art review", European Journal
  of Operational Research 229(1), 2013: which rules a real load has to meet (stability, weight, stacking,
  unloading order, balance).
- D. Blackman, S. Vigna, "Scrambled linear pseudorandom number generators", 2018 (xoshiro256++, public domain).
