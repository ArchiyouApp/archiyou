# FreeCAD export: the Recipe layer and the .FCStd exporter

| | |
|---|---|
| Dates | 2026-09-14 → 2026-09-15 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode (agent writes the plan), then as agent (writes code and tests, runs them) |
| Human | Mark van der Net: wrote the prompts below, reviewed the plan and the code, installed FreeCAD 1.1.1 and opened the exports, took the design decisions |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-14 17:52 +0200  Would it be feasable to make an export to FreeCAD? Is it feasable to keep any of the parametric properties (probably not?). How could this be lightweight (and lazily loaded too). Is it valuable? Focus on the model. Not docs, data etc.
2026-09-14 20:27 +0200  [Request interrupted by user for tool use]
2026-09-14 20:28 +0200  Please start implementation of RECIPE.md
2026-09-14 20:28 +0200  Please start implementation of RECIPE.md - do it in a branch called "recipe"
2026-09-15 09:50 +0200  Where is your work? What branch?
2026-09-15 09:51 +0200  You mention brep kernel, is mesh kernel export to freecad not working?
2026-09-15 09:52 +0200  In honesty, what is the change the parametric logic really works? There might be all kinds of alignment problems?
2026-09-15 09:53 +0200  I now have freecad installed. Do the tests please
2026-09-15 10:12 +0200  where is that test file?
2026-09-15 10:17 +0200  I just opened archiyou/workbench in FreeCAD which is pretty nice. How do the updating of the parameters work ?
2026-09-15 10:19 +0200  We got the tracing already planned right? As part of the Recipe infrastructure? What is the change this can work for FreeCAD?
2026-09-15 10:22 +0200  That tracing code would be needed for openSCAD anyway right? How much LOC you expect for FC and OpenSCAD tracing ?
2026-09-15 10:25 +0200  I think porting the parametric logic over from archiyou to OPENSCAD and FC remains pretty hard. It might work for some scripts, but fail for others. This is worse then just exporting the model, and have the FC/OPENSCAD user put any logic whenever he pleases. What do you think of that view? If we leave out the parametric logic and just focus on the model. Would it make it easier for FC/SCAD output?
2026-09-15 10:28 +0200  Yes please do. Keep the params spreadsheet in IFC output, but add a clear WARNING that is does not drive anything. It is for documentation only.
2026-09-15 11:26 +0200  What did the IFC export add to the bundle size?
```

The agent's answers between these prompts were design discussion (feasibility, what a recipe buys per format, the odds that parametric links survive a port), progress reports and test results. Their substance is in the plan below and in the commit messages.

## Plan (agent output, reviewed by the human before implementation)

Written by the agent in plan mode after the first prompt, approved with "Please start implementation of RECIPE.md - do it in a branch called recipe". The "Decision" and "Implementation status" sections were added by the agent during the work, after the prompts of 2026-09-15.

## Recipe: one recorded procedure, many procedural exporters

*STEP, FreeCAD (.FCStd), IFC4/IFC5, BTLx, OpenSCAD from a single kernel-neutral operation record.*

### Context

Four unimplemented plans (`plans/MESH_STEP.md`, `plans/IFC4.md`, `plans/OPENSCAD.md`, `plans/JOINERY.md`) plus the new FreeCAD request each invent their own way to remember *how* a shape was made so the export can be more than facets. MESH_STEP stamps `Mesh.metadata.recipe` for primitives; OPENSCAD rewrites the script and traces calls into a CSG IR with symbolic values; JOINERY keeps a `JointOperation[]` list as source of truth; IFC4 walks the scene and tags with `.is()`. Each would wrap the same kernel methods, fight the same hazards (in-place mutation, shallow metadata copy, `@sceneReplace`), and grow a private IR.

Goal: one **recorder** that attaches a readable operation chain (a *recipe*) to every shape during a run, one **IR**, one **explain/report** facility, and per-format **mappings** that turn recipe nodes into that format's parametric constructs, with baked geometry as the universal fallback. Exporters keep their own serializer (`STEPExporter.ts`, `FCStdExporter.ts`, `IFC4Exporter.ts`, `BTLxExporter.ts`, `SCADExporter.ts`).

Naming: the user suggested `ProcedureMapper`. Recommendation: use **Recipe** as the noun (already the vocabulary in MESH_STEP; short; reads well in logs: "recipe of column: cylinder → rotate → cut") and split the roles by name, since one class doing capture + IR + mapping is what makes such layers hard to follow:

| role | name |
|---|---|
| the data on a shape | `Recipe` (a DAG of `RecipeStep`) |
| capture | `RecipeRecorder` (`@recipe()` decorator for core classes, `installRecipeRecorder(meshup)` for the submodule) |
| per-format rules | `RecipeMapping<Out>` (a table, one file per exporter) |
| generic pattern helpers | the match section of `Recipe.ts` (`asExtrudedProfile`, `asAlignedCut`, `asCuboid`) |
| human view | `explainRecipe(shape)` → text; `RecipeReport` per export |

`ProcedureMapper` works too if preferred; the split matters more than the word.

### Research: does each format fit? (what a recipe buys per format)

The formats sit at different "procedural altitudes". This is the key finding: the shared layer is the recorder + IR + matching, **not** a shared serializer, and no format consumes the whole recipe.

| format | procedural constructs the readers actually honour | recipe consumption | fallback |
|---|---|---|---|
| **OpenSCAD** | full CSG tree (`cube/cylinder/sphere/translate/rotate/mirror/scale/difference/union/intersection/linear_extrude/rotate_extrude`), variables, `for`, `if` | **whole tree**, plus symbolic values for Customizer sliders | `polyhedron` |
| **FreeCAD** | feature tree: `Part::Box/Cylinder/Sphere/Cone`, `Part::Extrusion/Revolution` (from `Sketcher::SketchObject`), `Part::Cut/MultiFuse/MultiCommon`, `Part::Mirroring`, `Placement`, expressions bound to a `Spreadsheet::Sheet` | **whole tree** (no `for`: N shapes = N objects; scale folded into dimensions; non-uniform scale kills the branch) | `Part::Feature` + native `.brp` (brep kernel, `BRepTools.Write` exists in the wasm build) or `Mesh::Feature` (`.bms`) |
| **IFC4** | `IfcExtrudedAreaSolid` (profile + dir + depth; the dominant representation in real files), `IfcRevolvedAreaSolid`, `IfcBooleanClippingResult` (with `IfcHalfSpaceSolid`/`IfcPolygonalBoundedHalfSpace`), `IfcCsgSolid` over `IfcBlock/IfcRightCircularCylinder/IfcSphere/IfcRightCircularCone`, and semantic `IfcOpeningElement` + `IfcRelVoidsElement` | **per product, shallow**: box/extrude → extruded area solid with `IfcRectangleProfileDef/IfcCircleProfileDef/IfcArbitraryClosedProfileDef`; a subtract whose tool is a box/extrusion → opening element (semantic) or clipping result; anything deeper → facets | `IfcPolygonalFaceSet` (the IFC4 plan as written) |
| **IFC5 (.ifcx)** | alpha; USD mesh only in the examples | none today; recipes stay attached to the IR for later | `usd::usdgeom::mesh` |
| **STEP** | Readers only honour B-rep. AP214 *does* define procedural entities (`CSG_SOLID`, `BOOLEAN_RESULT`, `BLOCK`, `RIGHT_CIRCULAR_CYLINDER`, `EXTRUDED_AREA_SOLID`), but OCCT, and so FreeCAD, Fusion, SolidWorks, ignore them. Writing them is possible; nobody reads them. | **leaves only**, and only *curved* ones matter: an unmodified cylinder/sphere/cone/circular extrude → analytic surfaces (`CYLINDRICAL_SURFACE`…). **Planar geometry needs no recipe at all**: a cuboid, an extruded polygon, and any boolean of those are *exactly* representable as planar B-rep faces, so the facet path (with `reconstructNgons()`) is already lossless for them. A boolean above a curved leaf → facets (MESH_STEP's design, unchanged) | `FACETED_BREP` (exact for planar models) |
| **BTLx** | per-part: a beam/plate in its own reference-side coordinate system plus a list of *processings* (`JackRafterCut`, `DoubleCut`, `Lap`, `Pocket`, `Mortise`, `Tenon`, `Drilling`, `Slot`, `FreeContour`, `Marking`, `Text`) | **semantic, per part**: the part = `asCuboid(recipe)`/`Mesh.obbox()` with its frame; processings from (a) `JointOperation`s attached by the joinery module (pocket/through/drill with frame + profile — already exactly a BTLx processing), (b) generic `cut` steps whose tool is a box/extrusion *aligned with the part frame* → `Lap`/`Pocket`/`Drilling`, (c) planar end cuts → `JackRafterCut`/`DoubleCut`. Unaligned or curved tools → `FreeContour` if planar, else unsupported (reported) | none: BTLx has no mesh body; unmapped processings are listed in the report and the part ships without them |

On STEP specifically: "B-rep only" describes what readers accept, not what we can write. STEP has no parametric meaning on the reader side, so the recipe can never make a STEP file *editable* the way it makes an FCStd file editable. What the recipe buys STEP is exactness for curved surfaces (a true cylinder instead of 64 strips) and a smaller file. For a cuboid-only model the recipe buys nothing, because six planes are already exact, and a cut cuboid is still all planes. So the STEP exporter's mapping table is tiny: curved leaves → analytic faces, everything else → the planar facet path, which is not a degradation for planar models. The value of the STEP exporter is therefore mostly in getting it to exist at all (the current path is dead in `Runner.ts:2429`), with names, colours and assembly structure; the recipe is a bonus for curved parts.

Conclusion: the approach fits all five, but with **honest coverage per format** that the exporter must report. STEP gains the least, BTLx and IFC need the extra *semantic* layer (part frame, `.is()` tags, joinery ops) on top of the raw CSG recipe, and OpenSCAD is the only format that wants symbolic values and control flow. The IR must carry (1) concrete values always, (2) optional symbolic values, (3) optional semantic tags, so each exporter reads the altitude it needs.

### The IR (`packages/core/src/modeler/Recipe.ts`, types section)

```ts
export type Value = number | Sym            // Sym only when the tracer is active (OpenSCAD plan)
export type Vec3 = [Value, Value, Value]

