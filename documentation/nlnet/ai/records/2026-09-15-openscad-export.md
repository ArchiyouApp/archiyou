# OpenSCAD export: non-parametric .scad from recipes

| | |
|---|---|
| Dates | 2026-09-15 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code as agent: researched and rewrote the plan, then wrote code and tests and ran them, step by step on the human's go |
| Human | Mark van der Net: wrote the prompts below, set the scope (no parameters, capture as much of the script as possible), reviewed the plan and approved each step |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below. Same session as the IFC4 export record, which came first |

## Prompts (verbatim, local time)

```
2026-09-15 14:56 +0200  Ok, lets pick up the non-parametric OPENSCAD exporter. Is everything set to go into implementation for that?
2026-09-15 16:13 +0200  First I want you to research and write a updated plan baed on OPENSCAD.md, but with the new Recipe work. I want to focus as much capture of the original script. So fix boxbetween and extrude.
2026-09-15 18:30 +0200  Start implementation please
2026-09-15 18:30 +0200  start first steps of openscad implementation  plan
2026-09-15 19:55 +0200  ok continue the next step
2026-09-15 20:03 +0200  Yes go ahead for step 3
2026-09-15 20:28 +0200  ok go
2026-09-15 20:47 +0200  ok do the last thing
```

## Plan (agent output, reviewed by the human before implementation)

`plans/OPENSCAD.md` as rewritten by the agent on request ("research and write a updated plan based on OPENSCAD.md, but with the new Recipe work"), and approved with "Start implementation please". The earlier version of August 2026 proposed a traced run with dual numbers so that Customizer sliders stay live; that was dropped with the decision, taken in the FreeCAD export unit, to export the model and not the logic. The "Implementation status" section at the end was added by the agent during the work.

## OpenSCAD export from recipes

*Non-parametric `.scad` from Archiyou scripts: CSG where the recipe knows it, closed polyhedra where it does not. Fixed numbers, no Customizer, no tracer.*

### Context

The earlier version of this plan (August 2026) proposed a traced run with dual numbers and an AST rewrite so that Customizer sliders stay live. That was before the recipe layer existed. Today `Recipe.ts` records how every mesh and brep shape was made (box, cylinder, sphere, cone, transforms, booleans, copies) and `FCStdExporter.ts` already turns those recipes into FreeCAD features. The user decided to build the OpenSCAD exporter on the same layer, without parameters, and to put the effort into **capturing as much of the original script as possible** instead.

Where capture stands today, measured over the 16 cadscripts (`packages/core/tests/cadscripts/scripts`) with recording on, counting visible solids:

| Solids in the corpus | Count |
|---|---|
| Procedural (would export as CSG today) | 80 |
| Baked, made by `boxbetween` | 144 |
| Baked, made by extruding a profile (`Mesh.fromPolygons`) | 74 |
| Baked, other (split parts, copies of unrecorded shapes, flatten, loft) | 21 |
| No recipe | 3 |

So a recipe-driven exporter would emit polyhedra for four out of five solids, and `workbench`, `artcrate` and `sedia` would contain no CSG at all. The two gaps are `boxbetween` (39 call sites, plus `make.wall()` internally) and extrusion (72 call sites, the only solid-maker in `simplestep`, `gardenchair` and much of `urhousesketch`). Both are recorder rows, not exporter work. This plan does the rows first, then the exporter.

### Decisions

| | |
|---|---|
| Output | OpenSCAD 2021.01 syntax, one `module` per visible part, a `PART = ""` selector, colours, `$fn` from the kernel's quality settings, a report comment. Coordinates in model units, unscaled, like every exporter except IFC5. |
| Not parametric | No Customizer, no symbolic values, no rewrite. The script's parameter values are listed in a comment header for reference only, as the FreeCAD sheet does. |
| Capture first | New recorder rows for `boxbetween`, `extrude`, `cutoff` and `cutoffBy(solid)`. They benefit FreeCAD and IFC as well. Recipes stay immutable, kernel-neutral, and `packages/meshup` is untouched. |
| Baked fallback | A closed, welded `polyhedron()` with T-junctions repaired, sharing the welder FreeCAD uses. Never a wrong shape, only a less editable one. |
| Verification | Rendered back with the OpenSCAD WASM build (GPL, devDependency only, never bundled) and compared per part on volume and bounding box, the way `web-ifc` checks the IFC file. |
| Loading | Lazy chunk via `await import('./SCADExporter')`, like DAE and FreeCAD. |

### Part 1: capture more of the script (`Recipe.ts`)

#### 1.1 `boxbetween`

`Mesh.BoxBetween` (`packages/meshup/src/Mesh.ts:416`) drives the raw WASM cuboid and wraps it with `Mesh.from`, so the only thing the recorder sees is the static watcher, which bakes with `made by Mesh.BoxBetween()`. The box is `(|dx|, |dy|, |dz|)` centred at the midpoint, the same convention as `Mesh.Cuboid`. One row next to `'Mesh.Cuboid'` (`Recipe.ts:398`):

```ts
'Mesh.BoxBetween': {
    on: k => [k.Mesh, 'BoxBetween'],
    leaf: ([from, to], _result, k) =>
    {
        const a = vec(k.Point.from(from)), b = vec(k.Point.from(to))
        return { step: { op: 'box', size: [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])] }, canonicalCenter: [0, 0, 0] }
    },
},
```

