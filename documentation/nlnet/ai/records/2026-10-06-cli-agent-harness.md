# CLI and skill for coding agents (`archiyou` package)

| | |
|---|---|
| Dates | 2026-10-06 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent: plan researched and tested with a prototype in chat, reworked twice with the human, then implemented |
| Human | Mark van der Net: asked for the image-to-model user story and its test, reviewed the chair model and found four structural errors, decided on a separate CLI package and on tools for existing agents first, approved the plan |
| Branch | `agent` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Context

A coding agent (Claude Code and similar) can already write Archiyou scripts, but it works blind: it cannot
run a script, see the result, or look up the API without loading a 441 KB reference. The goal is the
smallest harness that closes that loop: write script → run headless → read a compact summary → look at
line-drawing views → fix.

Decisions taken with Mark:
- 2026-10-06: line views without a browser; CLI tests plus a small hand-run eval set.
- 2026-10-07: the CLI gets **its own package** (`packages/cli`), built to run with `npx`, instead of
  a script inside `apps/server`. **Tools for the agent the user already has come first**; Archiyou's
  own agent comes later, as a subcommand. Non-developers are reached through the editor, not the
  terminal (see "Product shape").

#### Product shape

| | What | Who brings the model and the loop | Status |
| --- | --- | --- | --- |
| **A. Tools + skill** | `npx archiyou init` puts the skill in the project; the user's agent then calls `archiyou run / sweep / api / docs` | the user's coding agent (Claude Code, Codex, Cursor) and its subscription | this plan |
| **B. Own agent** | `npx archiyou agent "make a parametric model from the photos here"` | Archiyou: agent SDK, user's API key from an env var, the skill as system prompt, A's functions as tools | Later |
| **C. Editor co-AI** | drop photos into the editor, same functions server-side, key on the server | Archiyou server | Later (`plans/CO_AI.md`) |

With A, the developer experience is two steps: `npx archiyou init` in a folder with sketches and photos,
then ask the agent in plain words: "I have some sketches and photos here, make me a parametric model."
That sentence starts a conversation, not a batch job: the chair test (§5) showed the agent has to ask
for a scale and confirm the parameters. B mainly serves developers without an agent; C serves
Archiyou's own audience (designers, makers), who will not use `npx` with an API key. B and C reuse A's
functions, so A is the foundation either way.

#### What the research says (text-to-cad, agentcad, cad-khana, build123d-mcp, Zoo, CADCodeVerify)

- **CLI, not MCP**, for coding agents. Results on stdout, noise on stderr, exit code 1 on failure, errors
  short and pointing at a script line.
- **A run prints numbers, not just pictures**: bbox, per-shape size and volume, shape count. Images miss
  wrong dimensions; numbers miss wrong shapes. Both are needed.
- **Images are files the agent opens itself**: iso plus a few orthographic views, labelled, on one sheet.
  "Do not loop on snapshots."
- **Docs by progressive disclosure**: a short SKILL.md with conventions and a task table, lookups on demand,
  runnable examples. No big reference in context.
- **No universal validation report** (text-to-cad removed theirs). Keep checks to what the summary shows.
- **Evaluation**: a prompt set with expected geometry metrics (bbox, volume) and a builds-at-all rate.

#### What already exists in the repo (reused, not rebuilt)

| Need | Existing piece |
| --- | --- |
| Headless run | `new Runner().load()` + `runner.execute({kernel, script:{name, code, params}, params, outputs})`, pattern in `packages/core/tests/cadscripts/run.cadscripts.test.ts:28-52` |
| Publishable core | `@archiyou/core` 0.9.0 and `@archiyou/meshup` 0.4.0 have `publishConfig` pointing at `dist/` (tsup, ESM). Not on npm yet. Core's build is `platform: 'browser'` (§0) |
| Running core from source under tsx | `apps/server/tsconfig.runtime.json` (legacy decorators, meshup from `dist/`) and the meshup-dist guard in `apps/server/src/execution/worker.ts:28-38` |
| Line views | `modeler.toProjectionSVG({view} or {cam})` (`packages/core/src/modeler/Modeler.ts:1162`, options `SVGExporter.ts:74-100`): stroke-only hidden-line drawing, hidden lines dashed |
| SVG → PNG | `@resvg/resvg-js` (prebuilt binaries per platform, about 4 MB), used in `apps/server/src/services/SocialCard.ts` |
| Error with script line | `result.errors[0]` (`lineStart`, `lineEnd`, message with excerpt), `Runner.ts:1132` |
| API reference | `packages/ui/src/editor/help/api.generated.json` (441 KB, 1260 entries: `sig`, `doc`, `params`, `examples`) |
| Guide and examples | `help/guide/en/**/*.md` (75 KB of text), `packages/core/tests/cadscripts/scripts/*.js` (17 scripts) |
| Skill layout | `.agents/skills/<name>/SKILL.md` + symlink in `.claude/skills/` (as `archiyou-local-db`) |
| npm name | `archiyou` exists and is ours (0.7.2, "Archiyou script CAD engine", maintainer info@archiyou.com, last 2026-07-30) |

### Design

#### 0. Prerequisite: core runs in plain Node

Tested 2026-10-07: `pnpm pack` of core, meshup, collada-wasm and gdrr2bp-wasm, installed with npm in an
empty directory (what `npx` would do), then a box run from a plain `.mjs`:

1. **Import fails**: `PDFExporter.ts:26` has `import 'svg2pdf.js'`. Plain Node ESM resolves its `main`,
   the UMD build, which reads a global `jspdf` and throws `Cannot read properties of undefined
   (reading 'jsPDF')`. Under tsx (the server) it works because tsx compiles to CommonJS.
2. **Brep kernel fails** (with a `globalThis.jspdf` workaround in place): the build is `platform:
   'browser'`, so `node:url`/`node:path` are replaced by browser shims and `OcLoader._getAbsPath` throws
   `fileURLToPath is not a function`.
