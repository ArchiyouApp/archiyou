// urhousesketch
// Sketch design for URHOUSE

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "mm", order: 0, default: 4000, minimum: 2000, maximum: 10000, multipleOf: 10 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 5000, minimum: 2000, maximum: 10000, multipleOf: 10 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "mm", order: 0, default: 5000, minimum: 2000, maximum: 30000, multipleOf: 10 });
$PARAMS.define('ROOF_TYPE', 'options', { label: "Roof Type", order: 0, default: "gable", options: ["gable","shed"] });
$PARAMS.define('ROOF_ANGLE', 'number', { label: "Roof Angle", order: 0, default: 35, minimum: 10, maximum: 60, multipleOf: 1 });
$PARAMS.define('ROOF_RIDGE_AT_PERC', 'number', { label: "Ridge at perc", order: 0, default: 50, minimum: 20, maximum: 80, multipleOf: 1 });
$PARAMS.define('ROOF_RIDGE_SLOPES_SAME', 'options', { label: "Ride slopes same", order: 0, default: "angle", options: ["angle","height"] });
$PARAMS.define('OVERHANGS_SAME', 'boolean', { label: "Overhangs same", order: 0, default: true });
$PARAMS.define('OVERHANG_SIZE', 'number', { label: "Overhangs Size", units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_FRONT', 'number', { label: "Overhang Front", units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_LEFT', 'number', { label: "Overhang Left", units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_RIGHT', 'number', { label: "Overhang Right", units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_BACK', 'number', { label: "Overhang Back", units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('MAIN_FACADE', 'options', { label: "Main Facade side", order: 0, default: "Front", options: ["Front","Left","Right","Back"] });
$PARAMS.define('GENERATE_OPENINGS', 'boolean', { label: "Openings", order: 0, default: true });
$PARAMS.define('ENERGY_CALC', 'boolean', { label: "Energy calculation", default: false });
$PARAMS.define('ENERGY_AZIMUTH', 'number', { label: "azimuth", units: "deg", default: 0, minimum: 0, maximum: 360, multipleOf: 1 });

// Archiyou 0.6.5

units('mm')

WIDTH = $WIDTH; // outside width of house (excluding overhangs)
HEIGHT = $HEIGHT; // total outside height of house in mm
DEPTH = $DEPTH; // outside depth of house (excluding overhangs)


ROOF_TYPE = $ROOF_TYPE;
ROOF_ANGLE = $ROOF_ANGLE; // angle of left slope

ROOF_RIDGE_AT_PERC = $ROOF_RIDGE_AT_PERC; // from left
ROOF_RIDGE_SLOPES_SAME = $ROOF_RIDGE_SLOPES_SAME; // or height

OVERHANGS_SAME = $OVERHANGS_SAME;
OVERHANG_SIZE = $OVERHANG_SIZE; // parallel to ground plane
OVERHANG_FRONT = $OVERHANG_FRONT;
OVERHANG_BACK = $OVERHANG_BACK;
OVERHANG_LEFT = $OVERHANG_LEFT;
OVERHANG_RIGHT = $OVERHANG_RIGHT;

//// PARAM BEHAVIOURS ////
$PARAMS.ROOF_RIDGE_AT_PERC.visibleIf(ROOF_TYPE === 'gable');
$PARAMS.ROOF_RIDGE_SLOPES_SAME.visibleIf(ROOF_TYPE === 'gable');

$PARAMS.OVERHANG_SIZE.visibleIf(OVERHANGS_SAME);
$PARAMS.OVERHANG_FRONT.visibleIf(!OVERHANGS_SAME);
$PARAMS.OVERHANG_BACK.visibleIf(!OVERHANGS_SAME);
$PARAMS.OVERHANG_LEFT.visibleIf(!OVERHANGS_SAME);
$PARAMS.OVERHANG_RIGHT.visibleIf(!OVERHANGS_SAME);

$PARAMS.ENERGY_AZIMUTH.visibleIf($ENERGY_CALC);



//// SETTINGS ////
MIN_WALL_HEIGHT = 1000;
WALL_THICKNESS = 250;
ROOF_THICKNESS = 250;
ROOF_MINIMUM_HEIGHT = 500;
GROUNDFLOOR_HEIGHT = 2700;
FLOOR_THICKNESS = 300;
FIRST_FLOOR_START = GROUNDFLOOR_HEIGHT + FLOOR_THICKNESS;
STOREY_HEIGHT = 1500;

//// CALCULATED ////

NUM_FLOORS = (HEIGHT > 5000) ? 2 : 1;

//// MODEL ////

layer('diagram').color('blue');

// shed: one side pitch
if(ROOF_TYPE === 'shed')
{
    roofLineOutside = line([0,0,0],[WIDTH,0,Math.tan(toRad(ROOF_ANGLE))*WIDTH])
}
else {

    roofLineRidgePoint = point(
        [WIDTH*ROOF_RIDGE_AT_PERC/100,
        0,
        Math.tan(toRad(ROOF_ANGLE))*WIDTH*ROOF_RIDGE_AT_PERC/100]);

    roofLineOutside = polyline(
            [0,0,0],
            roofLineRidgePoint,
            [WIDTH,0,
                (ROOF_RIDGE_SLOPES_SAME === 'angle')
                ? roofLineRidgePoint.z - (WIDTH*(100-ROOF_RIDGE_AT_PERC)/100) * Math.tan(toRad(ROOF_ANGLE))
                : 0]
            )
}

// We got a roof line. Now position it to achieve total height (if possible)
roofLineOutside.moveZ(-roofLineOutside.bbox().minZ());

// Test if roof already exceeds maximum height
if(roofLineOutside.bbox().maxZ() > (HEIGHT - MIN_WALL_HEIGHT))
{
    print(`Your roof already exceeds given total height of ${HEIGHT} mm (and minimal wall height of ${MIN_WALL_HEIGHT}).
    Please lower roof angle if you want to stay under that height!`);
    // Higher roof line to realize min wall height
    roofLineOutside.moveZ(MIN_WALL_HEIGHT)
}
else {
    // move roof line up to get to maximum height
    roofLineOutside.moveZ(HEIGHT - roofLineOutside.bbox().maxZ());
}

// Make roofLineInside
roofLineOutsideOffsetted = roofLineOutside
                        .copy().offset(-ROOF_THICKNESS, null, [0,-1,0]) // Make sure we set plane normal for offset for shed
                        .hide();

roofLineInsideLeft = roofLineOutsideOffsetted
                        .edges().first()
                        .copy().extendTo(line([0,0,-100000],[0,0,150000]).hide())

roofLineInsideRightEdgeTmp = roofLineOutsideOffsetted.edges().last().copy().hide();

if(ROOF_TYPE === 'gable')
{
    roofLineInsideRight = roofLineInsideRightEdgeTmp
                                /*.copy().extendTo(
                                        line([WIDTH,0,-100000],[WIDTH,0,150000])
                                            .extrude(1000, [0,1,0]).moveY(-500)
                                        ) // BUG in intersection for large roof angles
                                */
                                // math solution
                                .copy().extend(
                                    roofLineInsideRightEdgeTmp.direction().scaled(1/roofLineInsideRightEdgeTmp.bbox().width())
                                        .scaled(WIDTH-roofLineInsideRightEdgeTmp.end().x)
                                        .length()
                                    ,
                                    'end'
                                )
}
else {
    // Shed, there is no right, but left needs to be cut
    roofLineInsideLeft = roofLineInsideLeft.cutoff('x', WIDTH).copy();
}

// Make wall lines (if any height available) - to full height of roof for cutting
wallLeftLine = (roofLineOutside.distance([0,0,0]) > 0 )
                    ? line([0,0,0],roofLineOutside.start())
                    : null;
wallRightLine = (roofLineOutside.distance([WIDTH,0,0]) > 0 )
                    ? line([WIDTH,0,0],roofLineOutside.end())
                    : null;




//// ROOF OVERHANGS ////

// NOTE: We don't include overhangs in house width/depth

ROOF_ANGLE_LEFT = ROOF_ANGLE;

ROOF_ANGLE_RIGHT = (ROOF_TYPE === 'gable')
                        ? (ROOF_RIDGE_SLOPES_SAME === 'angle')
                             ? ROOF_ANGLE_LEFT
                             : roofLineInsideRight.direction().angle([1,0,0]) // in degrees
                        : -ROOF_ANGLE_LEFT;

if(OVERHANGS_SAME)
{
    OVERHANG_FRONT = OVERHANG_LEFT = OVERHANG_RIGHT = OVERHANG_BACK = OVERHANG_SIZE;
}

// Special case: if overhang is zero we set facia flush with facade (special details)
roofLineInsideLeftOverhang = (OVERHANG_LEFT === 0)
                                ? roofLineInsideLeft.copy()
                                : roofLineInsideLeft
                                    .copy()
                                    .extend(OVERHANG_LEFT/Math.cos(toRad(ROOF_ANGLE_LEFT)), 'start');

if(ROOF_TYPE === 'gable')
{
    roofLineInsideRightOverhang = (OVERHANG_RIGHT === 0)
                                ? roofLineInsideRight.copy()
                                : roofLineInsideRight
                                    .copy()
                                    .extend(OVERHANG_RIGHT/Math.cos(toRad(ROOF_ANGLE_RIGHT)), 'end')
}
else if(ROOF_TYPE === 'shed')
{
    // no right side, extend left roof line to end
    roofLineInsideRightOverhang = null;
    if(OVERHANG_RIGHT > 0)
    {
        roofLineInsideLeftOverhang.extend(Math.cos(toRad(ROOF_ANGLE_RIGHT))*OVERHANG_RIGHT, 'end')
    }
}

layer('diagram').shapes().hide();


//// ROOF 3D ////

layer('roof').color('red');

roofLineInsideOverhangsSingle = (ROOF_TYPE === 'gable')
                ? polyline(
                        roofLineInsideLeftOverhang.start(),
                        roofLineInsideLeftOverhang.end(),
                        roofLineInsideRightOverhang.end()
                        )
                : roofLineInsideLeftOverhang.copy().tmp();

if(ROOF_TYPE === 'gable')
{
    roofLineOutsideOverhangs = roofLineInsideOverhangsSingle
        .copy().offset( ROOF_THICKNESS, null, [0,1,0])
    //.hide()
}
else {
    // offsetted for (Line) Edge is instable - TODO: Fix in Core
    roofLineOutsideOverhangs = roofLineInsideOverhangsSingle
        .copy().move(roofLineInsideOverhangsSingle.direction(true).rotateY(-90).scaled(ROOF_THICKNESS))
}

if(ROOF_TYPE == 'gable')
{
    roofLineOutsideOverhangsVerts = collection();
    // BUG: disordered wire after offset
    // Get Vertices and sort
    // TODO: FIX IN CORE
    roofLineOutsideOverhangs.edges().forEach((e,i) =>
    {
        roofLineOutsideOverhangsVerts.add(e.start(),e.end());
    })
    roofLineOutsideOverhangsVerts =
    roofLineOutsideOverhangsVerts.unique().sort((v1,v2) => v1.x - v2.x)

    roofLineOutsideOverhangs = polyline(roofLineOutsideOverhangsVerts.toArray())
                            .hide();

}

// If any overhang is zero, make flush with facade
if(OVERHANG_LEFT === 0 || OVERHANG_RIGHT)
{
    if(ROOF_TYPE === 'shed')
    {
        roofLineOutsideOverhangsChecked = line(
            OVERHANG_LEFT === 0 ? roofLineOutside.start() : roofLineOutsideOverhangs.start(),
            OVERHANG_RIGHT === 0 ? roofLineOutside.end() : roofLineOutsideOverhangs.end()
        )
    }
    else if(ROOF_TYPE === 'gable')
    {
        roofLineOutsideOverhangsChecked = polyline(
            OVERHANG_LEFT === 0 ? roofLineOutside.start() : roofLineOutsideOverhangs.start(),
            roofLineOutside.vertices()[1],
            OVERHANG_RIGHT === 0 ? roofLineOutside.end() : roofLineOutsideOverhangs.end()
        )
    }
    roofLineOutsideOverhangsChecked.hide();
}

roofSolids = collection(
                roofLineInsideOverhangsSingle // NOTE: 2 Solids if gable, 1 if shed - make into collection always
                .copy().loft(roofLineOutsideOverhangsChecked, true)
                .extrude(DEPTH+OVERHANG_FRONT+OVERHANG_BACK, [0,1,0])
                .moveY(-OVERHANG_FRONT)
                .color('#544412'));

roofSolids
    .forEach(
        s =>
        {
            if(s.bbox().minZ() < ROOF_MINIMUM_HEIGHT)
            {
                print(`A roof overhang is lower than the minimum "${ROOF_MINIMUM_HEIGHT}". Cut off!`)
                s.cutoff('z', ROOF_MINIMUM_HEIGHT)
            }
        });



// Make sure roofs is minimal from ground plane
//roofSolid.cutOff('z', ROOF_MINIMUM_HEIGHT)

//// 3D WALLS ///

// first front/back then sides

layer('walls').color('#f1c232')

frontWallVerts = [wallLeftLine.start(),
                roofLineInsideLeft.start(),
                roofLineInsideLeft.end()]
if(ROOF_TYPE == 'gable')
{
    frontWallVerts.push(roofLineInsideRight.end())
}
frontWallVerts.push(wallRightLine.start().copy())

wallFrontFace = polyline(frontWallVerts)
            .toFace();
wallFront = wallFrontFace
            .extrude(WALL_THICKNESS, [0,1,0])

wallBack = wallFront.copy().moveY(DEPTH-WALL_THICKNESS)
// copy() first: extruding the diagram lines themselves would leave the side walls on the
// 'diagram' layer (a shape stays on its source's layer), while a copy is made on the active
// one - which is what puts the whole house on 'walls'.
wallLeft = wallLeftLine
            .copy()
            .extrude(DEPTH-WALL_THICKNESS*2, [0,1,0])
            .moveY(WALL_THICKNESS)
            .extrude(WALL_THICKNESS, [1,0,0])
            .subtract(roofSolids)

wallRight = ((ROOF_TYPE === 'gable') ? wallRightLine.copy() : line([WIDTH,0,0],roofLineInsideLeft.end()))
            .extrude(DEPTH-WALL_THICKNESS*2, [0,1,0])
            .moveY(WALL_THICKNESS)
            .extrude(WALL_THICKNESS, [-1,0,0])
            .subtract(roofSolids)

//// OPENINGS ////

// TODO: more facade opening scenarios. Now only basic

const windows = []; // To keep track of windows

if($GENERATE_OPENINGS && !$ENERGY_CALC) // don't generate openings for energy calc, as they are not included in area calculation yet
{

  layer('openings').color('brown');
  openingsGroundFloor = collection(); // keep track for floor plan

  // Make a simple opening with frame
  function makeOpeningFrame(w,h,pivot,sill,zRot)
  {
      const FRAME_SIZE = 100;
      const BBOX_DEPTH = 2000;
      pivot = pivot || [0,0];
      const b = box(w,FRAME_SIZE, h);
      const window = {
              frame:
                  b.subtract(box(w-2*FRAME_SIZE, FRAME_SIZE, h-2*FRAME_SIZE).hide())
                  .moveTo(pivot)
                  .rotateZ(zRot || 0)
                  .moveZ(h/2 + (sill || 0))
                  .color('brown'),
              bbox:
                  box(w, BBOX_DEPTH, h)
                  .moveTo(pivot)
                  .rotateZ(zRot || 0)
                  .moveZ(h/2 + (sill || 0))
                  .hide(),
              plane:
                  plane(w, h)
                  .rotateX(90)
                  .moveTo(pivot)
                  .rotateZ(zRot || 0)
                  .moveZ(h/2 + (sill || 0))
                  .hide()
      }
      windows.push(window);
      return window;
  }

  FACADE_TO_WALL = {
      Front: { wall: wallFront, opposite: wallBack },
      Left: { wall: wallLeft, opposite: wallRight },
      Right: { wall: wallRight, opposite: wallLeft },
      Back: { wall: wallBack, opposite: wallFront },
  }

  // x,y coord along wall, where +x is from left (-x is from right) and y is height => world z
  // start of wall is point most (left, front)
  function wallXPositionToWorld(wall,x)
  {
      // only x or y walls: can be generalized for any wall along vector later
      const wallBbox = wall.bbox();
      const wallLengthAxis = (wallBbox.width() > wallBbox.depth()) ? 'x' : 'y';
      const wallDirection = (wallLengthAxis === 'x') ? vector(1,0,0) : vector(0,1,0);
      const wallStartWorld = vector(wallBbox.minX()+WALL_THICKNESS/2,wallBbox.minY()+WALL_THICKNESS/2)

      const wallLength = (wallLengthAxis === 'x') ? wallBbox.width() : wallBbox.depth();
      const wallX = (x >= 0 && x <= 1)
                  ? x*wallLength // perc
                  : (x > 1) ? x : wallLength + x;
      // Vector.scaled() mutates, and Vectors have no move(): build the world Point instead
      return point(wallDirection.scale(wallX).add(wallStartWorld));
  }


  // ---- Main facade: front door, some windows ----
  mainFacadeWall = FACADE_TO_WALL[$MAIN_FACADE].wall;
  mainFacadeWallBbox = mainFacadeWall.bbox();
  mainFacadeWallRotZ = mainFacadeWallBbox.width() > mainFacadeWallBbox.depth()
                          ? 0 : 90;
  mainFacadeWallLength = mainFacadeWallRotZ === 90 ? WIDTH : DEPTH;

  if(mainFacadeWallBbox.height() < 2500)
  {
      print(`Can't place a main facade on side "{$MAIN_FACADE}" : It's wall is too low!`)
  }
  else
  {
      // front door
      frontDoor = makeOpeningFrame(1000,2000,wallXPositionToWorld(mainFacadeWall, -1000-200), 0, mainFacadeWallRotZ);
      frontDoorCentered = false;

      if(!roofSolids.toArray().find(r => r.intersects(frontDoor.frame))) // intersects is more stable than distance
      {
          mainFacadeWall.subtract(frontDoor.bbox);
          openingsGroundFloor.add(frontDoor.frame);
      }
      else {
          frontDoorCentered = true;
          // try moving door to center
          if(mainFacadeWallRotZ === 0)
          {
              frontDoor.frame.moveToX(WIDTH/2-500);
              frontDoor.bbox.moveToX(WIDTH/2-500);
          }
          else {
              frontDoor.frame.moveToY(DEPTH/2-500);
              frontDoor.bbox.moveToY(DEPTH/2-500);
          }
          // OC BUG in distance between roof solids
          if(roofSolids.toArray().every(r => !r.intersects(frontDoor.frame)))
          {
              mainFacadeWall.subtract(frontDoor.bbox)
          }
          else {
              frontDoorCentered = false;
              frontDoor.frame.hide();
          }
      }

      // kitchen window (if width is large enough)
      if(mainFacadeWallLength > 3000 && !frontDoorCentered)
      {
          kitchenWindow = makeOpeningFrame(1500,1000,wallXPositionToWorld(mainFacadeWall,-1000-200-1000-600), 1000, mainFacadeWallRotZ);

          if(roofLineOutsideOverhangsChecked.distance(kitchenWindow.frame) <= 400
              || !mainFacadeWallBbox.containsBbox(kitchenWindow.frame.bbox()))
          {
              kitchenWindow.frame.hide();
          }
          else {
              mainFacadeWall.subtract(kitchenWindow.bbox)
              openingsGroundFloor.add(kitchenWindow.frame);
          }
      }

      // Add floor window in center below ridge (if gable) or to right (shed)
      if(mainFacadeWallBbox.height() > 4000)
      {
          mainFacadeTopWindow = makeOpeningFrame(800,1000,
              wallXPositionToWorld(mainFacadeWall,
                  ((['Front','Back']).includes($MAIN_FACADE) && (ROOF_TYPE === 'gable')) ? (roofLineRidgePoint.x-WALL_THICKNESS/2)/WIDTH : 0.5), 2900+700,
                  mainFacadeWallRotZ);

          if(mainFacadeTopWindow.frame.bbox().maxZ() > mainFacadeWallBbox.maxZ() - 400 || roofLineOutsideOverhangsChecked.distance(mainFacadeTopWindow.frame) <= 300
              || mainFacadeTopWindow.frame.distance(wallRight) < 150)
          {
              mainFacadeTopWindow.frame.hide();
          }
          else {
              mainFacadeWall.subtract(mainFacadeTopWindow.bbox)
          }

      }
  }

  // ---- back facade ----
  backFacadeWall = FACADE_TO_WALL[$MAIN_FACADE].opposite;
  backFacadeWallBbox = mainFacadeWall.bbox();
  backFacadeWallRotZ = mainFacadeWallBbox.width() > mainFacadeWallBbox.depth()
                          ? 0 : 90;

  // One big back centered opening for now
  backOpeningSize = ((backFacadeWallRotZ === 0) ?  WIDTH : DEPTH) - (WALL_THICKNESS+100)*2;
  if(backOpeningSize > 2400) backOpeningSize = 2400; // max width
  backFacadeOpeningFrame = makeOpeningFrame(backOpeningSize, 2000, wallXPositionToWorld(backFacadeWall,0.5), 0, backFacadeWallRotZ)
  if(!roofSolids.find(s => backFacadeOpeningFrame.frame.distance(s) <= 50))
  {
      backFacadeWall.subtract(backFacadeOpeningFrame.bbox);
      openingsGroundFloor.add(backFacadeOpeningFrame.frame);
  }
  else {
      backFacadeOpeningFrame.frame.hide();
  }

  // ---- side facades ----

  // simple repeating grid of rows of windows
  function fillFacade(wall)
  {
      const WINDOW_WIDTH = 800;
      const WINDOW_HEIGHT_GROUNDFLOOR = 2000;
      const WINDOW_HEIGHT_TOPFLOOR = 1000;
      const DISTANCE_BETWEEN_WINDOWS = WINDOW_WIDTH*1.8;
      const WINDOW_RANDOMNESS = DISTANCE_BETWEEN_WINDOWS*1.1;

      const wallBbox = wall.bbox();
      const wallLength = (wallBbox.width() > wallBbox.depth()) ? wallBbox.width() : wallBbox.depth();
      const wallRotZ = (wallBbox.width() > wallBbox.depth()) ? 0 : 90;
      const numCols =  Math.floor((wallLength - 2*WALL_THICKNESS) / (WINDOW_WIDTH+DISTANCE_BETWEEN_WINDOWS));
      const startLeft = (wallLength - 2*WALL_THICKNESS)
                      -numCols*(WINDOW_WIDTH+DISTANCE_BETWEEN_WINDOWS)
                      + WALL_THICKNESS + DISTANCE_BETWEEN_WINDOWS;
      if(startLeft < WALL_THICKNESS) startLeft = WALL_THICKNESS

      for(let fl = 0; fl < NUM_FLOORS; fl++)
      {
          for(let col = 0; col < numCols; col++)
          {
              const windowFrame = makeOpeningFrame(
                      WINDOW_WIDTH // +WINDOW_RANDOMNESS*Math.random()
                      ,
                      ((fl == 0) ? WINDOW_HEIGHT_GROUNDFLOOR : WINDOW_HEIGHT_TOPFLOOR) //* WINDOW_RANDOMNESS*Math.random()
                      ,
                      wallXPositionToWorld(wall,
                          WINDOW_RANDOMNESS*Math.random()-WINDOW_RANDOMNESS/2 + col*(WINDOW_WIDTH+DISTANCE_BETWEEN_WINDOWS)+startLeft),
                      (fl === 0) ? 0 : FIRST_FLOOR_START+700, wallRotZ
                      )

              // test if windowFrame is contained by wall and underneath roof
              if(wall.bbox().maxZ() > windowFrame.frame.bbox().maxZ() + 400 &&
                      !roofSolids.toArray().find(s => s.overlaps(windowFrame.frame))
                  )
              {
                  wall.subtract(windowFrame.bbox);
                  if(fl === 0)
                  {
                      openingsGroundFloor.add(windowFrame.frame);
                  }
              }
              else {
                  windowFrame.frame.hide();
              }

          }
      }

  }

  sideFacades = (['Front','Back'].includes($MAIN_FACADE))
                      ? ['Left', 'Right']
                      : ['Front','Back'];



  sideFacades.forEach(f =>
  {
      // needs const, otherwise global
      const sideFacadeWall = FACADE_TO_WALL[f].wall;
      fillFacade(sideFacadeWall);
  })
} // End if GENERATE_OPENINGS


//// FLOOR AND GROUND PLANE

groundPlane = planebetween([0,0,0],[WIDTH, DEPTH, 0])
                .color('#444');
lowestWallHeight = [wallLeft, wallRight, wallFront, wallBack]
                    .map(w => w.bbox().maxZ())
                    .sort()[0]
if(lowestWallHeight < GROUNDFLOOR_HEIGHT+FLOOR_THICKNESS+STOREY_HEIGHT
    && NUM_FLOORS > 1)
{
    boxbetween(
        [WALL_THICKNESS,WALL_THICKNESS,0],
        [WIDTH-WALL_THICKNESS, DEPTH-WALL_THICKNESS,FLOOR_THICKNESS])
        .moveZ(GROUNDFLOOR_HEIGHT)
        .color('#222')
}


//// ORGANIZE ////

layer('diagram').shapes().hide();

layer('walls');
// The four walls abut without overlapping, so merge their polygons instead of running a
// boolean union: unioning solids that share whole faces blows the kernel's BSP stack.
// merge() puts the merged Shape in the scene in place of the four it was given, so the
// walls are handed over whole - no hidden copies left behind.
wallsCombined = collection(wallLeft, wallFront, wallRight, wallBack)
            .merge()
            .color('#f1c232')



//// STATS TABLE ////

gutterHeightMax = Math.round([roofLineOutsideOverhangsChecked.start().z,roofLineOutsideOverhangsChecked.end().z].sort()[1]);
gutterHeightMin = Math.round(roofLineOutsideOverhangsChecked.bbox().minZ());
floorAreaGross = Math.round((WIDTH*DEPTH)*1e-6) * NUM_FLOORS;
floorAreaNet = Math.round(((WIDTH-2*WALL_THICKNESS)*(DEPTH-2*WALL_THICKNESS))*1e-6) * NUM_FLOORS;
// envelope minus walls. Done arithmetically: the walls abut without overlapping, and the
// boolean on the merged wall solid has coincident faces that make the kernel blow its stack.
volumeNet = Math.round((wallFrontFace.copy().tmp().extrude(DEPTH,[0,1,0]).volume()
                - wallsCombined.volume()) * 1e-9); // mm3 => m3


calc.table(
'stats',
[
    ['Width','from outside', WIDTH, 'mm' ],
    ['Depth','from outside', DEPTH, 'mm' ],
    ['Height','~ maximum height', HEIGHT, 'mm' ],
    ['Gutter height max', '', gutterHeightMax, 'mm'],
    ['Gutter height min', '', gutterHeightMin, 'mm'],
    ['Ground floor area', 'gross', floorAreaGross , 'm2' ],
    ['Ground floor area', 'net', floorAreaNet, 'm2' ],
    ['Number of levels', 'including groundfloor', (NUM_FLOORS), '#'],
],
['what', 'description', 'value', 'unit'])

//// ENERGY CALCULATION ////

let ENERGY_RESULTS; 
if($ENERGY_CALC)
{
    // util function
    function valueToColor(value, min, max, colorMin, colorMax)
    {
        const t = Math.max(0, Math.min(1, (value - min) / (max - min)));

        const parseHex = (hex) => {
            const h = hex.replace('#', '');
            return [
                parseInt(h.substring(0, 2), 16),
                parseInt(h.substring(2, 4), 16),
                parseInt(h.substring(4, 6), 16)
            ];
        };

        const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');

        const [r1, g1, b1] = parseHex(colorMin);
        const [r2, g2, b2] = parseHex(colorMax);

        const r = r1 + t * (r2 - r1);
        const g = g1 + t * (g2 - g1);
        const b = b1 + t * (b2 - b1);

        return '#' + toHex(r) + toHex(g) + toHex(b);
    }


    print('Energy calculation');
    // draw noth arrow for orientation
    layer('energy');
    const COMPASS_RADIUS = 500;
    compass = circle(COMPASS_RADIUS).color('red').move(-1000,-1000);
    arrow = rect(25,COMPASS_RADIUS).align(compass, 'topbackcenter', 'topbackcenter').moveZ(10).color('black');
    layer('energy').shapes().rotateZ(-$ENERGY_AZIMUTH);

    // TODO: make layer('walls').hide() work too!
    layer('walls').shapes().hide();
    layer('roof').shapes().hide();
    energyMass = wallFrontFace.copy().tmp().extrude(DEPTH,[0,1,0]).addToScene().color('blue');

    function generateId(azimuth, tilt)
    {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(azimuth / 45) % 8;
        return ((tilt < 90) ? 'R' : '') + directions[index]; // R for roof, to RW, RE, RS
    }

    const energyFaces = [...energyMass.faces().toArray()].map((f,i) => {
        try {
            console.log('==== FACE ' + i + ' ====');
            const n = f.normal();
            console.log('Normal: ' + n.toString());

            if(n.equals(0,0,-1)){ return null; } // skip ground plane faces

            const xyAngle = (n.x === 0 && n.y === 0) ? 0 : n.angleXY();
            let azimuth = ((90 - xyAngle - $ENERGY_AZIMUTH + 360) % 360); // convert XY angle to azimuth with 0 = north
            if(azimuth < 0) azimuth += 360; 
            const tilt = n.angle([0,0,1]); // tilt is angle between Z axis and normal, so 0 = horizontal, 90 = vertical
            return { 
                id: generateId(azimuth, tilt),
                face: f, // save reference to face for coloring later
                area_m2: (f.area()/1e6).toFixed(1), // mm2 => m2
                azimuth_deg: azimuth, 
                tilt_deg : tilt 
            }    
        }
        catch(e)
        { 
            console.log('Error processing face ' + i + ': ' + e);
            return null; 
        } // some weird normal length = 0 bug
    }).filter(f => f !== null);

    console.log('=== ENERGY FACES ===');
    console.log(energyMass.faces().count());
    console.log(energyMass.faces().toArray().map(f => f.isPlanar()));
    
    console.log(energyFaces.length);

    ENERGY_RESULTS = await services.energy({
        location : { lng : 4.9041, lat : 52.3676 },
        building_volume_m3 : volumeNet,
        building_floor_area_m2 : floorAreaNet,
        planes: energyFaces.map(f => { const ff = { ...f }; delete ff['face']; return ff; }), // remove face data for service call
    })

    // Color code the faces
    energyMass.hide();

    // First result stats
    const maxIrradiance = Math.max(...ENERGY_RESULTS.planes.map(p => p.day_avg_irradiance_kwh_m2 * p.area_m2));
    const minIrradiance = Math.min(...ENERGY_RESULTS.planes.map(p => p.day_avg_irradiance_kwh_m2 * p.area_m2));

    energyFaces
        .forEach((f,i) => 
        {
            const col = valueToColor(
                    ENERGY_RESULTS.planes[i].day_avg_irradiance_kwh_m2 * ENERGY_RESULTS.planes[i].area_m2, 
                    minIrradiance, maxIrradiance, 
                    '#0000ff', '#ffff00');
            console.log('=== COL ===');
            console.log(col);
            f.face.copy().color(col);
            // make smaller version of face wire to show window to wall ratio
            if(ENERGY_RESULTS.planes[i].wwr_max) f.face.edges().scale(ENERGY_RESULTS.planes[i].wwr_max).color('red');
            if(ENERGY_RESULTS.planes[i].wwr_avg) f.face.edges().scale(ENERGY_RESULTS.planes[i].wwr_avg).color('black');
            // if(ENERGY_RESULTS.planes[i].wwr_min) f.face.edges().scale(ENERGY_RESULTS.planes[i].wwr_min).color('blue');
        });

    // print overview
    energyFaces.forEach((f,i) => print(f.id + ': A=' + f.area_m2 + 'm2, az: ' + f.azimuth_deg.toFixed(0) + ' - tilt: ' + f.tilt_deg.toFixed(0) + ' - irr: ' + (ENERGY_RESULTS.planes[i].day_avg_irradiance_kwh_m2 * ENERGY_RESULTS.planes[i].area_m2).toFixed(2) + ' kWh/day'));
}

//// METRICS ////

if(!$ENERGY_CALC)
{
    calc.metric('area (net)', floorAreaNet, { unit: 'm2', icon: 'shape-rectangle-plus' });
    calc.metric('volume (net)', volumeNet, { unit: 'm3', icon:'cube' });

    const FULL_SERVICE_BASE_PRICE_EUR_M2_UNTIL_AREA = [
                            { area: 30, price: 4200 },
                            { area: 60, price: 4000 },
                            { area: 100, price: 3300 },
                            { area: 130, price: 2900 },
                            { area: 500, price: 2700 }, 
                        ];
                        
    pricePerM2 = FULL_SERVICE_BASE_PRICE_EUR_M2_UNTIL_AREA
                    .find(ap => floorAreaNet <= ap.area)?.price;

    if(pricePerM2)
    {
        const PRICE_FROM_FACTOR = 0.5; // with all discounts
        calc.metric('price (DIY)', Math.round(pricePerM2*floorAreaNet/1000*PRICE_FROM_FACTOR) + 'k', { unit: 'EUR', icon: 'currency-eur' });
        calc.metric('price (full)', Math.round(pricePerM2*floorAreaNet/1000) + 'k', { unit: 'EUR', icon: 'currency-eur' });
        //calc.metric('price/area', pricePerM2, { unit: 'EUR/m2', icon: 'currency-eur' });
    }
}
else {
    // Energy metrics
    const energySolarPotential = ENERGY_RESULTS.planes.reduce((sum, p) => (p.id.includes('R')) ? (sum + p.day_avg_irradiance_kwh_m2 * p.area_m2 * 0.15) : sum, 0).toFixed(1); 
    const energyColdestDay = ENERGY_RESULTS.coldest_day.max_temp_c + ' @' + new Date(ENERGY_RESULTS.coldest_day.date).getDate() + '/' + (new Date(ENERGY_RESULTS.coldest_day.date).getMonth()+1);
    const energyWarmestDay = ENERGY_RESULTS.warmest_day.max_temp_c + ' @' +new Date(ENERGY_RESULTS.warmest_day.date).getDate() + '/' + (new Date(ENERGY_RESULTS.warmest_day.date).getMonth()+1);
    
    const energyHeatDemandColdest = ENERGY_RESULTS.building_heating_demand_kwh_day.toFixed(1);

    const energyPassiveGainWarmest = (ENERGY_RESULTS.planes.reduce((sum, p) => sum + (p.wwr_avg_warmest_solar_heat_gain_kwh_m2 || 0), 0)).toFixed(1);
    const energyPassiveGainColdest = (ENERGY_RESULTS.planes.reduce((sum, p) => sum + (p.wwr_avg_coldest_solar_heat_gain_kwh_m2 || 0), 0)).toFixed(1);

    calc.metric('coldest day', energyColdestDay, { icon: 'snowflake' });
    calc.metric('warmest day', energyWarmestDay, { icon: 'weather-sunny' });
    calc.metric('solar energy (kWh/day)', energySolarPotential, { unit: 'kWh/day', icon: 'solar-panel' });
    calc.metric('max heat demand', energyHeatDemandColdest, { unit: 'kWh/day', icon: 'fire' });
    calc.metric('passive gain',  '[' + energyPassiveGainColdest + '-' + energyPassiveGainWarmest + ']', { unit: 'kWh/day', icon: 'white-balance-sunny' });
}


//// AREAS TABLE ////

areaWalls = Math.round((wallFrontFace.area()*2 + wallLeftLine.copy().tmp().extrude(DEPTH).area()+wallRightLine.copy().tmp().extrude(DEPTH).area())*1e-6);
areaFacade = areaWalls * 1.1; // a little bigger
areaRoof = Math.round((roofLineOutsideOverhangsChecked.copy().tmp().extrude(DEPTH).area()*1e-6));

calc.table(
    'areas',
    [

        ['Total floor area', 'gross, estimation', Math.round(NUM_FLOORS*(WIDTH*DEPTH)*1e-6), 'm2' ],
        ['Total floor area', 'net, estimation', Math.round(NUM_FLOORS*((WIDTH-2*WALL_THICKNESS)*(DEPTH-2*WALL_THICKNESS))*1e-6), 'm2' ],
        ['Total wall length', '', Math.round((2*WIDTH+2*DEPTH)*1e-3), 'm'],
        ['Facade surface', 'estimation without openings',
            areaFacade,
            'm2'
        ],
        ['Roof surface', 'top surface', areaRoof , 'm2']
    ],
    ['area', 'description', 'value', 'unit']
)

//// OFFER SPREADSHEET PIPELINE ////
// Push the model's numbers into a copy of a Google Sheet offer template. External
// spreadsheets are handled by the `cloudcalc` module (modules/archiyou-modules/cloudcalc):
// open the template, then copy it with the inputs filled in. The copy lands in the
// shared drive the module is configured with and its URL is the pipeline's result.

areaWindows = ($GENERATE_OPENINGS)
    ? windows.reduce((sum,w) => sum + Math.round(w.plane.area()*1e-6),0)
    : 0;
numDoors = ($GENERATE_OPENINGS) ? 1 : 0; // TODO
numSlidingDoors = ($GENERATE_OPENINGS) ? 1 : 0; // TODO
projectId = $PROJECT_ID || 'PROJECTXYZ';

$pipeline('offer', 
          function(scope) 
          {
              $module('cloudcalc');
              const template = cloudcalc.open('URBUILD_OFFER_TEMPLATE'); // a sheet name published in CLOUDCALC_SHEETS
              return template.copy(
                  { 
                      projectid: projectId,
                      width: scope.WIDTH, 
                      depth: scope.DEPTH, 
                      height: scope.HEIGHT,
                      wallsurface: scope.areaWalls, 
                      roofsurface: scope.areaRoof,
                      facadesurface: scope.areaFacade,
                      windowssurface: (scope.areaWindows > 2) ? scope.areaWindows - 2 : 0, // remove door from it
                      doors: scope.numDoors,
                      // slidedoor: scope.numSlidingDoors, // Use glass surface total
                      storeys: scope.NUM_FLOORS - 1, // excluding groundfloor
                      floorarea_gross: scope.floorAreaGross,
                      floorarea_net: scope.floorAreaNet,
                      volume_net: scope.volumeNet, 
                      gutter_min: scope.gutterHeightMin,
                      gutter_max: scope.gutterHeightMax,
                  },
                  { title: 'URBUILD_OFFER_' + projectId }
              ).url;
          }    
      )


//// SPEC SHEET DOCUMENT ////

function docPipeline()
{

    layer('doc').color('black');

    layer('iso').color('black')
    allVisible = all().onlyVisible().solids();

    // isometries
    isoLeftFront = allVisible.iso([-1,-1,1]).move(WIDTH*5); // main isometry


    // base floorplan
    FLOOR_PLAN_PIVOT_POINT = [0,-DEPTH*2]

    // subtracted() was non-mutating: copy first, then subtract in place
    wallsCombinedSection = wallsCombined.copy()
        .subtract(box(WIDTH*2,DEPTH*2,HEIGHT).moveZ(HEIGHT/2+1500).hide())

    floorplan = collection(wallsCombinedSection,openingsGroundFloor)
        .project([0,0,1], true)
        .moveTo(FLOOR_PLAN_PIVOT_POINT);

    wallsCombinedSection.hide(); // don't show in model

    // elevations
    elevationFront = allVisible.elevation('front') // elevation placed on origin
            .moveTo(FLOOR_PLAN_PIVOT_POINT)
                .moveY(-HEIGHT/2-DEPTH/2-2000);

    elevationLeft = allVisible
            .elevation('left')
            .moveTo(FLOOR_PLAN_PIVOT_POINT)
                .rotateZ(-90)
                .move(-WIDTH-HEIGHT/2);

    elevationRight = allVisible
            .elevation('right')
            .moveTo(FLOOR_PLAN_PIVOT_POINT)
                .rotateZ(90)
                .move(WIDTH+HEIGHT/2);

    elevationBack = allVisible.elevation('back') // elevation placed on origin
            .moveTo(FLOOR_PLAN_PIVOT_POINT)
                .rotateZ(180)
                .moveY(+HEIGHT/2+DEPTH/2+2000);

    // add isometries to elevations
    isoRightFront = allVisible.iso([1,-1,1])
                        .moveTo(FLOOR_PLAN_PIVOT_POINT)
                        .move(-DEPTH*1.5, -HEIGHT/2-DEPTH/2-2000)
                        .rotateZ(-120);

    isoRightBack = allVisible.iso([1,1,1])
                    .moveTo(FLOOR_PLAN_PIVOT_POINT)
                    .move(DEPTH*1.5, -HEIGHT/2-DEPTH/2-2000)
                    .rotateZ(180);

    floorplanRect = floorplan.bbox().rect()
    floorplanRect.autoDim();
    floorplanWithDrawings = collection(
        floorplan, floorplanRect,
        elevationFront, elevationLeft, elevationRight, elevationBack,
        isoRightFront, isoRightBack
        );
}

//docPipeline();

$pipeline('techdraw', 
  function()
  {
    docPipeline();
  }
);

doc
    .create('spec')
    .page('spec')
    .pipeline(docPipeline)
    .titleblock({
        title: 'URHOUSE',
        designer: 'URBUILD'
    })
    .text('Your own URHOUSE', { size: '1.2cm'})
    .position(0,1)
    .text('Sketch design', { size: '0.7cm'})
    .position(0,0.92)
    .view('isobig')
    .shapes('isoLeftFront')
    .width(0.4)
    .height(0.7)
    .pivot([0,1])
    .position(0,0.86)
    .text('Specifications', { size: '0.7cm' })
    .position(0,0.26)
    .table('stats', { fontsize: 7 })
    .width(0.3)
    .height(0.3)
    .position(0,0.2)
    .table('areas', { fontsize: 7 })
    .width(0.3)
    .height(0.3)
    .position(0.35,0.2)
    // floor plan and elevations
    .view('floorplanWithDrawings')
    .shapes('floorplanWithDrawings')
    .width(0.6)
    .height(0.75)
    .pivot(1,1)
    .position(1,1)















