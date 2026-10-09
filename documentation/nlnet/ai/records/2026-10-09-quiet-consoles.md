# Quiet consoles: step logging removed from the Archiyou and browser consoles

| | |
|---|---|
| Dates | 2026-10-09 → 2026-10-09 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a clean-up) |
| Human | Mark van der Net: asked for the clean-up, had it committed |
| Branch | `keys` (+ meshup `main`) |
| Session transcript | kept locally; the prompts are reproduced in full below (three sessions: the work, and two picking up the commit after computer crashes) |

## Prompts (verbatim, local time)
```
2026-10-09 13:55 +0200  There are lot of messages in the console (both archiyou console, and the browser one). Can you check and clean that up? For some important events, just simplify
2026-10-09 15:59 +0200  please commit the work on console
2026-10-09 18:41 +0200  ok finish 1 please, then do 3
```

## What changed (agent summary)

Running `ur_house_sketch` in the editor put 71 messages in the Archiyou console; now 1. The CLI with
`--verbose` went from 1249 lines to 2.

- **Archiyou console:** the internal step logs are gone (scope setup, param globals, layers and tables
  created, export steps, component cache, selectors, meshing). 17 "Could not find X in Modeler"
  warnings came from old sketch method names still listed in `MODELER_METHODS_INTO_GLOBAL`
  (`constants.ts`); those names were taken off the list. The "Detected a function definition" warning,
  the `DimensionLine not initialized` warning and the `INIT AY CONSOLE` banner are removed; three
  multi-line pipeline warnings are one line.
- **Browser console:** no more full code dumps from the editor (on every keystroke) and the Runner (on
  every run), nor request, param and result dumps, worker warm-up messages or a log per handle drag.
  The Archiyou console still collects everything, but only warnings and errors are echoed to the
  browser; `Runner.LOGGING_DEBUG` echoes all. Kept as one line: `Archiyou runner ready in N ms` and
  `Meshup kernel loaded in N ms`.
- **meshup:** view drawing logged `getGroup(): No group 'hidden'` errors for views without hidden
  lines; it now checks the groups quietly. Two step logs and the init logs are removed.
- Timing variables left unused by the removed logs were deleted when committing.

Left alone: the timing logs in `cloud-copies.ts` and `execution-service.ts` (other work in progress),
the server's own logging, and notices from Lit and Web Awesome.

## Review and decisions by the human

- Asked for the clean-up and had it committed (2026-10-09). The agent ran the CLI tests (24/24), the
  meshup projection tests (73/73) and core (1715 pass; 7 fail on the kernel-load test timeout only),
  compared the CLI model output, and checked the live editor. At commit time the staged snapshot was
  type-checked against HEAD: no new errors.
- Open: the editor's autocomplete (`packages/ui/src/editor/completions.ts`) still offers the removed
  globals (`moveTo`, `isTemp`, …).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| meshup (see meshup git log) | see git log | 13:55 |
| (this commit) | see git log | 13:55, 15:59 |