3. **A mesh run returned `status: 'error'` with an empty message.** Cause not yet known.

Also measured: tarballs 28 MB (core) + 19 MB (meshup); the install is 180 MB of `node_modules`, mostly
jspdf (29 MB), core-js (16 MB, via jspdf) and our own packages (89 MB). `npx` downloads this once per
cache. Acceptable for v1; reduce later.

Fix (core, about 30 LOC):
- `PDFExporter.ts`: import svg2pdf's ES build, or import it lazily inside the export path after
  jsPDF. The PDF export then also works for any other Node ESM consumer.
- `tsup.config.ts`: a second config, `platform: 'node'`, `outDir: 'dist/node'`, same entries and wasm
  copying; `publishConfig.exports["."]` gets a `"node"` condition before `"default"`.
- Find the cause of (3).
- Bonus: with a Node build, `apps/server` could drop `tsconfig.runtime.json` and the meshup-dist guard
  later. Not in this plan.

#### 1. CLI package: `packages/cli` (about 515 LOC of source)

```
packages/cli/
  package.json         name "archiyou" (open decision below), bin { "archiyou": "dist/archiyou.js" },
                       deps @archiyou/core (workspace:*), @resvg/resvg-js; engines node >= 20
  tsup.config.ts       platform node, ESM, shebang banner, dependencies external; copies data/ into dist
  tsconfig.json        + tsconfig.runtime.json for running from source under tsx (as apps/server)
  src/archiyou.ts      arguments, dispatch, init                                           ~90
  src/run.ts           run, summary, views sheet, clash, check, overlay, sweep, eval       ~320
  src/lookup.ts        api, docs, examples, mark                                           ~105
  skill/SKILL.md       the skill: one source, copied by init and symlinked in this repo
  tests/cli.test.ts
  scripts/pack-smoke.sh
```

- **Data**: the API JSON, the guide pages and the example scripts are copied into `dist/data/` at build
  time, because an `npx` user has no repo. From source, `lookup.ts` reads the repo paths.
- **In the repo**: `"dev": "tsx --tsconfig ./tsconfig.runtime.json src/archiyou.ts"`; root
  `"archiyou": "pnpm -s --filter archiyou dev"`. Paths resolve against `INIT_CWD` when set (the filter
  changes cwd), otherwise against `process.cwd()`.
- Arguments parsed by hand; no CLI library.
- **Safety**: `run` executes the script in-process with full Node rights, the same as any code the
  user's agent runs. Stated in the README and skill. A worker without file-system access is Later
  (`plans/SAFE_EXEC.md`).

**`archiyou init [--force]`**
- Writes the skill to `.agents/skills/archiyou/SKILL.md` and `.claude/skills/archiyou/SKILL.md`
  (copies, since symlinks are unreliable on Windows) and adds a marked block to `AGENTS.md`, creating it
  if missing. Idempotent; `--force` refreshes an older copy.
- Prints the next step: "open your agent in this folder and describe what you want to model."

**`archiyou run <file.js> [-p NAME=value]… [--kernel mesh|brep] [--views iso,top,front,right,cam:x,y,z] [--ref img]… [--overlay img@cam:x,y,z@x0,y0,x1,y1]… [--clash] [--check inventory.json] [--out dir] [--json] [--verbose]`**

- One process per run (the Runner leaks state between runs).
- Stdout summary, compact text by default:
  ```
  OK  shelf.js  mesh  1.8s  units mm
  size 800 x 300 x 1200   shapes 7
  params WIDTH=800 DEPTH=300 HEIGHT=1200
  path            type      size               volume
  /side_left      Mesh      18 x 300 x 1200    6480000
  /shelves        layer(4)  764 x 300 x 900    16502400
  messages: …(script print() output)
  metrics: …
  clashes 0
  files: /tmp/archiyou/shelf/model.glb  /tmp/archiyou/shelf/views.png
  ```
  On failure: `ERROR line 12: <message>` plus a ±2-line excerpt, exit code 1. Without a line, the
  message alone, never `line undefined`.
- `--json` prints the same data as one JSON object.
- Per-shape table from the live scope after the run: `runner.getScope('default').modeler.scene()` →
  `path()` (decoded), type, `shapes().bbox()`, summed `volume()`. No area (slow). Unnamed parts are
  counted with a hint to use `.name()`.
- Metrics values via the `default/metrics/*/json` output (`meta.metrics` holds names only).
- Views: `toProjectionSVG({view})` or `({cam})` per tile on the live scope, one labelled contact
  sheet `views.png`. `--ref` images (jpeg/png) come first on the sheet (§5).
  - resvg ignores `vector-effect: non-scaling-stroke`, so the CLI rewrites stroke width and dash length
    relative to the viewBox (otherwise lines are 8 px on a small part and invisible on a 5 m model).
  - White background, about 520–800 px per tile, time per view with `--verbose`.
- `--clash`: pairwise interference; `--check`: the model against the inventory; `--overlay`: model
  lines drawn over a photo (all §5).
- Clean stdout: silence `console.*` (skipped with `--verbose`) and print with `process.stdout.write`
  only, because the Runner swaps `globalThis.console`. This includes the
  `ShapeCollection::getGroup(): No group 'hidden'` warnings from the projection (about 30 per run).
- Default `--out` is `os.tmpdir()/archiyou/<script name>/`; always writes `model.glb` and `views.png`.
- Core is imported dynamically inside `run`, so `api`/`docs` stay instant. Cold start about 4 s; no
  daemon or watch mode in v1.

**`archiyou sweep <file.js> [--clash]`** (§5): one run per parameter at its minimum and maximum,
one table.

**`archiyou api <query>`**
- `archiyou api box` → best matches (name, then `Owner.name`, then doc text), max 8: signature, doc,
  params, first example.
- `archiyou api Mesh` (a class) → one line per member, `name(sig): Returns`.

**`archiyou docs [topic]`**: without a topic, the list of guide pages; with one, that page as Markdown
(images dropped). **`archiyou examples [name]`**: the list of example scripts, or one script.

