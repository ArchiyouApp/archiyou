# Opening a script: a busy button, and no model of the script left behind

| | |
|---|---|
| Dates | 2026-11-09 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug report, fixed directly) |
| Human | Mark van der Net: reported that Open Script seemed to do nothing on a slow connection and that the previous script's model stayed in the viewer, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output)

- Open Script first fetches the picked script's latest version from the server
  (`refreshFromServer`, record 2026-11-03-save-conflicts). On a slow connection that takes a
  while and nothing showed it. The editor now passes `opening` to `<script-manager>`: the Open
  button shows a spinner and takes no more clicks meanwhile. Cancel abandons the open; a failed
  fetch opens the copy in this browser, with a warning in the console.
- Switching to another script (open, new, import, shared, delete of the active one) clears the
  run of the script left behind (`clearExecutionResult()`: execution result, scene state,
  interactive shapes). The viewer takes a cleared result as "nothing to show" and removes the
  model and its handles until the new script has run. A GLB loaded directly and an animation's
  model stay.
- A run that finishes after another script was opened is not shown (nor taken as the new
  script's thumbnail): the editor runs the script that is open now instead.

## Review and decisions by the human
(filled as you go)

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
