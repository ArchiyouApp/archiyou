# Contributing to Archiyou

Thanks for looking. Archiyou is a small project, so a quick issue before a large
pull request saves everyone effort — for typo fixes and obvious bugs, just open
the PR.

## Getting set up

```bash
git clone --recursive https://github.com/ArchiyouApp/archiyou.git
cd archiyou
pnpm install
pnpm dev
```

Node 22+, pnpm 10.32+ (`corepack enable`). No Rust toolchain needed unless you
are rebuilding a WASM kernel — the artifacts are committed.

If `pnpm install` complains that `@archiyou/meshup` is missing, the submodule
isn't checked out: `git submodule update --init --recursive`.

## Before you open a PR

```bash
pnpm --filter @archiyou/editor build     # must succeed
pnpm --filter @archiyou/server test
pnpm --filter @archiyou/ui test
pnpm test:core
```

CI runs the same thing. Note that **`tsc` does not pass repo-wide** and is not a
gate. Each package's *own* source must typecheck cleanly against its dependencies'
real types (`typecheck:own`), but `packages/core` has a backlog and gets a ratchet
instead: `typecheck:budget` fails only if the error count goes *up*. Don't feel
obliged to fix unrelated type errors in files you touch, but please don't add new
ones — and if you clear some, lower the budget in `packages/core/package.json` in
the same commit.

Two suites are known-quirky and not your fault:

- `packages/core` `tests/unit/runner/repro.debug.test.ts` is skipped: it is a
  scene-graph dump that asserts `toEqual('SHOW')` and can never pass by design.
- A couple of `Curve` tests in the meshup submodule can time out only in a full
  parallel vitest run. Re-run the file on its own to confirm.

## Code style

There is no ESLint or Prettier config yet (adding one is a welcome PR). Match the
file you are editing. Prevailing conventions:

- **Lit components** follow the section ordering in `AGENTS.md`:
  `1. Render`, `2. State`, `3. Lifecycle`, `4. Behaviour`, `5. Styles`. Keep the
  numbered comment banners.
- Allman braces in `packages/core`, `packages/ui` and the editor; K&R in
  `apps/server`. Follow the neighbours.
- Styling goes through design tokens, never hard-coded colours — see `DESIGN.md`.
- Comments should explain *why*, especially where something is non-obvious or
  load-bearing. Several files carry warnings about trust boundaries; please keep
  those accurate if you change the surrounding code.

## Commit messages

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
`test:`) with an optional scope, e.g. `fix(server): …`. Explain what changed and
why in the body; if you fixed a bug, say what the wrong behaviour was.

## Things to know before touching certain areas

**Script execution.** `packages/core/src/runner/Runner.ts` compiles user scripts
with `new AsyncFunction`. In the browser that is contained by the Web Worker
boundary; on the server it is not. Anything that moves script-derived code or
data toward the main thread, or that widens what the server will execute, is a
security change — please flag it explicitly in the PR. See
[SECURITY.md](SECURITY.md).

**The meshup submodule.** `packages/meshup` is a separate repository
([ArchiyouApp/meshup](https://github.com/ArchiyouApp/meshup)). Geometry-kernel
changes belong there; this repo only pins a commit. Bumping the pin is a normal
PR here.

**Scene membership.** Methods on meshup shapes that produce new shapes need the
appropriate `@scene*` decorator or the result never enters the scene. If a shape
mysteriously fails to render, that is the first thing to check.

**Database changes.** Edit `apps/server/src/db/schema.ts`, then
`pnpm --filter @archiyou/server db:generate`. Migrations run automatically on
boot, so they must be safe against an existing database — if a column changes the
meaning of existing rows, add a backfill (see migration `0002` for an example).

## Reporting bugs

Include the script code if the bug is geometry-related, the browser and OS, and
anything from the console. A minimal script that reproduces it is worth a great
deal.

Security issues go to **info@archiyou.com**, not the public tracker.

## License

Contributions are accepted under Apache-2.0, matching the project.
