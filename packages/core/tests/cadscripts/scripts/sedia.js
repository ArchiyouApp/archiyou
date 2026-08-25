// sedia
// The famous Sedia chair by Enzo Mari

$PARAMS.define('WIDTH_NUM_BOARDS', 'number', { label: "Width in number of boards", order: 0, default: 4, minimum: 4, maximum: 10, multipleOf: 1 });

// Archiyou 0.17

//// MATERIAL SETTINGS ////

BEAM_SMALL = 25;
BEAM_MID = 50;
BEAM_LARGE = 100;

//// PARAMS ////

SEAT_WIDTH_BOARDS = $WIDTH_NUM_BOARDS;

SEAT_WIDTH = SEAT_WIDTH_BOARDS*BEAM_LARGE;
SEAT_DEPTH = 495;
SEAT_START_HEIGHT = 240; // from ground to bottom seat
SEAT_ANGLE_OFFET = 20;

BACK_ANGLE_OFFSET = 40;
BACK_LENGTH = 610; // from bottom of seat


//// SEAT ////

layer('seat').color('red');
seatFrontTop = boxbetween(
                [0,0,0],
                [SEAT_WIDTH+BEAM_SMALL*4, BEAM_SMALL, BEAM_LARGE])
                .moveZ(SEAT_START_HEIGHT+BEAM_LARGE)
seatFrontBottom = seatFrontTop.copy().move(0,0,-BEAM_LARGE)
                
seatBackTop = seatFrontTop.copy().move(0,SEAT_DEPTH, -SEAT_ANGLE_OFFET)
                
seatBackBottom = seatFrontBottom.copy().move(0,SEAT_DEPTH, -SEAT_ANGLE_OFFET)

seatFrontTop.moveZ(SEAT_ANGLE_OFFET);
seatFrontBottom.moveZ(SEAT_ANGLE_OFFET);
        
seatSideLeftBottom = boxbetween(
                        [0,BEAM_SMALL,0],
                        [0+BEAM_SMALL,SEAT_DEPTH,BEAM_LARGE]
                        )
                .move(BEAM_SMALL, 0, SEAT_START_HEIGHT)

seatSideLeftTop = seatSideLeftBottom.copy().move(0,0,BEAM_LARGE)

seatSideRightBottom = seatSideLeftBottom.copy().mirrorX((SEAT_WIDTH+BEAM_SMALL*4)/2);
seatSideRightTop = seatSideLeftTop.copy().mirrorX((SEAT_WIDTH+BEAM_SMALL*4)/2);


seatBoardLeftLine = line(
                        seatBackTop.select('V||leftbacktop'),
                        seatFrontTop.select('V||leftfronttop')).hide(); // IN ACCURACY!
                        

seatBoardLeft = seatBoardLeftLine
                    .extrude(BEAM_LARGE, [1,0,0])
                    .extrude(-BEAM_SMALL)
                    .move(BEAM_SMALL*2)
boards = seatBoardLeft.array([SEAT_WIDTH_BOARDS,1,1],[BEAM_LARGE,0,0])

/* NOTE: In later versions the seating is slightly recessed
        So the front end of the base plank is aligned with the sides and legs
        This is easier for assembly
*/
/*
seatFrontTop.moveZ(-SEAT_ANGLE_OFFET);
seatFrontBottom.moveZ(-SEAT_ANGLE_OFFET);
seatBackTop.moveZ(-SEAT_ANGLE_OFFET);
seatBackBottom.moveZ(-SEAT_ANGLE_OFFET);
boards.moveZ(-SEAT_ANGLE_OFFET);
*/

//// LEGS ////

layer('legs').color('blue');

legFrontLeft = boxbetween([0,0,0],[-BEAM_SMALL, BEAM_MID,SEAT_START_HEIGHT+2*BEAM_LARGE ])
                .move(BEAM_SMALL,BEAM_SMALL)
                .name('leg front left')      

legFrontRight = legFrontLeft.copy().move(seatFrontTop.bbox().width()-BEAM_SMALL)     
                        .name('leg front right');
                        
legBackLeft = legFrontLeft.copy().move(0,SEAT_DEPTH-BEAM_MID*1.5)
                .name('leg back left');
legBackRight = legBackLeft.copy().move(seatFrontTop.bbox().width()-BEAM_SMALL)
                        .name('leg back right');

//// BACK ////

layer('back').color('green');

backLineBase = line(
                legBackLeft.select('V||toprightfront').copy().move(0,-BACK_ANGLE_OFFSET,-BEAM_LARGE*2),
                legBackLeft.select('V||toprightfront')
                )
                .hide();

backLine = line(
                backLineBase.start(),
                backLineBase.start().copy().move(backLineBase.direction().normalized().scale(BACK_LENGTH))
                )
                .hide();

backSideLeft = backLine.extrude(BEAM_SMALL, [-1,0,0]).extrude(-BEAM_MID)
backSideRight = backSideLeft.copy().mirrorX(seatFrontTop.bbox().width()/2);

backHorizontalLine = line(
                backSideLeft.select('V||topleftfront'),
                backSideRight.select('V||topleftfront')
                )

