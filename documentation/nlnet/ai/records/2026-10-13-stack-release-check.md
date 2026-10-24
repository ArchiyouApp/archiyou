# Stack release check: core 0.10.0, dumps ignored

| | |
|---|---|
| Dates | 2026-10-13 → 2026-10-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a release-readiness check, then the small fixes from it) |
| Human | Mark van der Net: wrote the prompts, asked for the check before a release of the stack and for its small fixes |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

The prompts from 19:10 to 19:37 asked for the commits of other units in the same session
(rowFill, editor UI tweaks, boarding) and of work outside the policy.

```
2026-10-13 19:01 +0200  I want to do a new release of the stack. Please check if all is OK
2026-10-13 19:05 +0200  do the small fixes
2026-10-13 19:10 +0200  first commit the rowFill work.
2026-10-13 19:17 +0200  y
2026-10-13 19:19 +0200  commit the small stuff together
2026-10-13 19:20 +0200  done. what solution for the lockfile?
2026-10-13 19:28 +0200  do option 1
2026-10-13 19:30 +0200  yes commit
2026-10-13 19:31 +0200  meshup is pushed. can you commit metrics and code editor together under Editor: menu UI tweaks (NLNet policy). Boarding under another
2026-10-13 19:34 +0200  commit the local-db skill changes too, but not under nlnet policy. its not important.
2026-10-13 19:35 +0200  Did you bump the editor version already?
2026-10-13 19:36 +0200  Bump to 0.4.0. and commit (not under nlpolicy)
2026-10-13 19:37 +0200  Can you commit the work on the private modules too? No NLpolicy needed
2026-10-13 19:37 +0200  untrack these files please.
2026-10-13 20:18 +0200  on the server i get a build error. Can you test here?
2026-10-13 20:19 +0200  This is the error: "
                        
                        <pasted_content id="eab4">
                        | error during build:
                        archiyou-api       | [vite:worker-import-meta-url] ../../packages/core/src/modeler/brep/Shape.ts (43:35): "moveUntilTouching" is not exported by "../../packages/meshup/src/index.ts", imported by "../../packages/core/src/modeler/brep/Shape.ts".
                        archiyou-api       | file: /archiyou/packages/core/src/modeler/brep/Shape.ts:43:35 (/archiyou/packages/core/src/runner/worker/RunnerWorker.ts)
                        archiyou-api       |
                        archiyou-api       | 41: // Style model, which is what lets the scene navigator and the GLTF exporter stay kernel-agnostic.
                        archiyou-api       | 42: import { SceneNode } from '@archiyou/meshup'
                        archiyou-api       | 43: import { nodeToString, gridCounts, moveUntilTouching, rowFillOffsets } from '@archiyou/meshup'
                        </pasted_content id="eab4">
                        
                        "
2026-10-13 20:21 +0200  Now this: "
                        
                        <pasted_content id="eab4">
                        ✓ 2084 modules transformed.
                        archiyou-api       | ✗ Build failed in 9.49s
                        archiyou-api       | error during build:
                        archiyou-api       | [vite:worker-import-meta-url] ../../packages/core/src/modeler/brep/Shape.ts (43:54): "rowFillOffsets" is not exported by "../../packages/meshup/src/index.ts", imported by "../../packages/core/src/modeler/brep/Shape.ts".
                        archiyou-api       | file: /archiyou/packages/core/src/modeler/brep/Shape.ts:43:54 (/archiyou/packages/core/src/runner/worker/RunnerWorker.ts)
                        archiyou-api       |
                        archiyou-api       | 41: // Style model, which is what lets the scene navigator and the GLTF exporter stay kernel-agnostic.
                        archiyou-api       | 42: import { SceneNode } from '@archiyou/meshup'
                        archiyou-api       | 43: import { nodeToString, gridCounts, moveUntilTouching, rowFillOffsets } from '@archiyou/meshup'
                        </pasted_content id="eab4">
                        
                        "
2026-10-13 20:25 +0200  I did pull in the private archiyou_modules - but the modules dont show up
2026-10-13 20:28 +0200  modules are indeed not build: 
                        
                        <pasted_content id="eab4">
                        module 'cloudcalc' skipped: bundle.js is missing (looked in ./ and ./dist)
                        archiyou-api       | ⚠ module 'fab' skipped: bundle.js is missing (looked in ./ and ./dist)
                        archiyou-api       | ⚠ module 'optimize' skipped: bundle.js is missing (looked in ./ and ./dist)
                        archiyou-api       | ⚠ module 'pv' skipped: bundle.js is missing (looked in ./ and ./dist)
                        archiyou-api       | ⚠ module 'struct' skipped: bundle.js is missing (looked in ./ and ./dist)
                        </pasted_content id="eab4">
                        
                         - How can I rebuild them?
2026-10-13 20:29 +0200  I get this error: "
                        No projects matched the filters in "/archiyou"
                        "
2026-10-13 20:30 +0200  yes commit. no need for the nlnet AI policy
2026-10-13 20:34 +0200  I ran "docker compose exec -w /archiyou api pnpm --filter './modules/**' build" and get this: 
                        
                        <pasted_content id="eab4">
                        modules/archiyou-modules/cloudcalc prebuild$ node scripts/build-wasm-binary.m…
                        │ build-wasm-binary: formualizer 0.8.4: 8.6 MB wasm → 4.1 MB in the bundle
                        └─ Done in 713ms
                        modules/archiyou-modules/fab build$ vite build
                        │ vite v6.4.1 building for production...
                        │ transforming...
                        └─ Running...
                        modules/archiyou-modules/optimize build$ vite build
                        │ vite v6.4.1 building for production...
                        │ transforming...
                        └─ Running...
                        modules/archiyou-modules/pv build$ vite build
                        │ vite v6.4.1 building for production...
                        │ transforming...
                        │ ✓ 14 modules transformed.
                        │ rendering chunks...
                        │ computing gzip size...
                        │ dist/bundle.js  316.45 kB │ gzip: 124.58 kB
                        │ ✓ built in 385ms
                        └─ Done in 722ms
                        modules/archiyou-modules/cloudcalc build$ vite build
                        │ vite v6.4.1 building for production...
                        │ transforming...
                        └─ Running...
                        modules/archiyou-modules/struct build$ vite build
                        │ vite v6.4.1 building for production...
                        │ transforming...
                        │ ✓ 8 modules transformed.
                        │ ✗ Build failed in 203ms
                        │ error during build:
                        │ There was an error during the build:
                        │   Could not resolve "./wasm/dedaliano_engine.js" from "ts/loader.ts"
                        │ Additionally, handling the error in the 'buildEnd' hook caused the followin…
                        │   [plugin struct:drop-wasm-url-fallback] struct: wasm URL fallback not foun…
                        │ file: /archiyou/modules/archiyou-modules/struct/ts/loader.ts
                        │     at getRollupError (file:///archiyou/node_modules/.pnpm/rollup@4.60.0/no…
                        │     at file:///archiyou/node_modules/.pnpm/rollup@4.60.0/node_modules/rollu…
                        │     at async catchUnfinishedHookActions (file:///archiyou/node_modules/.pnp…
                        │     at async rollupInternal (file:///archiyou/node_modules/.pnpm/rollup@4.6…
                        │     at async buildEnvironment (file:///archiyou/node_modules/.pnpm/vite@6.4…
                        │     at async Object.defaultBuildApp [as buildApp] (file:///archiyou/node_mo…
                        │     at async CAC.<anonymous> (file:///archiyou/node_modules/.pnpm/vite@6.4.…
                        └─ Failed in 554ms at /archiyou/modules/archiyou-modules/struct
                        /archiyou/modules/archiyou-modules/struct:
                         ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @archiyou/module-struct@0.1.0 build: `vite b                                            uild`
                        Exit status 1
                        </pasted_content id="eab4">
2026-10-13 20:36 +0200  Can we just add that wasm structurally
2026-10-13 20:37 +0200  push the modules repo
```

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

