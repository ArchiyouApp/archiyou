/**
 * shape-picker — main script (script mode)
 *
 * Declares the plugin's input schema via $PARAMS and generates a primitive
 * shape from it. Plain ESM so it can be loaded at runtime by URL (fetch +
 * dynamic import) with no build step — see the plugin loader.
 *
 * The `code` string is the archiyou script language (same shape as the fixtures
 * in packages/core/tests/cadscripts/scripts). `box`/`sphere`/`cylinder` are
 * scope globals (constants.ts › MODELER_METHODS_INTO_GLOBAL); shapes auto-add
 * to the scene, and `$SHAPE`/`$SIZE` are the current param values.
 */
export default {
  name: 'shape-picker',
  author: 'archiyou',
  description: 'Pick a primitive shape (cube / sphere / cylinder) and generate it.',
  code: `
    units('mm');

    // The input schema — the SHAPE dropdown + a size.
    $PARAMS.define('SHAPE', 'options', {
      options: ['cube', 'sphere', 'cylinder'],
      default: 'cube',
      label: 'Shape',
    });
    $PARAMS.define('SIZE', 'number', {
      minimum: 10, maximum: 300, multipleOf: 10, default: 100,
      label: 'Size', units: 'mm', group: 'Size',
    });

    // Generate the chosen shape.
    if ($SHAPE === 'cube')
    {
      box($SIZE, $SIZE, $SIZE).color('blue');
    }
    else if ($SHAPE === 'sphere')
    {
      sphere($SIZE / 2).color('green');
    }
    else if ($SHAPE === 'cylinder')
    {
      cylinder($SIZE / 2, $SIZE).color('orange');
    }
  `,
  params: {},
};
