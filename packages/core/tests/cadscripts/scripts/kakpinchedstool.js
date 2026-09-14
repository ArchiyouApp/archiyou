// kakpinchedstool
// Stool by KAK

$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 480, minimum: 300, maximum: 1000, multipleOf: 1 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "mm", order: 0, default: 270, minimum: 200, maximum: 500, multipleOf: 1 });
$PARAMS.define('LEG_WIDTH', 'number', { label: "Leg width", units: "mm", order: 0, default: 45, minimum: 40, maximum: 100, multipleOf: 1 });
$PARAMS.define('LEG_THICKNESS', 'number', { label: "Leg thickness", units: "mm", order: 0, default: 13, minimum: 10, maximum: 25, multipleOf: 1 });

// Archiyou 0.3

STOOL_HEIGHT = $HEIGHT;
BEAM_THICKNESS = $LEG_THICKNESS;
BEAM_WIDTH = $LEG_WIDTH;  // Leg size

STOOL_DEPTH = $DEPTH; // mostly 3*90, but let's make this independant
SEAT_PLANK_SIZE = BEAM_WIDTH*2;
SEAT_FILLET = BEAM_THICKNESS*2;

INSET = 60;  // inset leg from edge top
OUTSET = 6; // outset leg from edge bottom

// Calculated

STOOL_HEIGHT_WITHOUT_SEAT = STOOL_HEIGHT-BEAM_THICKNESS;
BEAM_THICKNESS_HALF = BEAM_THICKNESS/2;

layer('diagram').color('blue');

STOOL_DEPTH_DIAG = STOOL_DEPTH * Math.sqrt(2);

// Interactive dimension lines
line(
    [-STOOL_DEPTH_DIAG/2, 0,0],
    [-STOOL_DEPTH_DIAG/2, 0,STOOL_HEIGHT]
).hide().dimension({ offset: -40 }).bindParam('HEIGHT')


diagramOutline = planebetween(
                    [-STOOL_DEPTH_DIAG/2,0],[STOOL_DEPTH_DIAG/2,STOOL_HEIGHT_WITHOUT_SEAT])
    .rotateX(90, [0,0,0])
    .hide()
    .toMesh()
    .edges();

diagLineLeft = diagramOutline.select('E||left'); // bug in side selector
diagLineLeftTop = diagLineLeft.select('V||top'); // bug in side selector
diagLineLeftBottom = diagLineLeft.select('V||bottom');  // bug in side selector
diagLineCenterBottom = line(diagLineLeftBottom,diagLineLeftBottom.copy().move(STOOL_DEPTH_DIAG))
                            .copy().moveZ(STOOL_HEIGHT/2-BEAM_WIDTH);

diagLineCenterTop = diagLineCenterBottom.copy().moveZ(BEAM_WIDTH)


layer('leg').color('green');

legLineDirect = line(diagLineLeftBottom.copy().move(-OUTSET), diagLineLeftTop.copy().move(INSET)).hide();
legLineBendPoint = diagLineCenterBottom.intersection(legLineDirect).hide(); // two open Curves cross in a Vertex

legLine = polyline([
                    diagLineLeftBottom.copy().move(-OUTSET).moveY(-BEAM_THICKNESS_HALF), 
                    legLineBendPoint,
                    diagLineLeftTop.copy().move(INSET)
                    ])

leg = legLine.extrude(BEAM_THICKNESS, [0,1,0])
        .polygons() // Mesh has no extrude(): extrude its planar faces into solids
        .extrude(BEAM_WIDTH, [1,0,0])
        .hide()
        .union() // turn two parts into one (already a single Mesh)
        .color('green') // bug
        .cutoff('x',-STOOL_DEPTH_DIAG/2)
        .moveY(BEAM_THICKNESS_HALF) // center on diagram
        .cutoff('x', -1.5*BEAM_THICKNESS); // make sure legs don't overlap when LEG_WIDTH is large

layer('horizontals').color('red');

