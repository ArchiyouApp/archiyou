/**
 *  animator/resolve.ts
 *
 *  A declared animation (Animation.ts) as plain AnimationData: every reference resolved to
 *  scene paths, every layout run, every time absolute. The only part of the animator that
 *  touches the scene, and loaded with `import()` only when an output asks for an animation
 *  (see Animator.resolve()).
 *
 *  Never mutates the scene: layouts go through Layouter.result() and placements(), never
 *  apply(). An animation is a deviation from the finished model, not a change to it.
 */

import type { AnimationSpec, CameraInput, PoseInput, StaggerSpec } from './Animation'
import type {
    AnimationChapter, AnimationData, CameraKey, CameraTrackData, ColorKey, Easing, OpacityKey,
    PoseKey, Quat, TrackData, Vec3, VisibleKey,
} from './types'
import { instructToAnimation } from './instruct'
import {
    IDENTITY_QUATERNION, add, isIdentityQuat, isSameVec, lerpVec, multiplyVec, normalizeQuat,
    quatFromEulerDegrees, rotatePoint, scaleVec, subtract,
} from './sampling'
import { layoutPlacements, boundsOf } from './layouts'
import { collectParts, type Part } from '../modeler/parts'
import { resolvePartRef, shapesOf } from '../modeler/refs'
import { centreOf, type LayoutPlacement } from '../modeler/placements'
import { isCameraSide, SIDE_DIRECTIONS } from '../docs/instruct/types'

export interface ResolveContext
{
    modeler: any
    docs?: any
}

type Bbox = [number, number, number, number, number, number]

/** Seconds, for an animation that says nothing about its length and has no key to go by. */
const DEFAULT_DURATION = 2
/** Camera distance, as a multiple of the model's largest side — as the instructables have it. */
const CAMERA_DISTANCE_FACTOR = 2.5
/** A turntable gets a key at least every so many degrees: close enough that the chords between
 *  them do not show. */
const TURNTABLE_STEP_DEGREES = 10
/** How high an iso view looks from, in degrees: the elevation of [-1,-1,1]. */
const ISO_ELEVATION = Math.atan2(1, Math.SQRT2) * 180 / Math.PI
const ISO_AZIMUTH = -135

/** Something an animation can point at, resolved: a scene path and the shapes under it. */
interface Target
{
    path: string
    shapes: Array<any>
}

interface TrackBuilder
{
    path: string
    centre: Vec3
    pose: Array<PoseKey>
    visible: Array<VisibleKey>
    opacity: Array<OpacityKey>
    color: Array<ColorKey>
}

