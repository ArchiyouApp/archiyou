# Miter saw angles from a beam edge, and parent tracking in meshup select()

| | |
|---|---|
| Dates | 2026-09-27 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a feature asked for in the session, then one follow-up) |
| Human | Mark van der Net: wrote the prompts and the hand-made angle calculation the feature generalises, asked for parent tracking in meshup select() |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

(filled when the unit closes)

## Approach (agent output, no separate plan)

1. `make.cutAngles(edge, beam?)` in `packages/core/src/modeler/Make.ts` returns
   `{ miter, bevel }` as set on a miter saw, in degrees from a square cut.
   - The edge lies on the end cut; the other face it bounds is the face on the saw table.
   - The beam's length axis is the edge direction with the most total length (not the
     OBB, whose PCA axis leans when only one end is cut); it runs along the fence.
   - With up = normal of the table face and across = up × axis, the blade normal of a saw
     set to miter m and bevel b is `cos b cos m · axis + cos b sin m · across + sin b · up`,
     so `bevel = asin|n·up|` and `miter = atan2(|n·across|, |n·axis|)`.
   - Plain `[x, y, z]` math on the API both kernels share (faces, edges, start/end,
     normal, bbox), so it runs on mesh and brep.
   - The beam comes from the edge's `_parent` chain (edge → face → solid); an edge that
     was not selected is looked up among the closed solids in the scene.
2. Checked against the author's DeepFrame script: 40.893° / 20.705°, the values of the
   hand calculation, when the edge is selected face-first
   (`select('F||top').select('E||left')`). `select('E||topleft')` picks the slanted
   front-left edge on that mitered part; documented in the method.
3. Follow-up: meshup `select()` sets `_parent` like brep. The Selector tags the faces,
   edges and vertices it extracts with their owner (per member of a collection);
   `Polygon.select()` points results from its temporary mesh back to the polygon.
   `copy()` does not carry it. Mesh-mode dimensions on selected sub-shapes now link to
   the root shape, as on brep.

## Review and decisions by the human

- Asked for the generic function in the make module, with the edge as input and the
  angles as a miter saw shows them.
- Found the scene lookup too slow on mesh and chose parent tracking in meshup
  `select()`, the same as brep, over the lookup.
- Asked for the work to be committed.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
