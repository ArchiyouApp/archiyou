# Shared geometry in the GLB, and layouts on both kernels

| | |
|---|---|
| Dates | 2026-10-30 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode) |
| Human | Mark van der Net: asked for mesh instancing and a performance test of ur_house_detailed, asked for the fly-in from the packed layout, the `layout()` shortcut, removing the old brep layout() and layouts on brep; decided what to commit and when |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Approach (agent output, reviewed by the human)

No plan mode: each step answered a prompt and was reported before the next one.

- **Instancing.** glTF reuses a mesh or accessor across nodes in the core spec; `EXT_mesh_gpu_instancing` turns
  copies into one draw call. The viewer assumes one Object3D per scene node (picking, the navigator, view styles,
  animation pointers), so true GPU instancing would need a render proxy. What was done instead: meshup's
  GLTFBuilder writes a mesh centred on its bbox with a node translation, so translated copies have identical
  buffers. It now shares those accessors by content (hash, then an exact compare within a quantum), and the
  viewer works out the hard edges once per shared geometry. Every copy keeps its own node, mesh and material.
- **Benchmark of ur_house_detailed** (read from the tunnelled database, read-only; run in node): the GLB went from
  2,218 to 915 KB and from 715 to 404 geometries in the viewer; draw calls stay about 1,000 with shadows. A
  parameter change takes 0.7–1.3 s, almost all in the components. GPU instancing would remove about a third of
  the draw objects; not built.
- **Fly-in.** The preset starts from the packed layout; the Runner loads the 3D load planner for a script that names
  'flyin' or an output that asks for it, and a run it did not see falls back to the stacks.
- **`ShapeCollection.layout(name, options)`**: short for `new Layouter(collection).<name>(options).apply()`.
  The brep collection's old `layout('line'|'binpack')` is removed: scripts never reached it.
- **Layouts on brep**: brep OBbox gets `toOrthoQuaternion()` (meshup's conversion, made public), brep Bbox gets
  `distance()`, and `rowOrtho()` spaces by `length()`, the longest side on both kernels.

## Review and decisions by the human
- Asked whether GPU instancing could keep picking and navigation simple, then for a benchmark of ur_house_detailed before
  deciding; the GPU-instancing proxy was not built.
- Asked for the fly-in from the packed layout, then for `layout()` as a shortcut, then to remove the old brep
  `layout()`, then for brep support.
- At commit time another session had changed the same layout files (layouts.ts, Layouter.ts, the animator tests)
  on top of this work. Decided to commit only the parts that stand alone now (shared geometry, the brep box
  methods, removing the old brep layout()); the fly-in, `layout()` and the Layouter changes are committed with
  that layout work later.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
