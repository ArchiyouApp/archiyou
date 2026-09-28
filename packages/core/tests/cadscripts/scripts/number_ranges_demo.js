// number_ranges_demo
// The 'number-ranges' param: one slider with two handles.
//  - mode 'split' gives the three parts between start, handle 1, handle 2 and end.
//    They always add up to maximum - minimum: here [25, 50, 25] of 100%.
//  - mode 'range' gives the stretch between the two handles: [from, to].

WALL_HEIGHT = 2700;
THICKNESS = 200;

$PARAMS.define('LENGTH', 'number', { label: 'Wall length', units: 'mm', minimum: 3000, maximum: 12000, multipleOf: 100, default: 6000 });

$PARAMS.define('BAYS', 'number-ranges', {
    label: 'Bays (%)',
    mode: 'split',
    minimum: 0, maximum: 100, multipleOf: 1,
    minSpan: 10, // no bay narrower than 10%
    labels: ['Closed', 'Glazed', 'Closed'],
    default: [25, 50, 25],
});

$PARAMS.define('WINDOW', 'number-ranges', {
    label: 'Window sill to head',
    mode: 'range',
    units: 'mm',
    minimum: 0, maximum: WALL_HEIGHT, multipleOf: 50,
    minSpan: 300, // a window of at least 300 mm
    default: [900, 2100],
});

const [leftPct, glazedPct, rightPct] = $BAYS;
const [sill, head] = $WINDOW;

const left = $LENGTH * leftPct / 100;
const glazed = $LENGTH * glazedPct / 100;
const right = $LENGTH * rightPct / 100;

/** A piece of wall from x over a length, between two heights */
function wallPart(x, length, from, to)
{
    return box(length, THICKNESS, to - from).moveTo(x + length / 2, 0, from + (to - from) / 2);
}

// Closed bays
wallPart(0, left, 0, WALL_HEIGHT).color('grey');
wallPart(left + glazed, right, 0, WALL_HEIGHT).color('grey');

// Glazed bay: parapet, glass and lintel
if (sill > 0) wallPart(left, glazed, 0, sill).color('darkgrey');
box(glazed, 20, head - sill).moveTo(left + glazed / 2, 0, sill + (head - sill) / 2).color('lightblue');
if (head < WALL_HEIGHT) wallPart(left, glazed, head, WALL_HEIGHT).color('darkgrey');
