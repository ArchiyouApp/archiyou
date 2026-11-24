// timberwall
// Timber frame wall with its layers and screws: the component hsbwand of URBUILD_DATABASE_CORE

$PARAMS.define('WIDTH', 'number', { label: "Width", group: "main", units: "mm", order: 0, default: 3000, minimum: 1000, maximum: 4000, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", group: "main", units: "mm", order: 1, default: 2700, minimum: 1000, maximum: 3000, multipleOf: 1 });
$PARAMS.define('DEPTH', 'options', { label: "Depth", group: "main", order: 2, default: 235, options: [120, 140, 184, 235] });
$PARAMS.define('INSULATION', 'options', { label: "Insulation", group: "layers", order: 3, default: "woodwool", options: ["none", "glasswool", "woodwool", "hempflax"] });
$PARAMS.define('SHEATHING', 'options', { label: "Sheathing (outside)", group: "layers", order: 4, default: "houtvezel16", options: ["none", "houtvezel16", "esb15"] });
$PARAMS.define('MEMBRANE', 'options', { label: "Vapour control (inside)", group: "layers", order: 5, default: "none", options: ["none", "dampremmer"] });
$PARAMS.define('LINING', 'options', { label: "Lining (inside)", group: "layers", order: 6, default: "gips12.5", options: ["none", "gips12.5"] });
$PARAMS.define('TOP_CONNECT', 'boolean', { label: "Double Top", group: "main", order: 7, default: true });
$PARAMS.define('OPENING', 'boolean', { label: "With opening", group: "opening", order: 8, default: false });
$PARAMS.define('OPENING_START', 'number', { label: "Opening start", group: "opening", units: "mm", order: 9, default: 1000, minimum: 0, maximum: 4000, multipleOf: 1 });
$PARAMS.define('OPENING_SILL', 'number', { label: "Opening sill", group: "opening", units: "mm", order: 10, default: 500, minimum: 0, maximum: 3000, multipleOf: 1 });
$PARAMS.define('OPENING_WIDTH', 'number', { label: "Opening width", group: "opening", units: "mm", order: 11, default: 600, minimum: 300, maximum: 3000, multipleOf: 1 });
$PARAMS.define('OPENING_HEIGHT', 'number', { label: "Opening height", group: "opening", units: "mm", order: 12, default: 1000, minimum: 300, maximum: 3000, multipleOf: 1 });
$PARAMS.define('ROOF_HEIGHT', 'number', { label: "Ridge height", group: "roof", units: "mm", order: 13, default: 0, minimum: 0, maximum: 4000, multipleOf: 1 });
$PARAMS.define('ROOF_RIDGE_CENTER', 'number', { label: "Ridge at %", group: "roof", order: 14, default: 0, minimum: 0, maximum: 100, multipleOf: 1 });

//// SETTINGS ////

STUD_THICKNESS = 38;
GRID = 600;                      // studs center to center
COMPONENT = 'hsbwand';           // the component of URBUILD_DATABASE_CORE this wall is

// The layers, by the product of the core sheet they are. Everything else about them (thickness,
// λ, density, CO2, price) comes from the sheet through the product's material.
SHEATHINGS = {
    houtvezel16: { product: 'houtvezel-buitenplaat-16-mg4-635x2510', thickness: 16, board: [2510, 635] },
    // worked as the wood fibre board it replaces (its block has no ESB): not as the gypsum, a plaat too
    esb15: { product: 'esb-15-mg4-675x2580', thickness: 15, board: [2580, 675], recipe: 'houtvezel-buitenplaat-16-mg4-635x2510' },
};
MEMBRANES = { dampremmer: { product: 'dampremmer-1500x50000', thickness: 0.2 } };
LININGS = { 'gips12.5': { product: 'gipsplaat-12.5-1200', thickness: 12.5 } };
// the mat for the cavity, by its depth where known: cut at an angle (a gable), a piece can look thinner
WOODWOOL_MATS = { 120: 'houtvezel-flex-120', 140: 'houtvezel-flex-140', 184: 'houtvezel-flex-200', 235: 'houtvezel-flex-240' };
INSULATION_PRODUCTS = { woodwool: WOODWOOL_MATS[$DEPTH] ?? 'HOUTVEZEL-FLEX', hempflax: 'HENNEP', glasswool: 'GLASWOL-ROL' };

// The screws: what goes where, as the block of hsbwand describes it
SCREWS = {
    frame: { product: 'schroef-rvs-6x100', pattern: 'end', count: 2, label: 'regels op de stijlen' },        // 2 through a plate into each stud end
    double: { product: 'schroef-rvs-5x60', pitch: 400, label: 'dubbele bovenregel' },                       // the double top plate: 60 mm, so it stays in the plate below
    sheathing: { product: 'schroef-rvs-4.5x50', pitch: 150, label: 'buitenplaat op het frame' },                   // the outside board on studs and plates
    lining: { product: 'schroef-verzinkt-4x40', pitch: 200, label: 'binnenplaat op het frame' },                   // gypsum: about 12 a m2
};
TAPE = 'tape-universeel-60';

//// VARIANTS ////
// The variants of this component, each a block of the core sheet's componenten tab: a preset
// with the reference size and its layers. The blocks are made from these by running the script
// per preset (archiyou components timberwall.js); the preset's name is the component's id.

REFERENCE = { WIDTH: 3000, HEIGHT: 2700, TOP_CONNECT: true, OPENING: false, ROOF_HEIGHT: 0, MEMBRANE: 'none' };
$PARAMS.preset('hsbwand', { ...REFERENCE, DEPTH: 235, INSULATION: 'woodwool', SHEATHING: 'houtvezel16', LINING: 'gips12.5' },
    { label: 'HSB wand 235, houtvezel' });
$PARAMS.preset('hsbwand_esb', { ...REFERENCE, DEPTH: 235, INSULATION: 'woodwool', SHEATHING: 'esb15', LINING: 'gips12.5' },
    { label: 'HSB wand 235, houtvezel, ESB', variantOf: 'hsbwand' });
$PARAMS.preset('hsbwand_140', { ...REFERENCE, DEPTH: 140, INSULATION: 'woodwool', SHEATHING: 'houtvezel16', LINING: 'gips12.5' },
    { label: 'HSB wand 140, houtvezel', variantOf: 'hsbwand' });

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

ridge = { height: $ROOF_HEIGHT, center: $ROOF_RIDGE_CENTER/100 };
FRAME_HEIGHT = $HEIGHT - $TOP_CONNECT*STUD_THICKNESS;   // make.wall's height; the double top plate goes on top

//// WALL FRAME ////

// Interactive dim lines
line([0,0,0],[$WIDTH,0,0])
    .hide()
    .dim( { offset: 600 })
        .bindParam('WIDTH');

line([$WIDTH,0,0],[$WIDTH,0,$HEIGHT])
    .hide()
    .dim( { offset: 600 })
    .bindParam('HEIGHT');

wall = modeler.make.wall(
                $WIDTH,
                FRAME_HEIGHT,
                $DEPTH,
                STUD_THICKNESS,
                GRID,
                ($OPENING) ? openings : [],
                ridge
);

wall.openingDiagrams.hide();
wall.diagram.hide();
if($INSULATION == 'none'){ wall.insulation.hide () };

// make extra connecting top-plate
topDouble = null;
if($TOP_CONNECT)
{
    topDouble = boxbetween([0,-$DEPTH/2,0],[$WIDTH,$DEPTH/2, STUD_THICKNESS])
            .move(0,0,$HEIGHT-STUD_THICKNESS)
            .color('green')
            .name('topdouble');
    wall.plates.add(topDouble);
}

// every member of the frame, and the ones lying flat and standing up
horizontals = collection(wall.plates, wall.openingFramesHorizontals);
verticals = collection(wall.studs, wall.cripplesTop, wall.cripplesBottom, wall.openingFramesVerticals, wall.openingKingStuds, wall.openingJackStuds);
frame = collection(horizontals, verticals);

//// LAYERS ////
// Panels over the whole wall, the shape of its elevation (with the gable when there is a ridge),
// without the opening. Outside is -y, inside +y.

/** A panel of the wall's elevation, `thickness` thick, from y = `at` towards `side` (-1 out, 1 in) */
function panel(thickness, at, side)
{
    const outline = ($ROOF_HEIGHT > 0)
        ? [[0, at, 0], [$WIDTH, at, 0], [$WIDTH, at, FRAME_HEIGHT], [$WIDTH*$ROOF_RIDGE_CENTER/100, at, FRAME_HEIGHT + $ROOF_HEIGHT], [0, at, FRAME_HEIGHT]]
        : [[0, at, 0], [$WIDTH, at, 0], [$WIDTH, at, $HEIGHT], [0, at, $HEIGHT]];
    const p = modeler.polygon(outline).extrude(thickness, [0, side, 0]);
    if($OPENING)
    {
        p.subtract(boxbetween([$OPENING_START, at - 1000, $OPENING_SILL], [$OPENING_START + $OPENING_WIDTH, at + 1000, $OPENING_SILL + $OPENING_HEIGHT]).tmp());
    }
    return p;
}

sheathingSpec = SHEATHINGS[$SHEATHING];
membraneSpec = MEMBRANES[$MEMBRANE];
liningSpec = LININGS[$LINING];

sheathing = sheathingSpec ? panel(sheathingSpec.thickness, -$DEPTH/2, -1).name('sheathing') : null;
membrane = membraneSpec ? panel(membraneSpec.thickness, $DEPTH/2, 1).name('membrane').opacity(0.5) : null;
lining = liningSpec ? panel(liningSpec.thickness, $DEPTH/2 + (membraneSpec?.thickness ?? 0), 1).name('lining') : null;

//// SCREWS ////
// Drawn as a circle on the face each goes in at and a line along its length (make.fasten)

screws = [
    make.fasten(horizontals, verticals, { ...SCREWS.frame, component: COMPONENT }),
    topDouble ? make.fasten(topDouble, wall.plates.filter(p => p !== topDouble), { ...SCREWS.double, component: COMPONENT }) : null,
    sheathing ? make.fasten(sheathing, frame, { ...SCREWS.sheathing, component: COMPONENT }) : null,
    lining ? make.fasten(lining, frame, { ...SCREWS.lining, component: COMPONENT }) : null,
].filter(Boolean);

//// CAM PIPELINE ////

function docPipeline()
{
    dimLevels = [
        { axis :'y', at: 0.1, minDistance: 3, offset: 100, showLine: false }, // cutline slightly above stud
        { axis :'x', at: 0.05, minDistance: 3, offset: 200, showLine: false }
    ];

    if($OPENING)
    {
        dimLevels.push( { axis: 'x', at: $OPENING_START+STUD_THICKNESS, align: false, offset: 0, minDistance: STUD_THICKNESS+2, showLine: false })
        dimLevels.push( { axis: 'y', at: $OPENING_START+$OPENING_HEIGHT/2, align: false, offset: 0, minDistance:STUD_THICKNESS+2, showLine: false })
    }
    layout = wall.elevation('front')
            .moveTo(0,0,0) // center on origin
            .move($WIDTH/2, $HEIGHT/2) // align at x-axis
            .autoDim({ levels: dimLevels, });
}

//// SPEC DOC ////

spec = doc
    .create('plan')
    .pipeline(docPipeline)
    .page('main')
    .size('A4')
    .padding('1cm')
    .titleblock(
      { title: 'Framed wall', designer: 'traditional',
          designLicense: 'public', manualLicense: 'CC-BY-NC' })
    // at 1:25, or 1:50 (1:100) for a wall too long for the page at 1:25
    .view('elevation', { scale: [1/10, 1/20, 1/25, 1/30, 1/40, 1/50, 1/100], caption: true })
    .shapes('layout')
    .pivot('topleft')
    .position(0.0,1.0)
    .width(1.0)
    .height(1.0)

//// PRODUCTS ////
// What the parts are, as products of the make database (URBUILD_DATABASE_CORE), in its component
// hsbwand: its rows give their recipes. A model using this wall reckons with them in make.takeoff().
// The wall draws all of its layers and screws; complete() only adds the work on the element as a
// whole (squaring, handling, mounting) and what a layer left out would have had.

// finger-jointed only where longer than SLS comes
frame.product(['SLS', 'SLS-GEVINGERLAST'], { component: COMPONENT, label: 'stijlen en regels' });
if(INSULATION_PRODUCTS[$INSULATION])
{
    // by a group, a mat of 240 fills a cavity of 235
    wall.insulation.product(INSULATION_PRODUCTS[$INSULATION], { component: COMPONENT, tolerance: 5, label: 'isolatie tussen de stijlen' });
}
if(sheathing) { sheathing.product(sheathingSpec.product, { component: COMPONENT, label: 'buitenplaat', recipe: sheathingSpec.recipe }); }
if(membrane) { membrane.product(membraneSpec.product, { component: COMPONENT, label: 'dampremmende folie' }); }
if(lining) { lining.product(liningSpec.product, { component: COMPONENT, label: 'binnenplaat' }); }

// Tape: the seams of the outside boards (lying, in rows) taped in the workshop, and the edges
// of the element taped on site
wallAreaM2 = ($WIDTH*$HEIGHT + $WIDTH*$ROOF_HEIGHT/2 - (($OPENING) ? $OPENING_WIDTH*$OPENING_HEIGHT : 0)) * 1e-6;
if(sheathing)
{
    const [boardLength, boardHeight] = sheathingSpec.board;
    const rows = Math.ceil($HEIGHT / boardHeight);
    const seams = (rows - 1) * $WIDTH + rows * (Math.ceil($WIDTH / boardLength) - 1) * boardHeight;
    const edges = 2 * ($WIDTH + $HEIGHT);
    make.add(TAPE, { lengte: (seams + edges) / 1000 }, { component: COMPONENT, label: 'plaatnaden en elementomtrek' });
}

// what this wall leaves out or replaces, so complete() does not add the block's own
BLOCK_SHEATHING = SHEATHINGS.houtvezel16.product;
leftOut = [
    ...(sheathing ? [] : [SCREWS.sheathing.product, TAPE]),
    ...(sheathingSpec?.product === BLOCK_SHEATHING ? [] : [BLOCK_SHEATHING]),
    ...(lining ? [] : ['gipsplaat-12.5-1200', SCREWS.lining.product]),
];
make.complete(COMPONENT, { oppervlak: wallAreaM2 }, { except: leftOut });
