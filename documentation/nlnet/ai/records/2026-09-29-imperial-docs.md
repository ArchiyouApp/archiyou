# Metric / imperial unit system for the docs module

| | |
|---|---|
| Dates | 2026-09-29 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: wrote the design plan (`plans/IMPERIAL_DOCS.md`) and the prompts, kept inches below ≈6'-6" (1200 mm reads 47 1/4"), asked for the work to stay uncommitted for review, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

## Implement `plans/IMPERIAL_DOCS.md`: metric/imperial output for the docs module

### Context

`plans/IMPERIAL_DOCS.md` is an approved design for this work. Documents already carry a
unit system on some surfaces: scale labels and scale bars follow `modeler.unitSystem()`, set by
`request.unitSystem`. The rest don't. Dimension numbers can't be overridden per document, and
titleblock values, table cells and the page size are metric/ISO only. `doc.units('inch')` has
also been 10× wrong since `docs/utils.ts`. This plan implements all 8 stages of that design, with
the corrections that came out of checking it against the current code. It ends with a demo script
in the local DB.

Your decisions:
- Keep `FEET_THRESHOLD_MM` (2000 mm), so 1200 mm reads `47 1/4"`, not `3'-11 1/4"`.
- Leave everything **uncommitted** for your review.
- The disclosure record is still created (ai-disclosure skill, step 1).

### Corrections to the source plan (found while checking it)

- **Line numbers have drifted.** Current anchors:
  - `Document.ts`: `units()` :140, fields :78-92, `pageSize` error :150, `titleblock()` :555, `_getParamSummary` :623, `_getMetricSummary` :678, `_formatMetricParamValue` :711, `merge()` :1255.
  - `Docs.ts`: `units()` shim :335.
  - `View.ts`: unitSystem reads at :169, :185, :197, :561; `renderDrawingFromLayer` call at :221.
  - `SVGExporter.ts`: `RenderDrawingOptions` :920, `renderDrawingFromLayer` :977.
  - `annotationLayer.ts` :187.
  - `AnnotatorDimensionLine.ts`: `units` :67, `setOptions` :913, `toSVG` :1146, `_formatValueText` :1318.
  - `constants.ts`: DOCS block :123-144.
  - `Runner.ts`: unitSystem :1445, cache key :2262.
  - `RunnerComponentImporter.ts` :574.
- **Stage 8's test premise is wrong.** `modeler.units('inch')` does not rescale geometry: `rect(48,96)` stays 48×96 and is tagged `meta.units === 'inch'`. Only labels, doc scale and export headers change. The test asserts that instead.
- **The plan's `3'-11 1/4"` examples become `47 1/4"`**, per your decision. Feet+inch cases use values ≥2000 mm, e.g. 3000 mm → `9'-10 1/8"`.
- **The plan's metric formatting needs pinning down.** `formatFromUnit(…,'metric')` auto-picks `m` for 1200 mm (`1.2`). So metric keeps the value **in its source unit**, bare, the way `_formatValueText()` already does. Only imperial reformats, with marks. The same applies to titleblock and table cells.
- `UnitConverter.test.ts:182` (`"2'"`) also breaks, and becomes `"2'-0\""`.
- `ScriptParamData.units` is a `string` on the wire, so narrow it with `in MM_PER_UNIT`. `_getParamSummary()`'s map (:651) drops fields and must carry `units` through.
- The DXF override is **dropped**. Neither DXF caller (`DXFExporter.ts:928`, `brep/ShapeCollection.ts:2882`) has a document, and DXF is a model export, so it keeps the run-level system.
- `isPageSize` needs the size table without an import cycle, because `Page.ts` imports `typeguards`. The table therefore moves to `constants.ts` (DOCS block) as `PAGE_SIZE_TO_WIDTH_HEIGHT_MM`, built with `toMM(…,'inch')`.
- There is a duplicate `PageSize` at `modeler/brep/types.ts:557`, and nothing imports it. It becomes a type re-export of `docs/types`.
- Also covered: the server `/execute` route (`apps/server/src/routes/execute.ts:49,192`) gets `modelUnits`, and the scale bar gets `notation` (`viewFurniture.ts:260`).

### Stages (in landing order; all in `packages/core/src` unless noted)

**1. Doc unit converter.**
- `docs/utils.ts:11-70`: an mm pivot over `MM_PER_UNIT` with `PNT_PER_INCH`/`MM_PER_PNT`, keeping `%` and the three warn guards verbatim. `pointsToMm`/`mmToPoints` re-anchor on `MM_PER_PNT`.
- `Page._sizeToWidthHeight()` uses `convertValueFromToUnit(…,'mm',this._units)` for every unit, so `pnt` works too.
- Tests: new `tests/unit/docs/docUnits.test.ts`, plus A4 in inches ≈ 11.69 wide in `Docs.test.ts`.

