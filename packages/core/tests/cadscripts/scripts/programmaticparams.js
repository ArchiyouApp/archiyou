// programmaticparams
// A box whose params and a preset are defined entirely in code via $PARAMS.define()/$PARAMS.preset().

units('mm');

// The script spawns its own params — no external param data needed.
$PARAMS.define('WIDTH',  'number',  { minimum: 20, maximum: 400, multipleOf: 10, default: 200, group: 'Size' });
$PARAMS.define('DEPTH',  'number',  { minimum: 20, maximum: 400, multipleOf: 10, default: 120, group: 'Size' });
$PARAMS.define('HEIGHT', 'number',  { minimum: 20, maximum: 400, multipleOf: 10, default: 80,  group: 'Size' });
$PARAMS.define('SHOW_LID', 'boolean', { default: true });

// A named preset (combination of values), also declared in code.
$PARAMS.preset('SMALL', { WIDTH: 80,  DEPTH: 60,  HEIGHT: 40 }, { description: 'Compact version' });
$PARAMS.preset('LARGE', { WIDTH: 400, DEPTH: 300, HEIGHT: 200 });

// The defined params are immediately usable in the same run.
base = box($WIDTH, $DEPTH, $HEIGHT).color('blue');

if ($SHOW_LID)
{
    box($WIDTH, $DEPTH, 5).moveZ($HEIGHT / 2 + 5).color('red');
}
