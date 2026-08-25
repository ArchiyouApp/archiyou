// strawwall
// Straw wall in variety of European systems

$PARAMS.define('LENGTH', 'number', { label: "Length", units: "cm", order: 0, default: 300, minimum: 100, maximum: 400, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "cm", order: 0, default: 200, minimum: 100, maximum: 300, multipleOf: 1 });
$PARAMS.define('SYSTEM', 'options', { label: "System", order: 0, default: "RFCP-2", options: ["RFCP-2","FASBA","RFCP-1-front","RFCP-1-back"] });
$PARAMS.define('BALE_THICKNESS', 'number', { label: "Bale depth", units: "mm", order: 0, default: 370, minimum: 300, maximum: 500, multipleOf: 1 });
$PARAMS.define('BALE_WIDTH', 'number', { label: "Bale width", units: "mm", order: 0, default: 470, minimum: 300, maximum: 500, multipleOf: 1 });
$PARAMS.define('BALE_LENGTH', 'number', { label: "Bale length", units: "mm", order: 0, default: 600, minimum: 300, maximum: 800, multipleOf: 1 });
$PARAMS.define('BEAM_SECTION_AUTO', 'boolean', { label: "Beam section automatic", order: 0, default: true });
$PARAMS.define('BEAM_SECTION_WIDTH', 'number', { label: "Beam section width", units: "mm", order: 0, default: 35, minimum: 30, maximum: 70, multipleOf: 1 });
$PARAMS.define('BEAM_SECTION_HEIGHT', 'number', { label: "Beam section height", units: "mm", order: 0, default: 70, minimum: 70, maximum: 150, multipleOf: 1 });
$PARAMS.define('HIDE_BALES', 'boolean', { label: "Hide bales", order: 0, default: false });

// Archiyou 0.6.3

/*
    Basic straw wall
    
    based on load baring systems developed by:
    - rfcp.fr: double stud, single stud inside, single stud outside
    - fasba.de: full depth stud with double bale

    IMPORTANT: Consider stability of wall in all direction. Add board of diagonals where needed!

 */
//// PARAMS


WALL_LENGTH = $LENGTH*10;
WALL_HEIGHT = $HEIGHT*10;

STRAW_BALE_THICKNESS = $BALE_THICKNESS;
STRAW_BALE_WIDTH = $BALE_WIDTH;
STRAW_BALE_LENGTH = $BALE_LENGTH;

BOARD_THICKNESS = 18; // OSB3

STRAW_BALE_TIGHTFIT_INSET_PER_BALE = 5; // to ensure strawbales fit tightly between studs

BRACES_MID_MIN_STUDHEIGHT = 1500;


SYSTEM_PARAMS = {
    'RFCP-2': { balesPerSegment: 1, doubleStuds: true, studAlign: false, beamSectionWidth:30, beamSectionHeight:70  },
    'RFCP-1-mid': { balesPerSegment: 1, doubleStuds: false, studAlign: 'middle', beamSectionWidth:30, beamSectionHeight:70 },
    'RFCP-1-front': { balesPerSegment: 1, doubleStuds: false, studAlign: 'front', beamSectionWidth:30, beamSectionHeight:70 },
    'RFCP-1-back': { balesPerSegment: 1, doubleStuds: false, studAlign: 'front', beamSectionWidth:30, beamSectionHeight:70 },
    'FASBA': { balesPerSegment: 2, doubleStuds: false, studAlign: 'middle', studFullDepth: true, beamSectionWidth:40},
}

SYSTEM = SYSTEM_PARAMS[$SYSTEM];

BEAM_SECTION_WIDTH = $BEAM_SECTION_AUTO ? SYSTEM.beamSectionWidth : $BEAM_SECTION_WIDTH;
BEAM_SECTION_HEIGHT = $BEAM_SECTION_AUTO ? SYSTEM.beamSectionHeight : $BEAM_SECTION_HEIGHT;
$PARAMS.BEAM_SECTION_WIDTH.visibleIf(!$BEAM_SECTION_AUTO);
$PARAMS.BEAM_SECTION_HEIGHT.visibleIf(!$BEAM_SECTION_AUTO);

BOARD_SIDES = !($SYSTEM == 'FASBA');
BOARD_PLATES = !($SYSTEM == 'FASBA');


//// MODEL

layer('bottomplate').color('green');


bottomPlateLength = WALL_LENGTH - (BOARD_SIDES * 2 * BOARD_THICKNESS);
bottomPlateSideBoardOffset = BOARD_SIDES*BOARD_THICKNESS;
bottomPlateDepth = studDepth = (SYSTEM.studFullDepth) ? $BALE_THICKNESS : BEAM_SECTION_HEIGHT;

