# View.autoScale(): the usual construction scales

| | |
|---|---|
| Dates | 2026-11-17 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the method and its list of scales, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally (session b2b6c137); the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

Asked for after walls of one house came out at different scales (a list of scales, each wall
picking the largest that fits).

- `autoScale()` on View, Document and Docs: short for `scale(AUTO_SCALES)`, the largest of
  1:5, 1:10, 1:20, 1:25, 1:30, 1:40, 1:50, 1:100, 1:200 and 1:500 that fits; the caption says
  which. Beyond 1:500 it draws at 1:500, clipped, with a warning.
- Unlike `scale('auto')` (the general standard scales, without 1:30 and 1:40).
- Metric only.
- The editor's completions regenerated, which also brings the descriptions of `layer()`
  (activate), `solids()` and `make.foldoutView()` (both kernels) up to date with their source.

## Review and decisions by the human
- Chose the list of scales (2026-11-17 17:51).
- Agent checked: new unit tests in `viewScale.test.ts` (a 4 m wall at 1:30, the 1:500 limit)
  and the existing scale tests pass; a script with `.autoScale()` runs in the CLI.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
