# Pipelines: first-class $pipeline, doc pipelines folded in, pipeline chip in the editor

| | |
|---|---|
| Dates | 2026-10-09 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode (Explore and Plan subagents), then as agent |
| Human | Mark van der Net: wrote the prompts, chose the output semantics (returned shapes), both doc.pipeline forms, the viewer approach and overlay isolation; questioned dropping the isolated scope; reviewed plan and code |
| Branch | `pipelines` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

## First-class pipelines: fold doc pipelines in, select and export them in the editor

### Context

Archiyou has two "pipeline" mechanisms that share no code.

- **`$pipeline(name, fn)`** (`packages/core/src/runner/Runner.ts:602`, `execution/Pipeline.ts`) is selected by the first segment of an output path (`drawings/model/dxf`). It is effectively broken:
  - `Runner._pipelines` is never reset, so pipelines from earlier runs stay registered and run on stale scopes.
  - The "isolated scope" is illusory. The function was compiled inside `with(mainScope)` and the Proxy's `has: () => true`, so `all()`, `box()` and `docs` resolve to the main scope. The pipeline scope it exports is empty.
  - A pipeline that throws crashes the output loop: `outputs.push(...undefined)`.
  - It has no tests and no editor UI.
- **`doc.pipeline(fn)`** (`docs/Document.ts:242`, `Docs.executePipelines` at `Docs.ts:172`) is what every real script uses (12 cadscripts plus the editor starter). It is anonymous, runs lazily and synchronously when docs export, runs all docs' pipelines without filtering, and returns `{ iso, front }` onto the scope for `view().shapes('iso')`. Its drawings can't be viewed or exported on their own.

**Goal:** one pipeline concept. A pipeline is a named step that runs after the model; its **returned shapes** become its own output scene, one layer per key. Docs bind to pipelines by name, or by function, which auto-registers a pipeline named after the doc. In the editor:
- a chip on the execute button selects the pipeline
- the viewer shows only that pipeline's output, top-down and orthographic when it is flat
- Export uses the selected pipeline, so a drawing pipeline exports straight to DXF

**Decisions you made:**
- Output = returned shapes. If the pipeline returns nothing, the shapes it created are used.
- `doc.pipeline('name')` and `doc.pipeline(fn)` are both valid; the function form auto-names the pipeline after the doc.
- Reuse the 3D viewer, with an automatic top orthographic view for flat output.
- **Overlay isolation** (below).

**Isolation model: an overlay, not a separate scope.**
- Components isolate cleanly because their *source* is compiled inside `with(componentScope)` (`Runner.ts:1576-1651`) and only `internal` outputs flow back.
- A pipeline is a closure written in the main script, and its job is to read the main model. So it keeps resolving names in the main scope: closures, `all()` and helpers keep working. While it runs:
  - variable **writes** go to a per-pipeline overlay (`pipeline.vars()`); reads check the overlay first, then the main scope
  - new **shapes** go to a detached capture layer, not the main scene
  - docs and tables it creates appear only in `<p>/…` outputs, because default outputs are exported before any pipeline runs
- Result: two pipelines can both define `iso`, and nothing leaks into the main scope or model.
- The one remaining leak, which the help page documents: mutating a model shape in place (`model.move()`). It can't affect default outputs, since they export first.

```js
$pipeline('drawings', () =>
{
  iso = all().iso();
  front = all().elevation('front').autoDim();
  return { iso, front };            // output layers 'iso', 'front'; vars of this pipeline
});
docs.create('spec').pipeline('drawings').page('p').view('iso').shapes('iso');
// outputs: drawings/model/dxf · drawings/model/glb · drawings/docs/*/pdf
```

### Phase A: core runtime (`packages/core`)

