# Fold-out view on the brep kernel

| | |
|---|---|
| Dates | 2026-11-10 → 2026-11-16 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a direct request, the approach in the conversation) |
| Human | Mark van der Net: found that `$pipeline(...).show()` showed nothing for ur_house_sketch, asked for `make.foldoutView()` on brep too, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-11-10 11:17 +0100  Im trying $pipeline.show() (see ur_house_sketch) but it does not show the result of the pipeline. Can you check?
2026-11-10 15:35 +0100  Can you implement the foldoutView in brep too?
2026-11-10 20:43 +0100  Can you fix those last brep things. Make the script work
```

## Plan (agent output)

`make.foldoutView()` (record 2026-11-05-foldout-view) went through `make.modeler`, which
refuses brep, so on brep the spec pipeline of ur_house_sketch failed and showed nothing.
Its steps are kernel-neutral except for what the mesh projections offer:

- brep projections (`_project`, so elevations and isometries, and `_section`) remember how
  they put 3D onto the sheet, and the transforms of the collection after that (move, moveTo,
  rotateZ) keep it up to date, as meshup's `_screen` does. `toScreen(point)` reads it.
- brep `ShapeCollection.groupNames()`, as meshup has.
- `foldoutView()` and its dimensions use the kernel-neutral modeler. Its lines get the
  classes of their groups (`cut`, `visible`, `outline`, `hidden`): a brep drawing's groups do
  not survive in the fold-out's (meshup) group. Its default shapes, every visible solid, are
  found on brep too (meshup `solids()` only knows meshes).
- Found on the way: on brep, `group()`, `collection()` and `all()` are meshup collections, and
  one holding brep shapes drew nothing as SVG (a document view of the fold-out was empty).
  The SVG exporter now draws such a collection as a brep one, with its groups.
- The foldoutView tests run on both kernels; a brep test for `toScreen()`.

Reported to the human as left open, then fixed on request ("Can you fix those last brep
things. Make the script work"):

- meshup `ShapeCollection.solids()` also keeps the Solids of the other kernel, so on brep
  `all().onlyVisible().solids()` (a meshup collection of brep shapes) is no longer empty.
- A brep ShapeCollection's `move()`/`moveTo()` also moves the annotations linked to it, as the
  meshup collection already did: the dimension lines an isometry carries over follow its move.
- A brep rectangle Wire has subtype `Rect`, as on the mesh kernel (it was `PlanarClosed`), so the
  script's openings area counts on brep too. Selecting `PlanarClosed` still finds it; the wire
  selector listed `CoplanarClosed`, a name `wireType()` never returned, and now lists both.
- Tests: brep projection dimensions follow a move from `all().onlyVisible().solids()`
  (annotator/dimensions.test.ts), the Rect subtype and selection (modeler.brep.test.ts).

ur_house_sketch (version of 13:03) then renders its spec document on brep like on mesh. Still
different on brep, in the model, not the drawing: the roof is a Wire, the floor plan cut.

## Review and decisions by the human
- Found that `.show()` showed nothing for ur_house_sketch; asked for `make.foldoutView()` on brep.
- Asked to fix what the agent reported as left open ("Make the script work"): solids() on brep, annotations following a move, the Rect subtype.
- 2026-11-16: had it committed with the other uncommitted work of the tree, the meshup change as its own commit in the submodule (29210aa, "solids(): also the brep Solids a collection holds"); the foldoutView, dimensions and brep modeler tests pass.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| a51eb4e | make.foldoutView() on brep, and brep fixes for ur_house_sketch | 15:35, 20:43 |