**`archiyou mark <photo> <marks.json>`** (§5): the photo with numbered markers and a legend, for the
user to confirm the inventory.

**`archiyou eval <dir>`** (§4).

**Open decision: the npm name.** `npx archiyou` is the best command, and the name is ours, but it now
holds the old engine (0.7.2). Option 1: publish the CLI as `archiyou` 1.0 and deprecate the engine
versions with a pointer to `@archiyou/core`. Option 2: `@archiyou/cli` with bin `archiyou`
(`npx @archiyou/cli init`). Recommendation: option 1. Publishing itself (core, meshup, collada-wasm,
gdrr2bp-wasm, then the CLI) is a separate step after this plan, on Mark's go.

#### 2. Core fix: `-p` values for inline params (about 7 LOC)

Today a value for a param that the script only declares with `$PARAMS.define()` is silently dropped
(`Runner.ts:1422-1428` only iterates stored definitions). All example scripts are written that way, so
without a fix the agent could never test variants (confirmed in §5).

- `Runner._executionStartRunInScope` (after :1433): hand the request values to the manager
  (`scope._paramManager._requestValues = paramValues`).
- `ParamManager.define` (:603): `prevVal = existing?.targetParam?._value ?? <case-insensitive lookup in _requestValues>`.
  The existing `validateValue` gate at :607 still applies.
- Behaviour change is limited to requests carrying a value for a name without a stored definition, which
  is ignored today. Before implementing, check what the editor and configurator put in `request.params`
  (`apps/editor`, `packages/ui/src/configurator`) to confirm no stale values would start applying.
- Guard in the same method: a non-object entry in `script.params` gives a clear error. Today it
  gives "Cannot create property '_value' on number" without a line (§5).
- The CLI coerces `-p` values with `JSON.parse`, falling back to the string.

#### 3. Docs: one skill, `packages/cli/skill/SKILL.md` (about 130 lines)

One source: `archiyou init` copies it into user projects; in this repo `.claude/skills/archiyou-cad` is a
symlink to it. It refers to **CLI commands, not repo paths**, so it works the same in a user's folder.
Everything it points at is already tested (every tutorial step and `@example` runs in
`runner.help.test.ts`).

Contents:
1. **Conventions** the API reference does not carry (from plans/CO_AI.md §3): implicit globals (no
   `let`/`const` needed), `units('mm')`, `$PARAMS.define` and `$NAME`, layers, colours, `.name()` on
   every part, mesh kernel by default, no `import`, no `await`.
2. **The loop**: write `<name>.js` → `archiyou run` → read the summary first (sizes, volumes, shape
   count against the request) → open `views.png` once → fix. Do not loop on images; rerun with
   `-p` to test a variant; finish with `archiyou sweep --clash`.
3. **Task table** (progressive disclosure): API member → `archiyou api <name>`; sketching →
   `archiyou docs sketching`; booleans → `archiyou docs csg`; selectors → `archiyou docs topology`;
   params and presets → `archiyou examples programmaticparams`; timber →
   `archiyou examples timberwallopenings`.
4. **Repair table**: symptom → fix (param value ignored, empty scene, shape has zero volume,
   brep-only primitives need `--kernel brep`, clashes).
5. **From images** (§5): the brief and the inventory come before any code.
6. **Ask, don't guess**: the brief (scale anchor, inventory, parameters) is confirmed with the user
   before modelling.
7. **Axis convention** for scripts and checks: x width, y depth (front at y = 0, back positive), z up,
   floor at z = 0.
7. In this repo only: saving to the script database is a separate step via the `archiyou-local-db` skill.

#### 4. Testing and evaluation

- **Core**: `packages/core/tests/unit/execution/ParamManager.test.ts`, about 20 lines: a request value for
  an inline-defined param is honoured, an invalid one falls back to the default.
- **CLI**: `packages/cli/tests/cli.test.ts`, about 100 lines, run as a subprocess (the tsx dev entry)
  so stdout cleanliness and exit codes are tested too:
  - `run` on a fixture script: the summary has size and shape rows; `model.glb` and `views.png` exist and
    the PNG is non-trivial
  - `-p` changes the bbox
  - a broken script exits 1 with a line number
  - `--ref` adds a tile
  - a clash fixture with one known overlap reports exactly that pair
  - `sweep` on `programmaticparams.js`
  - `api box` returns a signature; `docs csg` returns text
  - `init` in a temp dir writes the skill and an `AGENTS.md` block, and a second run changes nothing

  Skipped when `packages/meshup/dist` is missing.
- **Pack smoke test (hand-run, needs network)**: `packages/cli/scripts/pack-smoke.sh`, about 20 lines.
  It packs core, meshup, collada-wasm, gdrr2bp-wasm and cli, installs them with npm in an empty temp
  directory, and runs `npx archiyou init` and `npx archiyou run` on a box script. This is the `npx`
  guarantee; it caught the three §0 problems.
- **Eval set (hand-run, not CI)**: `packages/cli/evals/evals.json`, about ten prompts from simple to
  parametric (box with holes, shelf with N shelves, L-bracket, table from the tutorial, timber wall with
  opening), each with expected `size`, optional `volume`, and a tolerance; plus image items (§5).
  - An agent session solves them into a directory (`<id>.js`); `archiyou eval <dir>` runs each and prints
    a table: builds / size within tolerance / volume within tolerance / sweep clean, plus totals.
  - Used to measure a skill or docs change before and after. No image comparison.
  - Not published (`files` in package.json leaves `evals/` out).

#### 5. User story: a parametric model from images

> A user has one or more images of a design (for example a chair) and asks to model it in Archiyou
> in a parametric way.

How it differs from a text prompt:
- **Input is pictures.** The agent reads image files itself, so the harness does nothing for the input.
- **Photos carry no scale.** The agent needs an anchor: a size from the user, a published size, or an
  ergonomic standard. It writes the anchor and its assumptions in the script header.
