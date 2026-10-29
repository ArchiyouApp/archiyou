# pack3d-wasm

Stable 3D load planning: boxes into pallets, crates and trailers. Rust, built for WebAssembly, with
a typed TypeScript wrapper (added in a later step of the work, see
`documentation/nlnet/ai/records/2026-10-29-pack3d.md`).

What sets it apart from a plain bin packer: every item in a plan **stands**. At least a given share
of its base rests on the floor or on the tops of other items, and its centre lies over that contact.
The plan is the same, byte for byte, for the same input on every machine, and an independent
validator re-checks every plan before it is returned.

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
