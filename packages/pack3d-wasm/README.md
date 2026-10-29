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
| Load balance (centre of gravity, axle loads), best effort and always reported | planned |

Axes: x is the length of the bin, y its width, z its height (up). Lengths are whole millimetres,
weights whole grams.

## How it works

Items are put in one at a time, from a sequence, into the first open bin that takes them (else a new
bin of the cheapest kind). The positions tried in a bin are the extreme points of the boxes already
in it (Crainic, Perboli & Tadei 2008): the corners of each box, moved along the other axes until
they touch a box or a wall. A position is taken when the item fits there and stands. A portfolio of
runs (four sequences by volume, base, longest side and height, each in two fill orders, layers and
walls, with two ways to pick among the free positions) is tried and the best plan by the objective
wins: fewest unplaced items, then lowest cost, then fewest bins, then the fullest bins.

The sequences put the items of the later stops first, so that they end up deepest and lowest; items
without a stop come last. With weights, heavy-first and sturdy-first sequences join the portfolio.
A bin whose door is at the low end of an axis is decoded mirrored and flipped back afterwards, so
the load is built from the far wall towards the door whichever side that is; a door on y adds a
third fill order that runs its walls along y.

While some item has a load limit, loads are tracked as boxes are placed, and a box is never slipped
in under one that is already there (its weight would then have been shared out without it).

## Reproducible

No clock, no operating-system randomness, no floating-point arithmetic in any rule, no hash-map
iteration. The same instance and config give the same bytes. `src/rng.rs` holds the generator for
the search that comes later (xoshiro256++ seeded through splitmix64, known-answer tests from a
separate Python port).

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
cargo test                                   # unit, behaviour and 200 random instances
cargo test --release -- --ignored            # 5 000 random instances against the validator
cargo run --release --example bench          # the benchmark families
```

`src/validate.rs` is the oracle: it re-reads the instance and checks the finished plan pair by pair.
`solve` runs it on every result and returns an error instead of a plan that breaks a rule.
