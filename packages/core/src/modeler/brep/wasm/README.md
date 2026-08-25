# archiyou-opencascade

Builds of custom opencascade.js WASM libraries

## Build

Use python script in /build-scripts/run_build

IMPORTANT: Add 
```
// @ts-nocheck
```
To archiyou_opencascade.d.ts

## License — read before redistributing

This is **Open CASCADE Technology 7.6** under **LGPL-2.1 with the Open CASCADE
exception** (`LICENSE_LGPL_21.txt` and `OCCT_LGPL_EXCEPTION.txt`, both taken from the
source revision below). Archiyou's own code is Apache-2.0; that does not change what
this binary is, and the obligations travel with every copy — including the
`@archiyou/core` npm tarball, where these two texts ship alongside it.

| | |
| --- | --- |
| OCCT source revision | `bb368e271e24f63078129283148ce83db6b9670a` |
| opencascade.js | `2.0.0-beta.b5ff984` (the docker tag in `build-scripts/run_build.py`) |

Anyone may rebuild against a modified OpenCascade and drop the result in here —
`OcLoader` fetches the `.wasm` as an ordinary asset, so nothing else recompiles. Keep
`build-scripts/` and the two licence texts next to the binary; `check:pack` fails the
release if they stop shipping. The full record, including the written offer for the
corresponding source, is in the repository's `ATTRIBUTION.md`.
