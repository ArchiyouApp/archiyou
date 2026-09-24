# Script-set param values, handle mapping and the param menu

| | |
|---|---|
| Dates | 2026-09-24 → 2026-09-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: options discussed in the session, plan written to `plans/OPENINGS_HANDLES.md` and approved before implementation) |
| Human | Mark van der Net: wrote the prompts, chose the design (manual-mode switch, `set()` over param defaults, rerun option, `push()` included; `u`/`du`/`tu` handle values, the `(param, handle)` mapping function, dropping the map object; passing values to mapping functions with a check at definition; handle defaults in Handle.ts), found the bugs by running the urhousesketch script in the editor, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

Values that a script writes with `$PARAMS.X.set()` or `push()` reach the editor and are kept
there, with an optional re-run. Needed for per-window handles in the urhousesketch script, where
an automatic opening layout is written into the `OPENINGS` list so that it can be edited by hand
once a manual-mode switch is on. The script is Mark's; on request the agent fixed parts of it
(the handle mapping per wall, the frame orientation, the document pipeline), see below.

Working on that script led to more parts in the same session, asked for one by one rather than
planned up front (see the sections after the plan): clearer handle mapping, fixes to list params
and groups in the param menu, values from the script for mapping functions, the script sync
between browser and server, clearer error messages, and running the script on the brep kernel.

## Prompts (verbatim, local time)

One session (the context was compacted once, at 22:09). Left out: the texts of the two skills
the session loaded (ai-disclosure, archiyou-local-db) and the compaction summary, which are not
prompts. Every pasted copy of the urhousesketch script, Mark's own script, is replaced by a
line with its length and first line; the versions are in the local database and the last one is
`packages/core/tests/cadscripts/scripts/ur_house_sketch.js`.