**A1. `execution/Pipeline.ts`**: rewrite as the owner of one run (~150 LOC, replaces ~100).
- Fields: `name`, `_function`, `_auto` (named after a doc), `_run: PipelineRun | null`, `_pending`, `onError`.
- `PipelineRun = { returned, output: SceneNode|null, annotations, created: {docs, tables, metrics}, error }`.
- `async run(scope, modules)` runs at most once per execution (cached, shares a pending promise). `runSync(scope, modules)` is for Docs and components; if the function returns a thenable it warns and finishes in `.then`.
- The call is `fn.call(scope, scope)`, so `this` and the first argument stay the main scope (back-compat).
- During the call `scope._overlay = this._vars`. The previous overlay is restored in `finally`, so nested runs (docs export inside a pipeline) stay correct.
- Returned keys are merged into `_vars`, not onto the main scope. A single returned shape becomes `{[name]: shape}`. `vars()` exposes them.
- `get done()` is a getter, so the existing Docs tests (`_pipelines[0].done`) keep passing.
- Drop the `analyzeFunc` warnings that ask for a "mainScope" argument; that advice is now wrong.

**A2. `modeler/Modeler.ts`**: capture and swappable export scene (~95 LOC).
- `beginCapture(name)` / `endCapture()`: push a detached `SceneNode.root(name)` and make it the active layer via `_setActiveLayer` (`:203`). It mirrors onto `scene.setActiveLayer`, so meshup's `activeLayerOf()` (`meshup/src/sceneDecorators.ts:48`) sends everything the pipeline creates there, including `model.iso()`, `copy()` and `layer('x')`. The main scene stays untouched.
- `pipelineScene(name, capture, returned)` makes a root with `ensureLayer(key)` per returned key:
  - Shapes from the capture are **moved** in. Their cascaded style is baked first, because DXF reads layers from `shape.node()` (`DXFExporter.ts:793-825`); export `cascadedStyleData` from there rather than duplicating it.
  - Model shapes are only **referenced** (the `_shape` ref-node trick from `_exportScene`, `:1458`).
  - If nothing returned is a shape, it returns the capture (fallback for old non-returning functions).
- `async withScene(root, fn, annotations?)` swaps `_scene` and an `_exportAnnotations` override and restores both in `finally`. Every exporter reads `this.scene()`, so `glb/gltf/svg/dxf/dae/stl/…` and module outputs work unchanged. `toDXF` (`:1333`) and the GLB `annotations` option use the override when it is set.
- The pipeline's annotations are those created during its run plus `collectAnnotations(returned)` (`annotator/annotationLayer.ts:93`), de-duplicated. Main-model dims don't leak into the pipeline's output.

**A3. `runner/Runner.ts`** (about +80 / −80).
- Remove `_pipelines`, `executePipeline()` and `_executePipelineIsolated()`, together with the isolated scope.
- Keep the registry on the scope: `state._pipelines = new Map()` in `createScope()`. Every run starts fresh and component pipelines no longer leak into the parent.
- Overlay in the scope Proxy (`createScope`, `:342`, ~20 LOC), with `state._overlay = null`:
  - `get`: an overlay hit (`key in overlay`) first, else the target
  - `set`: with an overlay active and a non-internal key (not `_…`), write to the overlay, keeping shape auto-naming; else the target
  - `has` stays `true`
- `$pipeline(name, fn)` returns the `Pipeline`. `pipeline(name, fn, scope, auto)`:
  - validates the name: not `default`, no `/ ? *`
  - an explicit duplicate replaces the old one with a warning
  - an auto pipeline reuses an existing one with the same function (one function on two docs runs once); on a name clash it becomes `name-2`
- `getPipelines / getPipelineNames / getPipelineByName(name, scope?)`. `meta.pipelines` stays `string[]`; the publish menu and the component `info()` rely on that.
- `getScopeResultOutputs`:
  - Take the pipeline names from the **requested** paths (new `ScriptOutputManager.getRequestedPipelines()`, `default` first). Today a wildcard that resolves to nothing drops the pipeline.
  - Export `default` first, so pipeline shapes can never reach default outputs. `result.state` is built earlier, so it is unaffected.
