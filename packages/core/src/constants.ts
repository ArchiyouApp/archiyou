import type { ExecutionRequestOutputFormatGLTFOptions } from "./execution/types";

//// ENGINE VERSION ////

/** The version script modules declare compatibility against via their manifest
 *  `engine` range (see packages/core/src/modules/ModuleRegistry.ts).
 *
 *  Duplicated from package.json rather than imported: core is consumed as raw
 *  TypeScript source by several bundlers, and a JSON import would need resolveJson
 *  plus assertions in every one of them. `tests/unit/modules/version.test.ts`
 *  fails if the two drift. */
export const ARCHIYOU_CORE_VERSION = '0.9.0';

//// MODELER ////

// TODO: can we define these on runtime in Modeler?
export const MODELER_METHODS_INTO_GLOBAL = [
    'units','mode', // meta
    'point', 'vector', 'vertex',
    'line', 'arc', 'spline', 
    'polyline', 'spiral', 'helix',
    'plane', 'planeBetween', 'rect', 'rectBetween', 'basePlane', 'circle',
    'box', 'boxBetween', 'sphere', 'cone', 'cylinder',
    // scene management 
    'layer', 'collection', 'group',
    'layerShapes',
    // sketch
    'sketch', 'all', 'isTemp', 'select', 'atVertices', 'moveTo', 'lineTo', 'splineTo', 'arcTo', 
    'rectTo', 'rect', 'circleTo', 'circle', 'mirror', 'offset', 'offsetted', 'fillet', 'chamfer', 'thicken', 'thickened','combine',
    'close', 'importSketch',
    // export
    'explainIFC',
];

/** The class each modeling factory returns in mesh mode (the default kernel). Modeler
 *  types them with the kernel-neutral AnyKernelShape; the editor's autocomplete, the API
 *  reference (scripts/generate-api.ts) and so the docs site need the concrete class.
 *  Keep in step with the return types in src/modeler/Modeler.ts. Factories that throw in
 *  mesh mode (cone, spiral, helix, basePlane) are deliberately absent. */
export const FACTORY_RETURN_TYPES: Record<string, string> = {
    // 3D shapes
    box:          'Mesh',
    cube:         'Mesh',
    boxBetween:   'Mesh',
    sphere:       'Mesh',
    cylinder:     'Mesh',
    // curves / wires
    line:         'Curve',
    arc:          'Curve',
    spline:       'Curve',
    polyline:     'Curve',
    rect:         'Curve',
    rectBetween:  'Curve',
    circle:       'Curve',
    // planar faces
    plane:        'Polygon',
    planeBetween: 'Polygon',
    // Sketch
    sketch:       'Sketch',
    // Math types
    point:        'Point',
    vertex:       'Vertex',
    vector:       'Vector',
    // Collections / scene
    all:          'ShapeCollection',
    collection:   'ShapeCollection',
    layerShapes:  'ShapeCollection',
    text:         'ShapeCollection',
    layer:        'SceneNode',
};


//// EXECUTION AND OUTPUT SETTINGS ////

export const SCRIPT_OUTPUT_CATEGORIES = ['model','metrics','tables','docs'] // see types: ScriptOutputCategory
export const SCRIPT_OUTPUT_MODEL_FORMATS = ['gltf','glb','step','stl','svg', 'dae', 'obj', 'dxf', 'amf', 'fcstd', 'ifc', 'scad', 'btlx'] // see types: ScriptOutputModelFormat
/** Model formats whose exporter reads shape recipes (see src/modeler/Recipe.ts). A run that
 *  requests one of these records how every shape was made; every other run records nothing. */
export const SCRIPT_OUTPUT_RECIPE_FORMATS = ['fcstd', 'ifc', 'scad', 'btlx']

/** Does any requested output path ask for a format that reads recipes? A model wildcard counts,
 *  because it resolves to every model format. Lives here so the Runner can decide without
 *  loading src/modeler/Recipe.ts. */
export function outputsNeedRecipes(outputs: readonly string[] | null | undefined): boolean
{
    return (outputs ?? []).some(path =>
    {
        const segments = String(path).split('?')[0].split('/');
        if (!segments.includes('model')) return false;
        const format = segments[segments.length - 1];
        return format === '*' || SCRIPT_OUTPUT_RECIPE_FORMATS.includes(format);
    });
}
export const SCRIPT_OUTPUT_METRIC_FORMATS = ['json','xlsx'] // see types: ScriptOutputMetricFormat
export const METRIC_DEFAULT_ICON = 'gauge' // default icon for metrics without an explicit icon set (Lucide icon name)
export const SCRIPT_OUTPUT_TABLE_FORMATS = ['json','xlsx'] // see types: ScriptOutputTableFormat
export const SCRIPT_OUTPUT_DOC_FORMATS = ['json','pdf','svg','svg-pages'] // see types: ScriptOutputDocFormat

/** The output path for a script's thumbnail as an SVG line drawing (see
 *  modeler/SVGExporter.ts) — for headless consumers that want the drawing itself. The app
 *  no longer stores these: its previews are PNGs rendered from the run's GLB by the viewer
 *  (packages/ui model-viewer's renderModelThumbnail). */
export const THUMBNAIL_OUTPUT_PATH =
    'default/model/svg?thumbnail=1&view=iso&hidden=0&square=1&maxBytes=65536'

export const SCRIPT_OUTPUT_GLTF_OPTIONS_DEFAULT = 
{
    edges: true, // show edges by default in glTF output
    animations: false, // export gltf animations. See Layouter.ts
    // archiyou extra data
    annotations: true,
    metrics: true,
    tables: true, // not too big and often handy
    docs: false, // these can be big 
    scenegraph: false,
} as ExecutionRequestOutputFormatGLTFOptions;

//// DOCS ////

export const DOC_DEFAULT_FONT_FAMILY = 'Outfit'
export const DOC_DEFAULT_SVG_FONT_FAMILY = `'${DOC_DEFAULT_FONT_FAMILY}', sans-serif`

/** Logo placed in the default document titleblock. A root-relative path on the app's
 *  own origin: the editor ships this file (apps/editor/public/img/) and every other
 *  Archiyou surface — login, the configurator attribution — already points here.
 *  Same-origin means no CORS, no proxy hop and no CSP `connect-src` allowance, unlike
 *  the third-party CMS url this used to default to.
 *
 *  It follows that this resolves only where there IS an origin: in the browser. A
 *  node-side run (the /execute API asking for doc outputs) has none, so pass an
 *  absolute `logoUrl` to titleblock() there. */
export const DOC_DEFAULT_LOGO_URL = '/img/archiyou_logo_header.png'
export const DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR = 0.9 // mm/cm/inch text heights are mapped to a slightly smaller typographic font-size so visible glyph height better matches the requested physical size
export const DOC_DIMENSION_LINES_TEXT_HEIGHT = 2.5; // in mm
export const DOC_CONTAINER_TITLE_TEXT_HEIGHT = 6; // in mm
export const DOC_CONTAINER_CAPTION_TEXT_HEIGHT = 3; // in mm
export const DOC_CONTAINER_CAPTION_TEXT_PADDING_FACTOR = 2; // applied to text height

//// GLTF ANIMATIONS ////

export const GLTF_ANIMATION_DURATION = 1.0; // in s