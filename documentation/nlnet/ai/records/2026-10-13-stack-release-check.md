# Stack release check: core 0.10.0, dumps ignored

| | |
|---|---|
| Dates | 2026-10-13 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a release-readiness check, then the small fixes from it) |
| Human | Mark van der Net: wrote the prompts, asked for the check before a release of the stack and for its small fixes |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Work (agent output; no separate plan)

The check ran the CI gates locally on the working tree. Passing: the editor build; the server,
UI, core runner and core param tests; the SDK mirror check; the four typechecks (core within
its budget); the meshup tests (`vitest run`, 1510 passed, 2 expected failures); the
Caddyfile and compose validation; the worker-secrets check with `.env.example`; the
private-modules boundary. All submodule pins exist on their remotes.

Not ready, and left to the human:

- `pnpm install --frozen-lockfile` fails while the private `cloudcalc` module is present: the
  public lockfile has no importer for it. The server's startup runs exactly that install,
  so a deploy with the modules would stop there. The open lockfile question of
  2026-10-01 is unchanged.
- Uncommitted work: the open `rowFill` unit (core, ui, editor and meshup) and `cloudcalc`
  changes in the modules repo.
- CI on GitHub could not be checked (no `gh` here).

The small fixes, the only changes of this unit:

- `.gitignore`: `*.dump`, so the pg_dump file in the root cannot be committed by accident.
- `packages/core/package.json`: version `0.10.0`; core changed in 85 source files since
  `main` and still read `0.9.0`.
- `apps/server/_v.mts`, an untracked one-off query script, deleted.

## Review and decisions by the human

- Asked for the small fixes after reading the report.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
