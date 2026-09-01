/**
 *  docs/instruct/types.ts
 *
 *  The data an instructable is, once every reference in it has been resolved.
 *
 *  The authoring API (Instruct, Step) collects raw arguments — a Shape here, a part label
 *  there — and resolves nothing until it is asked for output. What comes out the other side is
 *  everything below: plain data, no live Shape references except where the renderer needs the
 *  geometry itself. That split is what lets a step be written before the last shape exists,
 *  and what lets an instructable survive a $component() boundary, where a scope reference
 *  would not.
 */

import type { Part } from '../../modeler/parts'
import type { LabelOptions } from '../../annotator/types'
import type { LayoutAnimationInterpolation } from '../../modeler/types'

//// REFERENCES ////

/** How a script names parts in a step: a Shape, a ShapeCollection, a part label ('A'), one
 *  instance of a part ('A#2'), or a scene layer / group name ('frame'). */
export type PartRefInput = any | string

/** One resolved reference: the part, and which of its instances were meant. */
export interface PartRef
{
    part: Part
    /** The instances referred to — every one of them unless an 'A#2' picked one out. */
    shapes: Array<any>
    /** Their scene paths, index-matched to `shapes`. */
    paths: Array<string>
}

//// CAMERA ////

/** A named side of the target's bounding box. These short-circuit to the kernel's own
 *  elevation directions rather than going through a position at all. */
export type CameraSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export function isCameraSide(o: any): o is CameraSide
{
    return ['front', 'back', 'left', 'right', 'top', 'bottom'].includes(o)
}

/** Where the camera is, as a script writes it: a world-space eye position, or a named side. */
export type CameraPositionInput = CameraSide | Array<number> | any

/** A projection. Only the 3D output can honour `perspective` — the kernel's hidden-line
 *  removal is orthographic, so a printed step is an orthographic drawing whatever this says.
 *  See Instruct.perspective(). */
export type CameraProjection = 'orthographic' | 'perspective'

export interface CameraSpec
{
    position?: CameraPositionInput
    lookAt?: any
    projection?: CameraProjection
}

/** A camera with everything filled in and the geometry worked out. */
export interface ResolvedCamera
{
    /** The named side, when one was asked for — the kernel's fast path. */
    side?: CameraSide
    /** Eye position in world coordinates. */
    position: [number, number, number]
    /** What it points at. */
    lookAt: [number, number, number]
    /** Unit vector from the eye to the target. This, not the position, is what the projection
     *  takes: `projectMeshes({ cam })` hands it to `Mesh._resolveViewDirection()`. */
    direction: [number, number, number]
    projection: CameraProjection
}

//// MOTION ////

/** The entry motion of a step's subject: where it comes in from, and how. */
export interface MoveSpec
{
    /** A named side, or a direction vector. Left out, it is derived the way an exploded view
     *  derives one — from the centre of the assembly out to the part. */
    from?: CameraSide | Array<number>
    /** How far out it starts, in model units. Default: a fraction of the subject's size. */
    distance?: number
    /** Seconds. Falls back to the Instruct's own default. */
    duration?: number
    interpolation?: LayoutAnimationInterpolation
    /** Draw the motion arrow in the 2D step drawing. In print the arrow IS the motion —
     *  there is nothing else to see — so this defaults to true. */
    arrow?: boolean
}

export interface ResolvedMove
{
    /** Unit vector the subject travels ALONG, from its start position to its final one. */
    direction: [number, number, number]
    distance: number
    duration: number
    interpolation: LayoutAnimationInterpolation
    arrow: boolean
}

//// LAYOUT ////

/** Layouts a step can ask for, named after the Layouter methods that do them. */
export type StepLayoutKind = 'row' | 'exploded' | 'partstack'

export interface StepLayoutSpec
{
    kind: StepLayoutKind
    /** rowOrtho / partStack spacing, or exploded distance. */
    spacing?: number
    distance?: number
}

/** Where one part sits when a step asked to be laid out, as a rigid transform of the part
 *  about its own centre:
 *
 *      p' = rotation * (p - centre) + position
 *
 *  Written this way rather than as a node transform because the two consumers hang the
 *  geometry off their nodes differently — a glTF container node sits at the origin with the
 *  mesh child carrying the centre, three.js the same — and both can build their own local
 *  transform from these three numbers without knowing what the other does.
 *
 *  The drawing does NOT go through this: it uses the laid-out copies themselves, which is
 *  exact. These reproduce that placement exactly for the rotations a layout actually
 *  produces (none at all, or a quarter turn onto an axis) and to within the re-centring
 *  Mesh.rotateQuaternion() does for any other. */
