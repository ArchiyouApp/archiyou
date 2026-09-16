# PNG thumbnails: background generation and a viewer-rendered picture per script

| | |
|---|---|
| Dates | 2026-09-15 → 2026-09-16 |
| Model | Claude Fable 5.1 (claude-fable-5-1), Claude Code agent |
| Tool | Claude Code in plan mode (agent writes the plan), then as agent (writes code and tests, runs them) |
| Human | Mark van der Net: wrote the prompts below, reviewed the plan and the code, tested in the editor and browser pages, chose the rendering style |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-15 20:43 +0200  In the frontend browser there are a lot of scripts without thumbnails. This is because currently these are only generated (client side) when the user shares/publishes a script. Can you come up with a way that this gets done more times without blocking the editor/browser workflow, so probably in the backgroud. I also worry a bit about very large vector thumbnails. Why not turn them into PNG's or something.
2026-09-15 23:15 +0200  I tested it but a rerun of http://localhost:5173/editor/ur_house_detailed hangs. Can you test and debug?
2026-09-15 23:22 +0200  [Request interrupted by user for tool use]
2026-09-15 23:24 +0200  Yes for very large models (like house_detailed) the isometric thumbnail generating becomes too compute intensive. Maybe its good to use the viewer to make a thumbnail? Use a certain view style (for example realistic), camera normal, no grid and automatic fitting. Maybe render offscreen into a bitmap/png? What do you think of this approach?
2026-09-15 23:27 +0200  Yes, go ahead with the hidden renderer
2026-09-15 23:36 +0200  Please make the thumbnail with an isometric perspective.
2026-09-15 23:39 +0200  Can you make it instead of the realistic view, a lot like tech draw view. But with clear white fills (instead of gray).
2026-09-15 23:43 +0200  Nice. Only change the camera position to [-1,-1,1] instead of [1,-1,1]. Also can you to test give the edges the color of the shapes. So its a bit more colorful
2026-09-15 23:48 +0200  There is always quite a bit of space around the captured model in the image. Can you make this better, so the image has less margin and is bigger in the thumbnail?
2026-09-15 23:52 +0200  Can you check, it looks like hidden shapes are still shown in the thumbnail
2026-09-16 00:00 +0200  Can you make the line width of the thumbnails a bit bigger?
```

## Plan (agent output, reviewed by the human before implementation)

Written by the agent in plan mode after the first prompt and approved by the human. The plan rasterized the existing SVG line drawing; during testing the human found that too slow for large models and redirected the work to an off-screen render by the viewer (prompts of 2026-09-15 23:24 onwards). The plan is kept as approved; the deviation is in the review notes.

## Background PNG thumbnails for scripts

### Context

Most scripts in the browser page have no thumbnail. Today a thumbnail is only produced inside the Share and Publish dialogs: the runner Web Worker re-executes the script with the special output path `THUMBNAIL_OUTPUT_PATH` (`packages/core/src/constants.ts:65`), gets back an SVG hidden-line iso drawing, and the SVG string rides along in the share/publish request body. The server allowlist-checks the SVG (`svgSanitize.ts`), writes it to disk (`ThumbnailStore.ts`), and stamps the URL on the `script_versions.thumbnail` column. Working copies (what the Home tab of the browser lists) never get one, and nothing regenerates thumbnails for existing scripts.

Two problems to solve:

1. **Coverage.** Generate thumbnails far more often, in the background, without ever blocking a run, a save, or the browser page.
2. **Format.** Vector thumbnails are unbounded in complexity (a 64 KB SVG with thousands of paths, rendered in a grid of 50 cards, is slow to paint) and need a sanitizer. Switch to PNG: hard size bound, trivial validation, cheap to paint.

Decisions already made with the user: rasterize the existing line drawing (not a 3D screenshot); transparent PNG with a fixed mid-grey ink and a CSS brightness filter in dark mode; generate after each editor run **and** backfill the user's own scripts from the browser page; server becomes PNG-only (existing `.svg` files stay served until replaced).

### Design in one paragraph

The worker already holds the modeler scene of the last run in its `default` scope. A new worker method `thumbnail()` turns that scene into a PNG **without re-executing the script**: `Modeler.toThumbnailSVG()` (existing) → a small rasterizer that draws the SVG's `path`/`line`/`polyline`/`circle` elements with `Path2D` onto an `OffscreenCanvas` → `convertToBlob('image/png')` → `ArrayBuffer`. A new editor service `thumbnail-service.ts` owns a single background queue: (a) after every successful editor run it schedules a debounced `thumbnail()` and uploads the PNG for the file's working copy; (b) the browser page feeds it the user's own scripts that lack a thumbnail, and it runs them one at a time while nothing else is using the worker. Share/publish/configurator-edit reuse the same service and upload the PNG *after* the row is stored, so the thumbnail bytes leave the JSON bodies entirely. The server stores PNGs next to the existing SVGs, gets a file-level endpoint for working copies, and makes ordinary saves inherit the file's current thumbnail server-side so the URL survives the one-row-per-save model.

### Changes

#### 1. `packages/core` — rasterizer + "thumbnail of last run"

**`packages/core/src/modeler/SVGExporter.ts`** — no new file; the exporter already owns the thumbnail pipeline (`buildThumbnailSVG`, the degradation ladder), so the rasterizer goes in a new `//// THUMBNAIL RASTER ////` section at the end of it (pure, canvas-agnostic, Node-testable):
- `rasterizeThumbnailSVG(svg: string, canvas: CanvasLike, opts?: { ink?: string; strokeWidth?: number; background?: string | null }): boolean`.
- Parse `viewBox` from the root; compute a uniform scale that fits it into `canvas.width × canvas.height` centred (same framing `viewBoxFor` produced, so the square drawing fills the square canvas).
- Extract drawable elements with regexes. What the exporter actually emits (verified): `<path d>` with `M/L/A` commands (meshup `Curve.toSVGElem`, `packages/meshup/src/Curve.ts:4699`; brep `Edge.toSVG`), `<circle cx cy r>` (same `Curve.toSVGElem`), and `<polygon points="x,y x,y …">` for flat faces (meshup `Polygon.toSVGElem`, `Polygon.ts:1409`; reached via `drawableFaces()`), or `<path d fill-rule="evenodd">` for faces with holes. Convert `circle` and `polygon` to path data (`M x y L … Z`) and draw everything via `new Path2D(d)`, stroke only (the stylesheet is `fill:none`). Skip elements whose `class` contains `hidden`. Ignore `<style>`, `<title>`, `<g>`; there are never `transform` attributes (`buildSVGDocument`, `SVGExporter.ts:621-687`), and style attributes are already stripped by `compactElement`.
- Stroke in device pixels (`ctx.setTransform` for the geometry, `lineWidth` set after resetting the transform, or use `ctx.stroke(path)` with `lineWidth = strokeWidth / scale`). Round caps/joins as the SVG stylesheet does. Ink default `#777777`, transparent background.
- Constants exported: `THUMBNAIL_PNG_SIZE = 512`, `THUMBNAIL_INK = '#777777'`.

