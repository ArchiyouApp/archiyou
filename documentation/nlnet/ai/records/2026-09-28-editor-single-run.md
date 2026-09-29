# Editor: one run per edit, tool outputs in the same run

| | |
|---|---|
| Dates | 2026-09-28 → 2026-09-28 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug report, a question, then the change) |
| Human | Mark van der Net: wrote the prompts, found the slow runs and duplicated metrics, asked why the editor ran twice, decided on the change |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-09-28 17:28 +0200  If I run this script in the editor it takes quite a long time. But also the metrics in the metric tool are duplicated "
                        
                        <pasted_content id="c223">
                        //// MAIN PARAMETERS
                        
                        $PARAMS.define('HOUSE_SIZES', 'number-ranges', {
                            label: 'House sizes',
                            mode: 'split',
                            minimum: 0, maximum: 100, multipleOf: 1,
                            minSpan: 0, 
                            labels: ['Small', 'Medium', 'Large'],
                            default: [40, 40, 20],
                        });
                        
                        TERRAIN_AREA = null; // auto
                        
                        const [ SMALL_PERC, MEDIUM_PERC, LARGE_PERC ] = $HOUSE_SIZES;
                        
                        //// PARAM INTERACTION
                        $PARAMS.PROJECT_AREA.enableIf(p => p.FIXED_PROJECT_AREA);
                        
                        
                        //// SETTINGS ////
                        
                        LEVEL_HEIGHT = 3;
                        HOUSE_SIZE_COLOR = { small : 'blue', medium : 'green', large: 'orange'};
                        
                        
                        PLAN_TYPES = {
                            row: 
                            {
                               terrain:  { },
                               plot: { 
                                  width: { min: 5.4, max: 9, default: 5.4  }, // depends of house
                                  depth: { min: 7, max: 12, default: 25 }
                                },
                                types:  // housing types
                                {
                                  small: {
                                      ufa: { min: 35, max: 60,  default: 50 }, // usable floor area in m2
                                      width: 5.4, // TODO: variable in m
                                      levels: 2,
                                  },
                                  medium: {
                                      ufa: { min: 60, max: 100,  default: 90 },
                                      width: 5.4, 
                                      levels: 3 // TODO: variable?
                                  },
                                  large: {
                                      ufa: { min: 110, max: 140,  default: 120 },
                                      width: 7.2,
                                      levels: 3,
                                  }
                                },
                              
                            }
                        
                        }
                        
                        //// CALCULATED PARAMS
                        
                        DEFAULT_PROJECT_AREA = PLAN_TYPES.row.plot.width.default * PLAN_TYPES.row.plot.depth.default * $TARGET_HOUSES;
                        
                        //// NUM HOUSES MIX ////
                        
                        numHousesSmall = Math.floor(SMALL_PERC/100*$TARGET_HOUSES);
                        numHousesMedium = Math.floor(MEDIUM_PERC/100*$TARGET_HOUSES);
                        numHousesLarge = Math.floor(LARGE_PERC/100*$TARGET_HOUSES);
                        
                        if((numHousesSmall+numHousesMedium+numHousesLarge) != $TARGET_HOUSES)
                        {
                            numHousesMedium += $TARGET_HOUSES - (numHousesSmall+numHousesMedium+numHousesLarge);
                        }
                        
                        //// FUNCTIONS ////
                        
                        function generateOptimizedStreet(projectArea, numHousesSmall, numHousesMedium, numHousesLarge, fixedDepth)
                        {
                                // optimize for number of houses and mix
                                const plotWidthSmall = 5.4;
                                const plotWidthMedium = 7.0;
                              
                                // one factor scales the whole mix, so the ratio stays put
                                const countsFor = (scale) => ({
                                  small:  Math.round(numHousesSmall  * scale),
                                  medium: Math.round(numHousesMedium * scale),
                                  large:  Math.round(numHousesLarge  * scale),
                                });
                        
                                const params =  { 
                                      MIX_SCALE:        { type: 'number', default: 1,   minimum: 0.01, maximum: 5, multipleOf: 0.05 },
                                      PLOT_WIDTH_LARGE: { type: 'number', default: 7, minimum: 5.4, maximum: 10.0, multipleOf: 0.3 },
                                }
                        
                                if(!fixedDepth)
                                {
                                  params.PLOT_DEPTH = { type: 'number', default: 25, minimum: 15, maximum: 30, multipleOf: 0.3 };
                                }
                              
                                 const opt = $module('optimize').run(
                                  {
                                    for: { 'projectArea' : projectArea },
                                    trials: 200,
                                    exclude: ['HOUSES', 'HOUSE_SIZES', 'FIXED_PROJECT_AREA', 'HOUSE_SIZES', 'PLANTYPE'], // TODO: all
                                    fix: [],
                                    prefer: ['PLOT_WIDTH_LARGE'],
                                    tolerance: projectArea * 0.01, // within 1% counts as reached
                                    params: params
                                  },
                                  (p) =>
                                  {
                                        const n = countsFor(p.MIX_SCALE);
                                        return (n.small * plotWidthSmall + n.medium * plotWidthMedium + n.large * p.PLOT_WIDTH_LARGE) * (p.PLOT_DEPTH || fixedDepth);
                                  }
                                )
                                // warn if we had to tone down the number of houses
                                const mixScale = opt.best.params.MIX_SCALE;
                                const newHouses = Math.floor(mixScale * $TARGET_HOUSES);
                          
                                if(mixScale > 1)
                                {
                                   print(`We could increase the number of homes from ${$TARGET_HOUSES} to ${newHouses} !`);
                                }
                                else if (mixScale < 1)
                                {
                                  print(`We had to decrease the number of homes from ${$TARGET_HOUSES} to ${newHouses} !`);
                                }
                        
                                // Make plots
                        
                                const data = { 
                                           projectArea : opt.best.params.PROJECT_AREA,
                                           plotDepth : opt.best.params.PLOT_DEPTH || fixedDepth,
                                           plotWidthSmall: plotWidthSmall,
                                           plotWidthMedium: plotWidthMedium,         
                                           plotWidthLarge : opt.best.params.PLOT_WIDTH_LARGE,
                                           numHouses: newHouses,
                                           numHousesSmall: countsFor(mixScale).small,
                                           numHousesMedium: countsFor(mixScale).medium,
                                           numHousesLarge: countsFor(mixScale).large,
                                       };
                        
                                const numHousesLeft = {
                                  'small' : data.numHousesSmall,
                                  'medium' : data.numHousesMedium,
                                  'large' : data.numHousesLarge,
                                }
                          
                                nextPlotStart = point(0,0)
                        
                                const plots = collection();
                        
                                new Array(newHouses).fill(null).forEach((n,i,arr) =>
                                {
                                  const randomOptions = [];
                                  Object.keys(numHousesLeft)
                                    .forEach((size) => {
                                      if(numHousesLeft[size] > 0) randomOptions.push(size) 
                                    }
                                  );  
                                  
                                  randomSizeIndex = Math.floor(Math.random() * randomOptions.length);
                                  curSizeName = randomOptions[randomSizeIndex];
                                    
                                  curPlotWidth = (curSizeName === 'large') ? data.plotWidthLarge : 
                                        (curSizeName === 'medium') ? data.plotWidthMedium : data.plotWidthSmall; 
                                
                                  const pl = rectBetween(nextPlotStart, 
                                                  nextPlotStart.copy().move(curPlotWidth, data.plotDepth));
                        
                                  pl.metadata = { type : 'plot', size: curSizeName };
                        
                                  // weird bug
                                  if(curSizeName)
                                  {
                                      pl.color(HOUSE_SIZE_COLOR[curSizeName])
                                  }
                                  else {
                                    print('WARNING: weird color from size name: ' + curSizeName);
                                  }
                                    
                                  nextPlotStart.move(pl.bbox().width());
                        
                                  plots.add(pl);
                         
                                  // size done, decrement
                                  numHousesLeft[curSizeName] = numHousesLeft[curSizeName] - 1; 
                            
                              });
                                
                              return { data, plots };      
                                
                        }
                        
                        //// MAIN ////
                        
                        
                        // Test street
                        //r = generateOptimizedStreet($PROJECT_AREA, numHousesSmall, numHousesMedium, numHousesLarge);
                        //print(r);
                        
                        // Basic layouts for plan types
                        if($PLANTYPE === 'row')
                        {
                            generateOptimizedStreet($PROJECT_AREA, numHousesSmall, numHousesMedium, numHousesLarge);
                        }
                        else if ($PLANTYPE === 'farmyard') 
                        {
                            
                          
                        }
                        else if ($PLANTYPE === 'courtyard') 
                        {
                            COURTYARD_DEPTH_MIN = 8;
                            COURTYARD_DEPTH_MAX = 15;
                            COURTYARD_DEPTH = 15; // stable for now
                            PLOT_DEPTH = 15;
                            PARKING_PER_HOUSE = 1.5;
                            PARKING_PLACE_WIDTH = 2.5;
                            PARKING_PLACE_DEPTH = 5;
                            PARKING_LANE_WIDTH = 5;
                            INROAD_WIDTH = 4;
                        
                          /*
                            const opt = $module('optimize').run(
                                  {
                                    for: { 'projectArea' : projectArea },
                                    trials: 200,
                                    exclude: ['HOUSES', 'HOUSE_SIZES', 'FIXED_PROJECT_AREA', 'HOUSE_SIZES', 'PLANTYPE'], // TODO: all
                                    fix: [],
                                    prefer: ['TERRAIN_LENGTH'],
                                    tolerance: projectArea * 0.1, // within 5% counts as reached
                                    params: {
                                      // enable the houses num to shrink and grow
                                      TERRAIN_LENGTH: { type: 'number', default: 30, minimum: 15, maximum: 50, multipleOf: 0.3 }
                                    }
                                  },
                                  (p) =>
                                  {
                                        const n = countsFor(p.MIX_SCALE);
                                        return (n.small * plotWidthSmall + n.medium * plotWidthMedium + n.large * p.PLOT_WIDTH_LARGE) * p.PLOT_DEPTH;
                                  }
                                )
                            */
                        
                            // depth of terrain is always the same: 2*PLOT_DEPTH+COURTYARD_DEPTH
                            terrainDepth = 2*PLOT_DEPTH+COURTYARD_DEPTH;
                            terrainWidth = $PROJECT_AREA/terrainDepth;
                            rowDepth = PLOT_DEPTH;
                        
                            // basic layout
                            terrain =  rectBetween([0,0,0], [terrainWidth, terrainDepth, 0]).color('gray');
                            terrainRowLeft = rectBetween([0,0,0], [PLOT_DEPTH, terrainDepth, 0]).color('gray');
                            terrainMidBlockWidth = terrainWidth - 2*INROAD_WIDTH - 2*PLOT_DEPTH;
                            terrainRowMidFront = rectBetween([0,0,0], [terrainMidBlockWidth, rowDepth, 0])
                                                      .move(rowDepth + INROAD_WIDTH).color('gray');
                            terrainRowMidBack = terrainRowMidFront.copy().mirrorY(terrainDepth/2).color('gray');
                            // Keep parking and right houses row open after we place the houses
                        
                            // plots of left houses row
                            const { plots: leftPlots, data: leftData } = generateOptimizedStreet(terrainRowLeft.area(), 
                                              numHousesSmall, numHousesMedium, numHousesLarge,rowDepth)
                            leftPlots.rotateZ(90, [0,0,0]).move(rowDepth);
                            // fill in mid rows (front and back) - we use the same for now
                            const { plots: midPlots, data: midData } = generateOptimizedStreet(terrainRowMidFront.area(), 
                                          numHousesSmall, numHousesMedium, numHousesLarge,rowDepth);
                            midPlots.move(rowDepth+INROAD_WIDTH);
                        
                            midPlotBack = midPlots.copy().mirrorY(terrainDepth/2).mirrorX(terrainWidth/2);
                        
                            totalHouses = leftData.numHouses + midData.numHouses*2;
                        
                            parkingSpots = Math.ceil(totalHouses * PARKING_PER_HOUSE);
                            parkingRows = Math.ceil(parkingSpots/2/PARKING_PLACE_WIDTH);
                            totalParkingDepth = parkingRows*PARKING_PLACE_WIDTH;
                        
                            // generate parking
                            parkingLane = rect(PARKING_LANE_WIDTH, totalParkingDepth)
                                            .align([terrainWidth,0,0], 'rightfront', 'center')
                                            .move(-PARKING_PLACE_DEPTH);
                            parkingSpot = rect(PARKING_PLACE_DEPTH, PARKING_PLACE_WIDTH)
                                            .align([terrainWidth,0,0], 'rightfront', 'center')
                            parkinSpotsRight = parkingSpot.row(parkingRows, 0, [0,1,0]);
                            parkingSpotsLeft = parkinSpotsRight.copy().mirrorX(parkingLane.select('E||front').center().x);
                            // remainder of houses
                            remaininSpaceForRow = terrainDepth-totalParkingDepth-INROAD_WIDTH;
                            if(remaininSpaceForRow > 10)
                            {
                              terrainRowRight = rectBetween(terrain.select('V||rightback'),
                                                            terrain.select('V||rightback').move(-rowDepth,-remaininSpaceForRow));
                              const { plots: rightPlots, data: rightData } = generateOptimizedStreet(terrainRowRight.area(), 
                                          numHousesSmall, numHousesMedium, numHousesLarge,rowDepth);
                        
                              rightPlots.rotateZ(90).align(terrain.select('V||rightback'), 'rightback', 'rightback');
                            }
                            
                        }
                        
                        //// AGGREGATE SOLUTION ////
                        
                        allPlots = all().filter((s) => s?.metadata?.type === 'plot');
                        print(all().filter((s) => print(s.metadata)));
                        numPlots = allPlots.length;
                        numPlotSmall = allPlots.filter(s => s.metadata.size === 'small').length;
                        numPlotMedium = allPlots.filter(s => s.metadata.size === 'medium').length;
                        numPlotLarge = allPlots.filter(s => s.metadata.size === 'large').length;
                        
                        //// METRICS ////
                        
                        calc.metric('HOUSES', numPlots)
                        </pasted_content id="c223">
                        
                        "
