# Animator: animate params from the Add menu

| | |
|---|---|
| Dates | 2026-10-27 → 2026-10-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the option and its limit of five parameters, reviews the code |
| Branch | `animator`, then `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-27 21:45 +0100  I think I would be nice if the user can pick in the add animation menu the option: "Animate params" and get presented with a simple menu in which to add param name which to animate and its start and end values. You can animate 5 parameters at the same time for now.
2026-10-28 10:40 +0100  please move this work into develop. then stop using the worktree. i want to work on develop from now on
```

## Plan (agent output, no separate plan step)

A follow-up to [the animator](./2026-10-26-animator.md):

- **Core** (`packages/core/src/animator/code.ts`): `paramsAnimationCode(name, variable, params)` writes
  one animation that sweeps up to `PARAMS_ANIMATED_MAX` (5) parameters together:
  `.param(name, { from, to, frames: 12 })` per parameter, `.duration(3)`, `.loop('pingpong')`.
  `PARAM_FRAMES_DEFAULT` and `PARAM_FRAMES_MAX` move to `standard.ts`, so the editor uses them without
  loading the animator.
- **Animation tool**: "Animate params" in the Add menu shows rows of a number parameter, a start and an
  end (the parameter's minimum and maximum to begin with); "+ Parameter (up to 5)", × to remove a row, a
  note when start and end are the same. Add writes the code and selects the animation with Make it; it is
  not played straight away, as making it costs a run per frame.
- **Guide**: the option in `help/guide/en/modeling/animations.md`.

## Review and decisions by the human
- Set the limit of five parameters at the same time.
- Asked to move the work into `develop` and to stop using the `animator` worktree.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see the commit | 2026-10-27 21:45 |
