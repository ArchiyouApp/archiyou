# Kernel parity: cadscript bbox table, divergence inventory and brep API fixes

| | |
|---|---|
| Dates | 2026-09-16 → (open) |
| Model | Claude Fable 5.1 (claude-fable-5-1), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode (agent researches and writes the plan), then as agent (writes code and tests, runs them) |
| Human | Mark van der Net: wrote the prompts, set the scope (meshup leads, brep adapts), chose harness + quick fixes, sketch conversion to brep, library sweep later; reviewed the table and the code |
| Branch | `recipe` (superproject), `develop` (packages/meshup submodule) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

The agent ran a read-only probe first (every cadscript on both kernels, per-node bbox by scene path), then wrote this plan. The human answered three questions before approval: harness plus the quick fixes in this pass; convert sketches to brep in brep mode rather than error; the 138-script library sweep later.

## Kernel parity (mesh ↔ brep): research findings and a cadscript-level test harness

### Context

Archiyou has two geometry kernels behind one `Modeler` API: **meshup** (default, mesh/WASM-Rust) and **brep** (OpenCascade). The unit-level parity harness already exists (`packages/core/tests/unit/modeler/kernels/shape-parity.test.ts`, `kernel-divergences.test.ts`), but nothing today runs a *whole script* on both kernels and compares the resulting shapes. The user's sense that parity is "pretty OK but with issues" is right at the primitive level and wrong at the script level: a read-only probe (all 16 cadscripts, both kernels, per-node bbox by scene path) shows **only 6 of 16 cadscripts run on brep**, and of those 6, three have grossly wrong geometry or missing shapes.

Goal of this plan: (1) turn that probe into a permanent, snapshot-based cadscript parity test, (2) document the divergence classes found with root causes, and (3) order the modeling fixes by how many scripts they unblock. Meshup stays the leading kernel: where the kernels disagree on an API contract, brep adapts.

### What exists already (reuse, don't rebuild)

| Piece | Where | Reuse |
|---|---|---|
| Per-step measure/compare with dimensional tolerances (`EXACT`, `TESSELATED`, `ABORT`, `FLOOR`) | `tests/unit/modeler/kernels/shape-parity.test.ts` (`measure()`, `compare()`) | Extract to a shared helper so the cadscript harness uses the same tolerance formula |
| Pinned inventory of 15 known divergences | `tests/unit/modeler/kernels/kernel-divergences.test.ts` | Extend with the new ones found below |
| Script corpus runner pattern with file-snapshot table | `tests/cadscripts/recipe.coverage.test.ts` → `recipe.coverage.txt` | Same shape for the new `kernel.parity.txt` |
| Scene walk keyed by path | `recipe.coverage.test.ts` (`walk`), `scad.roundtrip.test.ts` (`scene.descendants()` + `node.path()`) | Both kernels share the meshup scene, so this works for brep too |
| Library-wide success/failure sweep (138 scripts, SQLite) | `apps/server/tests/parity/mesh-vs-brep-parity.test.ts` | Later: add per-shape comparison there via the same helper |
| Stable per-run shape identity `sid` (same sequence for both kernels) | `packages/meshup/src/SceneNode.ts`, `tests/unit/modeler/sid.test.ts` | Secondary matching key |

### Probe results (baseline, 2026-09-16)

| script | brep status | matched | bbox off | only mesh | only brep | root cause class |
|---|---|---|---|---|---|---|
| artcrate | ok | 10 | **8** | 1 | 1 | A (mirror arg order) |
| boxpubtest | ok | 0 | 0 | 1 | 1 | N (naming only) |
| programmaticparams | ok | 1 | 0 | 1 | 1 | N |
| slidercabinet | ok | 10 | 0 | 22 | 8 | C (collection seam), N (row naming) |
| timberwallopenings | ok | 0 | 0 | 56 | 12 | D (Make is mesh-only, degrades silently) |
| workbench | ok | 12 | 0 | 12 | 3 | C |
| gardenchair | error `other.inner(...).knotsDomain` | | | | | B (sketch = meshup, mixed with brep line) |
| kakpinchedstool | error `toMesh is not a function` | | | | | E |
| maritavolo | error `Vector.rotate` arg types | | | | | F |
| sedia | error `Make::partList` + 4 bbox off | | | | | D, C, G (pivot/direction) |
| simplestep | error `expected instance of MeshJs` + 1 bbox off | | | | | B, G |
| strawwall | error `first(): empty` + 3 bbox off | | | | | C |
| timberfloor | error `toMesh is not a function` | | | | | E |
| timberwall | error `first(): empty` | | | | | D, C |
| tomy | error `toMesh is not a function` | | | | | E |
| urhousesketch | error `Maximum call stack size exceeded` | | | | | H (unknown; Runner strips the stack) |