- `_exportPipeline(name)`:
  - `await pipeline.run`. On error, report through the scope console and `result.warnings` (pipeline name and message), return `[]` and continue.
  - Model exports run inside `modeler.withScene(run.output, …, run.annotations)`.
  - Docs, tables and metrics run with a pipeline meta:
    - `<p>/docs/*` = docs bound to or made by `p`
    - `<p>/tables|metrics/*` = what `p` created
    - `default/*` is unchanged
- `_exportPipelineDocs` first awaits `docs.runPipelines(requestedDocNames)`, so async pipelines finish before the synchronous doc code reads their results.
- `step` and `buffer` use legacy exporters that ignore `withScene`: warn and skip them for named pipelines.
- Optional (~25 LOC): component pipelines (`Runner.ts:3210`, currently "not implemented") via `runSync` + `withScene`.
- Update the `$pipeline` JSDoc (`:132-138`).

**A4. `execution/ScriptOutputManager.ts`**: add `getRequestedPipelines()` and rewrite the header comment (`:1-48`) to describe these semantics.
**A5. `execution/ScriptOutputPath.ts:61`**: fix the bug: the check should be `category === '*'`, not `format === '*'`.

### Phase B: fold doc pipelines in

- **`docs/Document.ts`**:
  - `_pipelines: Array<Pipeline|string>`.
  - `pipeline(nameOrPipelineOrFn)`: a function becomes `docs.registerPipeline(docName, fn)` (auto); a name is resolved lazily, so `$pipeline` may be declared later.
  - Drop the arrow-function warning; `return` is the contract now.
  - `_pipelineError` becomes a getter over the bound pipelines' errors, so `View.ts:379` keeps working.
  - `name()` renames an auto pipeline.
  - `resolveScopeReferences()` runs only this doc's pipelines.
- **`docs/Docs.ts`**: replace `executePipelines` (`:172-261`) with:
  - `registerPipeline` (runner if present, else a standalone `Pipeline` for tests and standalone Docs)
  - `pipelinesOf(doc)` (warns on unknown names)
  - `pipelineDocs(name)`
  - sync `executePipelines(include, exclude)` (de-duplicated, `runSync`)
  - async `runPipelines(include)`
  - `getDocs(only)` and `toData(onlyDocs)` now pass their filter, so exporting one doc no longer runs every doc's pipeline.
- **Types**: delete `DocPipeline` (`docs/types.ts:38`, duplicate `modeler/brep/types.ts:570`).
- **View name lookup**: `View.resolveShapeNameToSVG()` (`docs/View.ts:340-392`) asks its document. `Document.resolveName(name)` returns the first hit in its bound pipelines' `vars()`, else the active scope, so a view can still name model variables.
- **Back-compat**: old `function docPipeline(){ iso = … }` writes its globals into the overlay of the doc's auto pipeline, and the doc's views resolve them through `resolveName`. With no return, its output falls back to the capture. The starter script (`apps/editor/src/settings.ts:51`) keeps working and now shows a `myDoc` chip.
- **Migrate examples**:
  - `tests/cadscripts/scripts/strawwall.js` (`:236-268`): `$pipeline('techdraw', function(){ …; return {…} })` + `.pipeline('techdraw')`.
  - `ur_house_sketch.js` (`:760-770`): same. Its `offer` pipeline now runs only when requested.
  - Optionally move the editor starter script to the named form.

### Phase C: editor (`apps/editor`, `packages/ui`)

- **`apps/editor/src/state/core.ts`**:
  - `activePipeline = signal('default')` (session-only, like `kernel`).
  - `pipelineModelPath(p)` returns `default/model/glb` or `${p}/model/glb?annotations=true`.
  - Reset to `default` in `setExecutionResult` when `meta.pipelines` no longer contains it, and on script switch.
- **Chip** in `packages/ui/src/editor/codebox.ts`, as a `_renderPipelineChip()` method right before `.execute-button` (no new component; codebox owns the button and the event trap):
  - `wa-dropdown` + `wa-dropdown-item type="checkbox"` with "Model (default)", a divider, then the pipelines. Lucide `workflow` icon plus the active name.
  - Hidden when the script has no pipelines; `_lastPipelines` keeps it through error runs.
  - The select handler calls `e.stopPropagation()`. A composed `change` reaching the editor's code-sync wipes the script (`codebox.ts:565-568`).
  - Selecting sets the signal and calls `_fireExecute()`.
  - Chip CSS follows `key-badge.ts:55-70`, using design tokens.
