// Mesh kernel — type-only import: keep this module free of a runtime meshup load, as it is
// imported very early/broadly across core and a value import would force meshup to initialize
// at a bad point in the module graph (circular Vertex↔Shape init).
import type * as meshup from '@archiyou/meshup'

import { type Static } from 'typebox'
import { ModelUnitsSchema, ModelModeSchema, MainAxisSchema } from './schemas'
import type { Part } from './parts'


//// SHAPE TYPES ////
// The modeler works with plain meshup shapes directly (the old Smart* wrapper layer is gone).

/** Any concrete meshup shape (Vertex | Curve | Polygon | Mesh). */
export type AnyShape = meshup.Shape

/** A meshup ShapeCollection. Named for symmetry with AnyShape; the BREP kernel
 *  had an identically-named type, so prefer these aliases in modeler/annotator
 *  code to make the kernel unambiguous. */
export type AnyShapeCollection = meshup.ShapeCollection

/** Either a single shape or a collection — what most modeller/annotator entry
 *  points accept. */
export type AnyShapeOrCollection = meshup.Shape | meshup.ShapeCollection

/** Duck-typed guard for a single meshup shape (true for Vertex/Curve/Polygon/Mesh, false for
 *  a ShapeCollection). Avoids a runtime meshup import here — see the note above. */
export function isAnyShape(o: any): o is meshup.Shape
{
    return o != null
        && typeof o === 'object'
        && typeof o.isShapeClass === 'function'
        && o.isShapeClass() === true
        && o.isShapeCollection?.() !== true
}

/** Serialised SceneNode subtree (re-export of meshup's, mirrors the viewer path builder). */
export type { SceneNodeData } from '@archiyou/meshup'


// Infer from typebox schemas
export type ModelUnits = Static<typeof ModelUnitsSchema>
export type ModelMode = Static<typeof ModelModeSchema>
export type MainAxis = Static<typeof MainAxisSchema>
export type LayoutAnimationInterpolation = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'spring'

export interface KernelClasses {
    Point:      typeof meshup.Point
    Vector:     typeof meshup.Vector
    Vertex:     typeof meshup.Vertex
    Shape:      typeof meshup.Shape
    Curve:      typeof meshup.Curve
    Mesh:       typeof meshup.Mesh
    ShapeCollection: typeof meshup.ShapeCollection
    Bbox:       typeof meshup.Bbox
}

//// SPECIAL ANIMATION OUTPUTS ////

export interface ExplodedViewOptions
{
    /** Distance to push each shape from its original position along the origin→pivot direction. Leave empty for automatic */
    distance?: number
}

/** How a text run is rendered by {@link Modeler.text}. */
export type ModelerTextStyle = 'outline' | 'solid' | 'stroke' | 'engrave'

/** Options for {@link Modeler.text}. */
export interface ModelerTextOptions
{
    /** Rendering style. Default `'outline'`. */
    style?: ModelerTextStyle
    /** Glyph size (point size for outline/solid, scale for stroke). */
    size?: number
    /** Extrusion depth for `'solid'`. Default 2. */
    depth?: number
    /** Horizontal alignment about the origin. Default `'left'`. */
    align?: 'left' | 'center' | 'right'
    /** Position to move the finished text to (XY-plane layout). */
    at?: meshup.PointLike
    /** Font: for outline/solid — raw TTF/OTF bytes or a name registered via
     *  `loadFont()` (omitted → bundled default). For stroke — a bundled Hershey
     *  name or raw `.jhf` text (omitted → `'sans'`). */
    font?: string | Uint8Array | ArrayBuffer
}

/**
 * Options for `Modeler.toGLB()` / `toGLTF()` (see `_exportGLBWithOptions`).
 *
 * `duration` and `interpolation` are only read when `animations` is set — they
 * are handed straight to `GLTFBuilder.addAnimations()`, which is why they mirror
 * `LayoutAnimationOptions` rather than nesting under it.
 */
export interface ModelerSceneExportGLTFOptions
{
    /** Bake the `exploded` and `layout` layouter animations into the GLB. Default false. */
    animations?: boolean
    /** Animation length in seconds. Default `GLTF_ANIMATION_DURATION`. */
    duration?: number
    /** Easing for the baked animations. Default `'easeInOut'` (GLTFBuilder's fallback). */
    interpolation?: LayoutAnimationInterpolation
    /** Write the annotator's annotations into the GLTF extras alongside the scenegraph.
     *  Default false — an unannotated export carries an empty list. */
    annotations?: boolean
    /** Bake an instructable into the GLB: one continuous assembly animation, a camera per
     *  step, and the step data in `extras.instruct`. Name one, or `true` for the first.
     *  Default off. See GLTFBuilder.addInstruct(). */
    instruct?: string | boolean
    /** Write a glTF camera per instruct step. Default true when `instruct` is set. */
    instructCameras?: boolean
}

export interface LayoutViewOptions
{
    /** Lateral spacing between shapes when laid flat. Default 1.5 */
    spacing?: number
}

/** Options for {@link Layouter.partStack} — one flat stack per part, side by side. */
export interface PartStackLayoutOptions
{
    /** Gap between one stack and the next, in model units. Default 5, as rowOrtho. */
    spacing?: number
    /** Gap between the pieces WITHIN a stack. Default 0 — they sit on each other, which is
     *  what a stack of boards does. */
    gap?: number
    /** Stack shapes whose style marks them invisible too. Default false. */
    includeHidden?: boolean
    /** The parts to stack, when the caller has already worked them out. Left out, they are
     *  detected from the scene with collectParts().
     *
     *  An instructable passes its own: its steps are written in terms of parts it has already
     *  named A, B, C, and re-detecting them from the handful of shapes one step holds would
     *  merge two same-sized parts of different layers into one pile — leaving the labels
     *  pointing at stacks that are not theirs. */
    parts?: Array<Part>
}

export interface LayoutAnimationOptions
{
    duration?: number
    interpolation?: LayoutAnimationInterpolation // default 'linear'
    tween?: LayoutAnimationInterpolation // deprecated alias for interpolation
    animationName?: string
}

export interface LayoutTransformation
{
    sceneNode: meshup.SceneNode
    translation: [number, number, number]
    rotation: [number, number, number, number]
    scale: [number, number, number]
}

export interface LayoutTransformationResult
{
    name: string
    translationMode: 'relative' | 'absolute' // For now always relative
    transforms: Array<LayoutTransformation> // LayoutTransformation includes node reference, so we can apply directly to scene
}