// Boards that tie together the two blades (if any)
if(BOARD_PLATES)
{
// We make the board the same length as the wall for easy layout on site
bottomPlateBoard = boxbetween(
        [0,0,0], 
        [WALL_LENGTH, STRAW_BALE_THICKNESS, BOARD_THICKNESS])
        .color('brown')
        .name('bottom board')
}

studDistanceDepth = STRAW_BALE_THICKNESS-BEAM_SECTION_HEIGHT;

bottomPlateFront = boxbetween([0,0,0],[bottomPlateLength,bottomPlateDepth,BEAM_SECTION_WIDTH])
                    .move(bottomPlateSideBoardOffset)
                    .name('bottom plate')
                    .moveZ(BOARD_PLATES * BOARD_THICKNESS)

if(SYSTEM.doubleStuds)
{
    bottomPlateBack = bottomPlateFront
                        .copy()
                        .moveY(studDistanceDepth)
                        .name('bottom plate back')
}

layer('studgrid').color('black');

gridline = line([0,-500,0],[0,500,0]).moveY(STRAW_BALE_THICKNESS/2)
                .move(BEAM_SECTION_WIDTH/2+bottomPlateSideBoardOffset)

studCTC = (SYSTEM.balesPerSegment*STRAW_BALE_WIDTH) - (SYSTEM.balesPerSegment*STRAW_BALE_TIGHTFIT_INSET_PER_BALE) + BEAM_SECTION_WIDTH;
numFullStuds = Math.floor( (bottomPlateLength-BEAM_SECTION_WIDTH) / (studCTC)) + 1;

gridlines = gridline.array([numFullStuds+1,1,1],[studCTC,0,0])

layer('studs').color('blue');

studHeight = WALL_HEIGHT-2*BEAM_SECTION_WIDTH-2*BOARD_THICKNESS*BOARD_PLATES; // BOARD_PLATES = 0 if none
studDepth = (SYSTEM.studFullDepth) ? $BALE_THICKNESS : BEAM_SECTION_HEIGHT;

studFront = boxbetween([0,0,0],[BEAM_SECTION_WIDTH,studDepth, studHeight])
        .move(bottomPlateSideBoardOffset)
        .moveZ((BOARD_PLATES*BOARD_THICKNESS)+BEAM_SECTION_WIDTH)
        .name('stud')

// align according to system
if(SYSTEM.studAlign === 'middle')
{
    studFront.moveToY(STRAW_BALE_THICKNESS/2);
    bottomPlateFront.moveToY(STRAW_BALE_THICKNESS/2);
}
if(SYSTEM.studAlign === 'back')
{
    studFront.moveToY(STRAW_BALE_THICKNESS-BEAM_SECTION_WIDTH/2)
}
    
studsFront = studFront.array([numFullStuds,1,1],[studCTC,0,0]);

if(SYSTEM.doubleStuds)
{
    studBack = studFront.copy().moveY(studDistanceDepth);
    studsBack = studsFront.copy().moveY(studDistanceDepth);
}

// Make stud if gridlines don't exactly add up to length of wall
if(numFullStuds*studCTC+BEAM_SECTION_WIDTH != bottomPlateLength)
{
    lastStudFront = studFront.copy().align(bottomPlateFront, 'frontrightbottom', 'frontrighttop').color('purple')
    studsFront.add(lastStudFront);
    if(SYSTEM.doubleStuds)
    {
        lastStudBack = lastStudFront.copy().moveY(studDistanceDepth).color('purple');
        studsBack.add(lastStudBack);
    }
}

// Side boards if flag BOARD_SIDES
if(BOARD_SIDES)
{
    layer('sideboards').color('brown')
    sideBoardLeft = boxbetween([0,0,0],[BOARD_THICKNESS, STRAW_BALE_THICKNESS, WALL_HEIGHT-2*BOARD_THICKNESS])
                        .moveZ(BOARD_THICKNESS)
                        .name('side board')
    sideBoardRight = sideBoardLeft.copy().move(WALL_LENGTH-BOARD_THICKNESS)  
                        .name('side board')
}

// Top plate
layer('topplate')
topPlateShapes = layer('bottomplate')
        .shapes()
        .copy()
        .mirrorZ(WALL_HEIGHT/2)

if(BOARD_PLATES) topPlateShapes.first().color('brown');

