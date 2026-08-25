// workbench
// Workbench by Waldmiller and Howell 

$PARAMS.define('LENGTH', 'number', { label: "Length", units: "mm", order: 0, default: 1000, minimum: 600, maximum: 2440, multipleOf: 1 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "mm", order: 0, default: 610, minimum: 400, maximum: 1220, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 840, minimum: 500, maximum: 1000, multipleOf: 1 });
$PARAMS.define('BEAM_WIDTH', 'number', { label: "Beam Width", units: "mm", order: 0, default: 89, minimum: 30, maximum: 140, multipleOf: 1 });
$PARAMS.define('BEAM_THICKNESS', 'number', { label: "Beam Thickness", units: "mm", order: 0, default: 38, minimum: 22, maximum: 50, multipleOf: 1 });
$PARAMS.define('BOARD_THICKNESS', 'number', { label: "Board thickness", units: "mm", order: 0, default: 18, minimum: 10, maximum: 22, multipleOf: 1 });

// Archiyou 0.5
/*
    Parametric worktable
    Original design by Bob Waldmiller and Russ Erb
    of Experimental Aircraft Association
    see: https://www.eaa.org/eaa/aircraft-building/builderresources/while-youre-building/building-articles/tools-and-workshop/worktables

*/

//// PARAMS ////

LENGTH = $LENGTH; // 60 inch in original
DEPTH = $DEPTH; // 24 inch in original
HEIGHT = $HEIGHT; // with table top plate - 33 inch in original

BEAM_WIDTH = $BEAM_WIDTH; // originally for 2x4" beam 
BEAM_THICKNESS = $BEAM_THICKNESS;
BOARD_THICKNESS = $BOARD_THICKNESS;

SHELF_HEIGHT = 300;  // includes plate thickness

//// SETTINGS ////

TABELTOP_BEAM_SPACING_TARGET = 381; // original 15 inch spacing

//// MODEL ////

layer('top').color('green');

tableTopLatBeamFront = boxbetween([0,0,0],[LENGTH, BEAM_THICKNESS, BEAM_WIDTH])
                        .name('top length');
tableTopLatBeamBack = tableTopLatBeamFront.copy().moveY(DEPTH-1*BEAM_THICKNESS)
tableTopLatBeamLeft = boxbetween([0,BEAM_THICKNESS,0],[BEAM_THICKNESS, DEPTH-1*BEAM_THICKNESS, BEAM_WIDTH])
                        .name('top depth');
tableTopLatBeamRight = tableTopLatBeamLeft.copy().move(LENGTH-BEAM_THICKNESS)

tableTopNumBetweenBeams = Math.round((LENGTH-2*BEAM_THICKNESS)/TABELTOP_BEAM_SPACING_TARGET);
tableTopBetweenBeamsSpacing = (LENGTH-2*BEAM_THICKNESS)/tableTopNumBetweenBeams;
tableTopBetweenBeams = collection().name('top laterals');

new Array(tableTopNumBetweenBeams - 1).fill().forEach((n,i) => 
    tableTopBetweenBeams.add(tableTopLatBeamLeft.copy().move((tableTopBetweenBeamsSpacing)*(i+1)+BEAM_THICKNESS/2)))


tabletop = layer('top')
            .shapes()
            .moveZ(HEIGHT-BOARD_THICKNESS-BEAM_WIDTH)

layer('legs').color('red');

legMain = boxbetween([0,0,0], [BEAM_WIDTH, BEAM_THICKNESS, HEIGHT-BOARD_THICKNESS])
            .move(BEAM_THICKNESS, BEAM_THICKNESS)
            .name('leg long')
legMid = boxbetween([BEAM_THICKNESS, 0, SHELF_HEIGHT-BOARD_THICKNESS], 
                    [BEAM_THICKNESS+BEAM_WIDTH, BEAM_THICKNESS, HEIGHT-BOARD_THICKNESS-BEAM_WIDTH])
            .name('leg mid')
legBottom = boxbetween([BEAM_THICKNESS, 0, 0],
                         [BEAM_THICKNESS+BEAM_WIDTH, BEAM_THICKNESS, SHELF_HEIGHT-BOARD_THICKNESS-BEAM_WIDTH])
                        .name('leg bottom');

legLeftFront = collection(legMain,legMid,legBottom);
legRightFront = legLeftFront.copy().move(LENGTH-BEAM_WIDTH-BEAM_THICKNESS*2)
legLeftBack = legLeftFront.copy().mirrorY((DEPTH)/2).color('red'); // BUG: Color not from layer
legRightBack = legLeftBack.copy().move(LENGTH-BEAM_WIDTH-BEAM_THICKNESS*2).color('red'); // BUG: Clone after mirror 

layer('laterals').color('purple');

lateralLengthFront = boxbetween( legBottom.select('V||topleftfront'),
            legBottom.select('V||topleftfront').copy().move(LENGTH-BEAM_THICKNESS*2, BEAM_THICKNESS, BEAM_WIDTH))
            .name('along length')