```
2026-09-24 10:39 +0200  I want to implement handles for this script: "

                        [pasted: 1003 lines, starting "// urhousesketch"]

                        " - see example of roomwithopeningsbox in archiyou workspace. But the windows in the scripts are generated randomly - so after each handle update (and rerun) the windows are reset. Dont code yet, but what solutions might there be here?
2026-09-24 10:45 +0200  I want to change the positions per-window with the handles. I think option 4 might work.
2026-09-24 10:52 +0200  Let's say .set does report back to the editor (I think it should) - so in the script we check the "MANUAL_MODE", if so skip the auto-laying and generate the handles on the existing OPENINGS. This should work right?
2026-09-24 10:56 +0200  More simple: We would introduce a new bool parameter OPENINGS_MANUAL_MODE (default is false) - When the user flips to true, the auto-generating windows is skipped and the handles are generated. Then the user can simple use them to position the windows individually. What do you think?
2026-09-24 10:58 +0200  No, we won't use the .set() stuff. The windows are generated and placed into the OPENINGS parameter list. When the user switches to manual mode, these openings are still in and can be changed manually.
2026-09-24 10:58 +0200  [Request interrupted by user]
2026-09-24 10:59 +0200  The default is only used when there are no existing parameter values right?
2026-09-24 11:06 +0200  Well going through the defaults is ugly. The right way is .set(). So the auto layout does a $PARAMS.OPENINGS.set({{ array of new opening objects}}) - in auto mode this is nice, because on every run the opening layout is generated and working. When the user switches $OPENINGS_MANUAL_MODE then the openings are "fixed" and open for manual change, either in the menu of with the handles
2026-09-24 11:14 +0200  Well it think we should a bit on $PARAMS.{param name}.set({{val}}) - I think a user would expect a rerun if the value would be different than that of the previous run (we can do this easily by cancelling any set with a value which is the same as current). In our example a new value for $OPENINGS will be entering a hidden/disabled param, so this is enough reason to not trigger another run. But still, we might add a argument to the set() method to force that no run will be done: set({val},triggerRun=t|f with true as default, in our case (when the $OPENINGS param is not hidden for some reason) we can do $PARAMS.OPENINGS([...], false); -- What do you think?
2026-09-24 11:20 +0200  Yes write the plan please
2026-09-24 11:27 +0200  Leave out part C, Ill do that myself.
2026-09-24 11:28 +0200  Please add push() in this plan for consistency
2026-09-24 11:40 +0200  First commit the scene-statement-work (nlnet AI disclosure) than start implementing the OPENING_HANDLES plan
2026-09-24 11:46 +0200  make the commit
2026-09-24 12:35 +0200  Can you add $handle to the suggestions?
2026-09-24 12:50 +0200  Can you check the ur_sketch_sketch in the db? $PARAMS.OPENINGS.set(openings, { rerun: false }); does not work (i dont see any values added in the param mneu)
2026-09-24 12:51 +0200  Here is the script:

                        [pasted: 923 lines, starting "// urhousesketch"]
2026-09-24 13:11 +0200  Some small DX improvements around $handle: Please allow .at(x,y,z]) instead of only at([x,y,z]). Also throw a error if .range() has NaN/null values because it makes the handle disappear on drag which is weird. Also UI wise: The list param are rather ugly in the param-menu. Please make the entry cards all have a margin to the left (so indent), the button should have the same indent (so basically entire content). I noticed that deleting a entry has no confirm, also it does not update immediately. Make the text within the entrie (and ie "Add Opening") button all xs text size. Add the "Add button" not underneath but next to the param name to the right (so for example "OPENINGS ......... <add>" - omit the name. Another thing: Moving around parameter groups does not work. It does move, but when you click it, is shows the previous group parameters.
2026-09-24 13:26 +0200  In script "

                        [pasted: 932 lines, starting "// urhousesketch"]

                        " === Can you see why my handle is jumping (sill height is increasing) every time i grab/move the handle?
2026-09-24 13:37 +0200  I remember i also created a more advanced mapping function. I also wonder if the mapping function should be more clear. .param(`OPENINGS[{$i}]`, (param, u, v) => param.left = u; For simple params this would work too: .params('SOMEBOOL', (param,u,v) => u < 100)); So then returning a value, this value is directly plugged into the param, otherwise for object/list  params you will change in place, and that change is detected and passed as new param value. What do you think?
2026-09-24 13:43 +0200  For the relative/absolute distinction. Why not u = absolute, du is relative? (v, dv) ?
2026-09-24 13:48 +0200  Maybe make the mapping more concrete by not flattening objects, so .param('<<param name>>', (param, handle) => param.left = handle.u ---- and why not add handle.position()
2026-09-24 13:53 +0200  Well i wonder if the distinction is clear: handle position "u" (within range) is always [0,range max], "du" is relative to the last position. position() gives absolute world coords. But maybe add uAbs and uAbs to access the local uv coordinates (the user does not know along which axis the handle moves maybe) ?
2026-09-24 13:56 +0200  Yes good point.  build it with tu/tv
2026-09-24 14:08 +0200  is saw the automap in the Handle.param() - can we bring that back? It's pretty nice. Also can you remove the object map - I think its too niche and not great to read.
2026-09-24 14:25 +0200  yes do the migrations pleae
2026-09-24 14:38 +0200  I dont see the new scripts in my editor. Can you check. Its in the sqllite db right?
2026-09-24 14:41 +0200  Can you print out the ur house sketch script i pasted in here? I lost it
2026-09-24 14:41 +0200  [Request interrupted by user]
2026-09-24 14:42 +0200  Can you put it in the local sqlite database?
2026-09-24 14:45 +0200  Can you write the script inside a tmp file in root folder ur_house_sketch.js please
2026-09-24 14:46 +0200  Can you test how scripts saved on the local storage in browser and ones of the server are resolved? I notice often that local storage scripts are not updated by the ones in the database
2026-09-24 14:53 +0200  Please commit the work on the handle/param mapping first
2026-09-24 15:10 +0200  commit it
2026-09-24 15:10 +0200  yes
2026-09-24 15:12 +0200  I ran this script and I made a mistake that probably happens more. Using a variable in the param mapping function (dragDir). See this code:

                        [pasted: 925 lines, starting "// urhousesketch"]

                         - how could we fix this? Can we make this work by prefilling the var variables (besides param and handle of course) ?
2026-09-24 15:16 +0200  For now 3 and 4 are nice. Do it for handles and dimensions please.
2026-09-24 15:31 +0200  I ran it with the dragDir but still doesn work:

                        [pasted: 925 lines, starting "// urhousesketch"]
2026-09-24 15:48 +0200  Can you see why I get wallDir.scale() is not a function ?
2026-09-24 15:48 +0200  Can you see why I get wallDir.scale() is not a function ?

                        [pasted: 933 lines, starting "// urhousesketch"]
2026-09-24 15:49 +0200  [Request interrupted by user]
2026-09-24 15:52 +0200  Can you fix this script so the handles of the two handles are right?

                        [pasted: 935 lines, starting "// urhousesketch"]

                         Finish the wall orientation mapping
2026-09-24 15:54 +0200  put it in the local sqlite database
2026-09-24 15:55 +0200  write it to the script. It does not load in my editor => please debug that
2026-09-24 20:29 +0200  In this script "

                        [pasted: 789 lines, starting "// urhousesketch"]

                        " ==> ERROR at line 492: "ParamManager: value does not match the schema for param "OPENINGS"!" -- can you make the error more descriptive?
2026-09-24 20:32 +0200  [Request interrupted by user]
2026-09-24 21:06 +0200  In script "

                        [pasted: 793 lines, starting "// urhousesketch"]

                        " ===> How to fix the frame orientation? (no commented out)
2026-09-24 21:08 +0200  Write this in ur_house_sketch.js please
2026-09-24 21:10 +0200  When I run it and open document tool i get this error: "RROR: "View::resolveShapeNameToSVG(): Variable "floorplanWithDrawings" resolved to undefined for view "floorplanWithDrawings". The pipeline function returned it but the value is empty.""
2026-09-24 21:29 +0200  In the same script "

                        [pasted: 794 lines, starting "// urhousesketch"]

                        " -- I get this ERROR at line 500: "- error: '$PARAMS.OPENINGS.set(): the value does not fit its definition (a list of "Opening"):" - Can you make this error more verbose. Its an entry of the list, but which and what value is at fault?
2026-09-24 21:35 +0200  Where is the MINIMIZED HANLDE OPACITY SETTING?
2026-09-24 21:37 +0200  Can you place the default settings in editor/src/settings.ts please. Underneath the other HANDLE settings
2026-09-24 21:39 +0200  Yes, remove these settings in settings.ts if they dont do anything. Place them in Handler
2026-09-24 21:43 +0200  Can you take the last version of ur_house_sketch in the db and copy it to the tests/cadscripts folder - there is a old version - urhousesketch - please remove that.
2026-09-24 22:01 +0200  I tried running the ur_house_sketch in brep mode, but got the "ERROR at line 498: "Make: the make module (walls, boarding, part lists, sheet packing) is only available in mesh mode — it builds mesh geometry. Run this script with kernel: 'mesh' (the default)." --- Is this really so? Can we make this work in brep mode too?
2026-09-24 22:45 +0200  Ok fix the document changes in the db and in the cadscripts. Then commit this work
```

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