- **`apps/editor/src/pages/editor.ts`**:
  - `_executeOnce` (`:660`) keeps `default/model/glb` (thumbnail, fallback) and adds `pipelineModelPath(p)` when a pipeline is selected.
  - The docs entries in TOOLS (`:62-72`) become `{pipeline}/docs/*/svg|svg-pages`, filled from `activePipeline`. Tables and metrics stay default.
  - `_exportModel` (`:952-991`) rewrites `default/` to `${p}/` and adds a `_<pipeline>` filename suffix, so **Export → DXF on `drawings` gives the drawing DXF**.
  - Auto-run and param runs already go through `_executeOnce`.
- **`packages/ui/src/viewer/model-viewer.ts`**:
  - Find the GLB through `pipelineModelPath(activePipeline)` (today `:163`).
  - Outside default:
    - no main scenegraph, annotations or handles: annotations fall back to the GLB extras; skip `_reconcileHandles`; hide the handles overlay
    - re-frame when the pipeline changes
    - empty the view when the pipeline produced no GLB, for example after an error
  - New exported `flatAxis(box)` helper. `_applyFlatView` moves the camera along the thin axis (z: `(0, -1e-3, 1)`), then calls `_frameCamera` and `_buildOrthoFromPersp`. The previous ortho state is restored when leaving.
- **Small edits**:
  - `tools/document-viewer.ts`: filter on `path.pipeline === activePipeline`.
  - `data-tool.ts:122` and `metrics-tool.ts:47`: filter on `pipeline === 'default'`.
  - Hamburger label "Export to… (drawings)".
  - `publish-script-menu.ts:801`: offer `['default', ...meta.pipelines]`. Today it only falls back to `['default']` when there are no pipelines.

### Phase D: completions, help, CLI

- `packages/ui/src/editor/completions.ts`: `.pipeline('` completes this script's pipeline names (not inside `$component(...)` chains). Register it in codebox next to `registerComponentNames` (`:284`).
- JSDoc for `$pipeline` and `Document.pipeline`, then `pnpm --filter @archiyou/core generate:api` to refresh `api.generated.json`.
- Help page `help/guide/en/modeling/pipelines.md`, linked from `modeling/index.md`. It covers:
  - why pipelines exist
  - `return { key }` = layers
  - the chip and the viewer
  - `doc.pipeline('name')` vs a function
  - DXF export
  - `<p>/…` output paths
  - "copy, don't mutate, model shapes"
- `packages/cli/skill/SKILL.md`: a short section on drawing pipelines.
- Optional: `archiyou run --pipeline name[:dxf,svg,glb]` in `packages/cli/src/run.ts` (~30 LOC).
- Mark the `_pipelines` reset as solved in `plans/SAFE_EXEC.md:42,262,299`.

### Tests

- **New `packages/core/tests/unit/runner/runner.pipeline.test.ts`** (mesh; brep for the basics):
  - default and pipeline GLB coexist; `result.state.scenegraph` has no pipeline layers
  - pipeline DXF has layers `iso`/`front`; default DXF has neither
  - no-return fallback = created shapes only
  - returned keys resolve in doc views
  - isolation: two pipelines both assign `iso` without clashing; the main scope has no `iso` after the run; main-script variables and helpers are readable inside a pipeline
  - an old non-returning `function(){ iso = … }` doc pipeline still renders its view
  - runs once across model + DXF + docs outputs
  - registry reset between runs
  - a throwing pipeline leaves the status success, keeps the default output, warns, and lets other pipelines export
  - async function
  - `<p>/docs/*` returns only bound docs
  - annotation filtering (main dims excluded, pipeline dims included)
  - `doc.pipeline(fn)` gives a `spec` pipeline with DXF
  - a shared function registers once
