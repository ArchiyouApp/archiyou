# Material flow: one source for materials and products, the component as the source of its build-up

| | |
|---|---|
| Dates | 2026-11-21 → (open) |
| Model | Claude, Claude Code agent (the exact model and version: to be added by the human) |
| Tool | Claude Code as agent; the analysis and plan were written and discussed in the conversation |
| Human | Mark van der Net: asked for the analysis, decided the direction, asked to remove fab and materials.json |
| Branch | `material-flow` (in this repository, in `packages/meshup` and in `modules/archiyou-modules`), on top of `energy-module` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Analysis

What gives a shape its real-world meaning, before this unit:

| Layer | Where |
|---|---|
| material properties | `packages/core/src/materials/materials.json` (39 generic materials), the core sheet's `materialen` tab (53, with EN ISO 10456 design values and EN 15804 LCA), `struct`'s own data, literals in scripts |
| products, prices, operations | the core sheet (`producten`, `bewerkingen`), and `fab.json` with its own stock and prices |
| build-up of a component | the core sheet's `componenten` tab, typed by hand ("6 stijlen van 2624 mm h.o.h. 600 mm"), and the parametric component (`timberwall`) that draws the same wall |
| Rc | a formula in the `componenten` tab, on hand-typed layer roles |

The muddy middle: the composition of a component exists twice (script and hand-typed block),
and `products.complete('hsbwand')` stitches the two together.

### Direction (decided by the human)

1. The core sheet is the one source of materials (`materialen`), products (`producten`) and
   operations (`bewerkingen`), online so everyone can check them.
2. `fab` and `materials.json` leave the codebase.
3. The parametric component is the source of the build-up; the reference component block is
   generated from it at the reference size, and builders only price it.
4. Rc comes from the layers in code (ISO 6946), with λ from `materialen`.

### Done in this unit so far

- `modules/archiyou-modules/fab` removed, with its mentions in docs and comments.
- `materials.json`, `tools/materials-generator` and the 22 textures only it used removed.
- `MaterialManager` loads from the `materialen` tab: `materials.fromSheet(url)`, and
  `make.products().fromSheet(url)` loads it from the same sheet. `materials/fromSheet.ts` reads a
  row (density, λ, μ, fire class, strength, recyclability, price, LCA per m³).
- `materials/appearance.ts`: how a material looks (colour, roughness, texture mask), per
  `materiaal_id`. The only material data left in code; it is presentation, not properties.
- A shape assigned to a product takes the product's `materiaal` (column of `producten`).
- Tests on a fixture of real `materialen` rows; an IFC test helper that mistook a 22-character
  material name for a GlobalId fixed.
- First comparison, `timberwall` (production version) at the `hsbwand` reference size
  (3000 × 2700, studs 38×235, wood fibre, double top plate) against the hand-typed block:
  studs 9 st / 0.219 m³ (block 9 / 0.22), wood fibre 10 st / 7.17 m² (block 10 / 7.37); the
  sheathing, gypsum, screws and tape exist only in the block. Rc by ISO 6946 on the model's
  layers 5.33 m²K/W; the sheet's formula (the lower limit only) 5.24.

- The core sheet got the named range `tables.materialen` ('materialen'!A2:AH200, header row 2),
  added by the agent with the service account once the human gave it write access. The other
  table ranges already cover all their rows. Checked end to end: the sheet's xlsx export read by
  cloudcalc, `ProductManager.fromSheet()` loads all 53 materials (houtvezel_flex: insulation,
  λ 0.036, 50 kg/m³, A1-A3 −42 kg CO2-eq/m³; naaldhout_constructief: C24, λ 0.13).

- `make.fasten(from, into, options)` in core (`modeler/fasten.ts`, a lightweight take on what
  `fab` did): finds the faces where parts of `from` lie against parts of `into` (bounding boxes,
  parts square to the axes) and lays screws on them by a pattern ('row' with a pitch, 'end' with a
  count). Each screw is drawn as a circle on its work face and a line along its full length;
  `.screws` gives head, tip and penetration, and it warns when a tip comes out or barely goes in.
  `products.collect()` counts them by product. On the reference wall: 33 × 6×100 (block 32),
  177 × 4.5×50 (block 150), 132 × 4×40 (block 100); the 6×100 through the double top plate come
  out 24 mm, which the check reports.

