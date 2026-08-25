// timberwall
// Basic framed wall according to traditional standards

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "mm", order: 0, default: 3000, minimum: 1000, maximum: 4000, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", order: 0, default: 2500, minimum: 1000, maximum: 3000, multipleOf: 1 });
$PARAMS.define('DEPTH', 'options', { label: "Depth", order: 0, default: "120", options: ["89","120","140","184","235"] });
$PARAMS.define('OPENING', 'boolean', { label: "With opening", order: 0, default: false });
$PARAMS.define('OPENING_START', 'number', { label: "Opening Start", units: "mm", order: 0, default: 1000, minimum: 0, maximum: 3000, multipleOf: 1 });
$PARAMS.define('OPENING_SILL', 'number', { label: "Opening Sill", units: "mm", order: 0, default: 1000, minimum: 0, maximum: 3000, multipleOf: 1 });
$PARAMS.define('OPENING_WIDTH', 'number', { label: "Opening Width", units: "mm", order: 0, default: 1000, minimum: 200, maximum: 2000, multipleOf: 1 });
$PARAMS.define('OPENING_HEIGHT', 'number', { label: "Opening Height", units: "mm", order: 0, default: 1000, minimum: 200, maximum: 2500, multipleOf: 1 });
$PARAMS.define('BOARDS', 'options', { label: "Boards", order: 0, default: "none", options: ["none","OSB39","OSB318"] });
$PARAMS.define('INSULATION', 'options', { label: "Insulation", order: 0, default: "hempflax", options: ["hempflax","glasswool","none","woodwool"] });
$PARAMS.define('TOP_CONNECT', 'boolean', { label: "Double Top", order: 0, default: false });

// Archiyou 0.22

STUD_THICKNESS = 38;
BOARDING_STOCK_WIDTH = 1220;
BOARDING_STOCK_HEIGHT = 2440;
CERT_COST_PERC = 0.1;

//// MATERIAL SETTINGS ////

MATERIALS = {
    WOOD: { EUR_M3: 375, KG_M3: 460, GWP: -707  }, // GWP in kgCO2eq/m3
    OSB: { EUR_M3: 335, KG_M3: 600, GWP: -691 }, // 9 or 18 mm: 348 EUR/m3 - 327 EUR/m3
    ECOBOARD: { EUR_M3: 535, KG_M3: 570, LAMBDA: 0.09, GWP: -621  }, // Agepan DWD protect
    WATERBARRIER: { EUR_M2: 2.7 },
    GLASS_WOOL: { EUR_M3: 41, LAMBDA: 0.035, GWP: 24, }, // Knauff Naturoll 035
    GLASS_WOOL_ACOUSTIC: { EUR_M3: 45, LAMBDA: 0.037, GWP: 16 }, // Knauf Acoustifit
    WOOD_WOOL: { EUR_M3: 90, LAMBDA: 0.036, GWP: -38 }, // Gutex Thermoflex 111
    HEMP: { EUR_M3: 120, KG_M3: 36, LAMBDA: 0.039, GWP: -20.3  }// Hempflax
}

BOARDS_OPTIONS_TO_DATA = {
    'none' : { thickness: 0, kgm3: 0, eurm2: 0},
    'OSB39' : { thickness: 9, kgm3: MATERIALS.OSB.KG_M3, eurm2: 3.14 },
    'OSB318' : { thickness: 18, kgm3: MATERIALS.OSB.KG_M3, eurm2: 5.89 },
    'AGEPAN16' : { thickness: 16, kgm3: MATERIALS.ECOBOARD.KG_M3, eurm2: 8.57 }
}

//// CALC SETTINGS ////

PRICING = {
    LABOR_COST_EUR_PER_STUD: 15, 
    LABOR_COST_EUR_PER_OPENING: 100,
    LABOR_PROFIT_PERC: 0.15,
    MATERIAL_PROFIT_PERC : 0.25,
    PLATFORM_PERC: 0.25,
}

//// PARAM DYNAMICS ////

$PARAMS.OPENING_SILL.enableIf($OPENING);
$PARAMS.OPENING_WIDTH.enableIf($OPENING);
$PARAMS.OPENING_HEIGHT.enableIf($OPENING);
$PARAMS.OPENING_START.enableIf($OPENING);

///// CALCULATED PARAMS ////

openings = [{ 
              left: $OPENING_START, 
              sill: $OPENING_SILL, 
              width: $OPENING_WIDTH,
              height: $OPENING_HEIGHT }]

//// WALL FRAME ////