**2. Architectural/engineering notation.**
- `units/UnitConverter.ts`: `ImperialNotation` type and `FormatOpts.notation`, default `'architectural'`.
- Architectural feet always emit inches: `6'-0"`, `1'-6 1/2"`, `-1'-6 1/2"`. Engineering gives decimal feet (`1.54'`) and decimal inches (`6.5"`).
- Update the header comment (`:8`).
- Tests: `UnitConverter.test.ts:180,182` become `1'-6 1/2"` and `2'-0"`, plus engineering and negative cases.

**3. Document unit system.**
- `constants.ts`: add `DOC_UNIT_SYSTEM_DEFAULT` and `DOC_IMPERIAL_NOTATION_DEFAULT` (type-only imports).
- `Document`: optional `_unitSystem?`/`_notation?`, not set in the constructor. Add `unitSystem(s, opts?)`, fluent, validated like `units()` with new `isUnitSystem`/`isImperialNotation` in `docs/typeguards.ts`.
- `resolveUnitSystem()` = explicit ?? `_docs._archiyou?.modeler?.unitSystem?.()` ?? default. `resolveNotation()` works the same way.
- `Docs.unitSystem()` shim beside `units()`.
- The 4 `View.ts` reads go through `this._page?._doc?.resolveUnitSystem()`. `_buildFurniture` also passes `notation`, which is added to `FurnitureInput`/scale bar → `formatLength`.
- One-line comment on the cache key explaining why a docs override is not in it.
- Tests: new `tests/unit/docs/docUnitSystem.test.ts` (default, modeler, override, merged component page), plus an imperial case in `viewScale`/`viewFurniture`.

**4. Dimension text.**
- Add an optional `format?: { unitSystem?, notation? }` and thread it through:
  - `RenderDrawingOptions`
  - `renderDrawingFromLayer`'s `annotationLayer(...)` call
  - `annotationLayer` options
  - `toSVG()` options
  - `_formatValueText(format?)`, which prefers `format` over `modeler.unitSystem()` and passes `notation` to `formatLength`.
- `View._resolveShapesToSVGForPage()` supplies it from its doc.
- `setOptions()` falls back to `modeler.units()` when no units are given.
- Tests: `dimensionLabel.test.ts` gets an override case. `docUnitSystem.test.ts` asserts that a page SVG from an imperial doc under a metric modeler contains `'-`.

**5. Titleblock** (in `Document.ts`).
- 5a. `_formatTitleBlockValue(v, sourceUnit?)` replaces `_formatMetricParamValue`:
  - Booleans → yes/no, null → `none`.
  - A number with a length unit: imperial → `formatFromUnit` with marks and notation; metric → `String(roundTo(v,2))` in the source unit.
  - Other numbers → `String(roundTo(v,2))`.
  - Strings are cut to `TITLE_BLOCK_VALUE_MAXCHAR = 8`. Formatted lengths are never cut.
- 5b. `ParamSummarySource.units?: string`, carried through the map. For metrics, only a unit that is a key of `MM_PER_UNIT` converts. Imperial drops the appended unit because the marks say it; `€`/`kg` stay as today.
- 5c. `_dimensionUnitNote()` returns `All dimensions in ${modeler.units() ?? 'mm'}`, or `''` for imperial. It is drawn with the version-text pattern (same x, directly below it, 2 mm text) as `._varAdd('titleblock:units')`, and added to the JSDoc variable list.
- Tests:
  - `Docs.test.ts`: param `units:'mm'` 1200 → `1200` / `47 1/4"`; `€` metric unchanged; note on/off.
  - New `tests/unit/docs/titleblock.test.ts`: the note in the page SVG.

**6. Table column units.**
- `TableContainerOptions.units?: Record<string, ModelUnits>`, defaulted in `Table.setOptions()`.
- One `_cellText(col, val)` serves body and footer. Imperial reformats declared numeric cells; metric leaves them as they are and appends ` (mm)` to the declared column's header.
- `toData()` already passes `_options`.
- Tests: new `tests/unit/docs/tableUnits.test.ts`, which also checks that an undeclared column is byte-identical.