**`packages/core/src/runner/Runner.ts`**: add `thumbnailSVGOfLastRun(options?: ThumbnailSVGOptions): string | null` — reads `this._localScopes['default']?._archiyou?.modeler` and returns `toThumbnailSVG(...)?.svg ?? null`; `null` when there was no run. Keeps Runner canvas-free (it also runs in Node). Options used: `{ view: 'iso', hidden: false, square: true, maxBytes: 1_048_576, hardMaxBytes: 4_194_304 }` — the byte ladder no longer matters for a raster target, so the budget is raised to keep every curve; put these in `constants.ts` as `THUMBNAIL_SVG_OPTIONS` and keep `THUMBNAIL_OUTPUT_PATH` only for the runner's `svg?thumbnail=1` output path (tests use it).

**`packages/core/src/runner/worker/runner.worker.ts`**: new Comlink method `thumbnail(): Promise<ArrayBuffer | null>` — `runner.thumbnailSVGOfLastRun()`, then `new OffscreenCanvas(size, size)` + `rasterizeThumbnailSVG` + `convertToBlob({ type: 'image/png' })` → `arrayBuffer()`. Return `null` (and `console.info` why) when `OffscreenCanvas` is undefined, the SVG is null, or rasterizing fails. Add to `ArchiyouCoreApi`.