2026-09-28 18:35 +0200  You previously mentioned that if metrics/docs tools are open the script gets execution multiple time? Why? Can't the editor just detect that these menus are open and requests the outputs (in addition to the models). Metrics are exported in the model too btw.
2026-09-28 18:54 +0200  yes go ahead
2026-09-28 19:29 +0200  First commit the change to the execution configuration
```

## What was done (agent output, reviewed by the human)

Diagnosis: the script itself ran in about 0.4 s (Runner in node, optimize module included).
With the Metrics or Documents tool open, every editor run was two runs of the script: the
model and tables, then a second "lean" run for the tool outputs, appended to whatever result
was current. Automatic runs (code edits, parameter ticks) did not wait for each other, so
runs piled up in the worker, and a late metrics run appended its metrics to a newer result:
the metric showed twice. The Runner exports model, tables, metrics and docs from one
execution, so the second run was not needed.

Changes in `apps/editor/src/pages/editor.ts`:
- `execute()` requests model, tables and the outputs of the open tools in one run.
- One run at a time: a trigger during a run asks for one more run, which runs with the code
  and parameters as they are by then; every caller gets the result of the last run.
- `_executeToolOutputs()` only fills a tool opened after the last run; its outputs replace
  those under the same path instead of being appended, and its result is dropped when a full
  run started meanwhile.

Tested in the running editor on the author's `ur_plan` script, without changing its saved
values: five overlapping `execute()` calls gave 2 runs, each requesting model and metrics
together, and one HOUSES metric; closing and reopening the Metrics tool adds its metrics
once. Trade-off told to the author: with the Documents tool open, the model now shows only
after the document outputs of the same run are exported.

## Review and decisions by the human

- Asked why tool outputs needed a separate run instead of being requested with the model.
- Approved the change ("yes go ahead") and asked to commit it before the meshup Sketch fix.
- Pointed out that metrics are exported in the model too; the agent found that on the mesh
  path the GLB carries no metric values (only their names are in the result's meta).

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| 226ff08 | Editor: one run per edit, tool outputs in the same run | "yes go ahead" / "First commit the change to the execution configuration" |
| (this commit) | Close the disclosure record for the editor single run | "commit the last two things" (2026-09-29) |
