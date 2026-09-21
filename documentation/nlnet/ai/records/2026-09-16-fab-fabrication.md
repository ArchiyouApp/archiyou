# Fabrication from the model: fab module, norm book, estimate and BTLx

| | |
|---|---|
| Dates | 2026-09-16 → 2026-09-18 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode (agent researches and writes the plan), then as agent (writes code and tests, runs them) |
| Human | Mark van der Net: wrote the prompts, set the scope, reviewed and corrected the plan, took the design decisions |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

Every message the human sent in the session, including the four times they turned down a proposed plan.

```
2026-09-16 10:28 +0200  We did the procedural tracing in Recipe for a variety of output formats. I want to use these machanisms to capture paramatric operations (like the ones with BLTX) and combine them with operational properties, like material stocks, prepation time, production time, assembly time. The example is of a stick frame wall. It has a lot of studs, we need to get a certain stock size, cut to length on both sides, assemble into a frame by screwing etc. All this information is pretty much available in the script/model and by capturing it as a recipe we can start making estimations of time (to cut a straigh edge, or angled one etc etc), waste etc. Would you do a deep research into this subject? Are there comparable approaches? Is it feasable? What are pro's and cons. Please come up with a plan. Please pay attention to the way we can manage the informations around these operations (maybe in a cloud sheet, with our own cloudcalc module?). A strong human control and checks and balances/trust is important for these calculations.

2026-09-16 13:01 +0200  [in plan mode, rejecting the proposed plan]  Small things: name to Fab.ts and centralize there where possible. Also can you research and design a fab.fasten(shape1,shape2, {options}) function first. This should detect if/how shapes are connecting and define fasten methods. For studs within a wall frame there screws go through frame into head of stud. This is pretty easy to determin. Maybe add some minimal geometry to define the fasteners (for example 2D cylinders on the drill plane ). There should be a diagrammitc representation (light-weight) and a high detail one (cutting the screw holes, generating the screw as component) - but the last one can wait.

2026-09-16 13:08 +0200  [in plan mode, rejecting the proposed plan]  Make sure you dont use the is() -- this is not a scalable way. Contact detection should be automatic.

2026-09-16 13:25 +0200  [in plan mode, rejecting the proposed plan]  For the first steps, make the norm book internal. For example in a JSON file. Also for the fasten() method, please dont do something like 'screw 5x70' , should be type 'screw', params { diameter: 5, length: 70 } (most fasteners have diam and length right?). fasten should have clear automatic screw layout patterns based on what types are joined. Make this very human-configurable.

2026-09-16 13:30 +0200  [in plan mode, rejecting the proposed plan]  write it down in ./plans/FAB.md

2026-09-16 13:31 +0200  Now please implement the first phases of the FAB plan

2026-09-16 20:34 +0200  please continue

2026-09-18 15:01 +0200  Ok finish the FAB plan. Do make a test script in local DB called fab_test to illustrate the new features

2026-09-21 (commit session, Claude Fable 5.1)  Commit the fab work with the following message: "First broad setup of fabrication in modeler/Fab.ts - it contains modeling methods and functions like contacts, fasten and recipe registration to be able the bridge from model into production. Still needs broad testing" - follow the nlnet disclosure method
```

## Plan (agent output, reviewed by the human before implementation)

The design document is `plans/FAB.md` (research, feasibility, pros and cons, the design, and the status per phase). The agent wrote it in plan mode; the human corrected it four times (see the review notes) and asked for it to be written there. The `plans/` folder is not part of the repository, so the document is copied at the end of this record, as it stands after phase 6; it is copied again when the record closes.

The implementation plan below, for phases 0 and 1, was approved by the human before any code was written. Phases 2 to 6 follow the phase list in the design document.

## FAB phases 0–1: `fab` global, internal norm book, automatic contacts and fastening

### Context

`plans/FAB.md` designs a fabrication layer: operations from the model, a human-owned norm book, estimates, and BTLx. The user asked to implement its first phases. This plan covers **Phase 0 (wiring)** and **Phase 1 (norm book + automatic contacts + `fab.fasten()`)**. Operations from recipes, estimates and BTLx stay in later phases.

Exploring the code changed four things relative to `plans/FAB.md`. The plan document is updated as part of this work.
- **Contacts use real planar faces, not box frames.** Ridge walls cut stud tops at an angle and build sloped top plates as parallelogram prisms (`Make.ts:476-516`, `:575-595`). Box faces cannot find those contacts. `meshFaces()` (`modeler/exportGeometry.ts:218`) returns each solid's planar faces.
- **Member frames come from face areas, not PCA or recipes.** `Mesh.obbox()` is PCA and arbitrary for square sections. `recipeOf()` is null unless the run asks for fcstd/ifc/scad. So Phase 1 needs no recipe recording. The recording gate, `asCuboid` for extrusions and `'btlx'` move to the phases that use them.
- **Insulation looks like a stick.** A bay fill of 572×120×2424 passes the stick ratios, so fills are detected by material group or by being sandwiched between two members.
- **King and jack studs touch on their 120 mm faces.** They get two staggered rows, not one.

Decisions already taken with the user:
- The norm book is internal: `modeler/fab.json`.
- No tags and no `.is()`; contacts are detected automatically.
- Fasteners are objects: `{ type: 'screw', diameter: 5, length: 90 }`.
- Layout patterns are clear and chosen by a human-editable rule table.
- Everything is centralised in `modeler/Fab.ts`.
- Mesh kernel only.

### Script API delivered

```js
ops = fab.operations(wall)                        // all touching pairs → joints → fastenings, diagram drawn
ops = fab.operations(wall, { joints: { 'stud-plate': { method: 'toe' } }, detail: 'none' })
ops.members(); ops.contacts(); ops.fastenings(); ops.fasteners()   // fasteners(): [{type, diameter, length, count}]
ops.warnings(); ops.explain(); ops.table('fastenings'); ops.table('fasteners', { by: 'fastener' })

fab.contact(stud, plate)                          // Contact | null
fab.connections(wall)                             // Contact[]
f = fab.fasten(stud, plate, { count: 3 })         // per-pair override; operations() reuses it, no double diagram
f.joint; f.method; f.pattern; f.fastener; f.fasteners; f.count; f.warnings; f.notes; f.evidence; f.sources; f.shapes

fab.configure({ joints: { 'stud-plate': { count: 3 } }, fasteners: [{ type: 'screw', diameter: 5, length: 100 }] })
fab.config()                                      // effective book, with the source of every row
```

Validation follows the cloudcalc rule:
- Unknown option keys throw an error that names the known keys.
- A string fastener such as `'screw 5x90'` throws an error that shows the object form.
- In brep mode every call throws "fab: needs the mesh kernel", like `Modeler.text()`.

### Phase 0: wiring (no behaviour change for scripts that do not use `fab`)

| File | Change | LOC |
|---|---|---|
| `packages/core/src/modeler/Modeler.ts` | See the list below the table. | +60 |
| `packages/core/src/runner/Runner.ts` | Import `loadFabModule`. Add `fab: state._archiyou.modeler.fab` in `_addModulesToScopeState` (:400, next to `make`). Add `_loadFabWhenUsed(request)`, a copy of `_loadIFCWhenUsed` (:742) with regex `/\bfab\s*\.\s*\w+\s*\(/` over script + component code. Call it in `execute()` after `_loadIFCWhenUsed` (:711) and in `_executeLocalInScriptStatements` after `_prepareModules` (:1163), which is the direct path. **Not** in `MODELER_METHODS_INTO_GLOBAL`: `fab` is an object, and `.bind` would throw on every run. | +15 |
| `packages/core/src/modules/ModuleRegistry.ts:40` | Add `'fab'` to `RESERVED_SCOPE_NAMES`. Otherwise a module could shadow it. | +1 |
| `packages/core/buildscripts/check-pack.ts:83` | Add a `LAZY_ONLY` entry for Fab.ts. Its marker is the explain header string `'Archiyou fab: fabrication from the model'`, which is used at runtime so it survives the build. | +1 |
| `packages/core/package.json` | Add `"src/**/*.json"` to `files`. Published `src/` currently lacks `materials.json`, and `fab.json` would be missing too. Add a `"test:fab"` script. | +2 |
| `packages/ui/src/editor/completions.ts` | Add a top-level `{ label: 'fab', type: 'variable' }` (:185). Add a static `fabMembers` list checked next to `componentImporterMembers` (:453). `moduleMemberMap` is cleared on module registration, so the list cannot go there. | +25 |

`Modeler.ts` changes:
- `let fabModule` and `export async function loadFabModule()`, next to `loadIFCModule` (:55-61). Use only `import type { FabFacade, FabRunState } from './Fab'`.
- `async loadFab()`, like `loadIFC()`.
- A `_fabState: FabRunState | null` field, owned by Fab.ts and set to `null` in `reset()` (:176).
- `get fab(): FabFacade`: a stable, stateless forwarding object created once. It has `contact`, `connections`, `fasten`, `operations`, `configure` (returns the facade) and `config`. Each method calls `this._requireFab('fab.x')`, which throws "the fabrication module is not loaded… await modeler.loadFab() first", like `explainIFC()` (:1204). Keeping the object stateless avoids the stale-`make` trap: the scope binds the getter's value once, while `reset()` replaces run state.

