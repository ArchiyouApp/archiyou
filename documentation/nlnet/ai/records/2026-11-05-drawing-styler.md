# Drawing styles: Node PDF and the Styler

| | |
|---|---|
| Dates | 2026-11-05 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: asked for the section test and its PDF, wrote the prompts, chose the name (Styler), the drawing ink (stylesheet over model colours) and the scope (Node PDF first, then phase A), reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)
## Section drawing quality: Node PDF fix + class-based drawing styles

### Context

The `sections_test` run (archiyou/sections_test, production DB) showed:
- `Docs.toPDF()` fails in Node: `Cannot find package 'jsdom'` (PDFExporter.ts). Runner, CLI and server can't make PDFs.
- Every line in a drawing has the same weight, and all fills and colours are lost. The per-view CSS
  `.line{fill:none;stroke:black;stroke-width:12.5}` overrides the `fill` and `stroke` attributes that meshup
  writes on `class="line cut"` paths. CSS rules beat presentation attributes, in browsers and in svg2pdf alike.

Goal: (1) PDF works in Node, with as little change as possible. (2) Classes on SVG elements become the single
source of drawing style, driven by one central stylesheet. SVG, PDF, the editor panel and later DXF all render from it.

---

### Part 1 — PDF in Node (minimal; implement now)

What svg2pdf.js 2.7.0 needs (`dist/svg2pdf.es.js`):
- the globals `document` (`createElementNS`, `implementation.createHTMLDocument`, `body`), `CSSStyleSheet` and
  `CSSStyleRule` for style parsing (l.3855);
- a way to measure text: a 2D canvas context (jsdom gives null, so 0) or `SVGElement.getBBox()` (jsdom doesn't
  implement it, so a TypeError at l.4027). Captions use `text-anchor="middle"`, so this is always hit.

The existing `loadDomForNode()` sets only `window`, `document` and `DOMParser`, and leaves them set
permanently. After one export, both `isBrowser()` and `modeler/brep/utils.ts:41` believe the Node process is a browser.

Changes (`packages/core` only):
1. `package.json`: add `jsdom` to `dependencies`. It is already imported lazily through
   `import(/* @vite-ignore */ 'jsdom')`, so browser bundles are unaffected.
2. `PDFExporter.loadDomForNode()`: create the JSDOM once and cache it (as now). Add a `getBBox` stub on the
   jsdom `SVGElement.prototype` for text: width = `getStringUnitWidth(text) * fontSize` from a scratch jsPDF
   doc with the registered Outfit font, height = fontSize.
3. `export()`, Node branch: set `document`, `DOMParser`, `CSSStyleSheet` and `CSSStyleRule` on `globalThis`
   only for the duration of the render, and restore them in `finally`. Never set `window`.
   `_svgStringToElementNode` keeps using the cached jsdom window.
4. Test `packages/core/tests/unit/docs/pdf.node.test.ts`: a document with a scaled view and a caption.
   `toPDF()` returns bytes starting with `%PDF` at the right page size, and `typeof window/document` is
   `'undefined'` afterwards. Then rerun `sections_test` through the Runner with `default/docs/sections/pdf`
   and compare it visually with the Chrome-printed SVG.

---

### Part 2 — Analysis

#### Known approaches (how CAD/BIM style drawings)

| System | Mechanism | What to take from it |
|---|---|---|
| AutoCAD | Layer properties (colour, linetype, lineweight in mm) + plot style tables (CTB/STB) applied at print | Line weights are paper mm; `ByLayer` cascade |
| Revit | **Object Styles** per category with separate *projection* and *cut* line weights, and cut/surface fill patterns. Pen numbers map to mm **per view scale**. View templates. **Filters** (rule-based overrides) > category | Cut vs projection is the core distinction; pens per scale; rule overrides |
| ArchiCAD | Pen sets (pen → colour + mm); building materials carry cut fill + pens; graphic override rules | A material decides the cut hatch |
| Vectorworks | Literally **classes**: graphic attributes per class, objects belong to classes | Same idea as yours, and the same name |
| Bonsai (BlenderBIM) | Drawings are **SVG + a CSS stylesheet**; classes come from the IFC class and properties; hatches are SVG `<pattern>`s; PDF via SVG | Closest precedent; it proves SVG+CSS works for architectural sheets |
| FreeCAD TechDraw | ISO 128 line groups (0.25/0.35/0.5/0.7), hatches as SVG patterns or PAT files | Standard weight series |
| IFC | `IfcCurveStyle`, `IfcFillAreaStyleHatching` | Hatch as data (angle, spacing, line), exportable |