export function resolveAnimation(spec: AnimationSpec, ctx: ResolveContext): AnimationData
{
    const scene = new SceneRefs(ctx, spec.name)
    const easing: Easing = spec.easing ?? 'easeInOut'
    const loop = spec.loop ?? 'none'

    // a parameter sweep is run by the host, frame by frame; a run on its own only declares it
    if (spec.params.length)
    {
        const frames = Math.min(...spec.params.map(p => p.values.length))
        return {
            name: spec.name,
            ...(spec.title ? { title: spec.title } : {}),
            duration: spec.duration ?? DEFAULT_DURATION,
            loop,
            tracks: [],
            params: { frames: Array.from({ length: frames }, (_, i) =>
                Object.fromEntries(spec.params.map(p => [p.name, p.values[i]]))) },
        }
    }

    const tracks = new Map<string, TrackBuilder>()
    const trackOf = (target: Target): TrackBuilder =>
    {
        const existing = tracks.get(target.path)
        if (existing) { return existing }
        const made: TrackBuilder = {
            path: target.path, centre: scene.centreOf(target.shapes),
            pose: [], visible: [], opacity: [], color: [],
        }
        tracks.set(target.path, made)
        return made
    }

    /*  The length, before anything is laid out on it: the script's own, or what an instructable
        or a build needs, or the last key. Keys past it are an error, said with both numbers. */
    const explicitTimes = [
        ...spec.keys.map(k => k.t), ...spec.visible.map(k => k.t), ...spec.opacity.map(k => k.t),
        ...spec.color.map(k => k.t), ...spec.camera.map(k => k.t),
    ]

    const instructData = spec.steps ? scene.instruct(spec.steps) : null
    const buildParts = spec.build ? scene.orderedInstances(spec.order ?? 'bottomUp') : []

    const duration = spec.duration
        ?? instructData?.duration
        ?? (spec.build ? Math.max(1, buildParts.length * 0.25) : undefined)
        ?? (explicitTimes.length ? Math.max(...explicitTimes) : undefined)
        ?? DEFAULT_DURATION

    if (!(duration > 0))
    {
        throw new Error(`Animation '${spec.name}' has no length. Give it one with .duration(seconds).`)
    }

    const late = explicitTimes.filter(t => t > duration + 1e-9)
    if (late.length)
    {
        const last = Math.max(...late)
        throw new Error(`Animation '${spec.name}': a key at ${last} s is past its end at ${duration} s. `
            + `Lengthen it with .duration(${last}) or move the key.`)
    }

    // framing: the model, and wherever its parts travel
    const extents: Array<Bbox> = [scene.bbox()]

    //// LAYOUT ////

    if (spec.layout)
    {
        const placements = scene.layout(spec)
        const ordered = scene.order(placements, spec.order ?? 'scene')
        const { start, travel } = staggered(ordered.length, duration, spec.stagger, spec.name)

        ordered.forEach((p, k) =>
        {
            const track = trackOf({ path: p.path, shapes: [p.shape] })
            track.centre = p.centre
            const depart = start(k)
            const arrive = depart + travel
            const laid = { position: p.position, rotation: p.rotation }

            track.pose.push(...(spec.layout!.direction === 'from'
                ? [{ t: 0, ...laid, easing: 'linear' as Easing },
                   { t: depart, ...laid, easing: 'linear' as Easing },
                   { t: arrive, easing }]
                : [{ t: 0, easing: 'linear' as Easing },
                   { t: depart, easing: 'linear' as Easing },
                   { t: arrive, ...laid, easing }]))

            extents.push(aroundPoint(p.position, scene.radiusOf([p.shape])))
        })
    }

    //// BUILD ////

    if (spec.build)
    {
        const per = duration / Math.max(1, buildParts.length)
        const drop = spec.build.drop ?? scene.size() * 0.15

        buildParts.forEach((instance, k) =>
        {
            const track = trackOf(instance)
            const appear = k * per
            const above = add(track.centre, [0, 0, drop])
            track.visible.push({ t: 0, value: false }, { t: appear, value: true })
            track.pose.push(
                { t: 0, position: above, easing: 'linear' },
                { t: appear, position: above, easing: 'linear' },
                { t: appear + per, easing })
            extents.push(aroundPoint(above, scene.radiusOf(instance.shapes)))
        })
    }

    //// INSTRUCTABLE ////

    let chapters: Array<AnimationChapter> | undefined
    if (instructData)
    {
        const played = instructToAnimation(instructData, path => scene.centreOfPath(path))
        played.tracks.forEach(t =>
        {
            const track = trackOf({ path: t.path, shapes: scene.shapesAtPath(t.path) })
            if (t.centre) { track.centre = t.centre }
            track.pose.push(...(t.pose ?? []))
        })
        chapters = played.chapters

        // parts not in a step yet are hidden, so any glTF viewer plays the assembly as one
        if (spec.stepsHide !== false)
        {
            const steps = instructData.steps ?? []
            const paths = [...new Set<string>(steps.flatMap((s: any) => s.visible ?? []))]
            paths.forEach(path =>
            {
                const track = trackOf({ path, shapes: scene.shapesAtPath(path) })
                track.visible.push(...steps.map((s: any) => ({ t: s.tStart, value: (s.visible ?? []).includes(path) })))
            })
        }
    }

    //// KEYS ////

    spec.keys.forEach(k => scene.targets(k.ref, 'key').forEach(target =>
    {
        const track = trackOf(target)
        track.pose.push(scene.poseKey(k.t, track.centre, k.pose, k.easing ?? easing))
    }))

    spec.visible.forEach(k => scene.targets(k.ref, k.value ? 'show' : 'hide').forEach(target =>
        trackOf(target).visible.push({ t: k.t, value: k.value })))

    spec.opacity.forEach(k => scene.targets(k.ref, 'opacity').forEach(target =>
        trackOf(target).opacity.push({ t: k.t, value: k.value, easing: k.easing ?? easing })))

    spec.color.forEach(k => scene.targets(k.ref, 'color').forEach(target =>
        trackOf(target).color.push({ t: k.t, value: k.value, easing: k.easing ?? easing })))

    //// CAMERA ////

    const bbox = unionOf(extents)
    /*  What the camera frames at the start and at the end: everything when parts are laid out
        (or up in the air), the model when they are home. A fly-in starts wide on the stacks and
        ends on the finished model. */
    const model = scene.bbox()
    const framing: [Bbox, Bbox] = (spec.layout?.direction === 'from' || spec.build) ? [bbox, model]
        : (spec.layout?.direction === 'to') ? [model, bbox]
        : [bbox, bbox]
    const camera = cameraTrack(spec, scene, framing, duration, easing)

    return {
        name: spec.name,
        ...(spec.title ? { title: spec.title } : {}),
        duration,
        loop,
        tracks: [...tracks.values()].map(finishTrack).filter((t): t is TrackData => t !== null),
        bbox,
        ...(camera ? { camera } : {}),
        ...(chapters?.length ? { chapters } : {}),
        ...(spec.preset ? { preset: { kind: spec.preset.kind, options: plain(spec.preset.options) } } : {}),
    }
}

