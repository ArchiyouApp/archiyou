// timberfloor
// Basic timber frame floor with extra documentation like construction calculations

$PARAMS.define('WIDTH', 'number', { label: "Width", units: "cm", order: 0, default: 300, minimum: 150, maximum: 500, multipleOf: 1 });
$PARAMS.define('DEPTH', 'number', { label: "Depth", units: "cm", order: 0, default: 300, minimum: 200, maximum: 500, multipleOf: 1 });
$PARAMS.define('BEAM_CTC', 'number', { label: "Beam distance (CTC)", units: "cm", order: 0, default: 60, minimum: 20, maximum: 120, multipleOf: 1 });
$PARAMS.define('BEAM_AUTO', 'boolean', { label: "Beam section auto", order: 0, default: true });
$PARAMS.define('BEAM_WIDTH', 'number', { label: "Beam Width", units: "mm", order: 0, default: 38, minimum: 38, maximum: 100, multipleOf: 1 });
$PARAMS.define('BEAM_HEIGHT', 'number', { label: "Beam Height", units: "mm", order: 0, default: 140, minimum: 1, maximum: 300, multipleOf: 1 });
$PARAMS.define('JOIST_HEADER', 'boolean', { label: "With joist header", order: 0, default: true });
$PARAMS.define('HIDE_BOARDS', 'boolean', { label: "Hide boards", order: 0, default: true });

// Archiyou 0.5

// PARAMS
WIDTH = $WIDTH*10; // in mm 
DEPTH = $DEPTH*10 // in mm

BEAM_CTC = $BEAM_CTC*10; // in mm

SUPPORT_WIDTH = 100;
SUPPORT_HEIGHT = 200;

// PARAMS BEHAVIOUR
// Enable beam width and height is not auto
$PARAMS.BEAM_HEIGHT.enableIf(!$BEAM_AUTO);
$PARAMS.BEAM_WIDTH.enableIf(!$BEAM_AUTO);

// MATERIAL SETTINGS
/*
    overview SLS/CLS Classes: http://onlinestructuraldesign.com/calcs/Wood_documentation/Wood_element_EN338_Table1.htm
    beam formulas: https://engineering.purdue.edu/~ce474/Docs/DA6-BeamFormulas.pdf
    inertia formulas: https://www.structuralbasics.com/moment-of-inertia-formulas/

*/
WOOD_DENSITY =  380 // for C18 in kg/m3
BOARD_DENSITY = 600 // kg/m3

FLOOR_DENSITY = 1000; // kg/m3

BOARD_THICKNESS = 18;
FLOOR_THICKNESS = 30;

WOOD_ELASTIC_MODULUS = 9; // kN/mm2 = 9000 MPa
WOOD_MAX_COMPRESSION_PARALLEL = 18; // N/mm2
BOARD_ELASTIC_MODULUS = 9; 

LOADS_VARIABLE_PER_M2 = 2000; // N/m2
LOADS_PERMANENT_SAFETY_FACTOR = 1.35;
LOADS_VARIABLE_SAFETY_FACTOR = 1.5;

// HEURISTIC DESIGN SETTINGS
CLS_SLS_HEIGHTS = [89,120,140,170,194,235,285]
HEURISTIC_SPAN_TO_BEAM_HEIGHT = 1/20;
BEAM_HEIGHT_TO_BEAM_WIDTH = 1/3;

// CALCULATION BEAM SECTION
if($BEAM_AUTO)
{
    BEAM_HEIGHT = CLS_SLS_HEIGHTS.find(h => h >= Math.ceil(WIDTH*HEURISTIC_SPAN_TO_BEAM_HEIGHT));
    BEAM_WIDTH = 38;
}
else {
    BEAM_HEIGHT = $BEAM_HEIGHT;
    BEAM_WIDTH = $BEAM_WIDTH;
}
SPAN = WIDTH - $JOIST_HEADER*BEAM_WIDTH*2; // if joist header span is a bit smaller


layer('model').color('red');

//// MODEL ////

boards = rectbetween([-WIDTH/2,0, BEAM_HEIGHT], [WIDTH/2,DEPTH, BEAM_HEIGHT])
                .moveZ(SUPPORT_HEIGHT)
                .extrude(BOARD_THICKNESS)
                .color('green')

if($HIDE_BOARDS){ boards.hide() };

floorDiagram = boards
                .select('F||bottom')
                .toMesh()
                .edges()
                .color('blue')

// INTERACTIVE DIMENSIONS //

floorDiagram.select('E||left')
        .dim( { offset: 500})
        .bindParam('DEPTH')

floorDiagram.select('E||front')
        .dim( { offset: 500})
        .bindParam('WIDTH')

beam = box(SPAN, BEAM_WIDTH, BEAM_HEIGHT)
        .moveZ(BEAM_HEIGHT/2 + SUPPORT_HEIGHT)
        .moveY(BEAM_WIDTH/2)

