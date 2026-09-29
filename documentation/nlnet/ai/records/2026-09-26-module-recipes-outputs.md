# Script modules: recipes and output formats; fab out of the engine

| | |
|---|---|
| Dates | 2026-09-26 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: research in the session, plan approved before implementation) |
| Human | Mark van der Net: wrote the prompts, asked for the change, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

`fab` (fabrication operations, fastening, estimates) and the BTLx writer leave `packages/core`. The
module system gains two general hooks so that a script module can take their place: a module can ask
for shape recipes, and a module can build model output formats. The fab code itself went to a
separately distributed script module outside this repository, which is out of scope for this record.

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Research

- Script modules depend only on `@archiyou/module-sdk`, are built into one self-contained bundle and
  are declared in a script with `$module('name')`. A client module reaches the engine through
  `setArchiyou(ay)`.
- Code that reads shape recipes (`recipeOf`, `resolveRecipe`, `classify`, ...) cannot be bundled
  into a module: `Recipe.ts` imports the whole mesh kernel. The engine has to hand the read functions
  over, and recipe recording (costly, so only on when something reads it) needs a declared trigger;
  the Runner had a special case that searched script code for `fab.x(`.
- Output formats are fixed in core (`SCRIPT_OUTPUT_MODEL_FORMATS`, output path validation, one case per
  format in the Runner). A module has no way to add one, so `default/model/btlx` needs a hook to keep
  working once the writer is outside core.

### Steps

1. **SDK contract** (`packages/module-sdk/src/types.ts`, synced to core with `sync:sdk-types`):
   manifest `recipes?: true` and `outputs?: AyModuleOutput[]`
   (`{ format, category: 'model', ext, mime, label?, description? }`); module method
   `output?(format, ctx)` returning the file; `AyArchiyou.recipes` (the read API).
2. **ModuleRegistry**: remember the entries loaded this run; `needsRecipes()`,
   `outputProvider(format)`; validate declared output formats; drop `fab` from the reserved names.
3. **Recipe.ts**: export `recipeApi`, the read-only functions modules may use.
4. **Runner**: recipe recording follows `needsRecipes()` (replaces `_usesFab`); `_loadFabWhenUsed`
   and the `fab` scope binding go; `_archiyou.recipes` is set before modules are linked; a model
   format that is not built in is built by the module that declares it, with an error naming the
   `$module()` to add when the script does not declare it.
5. **Output paths**: a model path accepts a format core does not know (a plain lowercase token);
   wildcards still expand to built-in formats only.
6. **Remove** `Fab.ts`, `BTLxExporter.ts`, `fab.json`, `Modeler.fab/_fabState/loadFab/toBTLx`, `btlx`
   from the core format lists, the four fab tests and `test:fab`, the fab check in `check-pack.ts`, Fab
   from the API generator, the docs reference and `api.generated.json`, and the `fab` completions in
   `packages/ui`. The editor's btlx export handler and mime entry stay: they are format-agnostic.
7. **Tests**: registry flags, output validation and provider lookup; a Runner run that builds a format
   through a stub module, the errors for an undeclared module and an unknown format, and a stub module
   that reads recipes through `ay.recipes`.

## Carried out

The steps above, plus:
- **Modules declared in components**: component scopes get the run's module globals, which were
  prepared from the host script only, so a declaration inside a component never loaded its module.
  `_prepareModules` now also reads the prefetched component scripts.
- **`internal` model output**: the Runner used to log and skip it; the new module-format branch only
  handles module-shaped tokens and keeps that skip (found by the component tests).
- **Backend manifest schema** (`apps/server/src/modules/manifestSchema.ts`) mirrors the SDK and now
  validates `recipes` and `outputs`.
- **`modules/README.md`** documents `recipes`, `outputs`, `output()` and declarations in components.

Verified: core unit tests (1,589 passed; the brep `Shelling` test times out under load as it did
before) including `ModuleRegistry.test.ts` and `runner.modules.test.ts`; cadscripts (31); ui (one
failing help-tutorial check that fails without this change too); editor fulfillment tests; the dev
backend accepts a manifest with the new fields.

Open, left as is: module bundles are served to signed-in users only, also for public modules; and
server-side runs load no script modules.

## Review and decisions by the human
- Asked to move fab and the BTLx export out of core into a module, after a short research.
- Did not answer the design questions and asked to continue, so the agent took its recommended
  defaults, among them the general output-format hook for BTLx.
- Kept the module itself out of these disclosures: it is outside the NLnet scope.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