**7. ANSI/ARCH sizes.**
- `PageSize` gets `Letter|Legal|Tabloid|ANSI_A..E|ARCH_A..E|ARCH_E1`, stored in mm, landscape.
- `isPageSize` becomes a key lookup (rejects `ANSI_A0`).
- Error strings and JSDoc at `Page.ts:67` and `Document.ts:147-150` list the new names.
- Tests: `Letter` → widthMm ≈ 279.4; `ARCH_D` → 914.4×609.6; `isPageSize('ANSI_A0') === false`.

**8. `request.modelUnits`.**
- `runner/types.ts`: the field, with a comment on source unit vs. display system.
- `Runner.ts:1445`: `modeler.units(request.modelUnits)` before `docs.reset()`.
- Added to the component cache key (and its doc comment).
- Propagated in `RunnerComponentImporter.ts:574`.
- `RunnerWorker.ts` `RunOptions`/`_buildRequest`.
- `apps/server/src/routes/execute.ts`: body type and passthrough. If the server result cache keys on `unitSystem`, `modelUnits` is added there too.
- No schema or UI work.
- Tests:
  - `runner.test.ts`: `rect(48,96)` under `{modelUnits:'inch'}` → bbox 48×96, `meta.units === 'inch'`.
  - `runner.component.cache.test.ts`: the key differs by `modelUnits`.

**Wrap-up.**
- Regenerate the editor API/completions (`pnpm -F @archiyou/core generate:api`, `generate:completions`) so `docs.unitSystem` shows up. Check that the diff contains only the new entries.
- Write the record `documentation/nlnet/ai/records/2026-09-29-imperial-docs.md` (skeleton with this plan; prompts filled when the unit closes).

### Demo in the local DB

A script called `imperial_docs_demo`, under author `archiyou`:
- `units('inch')`, and a 96×48×30" table (top plus 4 legs) with params in inches.
- One document: `docs.create('shop drawing').unitSystem('imperial').units('inch').pageSize('Tabloid')`.
- A front and top view with dimension lines, a titleblock, and a cut-list table (`units: { length:'inch', width:'inch' }`).

Before storing, I run it through the probe harness (`CADSCRIPT=_probe pnpm test:cadscripts`, then clean up and `git checkout -- packages/core/tests/outputs/`). Then I store it with `npx tsx .claude/skills/archiyou-local-db/scripts/save-script.ts`, and read it back via `ScriptStore.listForUser('archiyou')`.

Note for testing: the DB has no `units` column, so the header switch is not persisted server-side. That is an existing gap, out of scope here. The demo pins imperial with `docs.unitSystem()`, so it shows the override. Removing that line and using the header switch shows the inherit path.

### Verification

1. `pnpm -F @archiyou/core test` after each stage, and `npx tsc --noEmit -p packages/core` at the end.
2. `git diff --stat packages/core/tests/outputs`:
   - Empty for every stage except 5.
   - Stage 5 is expected to move `docs/test.rich.svg` and possibly `runner/runner.component.merged.docs*.svg`.
   - Anything else means metric output moved, which is most likely Stage 4's units fallback. Investigate it; don't revert it.