if($JOIST_HEADER)
{
    joistHeaderLeft = boxbetween([-WIDTH/2,0,0],[-WIDTH/2+BEAM_WIDTH, DEPTH, BEAM_HEIGHT])
                    .moveZ(SUPPORT_HEIGHT)
                    .color('blue')
    joistHeaderRight = joistHeaderLeft.copy().move(SPAN+BEAM_WIDTH).color('blue')
}

numBeams = Math.floor( (DEPTH-BEAM_WIDTH) / BEAM_CTC) + 1;
baseBeams = beam.array([1,numBeams], [0, BEAM_CTC])

// Only make last beam if there is enough space > BEAM_WIDTH
if((DEPTH - (numBeams-1)*BEAM_CTC-BEAM_WIDTH) >= BEAM_WIDTH)
{
    lastBeam = beam.copy().moveY(DEPTH-BEAM_WIDTH)
    numBeams++;
}

floor = all();

supportLeft = boxbetween([0,0,0],[SUPPORT_WIDTH,DEPTH,SUPPORT_HEIGHT])
            .move(-WIDTH/2)
            .color('grey')
            
supportRight = supportLeft.copy().move(WIDTH-SUPPORT_WIDTH)
                .color('grey')

//// TABLES ////
baseCalculationColumns = ['part', 'property', 'symbol', 'value', 'unit']
baseCalculationRows = [
    ['joist', 'height', 'hj', hj = BEAM_HEIGHT, 'mm'],
    ['joist', 'width', 'wj', wj = BEAM_WIDTH, 'mm'],
    ['joist', 'span', 'l', SPAN, 'mm'],
    ['joist', 'distance ctc', 'ctc', BEAM_CTC, 'mm'],
    ['joist', 'density', 'dj', WOOD_DENSITY, 'kg/m3'  ],
    ['joist', 'moment of inertia', 'I = wj * hj^3 / 12 ', I = Math.round((wj)*Math.pow(hj,3)/12), 'mm4'  ],
    ['joist', 'joist mass per m floorspan', 
        `mj = wj*hj*10^-6*1m*dj
=${BEAM_HEIGHT}mm*${BEAM_WIDTH}mm*10^-6*1m*${WOOD_DENSITY}kg/m3`, 
        mj = Math.round(BEAM_HEIGHT*BEAM_WIDTH*WOOD_DENSITY * 1e-6), 'kg/m'],
    ['joist', 'joist weight per m floorspan', 'gj ~= mj * 10',
            gj = mj*10, 'N/m'],
    ['boards', 'thickness', 'hb', BOARD_THICKNESS, 'mm'],
    ['boards', 'width', 'wb', BEAM_CTC, 'mm'],
    ['boards', 'density', 'ρb', BOARD_DENSITY, 'kg/m3'  ],
    ['boards', 'board mass per m floorspan', 
        `mb = hb*wb*db
=${BOARD_THICKNESS}mm*${BEAM_CTC}mm*10^-6*1m*${BOARD_DENSITY}`, 
        mb = Math.round(BOARD_THICKNESS*BEAM_CTC*BOARD_DENSITY * 1e-6), 'kg/m'],
    ['boards', 'board weight per m floorspan', 
        `gb ~= mb * 10`, 
        gb = mb*10, 'N/m'],
]


calc.table('part properties', baseCalculationRows, baseCalculationColumns)


totalMass = roundTo(beam.volume()*1e-9*WOOD_DENSITY*numBeams
                + boards.volume()*1e-9*BOARD_DENSITY
                + $JOIST_HEADER*joistHeaderLeft.volume()*1e-9*WOOD_DENSITY*2,
                2)
// Linear load on 1m of support 
totalLiveLoad = (DEPTH*SPAN*1e-6)*LOADS_VARIABLE_PER_M2; // in N
totalDeadLoad = totalMass*10; // in N (kg ~ N * 10)
supportLineLoad = Math.round((totalLiveLoad + totalDeadLoad)*0.5 / (DEPTH/1000)); // N / m