`Fab.ts` statically imports `./fab.json` and `./exportGeometry`, so both stay in the lazy chunk. `exportGeometry` is already lazy-only. Fab.ts does not import Recipe in Phase 1.

### Phase 1: `modeler/Fab.ts` and `modeler/fab.json`

#### `fab.json`: the internal norm book, all lengths in mm, angles in degrees

JSON has no comments, so an `about` block explains each section. Rows accept `"note"`, `"source"` and `"confidence"`, and ignore keys starting with `//`.

```jsonc
{
  "version": "2026-09-A",
  "about": { "units": "mm, degrees", "joints": "Read top to bottom; the first row whose `when` holds decides the joint…", "patterns": "endRow | row | corners | sheet | toe", "source": "Archiyou defaults after IRC R602.3(1) and EN 1995-1-1 §8. Calibrate before trusting." },
  "measure": { "contactTolerance": 0.5, "angleTolerance": 1, "minContactArea": 1,
               "stickMinLengthRatio": 2.5, "stickMaxSectionAspect": 8, "sheetMinAspect": 10,
               "verticalDeg": 15, "horizontalDeg": 10, "fillMinWidth": 150, "fillMaterialGroups": ["insulation"] },
  "checks":  { "minPenetrationD": 6, "minEdgeD": 3, "minSpacingD": 5 },
  "fasteners": [   // catalogue used by length "auto"; prices and times arrive with the estimate phase
    { "type": "screw", "diameter": 4, "length": 30 }, { "type": "screw", "diameter": 4, "length": 40 }, …
    { "type": "screw", "diameter": 5, "length": 70 }, { "type": "screw", "diameter": 5, "length": 90 }, …
    { "type": "screw", "diameter": 6, "length": 100 }, … { "type": "nail", "diameter": 3.1, "length": 90 }
  ],
  "joints": [
    { "joint": "fill", "when": { "kinds": "fill+*" }, "method": "none", "note": "insulation or bay fill: not fastened" },
    { "joint": "sheet", "when": { "contact": "face-side", "kinds": "sheet+stick" }, "method": "through",
      "through": { "pattern": "sheet", "from": "sheet", "fastener": { "type": "screw", "diameter": 4, "length": "auto" },
                   "pitch": 300, "edgePitch": 150, "edgeZone": 50, "end": 15, "penetration": 30 },
      "source": "IRC R602.3(1): 6 in at edges, 12 in in the field" },
    { "joint": "stud-plate", "when": { "contact": "end-side", "kinds": "stick+stick", "entering": "vertical" }, "method": "through",
      "through": { "pattern": "endRow", "fastener": { "type": "screw", "diameter": 5, "length": "auto" }, "count": 2, "inset": 30, "penetration": 50 },
      "toe":     { "pattern": "toe", "fastener": { "type": "screw", "diameter": 5, "length": 70 }, "count": 2, "angle": 30 },
      "source": "IRC R602.3(1): 2 end nails, or toe nails" },
    { "joint": "rafter-plate", "when": { "contact": "end-side", "kinds": "stick+stick", "entering": "sloped" }, … },
    { "joint": "header-stud",  "when": { "contact": "end-side", "kinds": "stick+stick", "entering": "horizontal" }, … screw 6 auto, pen 60 },
    { "joint": "stud-stud",    "when": { "contact": "side-side", "kinds": "stick+stick", "relation": "parallel", "direction": "vertical" }, "method": "through",
      "through": { "pattern": "row", "from": "thinner", "fastener": { "type": "screw", "diameter": 5, "length": "auto" }, "pitch": 400, "end": 50, "rows": "auto", "penetration": 30 } },
    { "joint": "plate-plate",  "when": { "contact": "side-side", "kinds": "stick+stick", "relation": "parallel" }, … row, rows 2 },
    { "joint": "cross",        "when": { "contact": "side-side", "kinds": "stick+stick" }, … corners, count 2, edge 25, screw 6 auto, pen 50 },
    { "joint": "end-end",      "when": { "contact": "end-end" }, "method": "none", "note": "end grain to end grain: use a plate or a bracket" },
    { "joint": "sheet-edge",   "when": { "contact": "edge-*" }, "method": "none" },
    { "joint": "sheet-sheet",  "when": { "kinds": "sheet+sheet" }, "method": "none", "note": "layered sheets: add a rule" }
  ]
}
```

A contact that matches no row is **unmatched**: it is reported in warnings and the table, and never silently skipped. There is no catch-all row.

#### `Fab.ts` sections (header in Recipe.ts style, `import type { Modeler }` only)

1. **Types** (~110):
   - `FabBook`, `JointRow`, `JointSpec`, `Fastener`, `Member`, `Contact`, `Fastening`, `FabRunState`, `FabFacade`.
   - `FabRunState` holds `{ config patch, pairs: Map<pairKey, {options, fastening}>, drawn: Map<pairKey, {hash, shapes}>, layer }`.
2. **Book** (~190):
   - TypeBox `FabBookSchema` / `JointRowSchema` / `FastenerSchema`, validated with `Check`/`Errors` from `typebox/value` as in `MaterialManager.load()`. Errors throw with the row (`joints#4`) and field.
   - `effectiveBook(modeler)` = `fab.json` deep-merged with the run's `configure()` patch. Rules for `joints`:
     - an object keyed by joint name patches every row with that name;
     - shorthand keys (`count`, `pitch`) patch the row's default method spec;
     - `{ method: 'toe' }` switches the method;
     - an array of rows is prepended, so those rows win.
   - Fastener catalogue entries are merged by type + diameter + length.
   - Every row remembers its source: `book | run`.
   - **Matcher** `matches(cond, value)`, reused by the estimate phase later. Condition grammar: `a|b`, `!=x`, `>x`, `>=x`, `<x`, `<=x`, the numeric range `a-b` (only when both sides are numeric and a < b), and `*` globs.
   - `when` keys: `contact`, `kinds` (unordered, `*` allowed), `relation`, `entering`, `receiving`, `direction`, `section` (entering, `"38x120"`), `thickness`, `material` (name or group of either member), `name` (a name hint of either member).
