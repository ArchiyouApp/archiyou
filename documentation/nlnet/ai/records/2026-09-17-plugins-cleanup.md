# Plugins cleanup: remove the editor plugin system, to be revisited with modules

| | |
|---|---|
| Dates | 2026-09-17 → 2026-09-17 |
| Model | Claude Fable 5.1 (claude-fable-5-1), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a removal, inventoried from the code before deleting) |
| Human | Mark van der Net: wrote the prompts below, decided to remove the plugin system and revisit it later together with modules, reviewed the resulting diff |
| Branch | `recipe` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-17 20:43 +0200  Can you remove all work related to the plugins? I want to revisit this later. Maybe in combination with modules.
2026-09-17 21:34 +0200  Commit according to the NLNET AI disclosure skill with the following message: "Cleanup plugins: revisit at later stage"
```

## Plan (agent output, reviewed by the human before implementation)

No separate plan: the first prompt is the whole task. The agent inventoried every
reference to the runtime-loaded editor plugin system (all of it from the initial
open-source commit, none in the uncommitted work) and removed it in one pass:

- Deleted: `apps/editor/src/plugins/` (PluginManager, plugin-loader, plugin-part-frame,
  plugin-session, types), `apps/editor/src/pages/plugin.ts` and `plugin-app.ts`,
  `apps/editor/src/state/plugin-mode.ts`, the example plugin and docs in `plugins/`, and
  the core regression test that imported the example plugin's script.
- Unwired: plugin mode in `apps/editor/src/pages/editor.ts` (left-panel variant, menu
  handlers, save-to-disk, plugin toolbar tools, CSS); the plugin branches in
  `packages/ui` main-menu, tool-panel and toolbar (`ToolDef.plugin`/`ui` fields and the
  purple tint); the `/plugin` route; the dev-only Vite middleware serving `/plugins`; the
  commented-out Caddy and docker-compose mounts; comment and README mentions.
- Kept: the `blob:` CSP allowance (Vite workers and client module loading need it) and
  the historical mentions in earlier AI records.

Verification: editor and ui typecheck (no errors in touched files; pre-existing meshup
and file-info noise unchanged), editor tests 49 passed, ui tests 89 passed, and a
production Vite build of the editor.

## Review and decisions by the human

- Decided to drop the plugin system for now and revisit it later, possibly merged with the modules mechanism.
- Reviewed the removal summary and asked for the commit with the subject "Cleanup plugins: revisit at later stage".

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| 62f3a4c | Cleanup plugins: revisit at later stage | the prompt of 2026-09-17 20:43 |
