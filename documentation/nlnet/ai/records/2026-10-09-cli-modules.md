# CLI: `--modules` runs scripts that use script modules

| | |
|---|---|
| Dates | 2026-10-09 → 2026-10-09 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a question answered, then a small feature on its approval) |
| Human | Mark van der Net: asked why the CLI could not load the fab module, approved the proposed `--modules` option, had it committed |
| Branch | `keys` |
| Session transcript | kept locally; the prompts are reproduced in full below |

The session was about a fab module demo script. The fab module is in `modules/` (the private
`archiyou-modules` repo) and out of NLnet scope; this record covers only the CLI change, which works
for any client module.

## Prompts (verbatim, local time)
```
2026-10-09 12:20 +0200  Why cant the cli not access the fab module?
2026-10-09 12:26 +0200  yes
```

## What was wrong and the fix (agent summary)

The CLI never gave the Runner a module catalog nor a way to load a bundle, so every `$module()` failed
with "no such module". The editor gets both from the server.

- `packages/cli/src/run.ts`: `--modules <dir>` (repeatable) points at a module directory or one that
  holds modules; from this repo the modules checkout is used without it. The CLI reads each
  `manifest.json` (client modules only), lists it in the run's catalog and loads the built
  `bundle.js` or `dist/bundle.js` from disk through core's own `loadClientModule`, so version checks
  apply. A missing, unbuilt or incompatible module fails at its `$module()` line with the reason.
- `packages/core/src/index.ts`: exports `loadClientModule` (one line).
- `packages/cli/src/archiyou.ts`, `common.ts`: help text and the default modules directory.
- The skill's troubleshooting table names the flag; a test module `tests/fixtures/modules/twice`
  and two tests.

## Review and decisions by the human

- Approved adding the option ("yes", 12:26) after the agent's explanation and its limits: client
  modules only, the bundle must be built, the modules are in a private repository.
- The agent ran the CLI tests (24/24, again before committing) and the fab window demo through the
  CLI. Not verified: the published `npx` build, which needs core's Node build rebuilt.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see git log | 12:20, 12:26 |
