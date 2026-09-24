# Script-set param values, handle mapping and the param menu

| | |
|---|---|
| Dates | 2026-09-24 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: options discussed in the session, plan written to `plans/OPENINGS_HANDLES.md` and approved before implementation) |
| Human | Mark van der Net: wrote the prompts, chose the design (manual-mode switch, `set()` over param defaults, rerun option, `push()` included; `u`/`du`/`tu` handle values, the `(param, handle)` mapping function, dropping the map object), reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

Values that a script writes with `$PARAMS.X.set()` or `push()` reach the editor and are kept
there, with an optional re-run. Needed for per-window handles in the urhousesketch script, where
an automatic opening layout is written into the `OPENINGS` list so that it can be edited by hand
once a manual-mode switch is on. The script changes themselves are Mark's.

Working on that script led to two more parts in the same session, asked for one by one rather
than planned up front (see "Handles" and "Param menu" below): clearer handle mapping, and fixes
to how list params and groups behave in the param menu.

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Context

urhousesketch generates its openings (front door, kitchen window, top window, back opening, a
jittered grid on the side facades). None of them live in a param, so a handle has nothing to
write to, and the `Math.random()` jitter reshuffles the side windows on every run.

roomwithopeningsbox shows the target: every opening is one entry of the `OPENINGS` object-list
param, and a handle bound to `OPENINGS[i]` with `{ u:'left', v:'sill' }` drags it along its wall.

Decided in discussion:

- A new boolean `OPENINGS_MANUAL_MODE` (default false).
- **Auto mode:** the generator builds the layout and writes it into the list with
  `$PARAMS.OPENINGS.set(layout, { rerun: false })`. The list in the menu always mirrors the model.
- **Manual mode:** the generator is skipped and `set()` is not called, so the app keeps the last
  list as the user's value. Openings and one handle each are built from `$OPENINGS`; they are
  edited in the menu or by dragging.
- Switching back to auto regenerates and replaces the manual list.
- Not through param defaults (considered, rejected as ugly).

### Why `set()` needs work first

`ParamManagerOperator.set()` (`packages/core/src/execution/ParamManagerOperator.ts:67`) only
changes `_value` inside the worker:

1. It never marks the operator, so the value is not in `managedParams` and never leaves the worker.
2. It cannot simply mark `'updated'` like `push()` does. The note in `push()` (line 100) says why:
   everything in `managedParams` gets stamped `_definedProgrammatically` by the editor, which
   permanently locks a param the user made in the menu.
3. Even if it arrived, `applyManagedParamsAndPresets` (`apps/editor/src/state/editor.ts:547`)
   keeps the user's current value whenever it still validates.

So values get **their own channel, `managedValues`**, next to `managedParams`, the same way
`managedBehaviours` was split off (`Runner.ts:2350`). A value is not a definition.

### Part A — core

**API**

```js
$PARAMS.OPENINGS.set(layout);                    // rerun: true (default)
$PARAMS.OPENINGS.set(layout, { rerun: false });  // model already built from `layout`
$PARAMS.HOLES.push({ size: 20 });                // same channel, same option
$PARAMS.HOLES.push({ size: 20 }, { rerun: false });
```

`set()` and `push()` both write the param's value, so they share one path: `push()` is "set to
the current list plus this entry".

- `rerun` (default `true`): the app re-runs the script when the value changed, because code
  *before* the `set()` used the old `$X`, so model and menu disagree until another run.
  `false` when the script builds the model from the value it sets (our case), which would make a
  re-run a full wasted CAD run.
- No implicit rule based on hidden/disabled: visibility says nothing about whether the model
  used the old value, and function-based `visibleIf/enableIf` are only evaluated in the app.

**Changes**

- `ParamManagerOperator.set(v, options?: { rerun?: boolean })`
  - validates as now (throws on a schema mismatch);
  - sets `_value`, and the scope global `$NAME` like `define()` does (`ParamManager.ts:559`), so
    code *after* the `set()` sees the new value;
  - records `{ value, rerun }` on the operator (`_setValue`), last call wins. Does **not** call
    `setOperation()`.