- **New `tests/unit/execution/ScriptOutputPath.test.ts`**: parsing, the `*` category fix, `resolveVerbose`, `getRequestedPipelines` order and kept wildcards.
- **Modeler capture tests** (extend `tests/unit/modeler/`):
  - capture receives `box()` and `model.iso()`; the main scene is untouched; the active layer is restored
  - `pipelineScene` moves captured shapes and references model shapes
  - `withScene` restores the scene on throw
- **Regressions**:
  - existing `Docs.test.ts`, `docs.kernels.test.ts`, `viewAnnotations`, `annotationPageSize`, `runner.component.test.ts:119`
  - add to `Docs.test.ts`: `getDocs(['a'])` doesn't run b's pipeline
  - add to the strawwall test in `run.cadscripts`: `techdraw/model/dxf` is non-null
- **UI and editor**:
  - pipeline completion test (`packages/ui/tests`)
  - `flatAxis` unit test
  - editor test for the `activePipeline` reset and `pipelineModelPath`

### Verification

```
pnpm --filter @archiyou/core test -- tests/unit/runner/runner.pipeline.test.ts tests/unit/execution tests/unit/docs tests/unit/modeler
pnpm --filter @archiyou/core test:cadscripts
pnpm --filter @archiyou/core typecheck:budget
pnpm --filter @archiyou/ui test && pnpm --filter @archiyou/ui typecheck:own
pnpm --filter @archiyou/editor test && pnpm --filter @archiyou/editor typecheck:own
pnpm -s archiyou run <strawwall> with techdraw/model/dxf   # CLI smoke
```

Then check the editor in the browser with strawwall:
- the chip lists `techdraw` and `spec`
- selecting one shows a top-down orthographic drawing with dims
- Export → DXF downloads `…_techdraw.dxf` with `iso`/`front` layers
- the Documents tool shows `spec`
- "Model" restores the perspective view, and the thumbnail stays the model

### Size, order, risks

- **Order**: A5/A4 → A2 → A1 → A3 → B → example migration → C → D.
- **Size**:

  | Part | LOC |
  |---|---|
  | Core (including the overlay) | ~+390 / −180 |
  | Docs | ~+100 / −110 |
  | Editor/UI | ~+190 |
  | Phase D (without the help page) | ~+120 |
  | Tests | ~+600 |

  No new source files, only tests and the help page.
- **Risks**:
  - Pipelines that mutate model shapes (`move`, `hide`) are the one thing the overlay can't isolate. Default outputs export first, so they're safe; documenting "copy first" is enough.
  - A main-script function called from a pipeline also writes into the overlay. That is intended (e.g. `$pipeline('techdraw', function(){ docPipeline(); })`), but it means a helper can't set main-scope state from inside a pipeline.
  - Capture relies on all shape creation going through the active layer. Verify for the brep kernel in the capture test.
  - The Scene tool keeps showing the main scenegraph while a pipeline is selected; a follow-up note in that tool.
- **Workspace**: implement in a separate git worktree on a new branch `pipelines`, branched from the current HEAD of `keys` (the uncommitted `keys` work stays where it is). Run `pnpm install` in the worktree before testing.
- **Process**: on approval, create an NLnet AI record (`documentation/nlnet/ai/records/`, ai-disclosure skill). Commit per phase with `pnpm commit:ai`.

## Review and decisions by the human

- Output of a pipeline = the shapes it returns (fallback: the shapes it created).
- `doc.pipeline('name')` and `doc.pipeline(fn)` both valid; fn registers a pipeline named after the doc.
- Flat pipeline output in the existing 3D viewer, top-down orthographic.
- Asked why the isolated pipeline scope was dropped and how components isolate; chose overlay isolation over main scope, component-like recompile or re-running the script.
- Implementation in a separate worktree on branch `pipelines`.
- Approved the two commits (core, editor) and their texts.
- After the first round, asked to also do the optional items: `$component().pipeline()`, the CLI `--pipeline` flag, and ticking off the `_pipelines` reset in `plans/SAFE_EXEC.md` (untracked, edited in the main checkout).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
