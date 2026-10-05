# Viewer labels with fully rounded ends

| | |
|---|---|
| Dates | 2026-10-05 → 2026-10-05 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: one styling request) |
| Human | Mark van der Net: wrote the prompt, asked for the shape, had it committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below (the last one from the session that committed the work) |

## Prompts (verbatim, local time)
```
2026-10-05 13:06 +0200  Can you give the labels in the viewer full rounded borders left and right (just like the dimension lines) ?
2026-10-05 21:19 +0200  please finish the last commits so everything is staged, commited and ready to be pushed
```

## Work (agent output; no separate plan)

`packages/ui/src/viewer/viewer-labels-overlay.ts`: `--ay-label-radius` is the pill radius
(`--wa-border-radius-pill`), and rectangular labels use it instead of square corners, so
labels sit in the same pill as the dimension values. The square corners had been a choice
(a rounded box read as a tooltip); the human asked for the pill.

## Review and decisions by the human

- Asked for the pill shape, matching the dimension values.
- Had it committed with the rest of the tree on 2026-10-05; another session traced the
  change to this one by its transcript, and the human confirmed it as AI-written.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Viewer labels with fully rounded ends, like the dimension values | "Can you give the labels in the viewer full rounded borders left and right (just like the dimension lines) ?" |