legLineCutTop = diagLineCenterTop.intersection(legLineDirect).hide(); // two open Curves cross in a Vertex

horizontalMiddle = polyline(
    legLineBendPoint,
    point(-legLineBendPoint.x, legLineBendPoint.y, legLineBendPoint.z), // Point has no mirrorX()
    point(-legLineCutTop.x, legLineCutTop.y, legLineCutTop.z),
    legLineCutTop
).toFace()
    .extrude(BEAM_THICKNESS)
    .moveY(BEAM_THICKNESS_HALF); // center on diagram

horizontalMiddleCrossed = horizontalMiddle.copy().rotateZ(90);

// Middle horizontal cross slits
horizontalMiddle.subtract(
        box(BEAM_THICKNESS,100,BEAM_WIDTH).moveZ(legLineCutTop.z).hide());
horizontalMiddleCrossed.subtract(
    box(BEAM_THICKNESS,100,BEAM_WIDTH).moveZ(legLineBendPoint.z).rotateZ(90).hide());

// Seat horizontals
horizontalSideEdge = line(legLineBendPoint,legLineCutTop)
                        .align(legLine.end(), 'righttop', 'center');

horizontalSeat = horizontalSideEdge.copy().loft(horizontalSideEdge.copy().mirrorX(0))
                    .extrude(BEAM_THICKNESS)
                    .moveY(-BEAM_THICKNESS_HALF)

horizontalSeatCrossed = horizontalSeat.copy().rotateZ(90);

// Cross laps
horizontalSeat.subtract(
        box(BEAM_THICKNESS,100,BEAM_WIDTH).moveZ(horizontalSeat.center().z + BEAM_WIDTH/2)
        .hide());
horizontalSeatCrossed.subtract(
    box(BEAM_THICKNESS,100,BEAM_WIDTH).rotateZ(90).moveZ(horizontalSeat.center().z - BEAM_WIDTH/2)
    .hide());


// Assemble the parts into stool
layer('assembly').color('green')
legsLeft = collection(leg, leg.copy().mirrorX(0)) // NOTE: still bug with clone - no big improvement anyway
legsRight = legsLeft.copy().rotateZ(180, [0,0,0]);
legsLeftRight = collection(legsLeft, legsRight).color('green');
legsFrontBack = legsLeftRight.copy().rotateZ(90, [0,0,0]).color('green');

layer('seat').color('blue')
/* 
    We take a different approach as original KAK design
    - Make leg width (BEAM_WIDTH) leading
    - Set seat plank size BEAM_WIDTH*2
    - make seat size independent - cut of planks at ends if needed
    - TODO: make seat plank size an input too?
*/

seatNumPlanks = Math.ceil(STOOL_DEPTH/SEAT_PLANK_SIZE);
seatPlankCuttedSize = SEAT_PLANK_SIZE - Math.abs(STOOL_DEPTH-seatNumPlanks*SEAT_PLANK_SIZE)/2;

seatPlanks = collection();

curPlankStart = 0;

new Array(seatNumPlanks).fill(null).forEach((n,i,arr) => 
{
    // Need to define new variable here, otherwise it becomes global
    let curPlankSize = (i === 0 || i === (arr.length - 1)) ? 
                        seatPlankCuttedSize : SEAT_PLANK_SIZE
    
    curPlankStart += curPlankSize/2; // move current plank

    seatPlanks.add(
                box(curPlankSize, STOOL_DEPTH, BEAM_THICKNESS)
                  .moveX(curPlankStart))

    curPlankStart += curPlankSize/2; // set cursor for next plank
      
})

// Fillet first and last plank
// TODO: the mesh kernel has no fillet() on solids yet - left out for now

filletSize = (SEAT_FILLET >= seatPlankCuttedSize)
    ? seatPlankCuttedSize-1 : SEAT_FILLET;

// Rotate seat into place
seatPlanks.moveTo([0,0,STOOL_HEIGHT-BEAM_THICKNESS/2])
    .rotateZ(45)
    //.moveZ(300)



