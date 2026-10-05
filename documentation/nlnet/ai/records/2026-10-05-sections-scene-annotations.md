# Dimension lines follow their shapes out of the scene; section() in the scene and on brep

| | |
|---|---|
| Dates | 2026-10-05 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: direct questions about a tutorial script, each answered with its cause, then fixed) |
| Human | Mark van der Net: wrote the prompts and the tutorial scripts that showed the problems, asked for the fixes and for section() on brep, reviewed the work, approved the commit messages |
| Branch | `develop` (+ meshup `main`, submodule `packages/meshup`) |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-05 13:14 +0200  Can you check why this MD does not show steps in the help section of the editor? http://localhost:5173/editor?tutorial=simple-table-more
2026-10-05 13:17 +0200  Yes fix it for me
2026-10-05 13:50 +0200  In this example script i use tmp() for the iso: "
                        
                        $PARAMS.define('LENGTH', 'number', 
                                        { label: 'Length', units: 'mm', 
                                        default: 1000, minimum: 500, 
                                        maximum: 2400, multipleOf: 10 
                        })
                        
                        top = box($LENGTH, 500, 50)
                                    .moveZ(700)
                                    .color('blue')
                                    .name('top');
                        
                        leg = box(60, 60, 720)
                                    .align(top, 'leftfronttop', 'leftfrontbottom')
                                    .color('green')
                                    .name('leg');
                        
                        leg.copy().align(top, 'rightfronttop', 'rightfrontbottom');
                        leg.copy().align(top, 'leftbacktop', 'leftbackbottom');
                        leg.copy().align(top, 'rightbacktop', 'rightbackbottom');
                        // A label
                        top.label('fancy table top', { offset: 100 })
                        // A dimension line
                        top.select('E||topfront')
                                .dim({ offset: 200 })
                                .param('LENGTH'); // bind it to the LENGTH param
                        
                        // isometric drawing of the table
                        iso = all().iso().move($LENGTH*2).tmp();
                        
                        docs.page('plan')
                            .text('My simple table')
                            .view('iso')
                            .shapes(iso)
                            .width(0.5)
                        
                        " Still the dimension lines from the model to the iso are shown. Can you make it so that a dimension line is only shown if its tied to a visible/in scene shape?
2026-10-05 14:08 +0200  In this example: "
                        
                        $PARAMS.define('LENGTH', 'number', 
                                        { label: 'Length', units: 'mm', 
                                        default: 1000, minimum: 500, 
                                        maximum: 2400, multipleOf: 10 
                        })
                        
                        top = box($LENGTH, 500, 50)
                                    .moveZ(700)
                                    .color('blue')
                                    .name('top');
                        
                        leg = box(60, 60, 720)
                                    .align(top, 'leftfronttop', 'leftfrontbottom')
                                    .color('green')
                                    .name('leg');
                        
                        leg.copy().align(top, 'rightfronttop', 'rightfrontbottom');
                        leg.copy().align(top, 'leftbacktop', 'leftbackbottom');
                        leg.copy().align(top, 'rightbacktop', 'rightbackbottom');
                        
                        all().elevation('front');
                        all().section([0,0,50],[0,0,1]);
                        
                        " - can you check why section is not working?
2026-10-05 14:21 +0200  Can you add section to the brep too? OCE has it.
2026-10-05 21:10 +0200  ok commit that work
```

## Work (agent output; no separate plan, each request was diagnosed first)

### 1. A tutorial that showed one step (13:14, 13:17)

`help/tutorials/en/simple-table-more.md` put its starting code before the first `## `
heading, so the help parser took it as the intro: one step, and the step's `js append` ran
on an empty script. The agent added a `## Where we left off` heading. That line is part of
the human's own tutorial work, staged and committed by the human, not in these commits.

### 2. Dimension lines of a tmp() projection (13:50)

`iso()` carries the model's dimension lines into the projection, linked to it; `tmp()` took
the projection out of the scene but not its dimension lines, so the viewer still drew them.
`Annotator.getAnnotationsData()`, which only the scene output reads (runner state, GLB), now
keeps an annotation linked to a Shape only while that Shape is in the scene and not hidden
(itself or by its layer). Drawings are unchanged: they take the annotations linked to what
they draw (the docs SVG of the tutorial script came out byte-identical).

### 3. section() of a collection never reached the scene (14:08)

meshup `ShapeCollection.section()` was the only collection projection without a scene
decorator, so `all().section(...)` computed the section and dropped it. It now goes into a
'section' layer, as `iso()` and `elevation()` do.

### 4. section() on the brep kernel (14:21)

brep `Shape.section(pivot, normal, options)` and `ShapeCollection.section()`, with meshup's
API and groups ('cut', 'visible', 'hidden'). The shape is moved into the drawing's frame
(cut plane z = 0, seen from +z, world up as screen up); `BRepAlgoAPI_Section` gives the cut,
`BRepAlgoAPI_Common` with a box the part beyond it, and the existing HLR projection draws
that. meshup's collection hands brep shapes to it, as for `elevation()` and `iso()`.

Finding while doing it: meshup's elevations and sections are mirrored for every view but
'front' (the drawing is the view from behind its plane: a floor plan seen from below). brep
draws what the viewer sees, consistent with its own elevations. Pinned as open divergence
38 in `kernel-divergences.test.ts`; fixing meshup changes existing drawings, so it is left
for the human to decide.

## Review and decisions by the human

- Found all three problems in a tutorial being written, and supplied the scripts.
- Asked for the scene rule in their own words: a dimension line is shown only if it is tied
  to a visible, in-scene shape.
- Asked for brep section() after the meshup fix ("OCE has it").
- Asked for the work to be committed; the tutorial file stays the human's own commit.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
