# make.pack(): 2D or 3D by the shapes, and the 2D packer on demand

| | |
|---|---|
| Dates | 2026-10-29 → 2026-10-29 |
| Model | Claude Sonnet 5.5 (claude-sonnet-5-5), Claude Code agent |
| Tool | Claude Code as agent (worked out in conversation, no separate plan mode) |
| Human | Mark van der Net: asked for the layer and for the lazy 2D packer, chose the rule that tells 2D from 3D, reviews the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-29 19:08 +0100  I want to add a little layer on make.pack(shapes) which decides if 2d or 3d packing is needed. If shape types are mixed choise the 2D/3D with most shapes. Give a clear warning with that. Please make make.pack() (2D) also lazily loaded
```

## Plan (agent output, no separate plan step)

- `make.pack(shapes, options?)` becomes a dispatcher; the old 2D function is `make.pack2d()` (`boarding()` calls it), `make.pack3d()` is unchanged.
- **The rule** (the human's choice among three): the options never decide, the shapes do. A curve, polygon, open surface or plate (a closed solid at most a
  tenth as thick as it is wide, `PLATE_RATIO` of `parts.ts`) votes 2D, any other closed solid votes 3D; the majority wins, a tie goes to 2D. A mix gives
  one warning with the counts and what happens to the minority: solids packed in 2D are laid flat, curves and polygons packed in 3D are left out and reported
  as unplaced (plates are loaded as boxes). Solids without bins are an error that says how to nest them instead; bins given to flat shapes are ignored with a
  warning.
- **The 2D packer on demand**, like the 3D planner: `loadBinPackerModule()` in `Make.ts`, `Runner._loadBinPackerWhenUsed` scans the script and its
  components for `pack(`, `pack2d(` and `boarding(`; the eager load in `setArchiyou()` and the two `packReady()` calls of the Runner are gone. `pack(`
  cannot know which packer it will need, so it loads both. `check:pack` now also requires `@archiyou/gdrr2bp-wasm` to be reached by `await import()` only.
- Shape votes in `modeler/packChoice.ts`.

## Review and decisions by the human
- Chose "shape type, but plates count as 2D" as the rule.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see the commit | 2026-10-29 19:08 |