stool = all().onlyVisible().filter( s => s.type === 'Solid');

allSamePlanks = seatPlanks.every(plank => plank.bbox().width() === seatPlanks.first().bbox().width());
section = `${BEAM_THICKNESS}x${BEAM_WIDTH}`;
legLength = Math.round(
            legLineDirect.extrude(BEAM_WIDTH, [1,0,0]).extrude(10).hide() // bug workaround
            .cutoff('x', diagLineLeftTop.x)
            .select('F||front')
            .copy()
            .layflat()
            .hide()
            .bbox().depth()) + 1; // Some bug


horMiddleLength = Math.round(horizontalMiddle.bbox().width());
horTopLength = Math.round(horizontalMiddle.bbox().width());
plankLength =  Math.round(seatPlanks.first().bbox().depth());
numSamePlanks = (allSamePlanks) ? seatPlanks.length : 2;
startPlankLength = Math.round(seatPlanks.at(1).bbox().depth());

PARTLIST_ROWS = [
    ['base', 'legs', section,legLength, 8, legLength*8 ],
    ['base', 'middle horizontals', section,  horMiddleLength , 2,  2*horMiddleLength ],
    ['base', 'top horizontals', section, horTopLength, 2,  2*horTopLength ],
    ['', '', section, '', 'TOTAL',  legLength*8 + 2*horMiddleLength + 2*horTopLength ],
    ['seat', (allSamePlanks) ? 'planks' : 'start & end plank', `${BEAM_THICKNESS}x${Math.round(seatPlankCuttedSize)}`, plankLength , numSamePlanks, numSamePlanks*plankLength ],
]

if(seatPlanks.length > 2 && !allSamePlanks)
{
    PARTLIST_ROWS.push(['seat', 'middle planks', `${BEAM_THICKNESS}x${SEAT_PLANK_SIZE}`,startPlankLength , seatPlanks.length - 2, (seatPlanks.length - 2) * startPlankLength])
}

calc.table('parts', PARTLIST_ROWS, ['part', 'subpart', 'section', 'length', 'quantity', 'total length']);

WOOD_COST_EUR_PER_M3 = 2500; // consumer pricing for small timber
//calc.metric('wood volume', Math.round(stool.volume()/1e6), { 'unit' : 'dm3'});
calc.metric('material cost EST', Math.round(stool.volume()/1e9*WOOD_COST_EUR_PER_M3), { unit: 'EUR' });

