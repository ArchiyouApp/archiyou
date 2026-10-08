# Code editor: a new undo history for every script opened

| | |
|---|---|
| Dates | 2026-10-08 → 2026-10-08 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug fix) |
| Human | Mark van der Net: reported the bug and asked for the fix, had it committed |
| Branch | `agent` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-08 12:18 +0200  There is a bug in the code-mirror backbutton when opening script after each other. Undoing can lead into the code of a previous script. Make sure you reset the undo history in CM everytime a other/new  script is openend
```

## What was wrong and the fix (agent summary)

Opening another script replaced the editor's text as an ordinary edit, which went into CodeMirror's
undo history, so undoing far enough brought the previous script's code back.

- `packages/ui/src/editor/codebox.ts`: building the editor state moved into `_createState(doc)`; a new
  `scriptId` property rebuilds the state when it changes, which clears undo history, selection and line
  highlights. A change of code alone is still applied as an undoable edit.
- `apps/editor/src/pages/editor.ts`: passes the open script's `fileId` as `scriptId`.

Tied to the `fileId`, the reset covers opening, creating, importing, forking, opening a shared script
and deleting the open one; restoring an older version or a server sync keeps the `fileId` and stays
undoable.

## Review and decisions by the human

- Asked for the fix and had it committed (2026-10-08). The agent type-checked it but did not try it in
  the browser; the check is: open script A, edit, open script B, press Ctrl+Z repeatedly — B's code stays.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see git log | 12:18 |
