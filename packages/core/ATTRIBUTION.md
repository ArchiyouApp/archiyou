# Third-party software

Archiyou itself is Apache-2.0 (see `LICENSE`). This file records the third-party
components that ship *inside* the repository or the built bundle, because those
carry their own terms. Ordinary npm dependencies are not listed here — their
licenses live in their own packages and are resolved by `pnpm install`.

## Bundled WebAssembly binaries

These are committed binaries (or base64 strings), so they are redistributed by
this repository and by anything built from it.

### OpenCascade — `packages/core/src/modeler/brep/wasm/`

`archiyou-opencascade.wasm` (~11 MB) is **Open CASCADE Technology 7.6**, compiled to
WebAssembly through [opencascade.js](https://github.com/donalffons/opencascade.js).
OCCT is distributed under the **LGPL-2.1 with the Open CASCADE exception**;
opencascade.js is itself **LGPL-2.1**.

Both license texts sit beside the binary — `LICENSE_LGPL_21.txt` and
`OCCT_LGPL_EXCEPTION.txt` in `packages/core/src/modeler/brep/wasm/`, taken from the OCCT
source revision this binary was built from. They ship in the `@archiyou/core` package too,
at `src/modeler/brep/wasm/`.

**What this binary was built from**

| | |
| --- | --- |
| OCCT source revision | `bb368e271e24f63078129283148ce83db6b9670a` ([mirror](https://github.com/Open-Cascade-SAS/OCCT/commit/bb368e271e24f63078129283148ce83db6b9670a), or `git.dev.opencascade.org/gitweb/?p=occt.git`) |
| opencascade.js | commit `b5ff984`, docker image `donalffons/opencascade.js:2.0.0-beta.b5ff984` |
| Build configuration | `build-scripts/archiyou-opencascade.yml` — the exported symbol list and emcc flags |
| Build command | `build-scripts/run_build.py` |

FreeType is *not* linked into this build, despite the `-sUSE_FREETYPE=1` flag in the
configuration — the binary contains no FreeType symbols.

**Rebuilding and relinking.** The four rows above are everything needed to reproduce the
binary: install docker, run `run_build.py`, and it fetches that exact OCCT revision and
recompiles. To use a modified OCCT instead, change `OCCT_COMMIT_HASH_FULL` in the
opencascade.js image (or build the image yourself), rebuild, and replace
`archiyou-opencascade.wasm` — Archiyou loads it as an ordinary asset at runtime through
`OcLoader`, so nothing else has to be recompiled. That is the LGPL relink right, in the
form WebAssembly allows.

**Written offer.** For three years from the date you received this software, Archiyou will
provide the complete corresponding source of the OCCT build, on a physical medium or by
download, for no more than the cost of distribution. Write to **info@archiyou.com**.

Note that the brep kernel is optional: it is reached only through `getOc()`, and the
default kernel is meshup.

### meshup — `packages/meshup/` (git submodule)

Apache-2.0. Its own `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.txt` apply and
are authoritative. Summarised: the Rust geometry kernel is a fork of
[csgrs](https://github.com/timschmidt/csgrs) by Timothy Schmidt, itself derived
from [csg.js](https://github.com/evanw/csg.js) by Evan Wallace, under the **MIT
License**. The compiled WASM is embedded as base64 in
`src/meshup-js-binary.ts`, so the MIT-licensed work is present in any bundle
that includes meshup.

The submodule also vendors several Rust crates under `rust/` (geo-buf,
hershey-fonts, hypercurve, hyperlattice, hyperlimit, hyperreal, hypersolve),
each with its own LICENSE file in-tree. Consult the submodule for those terms.

### gdrr2bp — `packages/gdrr2bp-wasm/`, published as `@archiyou/gdrr2bp-wasm`

A WebAssembly build of [JeroenGar/gdrr-2bp](https://github.com/JeroenGar/gdrr-2bp), a
goal-driven ruin & recreate heuristic for 2D guillotine bin packing, vendored under `src/`
with an Archiyou wasm entry point and TypeScript wrapper. **MIT**, and `@archiyou/core`
depends on the published package, so the notice travels with it:

> MIT License
>
> Copyright (c) 2026 Jeroen Gardeyn
> Copyright (c) 2026 Mark van der Net / Archiyou
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
> to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

The same text is in `packages/gdrr2bp-wasm/LICENSE`.

### COLLADA writer — `packages/collada-wasm/`, published as `@archiyou/collada-wasm`

The Rust writer builds on a **vendored copy of
[5mattmatt1/collada_io](https://github.com/5mattmatt1/collada_io)** under `src/collada_io/`.
That project ships no LICENSE file, but its `Cargo.toml` declares `MIT OR Apache-2.0`; the MIT
option is taken. Archiyou's own code in this package — the writer, the wasm entry point and the
TypeScript wrapper — is MIT as well, so the package is MIT throughout. Both copyrights are in
`packages/collada-wasm/LICENSE`.

> ⚠️ Confirm before relying on this. The declared licence lives only in the upstream
> `Cargo.toml`, which is how crates.io records a grant, but there is no licence text in that
> repository to point at. This package's `package.json` claimed Apache-2.0 until 2026-08-19,
> which contradicted its own `Cargo.toml`.

The JavaScript glue in `ts/wasm/` is generated by
[wasm-bindgen](https://github.com/rustwasm/wasm-bindgen), dual-licensed **MIT or Apache-2.0**;
the same applies to the glue in `packages/gdrr2bp-wasm/pkg/`.

## Fonts

Hershey vector fonts (via meshup's `hershey-fonts`) are in the public domain.
The webfonts used by the editor UI (Plus Jakarta Sans, Outfit, JetBrains Mono)
are loaded from Google Fonts at runtime and are **not** redistributed here; all
three are SIL Open Font License 1.1.

## Runtime CDN dependencies

The editor fetches these at runtime rather than bundling them. They are not
redistributed by this repository, but they are third-party code executing in the
page, and the Content-Security-Policy in the repo-root `Caddyfile` has to allow
them:

| Source | Used for | License |
| --- | --- | --- |
| `cdn.jsdelivr.net/npm/lucide-static` | UI icons (`apps/editor/src/icons.ts`) | ISC |
| `www.gstatic.com/draco/...` | Draco mesh decoder (`packages/ui/src/viewer/model-viewer.ts`) | Apache-2.0 |
| `fonts.googleapis.com` / `fonts.gstatic.com` | webfonts (`apps/editor/index.html`) | OFL-1.1 |

Vendoring these would make the app self-contained and let the CSP tighten to
`'self'`.

## Material carbon data

`packages/core/src/materials/materials.json` includes environmental-impact
figures derived from [ÖKOBAUDAT](https://www.oekobaudat.de/), published by the
German BBSR. Check ÖKOBAUDAT's own terms before relying on or redistributing
these values commercially.

## Script modules

Script modules are built and distributed from their own repositories and are not
part of `@archiyou/core`. A module that redistributes third-party data or code
carries its own attribution file alongside its bundle; this list covers only what
ships *inside* this package.
