# Add to project: the project list a set number of rows high

| | |
|---|---|
| Dates | 2026-11-17 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: found the problem in the configurator, asked for the fix and the setting, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

The list of existing projects in the Add to project menu was a flex column with a maximum
height: with many projects its rows shrank to fit instead of the list scrolling, which
squeezed their margins.

- Rows keep their height (2.25rem, no shrinking); the list is as high as a number of rows,
  then scrolls, with room kept for the scrollbar.
- The number of rows is a setting, `PROJECT_LIST_VISIBLE_ROWS = 5` in
  `apps/editor/src/settings.ts`; per menu the `visible-rows` attribute overrides it.
- The search field shows when there are more projects than rows (it was more than 6).

## Review and decisions by the human
- Asked for 5 rows, as a setting, with scroll (2026-11-17).
- Agent checked: the editor typecheck; a headless browser with 12 made-up projects: 5 rows of
  36px, the rest scrolls, long titles cut off.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