**`packages/core/src/runner/worker/RunnerWorker.ts`**: `thumbnail(): Promise<ArrayBuffer | null>` proxying the above (after `init()`).

#### 2. `apps/editor` — background thumbnail service

**`apps/editor/src/services/execution-service.ts`**: export `renderThumbnail(): Promise<ArrayBuffer | null>` (local worker only; `null` when a server target is set) and a tiny busy tracker: `runScript()` increments/decrements an in-flight counter, exported as `isExecutionBusy()`. Background jobs use it to yield to foreground runs.

**Rewrite `apps/editor/src/services/thumbnails.ts`** into the service (keep the filename; it already owns "attach after the fact"):
- `uploadWorkingThumbnail(fileId, png)` → `PUT /scripts/{user}/{fileId}/thumbnail`, body `image/png`.
- `uploadVersionThumbnail(fileId, versionId, png)` → existing route, now `image/png`.
- `scheduleWorkingThumbnail(script: Script)`: called after a successful editor run. Debounce ~2 s with one pending job; each call bumps a token so a later run or a script switch supersedes the pending one. Job: `renderThumbnail()` → upload → on success set `script.thumbnail = url`, `bumpScripts()`, `saveCollection()`. Never throws; failures logged once.
- `enqueueBackfill(targets: BackfillTarget[])` where `BackfillTarget = { fileId; versionId?: string; script: ScriptData }`: dedupe by `fileId:versionId`, run sequentially; before each job wait until `!isExecutionBusy()` and no working-thumbnail job is pending, plus a 300 ms gap. Job: `runScript({ script, outputs: ['default/tables/*/json'], messages: ['error'], kernel: 'mesh', unitSystem })` — NOT `outputs: []`, which the Runner replaces with the default GLB export (`Runner.ts:776-779`); the tables path is what the editor sends on every run and costs nothing → `renderThumbnail()` → upload to the version or working endpoint. Record `${fileId}:${hash(code)}` in `localStorage` under `ay.thumbnail.skip` when a job yields no PNG or the server refuses (422 **or 403**: the version endpoint sits behind `requireVerified`, so an unverified account must not retry forever), so a script that draws nothing is not retried on every visit (`hash` from `packages/core/src/utils`). Emits `window` event `ay-thumbnail-stored` with `{ fileId, versionId?, url }`.
- Only runs when signed in (`authService.getUser()`); every function is a no-op otherwise.

**`apps/editor/src/services/api.ts`**: let `request()` accept a binary body: when `body` is a `Blob`/`ArrayBuffer`, send it as-is with the given `Content-Type` (add an optional `contentType` argument, or a dedicated `api.putBinary(path, bytes, contentType)`).

**`apps/editor/src/pages/editor.ts`** `execute()` (~line 505): after `setExecutionResult` and `_executeToolOutputs()`, if `result.status !== 'error'` and the active script is not foreign (`_scriptIsForeign` logic in `state/core.ts:232`, export a helper), call `scheduleWorkingThumbnail(active)`.

**`apps/editor/src/pages/browser.ts`**: after `_loadLibraries()` (and again when `scripts`/user changes), build backfill targets: own local scripts without `thumbnail` and with code above the auto-run minimum; own rows in `_shared`/`_configurators` (author === me) without `thumbnail`, with `versionId = data.id`. Call `enqueueBackfill`. Listen for `ay-thumbnail-stored` to patch the matching entry: for a working copy the service already sets `script.thumbnail` and calls `bumpScripts()` (the page is a `SignalWatcher` reading `scripts.get()`, so it re-renders); for a shared/configurator row replace the `_shared`/`_configurators` map with a new `Map` (they are plain `@state` maps, so in-place mutation would not re-render). Working-copy URLs flow through `assetUrl()` as today.