### Divergence classes found (modeling), ranked by scripts affected

**C. meshup `ShapeCollection` rejects brep shapes passed directly — 5 scripts.** `Modeler.collection()/group()/all()` build a `meshup.ShapeCollection` in both modes. `ShapeCollection.add()` accepts a direct argument only via `Shape.isShape(o)` = `o instanceof meshup.Shape`; the *array* branch also accepts `s.isShapeClass?.()`, which brep shapes implement. So `collection(a, b)` → empty + console error, `collection([a, b])` → works, and `copy()` (spreads into the constructor) → empty. **Fix:** `add()` accepts other-kernel shapes on the direct path too.

**B. `sketch()` is always meshup, so brep-mode scripts mix kernels — 2 scripts.** **Fix (decided):** in brep mode convert `Sketch.end()` output to brep Edge/Wire (a converter next to the existing `brep/toMeshup.ts` seam).

**D. `Make` module is mesh-only and degrades silently — 3 scripts.** **Fix (short term):** throw a clear "Make is mesh-only" error at first use in brep mode.

**E. `toMesh()` missing on brep shapes — 3 scripts.** **Fix:** brep `Shape.toMesh()` returns `this`.

**A. `mirror()` argument order swapped — artcrate.** Known divergence #9. **Fix:** brep adopts the meshup signature `(direction, position)`.

**F. `Vector.rotate` signature — maritavolo.** meshup `rotate(axis, angle)`; brep `rotate(angle, position?, direction?)`. **Fix:** brep adopts `(axis, angle)`.

**N. Scene naming differs, which breaks path matching.** Default node labels embed the kernel type, and meshup `row()/grid()` name copies `name1..n` while brep leaves them unnamed. **Fix:** brep names copies the same way; the harness normalises type-family labels regardless.

**G. Geometry drift on scripts that run — sedia, simplestep.** Candidates: default rotation pivot, extrude direction. Diagnose with the harness once C/B are fixed.

**H. urhousesketch recursion.** Diagnose by bisecting the script under brep after C/B land.

### Implementation

#### Phase 1 — the cadscript parity harness

1. Extract the comparator from `shape-parity.test.ts` into `tests/unit/modeler/kernels/parity-measure.ts`; add a bbox-only mode and a type-family helper (`Mesh↔Solid|Shell`, `Curve↔Edge|Wire`, `Polygon↔Face`, `Vertex↔Vertex`).
2. New corpus test `tests/cadscripts/kernel.parity.test.ts` + snapshot `kernel.parity.txt`, modelled on `recipe.coverage.test.ts`: one Runner, each script on mesh then brep, scene walk keyed by normalised path with a creation-order fallback, bbox (and volume for solids) compared with the shared tolerance formula, one table row per script, `toMatchFileSnapshot` plus floor tests that get widened as fixes land. `test:parity` script in `packages/core/package.json`; note in `packages/core/AGENTS.md`.
3. Pin the new divergences in `kernel-divergences.test.ts` as numbered items with the `SHOULD BE` convention.

#### Phase 2 — modeling fixes, ordered by unblock count (decided: in scope)

1. C: meshup `ShapeCollection.add()` direct path accepts other-kernel shapes.
2. D: `Make` throws a clear mesh-only error in brep mode.
3. E: brep `Shape.toMesh()` / `ShapeCollection.toMesh()` return self.
4. A: brep `mirror(direction, position)` on Shape and ShapeCollection.
5. F: brep `Vector.rotate(axis, angle)`; update internal callers.
6. N: brep `row()/grid()/array()` name copies like meshup.
7. B (decided: convert, not error): `Modeler.sketch()`'s `onEnd` callback maps each meshup Curve through `meshupShapeToBrep()` (lines → `Edge.makeLine`, arcs → three-point `Edge.makeArc`, else interpolated `Edge.makeSpline`; several spans → `Wire.fromEdges`; Polygon → `Face.fromVertices`), name and style carried.
8. G/H: diagnose with the harness once 1–7 stop the shape lists from differing.

#### Phase 3 (decided: later, not in this pass)

Add the per-shape comparison to `apps/server/tests/parity/mesh-vs-brep-parity.test.ts` for the 138-script local library.

### Verification

- `test:kernels` stays green after the helper extraction; `test:parity` reproduces the probe table as its baseline.
- After each fix: re-run `test:parity`, refresh the snapshot with the fix; delete the corresponding pinned divergence.
- Core unit, mesh cadscripts and meshup suites remain green: the mesh kernel must not change behaviour from these fixes.

## Review and decisions by the human

(filled as the unit closes)

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