// Interactive dim line
line([0,0,0],[$WIDTH,0,0])
    .hide()
    .dim( { offset: 600 })
        .bindParam('WIDTH');

line([$WIDTH,0,0],[$WIDTH,0,$HEIGHT])
    .hide()
    .dim( { offset: 600 })
    .bindParam('HEIGHT');


wall = make.wall(
                $WIDTH,
                $HEIGHT-$TOP_CONNECT*STUD_THICKNESS,
                Number($DEPTH), // options param values are strings
                STUD_THICKNESS, 
                610, 
                ($OPENING) ? openings : []);


wall.openingDiagrams.hide();
wall.gridlines.hide();
if($INSULATION == 'none'){ wall.insulation.hide () };

// make extra connecting top-plate
if($TOP_CONNECT)
{
    wall.plates.add(
            boxbetween([0,-$DEPTH/2,0],[$WIDTH,$DEPTH/2, STUD_THICKNESS])
            .move(0,0,$HEIGHT-STUD_THICKNESS)
            .color('green')
    )
}

//// BOARDING ////
boardThickness = BOARDS_OPTIONS_TO_DATA[$BOARDS].thickness;
boardKgM3 = BOARDS_OPTIONS_TO_DATA[$BOARDS].kgm3;
boardCostM2 = BOARDS_OPTIONS_TO_DATA[$BOARDS].eurm2;

// We make sections based on openings
boards = collection();
// clone() is the shallow copy (shares the shapes); sort() returns a new collection
wallOpenings = wall.openingDiagrams.clone().sort((s1,s2) => s1.bbox().min().x - s2.bbox().min().x);

function makeSectionBoarding(start,end,height)
{
    if(end-start > 0)
    {
        let offset = 0;
        if (start !== 0)
        {
            let nextGridLine = wall.gridlines.find(gl => gl.center().x > start);
            offset = (nextGridLine) ? nextGridLine.center().x - start : 0;  
        }

        let boarding = make.boarding( { 
                width: end-start,
                height: height,
                direction: 'horizontal',
                stockWidth: BOARDING_STOCK_WIDTH, 
                stockHeight: BOARDING_STOCK_HEIGHT, 
                grid: 610,
                gridOffset: offset,
                leftover: true })
                    .move(start)
        boards.add(boarding)
        return boarding;
    }
}



if(boardThickness)
{
    if (wallOpenings.length > 0)
    {
        wallOpenings.forEach((o,i,all) =>
        {
            // before opening section
            let sectionBeforeStartX = (i === 0) ? 0 : all[i-1].bbox().max().x + STUD_THICKNESS;
            let sectionBeforeEndX = o.bbox().min().x - STUD_THICKNESS;
            makeSectionBoarding(sectionBeforeStartX,sectionBeforeEndX, $HEIGHT);
            // after opening section
            let sectionAfterStartX = o.bbox().max().x + STUD_THICKNESS
            let sectionAfterEndX = (i < all.length - 1 )
                        ? all[i+1].bbox().min().x - STUD_THICKNESS // to next opening
                        : $WIDTH // to end of wall
            makeSectionBoarding(sectionAfterStartX,sectionAfterEndX, $HEIGHT);
            // bottom of opening
            makeSectionBoarding(sectionBeforeEndX,sectionAfterStartX, o.bbox().min().z - STUD_THICKNESS)
            // top of opening
            makeSectionBoarding(sectionBeforeEndX,sectionAfterStartX, $HEIGHT-o.bbox().max().z- STUD_THICKNESS).moveY(o.bbox().max().z + STUD_THICKNESS)
        })
    }
    else {
        // just make one big boarding filling total wall
        makeSectionBoarding(0,$WIDTH, $HEIGHT*1);
    }

    // finish boards by extruding and rotating
    extrudedBoards = boards
        .hide()
        .copy()
        .rotateAround(90, [1,0,0], [0,0,0])
        .moveY(-$DEPTH/2)
        .extrude(boardThickness, [0,-1,0])
        .color('yellow')
}

//// TABLES: MATERIALS ////

