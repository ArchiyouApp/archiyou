# Standard modules: cloudcalc without a `$module()` declaration

| | |
|---|---|
| Dates | 2026-11-03 → 2026-11-03 |
| Model | Claude Fable 5.1 (claude-fable-5-1), 1M context, Claude Code agent |
| Tool | Claude Code as agent (a study question, then "execute the idea") |
| Human | Mark van der Net: asked for the study, decided that standard implies public, approved the design, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

The cloudcalc module itself lives in `modules/` (the private `archiyou-modules` repo). It is out of
NLnet scope; its one-line manifest change (`"standard": true`) is committed there as ordinary work.
This record covers the engine, module SDK, server and editor side.

## Prompts (verbatim, local time)
```
2026-11-03 11:20 +0100  The module cloudcalc is used a lot, structurally. For example in ProductManager. I think it would be best to have modules that are standard and are preloaded by default. Can you study how this could work simply?
2026-11-03 11:53 +0100  Standard does implies public. Execute the idea
```
The study's answer (the plan below) was given in the terminal; the two commit questions were
answered by choosing the proposed summary and "Yes, commit both".

## Plan (agent output, reviewed by the human before implementation)

### How it works today

Modules are opt-in by design. The registry loads a module only when the source contains
`$module('name')`, read ahead of the run because bundle loading is async and the scope is built
synchronously. A script that uses a global without declaring it gets a stub that says "add
$module('cloudcalc')". ProductManager follows the same rule: its `_openSheet` asks the registry for
cloudcalc at run time and throws that same advice when it is missing. The modules README gives three
reasons for the rule: fail at the top, fetch nothing by accident, and state the dependency in the
source.

### The constraint that shapes the answer

"Preloaded by default" cannot mean "loaded on every run": the cloudcalc client bundle is 4.4 MB,
loaded once per session (the registry caches instances across runs and the bundle URL is versioned).
Fetching and parsing that for every script that never touches a sheet breaks the lean rule set for
the animator. So "standard" means: no declaration needed, still loaded only when this run needs it.

### Design: a `standard` manifest flag

- **Manifest.** `standard?: boolean` next to `public` in `packages/module-sdk/src/types.ts`, mirrored
  to core with the sync script, allowed in the server's manifest schema. The deployment sets it, like
  `public`. A standard module is public: the server marks it entitled for everybody.
- **Registry.** In `prepare()`, a standard module counts as declared when the code names its global
  (the existing word match, which today only binds a stub), or when a core feature that needs it is
  used: a small table in `constants.ts`, one entry for now (cloudcalc when the code contains
  `fromSheet(`, `fromOffer(` or a Google Sheets URL). Components' code is already scanned with the
  script.
- **Escape hatch.** `$module('cloudcalc')` keeps working and stays the fix when the scan misses (a
  dynamically built name). The ProductManager error text stays valid.
- **UI and docs.** The modules menu says "standard, no declaration needed" instead of "Use it with
  $module(...)". The README section "The declaration is required" gets a paragraph. The Runner's
  `$module` JSDoc and two test files get small additions.

Nothing else moves: the editor already prefetches sheets by scanning for URLs, independent of any
declaration, and published configurators on the server get the flag through the same catalog.

### What is given up

For standard modules only, a mention in a comment can trigger one bundle load per session, and an
unentitled or broken module fails at first use instead of at the top.

### Rejected alternatives

Bundling cloudcalc into core (private repo, 4.4 MB in every build). Loading all standard modules
every run (lean rule). A "module needed" error with an automatic second run, like the content
re-run loop (exact, but a wasted partial run and more machinery than the trigger table).

## Review and decisions by the human

- 2026-11-03: "Standard does implies public." A standard module needs no entitlement; one predicate
  (`isPublicModule`) serves the catalog, the bundle route and the call route.
- Approved the design as studied, without changes; chose the proposed commit summary.
- Left ProductManager's doc and error-text changes (the same wording change, in a file carrying
  unrelated products work) to be committed with that work.
- Checks: core module suites (ModuleRegistry, runner.modules: 69 tests) and server module suites
  (modules.public, modules.gating, moduleHost: 80 tests) pass; core and module-sdk type-check (the
  Shape.ts errors present at the time come from other uncommitted work); the API help data was
  regenerated and only the `$module` entry changed.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| 211ba23 | Standard modules: cloudcalc without a `$module()` declaration | 11:53 "Execute the idea" |
| (this commit) | Close the disclosure record for standard modules | — |

Out of scope, in the private `archiyou-modules` repo: 0cb9499 `cloudcalc: standard module (no $module() needed, public)`, one manifest line.

