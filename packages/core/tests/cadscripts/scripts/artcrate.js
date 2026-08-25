// artcrate
// Crate that can be customized to exactly fit your artworks for perfect shipping

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "cm", order: 0, default: 50, minimum: 30, maximum: 70, multipleOf: 1 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "cm", order: 0, default: 100, minimum: 20, maximum: 300, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "cm", order: 0, default: 50, minimum: 20, maximum: 100, multipleOf: 1 });
$PARAMS.define('BOARD_THICKNESS', 'number', { label: "Board Thickness", units: "mm", order: 0, default: 8, minimum: 5, maximum: 18, multipleOf: 1 });
$PARAMS.define('LAT_WIDTH', 'number', { label: "Lat Width", units: "mm", order: 0, default: 36, minimum: 30, maximum: 50, multipleOf: 1 });
$PARAMS.define('LAT_HEIGHT', 'number', { label: "Lat Height", units: "mm", order: 0, default: 18, minimum: 18, maximum: 30, multipleOf: 1 });

// Archiyou 0.5
// given size parameters for size of inside

units('mm');

console.log('==== PARAMS ====');
console.log($WIDTH);

const WIDTH = $WIDTH*10; // to mm
const DEPTH = $DEPTH*10;
const HEIGHT = $HEIGHT*10;

const LAT_WIDTH = $LAT_WIDTH;
const LAT_HEIGHT = $LAT_HEIGHT;
const PLATE_THICKNESS = $BOARD_THICKNESS;

const DEPTH_OUTSIDE = DEPTH + 2 * (LAT_HEIGHT+PLATE_THICKNESS)
const HEIGHT_OUTSIDE = HEIGHT + LAT_HEIGHT + PLATE_THICKNESS

const BOARD_STOCK_WIDTH = 1220;
const BOARD_STOCK_HEIGHT = 2440;

layer('bottom').color('blue');


bottomPlate = boxbetween([0,0,0],[WIDTH, DEPTH_OUTSIDE, PLATE_THICKNESS])
            .moveZ(LAT_HEIGHT);

bottomLatLeft = boxbetween([0,0,0], [LAT_WIDTH, DEPTH_OUTSIDE, LAT_HEIGHT]);
bottomLatRight = boxbetween([WIDTH,0,0], [WIDTH-LAT_WIDTH, DEPTH_OUTSIDE, LAT_HEIGHT]);
bottom = layer('bottom').shapes();

line([WIDTH/2,0,-500], [WIDTH/2,0,500]).color('yellow');

const BOTTOM_INSIDE_Z = LAT_HEIGHT + PLATE_THICKNESS;

layer('sidefront').color('purple');
sideFrontPlate = boxbetween([0,0,0], [WIDTH, PLATE_THICKNESS, HEIGHT])
    .move(0,LAT_HEIGHT,BOTTOM_INSIDE_Z)
sideFrontLatLeft = boxbetween([0,0,0], [LAT_WIDTH, LAT_HEIGHT, HEIGHT])
    .move(0,0,BOTTOM_INSIDE_Z);
sideFrontLatRight = sideFrontLatLeft.copy().mirror([WIDTH/2]);

sideFrontLatBottom = boxbetween([LAT_WIDTH,0,0],[WIDTH-LAT_WIDTH, LAT_HEIGHT, LAT_WIDTH])
    .move(0,0,BOTTOM_INSIDE_Z);
sideFrontLatTop = sideFrontLatBottom.copy().mirror([0,0,HEIGHT/2+BOTTOM_INSIDE_Z]);

sideFront = layer('sidefront').shapes();


layer('sideback');
sideBack = sideFront.copy().mirror([0,DEPTH_OUTSIDE/2,0]);


layer('sideleft').color('green');
sideLeftPlate = boxbetween([0,0,0],
    [-PLATE_THICKNESS, DEPTH_OUTSIDE, HEIGHT_OUTSIDE])
sideLeftLat = boxbetween([0,0,0],
    [-LAT_HEIGHT, DEPTH_OUTSIDE, LAT_WIDTH])
    .move(-PLATE_THICKNESS,0,HEIGHT_OUTSIDE-LAT_WIDTH);
sideLeft = layerShapes();

layer('sideright').color('orange');
sideRight = sideLeft.copy().mirror([WIDTH/2])

layer('lit')

const SIDE_OFFSET = PLATE_THICKNESS+LAT_HEIGHT;
lit = boxbetween([-SIDE_OFFSET,0,0], 
                [ WIDTH+SIDE_OFFSET, DEPTH_OUTSIDE, PLATE_THICKNESS])
        .moveZ(HEIGHT_OUTSIDE).color('red')
        .hide();

crate = all();



//// INTERACTIVE ANNOTATIONS ////

/*
contentBox = boxbetween(
        sideFrontPlate.select('V||backbottomleft'),
        sideFrontPlate.select('V||backtopleft').copy().move(WIDTH, DEPTH)
    ).hide();

contentBox.select('E||frontbottom')
    .dimension({ offset: 100 })
    .bindParam('WIDTH');

contentBox.select('E||leftbottom')
    .dimension({ offset: 100 })
    .bindParam('DEPTH');

contentBox.select('E||frontright')
    .dimension({ offset: 100 })
    .bindParam('HEIGHT');

*/

//// DOC ////