**Share / publish dialogs** (`packages/ui/src/editor/share-script-menu.ts`, `publish-script-menu.ts`) and `apps/editor/src/services/sharing.ts`, `publishing.ts`:
- Drop the `thumbnailSvg` parameters and `withThumbnail()`; bodies are plain `ScriptData` again.
- Share: `_prepareThumbnail()` keeps its fire-and-forget run but ends with `renderThumbnail()` and stores `ArrayBuffer | null`. After `shareScript()` resolves, always `void _attachThumbnailLate(stored)` — drop the `if (!stored.thumbnail)` guard at `share-script-menu.ts:478`, since the stored row now never carries one at share time (await the pending run first, as today).
- Publish: after the precheck `runScript` (scene now in the worker), call `renderThumbnail()` and keep the bytes; after `publishScript()` / `updateConfigurator()` resolve, upload to `stored.id`. Publish gains the late-attach path it lacks today.
- Remove `THUMBNAIL_OUTPUT_PATH` from both dialogs' output lists.

#### 3. `apps/server` — PNG storage, working-copy endpoint, inheritance on save

**`apps/server/src/services/ThumbnailStore.ts`**:
- `write(author, fileId, versionId, png: unknown, kind)` takes a `Buffer`; validate with a new `checkThumbnailPng(buf, maxBytes)` (replace `svgSanitize.ts`): size ≤ `config.thumbnails.maxBytes`, 8-byte PNG signature, `IHDR` width/height ≤ 2048. Filename `{versionId}-{hash8}.png`; `removeOtherVersions` drops both `.png` and `.svg` siblings for that version.
- New `writeWorking(author, fileId, png, kind)`: same validation, filename `working-{hash8}.png`, prunes other `working-*` files. One file per file-id keeps disk bounded despite one-row-per-save.
- Log events unchanged; `kind` gains `'working'` and `'backfill'`. Update the header comment (browser-generated PNGs, no sanitizer).

**`apps/server/src/services/ScriptStore.ts`**:
- `toRow()` stops copying `data.thumbnail`; it takes `thumbnail` from `opts` like `shared`.
- `saveVersion()` passes `thumbnail: latestRow.thumbnail` (inherit, server-authoritative); `create/share/publish` pass `null`.
- Add `setFileThumbnail(author, fileId, url)`: stamp the latest row (uses `latestRow`, so ownership-gated).

**`apps/server/src/routes/scripts.ts`**:
- Remove `WithThumbnailSvg`, `attachThumbnail()`, and the `thumbnailSvg` handling in `/share`, `/publish` and `PUT /scripts/configurators/:id`.
- `PUT /scripts/:user/:fileId/versions/:versionId/thumbnail`: body is the raw PNG (`request.body` is a `Buffer`), otherwise unchanged (422 on refusal).
- New `PUT /scripts/:user/:fileId/thumbnail` (`auth`, not `authVerified` — a working copy is private): `latestRow` gate, `thumbnailStore.writeWorking`, `scriptStore.setFileThumbnail`, returns `{ success, thumbnail }`.

**`apps/server/src/plugin.ts`**:
- `fastify.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: config.thumbnails.maxBytes + 1024 }, ...)`.
- Static mount: `setHeaders(res, path)` picks `image/png` vs `image/svg+xml; charset=utf-8` by extension; keep `nosniff`, CSP, CORP headers.

**`apps/server/src/config.ts`**: `thumbnails.maxBytes` default → 512 KB (`SERVER_THUMBNAIL_MAX_BYTES`); fix the comments (PNG, browser-generated, working copies). `bodyLimitBytes` comment no longer mentions SVG.

**Delete** `apps/server/src/services/svgSanitize.ts` and its tests.

#### 4. UI — dark-mode ink

