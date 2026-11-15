# Opening a script: a busy button, and no model of the script left behind

| | |
|---|---|
| Dates | 2026-11-09 → 2026-11-16 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug report, fixed directly) |
| Human | Mark van der Net: reported that Open Script seemed to do nothing on a slow connection and that the previous script's model stayed in the viewer, wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-11-09 20:06 +0100  I noticed a ugly aspect when opening a script from the file menu in the editor, on a slow internet connection the user can push a button, but apprently nothing happens. It should at least show a loader animation inside the button (and block more clicks). Also, if switching from script the model in the viewer should be removed. Now the model of previous script remains until the execution of the new one if finished. Please fix
```

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
- Reported both problems and asked for the spinner in the button and the model to go on a switch.
- The record was written on 2026-11-16, from the change and the session, when the work was committed with the other uncommitted work of the tree.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| e98b3c2 | Editor: a busy Open button, no model of the script left behind | 20:06 |