## Values from the script for mapping functions (asked for during the work)

A handle's mapping function and a dimension line's remap run in the viewer, rebuilt from their
source text, so a variable of the script (`dragDir`) was not there and a drag silently did
nothing. Of the options discussed, Mark chose two: pass the values along
(`param(ref, fn, { dragDir })`, `params(fn, vars)`, `bindParam(name, remap, vars)`), and check
the function when it is defined (`CodeParser.detachFunction()` lists its free names with
acorn-globals; a name that is neither passed nor a JavaScript built-in throws, also in the script
console). Passed values must be plain data, which is why a Vector (`wallDir.scale()`) failed
in the viewer; the script now passes plain arrays.

## Script sync between browser and server (asked for during the work)

Mark saw local copies that were not replaced by newer versions from the database. Tested with
`apps/editor/tests/scripts-sync.test.ts` (the real state and sync modules against an in-memory
server): the load-time pull did not wait for the signed-in user and did nothing, so the editor
also sent every save as a create, which the server refused with a 500. The pull now waits for
`authReady` and drops a queued save of the local copy it replaces; the server answers a create
of an existing script with 409 and the editor saves a new version instead. Two known gaps are
pinned in the test (a stale open tab puts its copy back on a save; a run that changes nothing
still makes a version).

## Error messages (asked for during the work)