//// DOC PIPELINE ////

 
function docFunc()
{
    // Isometry
    seatPlanks.moveZ(300);
    iso = all().onlyVisible().solids().iso([1,0.5,1]) // BUG: seatPlanks reference does not work after stool is created
            .move(2000)
            .rotateZ(180+10);
    seatPlanks.moveZ(-300);
    // Parts layout

    layer('parts').color('blue')

    leg2DOrig = legLineDirect
            .extrude(BEAM_WIDTH, [1,0,0])
            .extrude(10) // bug workaround
            .cutoff('x', diagLineLeftTop.x)
            .cutoff('x', -1.5*BEAM_THICKNESS) // make sure legs don't overlap when LEG_WIDTH is large
            .select('F||front')
            .copy();

    leg2D = leg2DOrig.copy()
            //.layflat()
            .rotateX(90)
            .rotateZ(legLineDirect.direction().angleY())
            .moveTo(0,0,0)
            .move(0,-2000)
            .rotateZ(90)
            .rotateY(180) // flip for better visibility

    horMiddle2D = horizontalMiddle
        .copy()
        .layflat()
        .hide()
        .copy().flatten()
        .move(BEAM_WIDTH*4,-2000);

    horMiddle2D.moveY((leg2D.bbox().depth() - horMiddle2D.bbox().depth())/2); // align top

    horMiddleCrossed2D = horizontalMiddleCrossed
        .copy()
        .layflat()
        .hide()
        .copy().flatten()
        .move(BEAM_WIDTH*8,-2000);
    horMiddleCrossed2D.moveY((leg2D.bbox().depth() - horMiddleCrossed2D.bbox().depth())/2);

    horSeat2D = horizontalSeat.copy()
        .layflat().hide()
        .copy().flatten()
        .move(BEAM_WIDTH*12,-2000)

    horSeat2D.moveY((leg2D.bbox().depth() - horSeat2D.bbox().depth())/2);
    
    horSeatCrossed2D = horizontalSeatCrossed
        .copy().layflat().hide()
        .copy().flatten()
        .rotateZ(-90)
        .move(BEAM_WIDTH*16,-2000);
    horSeatCrossed2D.moveY((leg2D.bbox().depth() - horSeatCrossed2D.bbox().depth())/2);

    seat2D = seatPlanks.map(p => p.copy().flatten().moveToZ(0))
                .addToScene()
                .move(BEAM_WIDTH*22, -2000)
                .rotateZ(-45);
    seat2D.moveY((leg2D.bbox().depth() - seat2D.bbox().depth())/2);

    seat2D.first().bbox().left().dim()
    seat2D.forEach( plank => {
        plank.bbox().front().dim();
    })

    // Group all parts to layout on page
    docParts = collection(leg2D, 
                    horMiddle2D, 
                    horMiddleCrossed2D, 
                    horSeat2D, 
                    horSeatCrossed2D,
                    seat2D
                    ).lineWidth(0.6); // slightly bigger line than normal

    layer('part annotations').color('grey')

    DIM_OPTIONS = { offset: 20 };
    leg2D.autoDim(DIM_OPTIONS);
    horMiddle2D.autoDim(DIM_OPTIONS);
    horMiddleCrossed2D.autoDim(DIM_OPTIONS);
    horSeat2D.autoDim(DIM_OPTIONS);
    horSeatCrossed2D.autoDim(DIM_OPTIONS);

    // section with important offsets
    leg2DOrig = legLineDirect
            .extrude(BEAM_WIDTH, [1,0,0])
            .extrude(10) // bug workaround
            .cutoff('x', diagLineLeftTop.x)
            .cutoff('x', -1.5*BEAM_THICKNESS) // make sure legs don't overlap when LEG_WIDTH is large
            .select('F||front')
            .copy();
    leg2DOrigRight = leg2DOrig.copy().mirrorX(0);

    section = collection(leg2DOrig,leg2DOrigRight,horizontalMiddle, horizontalSeat)
    flatSection = section.copy().flatten().moveX(-1000).color('green')
    flatSection.rotateX(-90).moveToZ(0)

    dimWidth = new Edge().makeLine(
                flatSection.first().select('E||front').select('V||left'),
                flatSection.at(1).select('V||front').first()
            ).dim()
    dimMidOffset = new Edge().makeLine(
                flatSection.at(3).select('E||left').select('V||back'),
                flatSection.at(2).select('E||left').select('V||back') // middle
            ).dim()

}

// docFunc();


//// DOC ////

doc
.name('spec')
.page('spec')
.pipeline(docFunc)
.titleblock({ title: 'Pinched Stool', designer: 'KAK' })
.view('parts')
.shapes('docParts')
.width(1)
.height(1)
.position(0,1)
.table('parts', { fontsize: 7} )
.width(0.3)
.height(0.22) // auto height based on content not working
.pivot(0,0)
.position(0.45,0)
.view('iso')
.shapes('iso')
.pivot(0,0)
.position(0.12,0)
.width(0.15)
.height(0.4) 
.view('section')
.shapes('flatSection')
.position(0.27,0.0)
.pivot(0,0)
.width(0.15)
.height(0.35)

//// FOR REPRESENTATION ////
layer('diagram').shapes().hide();

// FOR ANIMATION EXPORT //
/*
all().hide()
stool.copy().rotateZ(30)
*/