`canonicalCenter` lets the recorder measure the midpoint itself (`wrapRow`, `Recipe.ts:922`), so a corner pair given max-before-min (common in the corpus: `artcrate.js:40`, `sedia.js:82`) needs no normalising. Brep parity: a `'Solid.makeBoxBetween'` row in `BREP_OPS`, since `Modeler.boxBetween` (`Modeler.ts:634`) calls it in brep mode and has no row today. `recipe.test.ts:364-368` asserts the old baked reason and must flip to asserting the box.

#### 1.2 `extrude`: a new leaf step

Every extrusion in the corpus ends in `Polygon.extrude(length, direction?)` (`Polygon.ts:1174`): `line(a, b).extrude(d)` returns a Polygon (`Curve.extrude`, `Curve.ts:3930`), a vertex chain does the same one step earlier, `rect/rectbetween/polyline(...).toFace()` are Polygons, a `ShapeCollection.extrude` calls it per member, and `mesh.polygons().extrude(...)` too. `Polygon.extrude` builds the prism from the **outer ring only** (holes are dropped, `Polygon.ts:1208`), along `normalize(direction) * length` where `direction` defaults to the normal and may be any vector, so an oblique direction gives a sheared prism.

New step, recorded in world coordinates with an identity frame, so later transforms compose into the leaf matrix as they do for every other leaf and `verifyRecipe` stays exact:

```ts
| { op: 'extrude'; ring: readonly Vec3[]; vector: Vec3 }   // outer ring as built (closing duplicate dropped), sweep vector = direction × length
```

Two rows:

- **`'Polygon.extrude'`** on `k.Polygon.prototype`. `patchRows` accepts any owner (`Recipe.ts:836`); the result is a `Mesh`, so `adapter.owns(result)` passes. Ring from `self.vertices()` minus the closing duplicate; vector from the arguments with the same defaulting as the kernel (`self.normal()` when no direction). Bake with a reason when the polygon has holes (`hasHoles()`) so the recipe never over-promises. Capture is `{ step, then: [] }` (fresh placement; nothing to measure).
- **`'Mesh.extrude'`** on `k.Mesh.prototype` (`Mesh.ts:1154`): record only when the surface has exactly one face (`polygons().length === 1`); a folded multi-face surface bakes with `extrude of a multi-face surface`.

One recorder change makes this possible: `OpRow.leaf` is called as `row.leaf(args, result, k)` (`Recipe.ts:915`) and never sees the receiver. Widen it to `leaf(args, result, k, self)` and pass `this`. Existing rows ignore the extra argument.

