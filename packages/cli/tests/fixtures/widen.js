// widen: the plate's width as a parameter sweep, for the CLI tests
units('mm');
$PARAMS.define('WIDTH', 'number', { min: 100, max: 400, step: 10, default: 200 });

blockL = boxbetween([0, 0, 0], [40, 100, 50]).name('blockL');
blockR = boxbetween([$WIDTH - 40, 0, 0], [$WIDTH, 100, 50]).name('blockR');
plate = boxbetween([0, 0, 50], [$WIDTH, 100, 60]).name('plate');

widths = animator.create('widths').param('WIDTH', { from: 100, to: 400, frames: 4 }).duration(2);