3. `pnpm -F @archiyou/core test:cadscripts`, then check that no tracked metric output changed.
4. Run the demo in the editor (after I've stored it):
   - Dimensions, scale label, scale bar, titleblock and cut list are all imperial.
   - The Tabloid page is 17×11 in.
   - The document stays imperial with the header switch on Metric.
5. `docs.toPDF()` on the demo: fraction glyphs survive, and there are no label collisions on the dense view.

### Amendment 2026-10-05 — one unit model (decided in review)

Decided in review. The script is the source of truth; everything else is a display override.

| Source | Decides |
| --- | --- |
| `units('…')` in the script (default `mm`) | The model unit **and** its system (`systemOfUnit()`: mm/cm/m → metric, inch/feet → imperial). Documents follow that system: metric documents write mm, imperial ones inches (feet-inches above `FEET_THRESHOLD_MM`), also under `units('feet')`. |
| File-bar switch (`script.units`) | Display override for the editor: viewer readouts, param widgets, 3D dimension labels, mass, non-doc exports. **Unset follows the model's system.** It does not reach documents. |
| Document tool switch (`request.docUnitSystem`) | Display override for documents, from outside the script. Never written in the script. |

#### Core
1. `Modeler.unitSystem()` is unset by default and reads `systemOfUnit(units())` until a request
   sets it. `request.unitSystem` stays the display override.
2. `Document.resolveUnitSystem()` = `docs._runUnitSystem` (`request.docUnitSystem`) ??
   `systemOfUnit(modeler.units())`. It no longer reads `modeler.unitSystem()`.
3. Remove `Document.unitSystem()`, the `Docs.unitSystem()` shim, `_notation` / `resolveNotation()`
   and `DOC_IMPERIAL_NOTATION_DEFAULT`. Documents use architectural notation. The general
   `notation` option of `formatLength()` and `AnnotationFormat.notation` stay.
4. Metric documents write bare dimension numbers in mm: View passes `AnnotationFormat.unit = 'mm'`,
   and the titleblock note reads "All dimensions in mm" whatever `units()` says. Titleblock and
   table values keep the unit their author gave them.
5. A document's paper follows the model's system at `docs.create()`: A4 in mm for metric, Letter
   in inches for imperial (`DOC_PAGE_SIZE_IMPERIAL_DEFAULT`, `DOC_UNITS_IMPERIAL_DEFAULT`).
   `doc.pageSize()` and `doc.units()` still set them. `docUnitSystem` does not change them: the
   layout must not move when a drawing is viewed in the other system.
6. `request.docUnitSystem` (landed): in the component cache key, inherited by components, a
   `RunnerWorker` option.

#### Editor, configurator, server
7. `state/units.ts`: `modelUnitSystem` from the last run's `meta.units`;
   `scriptUnitSystem = script.units ?? modelUnitSystem ?? metric`;
   `docUnitSystem = pick ?? modelUnitSystem ?? metric`. Picking the model's own system clears the
   override. Requests send the overrides only: sending the effective value back would pin the next
   run to the previous run's model system.
8. Drop `ensureScriptUnitSystem()`. It stamped every opened script `units: 'metric'`, which would
   now read as a deliberate override, so the local loader clears a stored `'metric'` once per
   browser (flag in localStorage). A stored `'imperial'` was always picked by hand and stays.
9. Param widgets round values on a user's switch (an override changes), not when the effective
   system changes because a run reported the model's units. Otherwise opening an inch script
   rewrites its param values.
10. Re-run triggers (editor, configurator) track the overrides, not the effective systems.
11. Configurator: the end-user's pick goes out as both `unitSystem` and `docUnitSystem`.
    `/execute` accepts and validates `docUnitSystem`; `runOnServer()` passes it.
12. Publish, share and thumbnail runs pass `scriptData.units` without `?? 'metric'`.
13. Regenerate the API reference and completions (`generate:api`, `generate:completions`).

#### Tests
- `docUnitSystem.test.ts` around `units('inch')` and `_runUnitSystem` instead of the removed
  override.
- Runner: a `units('inch')` script with no unit request writes imperial documents; an
  `unitSystem: 'imperial'` request on an mm model leaves documents metric; a `units('m')` model's
  metric document writes mm.

## Review and decisions by the human
- Design: `plans/IMPERIAL_DOCS.md` (the human's), implemented in 8 stages; the agent checked it
  against the code and corrected the drifted references, the Stage 8 test premise (model units do
  not rescale geometry) and the feet/inch examples.
- Chose to keep the feet threshold at 2000 mm (inches below ≈6'-6") and to leave the work
  uncommitted for review.
- Asked for the demo to be stored in the local database (`imperial_docs_demo` under `archiyou`).
  Rendering it before storing showed a dimension reading 42 inches as 1 5/8": the dimension
  options schema injected `units: 'mm'` whenever units were left out (autoDim, dimensionLine).
  Fixed in `annotator/schemas.ts` plus a model-unit fallback in `DimensionLine.setOptions()`,
  which is the plan's Stage 4 fallback, now at its real cause.
- `packages/core/tests/outputs` turned out to be gitignored, so the plan's `git diff --stat`
  check could not work. The agent compared test outputs from HEAD (changes stashed) with the
  outputs of the change instead: apart from UUIDs, timestamps and random scripts, only the two
  titleblock SVGs moved, by the new "All dimensions in mm" line.
- Reviewing in the editor (2026-10-05), asked for a Metric/Imperial switch in the document tool's
  header to test with, then for it to work independently of the file-bar switch (added as
  `request.docUnitSystem`).
- Then decided one unit model (amendment above): the script's `units()` sets the model's and the
  documents' system, no unit system override in the docs module, documents in mm (metric) or
  inches (imperial, also under `units('feet')`), the file-bar switch is a display override that
  follows `units()` unless set in the UI, and the document tool keeps its own override. Accepted
  the agent's proposals to drop engineering notation, write metric documents in mm whatever the
  model unit, and send the configurator end-user's pick to the documents too.
- Asked for imperial documents to default to Letter (A4 stays the metric default).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
