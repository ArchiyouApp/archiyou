# Energy module: sun studies in the model

| | |
|---|---|
| Dates | 2026-11-21 → (open) |
| Model | Claude, Claude Code agent (the exact model and version: to be added by the human) |
| Tool | Claude Code as agent; the plan was written and discussed in the conversation |
| Human | Mark van der Net: wrote the prompts, reviewed the plan, decided on one `energy` module with a copy of `pv` |
| Branch | `energy-module` (in this repository, in `packages/meshup` and in `modules/archiyou-modules`) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Goal

Show and report how much direct sunlight falls in a house design: sun hours and direct
irradiation on floors and at windows, with shadows and glass. Simple, maintainable, and
validated against an independent reference.

### Options weighed

| Option | Verdict |
|---|---|
| Port foton (github.com/snjsomnath/foton, GPU daylight engine) to WebGPU | No. Its backends are raw Vulkan and Metal with hardware ray queries, which WebGPU does not have: a port is a rewrite of the ray tracer. Direct sun does not need a GPU. |
| A new Rust crate with its own BVH, solar position and sky model | No. A second BVH next to meshup's and a second solar position next to pv's: double maintenance. |
| **Connect what exists** | **Chosen.** meshup casts the rays, the pvlib port supplies weather, a thin TypeScript layer does the study. |

Measured before choosing: meshup's batch raycast took 7 ms per call whatever the number of rays,
because the BVH was rebuilt per call; tracing itself ran at about 10 million rays per second. A
BVH cache existed (`cached_trimesh`) but the raycasts did not use it.

### What is built

1. **meshup (Rust, ~40 lines):** the raycasts use the cached BVH; one new batch function,
   `raycast_batch_incidence` / `Mesh.raycastIncidence(origins, direction)`, answers per origin
   `-1` (nothing hit) or the cosine of the angle to the surface hit first.
2. **core (one line):** the Runner fills the `meshup` field of the modules back-reference, which
   was declared but never set, so a module can reach the mesh kernel without bundling it.
3. **`energy` module** (decided by the human in place of a separate `sun` module): a copy of `pv`
   with its library in `src/pvlib/` (unchanged), and the sun study in `src/sun/`:
   - `solar.ts`: NOAA / Meeus solar position (pv's Spencer formula is up to 0.3° off);
   - `glass.ts`: Radiance's thin-glass transmittance, after foton's port (MIT);
   - `geometry.ts`: shapes of either kernel → triangles → one mesh to cast rays against;
   - `Study.ts`: points (a grid over a floor, or free points), the moments of a day or of the
     weather year, sun hours and direct irradiation, statistics, colour classes, and `show()`,
     which draws one coloured cell per point as one mesh per class.
   `pv` stays for now and is removed once `energy` has proven itself.

Out of scope: diffuse daylight (DA, sDA, daylight factor), glare, a thermal model, GPU.

### Validation

1. Solar position against pvlib's NREL SPA, tolerance 0.05°.
2. Glass against Fresnel + Snell written out independently.
3. Three scenes (a room with a window; open ground behind a block in a rotated model; a glazed
   facade under an overhang) against a reference computed with pvlib and trimesh
   (`validation/sun/oracle.py`), committed as `validation/sun/reference.json`: sun hours within
   one time step for 99% of the points, yearly irradiation within 1% on average.
4. Once, by hand: the same scenes through Ladybug's Direct Sun Hours. Not done yet.

### Result of the first implementation (2026-11-21)

- Validation: solar position within 0.05°; sun hours within one 5-minute step at every point of
  every scene (mean difference 0.002 h); yearly irradiation within 0.04% on average.
- Speed: 8.8 million rays in 0.55 s; a weather year on 320 points in 0.3 s.
- Tests: energy 126 passed (3 opt-in live tests skipped), meshup unit tests 1345 passed.
- The meshup WASM in the working tree was built without `wasm-opt` (not on the machine the agent
  ran on), so it is 1.4 MB larger than it should be: rebuild it with the usual toolchain before
  committing.
- Found on the way: `pv/manifest.json` asks for engine `^1.0.0` while core is 0.9.0, so `pv` does
  not load in the CLI. `energy` asks for `^0.9.0` like the other modules.

### Added: passive solar gain (2026-11-21)

Asked for after seeing the sun hours: how much solar energy comes into the house, and is that
the same analysis? It is not: sun hours count time on the floor; gain is energy through the glass,
and in the Netherlands more than half of it is sky and ground light.

- `src/sun/gains.ts`, `study.gains({ g })`: per point on the outside of each pane and per hour,
  the direct beam (one ray to the sun), plus isotropic sky and ground light over 256
  cosine-weighted directions minus what the shade blocks, each times the glass's g-value at its
  angle of incidence. Per pane, per month, heating season (October–April) and summer.
- Validated on three panes against `validation/sun/oracle.py`, which integrates the sky on a
  regular angle grid instead of the module's spiral: within 0.4% per year and per month. The
  validation found that a pane standing free cannot tell its outside from its inside; the module
  now warns about that.
- URHOUSE (`ur_house_sketch`, defaults, side windows seeded): 2 953 kWh per year through 12 m²,
  1 240 kWh of it October–April; the south sliding door 1 461 kWh.

## Review and decisions by the human

- Asked for one `energy` module that holds the pvlib port and the sun study, instead of separate
  `pv` and `sun` modules.
- `pv` is copied, not moved: it stays until `energy` works and is removed after.
- Asked for the sun study on a real house (the URHOUSE sketch), shown in the Archiyou viewer, and
  for passive solar gain on top of the sun hours.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
