# Fold-out view: plan with its elevations around it

| | |
|---|---|
| Dates | 2026-11-05 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: asked for the function and named it (`make.foldoutView`), asked for the study, wrote the prompts, reviewed the prototype render and the plan |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)
## `make.foldoutView()`: plan with its elevations folded out around it

### Context

Spec sheets often show a plan or horizontal section with the four elevations around it in a cross. `ur_house_sketch` builds this by hand in `docPipeline()` (about 50 lines: `elevation().moveTo().rotateZ().move()`, plus a boolean to fake the cut). It should be a standard `make` function that replaces that code and adds projection lines and automatic dimensions.

### Study: what the drawing is called and how it is drawn

**Name.** I found no single standard name for this cross layout. The related terms:

| Term | Field | Meaning |
|---|---|---|
| **Multiview orthographic projection** ("glass box" that gets unfolded) | Technical drawing | The formal name of the general method |
| **Projection group** | CAD (FreeCAD TechDraw; from memory, the page was blocked) | The feature in CAD software |
| **Épure**, double orthogonal projection | Stereotomy, Monge's descriptive geometry | Plan and elevation on one sheet, the horizontal plane folded about the *ligne de terre* |
| **Developed surface** (Robin Evans, on Adam and Lightoler) | 18th-century architecture | A room's *interior* walls folded out around its plan: a close relative, not the same drawing |

The name `foldoutView` stays, as you proposed: it says what you get, while "multiview" also covers an ordinary three-view sheet. The TSDoc names the other terms so a search finds it.

**Conventions that shape the design**
- **Alignment is the point.** The same feature in two adjacent views lies on one line perpendicular to the fold line. Every view is therefore placed by world coordinates, not by centring.
- **Two layouts.** Third-angle puts each view on the side it looks at, with the top of the building toward the plan. First-angle (ISO, Europe) puts it on the opposite side with the base toward the plan. `ur_house_sketch` already draws third-angle, so that is the default, and first-angle is one option.
- **Lines linking views** are "projectors" (FR: *lignes de rappel*). They are thin lines, and visible lines take precedence over them. ISO 128-24 gives dimension and extension lines a continuous narrow line. I could not confirm the rule for projectors, or any standard for extension-line gaps beyond ISO 129-1 permitting one. So the numbers below are defaults you can restyle, not standard values.
- **Dimensioning.** The convention I know is outside the views, each dimension once, and not crossing other extension lines (the last rule is from a secondary source). So dimensions sit in the gaps, and their feet land on the projection lines of the outline corners.
- **Cut height:** 1200–1500 mm in practice (from memory; your script uses 1500). There is no generic default for an arbitrary object, so a plain top view is the default and `cutHeight` asks for a section.

### What the prototype showed

I ran a scratchpad prototype on the real `ur_house_sketch` geometry (offer code removed).

1. **Placement works.** Using `toScreen()` plus rotation about the origin, a second world point landed on the same sheet coordinate in plan and view, with difference `0.000` in all four views. The render shows the correct cross.
2. **Bug: `section()` does not remove what is above the cut.** `project_edges_section_with_strategy` (`packages/meshup/rust/src/mesh/edge_projection.rs:425`) slices for the `cut` lines, then projects the edges of the *whole uncut mesh*. A floor plan at z=1500 therefore shows the roof outline and ridge. A probe box wholly above the cut shows up too, in all three paths: single mesh, merged, styled apart. This contradicts its own TSDoc ("project the geometry beyond the cut"), and it is probably why the script fakes the cut with a boolean.
3. **Dimensions do not follow a move.** After `.dim()` then `.move()`, `targetStart` stays put, and in the SVG the geometry moved while the dimensions stayed behind (`updatePosition` is never triggered; `TODO: AFTER REFACTOR FIX`). So placement must be known before dimensions are made, which is why there is an `at` option.
4. **Public `.elevation()` copies the model's 3D dimensions into the drawing**, such as the script's `.param('WIDTH')` lines (they appeared as extra 4000/5000 dimensions). Using `_elevation()` avoids that.

### API