- `ParamManagerOperator.push(v, options?: { rerun?: boolean })`
  - validates the entry against the item schema as now, keeps the last-entry duplicate check;
  - then goes through the same internal path as `set()` (`_value`, `$NAME`, `_setValue`,
    `rerun`); the `setOperation('updated')` call and its note are removed.
  - **Behaviour change:** today a pushed value reaches the editor only while the param has no
    value yet (the editor keeps an existing valid value), so `push()` effectively works once.
    On the value channel it appends **on every run**. The JSDoc says so and its example guards
    the push (`if ($HOLES.length === 0) ...`); an unguarded push with `rerun: true` is stopped by
    the loop guard (part B). No saved script uses `push()` or `set()` today (checked in the
    local DB), so nothing existing changes.
- `ParamManager.getManagedValues(): Record<string, { value, rerun }>`: only operators whose set
  value differs (deep equal) from the value the run **started** with (`originalParam._value ??
  default`). Setting the same value, or setting and setting back, reports nothing.
- `ParamManager.diffManagedValues(currentParams, managedValues)` (static, pure, next to
  `updateParamsWithManaged`): returns `{ changes: [{ name, value }], rerun: boolean }` against
  the app's current params; skips unknown params and values that fail validation (with a
  warning). Keeps the logic testable in core; the editor only wires it.
- `Runner.ts` (~2344): `state.managedValues = scope._main ? getManagedValues() : undefined`.
- Types: `managedValues` on the state types next to `managedParams`
  (`packages/core/src/types.ts:65`, `modeler/brep/types.ts:207,266`); `ManagedValuesData` in
  `execution/types.ts`.
- JSDoc on `set()` and `push()`, each with an `@example` (it feeds `api.generated.json`, and every example runs in
  `runner.help.test.ts`); regenerate with `pnpm --filter @archiyou/core generate:api`. Fix the
  `ParamManager.ts` header, which still calls managed output stateless.


### Part B — editor

- `applyManagedValues(managedValues)` in `apps/editor/src/state/editor.ts`, called from
  `setExecutionResult` (`core.ts:512`) **after** `applyManagedParamsAndPresets`, so a param
  defined and set in the same run exists by then.
  - Uses `diffManagedValues`; writes each change through `updateParam(name, { value })`, then
    one `bumpScript()` + `saveCore()`. Nothing changed → nothing saved (no save per run for a
    stable auto layout).
  - Does not touch `_definedProgrammatically`, so a menu-made param stays editable.
