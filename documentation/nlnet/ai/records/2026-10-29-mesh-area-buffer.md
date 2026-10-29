# Mesh.area() from the triangle buffer

| | |
|---|---|
| Dates | 2026-10-29 → 2026-10-29 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (the plan was worked out in conversation, no separate plan mode) |
| Human | Mark van der Net: asked why area() is slow, chose the fix, reviews the code |
| Branch | `develop` (main repo and meshup submodule) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-29 12:15 +0100  how about performance mapping these products based on their shape? Can we speed it up?
2026-10-29 12:22 +0100  that area() takes so long is a bit weird? Are we using a shortcut for cuboids, or the raw area() in meshup?
2026-10-29 12:28 +0100  ja, doe punt 1 met de test
2026-10-29 12:33 +0100  [Request interrupted by user for tool use]
2026-10-29 12:33 +0100  Cant you just add these functions to the rust layer? I feel that this is too much geometry for the TS glue layer
2026-10-29 13:58 +0100  plan: go ahead 0-2 indeed. fill in productgroep. Can you make than one productgroups? I think that could be handy later. Yes commit message is OK
```

## Plan (agent output, reviewed by the human before implementation)

### Why

While measuring how fast a product list can be made from a model (a two to eight storey house of
`make.wall()` walls, 448 to 1792 solids), `area()` was the most expensive call per solid: +0.92 s for
1792 boxes, where `obbox()` cost +0.24 s and `volume()` nothing measurable. `Mesh.area()` takes the
raw route: `polygons()` wraps every face in a Polygon shape (uuid, Style), `Polygon.area()` then wraps
every corner in a VertexJs and a Vertex shape (uuid, Style), only to add up the face areas. Summing the
triangles of the flat position buffer (`inner().positions()`, 9 numbers per triangle, which `obbox()`
and `isCuboid()` already read) gave the identical total (2,194,828,544 mm²) for +0.40 s, most of which
is fetching the buffer from WASM.

### Change

The first version summed the triangles of the position buffer in TypeScript. The human asked to move
it into the Rust layer instead ("too much geometry for the TS glue layer"), which is what shipped:

- Rust, `Mesh::surface_area()` and `Mesh::area_centroid()` (`rust/src/mesh/mod.rs`, marked +MESHUP):
  one pass over the triangulation of every polygon (`Polygon::triangulate`, which knows holes),
  summing area and first moment of area.
- WASM bindings `MeshJs.area()` and `MeshJs.areaCentroid()` (`rust/src/wasm/mesh_js.rs`).
- TypeScript: `Mesh.area()` and `Mesh._areaCentroid()` (the centre of a flat mesh) only call them.
  The fan over each polygon `_areaCentroid()` used counted the triangles of a concave face unsigned,
  so a face that is not star-shaped from its first corner came out wrong (an L-shape: 9.58 instead
  of 8.33); the triangulation does not have that.
- Tests: known areas of a cuboid and of a cube with a square hole through it, a sphere against the
  per-polygon sum, an empty mesh, and the centroid of a concave flat mesh (failed before, passes now).

Measured on 1792 boxes in Node: 25-29 ms for the kernel `area()` against 264-602 ms for the old
route, with the same total. `obbox()` (95-420 ms) is now the costliest measurement.

Not in this change: keeping the buffer per mesh until it changes (each `positions()` triangulates again
in WASM, and `obbox()` plus `area()` triangulate twice). That needs invalidation on every mutating
operation and is its own piece of work.

## Review and decisions by the human

- Chose point 1 of two (the buffer for area, not the per-mesh cache).
- Stopped the TypeScript version and asked for the computation in the Rust layer.
- Approved the commit summary.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| 53c3642 (meshup) | Mesh area and flat-mesh centre computed in Rust | 2026-10-29 12:33 |
| (this commit) | see the commit | 2026-10-29 13:58 |