allWoodBeams = collection(wall.studs, wall.plates, wall.cripplesTop, wall.cripplesBottom, wall.openingFramesHorizontals, wall.openingFramesVerticals, wall.openingKingStuds, wall.openingJackStuds );
woodVolumeM3 = allWoodBeams.volume()/Math.pow(10,9); 
woodLengthM = allWoodBeams.reduce((agg,s) => agg + s.length(), 0)/1000;
openingsM2 = (wall.openingDiagrams.length) ? wall.openingDiagrams.reduce((agg,s) => agg + s.bbox().front().area(), 0) / Math.pow(10,6) : 0
wallMinusOpeningsM2 = (($WIDTH*$HEIGHT/1000000)-openingsM2);
boardingAreaM2 = (boards.length) ? wallMinusOpeningsM2 : 0;
boardingVolumeM3 = wallMinusOpeningsM2*boardThickness/1000; 
insulationM3 = ($INSULATION !== 'none') ? (wallMinusOpeningsM2 * ($DEPTH/1000) - woodVolumeM3) : 0;
insulationM2 = insulationM3 / ($DEPTH/1000); 
barierM2 = (boards.length) ? wallMinusOpeningsM2 * 1.20 : 0; // a bit more overlap and loss

insulationEUR_M3 = { 
    none : 0,
    glasswool : MATERIALS.GLASS_WOOL.EUR_M3,
    //'glaswol-acoust' : MATERIALS.GLASS_WOOL_ACOUSTIC.EUR_M3,
    woodwool: MATERIALS.WOOD_WOOL.EUR_M3,
    hempflax: MATERIALS.HEMP.EUR_M3
 }[$INSULATION] || 0;

SCREW_40_COST_PC = roundTo(13.01/500,2);
SCREW_70_COST_PC = roundTo(12.19/200,2);
SCREW_90_COST_PC = roundTo(16.84/200,2);
SCREW_140_COST_PC = roundTo(21.19/200,2);

// for boarding
numScrews40 =  boards.length ? Math.ceil((wall.studs.length * wall.studs.first().bbox().height() + wall.plates.bbox().width()*2 )  / 400) : 0; // every 400 mm
// framing
numScrews70 = Math.ceil(wall.studs.first().bbox().height()/1000/0.2)*2;
numScrews90 = wall.studs.length * 4;
numScrews140 = wall.studs.length * 2;

materialRows = [
        ['wood SLS',`${STUD_THICKNESS}x${$DEPTH}`, 'length', roundTo(woodLengthM,2), 'm', roundTo(MATERIALS.WOOD.EUR_M3*(STUD_THICKNESS*$DEPTH/1000000),2), roundTo(woodVolumeM3 * MATERIALS.WOOD.EUR_M3,2)]];

if($INSULATION !== 'none')
{
    materialRows.push(['insulation',`${$INSULATION}`, 'volume', roundTo(insulationM3,2), 'm3', insulationEUR_M3, roundTo(insulationM3 * insulationEUR_M3, 2)]);
}

// boards and water barrier
if ($BOARDS !== 'none')
{ 
    materialRows.push(['no insulation','122x244', 'area', roundTo(boardingAreaM2,2), 'm2', boardCostM2, roundTo(boardingAreaM2 * boardCostM2,2)]); 
    materialRows.push(['water barier','', 'area + overlap', roundTo(barierM2,2), 'm2', MATERIALS.WATERBARRIER.EUR_M2 , roundTo(barierM2*MATERIALS.WATERBARRIER.EUR_M2,2)]);
    materialRows.push(['screws boards','4x40', 'pcs', numScrews40, 'pcs', SCREW_40_COST_PC,roundTo(numScrews40*SCREW_40_COST_PC,2)]);
}
        
materialRows = materialRows.concat([
        ['screws studs','5x90', 'pcs', numScrews90, 'pcs', SCREW_90_COST_PC, roundTo(numScrews90*SCREW_90_COST_PC,2)],
        ['screws studs','6x140', 'pcs', numScrews140, 'pcs', SCREW_140_COST_PC,roundTo(numScrews140*SCREW_140_COST_PC,2)],
        ['screws doubles','5x70', 'pcs', numScrews70, 'pcs', SCREW_70_COST_PC,roundTo(numScrews70*SCREW_70_COST_PC,2)],
    ]);
// manual sum
materialRows.push(['','', '', '', '', '', '----- +']);
materialRows.push(['TOTAL MATERIAL COST EST','', '', '', '', '', `€ ${roundTo(materialRows.reduce((sum,row) => sum+((typeof row[6] === 'number') ? row[6] : 0), 0),2)}`])

// total screw cost for price metric calculation 
hardwareCost = roundTo(numScrews90*SCREW_90_COST_PC,2) + roundTo(numScrews140*SCREW_140_COST_PC,2) + roundTo(numScrews70*SCREW_70_COST_PC,2);
 
calc.table('materials', 
    materialRows,
    ['material','dim in cm', 'quantity', 'amount', 'unit', '€ per unit', 'cost € est']);

//// METRICS ////

