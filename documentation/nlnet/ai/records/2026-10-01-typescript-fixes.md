# TypeScript errors: the easy ones in core, ui and meshup

| | |
|---|---|
| Dates | 2026-10-01 → 2026-10-01 |
| Model | Claude Sonnet 5.5 (claude-sonnet-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: direct requests) |
| Human | Mark van der Net: wrote the prompts, set the limit ("keep it simple, skip what is too complex"), pointed out that the brep kernel does have a wasm, approved the commit messages |
| Branch | `develop` (+ meshup main) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-01 00:35 +0200  Can you fix as much typescript warnings as problems as possible. Please keep it simple. Skip if it is too complex and takes more then a dozen of letters to fix.
2026-10-01 09:01 +0200  Can you do an effort to fix the easiest TS errors/warnings?
2026-10-01 10:05 +0200  the brep does have a wasm. Please do a review and see what errors you can clear up
2026-10-01 11:25 +0200  Yes please commit the TS fixes under NLNet policy
```

## Plan (agent output, reviewed by the human before implementation)

No plan mode. The agent ran `tsc --noEmit` per package (core 189 errors, ui 1654 under
its stricter config, meshup 0), grouped the errors by cause and fixed the ones with a
local, low-risk fix:

- unused declarations in ui (`file-info.ts`, `nav-bar.ts`)
- type imports that pointed at modules which do not export them (annotator, typeguards),
  and a wrong path to the Script type in `runner/types.ts`
- brep: the wasm import in `Point.ts` pointed at `../../wasm/`, the wasm lives in
  `brep/wasm/` (type-only import); `BeamLikeDims`, `LayoutOptions` and `LayoutOrderType`
  were used but never defined; the garbage-collection stub took one argument while its
  callers pass two; `getSubShapes()` was declared as an array but returns a collection
- `ShapeCollection.name()` in meshup got overloads like `Shape.name()`, so `name('x')` is
  typed as the collection (cleared most of `Make.ts`); `Modeler.collection()` is typed
  `ShapeCollection<any>`
- `ScriptParamType` is a const object plus union instead of an enum, so string literals
  type-check; `RunnerScriptExecutionRequest.kernel` is optional (the runner defaults it)
- real bugs the types exposed: `Layouter` called `Vector.set()` which does not exist,
  `Make` assigned to the read-only `Point.x`, brep `Edge.makeArc` (tangent) called
  `_toOcVector()` on a Vertex, brep `Edge` converted model units with the doc-unit
  converter (`fromMM` now)
- tests: casts where tests call mesh methods on the kernel-neutral union type, a
  wrong `contentAlign('center','center')` call, stale `bbox(100,100)` arguments

Left alone by the agent, and reported to the human: `Shape._addDimensionsToProj` (its filter compares the method
`type` to a string, so the block never runs; making it match would reach `_project` and
`setValue` which do not exist there), `@types/semver`, `__APP_VERSION__`, and the
errors that ui reports only because its config is stricter than core's own.

## Review and decisions by the human
- Told the agent the brep kernel does have a wasm; the brep errors were then reviewed
  and fixed instead of being skipped as legacy.
- Core `tsc --noEmit`: 189 → 3 errors (the dead block above). Core tests: the three
  checked-in `cadscripts` snapshot tables fail with and without these changes; two
  other tests failed once under full-suite load and pass alone.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| `5796ff8` (meshup) | ShapeCollection.name() typed like Shape.name() | Can you do an effort to fix the easiest TS errors/warnings? |
| `cd85281` | Clear TypeScript errors: brep types, imports, unused code | the brep does have a wasm. Please do a review and see what errors you can clear up |