backHorizontalTop = backHorizontalLine.extrude(BEAM_LARGE, backLine.direction().reverse())
                        .extrude(BEAM_SMALL)

backHorizontalBottom = backHorizontalTop.copy().move(
                                backLine.direction().reversed().normalized().scaled(BEAM_LARGE)
                        )

//// ORGANIZE FOR PART LIST ////

seat = collection(
        seatFrontTop.name('base front'),
        seatFrontBottom.name('base front'),
        seatBackTop.name('base back'),
        seatBackBottom.name('base back'),
        seatSideLeftBottom.name('base left'),
        seatSideLeftTop.name('base left'),
        seatSideRightBottom.name('base right'),
        seatSideRightTop.name('base right'),
        boards.name('boards').forEach(s => s.name('seat board'))
        ).name('seat')

legs = collection(legBackLeft, legBackRight, legFrontLeft, legFrontRight)
        .name('legs');

back = collection(
        backSideLeft.name('back rest diagonal'),
        backSideRight.name('back rest diagonal'),
        backHorizontalTop.name('back rest plank'),
        backHorizontalBottom.name('back rest plank')
).name('back')

chair = collection(seat, legs, back)

//// DATA ////

make.partList(chair, 'parts'); // Automatic part table generation
// TODO: add sum to partList
/*
calc.table('parts').addRow({ length: '---- +' })
calc.table('parts').addRow({ subpart: 'TOTAL', section: `${BEAM_SMALL}x${BEAM_LARGE}`});
calc.table('parts').addRow({ subpart: 'TOTAL', section: `${BEAM_SMALL}x${BEAM_MID}`});
*/

//// METRICS ////

WOOD_DENSITY_KG_PER_M3 = 320;
WOOD_COST_EUR_PER_M3 = 2500; // consumer pricing for small timber
volumeM3 = chair.volume()*1e-9;
calc.metric('weight', Math.round(volumeM3*WOOD_DENSITY_KG_PER_M3) , { icon: 'weight-kilogram', unit: 'kg'});
calc.metric('material cost (EST)', Math.round(volumeM3*WOOD_COST_EUR_PER_M3), { icon: 'euro', unit: 'EUR'} )

//// DOC PIPELINE ////

function docPipeline()
{
        iso = chair.iso().move(2000)

        elevationCollection = collection(
                        legFrontLeft,
                        legBackLeft,
                        seatSideLeftBottom,
                        seatSideLeftTop,
                        seatFrontBottom,
                        seatFrontTop,
                        seatBackBottom,
                        seatBackTop,
                        backSideLeft,
                        backHorizontalTop,
                        backHorizontalBottom,
                        boards
                        )

        elevation = elevationCollection.copy().flatten('x')
                        .moveY(1000)
                        .rotateY(90)
                        .rotateZ(90)
                        .moveTo(0,0,0)
                        .move(4000)

        // Elevation dimensions
        elevation['leg back left'].select('E||front').dim();

        elevation['leg front left'].select('E||right').dim({ offset: 80 });
        elevation['back rest diagonal']
                .select('V||front')
                .lineTo(elevation['leg back left'])
                .dim({ offsetVec:[0,-1,0], offset: 50 })
                .link(elevation); // linking dimension to ShapeCollection

        line(elevation['base back']
                .select('E||back') // some problems with bbox selector
                .select('V||right'),
                        elevation['leg back left']
                        .select('E||back').select('V||left'))  
                        .dim( { offsetVec: [-1,0,0], offset: 50 })
                        .link(elevation);
        line(elevation['base front']
                .select('E||back') // some problems with side selector
                .select('V||left'),
                        elevation['leg front left']
                        .select('E||back').select('V||right'))  
                        .dim( { offsetVec: [-1,0,0], offset: 50 })
                        .link(elevation);

        elevationFront = chair.elevation('front').move(5000);
        elevationFront.bbox().left().dim().link(elevationFront);
        elevationFront.bbox().front().dim().link(elevationFront);

        elevationTop = chair.elevation('top').move(6000);
        elevationTop.bbox().left().dim().link(elevationTop);
        elevationTop.bbox().front().dim().link(elevationTop);

}

// DEBUG DOC PIPELINE
// docPipeline();

manual = doc.create('plan')
            .page('spec')
            .pipeline(docPipeline)
            .titleblock({ title: 'Sedia', designer: 'Enzo Mari', designLicense: 'unknown' })    
            .view('iso')
            .shapes('iso')
            .pivot('topleft')
            .position(0,1)
            .width(0.45)
            .height(0.75)
            .table('parts', { fontsize: 6 })
            .position(0,0.25)
            .width(0.4)
            .view('elevationSide')
            .shapes('elevation')
            .pivot('topleft')
            .position(0.45,1)
            .width(0.28)
            .height(0.5)
            .view('elevationFront')
            .shapes('elevationFront')
            .pivot('topleft')
            .position(0.7,1)
            .width(0.28)
            .height(0.5)
            .view('elevationTop')
            .shapes('elevationTop')
            .pivot(0,0)
            .position(0.45, 0)
            .width(0.28)
            .height(0.4)