// Metric: pricing
// See calculation in above 

materialCost = Math.round(
                    hardwareCost
                    + woodVolumeM3 * MATERIALS.WOOD.EUR_M3
                    + boardingAreaM2 * boardCostM2
                    + insulationM3 * insulationEUR_M3
                    + barierM2 * MATERIALS.WATERBARRIER.EUR_M2
                    );

laborCost = Math.round(
                PRICING.LABOR_COST_EUR_PER_STUD * wall.studs.length
                + PRICING.LABOR_COST_EUR_PER_OPENING * wall.openingDiagrams.length);

productionCost = Math.round(
                    materialCost * (PRICING.MATERIAL_PROFIT_PERC + 1)
                     + laborCost * (PRICING.LABOR_PROFIT_PERC + 1))

calc.metric('production cost', productionCost, { label: 'Production cost', unit: 'EUR', icon: 'currency-eur'})

// Metric: R-value
thermalResistanceLambda = { 
    none : 0,
    glasswool : MATERIALS.GLASS_WOOL.LAMBDA,
    'glaswol-acoust' : MATERIALS.GLASS_WOOL_ACOUSTIC.LAMBDA,
    woodwool: MATERIALS.WOOD_WOOL.LAMBDA,
    hempflax: MATERIALS.HEMP.LAMBDA,
 }[$INSULATION] || 0;

thermalResistance = (thermalResistanceLambda)
                        ? roundTo(($DEPTH/1000)/thermalResistanceLambda,2)
                        : 0;

calc.metric('Rd',thermalResistance , { label: 'Rd', unit: 'm2K/W', icon: 'heat-wave'})

// Metric: GWP iso
insulationGWP_kgCO2eq_M3 = {  
    none : 0, 
    glasswool : MATERIALS.GLASS_WOOL.GWP, 
    'glaswol-acoust' : MATERIALS.GLASS_WOOL_ACOUSTIC.GWP,
    woodwool: MATERIALS.WOOD_WOOL.GWP,
    hempflax: MATERIALS.HEMP.GWP
 }[$INSULATION] || 0;

calc.metric('GWP', Math.round(insulationGWP_kgCO2eq_M3*insulationM3), { label: 'Eco impact', unit: 'kgCO2eq', icon: 'leaf'} )

// Metric: weight
boardingKgM2 = BOARDS_OPTIONS_TO_DATA[$BOARDS].kgm3
weight = Math.round(
            boardingVolumeM3 * boardingKgM2
        + woodVolumeM3 * MATERIALS.WOOD.KG_M3
        );
calc.metric('weight', weight, { label: 'Mass', unit: 'kg', icon: 'weight-kilogram'})

//// TABLES: PARTS

PART_COLUMNS = ['part','subpart', 'material', 'section (mm)', 'dim (mm)', 'quantity']
section = `${STUD_THICKNESS}x${$DEPTH}`;

parts = [
    ['base wall frame',  'top & bottom plate', 'wood SLS', section, wall.plates[0].bbox().width(), wall.plates.length],
    ['base wall frame',  'studs + opening kingstuds', 'wood SLS', section, wall.studs[0].bbox().height(), wall.studs.length + wall.openingKingStuds.length ],
]

// if we have any (succesfull) openings
if(wall.openingDiagrams.length)
{
    parts = parts.concat([  
        ['opening',  'cripple studs top', 'wood SLS', section, (wall.cripplesTop.first()) ? wall.cripplesTop.first().bbox().height() : '', wall.cripplesTop.length ],
        ['opening',  'cripple studs bottom', 'wood SLS', section, (wall.cripplesBottom.first()) ? wall.cripplesBottom.bbox().height() : '', wall.cripplesBottom.length ],
        ['opening',  'frame horizontals', 'wood SLS', section, (wall.openingFramesHorizontals.first()) ? wall.openingFramesHorizontals.first().bbox().width() : '', wall.openingFramesHorizontals.length ],
        ['opening',  'frame verticals', 'wood SLS', section, (wall.openingFramesVerticals.first()) ? wall.openingFramesVerticals.first().bbox().height() : '', wall.openingFramesVerticals.length ],
    ])
}

// add boarding
wholeBoards = boards.filter(s => s.bbox().height() === BOARDING_STOCK_HEIGHT && s.bbox().width() === BOARDING_STOCK_WIDTH )
cutBoards = boards.filter(s => s.bbox().height() !== BOARDING_STOCK_HEIGHT || s.bbox().width() !== BOARDING_STOCK_WIDTH)
boardParts = [];

