# Dimension lines offset in the plane of what they measure

| | |
|---|---|
| Dates | 2026-09-27 → 2026-09-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: one bug fix asked for in the session) |
| Human | Mark van der Net: wrote the prompts, found the problem in a picture-frame script, chose how to commit |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-27 20:49 +0200  In this script: "
                        
                        <pasted_content id="c223">
                        
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
                        
                          
                        
                        </pasted_content id="c223">
                        
                        " I have some dimension lines that offset along the z-axis. Can you fix, so they always offset along the normal of the Shape(or shape parent) - the dimension line is called on a edge as a face. Or if there is no normal (1D element) by default the offset should be along the XY plane, not in the Z direction
2026-09-27 21:16 +0200  yes commit it
2026-09-28 10:22 +0200  please check what is still open now
2026-09-28 11:05 +0200  yes commit the dimension fix. then close records
```

## What was done (agent output, reviewed by the human)

Cause: `DimensionLine._planeNormal()` took the plane from `detectExportFrame()` over the whole
model, which picks the plane MOST flat shapes share. In a 3D model a few vertical reference
lines made that XZ, so every dimension, even on a horizontal face, stepped off along Z.

- `_planeNormal()` now answers, in order: the exporter's drawing plane; the plane of the
  measured Shape or its first flat parent (so edges of a face offset inside that face); the
  model's plane only when ALL of it lies in one (2D elevations keep working); else XY.
- New `commonPlaneNormal()` in `modeler/utils.ts`: the plane all given shapes share, or null
  for solids, collinear points and 3D models. `samplePoints()` falls back to vertices for
  faces and polygons, which do not tessellate to points.
- `link()` resets the cached plane and linked centre; a projection's XY plane is held in a
  separate `_planeNormalFixed` so `link()` does not re-fit the projection per dimension.
- Ortho dimensions (autoDim) took "the first axis that is not the measured one" as offset
  axis, which on an upright face points out of it; they now take the in-plane axis.
- Tests: a loose line in a 3D model offsets in XY; an upright face's autoDim stays in the face.
- The house fixture (`housetest.features.json`, `housetest.ifc-classes.txt`) was refreshed:
  the timberwall's loose dimension line now offsets in XY instead of the wall plane, which
  changes the iso's edge joins and the order (not the geometry) of the insulation parts.

## Review and decisions by the human

- Stated the rule: offset along the plane of the Shape (or its parent); XY for 1D elements.
- Chose to commit this fix on its own, leaving the staged dimension-sizes unit
  (2026-09-26-doc-dimension-sizes-param-input) staged and uncommitted.
- Wrote the commit summary.
- The agent's first attempt to commit reset the shared index while other sessions were
  staging and committing, which briefly unstaged another unit's record-close; the agent
  restored it and stopped. The human had the open work checked the next morning and asked for
  the commit once the index was clear.
- The agent ran the unit tests (all green apart from a brep Shelling timeout under load) and the
  author's picture-frame script, whose dimensions no longer offset along Z.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| d20be8b | Dimensions offset in the plane of what they measure | I have some dimension lines that offset along the z-axis. Can you fix ... |
| (this commit) | record closed | yes commit the dimension fix. then close records |
