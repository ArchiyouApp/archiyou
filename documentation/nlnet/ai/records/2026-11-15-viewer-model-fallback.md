# Viewer: the model when a pipeline has no shapes

| | |
|---|---|
| Dates | 2026-11-15 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: proposed the change ("why not show the model in the viewer after a specific pipeline run?"), approved the plan, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

With a pipeline picked next to Run, the viewer shows that pipeline's GLB. Since the
pipeline chip (8147e47) a pipeline that makes no shapes (an offer document, tables only)
shows an empty viewer: "asked for but not made: show nothing, not the model". The editor
already asks for the model's GLB on every run, so the model is in every result.

- The pipeline makes shapes: show them, as now.
- The pipeline makes no shapes (it ran, no GLB): show the model, with its scenegraph and
  handles, as for `default`, and a short note in the viewer that this is the model,
  because the pipeline has no 3D output.
- The pipeline failed: show nothing, as now, so an error does not hide behind a model
  that looks fine.

Changed during the work: a pipeline without shapes does get a GLB, an empty scene (one node,
no meshes). "No shapes" is therefore read from the GLB's JSON chunk (no meshes, no
annotations), once per output; a failed pipeline is told apart by its warning
`Pipeline '<name>' failed: ...` in the result.

Only `packages/ui/src/viewer/model-viewer.ts`, and the note's text in the ten translations
(added by hand: `lit-localize extract` rewrites the files, which are out of step with it). Another session has
uncommitted changes in the same block (clearing the viewer on a switch of script); this
work builds on them and commits only its own hunks.

## Review and decisions by the human
- Approved the plan with "ok" (2026-11-15), including the note in the viewer.
- Agent checked in the dev editor with a test script: a pipeline with only a table shows the
  model and the note, a failing pipeline shows nothing, a drawing pipeline shows its drawing.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
