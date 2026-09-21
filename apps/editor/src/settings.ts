/**
 *  General settings and configuration for the Archiyou web application.
 */

/** Editor version, inlined at build time from apps/editor/package.json (or
 *  VITE_APP_VERSION when set). Falls back to 'dev' where the define is absent
 *  (e.g. vitest without the Vite config). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Overlay menus — percentages of viewport preferred; px accepted too
export const OVERLAY_MENU_WIDTH  = '40vw';
export const OVERLAY_MENU_HEIGHT = '50vh';

// Parameter tabs
export const PARAM_TAB_NAME_MAX_LENGTH       = 15;
export const PARAM_DESCRIPTION_MAX_LENGTH    = 128;

// Editor
import { ScriptParamType } from '@archiyou/core/src/execution/types';
import type { ScriptData } from '@archiyou/core/src/execution/types';


export const EDITOR_START_SCRIPT: ScriptData = 
{
  name: 'untitled',
  code: `// Welcome to Archiyou

// Make a Box and subtract another from it
myMainBox = box($SIZE).color('red');
myMainBox.subtract(
      box($SIZE*0.5).color('blue')
        .name('subBox')
        .moveTo(myMainBox.bbox().corner('leftfronttop'))
        .hide()
    )

// Make its volume a metric - open metric tool to view
calc.metric('Volume', Math.round(myMainBox.volume()), 
            { unit: 'mm2', icon: 'box' }) // some styling

// Generate a simple table with shape name and volume - open data tool to view
calc.table('testTable', 
            all().map((s) => {
              return { name: s.name(), volume: Math.round(s.volume())}
            })); 

// Make a document for it with a isometric view - open documents tool to view
doc.create('myDoc')
.pipeline(() => {
  iso = myMainBox.iso();
  return { iso }
})
.page('myPage')
.titleblock({ title: 'specialBox', designer: 'Archiyou' }) 
.view('isometry')
.shapes('iso')
.text('MyText');
`,
  params: {
    SIZE: {
      type: ScriptParamType.number,
      label: 'Size',
      default: 50,
      schema: { type: 'number', minimum: 0, maximum: 100, multipleOf: 1, default: 50 },
    },
  },
};

// Scene explorer
/** Tree depth shown in the scene-explorer "minimized" view: nodes shallower than
 *  this level stay expanded, deeper nodes are collapsed. 1 = show the direct
 *  children of the main Scene (root) node. */
export const SCENE_EXPLORER_MINIMIZED_TREE_LEVEL = 1;

// 3D viewer

/** Coordinate system of models as exported by the kernel/meshup pipeline.
 *  The viewer configures Three.js to match this system so no per-vertex
 *  remap is needed at runtime — the spatial transform is applied once at
 *  the camera/scene level.
 */
export const VIEWER_MODEL_COORDSYSTEM = { up: 'z', forward: 'y', right: 'x' } as const;

export const VIEWER_BACKGROUND_COLOR = 0xf1f5f9; // scene + renderer clear color (light theme)
export const VIEWER_BACKGROUND_COLOR_DARK = 0x0f172a; // scene + renderer clear color (dark theme)
export const VIEWER_AUTO_FRAME_ON_FIRST_LOAD = true;

// 3D viewer helpers. VIEWER_SCENE_SIZE is the ground-plane size in world units.
export const VIEWER_SCENE_SIZE = 5000;

// Grid auto-sizing (stepped, like the origin gizmo). The grid spans
// VIEWER_GRID_SIZE_FACTOR_FROM_SCENE × the largest model dimension, floored at
// VIEWER_GRID_MIN_SIZE and capped at VIEWER_GRID_MAX_SIZE. The cell size is then
// snapped to a "nice" step (1/2/5/10…) so the grid always holds roughly
// VIEWER_GRID_TARGET_CELLS cells across, whatever the scale.
export const VIEWER_GRID_SIZE_FACTOR_FROM_SCENE = 4;
export const VIEWER_GRID_MIN_SIZE   = 200;
export const VIEWER_GRID_MAX_SIZE   = 100000;
export const VIEWER_GRID_TARGET_CELLS = 40;
// Only rebuild the grid geometry when the scene size moved by more than this
// fraction of the current grid size since the last rebuild, so small parametric
// tweaks don't churn the geometry (mirrors VIEWER_GIZMO_RECALC_FRACTION).
export const VIEWER_GRID_RECALC_FRACTION = 0.2;

// Key directional light for shadow casting.
// VIEWER_LIGHT_POSITION defines the direction and distance from the scene centre
// to the light. At runtime the vector is normalised into a fixed unit direction
// and both the light position and its target are offset from the model centre by
// that same direction — so the shadow angle is always exactly constant, regardless
// of where the model sits in world space or how its bounding box grows.
export const VIEWER_LIGHT_POSITION: [number, number, number] = [1000, -1000, 1000];