- `timberwall` (repo example `packages/core/tests/cadscripts/scripts/timberwall.js`) now draws
  what it took from the block: sheathing (houtvezel 16), membrane, gypsum 12.5 as panels with the
  opening cut out, the screws with `make.fasten()` (component `hsbwand`) and the tape along board
  seams and element edges. `products.complete('hsbwand', …, { except })` then adds only element
  work (haaksstellen, hanteren, montagewand, afmonteren). Priced through the real core sheet:
  € 1278 incl. margins (€ 157.8/m², block € 154.5/m²), 347 kg, A1–A3 −302 kg CO2-eq. Known gaps:
  board sheets counted without offcut reuse (10 vs 6 in the block); sloped plates (with a ridge)
  get no screws, contacts are axis-aligned only. The production version of the script is
  unchanged; the human saves the new one in the editor.

- Variants as presets, blocks generated from them. `timberwall` declares its variants with
  `$PARAMS.preset(id, values, { label, variantOf })` (ParamManager now keeps those options):
  `hsbwand` (235, wood fibre, wood fibre sheathing, gypsum), `hsbwand-esb` (ESB 15 as
  sheathing), `hsbwand-140` (SLS 38x140; the human asked for a simple wall of about 10 cm with
  Rc about 3: 38x89 gave Rc 2.2, 38x120 2.8, 38x140 3.2, the human chose 140).
  `materials.rc(shapes)` (materials/rc.ts): ISO 6946 combined method over a grid of paths, λ from
  the shapes' materials. `products.block()`: per product its quantities and the steps of its
  recipe, then the element work. `archiyou blocks <script> --sheet <url> [--write]` (CLI
  blocks.ts, sheetBlocks.ts, google.ts) runs each preset with the sheet and writes its block to
  the tab `componenten_gegenereerd`, taking layout and formulas from the base block in
  `componenten` (row numbers moved), the name with the Rc. The sheet computes the same totals as
  the code to the cent (€ 157.83 / 162.28 / 138.25 per m2 incl. margins; Rc 5.24 / 5.18 / 3.24).
  Decided by the human: the two ratio factors (aftekenen, tape split) stay as fixed ratios from
  the hand block; the difference is well under 1 %.

- The generated blocks replaced the hand-typed `hsbwand` in `componenten` (asked by the human),
  with `hsbwand_esb` and `hsbwand_140` after it; ids with `_`, as a named range cannot hold `-`.
  The writer puts rows in before it takes the old block out, so the block it replaces is the
  template of its formats; it moves or makes the named ranges `outputs.<id>.*` and added the
  column "variant van" (also to `tables.componenten`); `core.gs` seeds builder rows with it. The
  hand block's comparison rows (ELEMENTEN 2023) went with it. A copy of the tab and its named
  ranges from before was kept locally by the agent.

- The componenten tab as a table (decided by the human after weighing a fully normalised model,
  which they found unreadable): the block's grouping stays (first row, products with their
  operations, element work), but the component's id is on every row, no totals or per-block named
  ranges, each formula reads its own row (an operation's quantity is factor x its product's rows by
  SUMIFS). Totals only in the builder overview. Converted in a trial copy of the core
  (`URBUILD_DATABASE_CORE (proef componententabel)`) by a one-off script of the agent: all 21
  components priced as before (largest difference 0.5 cent); operations on a product that had two
  rows were merged. Element work became rules per element or per m2 (`per`, `factor`).
- Code for the table: `readBlocks()` reads both layouts (BlockInfo, gwp, element work per
  element / per m2); `fromSheet()` finds the components from their first rows; `prices()` and the
  order table take names and costs per unit (with the margins) from the rows; `elementWork()`
  counts per element. `assign`/`add` take `recipe` (follow another product's recipe): the ESB board
  in `hsbwand_esb` had been given the gypsum's plamuren (+ € 64.80 per element) by a merged
  recipe; `timberwall` now says it follows the wood fibre board. Lines got Dutch labels,
  `make.fasten` a `label`. `core.gs` adds the totals up for builder seeds, `coreSpecs` reads Rc and
  CO2 from the rows. The CLI writer writes table rows with provenance columns (variant van, bron,
  bron-id, preset, via, gegenereerd); a local file's bron is its name and a hash of its code.
- The cadscript snapshot tables (coverage, parity, round-trip) differ for timberwall (more parts:
  boards and screws, intended) and for scripts outside this unit (number_ranges_demo,
  kakpinchedstool, tomy); not updated, for the human to decide.

### Next

1. The deployed Apps Script library needs the new `core.gs` (variant van) by the human.
2. Generate the reference block from the component and compare it with the hand-typed one.
3. Heat capacity per component in the `energy` module (Rc is done, see above).

## Review and decisions by the human

- fab and materials.json out of the codebase; the `materialen` tab is the source.
- `timberwall` is the source of `hsbwand` (the same one `ur_house_detailed` uses).

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