- **Checking is visual, against photos taken from any viewpoint in perspective.** Standard
  iso/front/right views rarely match a photo; a view from the photo's own camera does.
- **"Parametric" means the model holds at every value**: it builds and nothing interpenetrates at
  each parameter's minimum and maximum. Line views cannot show this (see the test).

What it adds to §1 (counted in its LOC):

| Addition | What | LOC |
| --- | --- | --- |
| `run --ref <img>` (repeatable) | the photos become the first tiles of `views.png` (jpeg/png as a data URI in the sheet SVG), so one image read compares model and photo | ~15 |
| `--views cam:x,y,z` | a camera direction next to the named views. Convention: vector from model to camera, z up (tested: `cam:-1,-0.3,0.25` is the chair's left side, front to the right). Tile label shows it | ~5 |
| `run --clash` | pairwise interference: bbox prefilter, then `a.intersection(b).volume()` above 100 mm³, reported with part paths. Face contact measures ~0, so touching laths are fine | ~20 |
| `sweep <file> [--clash]` | one run per parameter at its minimum and maximum (from the definitions), printed as one table: value, builds, size, clashes, and the script's `print()` lines (derived values) | ~30 |
| summary | decode paths (`Mesh%5B0%5D` → `Mesh[0]`) and count unnamed parts, asking for `.name()` | ~3 |

Added after the second review (see "Second review" below), about +95 LOC:

| Addition | What | LOC |
| --- | --- | --- |
| **The brief** (skill only) | before any code, a short brief the user confirms: is the design within reach, photo coverage, scale anchor, inventory, parameters | - |
| `inventory.json` + `run --check` | the parts read from the photos, as data; the run compares the model with it and lists every mismatch | ~35 |
| `archiyou mark <photo> <marks.json>` | the photo with numbered markers and a legend; the agent places the markers, the user checks what was counted | ~25 |
| `run --overlay img@cam:x,y,z@x0,y0,x1,y1` | the model's lines drawn semi-transparent over the photo, fitted into the object's rectangle in the photo; added as a sheet tile | ~35 |

**The brief** (first step of "From images"; no script before the user confirms it):
- *Within reach?* Mostly straight members, boards and simple slopes: good. Curved or organic shapes and
  upholstery: say that the result will be an approximation.
- *Coverage*: which sides the photos show (front, side, ¾, top, back) and which are missing; at least
  three sides, otherwise ask for more photos.
- *Scale anchor*: one known dimension (from the user, a published size, or a standard).
- *Inventory*: every part with its direction and contacts, shown as a marked photo (`archiyou mark`).
  Count from the photo that shows most, then cross-check the count in each other photo. Designer cues
  help (the Red-Blue chair's yellow squares are exactly the crossbar ends).
- *Parameters*: names and ranges.

**`inventory.json`** (written with the brief, checked on every run):
```json
{
  "count":  { "crossbar*": 5, "frontLeg*": 2, "middlePost*": 2, "rearPost*": 2, "rail*": 2, "arm*": 2 },
  "axis":   { "crossbar*": "x", "rail*": "y", "*Post*": "z", "frontLeg*": "z" },
  "floor":  ["frontLeg*", "rearPost*"],
  "notFloor": ["middlePost*"],
  "relations": [["backTop", "behind", "rearPost*"], ["seatRear", "inFront", "middlePost*"]]
}
```
- Name globs match part names (`.name()`), so the skill requires names that follow the inventory.
- Checks, all from bounding boxes: count per glob; long axis; floor contact (lowest point within 1 mm of
  z = 0); relations `behind`, `inFront`, `above`, `below`, `touches` (gap below 0.5 mm), using the
  axis convention of §3.
- Output: `check 3 mismatches` with one line each, e.g. `crossbar*: 6, expected 5`,
  `middlePostL touches the floor`, `backTop is in front of rearPostL`. Also in `--json`, and counted in
  `sweep` and `eval`.

**`--overlay`**: the agent gives the camera direction it found for the photo and the object's outer
rectangle in the photo (pixels). The CLI scales the projected drawing to fit that rectangle and draws it
in a contrasting colour over the photo. A post that runs to the floor shows as a line continuing past
where the photo's post stops; an extra crossbar shows where the photo has none. Product photos are
taken with long lenses, so the orthographic projection is close enough; fitting from matched points and
perspective are Later.

Skill section **From images**:
1. The brief, with `inventory.json` and the marked photo, confirmed by the user.
2. Find a `cam:` per photo and keep it for the whole session.
3. Pick one driving part and place the others against its faces rather than at fixed coordinates.
4. Name every part after the inventory.
5. Each round: `run --check inventory.json --overlay …`; mismatches first, then the images.
6. Before finishing: `archiyou sweep --clash` is clean, `--check` has no mismatches, and the derived
   values are sane.

Eval: image items in `evals.json` with `images` (in `packages/cli/evals/images/`, CC0/CC BY only,
attribution in a `CREDITS.md` next to them), expected size with 10 % tolerance, `minParams`,
`sweepClean: true`, and a reference `inventory.json` written by hand; `archiyou eval` runs the sweep and
the check for those items. The reference inventory scores the structure, which the size alone cannot. Candidates: the Red-Blue chair
below, a three-legged stool, a trestle table.

##### Test run (2026-10-06, prototype, nothing committed)

A throwaway `run` (about 120 LOC, with `--ref`, `--cam`, `--clash`, `-p`) in the session scratchpad,
run with `tsx --tsconfig apps/server/tsconfig.runtime.json`. Subject: the Rietveld Red-Blue chair, from
six Wikimedia Commons photos (CC BY 2.5 Sailko, public domain, CC BY-SA 3.0). Anchor: the published
size 66 × 83 × 88 cm, seat 33 cm.

Result: `rietveld.js` (repo root, untracked), 20 named parts, 6 parameters (seat height, height, width,
frame depth, lath section, back angle). The default is 660 × 775 × 880 against 660 × 830 × 880 published
(depth −7 %). It builds and has no clashes at all 12 parameter extremes; a run takes 0.1–0.2 s plus a
~4 s cold start, and the clash check 15–20 ms for 20 parts. **But its structure is wrong in four places**
(round 7, found by Mark): geometrically clean, the right size, and still not the Red-Blue chair.

| Round | What happened | What caught it |
| --- | --- | --- |
| 1 | From the front photo alone: arms put at the front on tall front posts. Wrong; they sit over the rear half on two full-height posts | the side photo next to the views; the size (660 × 973 × 992) would also have flagged it against the published size |
| 2 | Structure redone from the side photo. `cam:-1,-0.3,0.25` matches that photo; from then on that one tile did most of the comparison work | photo and camera tile side by side |
| 3 | Proportions from the side photo: arm posts close together at the back, back board foot low, steeper seat | same |
| 4 | Sweep: all 12 extremes build, but the side views show the board through the seat at BACK_ANGLE 20/40 and FRAME_DEPTH 560, and merged rails at SEAT_HEIGHT 280. The side view also shows false overlaps (the posts lie outside the board's width) | side views at the extremes |
| 5 | `--clash`: even the **default** had four interpenetrations invisible in every view (seat 14 mm into the front bar, board through three crossbars) | clash check only |
| 6 | Rewritten so the back board drives the frame: the bars sit against its faces, and the seat ends where its underside meets the board. 0 clashes at all extremes; HEIGHT now exact (887 → 880) | sweep + clash + size |
| 7 | Review by Mark with a clean side photo (Cassina product shot): 6 crossbars instead of 5; the back board's top bar in front of the rear posts instead of behind; the middle posts on the floor instead of hanging from the arms; an invented mid rail per side. 16 laths against 13 | the user, with a photo the agent never enumerated. No tool caught it |

##### Second review (2026-10-07): what the user found

| | Original (13 laths) | `rietveld.js` (16 laths) |
| --- | --- | --- |
| Crossbars | 5: seat front, seat rear, front bottom, back-board foot, back-board top | 6: an extra rear bottom bar |
| Back board's top bar | behind the rear posts; the board leans back onto it | in front of the rear posts |
| Middle posts | hang from the arms, rest on the side rail and run one lath past it; not on the floor | floor to arm |
| Side rails | one per side | two per side: a "mid rail" invented to carry the seat's rear bar, which is fixed to the middle post |

**Root cause.** I modelled from a prior of how a chair is built (legs on the floor, crossbars low at
front and back, a support under every board) and used the photos for overall comparison only. The side
photo I had (`Rietveld_chair_3`) shows all four errors; I never went through it part by part. Every check
was geometric (size, clashes, sweep); nothing checked structure (how many parts, what touches what,
what stands on the floor).

**Lessons**, each turned into a tool or rule above:
- Enumerate before modelling: the inventory and the brief, confirmed by the user (the user's look at a
  marked photo is the cheapest reliable check).
- Make structure checkable: `--check` turns counts, floor contact and relations into mismatches.
- Counting thin, identical, half-hidden parts is a weak spot of vision models. Hence counting per photo
  with a cross-check, designer cues, and the marked photo for the user.
- Compare in one image, not two: `--overlay` puts the model on the photo, where misalignment is easier
  to see than differences between two separate pictures.
- Gate the attempt: the brief states whether the design is within reach and which views are missing,
  before any script.

**Considered, deferred: reconstructing from the photo's lines.** In a photo of a right-angled design the
edges meet in three vanishing points; from them the camera and proportions can be recovered
(single-view metrology), including whether a post's foot lies on the floor plane. Doing that needs line
detection, vanishing-point grouping and calibration (an OpenCV dependency), and the agent's own pixel
reading is not precise enough to do it by hand. The overlay checks the same relations in the opposite
direction (model into photo) with what exists. Vanishing points stay in Later, mainly to score
automatically how right-angled a design is for the brief.

##### Reflection: what to keep, what to change

(Written after round 6, before Mark's review; round 7 and "Second review" above correct it.)

Worked:
- Several photos from different sides were essential; one frontal photo gave a wrong structure.
- Photo next to a camera-matched line view: the cheapest comparison, one image read per round.
- The numbers summary with named parts caught size errors and the height overshoot.
- The clash check decided whether the model was parametric. Neither the images nor the sizes could.
  (It could not decide whether the model was *right*: see round 7.)

Went wrong or cost time, and the fix:
- **Wrong structure from the first photo.** Skill step (2): part list and contacts per photo before
  any code, then check against all photos.
- **No scale in the photos.** I used a published size from memory; skill step (1) makes the anchor
  explicit and has the agent ask when there is none.
- **`cam` direction was undocumented**; I found it by trying. Document it in the skill and label tiles.
- **§2 confirmed**: `-p` on inline params is dropped, so the prototype had to run twice (read the
  definitions, then pass them as stored ones). §2 is a prerequisite for `sweep`.
- **A wrong request shape gave a bad error**: values in `script.params` instead of `params` gave
  "Cannot create property '_value' on number '560'" with no line. The CLI builds the request itself;
  guard added in §2.
- **Stderr noise**: `toProjectionSVG` prints `ShapeCollection::getGroup(): No group 'hidden'` about
  30 times per run. Silenced in the CLI; the cause in the projection code is worth a look.
- **Parts made in `.map()` were unnamed** and listed as `Mesh%5B0%5D`. Fixed by naming the parts in
  the script and by the summary changes above.
- **Line drawings lose colour**, which was the main cue in these photos. `strategy: 'painter'` emits
  fills and needs convex, non-interpenetrating shapes, which clash-free furniture is. Try that as an
  optional coloured view (Later).
- **Most effort went into trigonometry**: placing sloped boards against bars by hand. A helper that
  puts a part against or on another part's face would remove most of it (Later; `align()` works on
  axis-aligned bboxes only).
- **Clash-free is not the same as usable**: FRAME_DEPTH 560 builds clean but gives a 28° seat; LATH 25
  makes the width 675 against WIDTH 560–800 (the arms overhang). The sweep table therefore shows the
  script's `print()` lines (derived values) next to the size, so the agent judges them. Also check each
  param against the size it names (`WIDTH=560 → size x 560`).
- **Skill and tooling gotchas**: (a) `CADSCRIPT=<name> pnpm test:cadscripts` also fails the three
  table tests (parity, coverage, round trip), because they compare against the full set. Expected,
  but it reads like a failure; the skill should say so, or those tests should skip when filtered.
  (b) `save-script.ts` does not load the root `.env`, so it quietly picked PGlite and said "No user
  archiyou" while the server database was meant. It should load `.env` or print why it chose
  PGlite. (c) The agent's write to the shared database was blocked by the permission check; the
  user runs the save.

### Files

| File | Change | LOC |
| --- | --- | --- |
| `packages/core/src/docs/PDFExporter.ts` | svg2pdf import that works in Node ESM (§0) | ~3 |
| `packages/core/tsup.config.ts`, `packages/core/package.json` | Node build in `dist/node`, `"node"` export condition (§0) | ~25 |
| `packages/core/src/execution/ParamManager.ts`, `packages/core/src/runner/Runner.ts` | param fix and request guard (§2) | ~12 |
| `packages/core/tests/unit/execution/ParamManager.test.ts` | test | +20 |
| `packages/cli/package.json`, `tsup.config.ts`, `tsconfig.json`, `tsconfig.runtime.json` | new package | ~70 |
| `packages/cli/src/archiyou.ts`, `run.ts`, `lookup.ts` | new: init, run, views, clash, check, overlay, sweep, eval, api, docs, examples, mark | ~515 |
| `packages/cli/skill/SKILL.md` | new skill, incl. "From images" with the brief and the inventory | ~130 |
| `packages/cli/tests/cli.test.ts`, `scripts/pack-smoke.sh` | tests | ~130 + ~20 |
| `packages/cli/evals/evals.json`, `evals/images/` + `CREDITS.md`, reference inventories | eval set, not published | ~90 |
| `.claude/skills/archiyou-cad` | symlink to `packages/cli/skill/` (not committed, as the other skills) | - |
| root `package.json` | `archiyou` script | +1 |
| `AGENTS.md` | two lines pointing at the skill and `pnpm archiyou` | +2 |

New dependency: `@resvg/resvg-js` in the CLI package (already used by the server). The browser
bundle only changes by the param fix and the svg2pdf import.

### Steps

0. On approval: open a disclosure record in `documentation/nlnet/ai/records/` (ai-disclosure skill);
   commits via `pnpm commit:ai`.
1. Core param fix, request guard and test (after checking editor/configurator request params).
2. Core in plain Node (§0): svg2pdf import, Node build, export condition, cause of the empty mesh
   error. Check with a 10-line pack smoke (core import + box) before any CLI code.
3. `packages/cli` skeleton: package, tsup, tsconfigs, dispatch, `api`, `docs`, `examples`, root script.
4. `run`: execute, summary, error output, `model.glb`, `--json`.
5. Views: per-view and `cam:` SVG, stroke rewrite, `--ref` tiles, labelled contact sheet.
6. `--clash`, `--check` with `inventory.json`, `--overlay`, `mark`, and `sweep`.
7. Skill (with the brief and the inventory) and `init`.
8. CLI tests and `pack-smoke.sh`.
9. Eval set and `eval`; run once as a baseline.
10. The real check: in an empty folder with three Red-Blue chair photos, install from the packed
    tarballs, `npx archiyou init`, then ask Claude Code "make a parametric model from these photos".
    Confirm it writes the brief and a marked photo before any code, asks for a scale, uses `api`/`docs`,
    compares with `--overlay`, and ends with a clean `sweep --clash` and no `--check` mismatches against
    the hand-written reference inventory (13 laths, 5 crossbars, hanging middle posts).

Code style per AGENTS.md: Allman braces, `map`/`reduce` over loops.

### Verification

```
pnpm build:meshup
pnpm --filter @archiyou/core test:params
packages/cli/scripts/pack-smoke.sh                                              # npx path end to end
pnpm -s archiyou api box
pnpm -s archiyou api Mesh
pnpm -s archiyou docs csg
pnpm -s archiyou run packages/core/tests/cadscripts/scripts/programmaticparams.js
pnpm -s archiyou run packages/core/tests/cadscripts/scripts/programmaticparams.js -p WIDTH=120   # size changes
pnpm -s archiyou run <broken.js>; echo $?                                                        # 1, with line
pnpm --filter archiyou test
pnpm -s archiyou run rietveld.js --ref <photo> --views iso,right,cam:-1,-0.3,0.25 --clash        # 0 clashes
pnpm -s archiyou run rietveld.js --check rietveld.inventory.json                                 # today's script: 4 mismatches
pnpm -s archiyou run rietveld.js --overlay <side photo>@cam:-1,0,0@<rect>                        # middle post visibly too long
pnpm -s archiyou mark <side photo> marks.json                                                    # numbered photo
pnpm -s archiyou sweep rietveld.js --clash                                                       # 12 rows, all clean
```

Then open `views.png` and check line weight and labels on a 100 mm part and on a 5 m model
(`timberwall.js`), and do step 10.

### Implementation notes (2026-10-07, branch `agent`)

Where the build differs from the plan above, and what it found:

- **Workspace name `@archiyou/cli`**, command `archiyou`: the monorepo root package is already called
  `archiyou`, so a workspace package with that name makes `pnpm --filter archiyou` ambiguous. `init`
  writes the command as `npx <package name>`, so the AGENTS block stays right whichever name is
  published. Until the CLI is published as `archiyou`, `npx archiyou` without a local install would
  fetch the old engine 0.7.2. The name decision in §1 is still open.
- **Four source files**: `common.ts` (output, muting core, data paths, arguments) next to
  `archiyou.ts`, `run.ts` and `lookup.ts`, so the commands share helpers without import cycles. About
  1,350 lines in all (`run.ts` 840), far more than the ~515 estimated: the overlay, sheet, inventory,
  sweep and eval code is bigger than counted.
- **§0 done**: svg2pdf's ES build by path; a second tsup config for `dist/node/` that reuses the browser
  build's `dist/textures` and `dist/wasm` (two path rewrites with a guard) instead of a second copy of
  32 MB; core's tarball grew 0.6 MB. The build script empties `dist/` first, because both builds write
  into it at once. **Finding (3) was not a core problem**: the smoke script used the param name `W`,
  which core rejects (minimum three characters); the error was reported correctly.
- **One process, one Runner** for `sweep` and `eval`, reused like the editor does: 13 chair runs in
  1.6 s, instead of one process per run (about 2.5 s each).
- **The orthographic views share one scale** (front, side, top), so their sizes compare; iso and `cam:`
  views fill their tiles.
- **Overlay rectangles and `mark` points also take fractions** of the photo: an agent's image reader
  may downscale a large photo, so pixel coordinates it reads off are not the file's pixels.
- **WebP is refused** with a message: resvg does not decode it.
- **Error hints**: for "x is not a function" the run suggests close API names with their owner
  (`Curve.fillet`, since Mesh has no fillet).
- **Inventory globs take `|`** between alternatives.
- **Skill: cutting tools** stay in the model unless made `.tmp()`; found when a quick eval solution
  left its four cylinders in (the summary showed it at once: height 50 instead of 20, four extra parts).
- **Lockfile**: regenerated with `pnpm lockfile:public`, which also removed the private modules'
  importers that were already in `develop`'s lockfile.
- **Tests**: core 54 param tests + 2 Runner tests, CLI 17 subprocess tests, `pack-smoke.sh` green.
  Pre-existing, not from this work: the three cadscripts table tests (parity, coverage, round trip)
  fail on `develop` too; `brep/Shelling`, `annotator/annotationsDedupe` and `importer` time out only
  in the full parallel run and pass alone.
- **The check against the old `rietveld.js`**: an inventory of the original chair gives exactly the
  four errors from Mark's review (6 mismatch lines), and the overlay on the Cassina side photo
  measures the proportions 8 % narrower than the photo.

#### Steps 9 and 10: two agent sessions with the skill (2026-10-07/08)

Two subagents with fresh context, given only the prompts: the seven text items in the repo, and the
Red-Blue chair in an empty folder set up from the packed tarballs (`npx archiyou init`, three photos).

| | Result |
| --- | --- |
| Text baseline | all 7 build and sweep clean; 1–2 run rounds each; `eval`: size 7/7, volume 1/1, params 5/5, sweep 5/5 |
| Chair from photos | brief with coverage, scale and assumed answers in `brief.md`; inventory of 17 parts and 50 rules; 6 run rounds; 660 × 830 × 880 (exact); `sweep --clash --check` clean over 17 variants; passes the hand-written reference inventory (24 rules). **Contaminated**: the skill's inventory example was this chair (same names, counts, hanging middle posts), so the structure score does not count; rerun after the example change |
| What caught what | `--clash` found the chair's one real bug (the back board 177 cm³ into the foot bar); the summary showed it too (depth 864); the overlay confirmed the side elevation; the text agent found a half-depth hole from a `print()`ed volume |

Fixed after their feedback:
- **Named views were mirrored** (the meshup bug below, since fixed): `run` draws every named view as a
  `cam:` direction (`front` = `cam:0,-1,0`, `left` = `cam:-1,0,0`, ...). Until the meshup fix it also
  mirrored the level back view back; that workaround is gone again. Checked with an asymmetric test
  model for all six views, `iso`, and twelve camera directions.
- `--views around` (eight directions labelled with their `cam:`) to find a photo's camera; the skill
  explains the directions; iso and camera tiles no longer show a meaningless projected size.
- Overlays are also written full size (`overlay-1-<photo>.png`); the skill says what an orthographic
  overlay can and cannot show on a close-up photo.
- `--expect WxDxH`; `sweep --corners` (every combination of the extremes, up to 128 runs); the print
  column is no longer cut off.
- `touches` uses the real shapes for solids (`hits()`, `distance()`), not only the bounding boxes.
- Piped output was cut at 64 KB by `process.exit()`: the CLI now exits once stdout is flushed.
- Skill: `boxBetween`, the param aliases, `cylinder()` stands on z = 0, `union()` arguments need
  `.tmp()` too, the corrected cut-through example, a bench as the inventory example (no more chair),
  touching is not a clash, `mark --out`.
- Eval: `volumeTolerance` per item (a half-depth hole is only 0.7 % of the plate's volume, within the
  2 % size tolerance).
- **A bug of my own, found by re-scoring**: to cover brep in the clash check I called `_intersection()`
  where it exists; on a mesh that is the *mutating* variant, so the check replaced each mesh by its
  intersection and later pairs and the `touches` check saw destroyed shapes. Fixed (non-mutating
  `intersection()` for meshes), with a regression test that fails on the bug.

#### Placing by contact: `moveUntil()` (2026-10-08)

The chair's hard part was trigonometry: putting a crossbar exactly under a tilted seat, or a bar
exactly behind a leaning board (`seatUnderZ`, `backY`/`frontY`, `S0`/`S1`, ...). Existing helpers
(`align`, `alignByPoints`, `place`) work on bboxes or given points, and a tilted board's bbox is not
the board. New: `shape.moveUntil(other, direction, gap = 0)` moves a shape (or collection) along a
direction ('up', 'down', 'left', 'right', 'front', 'back' or a vector) until it touches the true
shape of `other`.
- How: conservative advancement on the exact distance (parry3d for meshes, BRepExtrema for brep):
  move by the current distance, which can never pass through, and measure again; one or two steps
  head-on, a few on a slant. Throws when the part would never touch (shadows across the motion do not
  overlap, or the other is behind it), restoring its position; a part that already touches stays.
- One implementation for both kernels: `moveUntilTouching()` in meshup's utils, used by meshup's
  `Shape`/`ShapeCollection` and by core's brep `Shape`/`ShapeCollection`.
- Tests: meshup `moveUntil.test.ts` (the contact height under a 12° seat to 4 decimals, a leaning
  board, gap, words and vectors, the errors, collections); core `shape-parity.test.ts` checks mesh
  and brep land in the same place.
- The chair rebuilt with it (`rietveld.js`, the agent's correct structure: 5 crossbars, hanging middle
  posts): 37 code lines instead of 76, no trigonometry instead of 19 sin/cos/tan calls, 9 derived
  constants instead of 29. 660 x 828 x 880, no clashes, the reference inventory (24 rules) passes,
  the side overlay within 1 %, `sweep --clash --check` clean over 17 variants (1.8 s).
- In the skill: a convention entry and the driving-part advice now name `moveUntil()`.

#### Found outside this plan (for Mark)

- **meshup: mirrored drawings — fixed 2026-10-08 on Mark's request** (kernel divergence 38, pinned
  since 2026-10-05 with "fixing meshup changes existing drawings, user not asked yet").
  `Mesh.isometry`, `Mesh.elevation`, `Mesh.section`, `ShapeCollection._elevation`, `project()` and
  `ShapeCollection.section` passed the plane normal reversed to `_flattenProjectionToScreen`, which
  expects it toward the viewer (`ShapeCollection._iso` had already dropped the `.reverse()`, with
  "TODO: check why"); and when the mapped up vector was exactly anti-parallel to screen-up, the twist
  turned 180° around X, itself a mirror, instead of around Z. The two cancelled for `front`, so only
  front views and front sections looked right; `top`, `left`, `right`, `back`, every isometry of a
  single mesh and floor-plan sections were mirrored, in documents and thumbnails too. Fix: the flatten
  gets the normal toward the viewer everywhere, the twist turns around Z. meshup's
  `projectionOrientation.test.ts` checks screen right x up = toward the viewer for every path (40
  tests, 26 failed before); core's divergence 38 is retired in part (vertical sections still collapse
  the cut profile) and `shape-parity.test.ts` asserts mesh and brep draw the same plan and
  elevations. Existing drawings and stored thumbnails of non-front views change orientation.
- **core API text**: `cylinder()` says "centred on the origin" but stands on z = 0 (in both kernels,
  per the text agent); its example `cylinder(40, 900).moveZ(450) // standing on the ground` floats.
  `Mesh.rotateX`/`rotateY` give no sign convention or default pivot. `api Mesh` lists internals
  (`fromSDF`, `BoxBetween`).
- **`make.wall`** (via `examples timberwallopenings`): a 3000 wall comes out 3019 long (the end stud
  overhangs), centred on y, with two unnamed `Vertex` parts, a warning
  `_ShapeCollection.removeFromScene(): collection is not in the scene`, and 610 default stud spacing.
- **The Red-Blue chair is under copyright** (Rietveld died 1964; the design is protected until 2035).
  The photos in the eval set are freely licensed; a model of the chair is fine as a private eval,
  publishing one is another matter.

### Later (not in this plan)

- **B: `archiyou agent "<prompt>"`**: an agent SDK loop with the user's API key from an env var, the
  skill as system prompt, `run`/`sweep`/`api`/`docs` as tools, and script runs in a worker without
  file-system access. Small once A exists.
- **C: editor co-AI** with photo drop, the same functions server-side (`plans/CO_AI.md`).
- Publishing to npm (core, meshup, collada-wasm, gdrr2bp-wasm, CLI) and the name decision in §1.
- Smaller install: jspdf, html2canvas and core-js account for about 50 of the 180 MB; load them only
  for PDF export, or make them optional dependencies.
- `apps/server` on core's Node build, dropping `tsconfig.runtime.json` and the meshup-dist guard.
- Optional shaded render via headless Chromium reusing `renderModelThumbnail`, if line views prove
  insufficient.
- In-script checks (dimension, clearance assertions). Interference is in v1 (§5).
- Coloured views via `strategy: 'painter'` (fills in the script's colours) for comparing with photos.
- Overlay fitted from matched points (part corner ↔ pixel) and with perspective, if the rectangle fit
  proves too loose.
- Vanishing-point analysis of the photos (line detection, grouping, calibration): an automatic
  "how right-angled is this design" score for the brief, and single-view measurements.
- `moveUntil()` on top of parry3d's shape casting (time of impact) in the wasm, if the distance steps
  prove slow on large meshes; the same contract.
- `watch` mode or warm daemon; MCP wrapper over the same functions.
- `llms.txt` on the docs site from the same API JSON.

## Review and decisions by the human
- 2026-10-06: asked to add and test the user story "a user has one or more images of a design and asks to model it parametrically"; asked for a reflection in the plan.
- 2026-10-07: the CLI gets its own package instead of a script in `apps/server`; asked for the developer experience of `npx archiyou-agent "…"`, agreed with tools for existing agents first and an own agent later.
- 2026-10-07: reviewed `rietveld.js` against a side photo: 5 crossbars not 6, the back board's top bar behind the rear posts, middle posts that do not reach the floor, an invented mid rail. Proposed element counting, extending lines from the photo, and a check of design and photo coverage before modelling; these became the brief, the inventory with `--check`, `mark` and `--overlay`.
- 2026-10-07: asked to implement the plan on branch `agent`.
- 2026-10-07: chose the summary lines of the commits and approved each commit message.
- 2026-10-08: the implementation notes in the plan record what was changed after two agent sessions tested the skill and CLI, including a mirrored-view bug in meshup and a clash-check bug of the agent's own, both found that way.
- 2026-10-08: asked to fix the mirrored views in meshup (accepting that existing non-front drawings change orientation) and to write a to-the-point README for the CLI package.
- 2026-10-08: asked to research a general placement method (like align) that would remove the angle work from the Red-Blue chair script, and to simplify the script with it; this became moveUntil().

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