Then the lockfile, on request. Two options were put to the human: an unfrozen install on the
server when the overlay is present, or a full lockfile kept in the private modules repo. They
chose the first:

- `apps/server/docker-entrypoint.sh`: with `modules/*` (or `modules/*/*`) manifests present, the
  install runs `--no-frozen-lockfile` and copies the tracked `pnpm-lock.yaml` back afterwards, so
  `git pull` stays clean; without them it stays frozen. A changed module `package.json` now
  also triggers an install, since the lockfile cannot show it. Checked by running the step against
  this checkout (overlay present): the install passes, the lockfile is byte-identical after, a
  second run skips, and touching a module manifest installs again.
- `modules/README.md`, `apps/server/README.md`: no longer say the server never sees `modules/`;
  the manual install with the overlay.

Then the deploy, on the server: the private modules were skipped, `bundle.js is missing`. The
entrypoint's modules build had never built anything there: pnpm resolves a path filter like
`./modules/**` against the current directory, not against `--dir`, the image's `WORKDIR` is
`apps/server`, and a filter that matches nothing exits 0. `build()` in
`apps/server/docker-entrypoint.sh` now runs from `$REPO` in a subshell. Checked by running the
function from `apps/server`: the filter matches the five modules, and the shell stays where it
was.

## Review and decisions by the human

- Asked for the small fixes after reading the report.
- Chose the unfrozen server install (option 1) for the lockfile; the private modules' own
  dependencies are not pinned on the server.
- Reported the build error and the skipped modules from the server deploy, and asked for the
  entrypoint fix to be committed without the disclosure (`ac74273`). The struct wasm glue in the
  modules repo (`d7824fe`) went in without it too, as the earlier modules commits of that session.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| `a07e150` | Core 0.10.0, ignore dumps | 19:05 |
| `9cc1614` | Server: unfrozen install when private modules are present | 19:28 |
| `ac74273` (no disclosure, at the human's request) | Server: build the private modules from the repo root | 20:25, 20:28, 20:29, 20:30 |
| `d7824fe` (modules repo, no disclosure) | struct: commit the generated wasm glue and base64, so the server can build | 20:34, 20:36 |
| (this commit) | Close the disclosure record for the stack release check | |