//// TIMING ////

/** When part k of n leaves and how long each travels. The last one arrives at the end. */
function staggered(n: number, duration: number, stagger: StaggerSpec | undefined, name: string)
{
    const asked = (typeof stagger === 'number') ? stagger
        : (stagger && n > 1) ? stagger.last * duration / (n - 1)
        : 0

    // leave each part a tenth of the time at least to get where it goes
    const most = (n > 1) ? 0.9 * duration / (n - 1) : 0
    if (asked > most + 1e-9)
    {
        console.warn(`Animation '${name}': a stagger of ${asked.toFixed(3)} s between ${n} parts does not fit `
            + `in ${duration} s, so it is ${most.toFixed(3)} s.`)
    }
    const s = Math.min(asked, most)

    return { start: (k: number) => k * s, travel: duration - (n - 1) * s }
}

//// TRACKS ////

/** Keys in time order, the later declared winning at the same time; empty lists dropped. A
 *  track with nothing left is null. */
function finishTrack(track: TrackBuilder): TrackData | null
{
    const sorted = <K extends { t: number }>(keys: Array<K>): Array<K> =>
    {
        const ordered = keys.map((k, i) => ({ k, i })).sort((a, b) => (a.k.t - b.k.t) || (a.i - b.i)).map(e => e.k)
        return ordered.filter((k, i) => i === ordered.length - 1 || Math.abs(ordered[i + 1].t - k.t) > 1e-9)
    }

    const pose = sorted(track.pose)
    const opacity = sorted(track.opacity)
    const color = sorted(track.color)
    const visibleKeys = sorted(track.visible)

    // "shown at 2 s" means hidden until then, and "hidden at 2 s" shown until then
    const visible = (visibleKeys.length && visibleKeys[0].t > 0)
        ? [{ t: 0, value: !visibleKeys[0].value }, ...visibleKeys]
        : visibleKeys

    if (!pose.length && !visible.length && !opacity.length && !color.length) { return null }

    return {
        path: track.path,
        centre: track.centre,
        ...(pose.length ? { pose } : {}),
        ...(visible.length ? { visible } : {}),
        ...(opacity.length ? { opacity } : {}),
        ...(color.length ? { color } : {}),
    }
}

//// CAMERA ////

