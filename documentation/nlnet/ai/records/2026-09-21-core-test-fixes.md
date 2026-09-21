# Core test fixes: stale ScriptParam fixtures and a misaimed wall diagram assertion

| | |
|---|---|
| Dates | 2026-09-21 → 2026-09-21 |
| Model | Claude Opus 5 (claude-opus-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: three test files, investigated before editing) |
| Human | Mark van der Net: asked whether `main` was ready to deploy, then asked for the 22 failing core tests to be fixed or removed |
| Branch | `develop` (equal to `main` at the start) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-21 14:17 +0200  i merged everything into main (superproject and meshup) - everthing ready for deployment right?
2026-09-21 19:26 +0200  Can you fix or remove the 21 ScriptParam/Script tests. Also the one in make.test.ts - afterwards commit according to the NLnet disclosure format
```

## Scope (no plan: diagnose, then fix the tests, not the code)

The deploy check found 22 failing core tests, failing identically on `recipe` and `develop`
before they were merged. Each was investigated to decide between a bug and a stale test; all
turned out to be stale tests, so every test was fixed and none removed. No source file changed.

- **`ScriptParam.test.ts` (19) and `Script.test.ts` (2).** `ScriptParam.fromData()` requires
  `type` (it selects the base schema from `PARAM_TYPE_SCHEMAS`) and a name of at least three
  characters, and has done since the initial commit — there is no type inference to be broken.
  The fixtures passed no `type` and one-letter names (`'n'`, `'b'`, `'c'`). They now declare
  their type and use names of three or more characters. No assertion changed. Real data was
  checked first: none of the 26,558 param entries in the local database breaks either rule.
- **`make.test.ts` (1).** The test expected every shape in the wall's `diagram` group to be
  dashed. Since the initial commit the diagram is one hidden plane (or pentagon, for a ridged
  wall); the dashed lines are the `gridlines` group beside it. The assertion now checks that
  the gridlines are dashed and the diagram is hidden. It had also stopped the test before its
  real check — that nothing intrudes into the window opening — which now runs and passes.

Result: core 1574 passed, 0 failed (was 22 failed).

## Review and decisions by the human

- Chose "fix or remove"; the agent fixed all 22 and removed none, since each was a stale
  test and the behaviour it checks is still worth checking.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| the commit that adds this record | Automatic AI fix of old ScriptParam/Script tests and make.test.ts | 19:26 prompt (subject reworded at the human's request) |