loadColumns = ['load', 'calculation', 'value', 'unit', 'notes']
loadRows = [
    ['LOADS', '', '', '', ''], 
    ['extra floor weight finish per m', `gf = G fl * ctc = 500 N/m2 * ${BEAM_CTC/1000} m`, gf = roundTo(500*(BEAM_CTC/1000),0), 'N/m', 'floor or ceiling finishes (example)'],
    ['total dead weight per m span', `G = gj + gb + gf = ${gj} + ${gb} + ${gf}`, G = gj+gb+gf, 'N/m', ''],
    ['live load', `Q = ${LOADS_VARIABLE_PER_M2} N/m2 * ctc = ${LOADS_VARIABLE_PER_M2} N/m2 * ${BEAM_CTC/1000}m`, 
        Q = LOADS_VARIABLE_PER_M2*(BEAM_CTC/1000), 'N/m', `${LOADS_VARIABLE_PER_M2} N/m2 is example value. Check local one.`],
    ['LOAD COMBINATIONS', '', '', '', ''],
    ['Please use load combinations and factors of your local building code', '','', '',''],
    ['general', `F = G + Q = ${G} + ${Q}`, F = G+Q, 'N/m', '', ''],
    ['CONSTRUCTION UNDER LOAD', '', '', '', ''],
    ['max joist moment under total load (center)', `M max = 1/8*(F*span^2)
= 1/8*(${F} N/m2* ${SPAN/1000}m^2)`, 
                Mmax = roundTo((F*(SPAN/1000*SPAN/1000))/8,0 ), 'Nm', 'See basic beam formulas under uniformly distributed load'],
    [ 'max joist tension under total load', `sigma max = 6*M max/ wj*hj^2 
= 6 * ${Mmax} Nm * 10^3 / ${wj}mm * ${hj}mm^2`, 
            Tm = roundTo(6*Mmax*1e3 / (wj*hj*hj),2), 'MPa', 'MPa = 1x10^3kN/m2 (1Pa = 1 N/m2)'],
    [ 'tensile strengh (parallel to grain)', `ft = ${WOOD_MAX_COMPRESSION_PARALLEL} N/mm2`, 
        ft = roundTo(WOOD_MAX_COMPRESSION_PARALLEL,2), 'MPa', 'softwood C18 strength class'], 
    [ 'joist tension versus tensile strength', 'sigma perc = sigma max / ft', tensionPerc = Math.round(Tm/ft*100), '%', 'please add local safety factors'],
    [ 'joist max deflection (at center)', `delta max = 5/384 * F * span^4 / E * I = 5/384 * ${F} N/m * ${SPAN/1000} m^4 / ${WOOD_ELASTIC_MODULUS*1e6} N/mm2 * ${I}`,
            defl = roundTo( (5*F*Math.pow(SPAN,4)) / (384*WOOD_ELASTIC_MODULUS*1e6*I),2), 'mm', 'See basic beam formulas under uniformly distributed load' 
    ],
    [ 'floor total mass', '', totalMass, 'kg', 'joists and boards (18mm)'],
    [ 'support load 1m', '', supportLineLoad, 'N/m', ''],
]

calc.table('loads and calculations', loadRows, loadColumns)

// Parts

section = `${BEAM_WIDTH}x${BEAM_HEIGHT}`;

partRows = [
    [ 'joist','C18 CLS/SLS timber',section, SPAN, numBeams]
];

if($JOIST_HEADER)
{ 
    partRows.push(
        ['joist header', 'C18 CLS/SLS timber', section, DEPTH, 2]
    )
}
partRows.push(
    ['boards', 'OSB/multiplex', '18mm', '', `~${Math.round(WIDTH*DEPTH*1e-6)} m2`]
)


calc.table('parts', partRows,
[ 'part', 'material', 'section', 'length', 'quantity'])



//// METRICS ////

calc.metric('Beam height', BEAM_HEIGHT, { icon: 'selection', unit: 'mm' } )
calc.metric('Beam width', BEAM_WIDTH, { icon: 'selection', unit: 'mm' })
//calc.metric('Joist max deflection', defl, { 'unit': 'mm'} )
//calc.metric('Joist max tension', tensionPerc, { 'unit': '%' } )
calc.metric('Total mass', Math.round(totalMass), { icon: 'weight', unit: 'kg' })
calc.metricsToTable();

//// DOC PIPELINE ///

function docPipeline()
{   
    iso = floor.iso().moveY(-3000)
    top = floor.elevation('top')
            .moveY(-6000)

    top.bbox().left().dim({ offset: 100})
    top.bbox().back().dim({ offset: 100 })
    top.autoDim({ levels: [{ axis: 'x', at: 0.9, offset: 200 },
                           { axis: 'y', at: 0.01, offset: 200 }
                    ] })
}

// docPipeline(); // DEBUG

doc
    .page('spec')
    .titleblock({ title: 'Timber Floor', designer: 'Archiyou' } )
    .pipeline(docPipeline)
    .view('iso')
    .shapes('iso')
    .width(0.35)
    .height(0.35)
    .position(0, 1)
    .view('top')
    .shapes('top')
    .width(0.35)
    .height(0.35)
    .pivot(0,0)
    .position(0, 0.25)
    .text('Parts', { 'fontsize': '1cm' })
    .position(0,0.21)
    .table('parts', { fontsize: 7 })
    .position(0,0.15)
    .width(0.35)
    .height(0.2)
    .text('Part properties', { 'fontsize': '1cm' })
    .position(0.4, 0.42)
    .pivot(0,1)
    .table('part properties', { fontsize: 5 })
    .width(0.35)
    .height(0.5)
    .pivot(0,1)
    .position(0.4, 0.35)
    .text('Example calculation', { 'fontsize': '1cm' })
    .pivot(0,1)
    .position(0.4,1)
    .table('loads and calculations', { fontsize : 5 })
    .position(0.4,0.92)
    .width(0.6)
    .height(0.7)


