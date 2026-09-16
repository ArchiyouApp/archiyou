# Agent guide lines

## General coding style

* We prefer Allman style symmetrical braces. Please in this way always
* Please avoid for(..) and while(...) loops if you can also use a .map/reduce() loop.

## WASM libraries

We use Rust libraries compiled to WASM in this Typescript module

The mesh kernel is the `@archiyou/meshup` workspace package — a git submodule at
`packages/meshup`, whose Rust sources live in `packages/meshup/rust/` (themselves submodules:
hypercurve, hyperreal, hypersolve, hyperlattice, hyperlimit). There is no `./devlibs/` directory
any more; that layout is gone.

Please always use `pnpm build:wasm` to build the WASM. Don't try your own compilation commands.
Run it from `packages/meshup` — this package has no `build:wasm` script of its own.

The brep binary (`src/modeler/brep/wasm/archiyou-opencascade.wasm`) is different: it is vendored
prebuilt OCCT, not built from anything in this repo. Don't try to rebuild it. See ATTRIBUTION.md.

## MESH KERNEL BY DEFAULT

The Modeler has two kernels: meshup (the default) and brep (`src/modeler/brep/*`, OCCT). Brep is
fully wired — not a stub. Scripts opt into it with `mode('brep')` or a `kernel: 'brep'` run
option, and a few primitives (spiral, helix, cone, basePlane) exist only there.

Even so, work on the mesh path unless the task is explicitly about brep or about parity between
the two. When a request doesn't say which kernel it means, assume meshup.

### Avoid these recurring problems ####

- Avoid stray .js files output: If you need to do TS checking please always use --noEmit with tsc

## Tests

The suite is split into two vitest projects (`vitest.config.ts`):

| project | path | what it is |
| --- | --- | --- |
| `unit` | `tests/unit/` | kernel and runtime suites — fast, hermetic |
| `cadscripts` | `tests/cadscripts/` | whole CAD scripts run end to end through the Runner, writing models to `tests/outputs/` |

* `pnpm test` (and `test:watch`) is the `unit` project only — the cadscripts are an
  end-to-end suite, not something you want in the loop while editing `src/`.
* `pnpm test:cadscripts` runs them; `pnpm test:all` runs both, tagged `[unit]` /
  `[cadscripts]` in the output. `test:coverage` also covers both on purpose: the
  cadscripts exercise large parts of `src/` that no unit test reaches.
* The narrower `test:*` scripts (`test:brep`, `test:runner`, `test:params`, …) are path
  filters over the `unit` project and are unaffected by the split.
* `pnpm test:parity` is the mesh ↔ brep parity table over the cadscripts
  (`tests/cadscripts/kernel.parity.test.ts` → `kernel.parity.txt`): every script runs on both
  kernels and every shape's bbox is compared by scene path. A kernel fix that changes the
  table is expected to refresh the snapshot (`vitest -u`) and ship the diff. The unit-level
  counterpart is `test:kernels` (`shape-parity`, `kernel-divergences`).

A red `cadscripts` test usually means a script in `tests/cadscripts/scripts/` needs
updating, not that the kernel regressed — so don't chase it from a kernel change without
checking that first.
