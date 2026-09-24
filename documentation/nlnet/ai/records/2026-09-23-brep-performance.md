# Kernel performance: brep scene naming, sub-shape wrapping and meshing, per-run overhead, editor double run

| | |
|---|---|
| Dates | 2026-09-23 → 2026-09-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent: analysis without code changes first (benchmarks and CPU profiles), then the fixes |
| Human | Mark van der Net: reported the regression (a brep box used to take ~40 ms, now ~120 ms), asked for an analysis without code changes first, chose which solutions to implement, reviewed the code |
| Branch | `pg` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-23 21:12 +0200  I was looking at the performance of the brep kernel. I remember it used to be 40ms to generate a simple box (lets say box(100,200,300)) - now it is 120ms. Ok there is some lazy loading, but even after it is loaded. Without changing any code can you analyse this? Then give some solutions.
2026-09-23 21:22 +0200  First can you fix cause 2? This will also improve mesh performance right?
2026-09-23 21:24 +0200  ok now do all the points of the brep kernel
2026-09-23 21:58 +0200  While you at it can you do a performance analysis of the mesh kernel? See any quick easy wins?
2026-09-23 22:27 +0200  yes implement 1 and 2
```

The work was left uncommitted at the end of that session and committed the next day
from another one, which is why the commits carry a later date than the prompts.

## Analysis (agent output, reviewed by the human before implementation)

Measured in Node with the core Runner, warm runs, `box(100,200,300)`:

| | brep | mesh |
|---|---|---|
| Whole run (editor-like request) | 60–70 ms | 3 ms |
| First run after the kernel loads | 140–185 ms | 22 ms |
| 10 moved boxes | ~600 ms | 11 ms |

`Solid.makeBox` itself takes 2.6 ms. About 38 ms per box went to naming the scene node:
`Modeler._adopt → addToScene → SceneNode.getName → Shape.subtype() → Solid.solidType()`,
which builds the faces twice and, per face, `orthogonal() → normal() → normalAt()`, a boolean
`intersects()` plus a `uvAt()` projection. Every face, wire and edge wrapper also runs
`ShapeFix_Shape.Perform` (`round()`), and every wire wrapper `checkAndFix()`, which builds a
temporary Face. In the editor, an open Metrics or Docs tool ran the whole script a second
time and the two durations were added up.

## Plan

1. Editor: request the open tools' outputs in the main run; the lean extra run stays only
   for opening a tool on an existing result, and no longer adds its duration.
2. `Shape.subtype()` caches its answer against the current OC shape; primitives set it
   when they are made.
3. `Solid.solidType()` builds its faces and edges once; `Face.orthogonal()` takes the
   normal of a planar face at the centre of its UV bounds, without `intersects()`/`uvAt()`.
4. Sub-shapes read from an existing shape (`_getEntities`) are wrapped without
   `round()`/`checkAndFix()`/`_fix()`: they belong to a valid shape already, and keeping the
   original OC sub-shape keeps it the same shape as in the parent (as `Vertex` already did).
5. Warm-up of the first brep run: not done. The editor re-runs right after a kernel switch
   and runs as soon as the worker is ready, so there is no idle moment to warm up in; loading
   brep up front would cost every mesh user the kernel download.
6. Meshing: the default deviation becomes relative to the size of each Face and Edge
   (`MESHING_RELATIVE_DEFLECTION`, BRepMesh's relative mode for faces, the same fraction of the
   edge size for edge lines) instead of 0.1 mm absolute. A caller that passes a
   `linearDeflection` keeps it absolute unless it sets `relative`.

   Analysis for the fraction (0.5 rad angular throughout; times include the GLB conversion):

   | Shape | 0.1 mm absolute (old) | 0.25% | 0.5% | 1% |
   |---|---|---|---|---|
   | sphere r50 | 119 ms, 5008 tris | 93 ms, 4002 | 36 ms, 2004 | 18 ms, 978 |
   | sphere r500 | 2827 ms, 50424 tris | 79 ms, 4002 | 39 ms, 2004 | 19 ms, 978 |
   | pipe r20 L6000 | 176 tris | 124 | 100 | 100 |
   | table r500 h30 | 888 tris | 248 | 176 | 124 |
   | box with 5 mm fillets | 788 tris | 2980 | 1764 | 964 |

   Chosen: 0.5% (about 45 segments around a sphere, whatever its size). A tighter angular
   deflection (0.3, 0.25 rad) added triangles to the pipe and table for little visible gain.

7. Mesh kernel analysis (asked for after the brep work): profiled the 16 cadscripts on mesh.
   Most time is real modelling work (booleans, cutoffBy, layflat). Two per-run overheads,
   paid by both kernels, were quick wins:
   - `MaterialManager.load()` checked the bundled material database against its TypeBox schema
     on every run (a new scope builds a new MaterialManager): ~4.5 ms per run, before the
     Runner starts its clock, and again for every component activation and pipeline. Now
     checked once per module load.
   - Every GLB was written by meshup, read back into a glTF-Transform Document by the core
     `GLTFBuilder` only to add the Archiyou state as root extras, and written again (0.6–5.8 ms
     per run, 40–55% on top of the export). Without animations or an instructable, `addData()`
     now keeps the extras pending and `toGLB()` rewrites only the GLB's JSON chunk. Verified on
     all 16 cadscripts (and 3 on brep): the GLB is identical to the old path's when both are
     read back with glTF-Transform.
   Candidates left for later: one glTF material per shape in meshup (~5%; sharing them needs a
   check that the viewer does not recolour per-object materials), and the booleans themselves.

## Results

Node, warm runs, editor outputs (`default/model/glb`, `default/tables/*/json`):

| Script | Before | After |
|---|---|---|
| `box(100,200,300)` | 60–70 ms | 14–15 ms |
| 10 moved boxes | ~600 ms | ~118 ms |
| `sphere(50)` | ~140–170 ms | ~86 ms |
| `sphere(500)` | ~2.3 s | ~65 ms |

Mesh kernel, the 16 cadscripts, warm median, `HEAD` against the working tree in the same
session: 557 ms → 443–464 ms in total; small scripts 8 ms → 2–3 ms.

Core suite (unit + cadscripts): 1647 passed, 14 skipped, before; 1649 after (two new tests for
`GLTFBuilder.addData`). The kernel parity table is unchanged. TypeScript errors: the same set
before and after.

## Review and decisions by the human
- Asked for the analysis without code changes first.
- Chose to fix the editor double run first, then "all the points of the brep kernel".
- Meshing quality: chose deviation relative to size, with a larger fraction than the proposed
  0.1%, and left the number to a quick analysis (0.5% chosen, see plan step 6).
- Asked for a performance analysis of the mesh kernel, then chose to implement the two quick
  wins (material database check, GLB round trip).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| `d98c712` | Editor: run the open tools' outputs in the main run | "First can you fix cause 2?" |
| `4302bfa` | brep: cache subtype, cheaper solidType, unwrapped sub-shapes | "ok now do all the points of the brep kernel" |
| `2a4d051` | Check the material database once, and stop round-tripping every GLB | "yes implement 1 and 2" |

The second subject is the human's line minus its trailing ", relative meshing":
`pnpm commit:ai` caps a subject at 72 characters. The dropped clause is the fourth
bullet of that commit's body.

Verified before committing, on branch `pg`: core unit 1617 passed / 1 expected fail /
14 skipped, cadscripts 31/31, server 307/307.
|---|---|---|
