## What this changes

## Why

## How it was verified

<!-- Please be specific: which commands, which suites, and what you saw. -->

- [ ] `pnpm --filter @archiyou/editor build` succeeds
- [ ] relevant tests pass (`server` / `ui` / `core`)
- [ ] checked in a running app, if it touches the UI

## Security

- [ ] This change does **not** widen what the server will execute, nor move
      script-derived code or data toward the main thread.

If either applies, say so explicitly and describe the new trust boundary — see
[SECURITY.md](../SECURITY.md) and the notes in `Runner.ts` /
`param-behaviours.ts`.

## Notes for the reviewer

<!-- Anything you are unsure about, deliberately left out, or want a second
     opinion on. Known-quirky suites are listed in CONTRIBUTING.md. -->
