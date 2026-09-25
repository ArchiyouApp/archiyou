# Faster hidden-line drawings: cuboid check, batched contact faces, chained polylines

| | |
|---|---|
| Dates | 2026-09-25 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: the agent profiled the script, proposed three fixes in the session, the human approved them) |
| Human | Mark van der Net: wrote the prompts, supplied the slow script (`ur_floor_foundation` with the `foundation_screw` component), approved the proposed fixes, reviewed plan and code |
| Branch | `main` of the `packages/meshup` submodule; this record on `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

The top-view document of the `ur_floor_foundation` script took 7 to 9 seconds, almost all of it
in `all().elevation('top', { hiddenLines: true })`. The agent ran the script headless with the
real parameters and timed the projection internals: the default `'exact'` method projected the
merged scene once (about 1 s) and then projected one contact face per pair of touching
"cuboids" against a full copy of the merged scene, 156 times. Cylinders counted as cuboids,
which multiplied the pairs and drew square outlines around the screws.

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Measured (one run, parameters 4628 × 4248, double centre beam)

| Variant | Total |
|---|---|
| As is | 7.2 s |
| Duplicate screws removed in the script | 4.2 s |
| Duplicates removed + `method: 'clip'` | 2.2 s |
| Duplicates removed + shafts left out of the view | 2.4 s |
| Stricter `isCuboid` simulated in the test, script unchanged | 3.1 s |

### Fixes in meshup

1. **`Mesh.isCuboid()`**: it only checked that every vertex lies inside the oriented box and on
   one of its faces, which every cylinder and prism passes (all vertices are on the caps). Add a
   check that every face normal is parallel to one of three mutually perpendicular directions,
   so only boxes pass. Removes the false contact pairs and the fake squares.
2. **Batch the contact faces** in `ShapeCollection._projectMergedProjectionWithContactFaces()`:
   collect the outline of every contact face and project them all in one
   `MeshJs.projectPolylines()` call against the merged mesh (the same exact solver the linear
   shapes use), instead of one `_projectEdges()` per pair with a fresh copy of the merged mesh.
3. **Chain the projected segments**: the solver returns one polyline per mesh edge, so a
   tessellated circle becomes 60+ separate Curves (3,300 SVG paths for this drawing). Join
   segments that meet end to end with a small turn angle into one polyline, keeping sharp
   corners (box edges) as separate lines.

Verification: the script's drawing before and after (same line work minus the fake squares),
the meshup projection tests and the core kernel/parity/docs tests.

### Added during the work

- **Exact copies of a line are dropped before joining.** In the floor drawing half of the
  hidden segments (1,081 of 2,278) were copies: seen from the top, both caps of a cylinder and
  the top and bottom edges of a box land on the same line. The copies also made four lines meet
  at every point of a circle, so it was not joined.
- **Tests**: two call-count tests in `tests/examples/isometry.test.ts` expected one
  `_projectEdges()` per contact pair and now expect the single merged pass. New tests: cylinders
  and prisms are not cuboids, a projected circle is one closed polyline while box corners stay
  separate, and a cylinder standing on a box draws no square (checked to fail with the old
  `isCuboid()`: 4 square lines).
- **Fixture**: `packages/core/tests/fixtures/house/housetest.features.json` measures the
  house's iso drawing too. Refreshed with `IFC_UPDATE_FIXTURES=1`: 1,081 instead of 1,621 iso
  curves, `Line` → `Polyline` names, and the drawing 5 mm lower because fake contact outlines
  of the slanted roof panels no longer stick out (with the old `isCuboid()` swapped back in the
  bbox matches the old fixture). The rest of the tree is unchanged. The fixture is committed
  with the parallel session's projection work, which changed that iso drawing again.
- **Changelog**: three entries in the Unreleased section of `packages/meshup/CHANGELOG.md`
  (two under Changed, one under Fixed), next to the projection-options work of a parallel
  session that was editing the same files.

### Result

Floor script, parameters as measured above: 7.7 s → 0.5 s for the document, 157 → 1
`_projectEdges()` calls, SVG 360 KB → 85 KB and 3,774 → 358 paths. Split back into segments
the new SVG has exactly the same hidden, visible and silhouette segments as the drawing with
only the stricter `isCuboid()`. meshup: 1,347 tests pass; core unit and cadscripts pass (four
brep tests timed out under load in the full run and pass on their own).

## Review and decisions by the human
- Approved the three proposed fixes ("Can you do these proposed fixes?").

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| meshup `c7fb92f` | Projections: faster contact faces, joined lines, stricter isCuboid | "Can you do these proposed fixes?" |