- **Re-run and loop guard**
  - `rerun` is true and something changed → `scheduleExecution()`.
  - A module-level counter of consecutive re-runs caused by `set()`; at `MAX_SET_RERUNS = 3` stop
    and `console.warn` naming the param(s) ("set()/push() keeps changing OPENINGS; not
    re-running").
    Catches `set($N + 1)` and unseeded randomness.
  - Reset the counter on any run not caused by `set()` (param menu, handle drag, code run): pass
    a marker through `scheduleExecution`, or reset in the param-change / execute handlers.
- Pipelines and server runs ignore `managedValues` (one-shot runs, nothing to persist).

### Out of scope: urhousesketch

The script changes (manual-mode switch, generator to entries, shared build step, handles) are
done by Mark. What parts A and B give the script:
`$PARAMS.OPENINGS.set(layout, { rerun: false })` in auto mode. `set()` still throws when the
value does not match the schema, so generated values have to be multiples of 10 and within the
`Opening` maxima.

### Tests

- `ParamManagerOperator.test.ts`: `set()` records the value; same value reports nothing;
  `rerun` defaults to true, `{ rerun: false }` carried; invalid value still throws; `$NAME`
  updated in scope; operator is not marked `'updated'`. `push()`: existing cases stay; "reports
  the param back to the app" moves from `getManagedParams().updated` to `getManagedValues()`;
  new: `{ rerun: false }` carried, `push()` after `set()` in one run reports the combined list.
- `ParamManager.test.ts`: `getManagedValues()` against the start value;
  `diffManagedValues()` (changed / unchanged / unknown param / invalid value / rerun flag).
- `runner.params.test.ts`: define + set in a script → `result.state.managedValues`, and
  `managedParams` does not contain the param when only its value changed. The existing
  "pushes onto an untouched list param and reports it back" test reads `managedValues`
  instead of `managedParams`.
- Editor wiring and loop guard: checked in the running editor with small test scripts: a
  `set()` or `push()` of a changed value re-runs once, `{ rerun: false }` does not re-run, the menu shows
  the new value and it survives a reload, a menu-made param stays editable after a `set()`, and
  a `set($N + 1)` script stops after 3 re-runs with the warning.

### Size

Core ~70 LOC + types ~10, editor ~40, tests ~100. No new source files, no bundle impact beyond
those lines.

### Changes during implementation

- **Re-run decision follows the script's report.** Found in the browser: a param defined in
  the same run arrives with its set value already in its definition, so the editor's own
  comparison saw no change and did not re-run, while the model had been built with the old
  value. `diffManagedValues()` now returns `rerun` for any valid reported value that asked for
  it; `changes` (what to write and save) still compares with the editor's value. The script
  only reports values that differ from the ones its run started with, so a settled value does
  not loop.
- The editor writes the values directly and saves once, instead of going through
  `updateParam()` per value; `setExecutionResult` evaluates the behaviours right after.
- `push()` appends onto the value in effect (`_value ?? default`); before it ignored a default.
- `managedValues` is typed on the state in `packages/core/src/types.ts` only, next to
  `managedBehaviours`; the older state type in `modeler/brep/types.ts` carries neither.
- API reference: `ParamManagerOperator` (the `$PARAMS.NAME` object) is not in the generated
  reference, so the `set()`/`push()` docs live in the source only. The three new engine-side
  `ParamManager` methods are marked `@internal`; `api.generated.json` is unchanged.
- Browser checks (throwaway Vite on port 5190, own storage): set() re-runs once and the second
  run reports nothing; `{ rerun: false }` runs once; `set($N + 1)` stops after 3 re-runs with
  the warning; a guarded `push()` stores the list in two runs; a menu-made param keeps
  `_definedProgrammatically` unset after a set(); the value survives a reload and shows in the
  param menu.

## Handles (asked for during the work, no separate plan)

- `$handle` in the code editor's suggestions; `$handle().` and a variable holding a handle offer
  the Handle methods (Handle added to the generated completion classes, `$handle → Handle` in
  `FACTORY_RETURN_TYPES`).
- `at(x, y, z)`, `start(x, y, z)`, `position(x, y, z)` next to the array form.
- `range()` throws on a bound that is not a number (NaN, null, `'-' + undefined`), which used
  to make the handle vanish on its first drag.
- Mapping, settled over several prompts:
  - the viewer gives a mapping the same values whatever `range()` gets: `u`/`v` (where the
    handle is along its axes), `du`/`dv` (how far this drag moved it), `tu`/`tv` (0 to 1
    through the range) and `position()`; `range()` only decides how the bounds are written
    (previously `u`/`v` meant a position or a drag distance depending on the range, which made
    a handle in the middle of an opening push the sill up on every drag);
  - `param(ref, (param, handle) => …)` and `params((params, handle) => …)`; for an object or
    list param a returned value only counts when it is an object or list too, so a concise
    `param => param.left = handle.u` changes the copy;
  - the declarative map object (`{ u: 'left' }`) is removed, as too niche and hard to read;
    passing one throws with the function form as the hint; autoMap (no second argument) stays
    and got an example.
- Migrated: `roomwithopeningsbox` and both `handletest` scripts in the local database (new
  versions through `ScriptStore.saveVersion()`, keeping params and description), the
  `timberwallopenings.js` cadscript and the unit tests.
- Checked in the browser (throwaway Vite, drag ends through the viewer's own handlers): a
  function with `du`/`dv`, one using `v`, a `tu > 0.5` boolean, and autoMap.

## Param menu (asked for during the work, no separate plan)

- List params: entries indented under the name, xs text inside entries, the Add button on the
  name line, a Delete? confirm on entries, and the list re-rendering when its value changes
  (the editor writes values into the same param object, so a removed entry, a `set()` value or
  a handle drag did not show until an unrelated render).
- Moving a group tab swapped the group NAMES of the params instead of the order, so a moved tab
  showed the other group's params; it now renumbers `order` and every param stays in its group.

## Review and decisions by the human

- Rejected a random-seed-only fix and override ids; chose a manual-mode switch with the generated
  layout written into the `OPENINGS` list.
- Rejected going through param defaults ("ugly"); `set()` is the right way.
- `set()` re-runs by default when the value changed, with an option to turn that off.
- Left the script (part C) out of the plan; added `push()` for consistency.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
