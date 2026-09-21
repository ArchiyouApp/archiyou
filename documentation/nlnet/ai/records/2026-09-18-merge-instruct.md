# Merge instruct into develop: port the svgLayers changes to SVGExporter

| | |
|---|---|
| Dates | 2026-09-18 → 2026-09-18 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a merge with one conflict, checked with a dry-run merge before starting) |
| Human | Mark van der Net: wrote the prompts below, asked for the merge, chose the commit subject and where this record lives |
| Branch | `develop` (merging `instruct`), done in a separate worktree so the uncommitted `recipe` work was not touched |
| Session transcript | kept locally; the prompts are reproduced in full below |

This record covers the merge resolution only. The merged work itself is commit `638a96e`
("First prototype type of instruct module. In viewer and doc", 2026-09-01), which predates
this disclosure process and is not described here.

## Prompts (verbatim, local time)

```
2026-09-18 14:37 +0200  Can you check if the instruct branch work is merged with develop?
2026-09-18 14:48 +0200  Can you merge instruct branch into develop branch while taking care of these 18 svg lines? Then commit according to the NLnet AI disclosure policy
```

## Plan (agent output, reviewed by the human before implementation)

No separate plan. The first prompt produced the finding the second one acts on: `instruct`
is one commit (`638a96e`) ahead of the merge base `f718bee`, not merged into `develop` or any
other branch, and a `git merge-tree` dry run showed one conflict:
`packages/core/src/modeler/svgLayers.ts`, deleted on `develop` by `633a868` ("Cleanup
seperate files into SVGExporter") and changed on `instruct`.

Resolution:

- `svgLayers.ts` stays deleted. Its three `instruct` hunks are ported by hand to the same
  code in `packages/core/src/modeler/SVGExporter.ts`, next to what `develop` added there
  since (`plane`, the annotation `projector`):
  - `RenderDrawingOptions.css` (extra, already scoped CSS), passed through to
    `buildSVGDocument`, which already accepted `css` after the auto-merge;
  - the collected annotations are kept in `drawn` and handed to `annotationMarginMm`, so a
    drawing with labels gets room for their leaders and text boxes;
  - the margin comment updated to match.
- `packages/core/src/modeler/parts.ts` (new on `instruct`) named `modeler/svgLayers.ts` in a
  comment; it now names `modeler/SVGExporter.ts`. No code imported `svgLayers` any more.
- Every other file auto-merged. The `meshup` submodule keeps `develop`'s newer pin
  `16a65e8` (`instruct` did not move it).

Verification, in a `develop` worktree with `develop`'s meshup pin checked out, compared with
`develop` and `instruct` checked the same way:

- `packages/core` `tsc --noEmit`: 164 errors after the merge, 173 on `develop`, 150 on
  `instruct`. None is new: every one after the merge is on `develop` or `instruct` too, and
  9 of `develop`'s (the GLTFBuilder layout/exploded-view API) are gone.
- `typecheck-own.mjs` for `packages/ui`, `apps/editor` and `apps/server`: clean.
- `packages/core` unit tests: 25 failed, 1253 passed. The same 25 fail on `develop`
  (ScriptParam, Script, make, kernel divergences); 12 that fail on `develop` (labels,
  GLTFBuilder animations, modeler animations, text) pass after the merge.
- `packages/ui` tests: 104 passed, including `instruct-playback`.

## Review and decisions by the human

- Asked for the merge after the check showed `instruct` unmerged with one conflict, and
  for the conflicting changes to be carried over rather than dropped.
- Chose the commit subject "Merge instruct into develop: port the svgLayers changes to
  SVGExporter" and the body proposed with it.
- Decided this record goes into the merge commit on `develop` (which does not have the
  disclosure process yet); the README index row follows when `recipe` and `develop` meet.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| the merge commit that adds this record | Merge instruct into develop: port the svgLayers changes to SVGExporter | the prompt of 2026-09-18 14:48 |