/*
docPipeline = () => 
{

    crateIso = crate.iso([1,-1,1]).rotateZ(-90-30).move(2000);
    layer('isoexplode').color('blue')
    XOFFSET = 2000;
    sf = sideFront.copy().move(XOFFSET, -100)
    b = bottom.copy().move(XOFFSET,500)
    sb = sideBack.copy().move(XOFFSET, 750)
    sl = sideLeft.copy().move(XOFFSET-250, 500)
    sr = sideRight.copy().move(XOFFSET+600, 500)
    crateExpl = collection(sf,b,sb,sl,sr); // cannot hide before iso!
    crateExplIso = crateExpl.iso([1,-1,1]).rotateZ(-90-30).move(3000,500);

    // turn on plates
    // plates.show() // doesnt work

    // layout plates and fit inside stock
    plates = collection(sideFrontPlate, 
                sideFrontPlate.copy().tmp(),
                sideLeftPlate,
                sideLeftPlate.copy().tmp(),
                bottomPlate,
                lit
            ).pack(
                { flatten:true, stockWidth: BOARD_STOCK_WIDTH, stockHeight: BOARD_STOCK_HEIGHT, margin: 5, autoRotate: true })
            .move(0,-5000)

    plates.getGroup('bins').first().select('E||front').dimension( { offset: 200 });
    plates.getGroup('bins').first().select('E||left').dimension( { offset: 200 });
}

*/


//// CALCULATIONS AND TABLES ////

/*
PLATE_COST = 20;
WOOD_COST_PER_M = 4;
woodLength = 
        2 * bottomLatLeft.bbox().depth() + 
        4 * $HEIGHT + 
        4 * sideFrontLatBottom.bbox().width() +
        2 * sideLeftLat.bbox().depth();

// estimation of number of plates used
numPlatesUsed = Math.ceil(box(WIDTH, DEPTH, HEIGHT).hide().area()*1.1 / (BOARD_STOCK_WIDTH * BOARD_STOCK_HEIGHT));

materialCostEst = roundTo(numPlatesUsed*PLATE_COST+woodLength/1000*WOOD_COST_PER_M,2);
calc.metric('material cost EST', materialCostEst, { 'unit': 'EUR' })

calc.table('materials', 
    [
        ['wood',`${LAT_WIDTH}x${LAT_HEIGHT}`, 'length', woodLength/1000, 'm', roundTo(woodLength/1000*WOOD_COST_PER_M,2)],
        ['multiplex','1220x2440', 'pieces', numPlatesUsed, 'pieces', numPlatesUsed*PLATE_COST],
        ['','', '', '', 'TOTAL', materialCostEst]
    ], 
    ['material','dimensions in mm', 'quantity', 'amount', 'unit', '~ cost EUR']);

calc.table('parts', 
    [
        ['bottom',`board`, 'multiplex', `${bottomPlate.bbox().width()}x${bottomPlate.bbox().depth()}`, 1],
        ['',`horizontals`, 'wood', `${bottomLatLeft.bbox().depth()}`, 2],
        ['sides front&back','board', 'multiplex', `${sideFrontPlate.bbox().width()}x${sideFrontPlate.bbox().height()}`, 2],
        ['','horizontals', 'wood', `${sideFrontLatTop.bbox().width()}`, 4],
        ['','verticals', 'wood', `${sideFrontLatLeft.bbox().height()}`, 4],
        ['sides left&right','board', 'multiplex', `${sideLeftPlate.bbox().height()}x${sideLeftPlate.bbox().depth()}`, 2],
        ['','horizontals', 'wood', `${sideLeftLat.bbox().depth()}`, 2],
        ['lit','board', 'multiplex', `${lit.bbox().depth()}x${lit.bbox().width()}`, 1],
    ], 

    ['part','subpart', 'material', 'dimensions in mm', 'quantity'])


instructable = doc.create('spec')
    .pipeline(docPipeline)
    .page('main')
    .titleblock({ title: 'Art Crate', designer: 'Wim Janssen' })
    .padding('1cm')
    .text('Art Crate', { size: '12mm' })
    .position(0,1.0)
    .text(`${$WIDTH}x${$DEPTH}x${$HEIGHT}cm`, { size: '7mm' })
    .position(0,0.91)
    .view('crateIso')
    .shapes('crateIso')
    .pivot(0,0)
    .position(0,0.25)
    .width(0.35)
    .height(0.5)
    // exploded view
    .view('isoexploded')
    .shapes('crateExplIso') // NOTE: if put behind table we have an error! TODO: check
    .pivot('bottomright')
    .position(0.78,0.5)
    .width(0.39) // 0.5
    .height(0.5) // 0.6
    .text('Material list', { size: '6mm'}).position(0,0.2)
    .table('materials', { fontsize: 7 })
    .position(0,0.15) 
    .width(0.35)
    .text('Part list', { size: '6mm'}).position(0.42,0.35)
    .table('parts', {fontsize: 7 })
    .position(0.42, 0.3)
    .text('Board saw plan', { size: '5mm'}).pivot('bottomleft').position(0.8,0.64)
    .text('1220x2440mm', { size: '3mm'}).pivot('bottomleft').position(0.8,0.62)
    .view('sawplan')
    .shapes('plates')
    .pivot(0,0)
    .position(0.8, 0.3)
    .width(0.2)
    .height(0.3)
    .text(`In memory of Pieter Kemink (1952-2024)`, { size: '2.8mm' })
    .position(0.8,0.29)

  */
    