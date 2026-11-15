# layer(): an existing layer is a query, activate() goes back to it

| | |
|---|---|
| Dates | 2026-11-15 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the fix ("can you fix the bug?"), chose between the two fixes, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

Found while fixing the ridge of ur_roof: `layer(name)` of a layer that exists returns it but
does not make it active, while its documentation says "Start a layer, or go back to one".
Scripts rely on the current behaviour: they use `layer(name)` as a query
(`layer('floors').shapes()`, `layer('bottomplate').shapes().copy()` in strawwall,
`layer('cuts').shapes().iso()` in tomy) and go on modelling in the layer they are in.
Making it go back would move those shapes into the queried layer.

Two fixes were put to the human; chosen: keep the query.

- `layer(name)` of an existing layer stays a query; its documentation says so.
- `layer(name).activate()` goes back to a layer: the shapes made after it go in it. A
  method core adds to meshup's SceneNode (as it adds toDXF and toSVG), through a link to
  the modeler that `layer()` sets on the node it returns.
- The name is looked up among the layers only, so a shape named like a layer (the shape
  `walls` in the layer `walls` of ur_house_sketch) is not returned instead of the layer.

Only `packages/core/src/modeler/Modeler.ts`, plus a unit test. Another session has
uncommitted changes in the same file (showPipelineScene); this work commits only its own
hunks.

## Review and decisions by the human
- Chose "Query stays, add activate" over "Go back, as documented" (2026-11-15), after the
  agent showed which scripts the second would change.
- Agent checked: two unit tests (the lookup test fails on the old code), the modeler, runner
  and docs unit tests (the same 3 failures with and without the change: ifc.house fixture,
  ProductManager.collect/complete examples), a script with a query, activate() and a shape
  named like its layer.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
