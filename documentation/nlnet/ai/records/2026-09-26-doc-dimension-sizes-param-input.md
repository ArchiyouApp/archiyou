# Dimension sizes from constants, autoDim on nearly flat parts, parameter field typing

| | |
|---|---|
| Dates | 2026-09-26 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: three small fixes asked for one by one in the session) |
| Human | Mark van der Net: wrote the prompts, found the three problems, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-26 21:48 +0200  Im looking a the dimension lines in Doc viewer (SVG) output and the dimension values are pretty smalle. I saw in constants.ts  export const DOC_DIMENSION_LINES_TEXT_HEIGHT = 5; // in mm --- is this the setting that controls the size here, it doesnt show much difference when i change it. Please check
2026-09-26 21:53 +0200  Cant the settings in constants.ts be wired up?
2026-09-26 21:55 +0200  please do
2026-09-26 22:03 +0200  This script: "
                        
                        <pasted_content id="c65e">
                        // frame
                        
                        $PARAMS.define('CONTENT_WIDTH', 'number', { label: "WIDTH", group: "main", order: 0, default: 300, minimum: 100, maximum: 600, multipleOf: 1 });
                        $PARAMS.define('CONTENT_HEIGHT', 'number', { group: "main", order: 1, default: 300, minimum: 300, maximum: 1000, multipleOf: 1 });
                        $PARAMS.define('FRAME_WIDTH', 'number', { group: "main", order: 2, default: 50, minimum: 20, maximum: 500, multipleOf: 1 });
                        $PARAMS.define('FRAME_DEPTH', 'number', { group: "main", order: 3, default: 40, minimum: 0, maximum: 200, multipleOf: 1 });
                        $PARAMS.define('FRAME_THICKNESS', 'number', { group: "main", order: 4, default: 15, minimum: 10, maximum: 40, multipleOf: 1 });
                        
                        
                        CONTENT_WIDTH = $CONTENT_WIDTH;
                        CONTENT_HEIGHT = $CONTENT_HEIGHT;
                        FRAME_WIDTH = $FRAME_WIDTH;
                        FRAME_THICKNESS = $FRAME_THICKNESS;
                        FRAME_DEPTH = $FRAME_DEPTH; // from content to outside
                        
                        content = rect(CONTENT_WIDTH,CONTENT_HEIGHT);
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
                        cutLine = frameHorFlat.select('F||front').select('E||left').copy().extend(200, 'start');
                        cutLineRefV = line(
                            frameHorFlat.select('V||fronttopleft'),
                            frameHorFlat.select('V||fronttopleft')
                            .copy()
                            .tmp()
                            .moveZ(200)
                        ).moveZ(0)
                          .dashed();
                        
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
                        ).moveZ(0)
                          .dashed();
                        
                        frameVerFlat.select('F||top').autoDim();
                        frameVerFlatIsoCol = collection(frameVerFlat, cutLineVer, cutLineVerRefV);
                        
                        cutAnglePrimary =  (frameHorFlat.select('F||top')
                                                .select('E||left').copy().moveZ(10).direction().angle([1,0,0])
                                                % 90);
                        
                        cutAngleSecondary = (frameHorFlat.select('F||front').select('E||left').direction().angle([0,0,-1]));
                        
                        print(cutAnglePrimary);
                        print(cutAngleSecondary);
                        
                        
                        
                        function docPipeline()
                        {
                          isoHor = frameHorFlatIsoCol
                              .iso([-0.5,-1,1])
                              .move(1000);
                        
                          isoVer = frameVerFlatIsoCol
                              .iso([-0.5,-1,1])
                              .move(1000,-500);
                        
                          return { isoHor, isoVer };
                        }
                        
                        // docPipeline();
                        
                        
                        docs.create('plan')
                          .pipeline(docPipeline)  
                          .page('plan')
                          .view('isoHor')
                          .shapes('isoHor')
                          .height(0.5)
                          .view('isoVer')
                          .shapes('isoVer')
                          .height(0.5)
                          .position(0,0.5)
                        
                          
                        
                        </pasted_content id="c65e">
                        
                        " with params 200,411,100,23,23 give an error "ERROR at line 64: "Annotator.autoDimPart(): Please make sure you have a 2D part on the XY plane! Use layflat() to lay a tilted part down first." - please debug
2026-09-26 22:16 +0200  Take the last script and test something: put a mouse cursor in a parameter value field and type something. The value jumps to the max somehow. Can you just make it so when user clicks the entire value is selected and the user types in the new value.
2026-09-26 23:07 +0200  make the commit according to nlnet disclosure format
```

## Plan (agent output, reviewed by the human before implementation)

No plan: each fix was asked for directly. What the agent found and did:

1. **Dimension line sizes.** `DOC_DIMENSION_LINES_TEXT_HEIGHT` in `packages/core/src/constants.ts` was read by nothing; the size came from `Annotator.DIMENSION_TEXT_SIZE_MM` (1.5 mm), and `DimensionLine.toSVG()` had its own fallbacks (4 mm text, 5 mm arrow, 0.25 mm line). The Annotator defaults and the fallbacks now come from `DOC_DIMENSION_LINES_TEXT_HEIGHT` and two new constants, `DOC_DIMENSION_LINES_ARROW_SIZE` and `DOC_DIMENSION_LINES_LINE_WIDTH`. Unused copies of four `DOC_*` constants in `modeler/brep/constants.ts` are removed. A label-margin test pins the dimension text size so it keeps testing the label part at any text height.
2. **autoDim on a part laid down by rotateToAxesOBbox().** With the frame script at 200, 411, 100, 23, 23 the top face of the laid-down member was 4.5e-7 thick on a 395-unit face; meshup's `Bbox` counted an axis as flat only below 1e-9 of the size (3.9e-7), so `autoDimPart()` threw. `BBOX_FLAT_REL_EPS` in meshup goes from 1e-9 to 1e-7, the value `OBBOX_PLANAR_REL_EPS` already uses for geometry that is planar to kernel tolerance.
3. **Parameter number field.** The field clamped to min/max on every keystroke and wrote the result back, so typing "4" into a field with minimum 300 became 300 and the next key appended to it, up to the maximum. The field now selects its value on click, keeps the typed text while focused, updates the model live only for values inside the bounds, and clamps and snaps on Enter or blur.

## Review and decisions by the human

- Noticed the small dimension text and that changing the constant did nothing; asked for the constants to drive the sizes, then for the arrow size and line width as well.
- Set the text height back to 2.5 mm after trying 5 mm.
- Found the autoDim error with specific parameters of the frame script.
- Found the jumping parameter value and chose the behaviour: select the whole value on click, type the new one.
- The agent tested the parameter field in the running editor (typing 450 and 5000 into CONTENT_HEIGHT) and ran the meshup and core unit tests.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