export interface StepPlacement
{
    /** Scene path of the part instance. */
    path: string
    /** Where the part's centre ends up, in world coordinates. */
    position: [number, number, number]
    /** Rotation about the part's own centre, [x, y, z, w]. */
    rotation: [number, number, number, number]
    /** The part's authored centre — what the rotation turns about. */
    centre: [number, number, number]
}

//// ANNOTATIONS ////

export interface StepLabelSpec
{
    /** What it points at — resolved to a position when the step is. */
    target: PartRefInput
    text: string
    options?: Record<string, any>
}

export interface StepDimSpec
{
    target: PartRefInput
    options?: Record<string, any>
}

/** How much of a step labels itself with the part labels the manual is written in.
 *
 *   - `'subject'` (the default) labels what the step is ABOUT. A step with no subject —
 *     the "here is what you need" step — labels everything it shows, because that is the
 *     one step whose whole job is to name the parts.
 *   - `'all'` labels every part on screen, subject or context.
 *   - `'none'` leaves only the labels the script wrote by hand with `step.label()`.
 */
export type InstructLabelMode = 'subject' | 'all' | 'none'

/** One label, resolved: a position in the step's own 3D space and the text to put there. */
export interface StepLabelData
{
    position: [number, number, number]
    text: string
    /** The part this names, when it names one — so a viewer can class it, and so a drawing
     *  can find the projected line-work it belongs to. Absent on a hand-written label. */
    part?: string
    /** Scene paths the label points at, when it points at parts. */
    paths?: Array<string>
    /** Whether the instructable generated this label or the script wrote it. */
    kind: 'part' | 'custom'
    /** How to draw it — shape, target marker, leader length and angle. Resolved once here so
     *  the page and the viewer cannot disagree about a label's appearance, except where they
     *  default differently on purpose (see AnnotatorLabel's header on `labelOnly`). */
    options?: LabelOptions
}

//// OUTPUT DATA ////

/** One step, resolved. The renderers (page, GLB) read this and nothing else. */
export interface StepData
{
    index: number
    /** 1-based, for "Step 3 of 12". */
    number: number
    title: string
    /** Where this step sits on the instructable's single continuous timeline, in seconds.
     *  Steps are contiguous: one step's tEnd is the next one's tStart. A viewer scrubs to a
     *  step by seeking here; a viewer that knows nothing about steps just plays the lot and
     *  gets an assembly movie. */
    tStart: number
    tEnd: number
    /** Bounding box of everything visible this step, [minX,minY,minZ,maxX,maxY,maxZ]. Carried
     *  so a viewer can frame the step, and an orthographic glTF camera can be sized, without
     *  re-deriving it from the geometry. */
    bbox: [number, number, number, number, number, number]
    /** Everything visible this step. */
    visible: Array<string>
    /** What the step is about — a subset of `visible`. */
    subject: Array<string>
    /** Part labels used this step, in order. */
    uses: Array<string>
    camera: ResolvedCamera
    layout?: StepLayoutSpec
    move?: ResolvedMove
    labels: Array<StepLabelData>
    /** Where the step's parts go when it asked for a `layout()`. Absent when it did not, or
     *  when the layout could not run — either way the step is drawn assembled. */
    placements?: Array<StepPlacement>
    note?: string
    tools: Array<string>
    hardware: Array<{ name: string, quantity: number }>
}

/** A whole instructable, resolved. This is what goes into GLB `extras.instruct` and what the
 *  page composer lays out. */
export interface InstructData
{
    name: string
    title?: string
    /** Total length of the timeline in seconds — the last step's tEnd. */
    duration: number
    parts: Array<{
        label: string
        group: string
        name: string
        kind: string
        section: string
        length: number
        quantity: number
        paths: Array<string>
    }>
    steps: Array<StepData>
}

//// OPTIONS ////

export interface InstructPartsOptions
{
    labels?: 'alpha' | 'numeric'
    order?: 'group' | 'size' | 'scene'
    /** Register the rows as a Calc table under this name. Default 'parts'; false to skip.
     *  A name already in use is reported and skipped rather than throwing over it. */
    table?: string | false
    /** Print the list to the console. Default true — finding the labels is what it is for. */
    print?: boolean
    includeHidden?: boolean
}
