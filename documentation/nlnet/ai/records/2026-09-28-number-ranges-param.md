# Param type `number-ranges`: a two-handle slider

| | |
|---|---|
| Dates | 2026-09-28 → 2026-09-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (research and plan in the session, then implementation) |
| Human | Mark van der Net: wrote the prompts, asked for the feature and the % split example, decided on the JSON Schema option names, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-28 10:31 +0200  Can you research a new param type 'number-ranges' that is a slider with two handler that generate two or three numbers : either one range from one handle to another or three ranges from start to handle1, handle1 to handle2 and handle2 to end. webawesome has a range slider type with two handles to support this. Come up with a good way to configure it. A example of a application is a range slider that the user can use to define 3 numbers wihtin 100 (%) - so for example 25%, 50%, 25%. Also set up a example script in the local database
2026-09-28 10:33 +0200  Base directory for this skill: /home/mvdnet/archiyou/archiyou/.claude/skills/archiyou-local-db
2026-09-28 12:33 +0200  For the design (min,max etc) keep as much as possible in line with JSON names. So minimum, maximum, multipleOf
2026-09-28 12:45 +0200  go ahead and implement it
2026-09-28 12:45 +0200  Base directory for this skill: /home/mvdnet/archiyou/archiyou/.claude/skills/ai-disclosure
2026-09-28 13:03 +0200  Small visual tweaks: Dont put the colors underneath the input fields for split mode. Also dont make the input fields fill the entire container width, Do align them together with the labels, but make them smaller width. The central label in split should be dead-center, the input field too. the start and end labels can be alignedl left and right
2026-09-28 13:10 +0200  please commit according to nlnet policy
```

## Plan (agent output, reviewed by the human before implementation)
## Param type `number-ranges`

One slider, two handles, two or three numbers out.

- **`mode: 'range'`**: the stretch between the handles, `[from, to]`.
  A window from sill to head, a shelf zone, an opening.
- **`mode: 'split'`**: the three parts start→handle 1→handle 2→end, `[a, b, c]`,
  always adding up to `maximum - minimum`. For example bays of a façade as `[25, 50, 25]` %.

Example script: `number_ranges_demo` (author `archiyou`) in the local database, and
the same script as a cadscript regression (`core/tests/cadscripts/scripts/number_ranges_demo.js`).

### Script API

```js
$PARAMS.define('BAYS', 'number-ranges', {
    label: 'Bays (%)',
    mode: 'split',                 // 'range' (default) | 'split'
    minimum: 0, maximum: 100, multipleOf: 1,   // the slider track; split parts add up to maximum - minimum
    minSpan: 10,                   // no part (split) / no range (range) smaller than this
    labels: ['Closed', 'Glazed', 'Closed'],   // optional, one per part (split) or per handle (range)
    default: [25, 50, 25],
});

$PARAMS.define('WINDOW', 'number-ranges', {
    mode: 'range', units: 'mm',
    minimum: 0, maximum: 2700, multipleOf: 50, minSpan: 300,
    default: [900, 2100],
});

