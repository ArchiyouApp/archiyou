// plate: a plate on two blocks, for the CLI tests
units('mm');
$PARAMS.define('WIDTH', 'number', { min: 100, max: 400, step: 10, default: 200 });
$PARAMS.define('TOP', 'boolean', { default: true });

blockL = boxbetween([0, 0, 0], [40, 100, 50]).name('blockL');
blockR = boxbetween([$WIDTH - 40, 0, 0], [$WIDTH, 100, 50]).name('blockR');
if ($TOP) { plate = boxbetween([0, 0, 50], [$WIDTH, 100, 60]).name('plate'); }
print('width', $WIDTH);