Standards to base the defaults on: ISO 128 line widths (0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, with the
ratio thin:thick:extra-thick 1:2:4), NEN 47 for Dutch architectural practice, and ISO 128-50 hatches.

#### Rating of the proposal

Strong. It matches Vectorworks classes and Bonsai's SVG+CSS, and it fits what we already have: per-view scoped
`<style>`, the `View.css()` hook, `unitsPerMm`-aware paper widths, svg2pdf honouring CSS specificity, and
DOMPurify allowing `<style>` and `<pattern>`. Four refinements make it work:

1. **The stylesheet is data, not CSS text.** Rules like `{ selector: '.cut.insulation', weight: 0.5, fill: 'hatch:insulation' }`
   are compiled into CSS for SVG/PDF, and later into DXF layers, lineweights and HATCH. A panel edits data, not
   strings. With CSS text as the source, DXF and the viewer could never use it.
2. **Values resolve per view at write time.** svg2pdf supports neither `var()` nor `vector-effect`, and a
   paper weight in mm depends on the view's scale (`unitsPerMm`). The compiler therefore writes concrete
   model-unit numbers into the existing scoped `.ay-<page>-<view>` block.
3. **The selector language is a small subset.** Compound class selectors only (`.cut`, `.cut.wood`), with
   specificity = number of classes, and on a tie the later rule wins. That is exactly CSS semantics, and it
   survives svg2pdf, DOMPurify and a DXF mapping.
4. **The cut is a region, not lines.** A fill or hatch needs closed regions with holes (even-odd), plus a paint
   order: fills first, then projection lines, then cut outlines.