function cameraTrack(spec: AnimationSpec, scene: SceneRefs, framing: [Bbox, Bbox], duration: number, easing: Easing): CameraTrackData | undefined
{
    if (!spec.turntable && !spec.camera.length) { return undefined }

    const sizeOf = (b: Bbox) => Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1
    const all = unionOf(framing)
    const centre = bboxCentre(all)
    const radius = Math.hypot(all[3] - all[0], all[4] - all[1], all[5] - all[2]) / 2 || 1
    const projection = spec.projection ?? 'perspective'
    const distance = sizeOf(all) * CAMERA_DISTANCE_FACTOR

    if (spec.turntable)
    {
        const { degrees } = spec.turntable
        const elevation = (spec.turntable.elevation ?? ISO_ELEVATION) * Math.PI / 180
        const steps = Math.max(2, Math.ceil(Math.abs(degrees) / TURNTABLE_STEP_DEGREES))
        const [from, to] = framing

        const keys: Array<CameraKey> = Array.from({ length: steps + 1 }, (_, k) =>
        {
            const u = k / steps
            const azimuth = (ISO_AZIMUTH + degrees * u) * Math.PI / 180
            // from the framing at the start to the one at the end, as it turns
            const target = lerpVec(bboxCentre(from), bboxCentre(to), u)
            const away = (sizeOf(from) + (sizeOf(to) - sizeOf(from)) * u) * CAMERA_DISTANCE_FACTOR
            return {
                t: duration * u,
                position: add(target, scaleVec([
                    Math.cos(elevation) * Math.cos(azimuth),
                    Math.cos(elevation) * Math.sin(azimuth),
                    Math.sin(elevation)], away)),
                lookAt: target,
                easing: 'linear',
            }
        })

        return {
            kind: 'turntable', keys, projection, radius,
            turntable: { degrees, elevation: spec.turntable.elevation ?? ISO_ELEVATION },
        }
    }

    const keys = [...spec.camera].sort((a, b) => a.t - b.t).map(c =>
    {
        const lookAt = (c.lookAt !== undefined) ? scene.pointOf(c.lookAt, 'camera') : centre
        return { t: c.t, position: eyeOf(c.position, lookAt, distance), lookAt, easing: c.easing ?? easing }
    })

    return { kind: 'keys', keys, projection, radius }
}

/** An eye point from a side, an iso-style direction or a point — the instruct camera forms. */
function eyeOf(position: CameraInput, lookAt: Vec3, distance: number): Vec3
{
    if (isCameraSide(position))
    {
        return subtract(lookAt, scaleVec(SIDE_DIRECTIONS[position], distance))
    }

    const raw = vecOf(position) ?? [-1, -1, 1]
    /*  A small vector is a DIRECTION written as a position — [-1,-1,1] is the classic one —
        rather than an eye point a millimetre from the origin, which is what taking it
        literally would mean for a model of any size. */
    const length = Math.hypot(raw[0], raw[1], raw[2])
    if (length <= 2)
    {
        return add(lookAt, scaleVec(raw, distance / (length || 1)))
    }
    return raw
}

//// THE SCENE ////

/** The model as the resolver sees it: references to targets, centres, layouts. Lazy, so a
 *  part list is only measured when a part label is used. */
class SceneRefs
{
    _ctx: ResolveContext
    _name: string
    _parts: Array<Part> | null = null
    _nodesByPath: Map<string, any> | null = null

    constructor(ctx: ResolveContext, name: string)
    {
        if (!ctx?.modeler?.scene)
        {
            throw new Error(`Animation '${name}' needs a model to animate.`)
        }
        this._ctx = ctx
        this._name = name
    }

    root(): any
    {
        return this._ctx.modeler.scene()
    }

    /** The scene's nodes that hold a shape, in scene order. */
    shapeNodes(): Array<any>
    {
        const root = this.root()
        return [root, ...root.descendants()].filter((n: any) => n.hasShape())
    }

    nodesByPath(): Map<string, any>
    {
        if (!this._nodesByPath)
        {
            const root = this.root()
            this._nodesByPath = new Map([root, ...root.descendants()].map((n: any) => [n.path(), n]))
        }
        return this._nodesByPath
    }

    /** The model's parts, labelled as an instructable labels them. Measured on first use. */
    parts(): Array<Part>
    {
        this._parts ??= collectParts(this.root(), { labels: 'alpha', order: 'group' })
        return this._parts
    }

