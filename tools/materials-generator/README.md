# materials-generator

Build-time authoring tools for the archiyou materials database and textures.

- **Data**: Gemini (`gemini-2.5-pro` by default) authors physical properties in
  canonical SI units, each with a source citation, constrained to a response
  schema → `packages/core/src/materials/materials.json`.
- **Textures**: Gemini **Nano Banana** (`gemini-2.5-flash-image`) generates
  section / sides images → `packages/core/src/materials/textures/`.
- **Carbon**: EN 15804 life-cycle GWP data imported from **ÖKOBAUDAT**. No model
  is involved — every figure comes from a published, verified EPD and is stored
  with its dataset UUID, version and URL.
- **Cross-check**: a manual (non-CI) audit that compares stored values against
  public references via Gemini + Google Search grounding and prints a diff report.

This is a **build-time authoring tool**. The generated `materials.json` + images
ship as static data in `@archiyou/core`; the app never runs the generator.

## Setup

```bash
cd tools/materials-generator
npm install
cp .env.example .env   # add GEMINI_API_KEY (from https://aistudio.google.com/apikey)
```

The scripts auto-load `.env` (via Node's built-in env-file loader, Node ≥ 20.6).

## Usage

```bash
npm run generate:data        # (re)generate materials.json property data
npm run generate:textures    # generate texture images + patch viz.textures
npm run restyle:textures     # re-level existing textures in place (no API calls)
npm run import:carbon        # import EN 15804 GWP data from ÖKOBAUDAT
npm run materials:crosscheck # manual audit of values vs public sources
# subsets:
npm run generate:textures -- wood        # by group, or by name: -- douglas oak
npm run restyle:textures -- --dry        # preview the levelling, write nothing
npm run import:carbon -- douglas oak
npm run materials:crosscheck -- steel douglas concrete
```

The three generators are independent and preserve each other's output, so they
can be run in any order.

## Textures

### Greyscale tint masks — not coloured albedo

Textures are **8-bit greyscale**. glTF defines base colour as
`baseColorFactor × baseColorTexture`, so a greyscale mask lets the material's own
`viz.pbr.color` do the tinting: white keeps the colour, black goes to black.

This is load-bearing, not a style choice:

- A **coloured** texture double-tints. Brown texture × brown factor rendered ~2.5×
  too dark, which is exactly the bug this replaced.
- One texture serves any colour, so recolouring a material is a `materials.json`
  edit rather than a regeneration.
- The image model no longer has to hit a hue while drawing dense linework — it was
  bad at that, and the colour kept averaging away.

`png-grey.ts` re-encodes the model's RGB output to single-channel PNG on the way to
disk (~60% smaller, verified pixel-identical to a Rec.709 luma reference). Files keep
the `.jpg` extension but are PNG; `MaterialManager` sniffs the magic bytes.

**Strength.** `autoContrast` levels every mask on the way to disk, stretching its
deviation from white until the darkest tones reach ~0.35. It only ever *strengthens* —
levelling everything to an identical range would flatten materials that are legitimately
bold (terracotta, stone) down to the level of ones that are not (cement).

On top of that baked-in baseline, `materialTextureStrength` in core is the per-script
adjustment: below 1 the linework fades toward the flat material colour, above 1 it
deepens. Anchored at white in both directions, so the material never drifts off its
declared hue.

```js
ay.materials.materialTextureStrength = 2     // bolder linework
ay.materials.materialTextureStrength = 0.5   // fade it back behind the contours
```

### Scale and extent

Every texture is authored at the material's **maximum obtainable real-world
extent** — wood `sides` is a log face, stone a full slab — and marked
`repeat: false`. The renderer then crops a randomly-offset region per part
instead of tiling a small pattern, so identical parts don't look cloned.

`RING_SPACING_MM` keeps the two roles consistent: both faces cut the same timber, so
the ring spacing seen end-on must match the grain spacing seen along the plank. Feature
counts in both prompts are derived from it and the frame size — left to itself the model
picks an unrelated density per role and a beam looks like two different trees.

Two constraints are worth knowing before changing `ROLES`:

- The image model **rejects** aspect ratios beyond 9:16 / 16:9 (`1:8`, `1:4`,
  `4:1` all return HTTP 400). That ceiling is why wood `sides` is 500×889 mm and
  not a full 500×4000 mm log. `SUPPORTED_ASPECTS` lists only verified ratios —
  don't add to it without probing the API first.
- `generateSized()` re-derives `realWidth`/`realHeight` from the **returned**
  pixels, so the stored mm always describe the image on disk even when the model
  ignores the requested ratio. It logs when that happens.

Style is deliberately **graphical** (high contrast, strong linework, flat limited
palette) — see the `GRAPHIC` prompt fragment. This is what makes a max-extent
tile still read well at low pixels-per-mm.

## Carbon (ÖKOBAUDAT)

`import-carbon.ts` pulls GWP-total per EN 15804 module from the soda4LCA API and
writes an `lca` block plus the flat `carbon` summary.

Matching is **hand-curated** in `CARBON_MAP`, not automatic: EPD names are
German, product-specific and brand-heavy, so fuzzy matching quietly attaches the
wrong dataset to the right name — worse than having no data. Helpers:

```bash
npm run import:carbon -- --unmapped          # materials with no dataset yet
npm run import:carbon -- --search Brettschichtholz   # find candidate UUIDs
```

When adding an entry, prefer EN 15804+A2, a generic ("average"/"representative")
dataset over a single manufacturer's, a recent reference year, and an unexpired
`validUntil` — then check the dataset's *classification* really describes the
material. Some materials are deliberately absent because no honest dataset
exists; that list is documented in `CARBON_MAP`.

Values are stored **as published**, per the EPD's declared unit, together with
the EPD's own gross density. Per-kg conversion happens at read time in
`MaterialManager.carbonIntensityOf()`. Area-declared products (`qm`) yield no
per-kg figure at all rather than an invented one.

### Resuming after a failed run (`ONLY_UPDATE`)

`generate:data` regenerates every material by default. If a run is cut short by a
transient API error (e.g. `503 "high demand"`), only the materials generated so
far are written to `materials.json`. Re-run with `ONLY_UPDATE=true` to fill in
just the missing/incomplete ones (already-complete materials are skipped, so no
quota is spent re-generating them):

```bash
ONLY_UPDATE=true npm run generate:data   # or set ONLY_UPDATE=true in .env
```

A material counts as "complete" when it has the schema-required fields
(`name`, `group`, `description`, `density`, `viz.pbr`). If nothing is missing the
script exits without rewriting the file.

## Review before committing

Generated numbers must be human-reviewed. The deterministic range gate lives in
the core test suite (`packages/core/tests/unit/materials/`), and `crosscheck.ts`
gives a live second opinion. Only commit values you've sanity-checked.