```ts
make.foldoutView(shapes = all().onlyVisible().solids(), {
  cutHeight,                  // z of a horizontal section; left out: plain top view
  views: ['front','back','left','right'],   // any subset
  projection: 'third',        // or 'first'
  gap,                        // plan to view; default 20% of the largest plan side
  projectionLines: true,      // true | 'outline' | 'features' | false
  dims: true,                 // true | 'overall' | 'views' | false
  at: [0, 0],                 // where the centre of the plan lands
  hiddenLines, method, featureAngle,   // passed on (ProjectionOptions)
}) // => ShapeCollection, in the scene as one group
```

- **Result:** a group `foldoutView` with groups `plan`, `front`, `back`, `left`, `right`, `projectionLines` (one scene layer, like `make.frame()`). The source shapes are untouched.
- **`projectionLines`:**
  - `true` / `'outline'`: from the plan's outline corners that are visible from that side.
  - `'features'`: also the vertical edges of the elevation, like window jambs.
  - Each line starts on the outermost plan point at that coordinate and ends on the elevation's silhouette at the same coordinate, so it lands on a gable slope rather than on a bounding box. It keeps a small gap at both ends.
  - Class `projection`, so `styler.set('projection', { dash: [3, 2] })` works.
- **`dims`:**
  - `true` / `'overall'`: plan width and depth in the front and left gaps, and overall height on the front view. With a cut, the plan size is measured on the `cut` lines (the walls, without roof overhang).
  - `'views'`: also width and height on every elevation.
- **`.move()` caveat:** TSDoc tells users to use `at`, not `.move()`, because of finding 3.
- **Mesh kernel only:** uses `this.modeler`, which already gives a clear error in brep.
- **Lean:** a plain method with no dependency, no Runner scan and no dynamic import. Unused, it costs nothing.

### Steps

#### 1. Fix `section()` in meshup (a bug fix in its own commit)
`packages/meshup/rust/src/mesh/edge_projection.rs`:
- Clip mesh and occluders to the far half-space with the existing `Plane::split_polygon` (`mesh/plane.rs:330`). This avoids a boolean, so it avoids the BSP stack problem noted in `ur_house_sketch` (lines 548 and 564).
- Cap the open cut with the slice region so a wall's bottom edge cannot be seen through the opened wall. The exact cap method gets settled when testing this.
- Apply it to both `project_edges_section` variants, then rebuild with `pnpm build:wasm` from `packages/meshup`.

In `packages/meshup/src/ShapeCollection.ts` and `Mesh.ts`, split a scene-free `_section()` out of `section()`, mirroring `_elevation()`.

**This changes every existing section drawing** (the roof disappears from floor plans), which is the point. Existing section tests and `pipelines.md:73` get checked.

#### 2. Geometry helpers
New `packages/core/src/modeler/foldoutView.ts`, pure functions with no kernel:
- the placement table: view → rotation and side, per `projection`
- sheet transform and alignment offset
- `outermostAt(segments, coord, axis, direction)`
- the coordinate selection for projection lines

#### 3. `Make.foldoutView()`
In `packages/core/src/modeler/Make.ts`, with the options schema in `modeler/schemas.ts` (the TypeBox pattern at `schemas.ts:50`). It does the following:
- build the plan with `_section` or `_elevation('top')`, and the views with `_elevation`
- rotate about the origin, translate by alignment and gap
- add the lines with `modeler.line()` and `addClass('projection')`
- make dimensions with `annotator.dimensionLine(start, end, { offset, offsetVec })`, then `dim._planeNormalFixed` and `dim.link(...)`, the same way `DimensionLine.projected()` does (`annotator/AnnotatorDimensionLine.ts:864`)
- group with `modeler.group()`

Add `{ selector: '.projection', weight: 0.13, color: '#888888' }` to `STYLER_DEFAULT_RULES` (`docs/styler/Styler.ts:53`).

#### 4. Docs
- TSDoc on the method (template: `Make.ts:316`), with terms, options and examples, then `pnpm generate:api` and `pnpm generate:completions`.
- A "Fold-out views" section in `help/guide/en/modeling/pipelines.md`, after "How drawings look".
- One line in `packages/cli/skill/SKILL.md`.

#### 5. Replace it in `ur_house_sketch`
In `docPipeline()`, the block from `FLOOR_PLAN_PIVOT_POINT` to `floorplanWithDrawings` becomes:
```js
floorplanWithDrawings = make.foldoutView(allVisible, { cutHeight: 1500, at: [0, -DEPTH*2] });
```
The variable name stays, so the `doc` chain is unchanged, and `isoLeftFront` stays. Saved with `save-script.ts --new-version` (it prints the target database first).

