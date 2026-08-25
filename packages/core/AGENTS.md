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