// gardenchair
// KAK triangular garden chair

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "mm", order: 0, default: 525, minimum: 400, maximum: 1200, multipleOf: 1 });
$PARAMS.define('BEAM_WIDTH', 'number', { label: "Beam Width", order: 0, default: 90, minimum: 60, maximum: 120, multipleOf: 1 });
$PARAMS.define('BEAM_THICKNESS', 'number', { label: "Beam Thickness", units: "mm", order: 0, default: 13, minimum: 13, maximum: 40, multipleOf: 1 });

// Archiyou 0.3

//// SETTINGS ////

WIDTH = $WIDTH

BEAM_WIDTH = $BEAM_WIDTH;
BEAM_THICKNESS = $BEAM_THICKNESS;

BASE_DEPTH = 690; // depth of chair from base, without last support beam
BASE_HEIGHT = 350;

SEATING_ANGLE = 3;
SEATING_ANGLE_BACK = 18;
SEATING_DEPTH = 500;
SEATING_DEPTH_OVERHANG = 150;
SEATING_BACK_LENGTH = 450;

SEAT_PLANK_OVERHANG = BEAM_THICKNESS;
SEAT_PLANK_SPACING = 5;
BACK_SIZE = 300

BEAM_DEPTH_FROM_FLOOR = 15;
FRONT_BEAM_START_FROM_SEAT_BOTTOM = BEAM_THICKNESS;

layer('diagram').color('blue');

// Seating angles

diagramBaseLine = polyline(
        [0,0,BASE_HEIGHT],
        [0,0,0],
        [0,BASE_DEPTH,0]
)
diagramBaseFrontLine = diagramBaseLine.edges()[0];
diagramBaseBottomLine = diagramBaseLine.edges()[1];

diagramSeatLines = sketch('right')
                        .moveTo(0,BASE_HEIGHT)
                        .lineTo(`${SEATING_DEPTH-SEATING_DEPTH_OVERHANG}<-${SEATING_ANGLE}`)
                        .lineTo(`${SEATING_BACK_LENGTH}<<${90-SEATING_ANGLE_BACK}`)
                        .end();

diagramSeatBaseLine = diagramSeatLines.edges()[0];
diagramBackLine = diagramSeatLines.edges()[1];

diagramBackSupportLine = line(
                                diagramBackLine.middle(), 
                                diagramBaseLine.edges().at(1).end()
                        );

diagramSeatLine = diagramSeatBaseLine.copy()
        .extendTo(diagramBackSupportLine.color('red'))
        .extend(SEATING_DEPTH_OVERHANG, 'start')
        .color('yellow') // full extended line

layer('diagram').shapes().hide(); // hide diagram

layer('side').color('green');

sideBackSupportCutoffLine =  diagramBackSupportLine
                                .copy()
                                .move(
                                        diagramBackSupportLine
                                                .direction()
                                                .normalize()
                                                .copy()
                                                .scale(BEAM_WIDTH)
                                                .rotateX(90)
                                ).extend(100, 'end').hide()

sideSeatingBeam = diagramSeatLine.copy().extend(300, 'end')
                .extrude(BEAM_WIDTH, diagramSeatLine.direction().rotateX(-90))
                .cutoffBy(sideBackSupportCutoffLine)

// Curve x planar-Mesh intersection returns nothing for a zero-volume shape,
// so intersect the beam's boundary edges directly and take the lowest hit
sideSeatingBeamBottomHit = sideSeatingBeam.edges().toArray()
                        .map(e => diagramBaseFrontLine.intersections(e))
                        .filter(hits => hits)
                        .flatMap(hits => hits.toArray().map(v => v.hide())) // Vertices where they cross
                        .sort((a,b) => a.z - b.z)[0]

sideSeatingCutoffLine = line(
                        sideSeatingBeam.select('E||front').center(),
                        sideSeatingBeamBottomHit)

sideSeatingBeam.cutoffBy(sideSeatingCutoffLine); 
        //.extrude(BEAM_THICKNESS) // wait for extrusion

sideSeatingBeamLongitudinalBeamStart = sideSeatingBeam.select('E||back').select('V||top')

sideBackBeam = diagramBackLine.copy().extendTo(
                        sideSeatingBeam.select('E||bottom')
                )
                .extrude(BEAM_WIDTH, diagramBackLine.direction().rotateX(-90))
                .cutoffBy(sideSeatingBeam.select('E||bottom'))

sideBackCutoffLine = line(
                        sideBackBeam.select('E||top').middle().copy().moveZ(50),
                        sideBackBeam.select('E||top').middle().copy().moveZ(-1000))
                        .hide();
                        
