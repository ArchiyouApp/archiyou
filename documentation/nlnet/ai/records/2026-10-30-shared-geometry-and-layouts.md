# Shared geometry in the GLB, and layouts on both kernels

| | |
|---|---|
| Dates | 2026-10-30 → 2026-11-03 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode) |
| Human | Mark van der Net: asked for mesh instancing and a performance test of ur_house_detailed, asked for the fly-in from the packed layout, the `layout()` shortcut, removing the old brep layout() and layouts on brep; decided what to commit and when |
| Branch | `develop` |
| Session transcript | kept locally (two sessions, see the prompts); the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-30 15:10 +0100  Archiyou, especially in context of buildings generates a lot of the same shapes (like with array,row,grid etc): Does GLTF has a way to do mesh instancing? Please see what we already register of shapes that are clones from others and see if we can quickly improve rendering speed by adding in mesh instancing /effort xhigh
2026-10-30 19:42 +0100  So its not easy to have gpu instancing for framerate improvement and keep picking, navigation etc simple?
2026-10-30 20:05 +0100  can you test the urhouse_detaild script for performance?
2026-10-30 20:19 +0100  check tunnelled db, the script is called ur_house_detailed under archiyou user
2026-10-30 20:54 +0100  yes, continue the urhouse benchmark
2026-11-02 19:33 +0100  Archiyou makes serial ids for shapes right?
2026-11-02 19:39 +0100  Can you have the flyin animation use the packed layout to start?
2026-11-02 19:45 +0100  I still see the previous layout. I want test the layouter. But modeler.layour('packed') does not work. How does the API work?
2026-11-02 19:48 +0100  Can you make a shortcut: ShapeCollection.layout(<<name>>) ? It should do modeler.layouter().....apply()....
2026-11-02 19:52 +0100  remove the old layout method for brep side.
2026-11-02 20:56 +0100  Can you make layout work for the brep kernel?
2026-11-03 10:15 +0100  Commit this work under AI policy
2026-11-03 11:19 +0100  yes commit the last layout things
```
The prompt of 2026-10-30 20:50 (text sizes on the project pages) was sent to this session by mistake and belongs to
2026-10-30-projects-workspace-flow.md; nothing of it was done here.

A second session (same model) followed up on the layouts on the same files, and its result is part of commit
"Layouts: collection.layout(), fly-in from the packed bin":
```
2026-11-02 19:55 +0100  the 3D packer outputs what seems truck container bins. Thats nice. But can you place them spaced apart in the y-direction, not along the x-axis
2026-11-02 19:57 +0100  i want the along the y axis in Layouter.packed() and collection.layout() please
2026-11-02 20:00 +0100  I run the flyin animation again, not the packed layout works, but the stacks are not the same as i saw when i do all().layout('packed') - less dense and spaced way apart
2026-11-02 20:03 +0100  Can you place the stack always at the origin?
2026-11-02 20:06 +0100  I do besides it would be nice its center is horizontally aligned with the center of the model. So exactly in front
```

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
  on top of this work. Decided to commit the parts that stood alone first (shared geometry, the brep box
  methods, removing the old brep layout()), then the layout work of both sessions as one commit.
- Tried the fly-in and `all().layout('packed')` in the editor; that led to the second session's changes (bins along y,
  stacks at the origin, centred in front of the model).
- Chose every commit's summary line.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| meshup 50a5d7d | GLTFBuilder: copies of a shape share their geometry | 2026-10-30 15:10 |
| 05d4f68 | Smaller GLBs: copies share geometry, viewer shares edges | 2026-10-30 15:10, 20:05 |
| meshup d4648fc | OBbox: rotation-matrix quaternion for the brep kernel | 2026-11-02 20:56 |
| 091e0ad | Brep: box methods the Layouter needs, old layout() removed | 2026-11-02 19:52, 20:56 |
| 1cfd8e0 | Layouts: collection.layout(), fly-in from the packed bin | 2026-11-02 19:39, 19:48, 20:56 and the second session |
| (this commit) | Close the disclosure record | 2026-11-03 10:15 |
