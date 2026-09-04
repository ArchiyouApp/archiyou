// timberwallopenings
// A framed wall whose openings are ONE list-of-objects param instead of four
// scalar ones. Compare with timberwall.js, which can only ever place a single
// opening because every field needs its own param.

units('mm');

$PARAMS.define('WIDTH',  'number', { label: "Width",  units: "mm", default: 4000, min: 1000, max: 8000, step: 10 });
$PARAMS.define('HEIGHT', 'number', { label: "Height", units: "mm", default: 2500, min: 1000, max: 3000, step: 10 });
$PARAMS.define('DEPTH',  'options', { label: "Depth", default: "120", options: ["89","120","140","184","235"] });

// The shape of one opening. Declared in code only — the param menu renders a
// small form per entry from this schema.
$PARAMS.defineObject('Opening', {
    name:   'text',                                                          // used as the row label
    left:   { type:'number', label:'From left', min:0,   max:8000, step:10, default:1000, units:'mm' },
    sill:   { type:'number', label:'Sill',      min:0,   max:3000, step:10, default:900,  units:'mm' },
    width:  { type:'number', label:'Width',     min:100, max:3000, step:10, default:1200, units:'mm' },
    height: { type:'number', label:'Height',    min:100, max:3000, step:10, default:1400, units:'mm' },
});

// A list of them, seeded with two. The user can edit, add, duplicate or remove
// entries in the menu; their edits survive every re-run.
$PARAMS.define('OPENINGS', 'list', {
    of:    'Opening',
    label: 'Openings',
    group: 'Openings',
    default: [
        { name: 'kitchen window', left: 600,  sill: 900, width: 1200, height: 1400 },
        { name: 'door',           left: 2400, sill: 0,   width: 900,  height: 2100 },
    ],
});

STUD_THICKNESS = 38;

wall = make.wall(
            $WIDTH,
            $HEIGHT,
            Number($DEPTH), // options param values are strings
            STUD_THICKNESS,
            610,
            $OPENINGS);

wall.openingDiagrams.hide();
wall.gridlines.hide();

// One drag handle per opening, at its bottom-left corner. Clicking a handle opens that
// entry's form in the param menu; dragging it moves the opening.
//
// OPENINGS[i] binds the handle to ONE entry of the list, and { u:'left' } says which
// property each drag axis feeds. The range is RELATIVE (string bounds), so 'u'/'v' arrive
// as the drag DELTA and are added to the entry's current values — no assumption that a
// property equals a world coordinate. Because the map names the property, the viewer snaps
// and clamps each one against its own schema (step 10, min/max) before writing.
//
// .at() rather than .start(): the viewer keeps a dragged handle where the user put it
// across a re-definition, but these handles must follow the value the script actually got
// after snapping.
$OPENINGS.forEach((o, i) =>
    $handle()
        .param(`OPENINGS[${i}]`, { u: 'left', v: 'sill' })
        .at([o.left, 0, o.sill])
        .along('xz')
        .range([`-${$WIDTH}`, `-${$HEIGHT}`], [`+${$WIDTH}`, `+${$HEIGHT}`])
);