3. **Measure** (~150): `measureMember(shape, units)`:
   - **Faces:** `meshFaces(mesh, 1, false)` gives the kernel's convex polygons. Any non-convex piece is ear-clipped (~35 LOC). The faces are grouped into planes (normal within `angleTolerance`, offset within `contactTolerance`). Outward orientation is checked from the sign of Σ(N·p)/6 and flipped if negative.
   - **Frame:** n1 is the normal family with the largest area; n2 is the largest family perpendicular to n1; n3 = n1×n2. Extents are projections of the vertices. When no perpendicular family exists (round shapes), fall back to `obbox()` with copied tuples.
   - **Kind:** `stick | sheet | block` from the sorted sizes and the `measure` ratios. `fill` is set later.
   - **Direction:** `vertical | horizontal | sloped`, as in `IFC4Exporter.directionOf`. A sheet takes the direction of its plane.
   - **Other fields:** section `[t, w]` and length in mm, `fill = volume / boxVolume`, `material()?.name` / `.group`, and a name hint from the last lower-case name token.
   - **Face roles:** `end`/`side` for sticks and blocks (end when the normal's dominant component lies along the long axis, so angled cuts up to 45° stay ends); `face`/`edge` for sheets.
   - **Input:** flattened from a Shape, collection or array, keeping only `type === 'Mesh'` with `volume > 0`. Hidden shapes are skipped unless `hidden: true`.
4. **Contacts** (~170):
   - Candidate pairs come from a bbox sweep over boxes enlarged by the tolerance.
   - Plane pairs qualify when their normals are anti-parallel and the planes coincide.
   - The overlap is the sum of convex clips (Sutherland–Hodgman) of the pieces, in a plane basis (u, v) chosen per contact:
     - end-side: u = the entering member's width axis;
     - face-side: u = the stick's long axis;
     - side-side: u = the long axis of the thinner member.
   - A contact counts when its area ≥ `minContactArea`.
   - `Contact` holds:
     - `{ a, b, entering, receiving, kind: 'end-side'|'side-side'|'end-end'|'face-side'|'face-face'|'end-face'|'edge-…' }`
     - `relation`, `plane {origin, normal (receiving → entering)}`, `u`, `v`
     - `pieces` (2D polygons), `rect [[u0,v0],[u1,v1]]`, `area`, `evidence`
   - The entering member is chosen by role rank (end < face < side < edge); ties go to the thinner member along the normal, then to input order.
   - **Overlap check** for pairs without a contact: a separating-axis test on the two frames, confirmed with `a.overlapPerc(b) > 0.001` (the same test Make uses). A confirmed overlap gives the warning "stud3 and plate1 overlap". This keeps the check cheap and avoids false alarms for cut members.
   - `fab.contact(a, b)` returns null when there is no contact. `fab.fasten()` then throws with the smallest gap found: "do not touch (gap 5.0 mm)".
5. **Joints** (~110):
   - **Fills first.** A member is a fill when its material group is in `fillMaterialGroups`, or when it has side contacts with two different members on opposite faces and its width across ≥ `fillMinWidth`.
   - For each contact, the first matching row (with any method filter from options) gives the joint and the spec.
   - Patch layers are applied in order: book, then run (`configure`), then call (`operations` options), then pair (`fasten`). Each value records its source: `book|run|call|pair|auto|default`.
   - `method: 'toe'` requires pattern `toe` and a numeric length; otherwise validation fails.
6. **Patterns** (~150): the `PATTERNS` registry. Each pattern is a pure `(contact, spec, d) → Array<[u, v]>` with documented defaults, and this is the one place to add a layout.
   - `endRow`: `count` (2) points along u at `inset` (`'auto'` = max(edge, width/4)), centred on v.
   - `row`: `count = max(2, ceil((len − 2·end)/pitch) + 1)` points, evenly spaced from `end` to `end`.
     - `rows: 'auto'` gives 2 rows when the width ≥ `rowsAutoFrom` (80), at v = ±width/4, staggered by half a spacing.
   - `corners`: `count` 1 / 2 / 4 points at `edge` inset, on the diagonal(s).
   - `sheet`: one row along the strip at `end` from its ends.
     - The spacing is `edgePitch` when the strip lies within `edgeZone` of the sheet outline, otherwise `pitch`.
   - `toe`: `count/2` points on each wide face of the entering member, at `start` (`'auto'` = length/3) from the contact plane.
   - Points outside the overlap pieces are dropped, with a warning.
7. **Fastenings** (~150):
   - **Through:** enters at `p − n·t` on the far face of `from`, direction `n`. `t` is the `from` member's extent along `n`. `from` is `receiving` for end-side, `thinner` or `sheet` for face contacts.
   - **Toe:** enters on the side face, direction tilted `angle` from the member axis towards the receiving member.
   - **Length `'auto'`:** the smallest catalogue length for this type and diameter that is ≥ `t + penetration` and does not exit the target. If none exists, warn and round up to 10 mm.
   - **Checks from `checks`**, each recorded as a warning with its numbers:
     - penetration ≥ `minPenetrationD`·d;
     - the fastener does not exit the target;
     - edge distance ≥ `minEdgeD`·d;
     - spacing ≥ `minSpacingD`·d;
     - for toe: the depth along n stays within the receiving member.
   - **Assembly note, not a warning:** "entry covered by topplate2: fasten before placing it" when another contact covers the entry point on the far face.
   - Warnings are gathered on the fastening. One `console.warn` summary is printed per `operations()` call.
   - **Evidence line**, e.g.: "stud3 (vertical 38×120) end on bottomplate (horizontal) side, 38×120 mm → stud-plate (joints#2); through, endRow ×2 inset 30; screw ⌀5 length auto → 90 (38 + 50)".
8. **Diagram** (~50): `detail: 'diagram'` (the default) draws, for each fastener:
   - `modeler.kernel().Curve.Circle(d/2, entry, n)`;
   - `Curve.Line(entry, entry + dir·L)`.

   Both go into one `modeler.group('fasteners')` per run, coloured grey. `drawn` keys each pair by a hash of its points, so a repeated `operations()` call or a `fasten()` pair is not drawn twice; a changed pair replaces its old curves. `detail: 'none'` draws nothing. `'full'` (holes and screw components) is reserved and throws "not yet available".
9. **Script API** (~160):
   - Functions: `contact`, `connections`, `fasten`, `operations`, `configure`, `config`.
   - Option schemas are validated, and the brep guard applies.
   - Pair keys come from a WeakMap id per shape.
   - The `FabOperations` class offers `members()`, `contacts()`, `fastenings()`, `fasteners()`, `warnings()`, `table(name, { by })` and `explain()`.
     - `table()` builds its rows through `modeler.modules.calc.table(name, rows, columns)`. The columns are joint, a, b, method, pattern, type, diameter, length, count, rule, status, plus a footer that sums count.
     - Status is `ok | warning | unmatched | none`.
10. **Explain** (~50): the header `Archiyou fab: fabrication from the model` (also the check-pack marker), then one block per member with its contacts and fastenings, then warnings and unmatched contacts.

**Size:**
- `Fab.ts` ≈ 1,300 LOC and `fab.json` ≈ 140 lines.
- Owning modules +105 LOC; tests ≈ 650 LOC.
- The main chunk grows by about 1.5 KB (the facade). The lazy Fab chunk is about 35 KB minified and loads only for scripts that use `fab`.

### Reused, not rewritten

- `meshFaces`, `newell`, `dot`, `sub`, `add`, `scale`, `cross`, `unit` from `modeler/exportGeometry.ts`.
- `MM_PER_UNIT` from `units/UnitConverter.ts` (book mm → model units).
- `Check` / `Errors` from `typebox/value` (pattern in `materials/MaterialManager.ts`).
- `Modeler.group()`, `kernel().Curve`, `modules.calc.table()`, and `shape.material()` (`BoundMaterial.name/.group`).
- The stick-ratio and direction logic mirrors `IFC4Exporter.deriveShape`/`directionOf`. The numbers live in `fab.json` (with a comment naming the IFC `TUNING` sibling), so IFC stays untouched.
- `overlapPerc()` for the overlap confirmation.

### Tests

`packages/core/tests/unit/modeler/fab.test.ts` (new, ~550). The setup is `new Modeler(); await load(); await loadFab(); setArchiyou({ modeler, calc: new Calc() })`.
- **Measure:**
  - 38×120×2400: stick, vertical, section [38,120].
  - 38×38×2400: long axis correct, which proves the face frame is not PCA.
  - Rotated 37°/20°: same result.
  - Sheet and block classification.
  - A ridge-cut stud: stick, vertical.
- **Contacts:**
  - Stud on plate: `end-side`, area 38×120, normal from plate to stud.
  - Gap 5: null, and `fasten` throws "gap 5.0 mm".
  - Overlap 10: no contact, one overlap warning.
  - Rotation invariance of contact and fastening.
- **Stud-plate default:** `joints#` rule, `endRow` ×2 at ±30 on the 120 side, entry on the plate's outer face, `fastener {screw,5,90}`, length source `auto`.
- **`make.wall(3000, 2400, 120, 38, 610)`:**
  - 2 × studs stud-plate fastenings;
  - every insulation piece is a fill with no fasteners;
  - zero unmatched.
- **Wall with the opening fixture from `make.test.ts`:** header-stud, stud-stud (2 staggered rows) and cripple stud-plate contacts are present; zero unmatched.
- **Ridge wall `{ height: 600, center: 0.5 }`:**
  - sloped-plate stud-plate contacts with an inclined normal;
  - entry points on the sloped outer face;
  - the apex is `end-end` with its note.
- **Doubled top plate:** the "entry covered" note.
- **Individual joints:**
  - King + jack 2400: count per the row formula, 2 rows.
  - Perpendicular plates: `cross` ×2.
  - Sheet on three studs: `edgePitch` on the edge studs, `pitch` on the middle stud.
- **Checks:**
  - `{screw,4,40}` on a 38 plate: penetration warning.
  - `method: 'toe'`: inclined directions; length 100 gives an exit warning.
  - Diameter 7 with `auto`: "no catalogue length".
- **Configuration layers:**
  - `configure` count 3 → source `run`;
  - an `operations` joints patch → source `call`;
  - `fasten` override → source `pair`, reused, drawn once.
- **Validation:** unknown pattern in a patched row, string fastener, and unknown option key each throw with the named hint.
- **Diagram:** circle count equals fastener count, centres at the entry points, radius d/2; `detail: 'none'` adds nothing; a second `operations()` call does not duplicate.
- **Guards and units:**
  - Brep mode throws.
  - `modeler.fab.fasten` without `loadFab()` throws the "await modeler.loadFab()" hint.
  - A `'cm'` modeler gives the same fastening, scaled.
- A GLB of the wall with diagrams is saved to `tests/outputs/modeler/fab-wall.glb` (gitignored) for visual inspection.

`packages/core/tests/unit/runner/runner.fab.test.ts` (new, ~90), in the style of `runner.ifc.lazy.test.ts`:
- A script runs `make.wall` + `fab.operations(wall)` + `ops.table('fastenings')` + `print(ops.explain())`. It must succeed, the messages must contain the explain header, and the scope's calc must have the `fastenings` table.
- `fab` used only inside a component is still loaded.

`packages/core/tests/unit/modules/ModuleRegistry.test.ts`: add a reserved `fab` case next to :156.

No cadscript is added: it would change `recipe.coverage.txt` and the slow `scad.roundtrip.txt` snapshots.

### Docs

Update `plans/FAB.md`:
- the phase list (Phase 0 = wiring; recipe gate, `asCuboid` extrusions and `btlx` moved to Phases 2 and 5);
- the face-based contacts;
- the fill rule;
- the joints table shape (`when` + per-method specs);
- the pattern list;
- the king/jack two-row correction.

### Verification

```bash
pnpm --filter @archiyou/core exec vitest run tests/unit/modeler/fab.test.ts tests/unit/runner/runner.fab.test.ts tests/unit/modules/ModuleRegistry.test.ts
pnpm --filter @archiyou/core test:make        # Make untouched, cheap insurance
pnpm --filter @archiyou/core test:ifc         # lazy-module neighbour
pnpm --filter @archiyou/core typecheck:budget # new src and test files count; must stay ≤ 156
pnpm --filter @archiyou/core build && pnpm --filter @archiyou/core check:pack   # Fab stays lazy, marker present
pnpm --filter @archiyou/ui exec tsc --noEmit  # completions edit
```

Then open `tests/outputs/modeler/fab-wall.glb` in a glTF viewer. Expect:
- two circles on the underside of the bottom plate under every stud;
- staggered rows on the king/jack pairs;
- nothing on the insulation.

Never run the whole core vitest suite at once. No commits unless asked.

### Risks

| Risk | Mitigation |
|---|---|
| Kernel polygons are not always convex | Ear-clip the non-convex pieces; test with an L-shaped extrusion. |
| Diagram curves show up in other exports (SCAD, DXF) | They are curves, not solids, so they do not change solids. `detail: 'none'` suppresses them. Documented. |
| The overlap check is expensive | `overlapPerc` runs only for pairs that pass the separating-axis test and have no contact. |
| Fill rule misfires, e.g. a 120 mm spacer block | `fillMinWidth` is configurable. The material group rule takes priority. Evidence names the rule. |
| Defaults are opinions | Every value reports its source and row id. `configure()` and the pair override exist, and the JSON is the single place to calibrate. |

## Review and decisions by the human

- **Scope** (answers in plan mode): the join of operations and norms is computed in core, and a sheet is the norm book; everything lives in `packages/core`; the first scope is stock and saw cuts, assembly fastening, sheathing and insulation, and BTLx export.
- **Plan corrections** (plan mode):
  - name the module `Fab.ts` and centralise there;
  - design `fab.fasten(a, b, options)` first, with automatic detection of how parts connect, a light diagram now and full detail (holes, screw components) later;
  - no `.is()` tags: contact detection must be automatic;
  - the norm book is internal first (a JSON file);
  - fasteners are objects (`{ type: 'screw', diameter: 5, length: 70 }`), never text like `'screw 5x70'`;
  - layout patterns follow from the joined types and are easy for people to configure;
  - write the plan to `plans/FAB.md`.
- **Go-ahead:** "Now please implement the first phases of the FAB plan" (phases 0 and 1), then "please continue" (phases 2 to 5 so far).
- **Go-ahead for the rest:** "please continue" (2026-09-16, 20:34) carried the work through phases 2 to 6, and "Ok finish the FAB plan" (2026-09-18) closed it with an example script in the local library.
- **Two deviations reported for the human to judge:** `est.export()` was not built, because the spreadsheet module fills named cells and not tables; and the holes of fasteners are data rather than cuts in the model, because the mesh kernel traps on some of those cuts and they changed the next fastening layout.
- **Not yet reviewed:** the human has not yet run or reviewed phases 2 to 6 as of 2026-09-18.
- **Standing rules** the agent followed: no commits unless asked; never the whole core test suite at once; no new files for minor things; object script APIs without `await`; `packages/meshup` left alone (it holds the human's uncommitted work).

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (none yet) | | |

Nothing is committed yet: the human asks for commits themselves, and this unit's work is still in the working tree. The commits get made with `pnpm commit:ai` against this record, and this table is filled then.

## Design document (plans/FAB.md, copied 2026-09-18)

### Fabrication operations + estimation from Recipes

#### Context

Recipes (`packages/core/src/modeler/Recipe.ts`) already record *how* every shape was built: primitives, transforms and booleans, resolved into a node tree that the FreeCAD, OpenSCAD and IFC exporters map procedurally. The same record describes what a workshop has to do: a `box` leaf is a member taken from stock, a planar `cut`/`common` at a member end is a saw cut (square or angled), a cylinder tool is a drilling. What the recipe cannot know is the non-geometric side: which stock length the piece comes from, how pieces are joined, and how long each step takes.

Goal: derive a **fabrication operations list** from the model, combine it with a **human-owned norm book** (joint rules, fastener catalogue, times, rates, stock), and produce **traceable estimates** of production time, stock, waste and cost, plus a **BTLx** file from the same operation records. Reference case: the stick-frame wall (`packages/core/tests/cadscripts/scripts/timberwall.js`, built by `Make.wall()`), which today prices labour with two literals and hand-counts screws.

Decisions taken with the user (2026-09-16):
- The ops × norms join is computed **in core**. The norm book is **internal first**: one JSON file `modeler/fab.json` next to `Fab.ts`, imported like `materials/materials.json`. A Google Sheet through `cloudcalc` is a later data source with the same row shapes.
- Everything lives in **packages/core**, centralised in `modeler/Fab.ts`. Only the BTLx writer is a separate exporter file.
- **No tags, no `.is()`.** Members, sheets, bay fillers, joints and roles are inferred from geometry, recipes and **automatic contact detection**; materials come from `shape.material()`; names are only a hint.
- **Fasteners are structured records**: `{ type: 'screw', diameter: 5, length: 90 }`, never a string. The catalogue lists types with diameter and length.
- **Fastening uses named layout patterns** (a handful of documented pattern functions in code) selected per joint kind by a **human-editable joints table** in the JSON, overridable per run with `fab.configure()` and per pair with `fab.fasten(a, b, options)`.
- `fab.fasten()` and contact detection come first. A lightweight diagram (circles on the drill plane) is the default representation; a high-detail mode (holes cut, screw as component) is designed but deferred.
- First scope: stock + saw cuts + 1D stock allocation; fastening; sheathing + insulation ops; a real `btlx` output format.

#### Research: comparable approaches

| Approach | What it does | What we take from it |
|---|---|---|
| **BTLx** (design2machine; exported by Cadwork, hsbCAD, SEMA, Dietrich's, Tekla; read by Hundegger, Weinmann) | Machine-agnostic XML: `Project > Parts > Part` (SingleMemberNumber, OrderNumber, Designation, Material, Count, Length/Height/Width) with per-part `Processings` (JackRafterCut, DoubleCut, Drilling, Lap, Mortise, Tenon, Slot, Pocket, FreeContour, Text). Operation-based, not toolpaths. | The operation vocabulary and part attributes. Our ops list is a superset (adds non-machine ops: fasten, sheathe, insulate). |
| **compas_timber** (ETH Gramazio Kohler, open source) | One `BTLxProcessing` class per operation: `ATTRIBUTE_MAP` (param → XML attr), `from_plane_and_beam()` (geometry → params), `apply()` (params → cutter → boolean), a features list per Beam, `BTLxWriter`. Joints are found by a topology solver over beam pairs (L, T, X). | "An operation is a parameter record that renders to both geometry and a file", and joints found from topology rather than declared. Recipes give the geometry→params direction for free. |
| **STEP-NC** (ISO 14649) | Workingstep = manufacturing feature + operation + tool + technology. | The row shape of an operation. |
| **IFC 4.3 construction management** | `IfcTask` × `IfcConstructionResource` (labor, material) with productivity: quantity × rate → `ScheduleWork`. | The estimate join model; a future IFC schedule export. |
| **aPriori, SOLIDWORKS Costing** | Feature recognition on dumb geometry → geometric cost drivers → cost. Live during design. | The UX (cost updates while you drag a param) and the split "geometry drivers vs. plant rates". **Our advantage:** construction history means no recognition for recorded shapes. |
| **CAPP** literature | Feature recognition → operation sequencing from a knowledge base; rule *tables* are the industrial norm. | Keep rules declarative and inspectable: a JSON table, not code. |
| **Holzrahmenbau Planzeiten** (Bund Deutscher Zimmermeister, Zeittechnik-Verlag) | The German standard time book for timber-frame wall production: times per m², per running metre, per partial work step; REFA/MTM-UAS method. ~0.6–0.9 h/m² for a plain wall element. | The norm book is an artefact estimators already own and trust; mirror its structure. Use as a sanity band for totals. |
| **MTM-UAS** | Predetermined times for batch work (fasten, mark, assemble). | Per-fastener time granularity is standard practice. |
| **IRC Table R602.3(1) fastening schedule; Eurocode 5 §8** | Prescriptive framing fastenings: stud to plate 2 end nails through the plate (or 3 toe nails), doubled top plates at 16 in (406 mm) on centre, sheathing 6 in edges / 12 in field. EC5: threaded point-side penetration ≥ 6d, minimum spacings and edge distances in multiples of d, end-grain fasteners not counted for lateral loads. | The default joints table and the sanity checks. |
| **OpenCutList** (SketchUp, open source) | Material types carry standard stock sizes and prices; parts list → cut diagrams → cost report. | Stock catalogue per section with lengths and price per m. |
| **1D cutting stock** | First-fit decreasing with kerf is the workshop standard and lands within a few % of optimum. | Stock allocation, ~40 LOC, deterministic and explainable. |
| **WikiHouse** | Costing by machine time per sheet plus material. | Sheet-goods op: time per sheet + per cut-out. |
| **5D BIM / IFC-based estimation** | Quantities from the model, rates from an external cost DB; "who owns the rates" is the recurring pain. | Rates stay outside the geometry, versioned, owned by the estimator; version embedded in every output. |

#### Feasibility

**Feasible; most plumbing exists.**
- Recipe classification (`classify()`, `ClassificationRule`, namespaced tags with `params` + `evidence`, `RecipeReport`, `explainNode`) is designed for this and tested, but has no production rules yet.
- `Make.wall()` builds studs as plain boxes (Make.ts:525-546), trims ridge studs with `_intersection(prism)` (Make.ts:578-595, a `common` with an `extrude` tool), and cuts opening verticals with `subtract(plates)`. Angled and shortened end cuts are derivable today. Coverage: `timberwall` 13/13 procedural; `timberwallopenings` 27/40 (cripples baked by `split()` at Make.ts:798, insulation by `_separateSolids()`).
- Contact detection works on the planar faces of each solid: `meshFaces()` (`modeler/exportGeometry.ts`) returns the kernel's polygons, so angled cuts and sloped plates need no special case. `obbox()` is only a fallback for round shapes: it is PCA and arbitrary for square sections, and recipes exist only in runs that export fcstd/ifc/scad. Diagram geometry: `Curve.Circle(radius, center, normal)` (`packages/meshup/src/Curve.ts:389`).
- The IFC classifier (`IFC4Exporter.ts:699-723`, `deriveShape`) already proves "roles from geometry, names as hints": every solid is measured into `stick | board | block` from sorted extents, with long/thin axes, direction and a fill ratio. Fab follows the same principle with contacts instead of hosts.
- JSON data imports are established: `import materialsDb from './materials.json'` (`materials/MaterialManager.ts:23`, `resolveJsonModule` on).
- `calc` already has `MetricName` values `cost_material`, `cost_labor`, `production_time` (`calc/types.ts:33`); `Make.partList()` classifies beam/plate by OBB ratios; `make.pack()` nests with kerf and reports waste.
- Lazy loading and pre-run detection patterns exist: `loadIFCModule()` (Modeler.ts:55-61) and `Runner._loadIFCWhenUsed` (Runner.ts:742-746).

**Gaps:** recording is gated on output formats; no contact, stock or fastener notion anywhere; no BTLx writer (dead `brep/Beams.ts:BeamSawCut` is scheduled for deletion by `plans/JOINERY.md`); `cloudcalc` (later phase) has fixed-shape inputs, so an ops table can only be exported as xlsx, not pushed into a sheet.

#### Pros and cons

**Pros**
- Fully automatic for framed structures: members, cuts, contacts, fastenings, sheets and bay fillers come from geometry and recipes, with readable evidence per item. No labelling work scales with model size.
- Configuration is data a carpenter can read: a joints table (which pattern, which fastener, which pitch), a fastener catalogue, time norms, stock. Same row shapes later in a sheet.
- One operation record feeds the estimate, BTLx, and later IFC tasks and the joinery module.
- Param sweeps give live time/cost feedback in the configurator at no extra modelling effort.
- Offline testable: the JSON book is the fixture.

**Cons / risks**
- Automatic inference can be wrong on unusual geometry (skew contacts, near-cubic members, interpenetration). Every inference reports evidence; overrides exist per pair and per joint kind; overlaps and crossing fasteners are reported, never hidden.
- Recording wraps every kernel method; only on for scripts that use `fab` (or request `btlx`).
- Baked shapes get an OBB member with *assumed* square cuts, flagged.
- The JSON defaults are opinions until a workshop calibrates them; every number carries `source` and `confidence`, and "unmatched" is visible, never zero.


---

### Design and status

| Phase | What | Status |
|---|---|---|
| 0 | `fab` global: lazy module, facade on the Modeler, Runner loading, reserved name, pack check, editor completions | done 2026-09-16 |
| 1 | Norm book (`fab.json`), measuring from faces, automatic contacts, joint rules, layout patterns, fastenings with checks, diagram, tables, explain | done 2026-09-16 |
| 2 | Part operations: saw cuts from the end faces, confirmed by the recipe; drillings and notches from recipe tools; sheathe and insulate ops; cut list | done 2026-09-16 |
| 3 | `Make.wall()` hygiene: procedural cripples, the 1 mm jack/insulation overlap | done 2026-09-16 |
| 4 | Estimate: time norms, stock allocation, costs, metrics | done 2026-09-16 |
| 5 | BTLx export: parts, angled cuts, drillings; `default/model/btlx`; editor menu | done 2026-09-16 |
| 6 | Norm book from a sheet (`fab.normBook()`), dead brep code removed, full-detail fasteners and fastener holes, `est.compare()` with actuals | done 2026-09-16 |

#### As built: phases 0 to 6

##### Files

| File | What |
|---|---|
| `packages/core/src/modeler/Fab.ts` | The module, in numbered sections: types, book, measure, contacts, joints, parts, patterns, fastenings, diagram, script API, estimate, explain. Loaded on demand; imports `exportGeometry`, `Recipe`, `UnitConverter` and `fab.json`. |
| `packages/core/src/modeler/fab.json` | The norm book: `version`, `about` (the documentation for people editing it), `measure`, `checks`, `fasteners` (with prices), `rates`, `times`, `stock`, `joints`. |
| `packages/core/src/modeler/brep/` | `Beams.ts` and `MakeOperations.ts` removed with their references (`index.ts`, `types.ts`, the Beam guards in `typeguards.ts` and `inputSchemas.ts`); the MakeOperations header is kept in `plans/JOINERY.md`. |
| `packages/core/src/modeler/Recipe.ts` | Two generic helpers: `toolOpsOf()` (which boolean each primitive is a tool of) and `leafPlanes()` (the flat faces of a primitive, outward). |
| `packages/core/src/modeler/BTLxExporter.ts` | BTLx 2.3 writer (phase 5), loaded on demand; reads `operations()`. |
| `packages/core/src/modeler/Make.ts` | `wall()`: cripples built with `box()` (trimmed by the ridge when there is one); insulation cut exactly around king and jack studs. |
| `packages/core/src/modeler/Modeler.ts` | `loadFabModule()`, `loadFab()`, `get fab()` (one stable forwarding object), `_fabState` dropped in `reset()`, `toBTLx()`. |
| `packages/core/src/runner/Runner.ts` | `fab` in the scope next to `make`; `_loadFabWhenUsed()` on both run paths (regex `fab.x(` over script and component code); recipes are recorded for runs that use `fab`; `case 'btlx'`. |
| `packages/core/src/constants.ts`, `src/execution/types.ts` | `btlx` is a model output format that records recipes. |
| `packages/core/src/modules/ModuleRegistry.ts` | `fab` reserved, so a script module cannot shadow it. |
| `packages/core/buildscripts/check-pack.ts` | Fab.ts and BTLxExporter.ts must stay out of the eagerly loaded chunks (markers: the explain header, the BTLx schema URL). |
| `packages/core/package.json` | `src/**/*.json` published (materials.json was missing too); `test:fab`. |
| `packages/ui/src/editor/completions.ts` | `fab` and its methods (with `normBook`) in autocomplete. |
| `packages/ui/src/editor/main-menu-file-menu.ts`, `apps/editor/src/pages/editor.ts`, `apps/editor/src/services/fulfillment.ts` | Export to ▸ BTLx (timber); `.btlx` as `application/xml`; a `default/model/*` wildcard leaves BTLx out. |
| `modules/archiyou-modules/cloudcalc/DOCS.md` | A worked example: the norm book in a sheet. |
| Tests | `tests/unit/modeler/fab.test.ts`, `tests/unit/runner/runner.fab.test.ts`, `tests/unit/modeler/btlx.test.ts`, `tests/unit/runner/runner.btlx.test.ts`, helper tests in `recipe.test.ts`, a reserved-name case in `ModuleRegistry.test.ts`, a completion case in `packages/ui/tests/component-completions.test.ts`, a wildcard case in `apps/editor/tests/fulfillment.test.ts`; `tests/cadscripts/recipe.coverage.txt` and the house fixtures (`tests/fixtures/house/`) refreshed. |

Size: `Fab.ts` about 3,850 lines (a third is types, schemas and validation), `fab.json` 190 lines, `BTLxExporter.ts` about 400 lines, tests about 1,730 lines; 1,718 lines of dead brep code went. The lazy Fab chunk is 138 KB unminified, 37 KB gzipped (Recipe.ts stays in its own shared lazy chunk); the BTLx chunk adds 11 KB (4 KB gzipped) and shares the Fab chunk. The main chunk grows by the facade and `toBTLx()` only.

##### Script API

```js
ops = fab.operations(wall)                          // every touching pair -> joint -> fastening, diagram drawn
ops = fab.operations(wall, { joints: { 'stud-plate': { method: 'toe' } }, detail: 'none', tolerance: 1, hidden: false })
ops.members(); ops.contacts(); ops.fastenings(); ops.fasteners()   // fasteners(): [{ type, diameter, length, count }]
ops.warnings(); ops.explain(); ops.toJSON()
ops.table('fastenings')                             // one row per contact, footer: count sum + norm book version
ops.table('fasteners', { by: 'fastener' })          // totals per fastener
ops.list()                                          // every operation: saw cuts, drillings, notches, sheathe, insulate, fasten
ops.parts()                                         // the cut list: equal parts counted together
ops.table('cut list', { by: 'part' }); ops.table('ops', { by: 'operation' })
ops.holes()                                         // the fasteners' holes per part, for pre-drilling
ops = fab.operations(wall, { detail: 'full' })      // each fastener as a part (shank + head) in the 'hardware' group

est = fab.estimate(ops, { area: 7.2, checks: { hoursPerM2: [0.5, 3] } })
est.hours; est.labour; est.material; est.total; est.complete; est.lines; est.stock
est.warnings(); est.explain(); est.metrics()        // production_time, cost_labor, cost_material
est.table('time'); est.table('material', { by: 'stock' })
cmp = est.compare({ hours: 16, minutes: { sawCut: 70 }, note: 'wall W1' })
cmp.rows; cmp.calibrations; cmp.warnings(); cmp.table(); cmp.explain()
fab.configure({ times: [cmp.calibrations[0].row] })  // the next run uses the calibrated row

fab.contact(a, b)                                   // Contact | null
fab.connections(shapes)                             // Contact[]
f = fab.fasten(a, b, { count: 3 })                  // per pair; later operations() use it and do not draw it twice
fab.configure({ joints: { 'stud-plate': { count: 3 } }, fasteners: [{ type: 'screw', diameter: 5, lengths: [100], prices: [0.1] }],
               rates: { labour: 55 }, times: [{ op: 'sawCut', unit: 'cut', minutes: 0.8 }], stock: [...] })
fab.normBook({ joints: wb.table('joints'), times: wb.table('times') }, { name: 'norms', version: '2026-10' })
fab.config()                                        // the book in effect, with the source of every value

modeler.toBTLx({ name, version, timestamp, holes })  // or the output default/model/btlx
```

Unknown option keys, a fastener written as text, an unknown pattern or joint name are errors that say what to write instead. A refused `configure()` changes nothing. Brep mode is refused. Every run starts from `fab.json` again.

##### Measuring

A part is measured from its planar faces, not from a PCA box and not from its recipe:
- **Axes:** the normal of its largest faces, the normal of the largest faces square to those, and their cross product. Exact for any sawn section, square ones included, and for cut or sloped members.
- **Kind:** `stick`, `sheet` or `block` from the sorted sizes and the `measure` ratios (the IFC classifier's, with a section aspect of 8 so a 38×235 stays a stick).
- **Direction:** `vertical`, `horizontal` or `sloped`. A sheet takes the direction of its plane.
- **Fill:** a part is a `fill` (never fastened) when its material group is in `fillMaterialGroups`, its name contains a word from `fillNames`, or it sits between two parts on opposite faces and is at least `fillMinWidth` across. Insulation from `make.wall()` is recognised by the sandwich rule and by its name.
- **Name:** only a hint. A name that says otherwise than the geometry (a lying "stud") is reported; the geometry decides.

##### Contacts

Two parts touch where an outward face of one lies on an opposite face of the other within `contactTolerance`; the overlap is clipped from the convex face pieces. The contact knows the roles of both faces (`end`/`side` for sticks and blocks, `face`/`edge` for sheets), the part that enters (the one that ends on the other, or the sheet, or the thinner one), the normal from the receiving into the entering part, in-plane axes and the overlap. Parts whose boxes overlap without touching faces are confirmed with `overlapPerc()` and reported with the depth ("overlap by about 1 mm").

##### Joints: the rules

`fab.json` `joints` is read top to bottom; the first row whose `when` holds decides. A row has a `when`, a default `method` (`through`, `toe`, `none`), a layout per method it supports, optional `covered`, `note`, `source`, `confidence`. `when` tests `contact`, `kinds` (unordered pair, `'stick|block+stick|block'`), `relation`, `entering`, `receiving`, `direction`, `section`, `thickness`, `material`, `name`, with the condition grammar `a|b`, `!=a`, `>30`, `<=12`, `20-40` and `*`. A contact without a matching row is `unmatched`: a warning, never silence.

Default rows: `fill`, `sheet`, `stud-plate`, `header-stud`, `rafter-plate`, `stud-stud`, `plate-plate`, `cross`, `end-end`, `sheet-edge`, `sheet-sheet`. Short framing pieces (a 400 mm cripple on a 200 mm section measures as a block) are covered by `stick|block`.

Changes stack, and every value remembers where it came from: `book` (fab.json), `run` (`fab.configure()`), `call` (`operations()` options), `pair` (`fab.fasten()`), `auto` (computed), `default` (pattern default). Layout keys given directly (`{ count: 3 }`) change the layout of the method in use; `{ method: 'toe' }` switches it; a list of rows in `configure()` is read before the book.

##### Patterns

Code, few and documented (`PATTERNS` in Fab.ts); the rows choose and tune them:

| Pattern | Layout | Defaults |
|---|---|---|
| `endRow` | `count` across the end of a member, `inset` from its sides | count 2, inset auto (max(3d, width/4)) |
| `row` | along the contact at most `pitch` apart, `end` from both ends, 1 or 2 staggered rows (2 from `rowsAutoFrom` wide); a contact shorter than 2 × `end` gets one per row in the middle | pitch 400, end 50, rows auto, rowsAutoFrom 80 |
| `corners` | 1 in the middle, 2 on a diagonal, 4 in the corners, `edge` in | count 2, edge 25 |
| `sheet` | along each framing member under a sheet, `edgePitch` within `edgeZone` of the sheet edge, `pitch` in the field | 300 / 150 / 50, end 15 |
| `toe` | `count` places across the width taken by the two wide faces in turn, at `angle` from the axis, `start` from the contact | count 2, angle 30, start length/3 |

The default rows keep fasteners that share a part apart: stud-plate at 30 from the edges of a 120 section, header-stud at 45 (±15), toe at 20 (±40), face rows 100 from the ends (the end screws reach 50 into the studs).

##### Fastenings

- **Through** fasteners enter on the far face of `from` (the receiving part for end contacts, the sheet, or the thinner part; with equal parts the one whose far face is free). Into end grain they are driven along the entering part, so a stud under a sloped plate is screwed along the stud; otherwise square to the contact.
- **Toe** fasteners enter the wide faces of the entering part, inclined towards the receiving part.
- **Length `auto`:** the shortest catalogue length of that type and diameter that reaches `penetration` without coming out of the far side (`minCover`); otherwise the longest that stays inside (with a note); no catalogue entry: a warning and a computed length.
- **Checks** (warnings): penetration ≥ `minPenetrationD`·d, the fastener does not come out of the target, the tips end inside the target, edge distance ≥ `minEdgeD`·d, spacing ≥ `minSpacingD`·d, toe reach inside the receiving part, and **crossings**: fasteners of different joints (or the toe fasteners of one joint) that run into each other.
- **Assembly notes:** "entry covered by X: fasten before placing it" when another part covers an entry (fills do not count; insulation goes in later).
- **`covered: 'toe'`:** two parts that end on opposite faces of one part at the same place (a jack above and a stud below a header) block each other's through fasteners. For rows that say `covered: 'toe'` and where nobody chose the method, the later of the two is fastened toe-wise, with a note naming the other part and the rule. `covered: 'keep'` leaves both, and the crossing check reports them.
- **Evidence** per fastening, e.g. `stud0 (stick, vertical 38x120) end on bottomplate (stick, horizontal 38x120) side, 120×38 mm → stud-plate (joints#2); through bottomplate, endRow ×2, inset 30; 2× screw ⌀5 length auto → 90 (38 through + 50 into stud0)`.

##### Diagram and full detail

- `detail: 'diagram'` (default) draws a circle of the fastener's diameter on its entry face and a line along it, grey, named `fastener`, in one `fasteners` group per run.
- `detail: 'full'` (phase 6) makes each fastener a part: a shank cylinder of its diameter and length, and a head cylinder of twice the diameter. A through fastener's head is sunk flush; a toe fastener's head sits on its sloped entry. The parts are named after the type (`screw`, `screw head`), are Cylinders (so IFC reads them as fasteners), live in one `hardware` group, and are left out of every later `operations()`.
- `detail: 'none'` draws nothing.
- A repeated call, or a `fasten()` pair, is not drawn twice (the layout is hashed, rounded, with -0 made 0). A changed layout or detail replaces what was drawn.
- **The parts are not cut.** The holes are data: `ops.holes()` gives one `drilling` per fastener per part it goes into (through the part it is driven from, blind into the other), with `fastener` naming the joint. They are not in the parts' `ops`, so the cut list and the estimate do not count them twice. Cutting them into the mesh was built and dropped: the mesh kernel traps (`unreachable`) on a tilted recess next to a hole (toe screws, screws into sloped plates), a ridge wall took 17 s and then 52 s, and the cut faces changed the next layout. A kernel that cuts reliably (brep) could bring the holes back as geometry.

##### Part operations (phase 2)

Every stick and block gets its operations in `member.ops`, sheets a `sheathe` op, fills an `insulate` op:
- **Saw cuts come from the end faces**, so they exist with or without a recipe. An end face must reach the tip of the part; an end-facing face short of the tip is the shoulder of a notch. One face is a `square`, `angled` or `compound` cut, two faces a `double` cut; `angle` is the cut seen on the wide face, `inclination` on the narrow face, 90 is square. More faces at an end: `unknown`, reported.
- **The recipe confirms each face.** Runs that use `fab` record recipes. When a part has one, every end face is matched to a face of a primitive (`leafPlanes()`): the cut is `derived`, with the primitive that made it ("the end of the box as drawn", "the common with an extrude"). A face no primitive explains is a warning: recipe and geometry disagree. Without a recipe (or a baked one) cuts are `measured`, and the part says so (`member.recipe`, `recipeNote`).
- **`FAB_RULES`** (Recipe's `classify()` with a `fab:` namespace) say what each primitive did: `fab:blank` (the part is made from it), `fab:drilling` (a round cylinder cut into the part through a face: diameter, depth, through or blind, face, position, tilt), `fab:cut` (its face is an end of the part), `fab:notch` (it leaves faces inside the part's box), `fab:idle` (it does not reach the part, like the plates the opening verticals are cut against, or it is a common that keeps all of the part, like the ridge outline around a low jack stud), `fab:unknown` (anything else).
- **Facets of holes** lie on a curved tool and are explained by it, so they are neither ends nor notches.
- **Without a recipe**, faces inside the part's box are reported as a notch, lap, rebate or hole that is not recognised.
- **Cut list:** `ops.parts()` counts equal parts together (kind, section, length, material, cuts, drillings, notches; a part reads the same both ways round), with `origin` `derived` only when every part in the line had a recipe.
- **Fill thickness** is taken square to the parts a fill sits between, so a narrow bay is still a full wall deep.

##### `Make.wall()` (phase 3)

Cripples are boxes with the old split pieces' bounds (the top ones trimmed by the ridge solid under a ridge), so they keep a recipe. They are made with `box()`, which marks them `Box` like the studs (meshup's `BoxBetween()` does not); `tests/cadscripts/recipe.coverage.txt` went from 27 to 31 procedural solids of 40 for `timberwallopenings`, and `split()` no longer appears. The insulation next to an opening is cut exactly around the king and jack studs, so the 1 mm overlap with the jacks and the 1 mm gap to the kings are gone, and those bays are recognised as fills between two parts. The house fixture (`ifc.house.test.ts`) was refreshed for this: the insulation pieces beside openings moved by 1 mm, and every class stayed the same.

##### Estimate (phase 4)

`fab.estimate(ops, { area?, checks?: { hoursPerM2 } })` reads times, stock, rates and prices from the book in effect (joints as the operations saw them):
- **Time:** every operation (plus a `handle` per stick or block) takes the first `times` row whose `op` and `when` hold. Units: handle and notch per part, sawCut per cut, drilling per hole, fasten per fastener plus `setup` once per joint, sheathe and insulate per m². Lines are grouped by operation, row and what (`sawCut angled`, `fasten through screw ⌀5×90`), with quantity, items, minutes and labour at the book's rate.
- **Bars:** sticks and blocks, grouped by section and material, are cut first fit decreasing from the longest `lengths` with the `kerf` between pieces; each bar is then shortened to the shortest length that holds its pieces. Lines per stock length carry the cutting plan (`cuts`), used and wasted mm, reusable `offcuts` (≥ `minOffcut`) and the cost. A piece longer than every length is reported.
- **Sheets:** whole stock sheets count one each; the area of cut sheets plus `wastePct` is divided by the sheet area.
- **Fills:** volume plus `wastePct` at `pricePerM3`. **Fasteners:** count × catalogue price.
- **Trust:** every line names its row (`times#3`, `stock#1`, `fasteners#3`, `run1.times#0`), source and confidence. An operation without a time row, a part without stock and a fastener without a price leave that line blank (never zero), make `est.complete` false and are listed in `warnings()`. Lines using `placeholder` values are counted in a warning. `hoursPerM2` with `area` checks the total against a band.
- **Outputs:** `est.table()` (time) and `est.table(name, { by: 'stock' })` with sum footers labelled with the book version; `est.metrics()` sets `production_time` (h), `cost_labor` and `cost_material`, labelled with the book version and "incomplete" when it is; `est.explain()`.

The default `rates`, `times`, `stock` and fastener prices are **placeholders**, marked as such in fab.json, and every estimate says so until a workshop replaces them.

##### BTLx export (phase 5)

`modeler.toBTLx({ name, version, timestamp, tolerance })` and the output path `default/model/btlx` write BTLx 2.3 from `operations(…, { detail: 'none' })`, so the file holds exactly the parts, cuts and drillings the cut list and the estimate see. A script does not need to call `fab`: the export loads it, and the run records recipes.

| fab | BTLx | How |
|---|---|---|
| stick, block, sheet | `<Part>` | `Length` along the part, `Height` its larger section size (a sheet's thickness), `Width` the other; `<Transformation>` with the corner as `ReferencePoint`; directions written to 9 decimals, since 3 turn the far end of a 1.6 m sloped plate 0.8 mm |
| equal parts | one `<Part>`, `Count` and a `<Transformation>` per piece | equal when kind, size, material, designation and every processing match in the part's own frame |
| `sawCut` square | none | carried by `Length` |
| `sawCut` angled or compound | `<JackRafterCut>` on reference side 1 | `Orientation`, `StartX` on the reference edge, `Angle`, `Inclination` as compas_timber computes them |
| `sawCut` double, pointed (convex) | two `<JackRafterCut>` | each trims what lies beyond its plane |
| `sawCut` double, V into the end | not written | reported |
| `drilling` | `<Drilling>` on the side it enters | `StartX`, `StartY`, `Angle`, `Inclination`, `DepthLimited`, `Depth`, `Diameter` |
| notch, unknown | not written | reported |
| fill, fastening | not written | counted |

- **Header and report:** a comment line with the summary, one comment per thing not written, and the same in `Modeler::toBTLx()`'s console line. Nothing is left out silently.
- **Stable files:** GUIDs are hashed from the project, the part name and which piece of that name it is; `timestamp` fixes the date. The same model gives the same file.
- **Designation** is the name without its number (`stud0` → `stud`); unnamed parts are called by their kind. `Annotation` lists the pieces.
- **Editor:** File ▸ Export to ▸ BTLx (timber). A `default/model/*` fulfillment does not include BTLx: it only means something for timber models, and on brep it throws.
- **Verified by rebuilding:** `btlx.test.ts` turns every `JackRafterCut` and `Drilling` back into a plane or a line the way compas_timber reads them (`plane_from_params_and_beam`, `cylinder_from_params_and_element`) and requires them to land on the model's faces and drill axes: a ridge wall, a pointed stud, square, blind and tilted drillings, and the same beam turned by 37° and 20°. The files it writes (`tests/outputs/modeler/btlx.*.btlx`, `tests/outputs/runner/runner.btlx.shedwall.btlx`) were validated against the official `BTLx_2_3_0.xsd` with lxml: all valid.
- **Fastener holes:** with `toBTLx({ holes: true })` the `ops.holes()` drillings are written too, for pre-drilling; without it the header counts them. The test rebuilds each such drilling and requires it to lie on a fastener axis.
- **Later:** notches and laps (`Lap`, `Notch`), V ends (`DoubleCut`), `OrderNumber` and `Group` from the scene.

##### Norm book from a sheet (phase 6)

`fab.normBook(tables, { name, version })` replaces sections of fab.json for the run with tables, as cloudcalc's `wb.table(name)` gives them (one object per row, keyed by header). Core does not depend on cloudcalc: any rows work.
- **Tables:** `joints`, `fasteners`, `times` and `stock` replace those sections. `rates` is replaced whole, so a sheet rate never inherits fab.json's `placeholder`. `measure` and `checks` are merged. Settings tables are one row, or `key` and `value` columns.
- **Cells:** dotted headers nest (`when.contact`, `through.fastener.diameter`); list keys (`lengths`, `prices`, `size`, `fillMaterialGroups`, `fillNames`) are split on commas or semicolons; numbers written as text become numbers (except text keys like `joint`, `note`, `type`); `true`/`false` in `when` become booleans; a cell starting with `[` or `{` is read as JSON; empty cells and `//` columns are left out.
- **Names and trust:** rows are named `norms.joints#0` (the first row under the header; blank rows keep their number), values have the source `sheet`, `config().about.book` says which sections came from where, and `version` labels every table, metric and file. A mistake names the table and row (`norms times#1: a sawCut is timed per cut, not per part`) and nothing of that book is used.
- **Order:** call it before `fab.configure()`; changes go on top. A second call stacks (`version` becomes `a + b`). The `covered: toe` rule treats sheet rows like book rows.
- `est.export(wb, name)` from the plan was not built: cloudcalc fills named inputs, not tables. The totals go into a sheet by name (`offer.fill({ hours: est.hours, ... })`) and the lines leave as `est.table()` (xlsx output). The worked example is in cloudcalc `DOCS.md`.

##### Actuals (phase 6)

`est.compare(actuals)` holds what a job took against its estimate. Actuals: `hours`, `labour`, `material`, `total` (book currency), `minutes` per operation, `tolerance` (default 0.1), `note`.
- **Rows:** estimate, actual, difference and ratio (from unrounded values), a verdict (`on target`, `estimate low`, `estimate high`, `not estimated`) and the book rows behind the number.
- **Calibrations:** for every operation with booked minutes that is off, each time row it used, scaled by the ratio, as a ready row (`source: 'actuals'`, `confidence: 'measured'`) for `fab.configure({ times: [...] })` or the book. The test runs that loop and gets the booked minutes back.
- **Warnings:** an incomplete estimate; hours off without minutes per operation; material off (with the stock and price rows to check); a labour rate that differs from the book's; totals that do not add up; booked minutes above the booked hours.
- `cmp.table()`, `cmp.explain()`, `cmp.toJSON()`.

##### The example script (phase 6)

`fab_test` in the local library (owner `archiyou`) walks through everything the module does, in the order a script would use it: a framed wall from `make.wall()`, an optional workshop norm book given as sheet rows, `fab.operations()` with the fastener detail as a parameter, the fastening, fastener and cut-list tables, the estimate with its tables and dashboard metrics, a comparison against booked hours that prints the corrected time rows, and a note on exporting BTLx from the File menu. Its parameters cover the interesting cases: width, height, section depth, a window, a ridge, `diagram`/`full`/`none` fasteners, the workshop book on or off, and booked hours and sawing minutes. Every combination runs in about 0.1 to 0.3 s, and its BTLx output validates.

The source is kept only as that row. Putting it in `tests/cadscripts/scripts/` would add it to the cadscript run, the kernel parity run and the recipe coverage snapshot, which is churn this unit did not need.

##### Verified

- `test:fab` (75 tests: `fab.test.ts` 62, `runner.fab.test.ts` 3, `btlx.test.ts` 9, `runner.btlx.test.ts` 1): measuring, contacts, every joint and pattern, checks, configuration layers, validation, diagram, units, walls with openings, 32 mm stock and a ridge; cuts with and without recipes, angled and double cuts, through and blind drillings, notches with and without recipes, notches at an end, sheets, fills, baked parts, cut list and operation tables; the norm book from sheet rows (and fab.json's own rows as a sheet giving the same wall); full detail and fastener holes; a door wall without crossings; estimate times, first-fit-decreasing bars with kerf, sheets, fills, prices, run changes, incomplete estimates, tables, metrics and the hours per m² check; comparisons with actuals and the calibration loop; a script run records recipes and gets a derived cut list and the metrics.
- `test:scad` (95, with `recipe.test.ts`), `test:ifc` (62, house fixtures refreshed), `test:modules` (82), `test:brep` (96, after the dead code went), all runner tests (205), the ui completion test and the editor fulfillment tests (28): pass. `recipe.coverage.test.ts` passes with the refreshed snapshot. `build` and `check:pack` pass; Fab.ts is lazy.
- Drawings of the fastener placements (front, section, top views of the opening, header, sill and ridge) were checked by eye.

##### Findings on the way

- With 32 mm stock the default fasteners fail the penetration and edge checks. The checks are right; a workshop using 32 mm stock sets its own rows.
- `make.test.ts` "should keep the opening void clear when splitting studs" fails on the wall diagram not being dashed, before and after this work, so its void checks do not run; they were run separately against the new cripples and pass.
- The core type-error budget (156) is exceeded before and after this work (173, then 179 to 181 with other sessions' work); the fab and BTLx files add none.
- **Flaky contacts, fixed:** the kernel can return a face with one corner twice, a hair apart. The zero-length edge between the copies points anywhere, and the inside test rejected screws well inside the contact, depending on the run (the cripple under a sloped plate lost both screws in the first wall of a process). Near-repeated corners are now dropped, degenerate edges skipped, and the clipper's on-edge test scales with the coordinates.
- The house fixture now also records a few changed 2D lines at the model root. They come from uncommitted meshup Curve work (extend, cutoffBy, collinear merges), not from fab.
- **Door walls crossed:** above a door the king and jack studs touch for only 187 mm. The stud-stud row then shrank its end distance to 47 mm, into the 50 mm end screws from the top plate, and the crossing check reported 8 crossings. A row too short for its end distance now gets one fastener per row, in the middle; the door wall has no warnings.
- **Rounding signs:** a rounded -0 made a drilling unequal to 0 and a layout hash differ; both are normalised.
- The mesh kernel traps on some boolean cuts (see full detail); nothing in fab cuts parts now. `Mesh.BoxBetween()` does not mark its result a `Box`.
- Calc tables name columns by position, not by key: rows must be written in column order.

#### Next

- Notches and laps as BTLx processings; V ends as `DoubleCut`.
- Fastener holes as geometry once a kernel cuts them reliably.
- A norm book sheet for a real workshop, and calibration from its first jobs.
- The joinery module (`plans/JOINERY.md`) can build on the part operations and contacts.

#### Risks

| Risk | Mitigation |
|---|---|
| Inference wrong on unusual geometry | Face-based frames; evidence on every part, contact and fastening; overrides per pair, call and run; overlap and crossing reports |
| Many contacts on large scenes | Bounding-box sweep; the crossing check sweeps too |
| Opinionated defaults | Every value has a source and a row id; `about` in fab.json explains every key; `configure()` until the sheet phase |
| Diagram curves in other exports (SCAD, DXF) | They are curves, not solids; `detail: 'none'` leaves them out |
| Baked recipes | Cuts are measured from faces and marked `measured`; drillings and notches then show up as unrecognised inside faces |
| Area-based sheet counts | Marked as such in the evidence; a nesting step (make.pack) could replace them |
| Placeholder norms taken for real | Marked `placeholder` in fab.json, counted in every estimate's warnings |
| One large Fab.ts | Numbered sections; the estimate reads operations, not geometry |

#### Verification

```bash
pnpm --filter @archiyou/core test:fab
pnpm --filter @archiyou/core exec vitest run tests/unit/modules/ModuleRegistry.test.ts tests/unit/runner/
pnpm --filter @archiyou/core exec vitest run tests/unit/modeler/recipe.test.ts
pnpm --filter @archiyou/core exec vitest run --project cadscripts tests/cadscripts/recipe.coverage.test.ts
pnpm --filter @archiyou/core build && pnpm --filter @archiyou/core check:pack
pnpm --filter @archiyou/ui exec vitest run tests/component-completions.test.ts
pnpm --filter @archiyou/editor exec vitest run tests/fulfillment.test.ts
```

The example script: open `fab_test` in the editor, or re-import it from a folder holding the .js file:

```bash
cd apps/server && pnpm admin:import-cadscripts --dir <folder> --owner archiyou
```

Never run the whole core vitest suite in one go. `tests/outputs/modeler/fab-wall.glb` and `fab-wall-opening.glb` show the diagram. To validate a BTLx file against the schema: download `BTLx_2_3_0.xsd` with the `x3d-3.3.xsd` and `xmldsig-core-schema.xsd` it includes, then `python -c "import lxml.etree as e; s = e.XMLSchema(e.parse('BTLx_2_3_0.xsd')); print(s.validate(e.parse('file.btlx')), s.error_log)"`.