- `apps/editor/src/styles/design-tokens.ts`: add `--thumbnail-filter: none`; `dark-theme.ts` overrides it with `brightness(1.7)` (#777 → ~#cacaca, close to the SVG's dark ink `#c9d1da`).
- Apply `filter: var(--thumbnail-filter, none)` to the thumbnail `<img>` in `packages/ui/src/browser/browser-asset-card.ts` (`.preview img`), `packages/ui/src/editor/script-manager-item.ts` (`.thumb`), `manage-configurators-menu.ts`, and `configurator/configurator-header.ts`.

#### 5. Docs/comments to update

`ThumbnailStore.ts`, `config.ts`, `ScriptSchema.ts:196`, `Script.ts:91`, `schema.ts:82-85`, `thumbnails.ts` header, and the `THUMBNAIL_OUTPUT_PATH` comment in `constants.ts` all describe the SVG-in-body flow; rewrite them for the PNG/background flow.

### Footprint

No new dependencies. Roughly +230 net source lines (core +120, editor +130, server −20, UI +8) and about +220 test lines. Client bundles grow by ~3 KB minified in the worker and ~4 KB in the main bundle (≈2.5 KB gzipped together); the server shrinks slightly with `svgSanitize.ts` gone. PNG assets stay in the same 15–60 KB range as the SVGs.

### Tests

- **core** — added to the existing `tests/unit/runner/runner.svg.test.ts` (it already holds the thumbnail tests): stub `Path2D` and pass a recording fake canvas context to `rasterizeThumbnailSVG`; assert viewBox → pixel transform, that `circle`/`polygon` become path data, that `path` data passes through, and that `hidden` elements are skipped. Also: `thumbnailSVGOfLastRun()` is `null` before a run and returns a bare `<svg>` after `execute('box(10,10,10)')`; a second run replaces it.
- **server** rewrite `tests/unit/thumbnails.test.ts` for PNG: a fixture built in-test (valid signature + IHDR + IEND); store writes `.png` with the right URL; oversize / bad signature / wrong dimensions refused; `writeWorking` replaces the previous working file; `saveVersion` inherits the thumbnail and ignores a client-supplied one; HTTP: working endpoint stamps the latest row, version endpoint still 404s a foreign version, static mount serves `image/png` with cache + hardening headers, and a legacy `.svg` still serves as `image/svg+xml`.
- **editor** `tests/thumbnail-service.test.ts` (Node, mocked `execution-service` + `api`): debounce collapses rapid runs into one upload; a newer run supersedes a pending job; backfill runs targets sequentially, waits while `isExecutionBusy()`, and records the skip key when no PNG comes back.
- No existing server test asserts `thumbnail` after `saveVersion`/`create`/`share`/`publish` beyond `thumbnails.test.ts:186-217` (still valid); add one for "saveVersion inherits the latest row's thumbnail and ignores a client-supplied one".

### Verification

1. `pnpm --filter @archiyou/core test`, `pnpm --filter server test`, `pnpm --filter editor test` (check exact filter names in the root `package.json`).
2. Run the app (`/run` skill). In the editor: run a script, wait ~2 s, confirm a `PUT /scripts/{me}/{fileId}/thumbnail` with `image/png` in the network tab and that Home in the browser page shows the card image after navigating there. Edit + run again: a new `working-*.png` URL replaces the old one and the old file is gone from `apps/server/data/thumbnails/{me}/{fileId}/`.
3. Browser page with several old scripts lacking thumbnails: watch them fill in one by one; open the editor and run while backfill is in progress to confirm runs are not delayed noticeably.
4. Share and publish a script: the stored version gets a `.png` thumbnail shortly after the dialog closes; edit a configurator's metadata: its thumbnail is regenerated.
5. Toggle dark mode: line ink lightens on the cards; light mode matches the current grey.
6. Firefox and Safari 16.4+: thumbnails still generate (OffscreenCanvas + `convertToBlob`); on an older browser the console shows the "no OffscreenCanvas" info line and nothing else breaks.

## Review and decisions by the human

- Reviewed and approved the plan: background generation after each editor run plus a backfill from the browser page, PNG instead of SVG, server PNG-only.
- Tested the result and found that a rerun of a large script (`ur_house_detailed`) hung: the isometric hidden-line drawing is too expensive for big models.
- Decided to render the thumbnail with the viewer instead, through a hidden renderer, and approved that approach.
- Chose the picture style step by step: isometric perspective; a technical-drawing look with white fills instead of the realistic view; camera at [-1, -1, 1]; edges in the shape's own colour; less margin around the model; thicker lines.
- Reported that hidden shapes still appeared in the thumbnail; the agent fixed visibility to follow the reconciled scenegraph.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| <<code>> | (the human's summary) | the first prompt (plan) and the style prompts of 2026-09-15 23:24 to 2026-09-16 00:00 |