export type RecipeStep =
  // leaves
  | { op: 'box';      size: Vec3 }
  | { op: 'cylinder'; radius: Value; height: Value }
  | { op: 'sphere';   radius: Value }
  | { op: 'cone';     r1: Value; r2: Value; height: Value }
  | { op: 'extrude';  profile: Profile; dir: Vec3; length: Value }   // Profile = exact spans (line/arc/circle) or 'baked'
  | { op: 'revolve';  profile: Profile; axis: Axis; angle: Value }
  | { op: 'baked' }                                                   // geometry only, from here down
  // unary, in place
  | { op: 'translate'; v: Vec3 }
  | { op: 'rotate';    angle: Value; axis: Vec3; pivot: Vec3 }
  | { op: 'scale';     f: Vec3; origin: Vec3 }
  | { op: 'mirror';    normal: Vec3; origin: Vec3 }
  // n-ary
  | { op: 'cut' | 'fuse' | 'common'; tools: Recipe[] }
  | { op: 'copy'; of: Recipe }

export interface Recipe {
  steps: RecipeStep[]                       // applied in order to the leaf
  invariants: { polygons: number; area: number; volume: number }   // measured after the last recorded step
  tags?: Record<string, unknown>            // from .is() and joinery: semantic layer, untouched by the recorder
  notes: string[]                           // why a branch died, etc.
}
```

Rules, all inherited from the existing plans and verified in source:

- **Everything unrecorded kills the branch** (`baked` step appended, reason in `notes`): `fillet`, `chamfer`, `hull`, `shell`, `offset`, `loft`, `sweep`, `text`, non-uniform `scale` for curved leaves, a boolean with a dead operand. Detection has two lines of defence: the wrapped mutator appends `baked` itself, and at export `verifyRecipe()` re-measures `polygons/area/volume` against `invariants` scaled by the recorded transforms (MESH_STEP §1), so a method nobody wrapped still degrades safely instead of exporting a wrong solid.
- **Transforms are recorded, and the leaf fitter is kept as a second veto** for primitives (MESH_STEP's SVD cylinder fit) because meshup's vertex order is not transform-stable.
- **Copies get their own Recipe object** (`_copy()` shallow-copies `metadata`, `packages/meshup/src/Mesh.ts:702`); the recorder wraps `_copy` and clones. `Object.freeze` steps.
- **Never call a `@sceneReplace` method from an exporter** (`packages/meshup/src/sceneDecorators.ts:21`); go via `inner()`.
- **Recording is off by default.** Export is a re-run of the script with an output path (`apps/editor/src/pages/editor.ts:932`, `Runner.ts:738`), and `Runner` knows `request.outputs` before executing, so `installRecipeRecorder()` only runs when a requested format is procedural. Normal runs pay nothing; the invariants (area/volume) are only computed at the end of a recording run.
- Kernel-neutral: the same step set for brep and mesh kernels. Brep-kernel classes in core use the `@recipe('cylinder', argsToStep)` decorator directly (`experimentalDecorators` is on in `packages/core/tsconfig.json:17`); meshup is patched from core via `installRecipeRecorder(meshup)` in the `shapeAnnotations.ts` style, because the submodule stays untouched (constraint in MESH_STEP, IFC4, JOINERY).

### Capture: making the rules easy to read

One registry, declarative, the `OPS` section of `Recipe.ts`:

```ts
export const OPS = defineOps({
  // Modeler / static constructors
  cylinder: { on: [Mesh, 'Cylinder'], leaf: (radius, height) => ({ op: 'cylinder', radius, height }) },
  box:      { on: [Mesh, 'Box'],      leaf: (w, d, h)        => ({ op: 'box', size: [w, d, h] }) },
  // in-place transforms (five base methods, Mesh.ts:738-1014; move/rotateX/mirrorZ/place/align compose onto them)
  translate:{ on: [Mesh.prototype, 'translate'], step: (self, px, dy, dz) => ({ op: 'translate', v: toVec(px, dy, dz) }) },
  // n-ary
  subtract: { on: [Mesh.prototype, 'subtract'],  step: (self, ...tools) => ({ op: 'cut', tools: tools.map(recipeOf) }) },
  // killers
  fillet:   { on: [Mesh.prototype, 'fillet'],    kills: 'fillet is not representable' },
})
```

Each row names the kernel method and the step it produces, nothing else. The decorator form for core classes is the same row inline: `@recipe(OPS.cylinder)`. The OpenSCAD tracer (the mappings table in that plan) becomes a second *capture mode* of the same registry: its `pre/post` hooks are generated from the same rows, so it records `Sym` values into the same steps instead of numbers. That plan's private node IR is retired in favour of `RecipeStep`.

### Mapping: one table per exporter

```ts
// FCStdExporter.ts — mapping section
export const FCSTD_MAPPING: RecipeMapping<FcObject[]> = {
  box:      (s, ctx) => [partBox(s, ctx.placement)],
  cylinder: (s, ctx) => [partCylinder(s, ctx.placement)],
  extrude:  (s, ctx) => s.profile === 'baked' ? ctx.bake() : [sketch(s.profile), partExtrusion(...)],
  cut:      (s, ctx) => [partCut(ctx.base, ctx.tools)],
  mirror:   (s, ctx) => [partMirroring(...)],
  translate: ctx.fold, rotate: ctx.fold,              // folded into Placement
  scale:    (s, ctx) => isUniform(s.f) ? ctx.foldScale(s) : ctx.bake('non-uniform scale'),
  '*':      ctx => ctx.bake(),                        // every unmapped op degrades here
}
```

`mapRecipe(recipe, mapping, ctx)` walks the DAG, folds transforms, calls the row, and records every decision in a `RecipeReport` (`mapped | folded | baked(reason)` per step, per shape). The same walk serves every exporter; exporters differ only in rows and in `ctx.bake()`.

Semantic helpers in `Recipe.ts`, shared by IFC and BTLx: `asCuboid(recipe)` (box leaf + rigid transforms → frame + size), `asExtrudedProfile(recipe)` (box or extrude leaf → profile + dir + depth in a frame), `asAlignedCut(cutStep, frame)` (tool expressible in the part frame → pocket/lap/drill parameters), `asOpening(cutStep)`.

### Classification: a rule stage between recipe and mapping

Many format constructs are not a kernel op but a *meaning* derived from one: a thin horizontal box is an `ifc:slab` (floor); a `cut` whose tool is a box or half-space crossing a beam once is a `btlx:sawCut` (a `JackRafterCut`/`DoubleCut` with concrete angles); a box-cut through a wall is an `ifc:opening`. So the pipeline is three stages, all visible in `explainRecipe`:

```
record  →  classify (rules add tags + derived parameters)  →  map (rows keyed by op OR by tag)
```

Rules are declarative, one table per namespace, living in the exporter that owns the namespace (generic geometric predicates such as `isCuboid`, `isThinAlong`, `planarCutOf` live in `Recipe.ts` and are shared):

```ts
// IFC4Exporter.ts
export const IFC_RULES: ClassificationRule[] = [
  { tag: 'ifc:slab',   when: (r, s, ctx) => asCuboid(r) && isThinAlong(s, 'z') && s.bbox().area('xy') > ctx.minSlabArea,
                       derive: (r, s)    => ({ predefinedType: 'FLOOR', thickness: s.bbox().height() }) },
  { tag: 'ifc:column', when: (r, s) => (asCuboid(r) || r.leaf.op === 'cylinder') && isElongatedAlong(s, 'z') },
  { tag: 'ifc:opening', on: 'cut', when: (step, host) => asAlignedCut(step, frameOf(host))?.through === true,
                       derive: (step, host) => asAlignedCut(step, frameOf(host)) },
]
// BTLxExporter.ts
export const BTLX_RULES: ClassificationRule[] = [
  { tag: 'btlx:sawCut', on: 'cut', when: (step, part) => planarCutOf(step, part.frame)?.faces === 1,
                       derive: (step, part) => { const p = planarCutOf(step, part.frame); return { refSide: p.side, startX: p.x, angle: p.angle, inclination: p.inclination } } },
  { tag: 'btlx:lap',    on: 'cut', when: (step, part) => asAlignedCut(step, part.frame)?.kind === 'pocket', derive: … },
  { tag: 'btlx:drilling', on: 'cut', when: (step, part) => step.tools.every(t => t.leaf.op === 'cylinder') && asAlignedCut(...)?.kind === 'drill', derive: … },
]
```

Semantics:

- A rule targets either a whole shape (`when(recipe, shape, ctx)`) or one step (`on: 'cut'`, `when(step, host, ctx)`). It returns a boolean; `derive` computes the format-facing parameters *once*, from the same evidence, so the mapping row for `btlx:sawCut` only formats numbers it is handed.
- Output is a `Classification` attached to the recipe or the step: `{ tag, origin: 'explicit' | 'derived', params, evidence: string, rule?: string }`. `evidence` is a human sentence ("box 2400×3600×200, thin along z, horizontal") and goes into `explainRecipe` and the `RecipeReport`, so a wrong guess is visible and attributable.
- **Explicit beats derived**: `.is('ifc:wall')` from the script (IFC4 plan) or a `JointOperation` from the joinery module short-circuits the rules for that tag namespace. Rules only fill gaps, and the report says which products were guessed (the IFC4 plan's `origin: 'auto'` logging, generalised).
- **Ordering**: rules run in table order; first match per namespace wins, so specific rules go above general ones. A rule may refine a tag from another namespace (e.g. `btlx` rules only run on shapes that classified as a timber part).
- **Mapping rows can key on tags**, not only on ops: `'btlx:sawCut': (cls, ctx) => jackRafterCut(cls.params)`, `'ifc:opening': (cls, ctx) => openingElement(...)`. An un-classified `cut` still falls to the plain `cut` row (or `'*'` → bake). The map walker tries `tag rows → op row → '*'`.
- Rules are pure functions over the recipe and the concrete shape (bbox, obbox, volume), never over the scene as a whole, except through `ctx` (storey elevation, part frame, units). That keeps them unit-testable with a single shape.

What this adds to the pros/cons: one more table per format to read, but it is the place where domain knowledge (what makes a floor, what makes a saw cut) is written down explicitly instead of being scattered through emitters, and a mis-classification points to a single rule name in the report.

### Debuggability

- `shape.recipe()` in scripts / `explainRecipe(shape)`:
  ```
  column  (Mesh#12)
    cylinder(radius=50 ←RADIUS, height=100)
    rotate(30°, x)
    translate(10, 0, 0)
    cut  ⇒ btlx:sawCut (derived by rule 'planar single-face cut': plane through part at x=1180, 45°)
      └ tool: box(20,20,200) → translate(…)
    ⇒ ifc:column (derived: cylinder, elongated along z)   [explicit tags would show origin: explicit]
    [verified: 66 polygons, area ✓, volume ✓]
  ```
- Every export writes a `RecipeReport`: counts of mapped/baked shapes with reasons, printed with `console.user()` and embedded as a comment/metadata block in the file (OPENSCAD's "report comment", FCStd `Meta`, IFC `Pset_Archiyou`, STEP `FILE_DESCRIPTION`).
- IR tests assert on `Recipe` and on the mapped intermediate (`FcObject[]`, `BuildingModel`, `StepModel`), not on serialized text, so failures point at a row.
- The tables are the documentation: "what does FreeCAD get for `fillet`?" is one line in one file.

### Pros and cons

**Pros**

- One capture layer instead of four; the hazards (in-place mutation, shallow metadata copy, `@sceneReplace`, vertex-order instability) are solved once and tested once.
- Coverage is declarative and greppable: a kernel op is a row in the `OPS` table; a format's answer to it is a row in its mapping. Adding a kernel op or a format is additive.
- Safe by construction: unmapped means baked, and the invariant veto catches what wrapping missed. The output is never wrong, only less parametric.
- Each exporter shrinks to serializer + mapping table; STEP/IFC share the SPF writer, FreeCAD/BTLx share XML helpers.
- Zero cost on normal runs (recording gated by requested output).
- The symbolic layer (params → expressions/sliders) plugs in as a value type, so FreeCAD expressions and OpenSCAD Customizer share provenance later without touching mappings.

**Cons and risks**

- The shared part is smaller than it sounds: serializers dominate the work (an FCStd zip, ISO-10303-21, BTLx XML with its reference-side conventions). The recipe layer removes duplicated *capture*, not format expertise.
- Different altitudes mean partial consumers: STEP uses leaves only, BTLx needs a semantic layer above the recipe. Exporters must report coverage honestly or users will assume "parametric export" means full fidelity.
- Recording depends on wrapping every mutating entry point; new meshup methods that mutate without going through a wrapped method are silent until the invariant veto bakes the shape. Mitigation: a test that diffs meshup's public mutating methods against `OPS` rows (mapped or killer) and fails on an unknown method.
- Control flow (`for`, `if`) is invisible to prototype recording; only the OpenSCAD tracer sees it. FreeCAD/IFC get N objects, which is fine; OpenSCAD without the tracer gets N modules instead of a `for`.
- Booleans on the brep kernel are a real B-rep boolean; recording them is trivially correct there, but for the *STEP* path the recipe still cannot help, and for the mesh kernel a boolean result is unfittable, so verification of a `cut` node rests entirely on the invariants check.
- Param provenance without the tracer is a heuristic (literal equals current param value). Say so in the report.

**Maintenance:** low once the recorder exists; the churn is in mapping rows, which are small and local. **Extendability:** a new format = serializer + mapping table + `bake()`; a new kernel op = one `OPS` row and at most one row per format (default `'*'` bakes). **Debuggability:** good, provided `explainRecipe` and the `RecipeReport` ship with the first exporter, not later.

### Files

No subdirectories under `src/modeler` (user constraint). Flat, like `DXFExporter.ts`/`DAEExporter.ts`/`GLTFBuilder.ts` today:

```
packages/core/src/modeler/
  Recipe.ts         the shared layer, one file with sections in this order:
                    types (RecipeStep, Recipe, Value, Profile) · OPS registry · @recipe() decorator +
                    installRecipeRecorder(meshup) + recipeOf() · verifyRecipe() and leaf fitters ·
                    match helpers (asCuboid / asExtrudedProfile / asAlignedCut / asOpening) ·
                    mapRecipe() + RecipeReport · explainRecipe()
  SPFWriter.ts      ISO-10303-21 entity table, refs, dedup, real/string formatting, HEADER.
                    Shared by STEPExporter and IFC4Exporter (same physical file format).
  STEPExporter.ts   mapping table · topology (weld, half-edges, closedness) · faceted + analytic
                    face emitters · assembly/product chain · colours · buildSTEP(root, opts)
  FCStdExporter.ts  mapping table · Document.xml / GuiDocument.xml builders · Sketcher geometry ·
                    .brp (via OCC BRepTools) and .bms writers · spreadsheet · zip · buildFCStd(...)
  IFC4Exporter.ts   .is() taxonomy helpers + vocabulary + OBB classify · BuildingModel IR ·
                    mapping table (swept solids, openings) · IFC4 serializer · IFCX serializer ·
                    deterministic GUID · buildIFC(root, opts)
  BTLxExporter.ts   part frame from asCuboid · processings from JointOperation / asAlignedCut ·
                    BTLx XML · buildBTLx(root, opts)
  SCADExporter.ts   mapping table · Sym + tracer runtime + acorn rewrite (OPENSCAD plan, its
                    nodes.ts replaced by Recipe.ts steps and its mappings generated from OPS) ·
                    Customizer header · polyhedron baking · buildSCAD(root, tracer?, opts)
```

Two consequences to accept: `IFC4Exporter.ts` and `SCADExporter.ts` will be large single files (the tracer alone is several hundred lines), so keep the section order above and a table of contents comment at the top of each. Format-specific unit tests still go one file per format under `packages/core/tests/unit/modeler/` (`recipe.test.ts`, `step.test.ts`, `fcstd.test.ts`, …), matching `dxf.test.ts`.

Existing touch points: `Modeler.ts` `to<Format>()` methods with `await import(...)` (DAE pattern, `Modeler.ts:1143`); `Runner._exportPipelineModels()` (`Runner.ts:2341-2510`) gains the formats and enables recording when any requested format is procedural; `execution/types.ts:13-23` and `constants.ts:37` format lists; editor `EXPORT_FORMATS` (`apps/editor/src/pages/editor.ts:48`) and the file menu (`packages/ui/src/editor/main-menu-file-menu.ts:62-92`); `shapeAnnotations.ts` installs `shape.recipe()`.

### Decision (2026-09-15): export the model, not the logic

Porting a script's parametric logic to FreeCAD or OpenSCAD works for some scripts and silently drifts for others, which is worse than a clean model the user adds their own logic to. So:

- **Exports carry the model.** FreeCAD gets a feature tree (Part::Box, Cylinder, Cut...) with fixed dimensions; OpenSCAD will get a plain CSG tree with literal numbers. Both are always correct and still editable by hand.
- **No parameter links.** The value-equality spreadsheet bindings are removed. The FreeCAD export keeps a Parameters sheet for documentation only, under a WARNING banner that it drives nothing, with no aliases so nothing invites references.
- **The tracer is not planned.** `Value` stays a number. The OpenSCAD plan's Customizer and control-flow emission are dropped with it.
- The Recipe layer stays: it is what turns meshes into features (FreeCAD), CSG (OpenSCAD), analytic surfaces (STEP) and extrusions/openings (IFC).

### Implementation status (branch `recipe`, 2026-09-15)

Done:

- **Step 1, `Recipe.ts`** (mesh kernel): capture table `MESH_OPS`, watch wrappers on every other Mesh method, `resolveRecipe`, `verifyRecipe`, `classify`, `mapRecipe`, `RecipeReport`, `explainRecipe`/`explainNode`, Runner gating. Tests: `tests/unit/modeler/recipe.test.ts`.
- **Step 2, `FCStdExporter.ts`**: Part::Box/Cylinder/Sphere/Cone, Part::Cut (multi-tool as Cut + MultiFuse), MultiFuse, MultiCommon, groups per layer, colours, ArchiyouParams spreadsheet with value-equality bindings, faceted `Part::Feature` fallback via a pure-TS planar BRep writer, exact `.brp` for brep-kernel shapes via OCC, zero-dependency zip. Wired into Modeler, Runner (`default/model/fcstd`), editor File ▸ Export, fulfillment formats. Tests: `tests/unit/modeler/fcstd.test.ts`, `tests/unit/runner/runner.fcstd.test.ts`. Inspection file: `tests/outputs/runner/runner.fcstd.plate.FCStd`.

Deviations from the plan, and why:

- **Staleness by identity, not invariants.** Every meshup op returns a new MeshJs, so comparing the inner mesh object with the one seen after the last recorded op is exact and free. The polygons/area/volume invariants were dropped. `verifyRecipe` compares analytic bounds instead, to catch recorder bugs.
- **Immutable recipes, no `copy` step.** A copy shares the frozen Recipe; the shallow-metadata hazard cannot occur.
- **No hand-listed killers.** Every unrecorded Mesh method is wrapped by a watcher that bakes the recipe with its own name when the geometry changed. Composites (moveTo, align, alignByPoints, rotateSwing, replicate) record through the rows they call.
- **Mirror needs no Part::Mirroring**: every primitive is symmetric, so a mirrored frame is written as a rotation with a flipped local x axis.
- **Fallback is a faceted `Part::Feature`, not `Mesh::Feature`**: the planar BRep writer (with T-junction repair) produces valid solids for any closed mesh.
- **FreeCAD does not recompute on load** (verified in `App/Document.cpp`), so every object carries a cached shape and curved trees are written `Touched`.

Not verified: opening the files in a real FreeCAD. The disk had 1.1 GB free, too little for the AppImage. The format rules were taken from FreeCAD 1.1.3 sources and `EngineBlock.FCStd`, and every `.brp` is read back and validated by OpenCascade in the tests.

- **Brep kernel capture** (`BREP_OPS` + a kernel adapter): OpenCascade moves and rotations change the shape's Location in place, so they need no rows; the adapter reads the Location delta as a placement, and TShape identity (`IsPartner`) is the fingerprint. Rows cover makeBox/Cylinder/Cone/Sphere (partial angles bake), in-place subtract and scale, derived _subtracted/_unioned/_intersections/_mirrored, and copy. Brep recipes export as FreeCAD features with the exact OpenCascade solid as the visible cache.

Verified in FreeCAD 1.1.1 (headless): files load cleanly, geometry matches before and after Recompute on mesh, cm and brep scenes. That run found and fixed the placement-from-cache bug.

Not done yet: extrude/revolve recipes with Sketcher, step 3 (STEP) onward, a static OpenSCAD exporter.

### Implementation start (this session)

- Branch: `git switch -c recipe` from the current `develop`. The working tree has many uncommitted changes; switching carries them onto `recipe` untouched. Nothing is stashed, reset or committed on their behalf. Only the recipe work is committed, file by file.
- Commit `plans/RECIPE.md` first (it is already written).
- Build sequencing step 1 in full: `packages/core/src/modeler/Recipe.ts` and `packages/core/tests/unit/modeler/recipe.test.ts`. Before writing, read the exact meshup signatures being wrapped (`Mesh.Box/Cylinder/Sphere`, the five transforms, `union/subtract/difference/intersect`, `_copy`, `fillet/chamfer/hull`) and the `shapeAnnotations.ts` patching pattern, and the `dxf.test.ts` fixture setup.
- Wire gating in `Runner.ts` so recording only installs when a procedural format is requested.
- Run `pnpm --filter @archiyou/core test` and the typecheck; report results as-is.
- Then continue with step 2, the FreeCAD spike and `FCStdExporter.ts`, as far as it can be verified without a FreeCAD install. Check for `freecadcmd` first and say plainly if round-trip verification was not possible.

### Sequencing

1. `Recipe.ts` with mesh + brep capture for box/cylinder/sphere, five transforms, four booleans, copy, killers; `verifyRecipe()`; `explainRecipe()`; the "unknown mutating method" test. No exporter yet.
2. **FreeCAD** first: it consumes the whole tree, so it exercises every part of the recorder, and the payoff is visible (editable feature tree in FreeCAD). Start with the half-day hand-written FCStd spike (recompute-on-load question, exact XML). Then baked path, then mapping, then Sketcher extrusions, then spreadsheet binding heuristic.
3. **STEP** (MESH_STEP plan, with its recipe layer replaced by `Recipe.ts`): faceted path first, analytic leaves via the same fitters.
4. **IFC4**: as planned, plus its mapping and rule tables for extruded area solids and openings via the `Recipe.ts` match helpers.
5. **BTLx**: after the joinery module exists; part frame from `asCuboid`, processings from `JointOperation`s and `asAlignedCut`.
6. **OpenSCAD**: the tracer as a second capture mode; `Sym` values flow through the same steps.

### Verification

- `recipe.test.ts` (vitest, `packages/core`): each row records the expected step; `.rotate().move()` composes; `.subtract()` nests; `.fillet()` and non-uniform scale bake with a reason; `copy()` arrays keep independent recipes; a manual unrecorded mutation is caught by `verifyRecipe()`; recording is absent when no procedural output is requested; export leaves the scene untouched (node count + parentage).
- Meshup surface test: every public mutating method of `Mesh`/`Polygon`/`Curve` appears in `OPS` as a recorded op or a killer.
- Per exporter: IR-level tests on the mapped model, a `RecipeReport` snapshot for a fixture script (`packages/core/tests/cadscripts/scripts/workbench.js`, `gardenchair.js`), and a round-trip in the real reader (FreeCAD headless for FCStd and STEP; IfcOpenShell for IFC; a BTLx viewer or compas_timber's reader for BTLx; OpenSCAD CLI for `.scad`).
- Bundle check: each exporter is its own chunk; eager editor bundle unchanged.

## Review and decisions by the human

- Reviewed and approved the plan; chose the name Recipe and the branch `recipe`.
- Asked where the work was and on which branch, and whether the mesh kernel path also exported to FreeCAD, when the agent's report leaned on the brep kernel.
- Installed FreeCAD 1.1.1 and asked for the tests to be run against it. That run found the placement bug (primitive features snapping to the origin) fixed in the third FreeCAD commit.
- Opened `archiyou/workbench` in FreeCAD and judged the result.
- Questioned the odds that a script's parametric logic survives a port to FreeCAD or OpenSCAD, and decided that a correct plain model beats logic that drifts: "export the model, not the logic". Asked to keep the parameter spreadsheet as documentation with a clear WARNING that it drives nothing.
- Asked what the exporter added to the bundle size.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| ebc2b1f | Recipe: record how mesh shapes are made, for procedural exporters | "Please start implementation of RECIPE.md - do it in a branch called recipe" (plan step 1) |
| e203d4a | FreeCAD export: recipes become editable FreeCAD features | same prompt, plan step 2 |
| cdcec70 | Recipe: capture the brep kernel, and export it to FreeCAD as features | same prompt, plan sequencing "brep capture"; agent-initiated within the approved plan |
| 0f3be73 | FreeCAD export: place primitive caches by their Placement | "I now have freecad installed. Do the tests please" |
| c45b6cc | FreeCAD export: carry the model, document parameters without linking | "I think porting the parametric logic over ... What do you think of that view?" and "Yes please do. Keep the params spreadsheet ..., but add a clear WARNING that is does not drive anything." |