- `set()`/`push()` with a value that does not fit names every problem in one line: the list
  entry, the field, the value and the rule (`ScriptParam.describeSchemaErrors()`). One line,
  because the editor's error header showed only the first line of a message; the code box now
  also shows a multi-line quoted error in full.
- A document pipeline that throws reports the error in the script console, and a view whose
  variable is empty names that error.
- The defaults of `Handle.minimized()` (color, opacity 0.1) are constants in `Handle.ts`.
  Settings for them in the editor's `settings.ts` were tried and removed at Mark's request, as
  nothing read them.

## ur_house_sketch on the brep kernel (asked for during the work)

The script stopped on brep at the make module's mesh-only error. `make.frame()` only needs the
Modeler API both kernels have and now builds on brep; the other make builders stay mesh-only.
Running it then showed three divergences, fixed in core and meshup:

- brep `Wire.normal()` of a closed outline followed the corner order, while `extrude()` goes
  toward the positive axis (meshup's `Curve.normal()` does too): the wall cutters of the right
  and back walls, centred with `normal()`, landed outside the walls. Now turned toward the
  positive axis (kernel-divergences item 37).
- meshup `ShapeCollection.flatten()` could not take a brep Shell, which flattens to a
  collection of Faces, and `getAnnotations()` called `annotations()` on brep shapes, which
  hold them as an array.
- The Annotator kept the edges it had dimensioned in a collection of the script's kernel, which
  refused the edges of a mesh-kernel rect (the bbox rect of a collection) in a brep script.

The model and the document now run on brep; in the parity table ur_house_sketch matches except
the volume of `wallsCombined` (open item 36, the ring of walls brep cannot fuse in one piece).
Still open: brep drawings are nearly empty (the floor plan view shows only its bbox rect and the
dimensions, the isometry view is missing).

The cadscript `urhousesketch.js` was replaced by the latest `ur_house_sketch` from the local
database, with the two document fixes the agent made at Mark's request (each wall cut
separately before the merge, which the mesh kernel trapped on; `openingsGroundFloor`
defined); the same version is saved in the database.

## Review and decisions by the human

- Rejected a random-seed-only fix and override ids; chose a manual-mode switch with the generated
  layout written into the `OPENINGS` list.
- Rejected going through param defaults ("ugly"); `set()` is the right way.
- `set()` re-runs by default when the value changed, with an option to turn that off.
- Left the script (part C) out of the plan; added `push()` for consistency.
- Handles: chose `u`/`du`/`tu` and the `(param, handle)` function form, asked for autoMap
  back and the map object removed.
- Param menu: specified the list layout (indent, xs text, Add button on the name line, delete
  confirm) and reported the group-move bug.
- Mapping functions: chose passing values plus a check at definition (options 3 and 4), for
  handles and dimension lines; tested with the `dragDir` script in the editor.
- Reported the stale local copies, the unclear `set()` error and the empty document view from
  the editor.
- Decided the minimized-handle defaults live in `Handle.ts`, not the editor settings, and set
  the opacity to 0.1.
- Asked for the brep run and for the document fixes in the database and the cadscript; approved
  the split into commits and every commit message.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| cf90939 | Editor: regenerate the completions data (ordinary commit, generated data) | Can you add $handle to the suggestions? |
| b742672 | Handles: (param, handle) mapping with u/du/tu, DX fixes | 12:35, 13:11, 13:56, 14:08 |
| 0fda10c | Params: $PARAMS.X.set()/push() with optional re-run | 11:40 (plan parts A and B) |
| 9f77c45 | Param menu: list entries, Add button on the name line, group moves | 13:11 |
| c5567d7 | Handles, dimensions: pass script values to mapping functions | 15:16 |
| 0b43b24 | Handles: minimized() defaults as constants in Handle.ts | 21:39 |
| 9dfbf1f | Scripts: push saves after sign-in, 409 for an existing script | 14:46 |
| 2272af9 | Errors: name the list entry and rule, report doc pipeline errors | 20:29, 21:10, 21:29 |
| meshup c222040 | Kernel parity: flatten() and getAnnotations() with brep shapes | 22:01 |
| 08c399d | Kernel parity: ur_house_sketch runs on brep, frame() on both kernels | 22:01, 22:45 |
