# Merge develop into recipe: partList onto collectParts, keeping the cut-list fixes

| | |
|---|---|
| Dates | 2026-09-21 → 2026-09-21 |
| Model | Claude Opus 5 (claude-opus-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a merge with one conflict, started by the human) |
| Human | Mark van der Net: ran `git merge develop` on `recipe` (on the way to bringing everything to develop and then main), asked for the conflicts to be fixed, approved the resolution and the commit |
| Branch | `recipe` (merging `develop` at 29996f0) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-21 13:13 +0200  I did a git merge develop => want to bring everything to develop (and then main) - can you fix the current merge conflicts?
2026-09-21 14:07 +0200  ok go ahead
```

## Scope (no plan: one conflict)

Everything merged cleanly except `packages/core/src/modeler/Make.ts`, where both branches
rewrote `Make.partList()`:

- **develop** moved it onto the new shared `collectParts()` (`modeler/parts.ts`), which
  `docs.instruct` also uses, and added an opt-in `label` column.
- **recipe** (fab and kernel-parity work) fixed three things in the old body: numbered copies
  collapse into one subpart (`purlin1`, `purlin2` → `purlin`), subparts are deduplicated
  exactly rather than by substring, and rows sort most-frequent first.

`collectParts()` was written against the old `partList` and deliberately keeps the substring
dedup and first-seen order, because instruct's part labels must not move. Taking develop
would have dropped recipe's fixes; taking recipe would not compile against the auto-merged
`COLUMNS`, which already expects develop's label column.

Resolution (agent-written): keep develop's `collectParts()` call, and re-apply recipe's three
fixes inside `partList` only — `collectParts()` is unchanged. The subpart column is rebuilt
from each part's shapes with the name collapsing and exact dedup. The frequency sort applies
only when labels are off; with labels on the table is the legend to a manual and stays in
label order. That last split is the agent's judgement, not forced by the conflict.

## Review and decisions by the human

- Approved the resolution and concluding the merge through `commit:ai`, following the
  precedent of [2026-09-18-merge-instruct.md](./2026-09-18-merge-instruct.md).

Verification by the agent: `Make.ts` has the same 28 type errors before and after the merge,
none in `partList`; the parts, table, docs/instruct, layouter and GLTF instruct tests pass
(17 files, 257 tests). The full core suite has 22 failures in `ScriptParam.test.ts`,
`Script.test.ts` and `make.test.ts` — the same 22 on `recipe` and on `develop` each checked
out alone, so they predate the merge and are left for a separate look.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| the merge commit that adds this record | Merge develop into recipe: partList onto collectParts | 13:13 prompt, approved 14:07 |
