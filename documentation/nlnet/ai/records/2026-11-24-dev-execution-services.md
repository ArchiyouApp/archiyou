# pnpm dev with server-side execution

| | |
|---|---|
| Dates | 2026-11-24 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the setup, wrote the prompts, reviewed the proposal and the code |
| Branch | `develop` |
| Session transcript | kept locally (session 21b78ca7); the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

### Findings

- The API connects to Redis once, at boot (`apps/server/src/plugin.ts`): a Redis that
  comes up after `pnpm dev` leaves `/execute` at 503 until the server restarts.
- The worker is not part of `pnpm dev`; it needs a second terminal (`pnpm dev:worker`).
- The worker needs `packages/meshup/dist` and exits on a fresh checkout without it.
- `pnpm docker:dev` always starts Postgres too, unwanted when PGlite or the tunnel is the
  database.

### Proposal

1. `scripts/dev-services.mjs`, run first by `pnpm dev`: use a Redis that already answers
   on `SERVER_REDIS_PORT`; otherwise start only the `redis` service of
   `docker-compose.dev.yml` when Docker is available; otherwise warn and continue. Build
   `packages/meshup` once when its `dist/` is missing.
2. `pnpm dev` runs editor + server + worker through `concurrently`; `pnpm dev:noexec`
   keeps the old behaviour; `dev:modules` gets the same pre-step and worker.
3. Postgres stays opt-in (`pnpm docker:dev`), untouched by `pnpm dev`.
4. Update the header of `docker-compose.dev.yml` (and the READMEs) to match.

## Review and decisions by the human

- Approved the proposal as written ("yes, implement it").

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