    /** What a reference points at: a Shape or a collection, a part label ('A', 'A#2'), a layer
     *  or group name ('frame'), or a scene node. */
    targets(ref: any, verb: string): Array<Target>
    {
        if (typeof ref === 'string')
        {
            const parts = /^[A-Z]{1,3}(#\d+)?$/.test(ref) ? this.parts() : null
            if (parts?.some(p => p.label === ref.replace(/#\d+$/, '')))
            {
                return this._partTargets(resolvePartRef(ref, parts, r => this._unknown(r, verb), this._where(verb)))
            }

            const named = [this.root(), ...this.root().descendants()].filter((n: any) => n.name === ref)
            if (named.length)
            {
                return named.map((n: any) => ({ path: n.path(), shapes: n.shapes().toArray() }))
            }

            return this._partTargets(resolvePartRef(ref, this.parts(), r => this._unknown(r, verb), this._where(verb)))
        }

        if (typeof ref?.path === 'function' && typeof ref?.descendants === 'function')
        {
            return [{ path: ref.path(), shapes: ref.shapes().toArray() }]
        }

        const byPath = new Map<string, Array<any>>()
        shapesOf(ref).forEach(shape =>
        {
            const path = shape?._node?.path?.()
            if (path) { byPath.set(path, [...(byPath.get(path) ?? []), shape]) }
        })

        if (!byPath.size)
        {
            throw new Error(`${this._where(verb)}: that shape is not in the scene, so it cannot be animated. `
                + `Animate shapes the model shows.`)
        }
        return [...byPath.entries()].map(([path, shapes]) => ({ path, shapes }))
    }

    _partTargets(refs: Array<{ shapes: Array<any>, paths: Array<string> }>): Array<Target>
    {
        return refs.flatMap(r => r.paths.map((path, i) => ({ path, shapes: [r.shapes[i]] })))
    }

    _unknown(ref: string, verb: string): Error
    {
        const labels = this.parts().map(p => p.label).join(', ') || '(none)'
        const layers = [...new Set(this.root().descendants().filter((n: any) => !n.hasShape()).map((n: any) => n.name))]
            .join(', ') || '(none)'
        return new Error(`${this._where(verb)}: "${ref}" is not part of this model. Use a part label (${labels}), `
            + `one instance of one ('A#2'), a layer (${layers}) or a Shape.`)
    }

    _where(verb: string): string
    {
        return `Animation '${this._name}'.${verb}()`
    }

    shapesAtPath(path: string): Array<any>
    {
        return this.nodesByPath().get(path)?.shapes?.().toArray?.() ?? []
    }

    centreOfPath(path: string): Vec3 | undefined
    {
        const shapes = this.shapesAtPath(path)
        return shapes.length ? this.centreOf(shapes) : undefined
    }

    bbox(): Bbox
    {
        return this.bboxOf(this.root().shapes().toArray())
    }

    size(): number
    {
        const b = this.bbox()
        return Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1
    }

    bboxOf(shapes: Array<any>): Bbox
    {
        return boundsOf(shapes)
    }

    centreOf(shapes: Array<any>): Vec3
    {
        if (shapes.length === 1) { return centreOf(shapes[0]) ?? [0, 0, 0] }
        return bboxCentre(this.bboxOf(shapes))
    }

    radiusOf(shapes: Array<any>): number
    {
        const b = this.bboxOf(shapes)
        return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2
    }

    /** A point, a Shape or a reference, as a point. */
    pointOf(o: any, verb: string): Vec3
    {
        const v = vecOf(o)
        if (v) { return v }
        return this.centreOf(this.targets(o, verb).flatMap(t => t.shapes))
    }

    /** One pose key from what a script wrote: a turn about a pivot, then a move, or a place. */
    poseKey(t: number, centre: Vec3, pose: PoseInput, easing: Easing): PoseKey
    {
        const rotation = rotationOf(pose.rotation)
        const scale = scaleOf(pose.scale)
        const pivot = (pose.pivot !== undefined) ? this.pointOf(pose.pivot, 'key') : centre

        // turned (and scaled) about the pivot, the centre goes here…
        const turned = add(pivot, rotatePoint(rotation, multiplyVec(scale, subtract(centre, pivot))))
        // …and then it moves, unless it is placed outright
        const position = vecOf(pose.position) ?? add(turned, vecOf(pose.move) ?? [0, 0, 0])

        return {
            t,
            ...(isSameVec(position, centre) ? {} : { position }),
            ...(isIdentityQuat(rotation) ? {} : { rotation }),
            ...(isSameVec(scale, [1, 1, 1]) ? {} : { scale }),
            easing,
        }
    }

    //// LAYOUTS ////

    /** Run the animation's layout (layouts.ts). */
    layout(spec: AnimationSpec): Array<LayoutPlacement>
    {
        const { kind, options } = spec.layout!
        const only = spec.only.flatMap(ref => this.targets(ref, 'only').flatMap(t => t.shapes))
        return layoutPlacements(this._ctx.modeler, kind, options, only)
    }

    /** Placements in the order parts leave in. */
    order(placements: Array<LayoutPlacement>, order: string): Array<LayoutPlacement>
    {
        if (order === 'stack') { return placements }
        if (order === 'scene')
        {
            const index = new Map(this.shapeNodes().map((n: any, i: number) => [n.path(), i]))
            return [...placements].sort((a, b) => (index.get(a.path) ?? 0) - (index.get(b.path) ?? 0))
        }
        const up = (a: Vec3, b: Vec3) => (a[2] - b[2]) || (a[0] - b[0]) || (a[1] - b[1])
        return [...placements].sort((a, b) => (order === 'topDown') ? up(b.centre, a.centre) : up(a.centre, b.centre))
    }

    /** Every part instance of the model, in an order. */
    orderedInstances(order: string): Array<Target>
    {
        const instances = this.parts().flatMap(p => p.paths.map((path, i) => ({ path, shapes: [p.shapes[i]] })))
        if (order === 'scene' || order === 'stack')
        {
            const index = new Map(this.shapeNodes().map((n: any, i: number) => [n.path(), i]))
            return instances.sort((a, b) => (index.get(a.path) ?? 0) - (index.get(b.path) ?? 0))
        }
        const centre = (t: Target) => this.centreOf(t.shapes)
        const up = (a: Vec3, b: Vec3) => (a[2] - b[2]) || (a[0] - b[0]) || (a[1] - b[1])
        return instances.sort((a, b) => (order === 'topDown') ? up(centre(b), centre(a)) : up(centre(a), centre(b)))
    }

    //// INSTRUCTABLES ////

    instruct(which: string | true): any
    {
        const docs = this._ctx.docs
        const instruct = (which === true) ? docs?._instructs?.[0] : docs?.getInstruct?.(which)
        if (!instruct)
        {
            throw new Error(`${this._where('steps')}: there is no instructable ${which === true ? '' : `"${which}" `}to play. `
                + `Make one with docs.instruct(${which === true ? "'assembly'" : `'${which}'`}). `
                + `Available: ${docs?.instructs?.().join(', ') || '(none)'}.`)
        }
        return instruct.toData()
    }
}

//// SMALL THINGS ////

function vecOf(o: any): Vec3 | null
{
    if (Array.isArray(o) && o.length >= 3 && o.slice(0, 3).every((n: any) => typeof n === 'number')) { return [o[0], o[1], o[2]] }
    if (o && typeof o.x === 'number' && typeof o.y === 'number' && typeof o.isShapeClass !== 'function') { return [o.x, o.y, o.z ?? 0] }
    return null
}

/** Euler degrees [x, y, z] or a quaternion [x, y, z, w]. */
function rotationOf(rotation: Array<number> | undefined): Quat
{
    if (!rotation) { return [...IDENTITY_QUATERNION] }
    if (rotation.length === 4) { return normalizeQuat(rotation) }
    return quatFromEulerDegrees([rotation[0], rotation[1], rotation[2]])
}

function scaleOf(scale: number | Array<number> | undefined): Vec3
{
    if (scale === undefined) { return [1, 1, 1] }
    if (typeof scale === 'number') { return [scale, scale, scale] }
    return [scale[0], scale[1], scale[2]]
}

function bboxCentre(b: Bbox): Vec3
{
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]
}

function aroundPoint(p: Vec3, r: number): Bbox
{
    return [p[0] - r, p[1] - r, p[2] - r, p[0] + r, p[1] + r, p[2] + r]
}

function unionOf(boxes: Array<Bbox>): Bbox
{
    return [0, 1, 2].map(i => Math.min(...boxes.map(b => b[i])))
        .concat([3, 4, 5].map(i => Math.max(...boxes.map(b => b[i])))) as Bbox
}

function plain(options: Record<string, any>): Record<string, any>
{
    const value = (v: any): any => Array.isArray(v) ? v.map(value)
        : (v && typeof v === 'object' && typeof v.name === 'function') ? v.name()
        : v
    return Object.fromEntries(Object.entries(options ?? {}).map(([k, v]) => [k, value(v)]))
}
