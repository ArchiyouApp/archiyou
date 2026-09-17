# Kernel parity, second unit: closing the remaining mesh ↔ brep gaps

| | |
|---|---|
| Dates | 2026-09-16 → (open) |
| Model | Claude Fable 5.1 (claude-fable-5-1), 1M context, Claude Code agent |
| Tool | Claude Code as agent (writes code and tests, runs the parity table after each batch) |
| Human | Mark van der Net: asked to start closing the gaps left open by the first unit; reviews the parity table and the code |
| Branch | `recipe` (superproject), `develop` (packages/meshup submodule) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

Continues [2026-09-16-kernel-parity.md](./2026-09-16-kernel-parity.md). The harness (`pnpm test:parity`, `kernel.parity.txt`) and the divergence inventory in `kernel-divergences.test.ts` drive the order; meshup stays the leading kernel, brep adapts.

Order, by how many cadscripts each unblocks and by effort:

1. Items that stop a script on brep today
   - 33 brep `Bbox.containsBbox()` missing (urhousesketch)
   - 28 brep `Vector.rotationBetween()` missing (tomy)
   - 31 brep `ShapeCollection.union()` returns the collection where meshup returns the fused shape (kakpinchedstool)
   - 32 side selectors over a collection of edges return more hits on brep, so `.dim()` lands on a collection (timberfloor)
2. Pinned divergences with a small, brep-side fix
   - 4 brep `scale()` leaves the shape untyped
   - 7 brep `Solid.center()` is the surface centroid, not the centre of mass
   - 5 brep `extend()` runs along the edge's original direction, ignoring its transform (also item 30, gardenchair drift)
   - 1 `arc(start, mid, end)`: the mesh branch of `Modeler.arc()` passes `'threepoint'`
3. Larger contracts
   - 8 extruding a closed outline: capped Solid on brep too, extruded along the same default direction as meshup
   - 2 `union()` mutation contract (re-checked against the mesh kernel first: its in-flight changes moved)
   - 10–15 measurement and walking differences, as far as they are brep-side and cheap
4. Phase 3 of the first unit: the same per-shape table over the 138-script local library, opt-in

After each batch: `test:kernels`, `test:parity` (refresh the snapshot, ship the diff), `test:brep`, core unit, meshup unit. Each fixed item leaves the inventory's open list and gets a positive contract in `modeler.brep.test.ts`.

## Review and decisions by the human

(filled as you go)

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| 3afda10 (packages/meshup, develop) | Kernel parity: collection union() across kernels | "Can you start closing the remaining gaps between the kernels?" |
| dc691d6 (was ea7533c) | Kernel parity: close the remaining brep contract gaps | same |
| 80f20d4 (packages/meshup, develop) | Kernel parity: centroids of flat shapes | same |
| 8456e05 (was d6be395) | Kernel parity: layflat, planeBetween and face cuts on brep | same |
| b6e378c (packages/meshup, develop) | Kernel parity: merge() across kernels, empty-mesh guards | same |

The meshup commits of this unit and of the first one (91e38be, e9e4b32, 1b3459b) were rewritten as 8078bd2, 3afda10, 80f20d4: the agent had staged its hunks with zero context out of a working tree that also held the human's uncommitted meshup refactor, and the committed files were syntactically broken while the working tree (where every test ran) was fine. The human chose to rewrite the unpushed history rather than add a corrective commit; the superproject commits carrying the pointers were rewritten with unchanged trees.