Weaker points to accept: CSS can't express "the lineweight of the thickest class wins" across overlapping
paths, and hatches anchored in model space versus paper space have to be modelled explicitly (both are needed:
Revit's model and drafting patterns).

#### Current codebase: what exists and what's missing

Exists:
- meshup `Style` (`packages/meshup/src/Style.ts`): colour, fill, stroke {width, dash}, material, and explicit
  tracking (`explicitData()`). It is a per-shape style, not a class registry.
- Layer cascade: `SceneNode.effectiveStyle()` (`meshup/src/SceneNode.ts:572`), `withCascadedStyles` (`SVGExporter.ts:336`).
- Paper-mm stroke: `stylesheetMm()` (`core/src/modeler/SVGExporter.ts:276`), `widthMm*unitsPerMm`
  (`docs/scale.ts:205`), per-view `lineWeight` (`docs/View.ts:460`), scoped `View.css()` (`View.ts:434`).
- Projection groups `cut`, `visible`, `silhouette`, `hidden`, `fill` (meshup `Mesh.ts:2715, 3127`).
- Material groups (`core/src/materials/materials.json`: wood, insulation, concrete…) and section bitmaps
  (`materials/textures/*_section.jpg`, with `realWidth`/`realHeight`).
- Docs tool shows the SVG inline (`packages/ui/src/editor/tools/document-viewer.ts`). The `docUnitSystem`
  request path (`state/units.ts` → `Runner.ts:1546`) is the precedent for a per-run override.

Missing or broken:
- No class carrier on shapes or layers in either kernel.
- `meshGroupClasses()` (`SVGExporter.ts:430`) writes **one** class per path, and the last group wins.
- Three conflicting style channels: meshup presentation attributes (dead under CSS), brep inline `style=`
  (`brep/Edge.ts:1466`, beats CSS, and its widths are model-mm, not scale-aware), and annotation inline
  `stroke:black` (`annotator/svgPrimitives.ts:95`).
- Hard-coded sheets: `stylesheet()`, `stylesheetMm()`, meshup `ShapeCollection.toSVG` (`:2530`). There are no
  `.cut` or `.silhouette` rules, and `.fill` is taken by the painter occluders.
- Sections merge meshes per *style* (`meshup/ShapeCollection.ts:2385 _groupByStyle`), and cut rings are loose
  polylines (`Mesh.ts:3107`), not regions with holes. A group without a cut logs
  `getGroup(): No group 'cut'` as an error (`ShapeCollection.ts:2411`).
- No `<pattern>`/defs channel in the SVG writer, no hatch library, and no DXF lineweight (370 is fixed at 0)
  or HATCH.
- Captions repeat the scale (`viewFurniture.ts:119`, format `'{name} — {scale}'`).

#### Proposed architecture

- **Name (chosen):** `Styler` (class) in `packages/core/src/docs/styler/`, exposed to scripts as `styler`
  (`styler.set(".cut", { weight: 0.5 })`). It sits beside the per-shape meshup `Style`.

- **Classes on shapes:** `shape.addClass('wall')` / `.classes()`, stored on `Style` as `classes: string[]`. The
  `Style` is already copied by `_inheritStyle` onto projections, already cascades from layers and is already
  serialized, so classes travel for free. A layer's name is an implicit class (`layer('frame')` → `.frame`), and
  so is the material group (`.material('osb')` → `.wood`).
- **Roles** come from the projection groups: `cut`, `visible`, `silhouette`, `hidden`, plus `annotation`,
  `dimension`, `text`. The SVG writer emits **all** groups and classes: `class="line cut wood frame"`.
- **Rules** (data, in paper units):
  `{ weight: mm, color, dash: [mm…], fill: color|'none'|'hatch:<name>'|'image:<material|url>', order: n, visible: bool }`.
  Default sheet (ISO 128-ish): `.line` 0.18, `.silhouette` 0.25, `.hidden` 0.18 dashed 2/1 grey, `.cut` 0.5
  with white fill, `.cut.insulation` hatch, `.cut.wood` hatch, `.annotation` 0.13.
- **Cascade:** default sheet < document `styler` (script) < view `.style()` < editor overrides (panel).
  Specificity is resolved by CSS itself, because we emit real CSS.
- **Hatches:** a library of named patterns: `lines` (angle, spacing, weight), `cross`, `dots`, `insulation`,
  `concrete`, plus `svg` (a custom tile) and `image` (a bitmap tile). Each has `anchor: 'paper' | 'model'`. They
  are compiled to `<pattern patternUnits="userSpaceOnUse">` in the view's `<defs>` with view-scoped ids. Bitmaps
  default to the material's `*_section.jpg` at its `realWidth` (model-anchored).
- **Model colours (chosen):** drawings use the Styler ink; the 3D `.color()` is ignored unless a rule says
  `color: 'model'`.

#### Roadmap and effort (S ≈ ½–1 day, M ≈ 2–3 days, L ≈ 1 week)

| Phase | Content | Effort |
|---|---|---|
| **1** | Node PDF (Part 1) | S |
| **A** | Classes on shapes/layers; all classes emitted; `Styler` data + compiler replacing `stylesheetMm` for doc views; default sheet; meshup attribute channel stripped in doc views; brep and annotations moved to classes; section grouping by classes and quiet no-cut; caption scale fix | L |
| **B** | Cut regions (rings → polygons with holes, even-odd); paint order; `<defs>` channel; vector hatch library (paper/model anchored); bitmap fills from material textures; PDF verification of patterns and images | M–L |
| **C** | Docs tool "Styles" panel: lists classes per drawing (the doc output reports used classes + resolved rules), edits weight/colour/dash/fill/hatch with live preview by patching the `<style>`, then sends overrides with the run request (`docUnitSystem` path); persistence (see open decision) | M–L |
| **D** | DXF: class → layer, lineweight 370 from mm, linetypes from dash, HATCH from vector hatches. Viewer: optionally use the same sheet for flat outputs | M |

### Recommended scope of this implementation round

Phase 1 now, then stop and show the PDF. After that, Phase A, ending with `sections_test` re-rendered (cut 0.5,
projection 0.18, white poché) as SVG and Node PDF. Phases B–D get their own plans.

#### Phase A, critical files
- `packages/meshup/src/Style.ts`: `classes` in `StyleData`, explicit tracking, `copy`/`merge`.
- `packages/meshup/src/Shape.ts`, `ShapeCollection.ts`, `SceneNode.ts`: `addClass`/`removeClass`/`classes()`;
  layer name as an implicit class; `_groupByStyle` keyed by classes as well; quiet no-cut.
- `packages/core/src/modeler/brep/Shape.ts`, `Edge.ts`: same API; `_getSvgClasses` emits groups and classes;
  inline `style=` only for explicit overrides.
- `packages/core/src/docs/styler/Styler.ts` (new) + `defaults.ts` + `compile.ts` (rule → scoped CSS with
  `unitsPerMm`).
- `packages/core/src/modeler/SVGExporter.ts`: `meshGroupClasses` → all classes; `buildSVGDocument` takes the
  compiled CSS instead of `stylesheetMm` for doc views (thumbnails and screen stay on `stylesheet()`); no meshup
  presentation attributes in paper mode (like `compactElement`).
- `packages/core/src/docs/View.ts`, `Document.ts`, `Docs.ts`: `styler` module, `view().style({...})`.
- `packages/core/src/annotator/svgPrimitives.ts`: classes instead of inline black.
- `packages/core/src/docs/viewFurniture.ts`: don't repeat the scale.
- API docs (`archiyou api`) and a guide section in `modeling/pipelines` or a new `drawings` topic.

### Verification
- Unit: Styler compile (specificity, per-scale widths at 1:20/1:50/1:100), the classes round trip through
  `_inheritStyle`/toData, `meshGroupClasses` emitting every class, brep parity (`kernel.parity` cadscripts).
- Node PDF test (Part 1), and `sections_test` via the Runner → PDF: cut lines measure 0.5 mm and projection
  lines 0.18 mm in the PDF (`pdftoppm` at a high dpi and measure), cut regions filled.
- `pnpm test:docs`, `test:runner`, `test:cadscripts` (kernel parity), editor document viewer by hand
  (Save as PDF in the browser still works).
- Disclosure: a record in `documentation/nlnet/ai/records/`, commits via `pnpm commit:ai`.

## Review and decisions by the human
- Name of the central stylesheet: `Styler` / `styler` (the agent proposed `StyleSheet` / `styles`).
- Drawings use the Styler's ink; 3D model colours only where a rule asks for them.
- Scope of this round: Node PDF first (show the PDF), then phase A.
- Approved the Node PDF result (sections_test through the Runner) and its commit.

### Phase A as built, against the plan
- Default weights: `.line` stays 0.25 (the old default, so existing drawings keep their weight),
  `.silhouette` 0.35, `.hidden` 0.18 dashed 3/2, `.cut` 0.5 with a white fill, `.dashed` 2/1.
- No implicit class from a layer's name: a projection draws into the layer that is active when
  it runs, so that layer's name would land on line work it has nothing to do with. Layers carry
  classes explicitly (`layer('frame').addClass('frame')`), which cascade.
- Exports on their own (`shape.toSVG()`, svg outputs) keep the model colours (a laser cutter
  reads them); documents draw in the styler's ink, as decided. A brep `lineWidth()` no longer
  reaches the SVG: one channel, the stylesheet.
- Annotations (dimension lines, labels) keep their inline styling; moved to phase B.
- `make.wall()` gives its parts classes (`timber`, `stud`, `plate`, …, `insulation`); the house
  fixture's iso line work changed with it (refreshed).
- The scene SVG writer (one `<g>` per layer, `--pipeline x:svg`) is unchanged.
- `sections_test` in the production database is not updated: production does not have the styler yet.

### After phase A, asked for while testing `sections_test` (1:20) in the dev editor
- The outer lines of a view were drawn at half weight: the frame clipped half of every line on
  its top and left edges. The frame now leaves room for half the heaviest line.
- Outlines up to 0.5mm to test; the group and class `silhouette` renamed `outline` (the author
  found the word too complex); `group('silhouette')` and `col.silhouette` still work.
- Selectors without the dot of CSS: `styler.set('cut')` (the author's proposal).
- A rule on a class no line has (the author's `styler.set('section', …)`) now warns, naming
  the classes there are (the author chose the warning over a drawing-type class).
- Paint order by line weight, lines before fills, so a heavier line is never half covered
  (the author asked whether ordering by thickness would fix it and scale).
- DXF: an outline was loose lines. Joined in the DXF export first; then, on the author's
  question, in the projection itself (meshup `Mesh._joinPolylines`: joined at any angle where
  exactly two lines meet), which changed the box-corner test, the curve counts in the
  projection tests (now counted in segments) and the house fixture.
- The DXF export draws by the styler (lineweight 370, colour, dashes, not drawn); a
  projection's lines carry their group names as classes so every exporter knows them.
- Phase B begun: `hatch` on a rule (named patterns, own lines, a material's texture or an
  image), fill under the hatch, a part's cut rings as one even-odd path so holes stay open,
  bitmaps in the Node PDF. Not yet: one copy of a bitmap per page, a texture fitted per part,
  annotations as classes.
- DXF fills and hatches as HATCH entities (the author asked to finish them): SOLID for a fill,
  pattern lines for a hatch with the nearest standard name for readers that go by name; the
  white cut fill and bitmaps stay on paper. Checked with ezdxf (audit clean, rendered).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