if(wholeBoards && wholeBoards.length > 0){
    boardParts.push(
        ['boards', 'uncut', $BOARDS, `${wholeBoards.first().bbox().width()}x${wholeBoards.first().bbox().height()}`, boardThickness, wholeBoards.length]
    )
}
if(cutBoards && cutBoards.length > 0) // TODO: improve by make.partList non-beam shapes too!
{
    cutBoards.forEach(cutBoard => 
        boardParts.push(
            ['boards', 'cut',  $BOARDS, `${cutBoard.bbox().width()}x${cutBoard.bbox().height()}`, boardThickness, 1]
    ))
}
// aggregate by section
// TODO: something like table.groupBy(...);
boardPartsBySection = {};
boardParts.forEach(row => {
    if (boardPartsBySection[row[3]]){ boardPartsBySection[row[3]][5] += 1;}
    else { boardPartsBySection[row[3]] = row }});
parts = parts.concat(Object.values(boardPartsBySection))


calc.table('parts',
    parts,
    PART_COLUMNS);

//// CAM PIPELINE ////

function docPipeline()
{
    iso = wall.iso().move($WIDTH*2);
    
    dimLevels = [
        { axis :'y', at: 0.1, minDistance: 3, offset: 100, showLine: false }, // cutline slightly above stud
        { axis :'x', at: 0.05, minDistance: 3, offset: 200, showLine: false }
    ]
        ;

    if($OPENING)
    { 
        dimLevels.push( { axis: 'x', at: $OPENING_START+STUD_THICKNESS, align: false, offset: 0, minDistance: STUD_THICKNESS+2, showLine: false }) 
        dimLevels.push( { axis: 'y', at: $OPENING_START+$OPENING_HEIGHT/2, align: false, offset: 0, minDistance:STUD_THICKNESS+2, showLine: false }) 
    }
    layout = wall.elevation('front')
            .moveToOrigin() // center on origin
            .move($WIDTH/2, $HEIGHT/2) // align at x-axis
            .autoDim({ levels: dimLevels, });

    layout.bbox().back().dim({ offset: 100 })
    layout.bbox().right().dim({ offset: 100 })

    // Board saw plan
    sawplan = collection(); // empty
    if(boards.length)
    {
        sawplan = boards.pack({ 
                        autoRotate: false , // not needed, already XY
                        flatten: false,  // not needed, already flat
                        stockWidth: BOARDING_STOCK_WIDTH, 
                        stockHeight: BOARDING_STOCK_HEIGHT, 
                        margin: 5 }).addToScene()
        sawplan.group('bins').dashed();
    }
}

// docPipeline(); // DEBUG DOC PIPELINE


//// SPEC DOC ////
spec = doc
    .create('plan')
    .pipeline(docPipeline)
    .page('main')
    .padding('1cm')
    .titleblock({ title: 'Framed wall', designer: 'traditional', designLicense: 'public', manualLicense: 'CC-BY-NC' })
    .text('Framed Wall', { size: '10mm' })
    .position(0,1.0)
    .text(`${$WIDTH}x${$HEIGHT}x${$DEPTH} - ${STUD_THICKNESS}x${$DEPTH}`, { size: '5mm' })
    .position(0,0.93)
    .view('iso')
    .shapes('iso')
    .pivot('topleft')
    .position(0.13,0.96)
    .width(0.4)
    .height(0.4)
    .text('Material list', { size: '6mm'})
    .position(0,0.33)
    .table('materials', { fontsize: 6 })
    .pivot(0,0)
    .position(0,0.0)
    .height(0.28)
    .width(0.4)
    .text('Cut list', { size: '6mm'})
    .position(0.42,0.38)
    .table('parts', {fontsize: 6 })
    .position(0.42,0.0)
    .pivot(0,0)
    .width(0.35)
    .height(0.32)
    .view('layout')
    .shapes('layout')
    .pivot('topright')
    .position(1,1)
    .width(0.6)
    .height(0.55)
    /*
    .table('pricing',{fontsize: 5.5 })
    .position(0.7,0.4)
    .width(0.3)
    */

if($BOARDS !== 'none')
{
    spec = spec.view('sawplan')
        .pivot('bottomleft')
        .shapes('sawplan')
        .position(0, 0.33)
        .width(0.2)
        .height(0.2)
        .text('sawplan', { size: '5mm'})
        .position(0,0.6)
        .text(`stock ${BOARDING_STOCK_WIDTH}x${BOARDING_STOCK_HEIGHT}`, { size: '3mm'})
        .position(0,0.56)
}