lateralLengthBack = lateralLengthFront.copy().moveY(DEPTH-BEAM_THICKNESS)

lateralDepthLeft = boxbetween(
                    [0, 0, 0],
                    [BEAM_THICKNESS, DEPTH - 2*BEAM_THICKNESS, BEAM_WIDTH]
                    ).move(BEAM_WIDTH+BEAM_THICKNESS, BEAM_THICKNESS, SHELF_HEIGHT-BOARD_THICKNESS-BEAM_WIDTH)
                    .name('along depth')

lateralDepthRight = lateralDepthLeft.copy().move(LENGTH - 2*BEAM_WIDTH - 3*BEAM_THICKNESS)

allBeams = all(); // Keep that for later

layer('boards').color('blue');

tableTopBoard = boxbetween([0,0,0],[LENGTH, DEPTH, BOARD_THICKNESS])
                    .moveZ(HEIGHT-BOARD_THICKNESS)

bottomBoard = boxbetween(
                    lateralDepthLeft.select('V||frontlefttop').copy().tmp().moveY(-BEAM_THICKNESS),
                    lateralDepthRight.select('V||backrighttop').copy().tmp().moveY(BEAM_THICKNESS).moveZ(BOARD_THICKNESS));


//// METRICS ////

// Basic material cost calculation for consumers
SLS_WOOD_EUR_PER_M3 = 500; // high estimate based on prices in EUR for consumers
BOARD_EUR_PER_M3 = 20*10; // again high estimate

calc.metric('material cost est', Math.round(allBeams.volume()*1e-9*SLS_WOOD_EUR_PER_M3 
                            + layer('boards').shapes().volume()*1e-9*BOARD_EUR_PER_M3),
                            { icon: 'currency-eur', unit : 'EUR' } );

//// TABLES ////

parts = make.partList(allBeams)
            .name('parts')
            .addRow(['boards', `board top ${BOARD_THICKNESS}mm`, 
                `${tableTopBoard.bbox().width()}x${tableTopBoard.bbox().depth()}`, '', 1])
            .addRow(['boards', `board bottom ${BOARD_THICKNESS}mm`, 
                `${bottomBoard.bbox().width()}x${bottomBoard.bbox().depth()}`, '', 1])


//// DOC ////

function docPipeline()
{
    layer('doc')

    tableTopElevation = tabletop.copy().flatten('z').move(LENGTH * 2);
    tableTopElevation.autoDim({ levels: 
                                    [
                                        { axis: 'y', at: 0.5, align: 'min', offset: 50 }, // TODO: align does not work
                                        { axis: 'x', at: 0.01, align: 'min', offset: 50  },
                                     ]})
    tableTopElevation.bbox().back().dim({ offset: 50 });
    tableTopElevation.bbox().right().dim({ offset: 50 });


    bottomFrameFlat = layer('laterals').shapes().copy().flatten('z').move(LENGTH*2, -DEPTH*1.4)
    bottomFrameFlat.autoDim({ levels: [
        { axis: 'y', at: 0.5, align: 'min', offset: 50 }
    ]})
    bottomFrameFlat.bbox().back().dim({ offset: 50 });
    bottomFrameFlat.bbox().left().dim({ offset: 50 });

    legFlat = legLeftFront.copy().flatten('y').rotateX(-90).moveToZ(0).move(LENGTH*3.1, -DEPTH/2)
    legFlat.bbox().front().dim({ offset: 50 });
    legFlat.bbox().left().dim({ offset: 50 });
    legFlat.autoDim({ levels: [
        { axis: 'x', at: 0.5, offset: 50 }
    ]})

    legIso = legLeftFront.iso().move(LENGTH*3.1+legFlat.bbox().width()+300, -DEPTH/2)

    partsIsolated = collection(tableTopElevation,bottomFrameFlat)
    legIsolated = collection(legFlat, legIso)

    iso = allBeams.iso().move(LENGTH*4.5)
}

//docPipeline(); // Uncomment to debug doc pipeline

doc
    .create('plan')
    .pipeline(docPipeline)
    .page('spec')
    .titleblock({ title: 'Workbench', designer: 'Waldmiller & Erb', designLicense: 'CC0', manualLicense: 'CC0' })
    .table('parts', { fontsize: 7 })
    .title('Parts')
    .position(0,0.35)
    .height(0.4)
    .width(0.4)
    .view('parts')
    .shapes('partsIsolated')
    .pivot(1,1)
    .position(1,1)
    .width(0.55)
    .height(0.6)
    .view('iso')
    .shapes('iso')
    .pivot(0,1)
    .position(0,1)
    .width(0.4)
    .height(0.6)
    .view('leg')
    .shapes('legIsolated')
    .pivot(1,0)
    .position(0.85, 0)
    .width(0.25)
    .height(0.35)

