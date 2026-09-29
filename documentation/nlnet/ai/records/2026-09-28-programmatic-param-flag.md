# Menu params locked by enable() or enableIf(true)

| | |
|---|---|
| Dates | 2026-09-28 → 2026-09-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug report, the cause, then the fix) |
| Human | Mark van der Net: wrote the prompts, found the locked PROJECT_AREA in ur_plan_row, asked for the fix and to apply it again to the saved script |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-28 13:31 +0200  Can you check in local database the script http://localhost:5173/editor/ur_plan_row - There is a weird bug in the editor that makes the PROJECT_AREA programatic
2026-09-28 13:31 +0200  Base directory for this skill: /home/mvdnet/archiyou/archiyou/.claude/skills/archiyou-local-db
2026-09-28 13:35 +0200  yes fix please
2026-09-28 13:38 +0200  Can you apply it again. I think it was saved
```

## What was done (agent output, reviewed by the human)

A param made in the editor menu got locked as "defined by the script" as soon as the script called
`enable()`, `hide()` or `enableIf(true)` on it. Those calls report the param back as `updated`, and
`applyManagedParamsAndPresets` (`apps/editor/src/state/editor.ts`) stamped every new or updated param
with `_definedProgrammatically: true`. The flag was saved with the script, and a later run that no
longer touched the param reported it deleted, so the full sync would have removed it.

- **Fix:** the merge keeps the flag the run reports. Only `define()` sets it, so a menu param stays
  editable whatever the script enables or hides, and params made with `define()` stay locked.
- **Regression test:** `apps/editor/tests/managed-params.test.ts` runs the real `ParamManager` and the
  editor's merge: `enableIf()` on a menu param does not lock it, and a defined param keeps its lock.
  It fails on the old line and passes on the fix.
- **Data:** the saved `ur_plan_row` was corrected in the local database (the lock flag removed from
  PROJECT_AREA, line 17 changed to `enableIf(p => p.FIXED_PROJECT_AREA)`), twice, because an open
  editor tab saved the old version over the first correction.

## Review and decisions by the human

- Reported the bug on `ur_plan_row` and approved the proposed fix ("yes fix please").
- Noticed the first correction of the saved script had been overwritten and asked to apply it again.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Menu params stay editable when a script only enables or hides them | "yes fix please" |