sideBackBeam.cutoffBy(sideBackCutoffLine);                  
sideBackSupportBeam = diagramBackSupportLine
                        .copy().extend(400, 'start')
                        .extend(400, 'end')
                        .extrude(BEAM_WIDTH, diagramBackSupportLine.direction().normalize().rotateX(90))
                        .cutoffBy(diagramBackLine)
                        .cutoff('z',0)

sideLegFront = diagramBaseFrontLine
                .extrude(BEAM_WIDTH, [0,1,0])
                .cutoffBy(diagramSeatLine)

sideBeamDepth = planebetween(
                        [0,0,BEAM_DEPTH_FROM_FLOOR],
                        [0,1000,BEAM_DEPTH_FROM_FLOOR+BEAM_WIDTH] // whatever size - will be cut of
                )
                .cutoffBy(
                                diagramBackSupportLine
                                .copy().move(
                                        diagramBackSupportLine
                                                .direction()
                                                .normalize()
                                                .scaled(BEAM_WIDTH)
                                                .rotateX(90)
                                ).extend(100, 'end').hide()
                        ) 

// Save 2D for later
side2D = collection(sideSeatingBeam.edges(), 
                        sideBackBeam.edges(), 
                        sideBeamDepth.edges()).hide()
                        // NOTE: keep sideLegFront and sideBackSupportBeam for layer because we need to cut off some things


// extude all parts now
sideSeatingBeam = sideSeatingBeam.hide().extrude(BEAM_THICKNESS, [1,0,0]) // update refs here too
sideBackBeam = sideBackBeam.hide().extrude(BEAM_THICKNESS, [1,0,0])
sideBackSupportBeam = sideBackSupportBeam.hide().extrude(BEAM_THICKNESS, [-1,0,0])
sideBeamDepth = sideBeamDepth.extrude(BEAM_THICKNESS, [1,0,0]);
sideLegFront = sideLegFront.extrude(BEAM_THICKNESS, [-1,0,0]);

// intersection() is non-replacing: sideSeatingBeam stays as it is and the shared volume
// comes back as a new Mesh
sideSeatingBeamPadding = sideSeatingBeam.intersection(sideBackBeam) // pad seat beam
sideSeatingBeamPadding.moveX(-BEAM_THICKNESS)
sideBackBeam.moveX(-BEAM_THICKNESS*2);

side = collection(sideSeatingBeam,sideBackBeam,
                sideBackSupportBeam, sideBeamDepth, sideLegFront);

//// LONGITUDINAL BEAMS

layer('longitudinal').color('red')

longBeamFrontStart = sideSeatingCutoffLine.end()
                        .copy().tmp()
                        .moveZ(-FRONT_BEAM_START_FROM_SEAT_BOTTOM-BEAM_WIDTH)
                        
longBeamFront = planebetween(
        longBeamFrontStart,
        longBeamFrontStart.copy().move(0, BEAM_THICKNESS, BEAM_WIDTH)
).extrude(WIDTH-2*BEAM_THICKNESS, [-1,0,0])

sideLegFront.subtract(longBeamFront);

longBeamBack = planebetween(
        sideSeatingBeamLongitudinalBeamStart,
        sideSeatingBeamLongitudinalBeamStart
                .copy().move(-WIDTH+2*BEAM_THICKNESS, 0, BEAM_WIDTH)
).rotateX(
        diagramBackSupportLine.direction().angle([0,-1,0])-90+180,
        sideSeatingBeamLongitudinalBeamStart
).extrude(-BEAM_THICKNESS)


sideBackSupportBeam.subtract(longBeamBack);

// Add to section2D for doc
side2D.add(sideLegFront.copy().flatten('x').edges());
side2D.add(sideBackSupportBeam.copy().flatten('x').edges());

//// SEAT ////
layer('seat').color('blue');

totalSeatDepth = SEAT_PLANK_OVERHANG 
                        + SEATING_DEPTH;
plankWithSpacing = BEAM_WIDTH+SEAT_PLANK_SPACING;

seatNumPlanks = Math.floor(totalSeatDepth/(plankWithSpacing));
seatPlanks = collection()
new Array(seatNumPlanks).fill()
        .forEach((v,i) => {
                /* WARNING: Using variable without let/const makes it global, 
                        so in ShapeCollection the reference is overwritten
                        Was causing bugs in some cases
                */
                // plank = box(WIDTH,BEAM_WIDTH,BEAM_THICKNESS) resulted in bugs
                seatPlanks.add(
                                box(WIDTH,BEAM_WIDTH,BEAM_THICKNESS)
                                .moveY(i*plankWithSpacing)
                        )
                        
        })