// Origin UCS / navigation gizmo
// Positive-arm length in world units at base scale. Because the gizmo is scaled by
// sceneSize × VIEWER_GIZMO_SIZE_FACTOR_FROM_SCENE (= sceneSize/100), this number is
// effectively "percent of the largest model dimension": 10 → each arm is 10% of it,
// so a full axis (solid + dashed half) spans 20%. It was 20 (a 40%-wide gizmo),
// which swallowed small scenes — a 10×20m model got 4m arms across a 10m width.
export const VIEWER_GIZMO_AXIS_LENGTH    = 10;
export const VIEWER_GIZMO_COLOR_X        = 0xFF0000; // red   (+X)
export const VIEWER_GIZMO_COLOR_Y        = 0x00FF00; // green (+Y)
export const VIEWER_GIZMO_COLOR_Z        = 0x0000FF; // blue  (+Z)
export const VIEWER_GIZMO_COLOR_ORIGIN   = 0xFFFFFF; // origin sphere at (0,0,0)
// X/Y/Z letter sprites, world units at base scale (~15% of the arm). They used to
// be 10 — half of the then 20-long arm — which read as huge on a small scene: a
// 10×20m model scales the gizmo to 0.2×, so the letters still stood 2m tall.
export const VIEWER_GIZMO_LABEL_SIZE     = 1.5;
// Clear space between the axis tip and the near edge of the letter, as a fraction
// of the arm length — so the gap stays put when the letter size is retuned.
export const VIEWER_GIZMO_LABEL_GAP_RATIO = 0.05;

// Gizmo arrowhead cone shape, as a fraction of the axis arm length — an arm of 10
// gives a cone height of 10×0.05=0.5 and radius 10×0.01=0.1. Dimension-line
// arrowheads (below) reuse these same ratios so both kinds of arrow look
// identical, just scaled by their own base length.
export const VIEWER_GIZMO_ARROW_LENGTH_RATIO = 0.05;
export const VIEWER_GIZMO_ARROW_RADIUS_RATIO = 0.01;

// Negative (dashed) arm dash pattern, also as a fraction of the arm length, so the
// arms keep reading as dashed at any arm length — ~14 dashes per arm.
export const VIEWER_GIZMO_DASH_SIZE_RATIO = 0.04;
export const VIEWER_GIZMO_DASH_GAP_RATIO  = 0.03;

// Gizmo auto-scaling: scaleFactor = sceneSize * VIEWER_GIZMO_SIZE_FACTOR_FROM_SCENE
// (sceneSize = largest bbox dimension). Calibrated for scene 100 → factor 1
// (scene 1000 → 10×, scene 10 → 0.1×…). Also drives the dimension-line arrow
// scale (see applyAnnotations' arrowScale). Floored at VIEWER_GIZMO_MIN_SCALE
// so a vanishingly small model doesn't shrink the gizmo/arrows to nothing.
export const VIEWER_GIZMO_SIZE_FACTOR_FROM_SCENE = 0.01;
export const VIEWER_GIZMO_MIN_SCALE = 0.1;
// Only recompute the gizmo scale when the scene size changed by more than this
// fraction of itself since the last recalc, so small parametric tweaks don't
// resize it (mirrors VIEWER_GRID_RECALC_FRACTION). This used to be an absolute
// 250 world units, which never fires on a scene measured in metres: a 20m model
// replaced by a 200m one kept the first model's gizmo scale.
export const VIEWER_GIZMO_RECALC_FRACTION = 0.2;

// Dimension lines (3D viewer) — the in-scene line + arrowhead cones.
// Sizes are world units in viewer/model space, same shape ratios as the gizmo
// arrowheads (VIEWER_GIZMO_ARROW_*_RATIO) so both read as the same arrow.
// The value text is an HTML overlay label, styled via CSS in
// `viewer-labels-overlay` (not configured here).
// They share the gizmo's arrow *shape* (the ratios above) but have their own base
// length: how big the UCS should read next to the model and how big a dimension
// arrowhead should be are separate questions, so retuning the arm above must not
// silently resize every dimension line. 20 = the arm length these were tuned at.
export const DIMENSION_LINE_COLOR        = 0x222222; // line + arrowheads
export const DIMENSION_ARROW_BASE_LENGTH = 20;
export const DIMENSION_ARROW_LENGTH      = DIMENSION_ARROW_BASE_LENGTH * VIEWER_GIZMO_ARROW_LENGTH_RATIO; // = 1.0
export const DIMENSION_ARROW_RADIUS      = DIMENSION_ARROW_BASE_LENGTH * VIEWER_GIZMO_ARROW_RADIUS_RATIO; // = 0.2

// Interaction handles
export const VIEWER_HANDLE_DEFAULT_ICON   = 'move';
export const VIEWER_HANDLE_COLOR          = 0x2563EB; // blue-600
export const VIEWER_HANDLE_RANGE_LINE_COLOR  = 0x93C5FD; // blue-300
export const VIEWER_HANDLE_RANGE_LINE_WIDTH  = 2;    // px
export const VIEWER_HANDLE_ICON_SIZE      = 18;        // px — icon box side length


// ── File Manager ──────────────────────────────────────────────────────────────

/**
 * Pipe-separated list of dile-editor toolbar items to disable.
 * Available: bold, italic, code_mark, link, removeLink, image,
 *            unordered_list, ordered_list, lift, paragraph,
 *            h1, h2, h3, h4, code, undo, redo
 */
export const FILE_MANAGER_DISABLED_TOOLBAR_ITEMS = 'image|h4|bold|italic|code|code_mark';

/**
 * Predefined tags that users can select in the file manager.
 * Only these tags are allowed to ensure consistent categorisation.
 */
export const SCRIPT_PREDEFINED_TAGS: string[] = [
  'architecture',
  'parametric',
  'geometry',
  'building',
  'furniture',
  'visualization',
  'tool',
  'example',
  'template',
  'product',
  'structure',
  'interior',
  'landscape',
  'mechanical',
];
