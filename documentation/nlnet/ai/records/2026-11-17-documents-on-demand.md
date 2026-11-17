# Documents tool: make only the document on screen

| | |
|---|---|
| Dates | 2026-11-17 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: found the slow Documents tool, said how it should work (names first, the first document, a loader, a run per document picked), wrote the prompts, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally (session b2b6c137); the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

The Documents tool asked for every document, so every document's pipeline ran (three in
ur_house_detailed_storeys) before it showed anything.

- A run lists the documents' names without making them, so the dropdown shows at once.
- The editor asks only for the document on screen (`selectedDoc` in `state/core`, the first
  when none is picked); picking another makes it by a run of its own, through
  `registerToolOutputsFiller()`. A document already made stays until the next run.
- The tool shows a loader while its document is being made, and says so when that fails.
- After a first run, which does not know the names yet, the document on screen is made
  straight after it.
- A pipeline picked next to Run still makes all of its documents.

Another session has uncommitted changes in `editor.ts` (stopping a run); the commit takes
only the hunks of this work.

## Review and decisions by the human
- Specified the behaviour (2026-11-17 17:33): names first, the first document, a loader, a
  run per document picked.
- Agent checked: in the running editor with ur_house_detailed_storeys (dropdown at once,
  workdrawings made in about 3.7 s, a WIDTH change remade only the document on screen, no
  console errors); the editor typecheck, also of the committed version on its own.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
