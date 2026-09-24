// urhousesketch
// Sketch design for URHOUSE

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "mm", order: 0, default: 4000, minimum: 2000, maximum: 10000, multipleOf: 10 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 5000, minimum: 2000, maximum: 10000, multipleOf: 10 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "mm", order: 0, default: 5000, minimum: 2000, maximum: 30000, multipleOf: 10 });
$PARAMS.define('ROOF_TYPE', 'options', { label: "Roof Type", group: 'roof', order: 0, default: "gable", options: ["gable","shed"] });
$PARAMS.define('ROOF_ANGLE', 'number', { label: "Roof Angle", group: 'roof', order: 0, default: 35, minimum: 10, maximum: 60, multipleOf: 1 });
$PARAMS.define('ROOF_RIDGE_AT_PERC', 'number', { label: "Ridge at perc", group: 'roof', order: 0, default: 50, minimum: 20, maximum: 80, multipleOf: 1 });
$PARAMS.define('ROOF_RIDGE_SLOPES_SAME', 'options', { label: "Ride slopes same", group: 'roof', order: 0, default: "angle", options: ["angle","height"] });
$PARAMS.define('OVERHANGS_SAME', 'boolean', { label: "Overhangs same", group: 'roof', order: 0, default: true });
$PARAMS.define('OVERHANG_SIZE', 'number', { label: "Overhangs Size", group: 'roof', units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_FRONT', 'number', { label: "Overhang Front", group: 'roof', units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_LEFT', 'number', { label: "Overhang Left", group: 'roof', units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_RIGHT', 'number', { label: "Overhang Right", group: 'roof', units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('OVERHANG_BACK', 'number', { label: "Overhang Back", group: 'roof', units: "mm", order: 0, default: 500, minimum: 0, maximum: 2000, multipleOf: 10 });
$PARAMS.define('MAIN_FACADE', 'options', { label: "Main Facade side", order: 0, default: "Front", options: ["Front","Left","Right","Back"] });
$PARAMS.define('GENERATE_OPENINGS', 'boolean', { label: "Openings", order: 0, default: true });


//$PARAMS.define('ENERGY_CALC', 'boolean', { label: "Energy calculation", group: 'energy', default: false });
//$PARAMS.define('ENERGY_AZIMUTH', 'number', { label: "azimuth", group:'energy', units: "deg", default: 0, minimum: 0, maximum: 360, multipleOf: 1 });

//// OPENINGS ////

$PARAMS.define('OPENINGS_AUTO_MODE', 'boolean', { default: true, label: 'automatic openings', 'group' : 'openings' });

$PARAMS.defineObject('Opening', {
    name:   'text',
    wall:   ['front','right','back','left'],
    left:   { type:'number', label:'From corner', min:0,   max:12000, step:1, default:1000, units:'mm' },
    sill:   { type:'number', label:'Sill',        min:0,   max:12000,  step:1, default:900,  units:'mm' },
    width:  { type:'number', label:'Width',       min:300, max:3000,  step:1, default:1200, units:'mm' },
    height: { type:'number', label:'Height',      min:300, max:3000,  step:1, default:1300, units:'mm' },
});

$PARAMS.define('OPENINGS', 'list', {
    of:    'Opening',
    label: 'Openings',
    group: 'openings',
    default: [],
});


//// PARAMS ////

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

// $PARAMS.ENERGY_AZIMUTH.visibleIf($ENERGY_CALC);

//// INTERACTIVE DIMENSION LINES ////

line([0,0,0],[WIDTH,0,0]).tmp().dim({ offset: 1000 }).param('WIDTH');
line([0,0,0],[0,DEPTH,0]).tmp().dim({ offset: -1000 }).param('DEPTH');


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
                        .copy().extendTo(line([0,0,-100000],[0,0,150000]).tmp());


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
                        ).hide()
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
// We take a data-first approach - first generating the data then the geometry (and do checks)

layer('openings').color('green');

newOpenings = [];

if($OPENINGS_AUTO_MODE)
{
    // front door
    newOpenings.push({ wall: 'front', name: 'Frontdoor', width: 1000, height: 2150, left: WIDTH/2-1000/2, sill: 0 });
    // back glazing
    newOpenings.push({ wall: 'back', name: 'SlidingdoorBack', width: 2000, height: 2150, left: WIDTH/2-2000/2, sill: 0 });

    // generate openings for side walls
    GF_HEIGHT = 3000;
    LEVEL_HEIGHT = 2500;
    LEVEL_HEIGHT_MIN = 1500;
    WINDOW_WIDTHS = [600,800,1000];
    WINDOW_HEIGHT_GF = 2000;
    WINDOW_HEIGHT_FL = 1000;
    WINDOW_LEVEL_SILL = 500;
    WINDOW_SPACINGS = [600,800,1200,1500];

    function generateWindows(wall, floor)
    {
      // floor 0=GF, 1=first floor
      // y is always the end of last window
      let y = 0;
      while(y < DEPTH-WALL_THICKNESS)
      {
          const randomWidth = WINDOW_WIDTHS[Math.floor(Math.random()*WINDOW_WIDTHS.length)];
          const randomSpacing = WINDOW_SPACINGS[Math.floor(Math.random()*WINDOW_SPACINGS.length)];
          const windowHeight = (floor === 0) ? WINDOW_HEIGHT_GF : WINDOW_HEIGHT_FL
          const sillHeight = (floor === 0) ? 0 : WINDOW_LEVEL_SILL;
        
          newWindowMaxY = y + randomSpacing + randomWidth;
          // last window exceeds, just remove
          if(newWindowMaxY < DEPTH-WALL_THICKNESS)
          {
            newOpenings.push(
              { 
                  wall: wall,           
                  //name: wall + floor,  
                  left: y + randomSpacing,
                  sill: sillHeight + (Math.max(0,floor))*LEVEL_HEIGHT, // from bottom of wall, not level
                  width: randomWidth, 
                  height: windowHeight 
              }
            )
          }
          else {
            break;
          }
          y = newWindowMaxY;
      }
    }

    // per wall generate windows, for a floor if there
    if(wallLeft.bbox().height() > GF_HEIGHT) generateWindows('left',0);
    numLevelsWallLeft = Math.floor((wallLeft.bbox().height() - GF_HEIGHT)/LEVEL_HEIGHT);
    // add one if last etage is bigger than LEVEL_HEIGHT_MIN
    if(wallLeft.bbox().height() - GF_HEIGHT - numLevelsWallLeft*LEVEL_HEIGHT > LEVEL_HEIGHT_MIN) numLevelsWallLeft++;
    
    if(numLevelsWallLeft > 0) new Array(numLevelsWallLeft).fill().forEach((n, fl) => generateWindows('left', fl+1));

    if(wallRight.bbox().height() > GF_HEIGHT) generateWindows('right', 0);
    numLevelsWallRight = Math.floor((wallRight.bbox().height() - GF_HEIGHT)/LEVEL_HEIGHT);
    if(wallRight.bbox().height() - GF_HEIGHT - numLevelsWallRight*LEVEL_HEIGHT > LEVEL_HEIGHT_MIN) numLevelsWallRight++;
    if(numLevelsWallRight > 0) new Array(numLevelsWallRight).fill().forEach((n, fl) => generateWindows('right', fl+1));
    
  
}

// Each wall seen from outside: `left` is measured from its left-hand corner, along the wall.
//   start   the left-hand corner on the outside face, at ground level
//   dir     the direction `left` runs in
//   axis    the world axis the wall runs along (what the handle is dragged along)
//   length  how long the wall is
WALL_NAME_TO_ORIENTATIONS = {
    front: { start: [0, 0, 0],         dir: [1, 0, 0],  axis: 'x', length: WIDTH, shape: wallFront },
    back:  { start: [WIDTH, DEPTH, 0], dir: [-1, 0, 0], axis: 'x', length: WIDTH, shape: wallBack },
    left:  { start: [0, DEPTH, 0],     dir: [0, -1, 0], axis: 'y', length: DEPTH, shape: wallLeft },
    right: { start: [WIDTH, 0, 0],     dir: [0, 1, 0],  axis: 'y', length: DEPTH, shape: wallRight },
};

function placeOpening(opening, i)
{
    const OPENING_MARGIN = 300;
    const FRAME_DEPTH = 100;                                   // how deep the frame goes into the wall
    const FRAME_THICKNESS = 100;                               // width of the frame members
    const FRAME_INSET = (WALL_THICKNESS - FRAME_DEPTH) / 2;    // centred in the wall
    const wall = WALL_NAME_TO_ORIENTATIONS[opening.wall] ?? WALL_NAME_TO_ORIENTATIONS.front;

    // A point on the wall: `along` from its left-hand corner, `up` from the ground.
    // vector() makes a fresh Vector each time: scale() and add() change the one they are called on
    const onWall = (along, up) => vector(wall.dir).scale(along).add(wall.start).add([0, 0, up]);

    // diagram rectangle
    const r = rectbetween(
                onWall(opening.left, opening.sill),
                onWall(opening.left + opening.width, opening.sill + opening.height));

    // TODO: protect against rectangle outside the wall
    // the hole in the wall
    const subBox = r.copy().extrude(1000).move(r.normal().reverse().scale(500));
    wall.shape.subtract(subBox.hide());

    // the frame: make.frame() builds it like one in the front wall, at the origin: along +x,
    // up +z and FRAME_DEPTH into the house (+y). Turn it about the origin until "along" is this
    // wall's dir (front 0°, right 90°, back 180°, left -90°); "into the house" turns with it.
    const angle = Math.atan2(wall.dir[1], wall.dir[0]) * 180 / Math.PI;
    const inward = [-wall.dir[1], wall.dir[0], 0];
    const frame = make.frame(opening.width, opening.height, FRAME_DEPTH, FRAME_THICKNESS)
        .rotateZ(angle, [0, 0, 0])                             // about the origin: a collection turns about its own centre by default
        .move(onWall(opening.left, opening.sill))
        .move(vector(inward).scale(FRAME_INSET));

    if(!$OPENINGS_AUTO_MODE)
    {
        // Where the handle (the middle of the opening) may go, measured along the wall
        const middleMin = opening.width/2 + OPENING_MARGIN;
        const middleMax = Math.max(middleMin, wall.length - opening.width/2 - OPENING_MARGIN);

        // ...and the same in world coordinates along the wall's axis, for range()
        const axisIndex = (wall.axis === 'x') ? 0 : 1;
        const [a, b] = [onWall(middleMin, 0), onWall(middleMax, 0)].map(v => v.toArray()[axisIndex]);

        // Dragging towards +x/+y adds to `left` when the wall runs that way, and takes off when not
        const sign = wall.dir[axisIndex];

        const middle = onWall(opening.left + opening.width/2, opening.sill + opening.height/2);

        $handle()
            .minimized()
            .param(`OPENINGS[${i}]`, (param, handle) => { param.left += sign * handle.du; }, { sign })
            .at(middle.x, middle.y, middle.z)
            .along(wall.axis)
            .range(Math.min(a, b), Math.max(a, b));
    }

    return { rect: r, frame };
}

openings = ($OPENINGS_AUTO_MODE) ? newOpenings : $OPENINGS;

openingShapes = openings.map((o,i) => placeOpening(o,i));

openingsGroundFloor = collection(
    ...openingShapes
        .filter((shapes, i) => openings[i].sill < GROUNDFLOOR_HEIGHT)
        .map(shapes => shapes.frame));

if($OPENINGS_AUTO_MODE)
{
  // auto mode: script own the openings. update.
  $PARAMS.OPENINGS.set(openings, { rerun: false });
}


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


/*
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

*/

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
    wallsCombinedSection = collection(
            ...[wallLeft, wallFront, wallRight, wallBack].map(w =>
                w.copy().subtract(box(WIDTH*2,DEPTH*2,HEIGHT).moveZ(HEIGHT/2+1500).hide())))
        .merge()

    floorplan = collection(wallsCombinedSection,openingsGroundFloor)
        .flatten()
        .moveTo(FLOOR_PLAN_PIVOT_POINT);

    //wallsCombinedSection.hide(); // don't show in model

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
        //isoRightFront, isoRightBack
        );

    return { isoLeftFront, floorplanWithDrawings };
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
