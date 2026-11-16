# Params: an options param with numbers is a number param

| | |
|---|---|
| Dates | 2026-11-16 → 2026-11-16 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the fix, had it explained, approved the commit |
| Branch | `develop` |
| Session transcript | kept locally; the prompts of this unit are reproduced in full below |

## Prompts (verbatim, local time)

Found while pricing `archiyou/timberwall` at a depth of 235 for a drawing ("Studs moeten sls
zijn 38x230", 21:29): `-p DEPTH=235` left `$DEPTH` at 120.

```
2026-11-16 21:50 +0000  Fix de options-bug in ParamManager ... (the rest of the message is about the drawing)
2026-11-16 21:52 +0000  Kun je me die param fix uitleggen?
2026-11-16 21:54 +0000  Ok, commit de fix
```

## Plan (agent output, reviewed by the human before implementation)

No plan mode: a diagnosis, the fix, and an explanation before the commit.

### Diagnosis

`$PARAMS.define('DEPTH', 'options', { options: [120, 140, 184, 235] })` builds its schema from
the base schema of `options` in `PARAM_TYPE_SCHEMAS`, `{ type: 'string', enum: [] }`, with the
values laid over it as `enum`. The type stays `'string'`:
`{ type: 'string', enum: [120, 140, 184, 235] }`. No value can pass that: `235` is not a
string, `'235'` is not in the enum. `define()` drops a value that does not validate, so the
param silently keeps its default, from the editor, the CLI and the API alike. Options of words
were not affected, as `'string'` happens to fit them.

`normalizeProperty()`, the path of the properties of `defineObject()`, already types an enum
by its values with `_enumJsonType()`; `_buildParamData()`, the path of `define()`, did not.

### Fix

- `ParamManager._buildParamData()`: for an `options` param with values, the type follows the
  values (`_enumJsonType()`), and the enum is cast to that type, as `normalizeProperty()` does.
- Tests in `tests/unit/execution/ParamManager.test.ts`: numbers give a number param, a
  requested value of 235 is taken, options of words stay a string param.

## Review and decisions by the human

- Asked for the fix, had it explained (why no value could pass, what changes and what does
  not), and approved the commit.

Verified by the agent: the param tests pass (130); `archiyou run -p DEPTH=235` gives 235;
core's suite fails only on the five tests that failed before this change (version, the
cloudcalc examples of the runner and ProductManager, the IFC house); the editor's tests pass.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Params: an options param with numbers is a number param | "Ok, commit de fix" |