const [left, glazed, right] = $BAYS;
const [sill, head] = $WINDOW;
$PARAMS.BAYS.set([30, 40, 30]);
```

The options use the JSON Schema names wherever one exists: `minimum`, `maximum`,
`multipleOf`, `default`. They go into the stored schema as they are, so script and
schema read the same. (`min`/`max`/`step` keep working as the aliases every type
already accepts, but docs and examples use the JSON names.) Only what JSON Schema
has no word for is ours: `mode`, `minSpan`, `labels`.

Without a default: range → `[minimum, maximum]`, split → thirds snapped to
`multipleOf` (the last part takes the rounding).

#### Why the value is the output, not the handle positions

The value is what the script reads: `[25, 50, 25]`, not handles `[25, 75]`. Presets,
`set()`, the configurator URL and validation then all speak the same numbers as the
script. The handle positions are a UI concern (`h1 = minimum + a`, `h2 = minimum + a + b`).

### Stored schema

Standard JSON Schema where it exists, so `Check()` does most of the work and the
existing `paramMin/paramMax/paramStep` helpers work unchanged:

```js
{
    type: 'array',
    mode: 'split',                                 // archiyou keyword
    minimum: 0, maximum: 100, multipleOf: 1,       // the track; ignored by Check() on an array (verified)
    minSpan: 10,                                   // archiyou keyword
    labels: ['Closed', 'Glazed', 'Closed'],        // archiyou keyword, optional
    minItems: 3, maxItems: 3,                      // 2 for range
    items: { type: 'number', minimum: 10, maximum: 100, multipleOf: 1 },   // derived
    default: [25, 50, 25],
}
```

`items` is **derived** from the track by one normaliser (range: `[minimum, maximum]`;
split: `[minSpan, maximum - minimum]`), called from both `_buildParamData()` and
`fromData()`, so a UI edit of the track can never leave `items` stale.

Two rules JSON Schema cannot express, checked in `validateValueVerbose()` for this type:

- range: `to - from >= minSpan`
- split: `a + b + c === maximum - minimum` (within a relative 1e-9, floats)

Handles snap to the grid from `minimum`, as the number slider does. `items.multipleOf`
is only set when the numbers then are multiples: `minimum` on the grid (range), the
total on the grid (split). Otherwise no value at all would validate.

Verified: `Check()` on the schema above accepts `[25,50,25]`, rejects `[5,50,45]`
(minSpan) and `[25,50]`, and accepts `[30,50,30]` (sum 110), hence the custom sum rule.

### UI: `param-item-number-ranges.ts`

A new file, like each other type has one. `<wa-slider range>` (Web Awesome 3.4.0,
installed) with `min-value`/`max-value` as the handles.

- Thumbs can meet but not cross in `wa-slider`; it has no minimum gap. On `input`
  the component pushes the dragged handle back to keep `minSpan` (and in split mode
  keeps the outer parts ≥ `minSpan` too).
- **range**: the built-in indicator already fills between the handles. Below: two
  number fields (from / to), editable, same unit handling as `param-item-number`.
- **split**: three coloured segments on the track (`::part(track)` gradient driven
  by `--h1`/`--h2` custom properties set in `updated()`, not inline styles). Below:
  a number field per part, with its label. Typing a part moves one handle: the first
  part handle 1, the middle and last part handle 2, so the neighbouring part gives or
  takes the difference.
- A thumb dragged past the other one makes `wa-slider` move both to the pointer;
  the component reads that as the dragged thumb stopping at `minSpan`.
- Units: length units convert per number as in `param-item-number`, shown with a
  read-only unit label (no unit dropdown, unlike the number control). Percent is
  unitless; the label says `%`.
- `valueFormatter` for the handle tooltips.

### Touchpoints

| Where | Change | ~LOC |
|---|---|---|
| `core/src/execution/types.ts` | `numberRanges = 'number-ranges'` in `ScriptParamType`; `mode`, `minSpan`, `labels` in `ScriptParamDefineOptions` | 10 |
| `core/src/execution/ScriptParam.ts` | `PARAM_TYPE_SCHEMAS` entry, normaliser, sum/span rules, `toScriptJs()` case | 70 |
| `core/src/execution/ParamManager.ts` | `_buildParamData()`: `mode`/`minSpan`/`labels`, derived `items`, default | 30 |
| `ui/src/params/param-item-number-ranges.ts` | new control | 300 |
| `ui/src/params/param-menu.ts`, `ui/src/configurator/configurator-params.ts` | one `case` each | 4 |
| `editor/src/state/configurator-url.ts` | `?BAYS=25,50,25` comma form in `coerce`/`serialize` | 10 |
| docs: `define()` JSDoc example | example | 6 |
| tests: ParamManager/ScriptParam unit tests, configurator URL, cadscript `number_ranges_demo.js` | | 150 |

`schemas.ts` uses `Type.Enum(ScriptParamType)`, so it follows the enum.

`api.generated.json` (help reference) is not regenerated in this work: it holds other
uncommitted changes. `pnpm --filter @archiyou/core generate:api` picks up the new example.

### Bounds that follow another param (done)

`maximum: $LENGTH` works because `define()` runs every time. When the track changes,
`define()` fits the user's value to it (`ScriptParam.fitRanges()`) instead of dropping
it: split parts scaled to the new total and snapped, a range clamped. A default that
does not fit is fitted the same way, since no fixed default fits every run of such a
track. The app takes the fitted `_value` along with the new definition.

### Open points

1. **Authoring in the editor.** `param-define-menu.ts` (define a param without code)
   would get a mode toggle plus minimum/maximum/multipleOf/minSpan. That could come in a second step.
2. **`labels` translation.** Should they go through i18n extraction like `options`?
3. **More than two handles** (N parts) would need our own slider; `wa-slider` has
   two thumbs at most. Not in scope.

## Review and decisions by the human

- Asked for the research: a two-handle slider giving a range or a three-way split,
  configured well, with a % split (25/50/25) as the example, and an example script in
  the local database.
- Decided the options follow the JSON Schema names: `minimum`, `maximum`, `multipleOf`
  rather than `min`/`max`/`step`.
- Approved the plan for implementation ("go ahead and implement it"). The first open
  point of the plan (a track that follows another param) was built as part of it; the
  other open points (authoring in the param define menu, translation of `labels`, more
  than two handles) stay open.
- Reviewed the control in the editor and asked for the split field layout: no part
  colours under the fields, fields not filling the width, first part left, middle part
  dead centre, last part right, each label aligned with its field.
- Asked for the commit under the NLnet policy; picked the summary and the description
  and approved the message. Hunks of other work in `types.ts` (a format list) and
  `param-menu.ts` (a tab ResizeObserver) were left out of the commit.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| dba236f | Param type number-ranges: two handles, a range or a three-way split | "go ahead and implement it" / "Small visual tweaks: Dont put the colors underneath the input fields for split mode. …" |
| (this commit) | Close the disclosure record for the number-ranges param | "please commit according to nlnet policy" |
