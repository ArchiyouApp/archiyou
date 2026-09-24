# Scene to code: highlight the statement that made a shape

| | |
|---|---|
| Dates | 2026-09-24 → 2026-09-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: analysis in the session, approved before implementation) |
| Human | Mark van der Net: wrote the prompts, reviewed the analysis, chose automatic highlighting |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

Selecting a shape in the scene explorer (or in the 3D viewer) highlights the statement in
the code editor that created it, when the script ran per statement.

## Prompts (verbatim, local time)

The work was done in one session; the commit was made from a later session that went on to
other work (the `$PARAMS.set()` plan), from which only the two prompts about this commit
are listed.

```
2026-09-24 10:24 +0200  Most of the time we are executing (see execution options) statement-for-statement. It would be pretty nice if we can log which shapes are created by what statement. So in the scene navigitor, when clicking on a shape would go to the statement in the editor. Can you analyse if that is possible and easy to do?
2026-09-24 10:29 +0200  yes implement it. Highlighing automatically is ok
2026-09-24 11:40 +0200  First commit the scene-statement-work (nlnet AI disclosure) than start implementing the OPENING_HANDLES plan
2026-09-24 11:46 +0200  make the commit
```

## Plan (agent output, reviewed by the human before implementation)

Asked first as an analysis ("is it possible and easy"); the answer below was approved with
"yes implement it. Highlighing automatically is ok".

### Mechanism

Shapes already get a serial id (`_sid`) when they enter the scene, from one counter per
run (`Modeler._nextSid()`, read with `Modeler.lastSid()`), and the scenegraph carries it
to the app (`SceneNodeData.sid`). The per-statement loop in
`Runner._executeLocalInScriptStatements()` runs one top-level statement at a time, so
reading `lastSid()` before and after each statement gives the range of serial ids that
statement created. No hooks on shape creation, no stack traces: two integer reads per
statement.

### Changes (about 80–120 lines, no new source files)

- **Core**: `ScriptStatementResult` gets `sidFirst`/`sidLast` (inclusive, absent when the
  statement added no shape); the per-statement loop fills them, also for a failing
  statement and for `exit()`. Test in `runner.perstatement.test.ts`.
- **Editor state** (`apps/editor/src/state/editor.ts`): keep `sid` when cloning the
  scenegraph; a computed `selectedStatement` resolves the selected scene path to the
  statement whose range holds the node's serial id. A layer resolves when every shape
  under it came from the same statement (a `$component()` call, a boolean that split into
  pieces).
- **Code editor** (`packages/ui/src/editor/codebox.ts`): a line highlight for the
  statement's lines, like the existing error-line highlight, scrolled into view when the
  selection changes. It does not take focus from the viewer, and it is skipped when the
  code was edited after the run it came from.

### Limits (accepted)

- Resolution is the top-level statement: a shape made inside a loop or a helper function
  points to the whole loop or to the call.
- "Created" means "entered the scene": in-place edits keep the original statement;
  operations that replace a shape (`copy()`, a type-changing result, a split) point to the
  statement that replaced it.
- Per-statement mode only (the editor default); without it there is no highlight.

## Review and decisions by the human

- Chose automatic highlighting on selection over an explicit "go to code" button.
- Tried it in the editor before the commit.
- Chose the commit summary and asked for the record to be closed with it.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| c89ffb4 | Scene: highlight the statement that made the selected shape | "yes implement it. Highlighing automatically is ok" |