mp = point(seatPlanks.bbox().maxX(),seatPlanks.bbox().minY(), seatPlanks.bbox().minZ())
mv = diagramSeatLine
        .copy().tmp()
        .copy().extend(SEAT_PLANK_OVERHANG, 'start')
        .start().toVector().subtract(mp);

seatPlanks
        .move(mv)
       .rotateX(-SEATING_ANGLE, diagramSeatLine.start())
        .moveX(BEAM_THICKNESS)

//// BACK REST ////
backPlanks = collection();
backNumPlanks = Math.ceil(BACK_SIZE/plankWithSpacing)
new Array(backNumPlanks).fill()
        .forEach((v,i) => {
                let plank = box(WIDTH,BEAM_WIDTH,BEAM_THICKNESS) 
                        .moveY(i*plankWithSpacing)
                backPlanks.add(plank);
        })

mp = point(backPlanks.bbox().maxX(),backPlanks.bbox().maxY(), backPlanks.bbox().minZ())
diagramBackLineExt = diagramBackLine
        .copy()
        .extend(SEAT_PLANK_OVERHANG, 'end')
        .hide();
mv = diagramBackLineExt.end().toVector().subtract(mp)

backPlanks
        .move(mv)
        .rotateX(90-SEATING_ANGLE-SEATING_ANGLE_BACK, diagramBackLineExt.end())
        .moveX(BEAM_THICKNESS)

//// ASSEMBLY ////

layer('assembly').color('green')

side.copy().mirrorX((-WIDTH+2*BEAM_THICKNESS)/2)
        .color('green'); // color not automatically added (BUG)

chair = all().solids().onlyVisible();

//// CALC ////

SECTION = `${BEAM_WIDTH}x${BEAM_THICKNESS}`
PARTS_COLUMNS = ['#', 'main part', 'subpart', 'section', 'length', 'quantity']
PART_ROWS = [
        [1, 'side', 'seat beam', SECTION, Math.round(sideSeatingBeam.obbox().maxSize()), 2],
        [2, 'side', 'back leg', SECTION, Math.round(sideBackBeam.obbox().maxSize()), 2],
        [3, 'side', 'depth beam', SECTION, Math.round(sideBeamDepth.obbox().maxSize()), 2],
        [4, 'side', 'front leg', SECTION, Math.round(sideLegFront.obbox().maxSize()), 2],
        [5, 'side', 'back rest support', SECTION, Math.round(sideBackSupportBeam.obbox().maxSize()), 2],
        [6, 'front', 'longitudinal beams', SECTION, Math.round(longBeamFront.bbox().width()), 2],
        [7, 'seat and back rest', 'planks', SECTION, seatPlanks.first().bbox().width(), backNumPlanks+seatPlanks.length],
        [8, 'seat', 'seat beam connector', SECTION, Math.round(sideSeatingBeamPadding.obbox().maxSize()), 2],
]

calc.table('parts', PART_ROWS, PARTS_COLUMNS)

//// DOC PIPELINE ////

function docPipeline()
{
        iso = chair.iso([1,-1,1])
                .rotateZ(-90-30)
                .move(-1500, -1500)

        sideSection = side2D
                .show()
                .rotateZ(90)
                .rotateX(-90)
                .rotateY(180)
                .moveToZ(0)
                .moveY(-1500);

        parts = sideSection.map((s,i) => s.copy().autoRotate());
        
        parts.add(
                seatPlanks.first().copy().flatten().layflat().edges(),
                longBeamFront.copy().flatten().layflat().edges(),
                sideSeatingBeamPadding.copy().flatten().layflat().edges()
        )

        parts.forEach((p,i) => {
                p.moveToX(1000) // start at fixed x
                        .moveToY(-1500) // on one line y-axis
                        .move(i*(BEAM_WIDTH+250))
                p.autoDim({ offset: 25 });
        });
}

// docPipeline()

//// DOC ////

doc
        .create('plan')
        .page('spec')
        .pipeline(docPipeline)
        .titleblock( { 
                title: 'Garden Chair',
                designer: 'KAK', 
                designLicense: 'unknown', 
                })
        .view('iso')
        .shapes('iso')
        .width(0.35)
        .height(0.5)
        .pivot(1,0)
        .position(1,0.23)
        .view('parts')
        .shapes('parts')
        .pivot(0,1)
        .width(0.7)
        .height(0.5)
        .position(0,1)
        .table('parts', { fontsize: 7 })
        .width(0.35)
        .height(0.4)
        .position(0,0.24)
        .view('side')
        .shapes('sideSection')
        .width(0.5)
        .height(0.4)
        .pivot(0,0)
        .position(0.4,0 );