Everything a new leaf op touches (exhaustive switches, TypeScript flags the ones it can): `LeafStep` (`Recipe.ts:50`), `LEAF_OPS` (`:100`), `leafBounds` (`:1117`, bounds of `ring ∪ (ring + vector)` through the matrix, exact), `chordTolerance` (`:1195`, zero: the ring is already the kernel's polygon), `explainStep` (`:1456`), and in `FCStdExporter.ts` `leafFaces` (`:440`, the prism: two caps and one quad per ring edge), `leafExtent` (`:765`). FreeCAD's mapping table gets no `extrude` row in this plan: a recipe with an extrude leaf falls to `ctx.bake('no mapping for extrude')` and the shape ships as the baked `Part::Feature` it ships as today. Mapping it to `Part::Extrusion` is a follow-on.

What this captures in the corpus: the 12 `line→extrude→extrude` chains, the 5 vertex chains in `simplestep`, the 7 oblique directions (`gardenchair.js:80,103,115`, `maritavolo.js:72`, `sedia.js:118`), the 14 negative lengths, the collection extrusions in `maritavolo` and `timberwall`, and `kakpinchedstool`'s `polygons().extrude().union()` leg. It also captures every `gardenchair` beam that is cut with `cutoffBy(<line>)` **before** extrusion: the cut is a 2D operation on the Polygon, so the ring read at extrusion time already has it.

#### 1.3 `cutoff` and `cutoffBy(solid)`

`Mesh.cutoff(axis, coord, smallest)` (`Mesh.ts:1433`) removes a half-space; `Mesh.cutoffBy(other, keepSmallest)` (`:1394`) subtracts or intersects with a solid, plane or polygon; both then keep the largest piece (`_keepBySize`, `:1336`) and end in `this.update()`, which the watcher reports as `cutoff() is not recorded`. Two `step` rows:

- `'Mesh.cutoff'`: `{ op: 'cut', tools: [halfSpaceBox] }` where the tool is a synthesised box recipe covering the removed side, sized from `self.bbox()` before the call (a `step` row runs before the kernel, `Recipe.ts:967`) with a generous margin. Emits as `difference() { part; translate(...) cube(...); }` in OpenSCAD and `Part::Cut` in FreeCAD with no new node kind.
- `'Mesh.cutoffBy'` with a `Mesh` tool: `cut` (or `common` when `keepSmallest`) with the tool's recipe. Plane and polygon tools bake as today.

Caveat to state in the row comment: when the cut splits the shape, the kernel keeps the largest piece and the recipe describes all pieces. The round-trip test on `simplestep` (two `cutoffBy(solid)` calls) is the check; a mismatch there means adding a post-call piece count and baking.

Covers 12 `cutoff` sites (`simplestep`, `kakpinchedstool`, `tomy`, `urhousesketch`) and the 2 solid `cutoffBy` calls in `simplestep`.

#### 1.4 Not captured, and what happens instead

- `loft` (4 sites: `tomy` ×2, `kakpinchedstool`, `urhousesketch`): baked polyhedron.
- Parts produced by a boolean that splits a mesh (`_separateSolids`, `split`: 13 solids in `timberwallopenings`): baked, the recipe would describe the union of the pieces.
- Brep kernel extrusion: no row; brep scripts bake as today. Mesh-only scope, like the FreeCAD extrusion.
- Open curves, diagram layers, annotations, docs: not geometry.

Expected result after 1.1 to 1.3, from the call-site census: `artcrate`, `workbench`, `strawwall`, `slidercabinet`, `sedia`, `maritavolo`, `timberfloor`, `timberwall`, `simplestep`, `boxpubtest`, `programmaticparams` fully procedural; `gardenchair` and `urhousesketch` mostly (loft roof and the solid-level cuts remain); `kakpinchedstool` mostly (loft seat remains); `timberwallopenings` minus the split offcuts; `tomy` baked. Corpus-wide the procedural share should rise from about 25 % to above 90 %. A coverage test pins the real numbers (Part 4).

### Part 2: shared export helpers

Three exporters carry their own copy of the same functions: `cascadedStyle` and `isVisible` in `DAEExporter.ts:104-121` and `FCStdExporter.ts:856-866` (byte-for-byte), a divergent `cascadedStyleData` in `DXFExporter.ts:825`, and `toRgb01` twice. The polyhedron baker needs the welded-faces core of `writePlanarBRep` (`FCStdExporter.ts:207`: weld at a tolerance, `splitTJunctions`, drop degenerate faces, decide closedness), which the FreeCAD writer then serialises.

- `packages/core/src/modeler/exportStyle.ts` (new, small): `cascadedStyle`, `isVisible`, `toRgb01`. DAE and FreeCAD import it; DXF is left alone.
- `packages/core/src/modeler/exportGeometry.ts` (new): `weldedFaces(faces: BRepFace[], tolerance): { points: Vec3[]; faces: number[][]; closed: boolean } | null` extracted from `writePlanarBRep`, which becomes a thin serialiser over it, plus `meshFaces(mesh, mm)` (`FCStdExporter.ts:869`, the `reconstructNgons` merge). Both DAE-style lazy chunks import it; esbuild puts it in a shared chunk.

The spike behind the old plan found that baked meshup polyhedra with T-junctions are not closed and OpenSCAD's union silently drops them. The T-junction split is what prevents that; the round trip in Part 4 proves it on `tomy` (lofts) and the `timberwallopenings` offcuts.

### Part 3: `SCADExporter.ts`

`packages/core/src/modeler/SCADExporter.ts`, flat like the other exporters, sections in this order with a table-of-contents header:

1. **Options**: `toSCADOptions { units; name?; params?; fn?; tolerance? }`.
2. **Text**: number formatting (up to 6 significant decimals, trailing zeros trimmed, never exponent notation), `vec()`, identifier sanitising and de-duplication (`top length` → `top_length`, second one `top_length_2`), a `color()` from the cascaded style (`#rrggbb` plus alpha).
3. **Frames**: `multmatrix([[a,b,c,tx],[d,e,f,ty],[g,h,i,tz],[0,0,0,1]])` from an `Affine`; a pure translation emits `translate([...])`, an identity emits nothing, so a plain moved box reads `translate([x,y,z]) cube([w,d,h], center = true);`.
4. **Mapping** `SCAD_MAPPING: RecipeMapping<string>` (rows return SCAD text, walked by `mapRecipe` like FreeCAD's):
   - `box` → `cube([w,d,h], center = true)`; `cylinder` → `cylinder(h = …, r = …)` (OpenSCAD's base is at z = 0, the recipe's frame too); `sphere` → `sphere(r = …)`; `cone` → `cylinder(h, r1, r2)`; each under its frame.
   - `extrude` → local frame from the ring (origin at the first point, `u` along the first edge, normal by Newell, `v = n × u`), 2D points `((p-o)·u, (p-o)·v)`, then `multmatrix([u, v, vector, o]) linear_extrude(height = 1) polygon([...])`. The third column is the sweep vector itself, so oblique extrusions are exact. When the vector is parallel to the normal, emit the readable form `linear_extrude(height = |vector|)` on an orthonormal frame instead.
   - `cut` → `difference() { base tools… }`, `fuse` → `union()`, `common` → `intersection()`.
   - `'*'` → `ctx.bake(reason)`; the walker's report records why (`RecipeReport`, `Recipe.ts:1357`).
   - `$fn`: file-level `$fn = getQuality().cylinderSegmentsRadial` (32 at the default preset) so cylinders match the kernel's facets exactly. Spheres use `$fn = sphereSegmentsWidth` on the call; meshup has two dials (32 × 16), OpenSCAD one, so sphere volumes differ slightly. None in the corpus.
5. **Baking**: `polyhedron(points, faces)` from `weldedFaces(meshFaces(mesh))`. OpenSCAD wants each face wound clockwise seen from outside; the kernel's faces are counter-clockwise from outside, so every ring is reversed. A shell that is not closed is still emitted, with a comment and a line in the report suggesting `--enable=lazy-union`.
6. **2D**: closed `Curve`s and `Polygon`s become `polygon(points, paths)` (holes as extra paths) placed with `multmatrix` from the plane frame helpers in `modeler/utils.ts`; open curves are skipped and listed. 2D parts get their own modules and stay out of the default render, since OpenSCAD cannot union 2D and 3D; `PART = "name"` selects them.
7. **Scene walk** `buildSCAD(root, opts): { text, report } | null`: mirrors `buildFCStd` (`FCStdExporter.ts:902`): `cascadedStyle`, visibility (hidden shapes are not parts; a hidden shape that is a boolean tool still appears inside the `difference()` of its host through the tool's recipe), one module per visible solid or 2D part, the `PART` switch at the bottom. Groups become comments, not nesting.
8. **Header**: script name and version, units, `// Parts: 21 procedural, 2 baked (loft)`, the parameter values as `// WIDTH = 1000` lines, the `RecipeReport` summary.

Emitted shape for the editor start script:

```openscad
// Archiyou → OpenSCAD 2021.01  |  script: untitled  |  units: mm
// Parts: 1 procedural, 0 baked
// SIZE = 50

$fn = 32;
PART = "";

module myMainBox() {
    color("#ff0000")
    difference() {
        cube([50, 50, 50], center = true);
        translate([-25, -25, 25]) cube([25, 25, 25], center = true);   // subBox
    }
}

if (PART == "" || PART == "myMainBox") myMainBox();
```

#### Wiring (mirrors `fcstd`)

- `packages/core/src/constants.ts:39,42`: `'scad'` in `SCRIPT_OUTPUT_MODEL_FORMATS` and in `SCRIPT_OUTPUT_RECIPE_FORMATS` (recording is what makes the export procedural).
- `packages/core/src/execution/types.ts:16`: `'scad'` in `ScriptOutputFormatModel`.
- `Modeler.ts`: `async toSCAD(options?)` with a type-only import at the top and `await import('./SCADExporter')` inside, as `toFCStd` does at `:1152`. Prints the report with `console.info`.
- `Runner.ts` output switch, next to `case 'fcstd'` (`:2574`): `case 'scad'` awaiting `toSCAD({ ...formatOptions, name, version, params })`. Format options: `default/model/scad?fn=64`.
- Editor: `ExportModelFormat` and `EXPORT_FORMATS` in `apps/editor/src/pages/editor.ts:48,960` (`mimeType: 'application/x-openscad'`, `ext: 'scad'`), `FORMAT_META` in `apps/editor/src/services/fulfillment.ts:49`, a menu item after IFC in `packages/ui/src/editor/main-menu-file-menu.ts:89`. Not added to `WILDCARD_EXCLUDED_FORMATS`: the writer is pure text and cannot throw on the mesh kernel.
- `packages/core/buildscripts/check-pack.ts`: extend the entry-size check (`:150`) with a marker assertion (`linear_extrude(` absent from `dist/index.js`, present in some chunk) and add `openscad-wasm-prebuilt` to `MUST_NOT_BE_DEPS` (`:67`).

Side note found on the way: `IFC4Exporter.ts` is a static import in `Modeler.ts:49` (about 94 KB of source in the eager bundle). Converting `toIFC` to the dynamic pattern is a separate, small change; `explainIFC()` is synchronous and script-facing, so it needs thought before that move.

### Part 4: verification

1. **Recorder tests** (`tests/unit/modeler/recipe.test.ts`, extend): `boxbetween` with max-before-min corners records a box with the right size and translation; `verifyRecipe` passes; brep `makeBoxBetween` records the same. `line→extrude→extrude`, a vertex chain, an oblique direction, a negative length, a `ShapeCollection.extrude`, `polygons().extrude()`, and `rectbetween().extrude()` all record an `extrude` leaf whose `leafBounds` equal the mesh bounds; a polygon with a hole bakes with a reason; a multi-face `Mesh.extrude` bakes. `cutoff` and `cutoffBy(mesh)` record a boolean the bounds check accepts. A later `subtract` on an extruded shape stays procedural. `explainRecipe` prints the new steps. `missingRows` stays empty.
2. **FreeCAD unchanged**: `fcstd.test.ts` and `runner.fcstd.test.ts` pass; an extruded shape exports as a baked feature with `no mapping for extrude` in the report.
3. **Coverage test** (`tests/cadscripts/scad.coverage.test.ts`, the `cadscripts` project, slow): run every cadscript with `default/model/scad`, write `tests/outputs/cadscripts/<name>.scad`, and compare a table `script | solids | procedural | baked | reasons` against a checked-in snapshot, with a minimum procedural share per script (100 % for the eleven scripts listed in 1.4, corpus-wide ≥ 90 %). Reasons must never contain `Mesh.BoxBetween` or `Mesh.fromPolygons` again.
4. **Emitter tests** (`tests/unit/modeler/scad.test.ts`, fast, `Modeler` direct): golden text for a moved box, a cylinder, a difference, an oblique extrusion (`multmatrix` with the sweep vector), a perpendicular extrusion (`linear_extrude(height = h)`), a mirrored part (negative determinant), a polygon with a hole on an XZ plane, a baked shape, name sanitising, the `PART` switch; number formatting; a hidden tool that appears only inside its host's `difference()`.
5. **Round trip** with `openscad-wasm-prebuilt` 1.2.0 (`devDependencies`, GPL-2.0-or-later, never bundled; the same arrangement as `web-ifc`): write the `.scad` into the WASM filesystem, render each module with `-D PART="name" -o part.stl` (probe `callMain(['--help'])` once for `--backend=manifold` versus the older `--enable=manifold`, and for `--export-format`), parse the STL, and compare per-part volume and bounding box with the Archiyou shape at a relative tolerance (`1e-4` for CSG parts, looser for baked shells and spheres). Runs on the synthetic scenes of test 4 and, in the `cadscripts` project, on the corpus: every part must match or be listed as baked; a mismatch fails. This is what catches a wrong winding, a shear with the wrong sign, a T-junction that leaves a shell open, and the `cutoffBy` piece-count caveat.
6. **Bundle**: `pnpm --filter @archiyou/core build`; `dist/index.js` unchanged within a few KB, a separate SCAD chunk exists, `check-pack` passes.
7. **Manual**: open `tests/outputs/cadscripts/workbench.scad` and `gardenchair.scad` in OpenSCAD or openscad-playground, render (F6), compare with the editor view.

Commands:

```bash
pnpm --filter @archiyou/core test:modeler          # recipe, fcstd, scad unit tests
pnpm --filter @archiyou/core test:scad             # new script: scad.test.ts + recipe.test.ts
pnpm --filter @archiyou/core test:cadscripts       # coverage table + corpus round trip
pnpm --filter @archiyou/core typecheck:budget      # 173 today, over a budget of 156; must not rise
pnpm --filter @archiyou/core build && pnpm --filter @archiyou/core check-pack
```

### Sequencing

1. `Recipe.ts`: widen `leaf` with `self`; rows for `Mesh.BoxBetween`, `Solid.makeBoxBetween`, `Polygon.extrude`, `Mesh.extrude`, `Mesh.cutoff`, `Mesh.cutoffBy`; the `extrude` step with `leafBounds`, `chordTolerance`, `explainStep`; the two FreeCAD switches. Recorder tests. Existing suites green.
2. The coverage test, first as a probe: the table tells whether 1 delivered what the census predicts, before any exporter code exists.
3. `exportStyle.ts` and `exportGeometry.ts`; DAE and FreeCAD switched to them; their tests green.
4. `SCADExporter.ts` sections 1 to 8, `toSCAD`, wiring, emitter tests.
5. `openscad-wasm-prebuilt` round trip, synthetic first, then the corpus. Fix what it finds.
6. `check-pack` guard, build, manual check. Update this file's status section.

### Risks

- `OpRow.leaf` gains a parameter: a one-line recorder change, but every row author must know the receiver is available. Document it in the `OpRow` comment.
- Recording `Polygon.extrude` records a leaf on a path the watcher never covered; a Polygon that was itself derived from an unrecorded solid (a `polygons()` face of a baked mesh) still records a correct ring, because the ring is read from geometry, not from a recipe.
- `cutoff`/`cutoffBy` keep the largest piece; the recipe keeps every piece. Detected by the round trip, fixed by a post-call guard if it bites.
- OpenSCAD's `polyhedron` is unforgiving about winding and closedness; the shared welder and the round trip are the defence. `--enable=lazy-union` is the user's escape hatch for shells the welder cannot close, and the report says so.
- The WASM OpenSCAD is 11 MB and GPL: test-only, and its flag set is whatever OpenSCAD version it was built from. Probe before relying on `--backend=manifold`.
- Sphere facet counts cannot match exactly; documented, no corpus impact.

### Implementation status (2026-09-15, not committed)

Sequencing steps 1 and 2 are done: capture rows and the coverage probe. No exporter code yet.

What exists:

- `Recipe.ts`: the `extrude` leaf step (`ring`, `vector`) with bounds, explain and zero chord tolerance; rows `Mesh.BoxBetween`, `Solid.makeBoxBetween` (brep), `Polygon.extrude`, `Mesh.extrude` (single-face surfaces), `Mesh.cutoff`, `Mesh.cutoffBy`. `OpRow.leaf` now receives the receiver; new `before`/`after` hooks for ops whose effect is only known once the kernel has run.
- `FCStdExporter.ts`: `leafFaces` and `leafExtent` know the extrude leaf. FreeCAD still has no `extrude` mapping row, so extruded shapes export as baked features as before.
- Tests: `tests/unit/modeler/recipe.test.ts` (53 tests; new sections for boxbetween, extrusions and cuts, plus a brep boxbetween test). An extrusion is checked exactly: the mesh's corners are the ring and the moved ring, and the volume is the prism's.
- `tests/cadscripts/recipe.coverage.test.ts` with the snapshot `recipe.coverage.txt`: runs the 16 cadscripts with recording on, tabulates procedural and baked solids with reasons, and runs `verifyRecipe` on every procedural solid. It uses `default/model/fcstd` to switch recording on until `scad` exists.

Result on the corpus (320 visible solids):

| | before | after |
|---|---|---|
| Procedural | 80 (25 %) | 294 (92 %) |
| Recipes that fail verification | | 0 |

Fully procedural: artcrate, boxpubtest, maritavolo, programmaticparams, sedia, slidercabinet, strawwall, timberfloor, timberwall, workbench. Remaining bakes, all for a true reason:

- simplestep 4: `cutoffBy()` of a diagonal beam by a vertical one leaves the beam in two pieces and the kernel keeps only the largest. A cut recipe would keep both, so it bakes.
- timberwallopenings 13: parts split off by booleans (`_separateSolids`, `split`).
- gardenchair 2: `flatten()` (2D drawings shown in the scene).
- tomy 3 + 1, kakpinchedstool 1, urhousesketch 1 + 1: lofts (no recipe) and their copies; one folded two-face roof surface extruded.

Deviations from the plan above, and why:

- **`cutoff`/`cutoffBy` are `after` rows, not `step` rows.** The kernel keeps the largest (or smallest) connected piece, so which side survives is only known after the call. The row reads the side from the result, then checks the kept volume against the volume of the expected side, computed with one extra boolean on a detached clone before the call. A mismatch bakes with "kept one piece of a side that fell apart". This replaces the "caught later by the round trip" caveat with an exact check at record time. The extra boolean runs only in recording runs.
- **`cutoffBy` with a solid records `cut` or `common`**, depending on which side was kept (outside or inside the cutter). Plane and polygon cutters bake.
- **No 'Mesh.fromPolygons' reason remains** in the corpus; the coverage test asserts it, together with no `Mesh.BoxBetween` reason.

Verification run: `recipe.test.ts` 53/53, `fcstd` and `runner.fcstd` pass, all 61 IFC tests pass (the house export now measures boxbetween boxes exactly and classifies the same), `test:runner` 192/192, `test:modeler` 338/339 (the one failure is the animation quaternion test that already failed before this work), coverage probe 4/4. Type errors 173, unchanged.

#### Step 3: shared export helpers (done)

- `src/modeler/exportStyle.ts`: `cascadedStyle`, `isVisible`, `toRgb01(color, fallback)`. The fallback grey is a parameter because DAE uses 204 and FreeCAD 153 (`0x99`); both keep their colour.
- `src/modeler/exportGeometry.ts`: vector helpers, `newell`, `Welder`, `weldFaces(faces, tolerance) → { points, faces: { outer, holes, normal }[], closed } | null` (weld, drop zero-length edges and zero-area faces, split T-junctions, wind holes against their face, turn a closed shell outward), `signedVolume`, and `meshFaces(mesh, factor)`.
- `FCStdExporter.ts`: its copies of the style helpers, the vector helpers, `Welder`, `newell`, `splitTJunctions` and `meshFaces` are gone; `writePlanarBRep` is now a serialiser over `weldFaces()`. `BRepFace` stays exported as an alias of `PlanarFace`, so callers and tests are unchanged.
- `DAEExporter.ts`: imports the style helpers instead of its own copies.
- DXF's divergent `cascadedStyleData` is left alone, as planned.
- Both modules are imported only by the lazily loaded DAE and FreeCAD exporters (and later SCAD), so the eager bundle does not grow.
- Tests: `tests/unit/modeler/exportGeometry.test.ts` (13): a box welds to 8 corners and 6 outward faces; an inside-out shell is turned; an open shell reports open; a hand-built T-junction and a mesh union close; tolerance welding and degenerate faces; hole winding; `meshFaces` on a box and a union; colour fallback, visibility and the style cascade.
- Verification: `exportGeometry` 13/13; `fcstd`, `dae`, `dae.schema`, `runner.dae`, `runner.fcstd` all pass (the planar BRep writer is still read back and validated by OpenCascade there); `test:modeler` 351/352 (only the old animation failure); `test:runner` 196/196; type errors 173, unchanged.

Next: sequencing step 4, `SCADExporter.ts` with `toSCAD`, the wiring and the emitter tests.

#### Step 4: the exporter (done)

- `src/modeler/SCADExporter.ts`: `buildSCAD(root, options) → { text, parts, report } | null`. Recipe rows `box` → `cube(size, center = true)`, `cylinder`/`cone` → `cylinder(h, r | r1, r2)`, `sphere` → `sphere(r)` (with its own `$fn` only when the sphere setting differs), `extrude` → `linear_extrude(height) polygon(points)` in the profile's frame (height = |vector| with the normal as local z; for an oblique sweep height 1 with the sweep vector itself as local z), `cut`/`fuse`/`common` → `difference()`/`union()`/`intersection()`. Placement: nothing, `translate()` or `multmatrix()`. Baked shapes: `polyhedron()` of `weldFaces(meshFaces())`, every face reversed to clockwise-from-outside; faces with holes fall back to the kernel's unmerged polygons; an open shell is kept and the reason says so. Closed curves and faces: 2D modules outside the default render. One module per part, the `PART` switch, a header with script, units, part counts, baked reasons, skipped shapes and parameter values.
- `exportGeometry.meshFaces(mesh, factor, merge = true)`: `merge = false` returns the kernel's own polygons.
- Wiring: `'scad'` in `SCRIPT_OUTPUT_MODEL_FORMATS`, `SCRIPT_OUTPUT_RECIPE_FORMATS` and `ScriptOutputFormatModel`; `Modeler.toSCAD()` (dynamic import); Runner `case 'scad'` with script name, version and parameters; editor File ▸ Export ▸ OpenSCAD, `EXPORT_FORMATS` and fulfillment `FORMAT_META` (`application/x-openscad`). `pnpm --filter @archiyou/core test:scad` runs the SCAD, runner SCAD, export geometry and recipe tests.
- Tests: `tests/unit/modeler/scad.test.ts` (21). Extrusions are read back from the emitted `multmatrix … linear_extrude … polygon` into prism corners and must equal the mesh vertices exactly (perpendicular, oblique, moved and rotated); polyhedra are read back and must enclose the mesh volume with clockwise faces. Plus primitives, rotation, the editor start script with its hidden tool, union and intersection, cutoff, colours, parametric off, 2D parts with holes, open curves, header, units, and a file snapshot `__snapshots__/scad.table.scad`. `tests/unit/runner/runner.scad.test.ts` runs a script end to end. The coverage test now requests `default/model/scad`, writes `tests/outputs/cadscripts/<script>.scad`, and checks that the number of CSG parts equals the number of captured solids for every script (it does, all 16).

Deviations from the plan, and why:

- **Colours only where chosen.** `Style.color` falls back to meshup's default red, and the shared `cascadedStyle` rebuilds a full style, so every part came out red. The exporter reads the explicit colour and opacity of the shape and its layers instead and writes nothing when neither was set. DAE and FreeCAD keep their behaviour.
- **2D parts are written in their own plane's coordinates.** OpenSCAD renders 2D objects in the XY plane only, so `multmatrix` cannot place a vertical face. A face on an XY plane keeps its world x and y; any other plane is written in its own 2D frame, with origin and axes in a comment.
- **Numbers**: 12 significant digits (OpenSCAD reads exponent notation too), not "6 decimals, never exponent".
- **Names**: combining marks are stripped (`über` → `uber`); reserved words and builtins get `_part`; duplicates `_2`, `_3`.

Sanity check with the real OpenSCAD (the `openscad-wasm-prebuilt` 1.2.0 build, installed in a scratch folder, not in the repo; the formal round trip is step 5): every part of `scad.table.scad` and of the 16 corpus files was rendered on its own to STL.

- The example: all 6 parts render; volumes match the model (legs 1 120 000; the top with its 32-sided hole 7 022 441.868 against 7 022 441.871 computed; the oblique brace 288 555.021 against 288 555.021).
- The corpus: 314 of 320 parts render without errors or warnings, including every baked polyhedron. 6 parts of `slidercabinet` (the backplate and the slider doors, each twice) render with "may not be a valid 2-manifold": they are differences whose tools touch the base with exactly coincident faces (the backplate sits in rebates cut by the same strip), a known CGAL case. Their volumes were not compared with the model yet.
- Each render needs a fresh WASM instance: an Emscripten `callMain` runs once per instance.

Verification run: `test:scad` 88/88; `test:runner` 197/197; `test:modeler` 372/373 (the old animation failure); coverage 5/5; editor typechecks cleanly; UI own-typecheck reports one error in `file-info.ts`, which this work does not touch; core type errors 173, unchanged.

Next: step 5, the round trip as a test: `openscad-wasm-prebuilt` as a devDependency, per-part volume and bounding box against the Archiyou shape, on the synthetic scenes and the corpus; it decides what the `slidercabinet` warnings mean.

#### Step 5: the round trip (done)

- `openscad-wasm-prebuilt` 1.2.0 is a devDependency (GPL-2.0-or-later, test-only). It is OpenSCAD 2025.01.19 and supports `--backend Manifold` as well as the default CGAL, and `--export-format binstl`.
- `tests/unit/modeler/scad.render.ts`: `renderPart(text, module, backend)` renders one module (`-D PART="module"`) to binary STL in a fresh WASM instance (an Emscripten module runs `main` once) and measures volume, bounds and triangles; `compareWithShape()` compares with the Archiyou shape (relative volume, bounds relative to size with a 1e-3 floor for 32-bit STL floats). Errors and warnings are OpenSCAD's `ERROR:`/`WARNING:` lines (Manifold also prints `Status: NoError`, which is not an error).
- `tests/unit/modeler/scad.roundtrip.test.ts` (unit project, about 9 s): one scene with a part per construct the mesh kernel records (it has no cone): moved, rotated, sheared by a non-uniform scale after a rotation, mirrored, cylinder, sphere, a difference with a hidden tool, union, intersection, perpendicular, oblique, negative and rotated extrusions, cutoff, cutoffBy (common), tools with exactly flush faces, and a baked plate whose faces have holes. All 18 parts match the model with both engines. Tolerance 1e-5 relative, except spheres and booleans with spheres (1e-3 volume, 1e-2 bounds): meshup puts vertices on the poles, OpenSCAD offsets its rings, so their facets differ (measured 1.2e-5 for a sphere, 1.2e-4 for a box ∩ sphere).
- `tests/cadscripts/scad.roundtrip.test.ts` (cadscripts project, about 140 s): every 3D part of the 16 cadscripts, rendered with both engines, against the model. Snapshot `tests/cadscripts/scad.roundtrip.txt`. Result: **318 of 318 parts match with Manifold and with CGAL.** The 6 `slidercabinet` parts that CGAL warns about ("may not be a valid 2-manifold", exactly coincident tool faces) have the model's volume and bounds; the warning is harmless.

What the round trip found and fixed:

- **A surface was exported as a polyhedron.** `kakpinchedstool` has a flat two-face surface without volume in its leg layer; written as a `polyhedron` it rendered as a meaningless 398 498 mm³. A mesh now counts as a surface when its welded shell is open and its signed volume changes when the faces are moved (a solid's enclosed volume does not depend on its position; a solid with a small gap barely changes, so it stays a polyhedron). A flat surface is written as 2D polygons in its plane (one `polygon` per face in a `union()`); a curved one is skipped and listed. `gardenchair`'s flattened drawing became a 2D part the same way.
- **Parts carry their scene path** (`SCADPart.path`), which is how a rendered module is matched back to its shape.

Verification run: `test:scad` 92/92 (now including the unit round trip); corpus round trip 3/3; coverage 5/5; `test:modeler` 376/377 (the old animation failure); `test:runner` 198/199, the one failure being `runner.fcstd.test.ts` timing out at the 5 s default under the parallel suite (it passes alone in 5.5 s for its three cases, and did time out once before this work); core type errors 173, unchanged.

Next: step 6, the bundle guard (`check-pack`: SCAD code and the WASM package out of the eager bundle and the dependencies), a build, and a manual look in OpenSCAD.

#### Step 6: bundle guard, build, a look (done)

- `buildscripts/check-pack.ts` (`pnpm --filter @archiyou/core check:pack`) gained two checks:
  - **Lazy exporters stay lazy.** `dist/index.js` is a 7 KB stub that statically imports shared chunks, so its size says nothing about what loads up front. The check unpacks every top-level chunk, follows the static `import`/`export … from` edges from `index.js` and `runner.worker.js` (dynamic `import()` is not followed), and fails when a marker of the OpenSCAD exporter, the FreeCAD exporter or `exportGeometry.ts` is in that graph. A marker that is nowhere in `dist` also fails, so the check cannot pass without looking.
  - **Test-only packages stay out.** `openscad-wasm-prebuilt` (GPL) and `web-ifc` must not be runtime dependencies and must not be named anywhere in the built JavaScript.
- Build: `pnpm --filter @archiyou/core build` succeeds (16 s; the declaration step's type errors are pre-existing and allowed by `|| true`). `SCADExporter-*.js`, `FCStdExporter-*.js` and `DAEExporter-*.js` are separate chunks, reached by `import()` only; the shared geometry helpers are one shared chunk. `check:pack`: 26.6 MB tarball, entry 7.1 KB, 11 chunks (1 068 KB) loaded up front, OK.
- The guard was proven to fail: with a temporary static import of `SCADExporter` in `Modeler.ts` the build put the exporter and the geometry helpers into the eager graph (14 chunks, 1 090 KB) and `check:pack` failed naming both chunks. The file was restored from a copy, rebuilt, and the check passed again.
- A look: desktop OpenSCAD is not installed and the WASM build cannot write PNG (no OpenGL), so four corpus scripts (workbench, gardenchair, slidercabinet, maritavolo) were rendered in a scratch folder with a small isometric rasteriser: Archiyou's own STL export next to OpenSCAD's render of the exported `.scad`, same camera. They are indistinguishable.

Follow-up, done on request: **IFC is lazy too.** `IFC4Exporter.ts` was a static import of `Modeler.ts` and sat in the eager main chunk. Now `Modeler.ts` imports only its types and holds the module in a module-level `loadIFCModule()`; `toIFC()` is async and awaits it (the Runner's `ifc` case awaits `toIFC`). `explainIFC()` stays synchronous for scripts: the Runner calls `_loadIFCWhenUsed()` next to the recipe sync, which loads the module when the script or any prefetched component calls `explainIFC(`; a direct Modeler caller gets an error asking for `await modeler.loadIFC()`. `check-pack` lists the IFC exporter as lazy-only (marker `ViewDefinition [ReferenceView_V1.2]`). After the change the build has an `IFC4Exporter-*.js` chunk and the up-front graph shrank from 11 chunks (1 068 KB) to 10 (954 KB). Tests: `tests/unit/runner/runner.ifc.lazy.test.ts` (in its own module registry, so the module starts unloaded: `explainIFC()` inside a component works, and an IFC output works without it) and a direct-call test in `ifc.features.test.ts`. `test:ifc` 62/62, `test:runner` 201/201, `test:modeler` 377/378 (the old animation failure), type errors 173.

The plan is complete: capture (steps 1-2), shared helpers (3), exporter (4), round trip (5), bundle and look (6).

## Review and decisions by the human

- Picked up the OpenSCAD exporter after IFC4, as a non-parametric export: fixed numbers, no Customizer, no tracer. This follows their earlier decision that a correct plain model beats ported logic that drifts.
- Asked for research first and an updated plan on top of the Recipe layer, with the effort on capturing as much of the original script as possible: `boxbetween` and extrusions had to become recipe rows.
- Reviewed the plan and approved it; then approved the implementation step by step ("continue the next step", "go ahead for step 3", "ok go", "ok do the last thing").

## Commits

The OpenSCAD work is part of one mixed commit with the human's own message, made before the disclosure process existed. Its OpenSCAD part is these files; the browser and IFC4 parts of the same commit have their own records.

| Commit | Subject | OpenSCAD files in it |
|---|---|---|
| 22a4393 | Implemented browser functionality. Configurator Feedback logic. Work on procedural output formats: IFC4 and OpenSCAD. First working exporters | `packages/core/src/modeler/SCADExporter.ts`; the `boxbetween` and extrude recipe rows in `Recipe.ts`; tests `tests/unit/modeler/scad.test.ts`, `scad.roundtrip.test.ts`, `scad.render.ts`, `tests/cadscripts/scad.roundtrip.test.ts` and `.txt`, `tests/unit/runner/runner.scad.test.ts`; outputs `tests/outputs/cadscripts/*.scad`, `tests/outputs/runner/runner.scad.table.scad`, `__snapshots__/scad.table.scad`; plus the wiring in `Modeler.ts` (toSCAD), `Runner.ts`, `constants.ts`, `execution/types.ts`, the editor export menu and fulfillment formats |
