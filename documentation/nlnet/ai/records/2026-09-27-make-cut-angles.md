# Miter saw angles from a beam edge, and parent tracking in meshup select()

| | |
|---|---|
| Dates | 2026-09-27 → 2026-09-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a feature asked for in the session, then one follow-up) |
| Human | Mark van der Net: wrote the prompts and the hand-made angle calculation the feature generalises, asked for parent tracking in meshup select() |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-27 21:32 +0200  In my script: 
                        
                        <pasted_content id="1dfb">
                        
                        CONTENT_WIDTH = $CONTENT_WIDTH;
                        CONTENT_HEIGHT = $CONTENT_HEIGHT;
                        FRAME_WIDTH = $FRAME_WIDTH;
                        FRAME_THICKNESS = $FRAME_THICKNESS;
                        FRAME_DEPTH = $FRAME_DEPTH; // from content to outside
                        
                        layer('frame')
                        
                        content = rect(CONTENT_WIDTH,CONTENT_HEIGHT);
                        content.autoDim({ offset: 10});
                        contentSolid = content.copy().extrude(2).color('gray');
                        
                        frameThicknessSloped = Math.sqrt(FRAME_WIDTH*FRAME_WIDTH - FRAME_DEPTH*FRAME_DEPTH);
                        
                        border = content.copy().offset(frameThicknessSloped)
                                  .moveZ(FRAME_DEPTH);
                        
                        frame = content.copy().loft(border, false);
                        
                        frameHorOrig = frame.polygons().first().copy();
                        frameHor = frameHorOrig.copy().move(frameHorOrig.normal().scale(FRAME_THICKNESS));
                        
                        frameVerOrig = frame.polygons().at(1).copy();
                        frameVer = frameVerOrig.copy().move(frameVerOrig.normal().scale(FRAME_THICKNESS));
                        
                        // just find the new create by extending edges and getting intersection
                        frameVecEdge = frameVer.edges().sort((a,b) => b.length() - a.length()).first();
                        frameVecEdgeExt = frameVecEdge.copy().extend(100).color('blue').hide();
                        frameHorEdge = frameHor.edges().sort((a,b) => b.length() - a.length()).first();
                        frameHorEdgeExt = frameHorEdge.copy().extend(100, 'start').color('blue').hide();
                        
                        creaseExtPoint = frameVecEdgeExt.intersection(frameHorEdgeExt);
                        creaseOrig = frameHor.edges().sort((a,b) => b.center().x - a.center().x)
                                      .first().copy();
                        
                        creaseNew = creaseOrig.align(creaseExtPoint, 'end', 'center');
                        
                        frameHorSolidBottom = creaseNew.copy().mirrorX(0)
                                          .loft(creaseNew) // polygon
                                          .loft(frameHorOrig);
                        frameHorSolidTop = frameHorSolidBottom.copy().mirrorY(0);
                        
                        frameVerSolidRight = creaseNew.copy().mirrorY(0)
                                          .loft(creaseNew) // polygon
                                          .loft(frameVerOrig);  
                        frameVerSolidLeft = frameVerSolidRight.copy().mirrorX(0);
                        
                        //// CONTEXT ////
                        
                        /*
                        line(
                          frameHorSolidBottom.select('F||front').select('V||bottomright').copy(),
                          frameHorSolidBottom.select('F||front').select('V||bottomright')
                            .copy().moveToZ(frameHorSolidBottom.bbox().minZ())
                        ).dim();
                        */
                        
                        
                        
                        //// DOCS ////
                        
                        layer('docs').color('blue')
                        
                        frameHorFlat = frameHorSolidBottom.copy()
                            .rotateToAxesOBbox().moveY(-500)
                        // Visualize cutangle
                        cutLine = frameHorFlat.select('F||front').select('E||left').copy().extend(200, 'start');
                        cutLineRefV = line(
                            frameHorFlat.select('V||fronttopleft'),
                            frameHorFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveZ(200)
                        ).dashed();
                        
                        cutLineRefVT = line(
                            frameHorFlat.select('V||fronttopleft'),
                            frameHorFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveToZ(frameHorFlat.bbox().minZ())
                        );
                        
                        line(cutLineRefVT.end(), frameHorFlat.select('V||frontbottomleft')).dim({ offset: -10 });
                        frameHorFlat.select('E||frontbottom').dim({ offset: 40 }) // not on XY plane
                        
                        
                        frameHorFlat.select('F||top').autoDim();
                        frameHorFlatIsoCol = collection(frameHorFlat, cutLine, cutLineRefV);
                        
                        frameVerFlat = frameVerSolidLeft.copy()
                            .rotateToAxesOBbox().moveY(-1100).rotateZ(180);
                        // Visualize cutangle
                        cutLineVer = frameVerFlat.select('E||frontleft').copy().extend(200, 'start');
                        cutLineVerRefV = line(
                            frameVerFlat.select('V||fronttopleft'),
                            frameVerFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveZ(200)
                        ).dashed();
                        
                        
                        cutLineVerRefVT = line(
                            frameVerFlat.select('V||fronttopleft'),
                            frameVerFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveToZ(frameVerFlat.bbox().minZ())
                        );
                        
                        line(cutLineVerRefVT.end(), frameVerFlat.select('V||frontbottomleft')).dim({ offset: -10 });
                        frameVerFlat.select('E||frontbottom').dim({ offset: 50 }) // not on XY plane
                        
                        frameVerFlat.select('F||top').autoDim();
                        frameVerFlatIsoCol = collection(frameVerFlat, cutLineVer, cutLineVerRefV);
                        
                        cutAnglePrimary =  (frameHorFlat.select('F||top')
                                                .select('E||left').copy().moveZ(10).direction().angle([1,0,0])
                                                % 90);
                        
                        // Cut line on the table (top face), horizontal
                        cutDirTop = frameHorFlat.select('F||top').select('E||left')
                                      .direction().normalized();
                        
                        // Sloped end edge on the front face
                        cutDirFront = frameHorFlat.select('F||front').select('E||left')
                                      .direction();
                        
                        // Project onto the plane perpendicular to the cut line: d' = d - (d·c) c
                        cutDirFrontProj = cutDirFront.copy()
                                      .subtract(cutDirTop.copy().scale(cutDirFront.dot(cutDirTop)));
                        
                        // another method
                        n = frameHorFlat.select('F||left').normal().normalized(); // adjust the selector if the end face is named differently
                        print(Math.asin(Math.abs(n.z)) * 180 / Math.PI);
                        
                        // Blade tilt from vertical (direction-sign independent)
                        cutAngleSecondary = cutDirFrontProj.angle([0,0,-1]);
                        cutAngleSecondary = Math.min(cutAngleSecondary, 180 - cutAngleSecondary);
                        
                        print(cutAnglePrimary);
                        print(cutAngleSecondary);
                        
                        
                        
                        
                        
                        function docPipeline()
                        {
                          isoFrame = layer('frame').shapes().iso([0,1,10]);
                          
                          isoHor = frameHorFlatIsoCol
                              .iso([-0.5,-1,1])
                              .move(1000);
                        
                          isoVer = frameVerFlatIsoCol
                              .iso([-0.5,-1,1])
                              .move(1000,-500);
                        
                          return { isoFrame, isoHor, isoVer };
                        }
                        
                        // docPipeline();
                        
                        
                        docs.create('plan')
                          .pipeline(docPipeline)  
                          .page('plan')
                          .titleblock({ title: 'DeepFrame', designer: 'Archiyou'})
                          .view('frame')
                          .shapes('isoFrame')
                            .width(0.25)
                            .pivot(1,0)
                            .position(1,0.2)
                          .view('isoHor')
                            .shapes('isoHor')
                            .height(0.5) // TODO: scale
                            .pivot(1,1).position(0.8,1)
                          .text(`primaryAngle: ${roundTo(cutAnglePrimary,1)} - secAngle: ${roundTo(cutAngleSecondary,2)}`, 
                                { size: '5mm' })
                            
                          .view('isoVer')
                            .shapes('isoVer')
                            .height(0.5)
                            .pivot(1,1).position(0.8,0.5)
                        
                          
                        
                        </pasted_content id="1dfb">
                        
                         I determine the primary cut angle (miter) and secondary (bevel). Can you make this into a generic solution in make module. It should take a edge from a beam-like shape like this: make.cutAngles(beam.select('E||topleft') => { miter: x, bevel: y } - these angle should be like you would set on a miter saw.
2026-09-27 22:02 +0200  For mesh it is really show. Please implement the same parent shape tracking (in .select())  as in brep. More consistent and probably way faster.
2026-09-27 23:04 +0200  commit the work please
```

## Approach (agent output, no separate plan)

1. `make.cutAngles(edge, beam?)` in `packages/core/src/modeler/Make.ts` returns
   `{ miter, bevel }` as set on a miter saw, in degrees from a square cut.
   - The edge lies on the end cut; the other face it bounds is the face on the saw table.
   - The beam's length axis is the edge direction with the most total length (not the
     OBB, whose PCA axis leans when only one end is cut); it runs along the fence.
   - With up = normal of the table face and across = up × axis, the blade normal of a saw
     set to miter m and bevel b is `cos b cos m · axis + cos b sin m · across + sin b · up`,
     so `bevel = asin|n·up|` and `miter = atan2(|n·across|, |n·axis|)`.
   - Plain `[x, y, z]` math on the API both kernels share (faces, edges, start/end,
     normal, bbox), so it runs on mesh and brep.
   - The beam comes from the edge's `_parent` chain (edge → face → solid); an edge that
     was not selected is looked up among the closed solids in the scene.
2. Checked against the author's DeepFrame script: 40.893° / 20.705°, the values of the
   hand calculation, when the edge is selected face-first
   (`select('F||top').select('E||left')`). `select('E||topleft')` picks the slanted
   front-left edge on that mitered part; documented in the method.
3. Follow-up: meshup `select()` sets `_parent` like brep. The Selector tags the faces,
   edges and vertices it extracts with their owner (per member of a collection);
   `Polygon.select()` points results from its temporary mesh back to the polygon.
   `copy()` does not carry it. Mesh-mode dimensions on selected sub-shapes now link to
   the root shape, as on brep.

## Review and decisions by the human

- Asked for the generic function in the make module, with the edge as input and the
  angles as a miter saw shows them.
- Found the scene lookup too slow on mesh and chose parent tracking in meshup
  `select()`, the same as brep, over the lookup.
- Asked for the work to be committed; picked the commit summaries and approved the
  messages. Only the `cutAngles` entry of the regenerated `api.generated.json` went in:
  the rest of that file's changes belong to other work in the same working tree.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| meshup 69e5634 | select() remembers the shape it selected from, like brep | "For mesh it is really show. Please implement the same parent shape tracking (in .select()) as in brep. …" |
| 0e30f91 | make.cutAngles(): miter and bevel of a beam's end cut | "I determine the primary cut angle (miter) and secondary (bevel). Can you make this into a generic solution in make module. …" / "commit the work please" |
| (this commit) | Close the disclosure record for make.cutAngles() | "commit the work please" |