// Braces make the structure stable in along the depth direction
// Only with system RFCP-2
if(SYSTEM.doubleStuds)
{
    layer('braces').color(100,0,0)
    braceLeftBottom = box(BEAM_SECTION_WIDTH, STRAW_BALE_THICKNESS-2*BEAM_SECTION_HEIGHT, BEAM_SECTION_HEIGHT)
                            .align(bottomPlateFront, 'leftbottomfront', 'leftbottomback')
                            .name('stud brace')

    bracesBottom = braceLeftBottom.array([numFullStuds,1,1],[studCTC,0,0])
    // Last brace
    if(numFullStuds < studsFront.length)
    {
        lastBraceBottom = braceLeftBottom.copy()
                .align(bottomPlateFront, 'rightfrontbottom', 'rightbackbottom');
        bracesBottom.add(lastBraceBottom);
    }
    if(studHeight > BRACES_MID_MIN_STUDHEIGHT )
    {
        bracesMid = bracesBottom.copy().moveZ(studHeight/2);
    }
    bracesTop = bracesBottom.copy()
        .mirrorZ(studFront.center().z);
}

// Show some bales as example
layer('bales').color('yellow')

realBaleWidth = STRAW_BALE_WIDTH-STRAW_BALE_TIGHTFIT_INSET_PER_BALE;

bale = boxbetween([0,0,0],[realBaleWidth, STRAW_BALE_THICKNESS, STRAW_BALE_LENGTH])
        .move(BEAM_SECTION_WIDTH+BOARD_THICKNESS*BOARD_SIDES, 0, BEAM_SECTION_WIDTH+BOARD_THICKNESS*BOARD_SIDES)
        .name('bale')

numWholeBalesStacked = Math.floor(studHeight / STRAW_BALE_LENGTH);
wholeBales = bale.array([1,1,numWholeBalesStacked],[0,0,STRAW_BALE_LENGTH])
brokeBale =  boxbetween([0,0,0],[realBaleWidth, STRAW_BALE_THICKNESS, studHeight - numWholeBalesStacked*STRAW_BALE_LENGTH])
                .align(wholeBales.last(), 'leftbottomfront', 'lefttopfront')
                .name('bale cut')

// Extra bale 
if(SYSTEM.balesPerSegment > 1)
{
    extraBale = bale.copy().move(bale.bbox().width())
}

if($HIDE_BALES)
{
    layer('bales').shapes().hide();
}

baseVolume = roundTo(STRAW_BALE_THICKNESS*STRAW_BALE_WIDTH*STRAW_BALE_LENGTH/1e9,2);
calc.metric('bale volume', baseVolume, { unit: 'm3' })
calc.metric('total bale volume', 
    roundTo((numFullStuds + 1) * ((realBaleWidth*studHeight*STRAW_BALE_THICKNESS)/1e9),2), { 'unit' : 'm3' } )
calc.metric('num bales', (wholeBales.length * SYSTEM.balesPerSegment + 1)*numFullStuds )

allTimberShapes = collection(layer('bottomplate').shapes(), layer('bottomplate').shapes(), 
                    layer('studs').shapes(), layer('braces').shapes())
                    .filter(s => s.bbox().minSize() > BOARD_THICKNESS)

// allTimberShapes.copy().moveY(-1000).color('red'); // test if we got all the right volumes
calc.metric('timber volume', TIMBER_VOLUME = roundTo(allTimberShapes.volume()/1e9,2), { unit: 'm3' });
calc.metric('timber volume/length', roundTo(TIMBER_VOLUME/(WALL_LENGTH*1e-3),2), { unit: 'm3/m' })


//// DOC

function docPipeline()
{
    visibleShapes = all().onlyVisible();
    iso = visibleShapes.iso().move(WALL_LENGTH*2);
    frontElevation = visibleShapes.elevation('front')
                        .move(WALL_LENGTH*2, -WALL_HEIGHT*2)
                        .autoDim({ 
                            levels: [
                                { axis: 'y', at: 0.5, offset: 200 },
                                { axis: 'x', at: 0.1, offset: 200 }
                            ]
                        })
    frontElevation.bbox().right().dim({ offset: 200 });
    frontElevation.bbox().front().dim({ offset: 200 });
}

$pipeline('techdraw', 
  function()
  {
    docPipeline();
  }
);


// TODO: table 'parts' needs to be evaluated later
make.partList(all().onlyVisible(), 'parts')


doc
    .create('spec')
    .page('spec')
    .pipeline(docPipeline)
    .titleblock({ title: 'Straw Wall', designer: 'Archiyou' })
    .view('iso')
    .shapes('iso')
    .height(0.6)
    .width(0.6)
    .view('elevation')
    .shapes('frontElevation')
    .width(0.6)
    .height(0.6)
    .pivot(0,1)
    .position(0.4,1)
    .text(`System: ${$SYSTEM}`, { size: '5mm' })
    .position(0.8,0.3)
    .table('parts', { 'fontsize': 6 })
    .width(0.6)
    .position(0,0.35);


    