⚠️ **Order matters.** The tunnel points at the shared database, and my notes say production was behind on drawing features as of today. A saved version calling `make.foldoutView` breaks the `techdraw` pipeline and the `spec` document on any server without this core. So I test the script locally and **save only after you confirm the deploy**. An editor tab holding the script open would also overwrite the save, so reload it first.

#### 6. Disclosure and commits
- Create the record `documentation/nlnet/ai/records/2026-11-05-foldout-view.md` when the plan is approved, and commit with `pnpm commit:ai`.
- Meshup (submodule) goes first, then core.
- Other sessions have uncommitted work in `Mesh.ts`, `ShapeCollection.ts`, `Styler.ts`, `Make.ts`-adjacent files and `pipelines.md`, so I commit only my own hunks through a separate `GIT_INDEX_FILE`.

### Verification

**`packages/meshup/tests/unit`:** section at z with a box wholly above the cut, and an overhanging mesh straddling it. Nothing above the cut in any group, in all three paths. `cut` unchanged, no wall-bottom lines inside the cut region.

**`packages/core/tests/unit/make/foldoutView.test.ts`**, on an asymmetric model:
- world points land on the same sheet coordinate in plan and each adjacent view, third and first angle
- each view is a rotation, never a mirror (as `projectionOrientation.test.ts`)
- `views` subset, `gap`, `at`
- projection-line ends on the silhouette, with a gap
- dimension values, `dims: false`, and no 3D model dimensions carried in
- classes reach the drawn lines
- source shapes unchanged and one scene group; an empty input gives a clear error

**Regression:** `pnpm test`, plus the meshup suite (`pnpm build:meshup` first, since the CLI reads meshup/dist).

**By eye:** `pnpm -s archiyou run` on a local copy of `ur_house_sketch`, rendering the real `spec` document (not just the raw SVG export, which ignores the styler). Check these:
- dimension text in the rotated views
- line weights
- a dimension crossing a projection line with `'features'`
- `-p ROOF_TYPE=shed` and the extremes of `WIDTH`, `DEPTH`, `HEIGHT`

### Left out for now
- Interior "developed surface" layout, where walls fold down with the inner face up
- Drawn fold lines (*ligne de terre*)
- The first/third-angle symbol
- Bottom view
- Making dimensions follow `.move()`: a general bug worth its own fix, since it affects every `.dim()`

### Sources
- [Multiview orthographic projection (Wikipedia)](https://en.wikipedia.org/wiki/Multiview_orthographic_projection)
- [Multiview layout notes, SFU](https://coursys.sfu.ca/2017fa-ensc-204-d1/pages/Multiview/view)
- [Multiview Layout and Orientation, UW](https://uw.pressbooks.pub/enggraphics/?p=28) (search excerpt only; the page itself was blocked)
- [Orthographic projection lecture, BUET](https://shuvo.buet.ac.bd/ME160/Lecture%202.pdf)
- [ISO 128-24 sample](https://cdn.standards.iteh.ai/samples/57099/67be8e32461446f1a410ce15e3aea7ff/ISO-128-24-2014.pdf)
- [FreeCAD forum on ISO 129-1 extension gaps](https://devtalk.freecad.org/t/dimension-extension-lines/60335)
- [Dimensioning rules, slideshow](https://www.slideshare.net/slideshow/introduction-of-technical-drawing-standard/128049466)
- [Ligne de rappel / ligne de terre, Univ. Annaba](https://factec.univ-annaba.dz/wp-content/uploads/2025/04/V7_-Support-de-Dessin-Technique-et-applications-2025.pdf)
- [Épures in stereotomy (Galletti, de L'Orme)](https://www.thinking3d.ac.uk/deL'Orme1567/)
- [Robin Evans's developed surface: Syon House (Drawing Matter)](https://drawingmatter.org/?p=26036)
- [Developed surface, Lightoler example (MIT 4.105)](https://ocw.mit.edu/courses/4-105-geometric-disciplines-and-architecture-skills-reciprocal-methodologies-fall-2012/de4a342bb10e21d06e4e9e630ec06a14_MIT4_105F12_lec5-stereo.pdf)

## Review and decisions by the human
- Asked to see the prototype's drawing before approving; approved the plan as written.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
