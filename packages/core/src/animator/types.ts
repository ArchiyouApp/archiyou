/**
 *  animator/types.ts
 *
 *  What an animation is once it has been resolved: plain data, keyed by scene path, with
 *  absolute times in seconds. A script's `animator` declarations resolve to this and to
 *  nothing else; the glTF baker (GLTFBuilder.addAnimationData), the viewer and the
 *  Animation tool read it.
 *
 *  ## The rule
 *
 *  An animation is a time-varying DEVIATION from the finished scene, the instruct rule
 *  (docs/instruct/Instruct.ts) applied to time. It holds poses and style changes and never
 *  mutates the scene: a track that is absent means "where and how the model has it".
 *
 *  Type-only on purpose: importing this module loads nothing at runtime.
 */

import type { LayoutAnimationInterpolation } from '../modeler/types'

export type Vec3 = [number, number, number]
/** [x, y, z, w] */
export type Quat = [number, number, number, number]

/** How a value travels INTO a key from the key before it. The layout easings, so a layout
 *  and an animation read the same. */
export type Easing = LayoutAnimationInterpolation

export type AnimationLoop = 'none' | 'loop' | 'pingpong'

/** The standard animations: `animator.preset(kind)`. */
export type PresetKind = 'flyin' | 'exploded' | 'layout' | 'turntable' | 'build' | 'assembly'

/** A rigid pose of a part at one time, ABOUT THE PART'S OWN CENTRE (`TrackData.centre`):
 *  the part is turned by `rotation` and scaled by `scale` about its centre, and the centre is
 *  moved to `position`. A field left out is the model's own: the centre where it is, no turn,
 *  no scale. This is the StepPlacement convention (docs/instruct/types.ts), which a glTF node
 *  and a three.js object can both apply. */
export interface PoseKey
{
    t: number
    position?: Vec3
    rotation?: Quat
    scale?: Vec3
    easing: Easing
}

export interface VisibleKey
{
    t: number
    value: boolean
}

export interface OpacityKey
{
    t: number
    /** 0..1, a factor on the part's own opacity: 1 is as the model has it */
    value: number
    easing: Easing
}

export interface ColorKey
{
    t: number
    /** '#rrggbb', sRGB, or null for the part's own colour */
    value: string | null
    easing: Easing
}

/** Everything one animation does to one scene node. */
export interface TrackData
{
    /** SceneNode.path(): what the glTF node and the viewer's object map are keyed on. */
    path: string
    /** The part's own centre, world coordinates: what a pose turns and scales about. Left out,
     *  the baker takes it from the file (meshup hangs a part's geometry off its container at
     *  the bounding-box centre). */
    centre?: Vec3
    pose?: Array<PoseKey>
    visible?: Array<VisibleKey>
    opacity?: Array<OpacityKey>
    color?: Array<ColorKey>
}

export interface CameraKey
{
    t: number
    position: Vec3
    lookAt: Vec3
    easing: Easing
}

export interface CameraTrackData
{
    kind: 'keys' | 'turntable'
    /** Absolute keys, always present once resolved (a turntable is resolved to keys around
     *  the model too, so a file means something without Archiyou). */
    keys: Array<CameraKey>
    /** For a turntable: what it was asked for, so a viewer can turn its OWN view instead. */
    turntable?: { degrees: number, elevation: number }
    projection: 'orthographic' | 'perspective'
    /** Half the extent the camera has to show, world units: sizes an orthographic camera and
     *  the clipping planes. */
    radius: number
}

export interface ParamTrackData
{
    /** Parameter values per frame, in order: frame i takes frames[i]. */
    frames: Array<Record<string, any>>
}

export interface AnimationChapter
{
    title: string
    tStart: number
    tEnd: number
}

export interface AnimationData
{
    name: string
    title?: string
    /** Seconds. */
    duration: number
    loop: AnimationLoop
    tracks: Array<TrackData>
    /** Everything the animation shows over its whole length, [minX,minY,minZ,maxX,maxY,maxZ]:
     *  the model and wherever its parts travel. For framing a view or a recording. */
    bbox?: [number, number, number, number, number, number]
    camera?: CameraTrackData
    /** From an instructable's steps: where each one sits on the timeline. */
    chapters?: Array<AnimationChapter>
    /** A parameter sweep: the host runs the script once per frame and merges the results. A
     *  run on its own bakes no clip for it. */
    params?: ParamTrackData
    /** How it was made, when it is a standard animation. */
    preset?: { kind: PresetKind, options: Record<string, any> }
}

/** What a run tells the outside about its animations without resolving any of them: the
 *  declarations, as plain data. `state.animations` carries this; the resolved tracks travel
 *  with the GLB in `extras.animations`. */
export interface AnimationInfo
{
    name: string
    title?: string
    /** Seconds, when it is known without resolving: set by the script or by the preset. */
    duration?: number
    loop: AnimationLoop
    preset?: { kind: PresetKind, options: Record<string, any> }
    /** Set on a parameter sweep: the parameters it changes, how many frames it has, and the
     *  values of each frame, for the host that runs the script once per frame. */
    params?: { names: Array<string>, frames: number, values: Array<Record<string, any>> }
}
