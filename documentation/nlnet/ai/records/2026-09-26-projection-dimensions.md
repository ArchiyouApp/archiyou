# Dimension lines carried into isometries and elevations

| | |
|---|---|
| Dates | 2026-09-26 → 2026-09-26 |
| Model | Claude Opus 5.5 (claude-opus-5-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: research in the session, plan approved before implementation) |
| Human | Mark van der Net: wrote the prompts, asked for the change, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-26 21:05 +0200  I have this script "
                        
                        <pasted_content id="d951">
                        
                        CONTENT_WIDTH = $CONTENT_WIDTH;
                        CONTENT_HEIGHT = $CONTENT_HEIGHT;
                        FRAME_WIDTH = $FRAME_WIDTH;
                        FRAME_THICKNESS = $FRAME_THICKNESS;
                        FRAME_DEPTH = $FRAME_DEPTH; // from content to outside
                        
                        content = rect(CONTENT_WIDTH,CONTENT_HEIGHT);
                        contentSolid = content.copy().extrude(5).color('brown');
                        
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
                        frameVecEdgeExt = frameVecEdge.copy().extend(100).color('blue');
                        frameHorEdge = frameHor.edges().sort((a,b) => b.length() - a.length()).first();
                        frameHorEdgeExt = frameHorEdge.copy().extend(100, 'start').color('blue');
                        
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
                        
                        
                        //// DOCS ////
                        
                        layer('docs').color('blue')
                        
                        frameHorFlat = frameHorSolidBottom.copy()
                            .rotateToAxesOBbox().moveY(-500)
                        // Visualize cutangle
                        cutLine = frameHorFlat.select('F||front').select('E||left').copy().extend(100, 'start');
                        cutLineRefV = line(
                            frameHorFlat.select('V||fronttopleft'),
                            frameHorFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveZ(100)
                        ).dashed([1,1]);
                        
                        frameHorFlat.select('F||top').autoDim();
                        
                        cutAngle = (frameHorFlat.select('F||front').select('E||left').direction().angle([0,0,-1]));
                        
                        layer('docs')
                            .shapes()
                            .iso([-0.5,-1,1])
                            .move(1000)
                        
                        
                        </pasted_content id="d951">
                        
                        " and im doing a isometry. I know isometry drop the dimensions. But can you see if its doable to add dimension lines to them. Of course you need to freeze the values.
2026-09-26 21:13 +0200  yes
```

## Plan (agent output, reviewed by the human before implementation)

A projection in meshup is one fixed transform: project onto the plane, rotate that plane onto XY,
twist "up" to screen-up (`Mesh._flattenProjectionToScreen`) and center with `moveTo(0,0,0)`. Every
3D point therefore has one exact place in the drawing, so a dimension line only needs its drawn
start, end and offset mapped through that transform, becoming a new flat dimension line with the
original 3D value frozen (`setValue()`). The result is a proper isometric dimension, lying in the
plane of the face it measures.

1. **meshup, `_flattenProjectionToScreen`:** record the two rotations and the centering offset on
   the result as a `toScreen(point)` mapping. Both iso paths go through it, which also covers the
   difference in plane normal between `Mesh.isometry` and `ShapeCollection._iso`.
2. **core, `shapeAnnotations.ts`:** wrap `iso`/`isometry`/`elevation` so they carry dimension lines
   over: map the drawn line points and the offset, freeze the value, link to the projection. An
   offset pointing at the camera falls back to a perpendicular in the drawing.
3. **Moving the result:** `ShapeCollection.translate` moves the linked (frozen) dimension lines
   along, so `.iso().move(1000)` keeps them in place.

Which dimensions: automatic by default, every dimension line whose points lie within the 3D
bounding box of the projected shapes (`select()` sub-shapes have no link back to their parent,
so linking alone misses `autoDim()` of a selected face). Override: `iso(cam, { dims: false })` or
`{ dims: [d1, d2] }`.

Limits: the value is the true 3D length while the drawn line is foreshortened (correct for
isometric drawings); dimension lines follow translations of the projection, not rotations/scales.

## Review and decisions by the human

- Asked whether dimensions could be added to isometries at all, with frozen values; approved the
  plan as proposed: automatic selection by the bounds of the projected shapes, with `dims: false`
  or a list as the override, and elevations included.
- The agent checked it on the script of the prompt (sample parameter values): the five
  `autoDim()` dimensions of the selected top face came through the isometry with their 3D values
  (480, 400, 40, 40, 50), lying in the plane of that face and moved along with `.move(1000)`.
- Found on the way, not changed: `DimensionLine.isDimensionLine()` compares `_type` with
  `'DimensionLine'` while dimension lines carry `'dimensionLine'`, so it is always false (the new
  code uses `instanceof`); the brep kernel keeps its own edge-matching transfer.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| meshup 7ae9c90 | Projections remember where 3D points land | 21:05 dimensions in isometries, 21:13 "yes" |
| (this commit) | Dimension lines in isometries and elevations | 21:05 dimensions in isometries, 21:13 "yes" |
