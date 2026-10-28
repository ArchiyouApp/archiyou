/**
 *  animator/Animation.ts
 *
 *  One animation as a script declares it:
 *
 *      anim = animator.create('swing').duration(2).loop('pingpong');
 *      anim.key(0, door, {});                                        // as modelled
 *      anim.key(2, door, { rotation: [0, 0, 95], pivot: [0, 0, 0] }, 'easeInOut');
 *      anim.hide('B', 0).show('B', 1);
 *      anim.fade('frame', 0, 1, [0, 1]);
 *      anim.highlight('A', 1, 2, 'orange');
 *      anim.turntable(90);
 *
 *  ## Declaring is free
 *
 *  Every verb checks what it can check on the spot (a time is a number, an easing exists, a
 *  colour parses) so a mistake points at the line that made it, and stores its raw
 *  arguments. Nothing is laid out, measured or baked here: that happens in resolve.ts, which
 *  is loaded and run only when an output asks for this animation.
 *
 *  ## No cursor
 *
 *  Every verb takes its target and its time explicitly, as a Step does (docs/instruct/Step.ts):
 *  there is no "current part" or "current time" to lose track of, and the lines of an
 *  animation can be written in any order.
 *
 *  ## Keys
 *
 *  A value travels into a key with the key's easing, from the key before it. Before the
 *  first key of a part the first key holds, as in any keyframe editor, so an animation that
 *  starts from the modelled pose says so: `key(0, part, {})`. hide() and show() are the
 *  exception, because "show at 2 s" means hidden until then.
 */

import { Color } from '@archiyou/meshup'

import type { AnimationInfo, AnimationLoop, Easing, PresetKind } from './types'
import { PARAM_FRAMES_DEFAULT, PARAM_FRAMES_MAX } from './standard'

export const EASINGS: Array<Easing> = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring']
export const LOOPS: Array<AnimationLoop> = ['none', 'loop', 'pingpong']

export type LayoutKind = 'partstack' | 'row' | 'exploded'
export type AnimationOrder = 'bottomUp' | 'topDown' | 'scene' | 'stack'
export const ORDERS: Array<AnimationOrder> = ['bottomUp', 'topDown', 'scene', 'stack']

/** Where a camera is: a named side, an iso-style direction ([-1,-1,1]), or an eye point. */
export type CameraInput = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | Array<number> | { x: number, y: number, z: number }

/** A rigid pose, as a script writes it. */
export interface PoseInput
{
    /** Where the part's centre goes, world coordinates. */
    position?: Array<number>
    /** Or: how far it moves from where the model has it. */
    move?: Array<number>
    /** Euler degrees [x, y, z], or a quaternion [x, y, z, w]. */
    rotation?: Array<number>
    /** A factor, or one per axis. */
    scale?: number | Array<number>
    /** What it turns about: a point or a Shape. Default its own centre. */
    pivot?: any
}

/** Options of a layout an animation starts or ends in. */
export interface LayoutOptions
{
    /** Gap between shapes or stacks. Default a twentieth of the model's largest side. */
    spacing?: number
    /** How far an exploded view pushes parts out. Default automatic. */
    distance?: number
    /** Put the row or the stacks beside the model, on the ground in front of it, rather than
     *  where the layout starts by itself (on top of the model). Default true. */
    beside?: boolean
}

/** How far apart the parts leave: seconds, or where the last one leaves as a fraction of the
 *  duration. */
export type StaggerSpec = number | { last: number }

/** What a script declared, raw. Resolved by resolve.ts. */
export interface AnimationSpec
{
    name: string
    title?: string
    duration?: number
    loop?: AnimationLoop
    easing?: Easing
    /** The standard animation it was made from, and with what: what it is, not what it does
     *  (its calls did that, see standard.ts). */
    preset?: { kind: PresetKind, options: Record<string, any> }
    layout?: { kind: LayoutKind, direction: 'from' | 'to', options: LayoutOptions }
    order?: AnimationOrder
    stagger?: StaggerSpec
    only: Array<any>
    build?: { drop?: number }
    keys: Array<{ t: number, ref: any, pose: PoseInput, easing?: Easing }>
    visible: Array<{ t: number, ref: any, value: boolean }>
    opacity: Array<{ t: number, ref: any, value: number, easing?: Easing }>
    color: Array<{ t: number, ref: any, value: string | null, easing?: Easing }>
    camera: Array<{ t: number, position: CameraInput, lookAt?: any, easing?: Easing }>
    turntable?: { degrees: number, elevation?: number }
    projection?: 'orthographic' | 'perspective'
    /** An instructable whose steps this animation plays: its name, or true for the first. */
    steps?: string | true
    /** Whether parts that are not in a step yet are hidden. Default true. */
    stepsHide?: boolean
    params: Array<{ name: string, values: Array<any> }>
}


export class Animation
{
    _spec: AnimationSpec

    constructor(name: string)
    {
        if (typeof name !== 'string' || !name.trim())
        {
            throw new Error(`animator.create(name): Please give the animation a name, like animator.create('flyin').`)
        }
        this._spec = {
            name: name.trim(),
            only: [], keys: [], visible: [], opacity: [], color: [], camera: [], params: [],
        }
    }

    get name(): string
    {
        return this._spec.name
    }

    //// SETTINGS ////

    title(title: string): this
    {
        this._spec.title = String(title)
        return this
    }

    /** Length in seconds. Default: the last key, or what a preset or a layout needs. */
    duration(seconds: number): this
    {
        if (typeof seconds !== 'number' || !(seconds > 0))
        {
            throw new Error(`${this._where('duration')}: Please give a duration in seconds above 0, like .duration(3). Got ${seconds}.`)
        }
        this._spec.duration = seconds
        return this
    }

    /** How it plays on: once ('none'), over and over ('loop'), or back and forth ('pingpong').
     *  `loop()` alone is 'loop'. */
    loop(mode: AnimationLoop | boolean = 'loop'): this
    {
        const value = (mode === true) ? 'loop' : (mode === false) ? 'none' : mode
        if (!LOOPS.includes(value as AnimationLoop))
        {
            throw new Error(`${this._where('loop')}: "${mode}" is not a loop mode. Use ${LOOPS.map(l => `'${l}'`).join(', ')}.`)
        }
        this._spec.loop = value as AnimationLoop
        return this
    }

    /** The easing of every transition that does not name its own. Default 'easeInOut'. */
    easing(easing: Easing): this
    {
        this._spec.easing = this._easing(easing, 'easing')
        return this
    }

    //// LAYOUTS ////

    /** Start laid out, end as modelled: 'partstack' (stacks of stock), 'row' or 'exploded'. */
    from(kind: LayoutKind, options: LayoutOptions = {}): this
    {
        this._spec.layout = { kind: this._layoutKind(kind, 'from'), direction: 'from', options: { ...options } }
        return this
    }

    /** Start as modelled, end laid out. */
    to(kind: LayoutKind, options: LayoutOptions = {}): this
    {
        this._spec.layout = { kind: this._layoutKind(kind, 'to'), direction: 'to', options: { ...options } }
        return this
    }

    /** The order parts leave in: 'bottomUp' (lowest first), 'topDown', 'scene' (as modelled)
     *  or 'stack' (as the layout has them). */
    order(order: AnimationOrder): this
    {
        if (!ORDERS.includes(order))
        {
            throw new Error(`${this._where('order')}: "${order}" is not an order. Use ${ORDERS.map(o => `'${o}'`).join(', ')}.`)
        }
        this._spec.order = order
        return this
    }

    /** Seconds between one part leaving and the next, or `{ last }`: when the last part leaves,
     *  as a fraction of the duration (`{ last: 0.6 }` leaves it 40 % of the way to arrive). */
    stagger(seconds: StaggerSpec): this
    {
        if (seconds && typeof seconds === 'object')
        {
            const last = (seconds as { last: number }).last
            if (typeof last !== 'number' || last < 0 || last > 1)
            {
                throw new Error(`${this._where('stagger')}: { last } is a fraction of the duration, 0 to 1, like .stagger({ last: 0.6 }). Got ${last}.`)
            }
            this._spec.stagger = { last }
            return this
        }
        if (typeof seconds !== 'number' || seconds < 0)
        {
            throw new Error(`${this._where('stagger')}: Please give the seconds between parts, 0 or more, like .stagger(0.1). Got ${seconds}.`)
        }
        this._spec.stagger = seconds
        return this
    }

    /** The parts appear one after another, in `order()` (default lowest first), each dropping
     *  into place. Default as long as the parts need, a quarter of a second each.
     *  @param options.drop how far a part drops; default 15 % of the model's size */
    build(options: { drop?: number } = {}): this
    {
        if (options?.drop !== undefined && (typeof options.drop !== 'number' || options.drop < 0))
        {
            throw new Error(`${this._where('build')}: drop is a distance, 0 or more, like .build({ drop: 100 }). Got ${options.drop}.`)
        }
        this._spec.build = (options?.drop !== undefined) ? { drop: options.drop } : {}
        return this
    }

    /** Lay out only these: Shapes, part labels or layer names. Default the whole model. */
    only(...refs: Array<any>): this
    {
        this._spec.only = [...this._spec.only, ...refs.flat()]
        return this
    }

    //// KEYS ////

    /** A pose of a part at a time. `{}` is the part as modelled.
     *  @param pose { position | move, rotation, scale, pivot } */
    key(t: number, ref: any, pose: PoseInput = {}, easing?: Easing): this
    {
        this._time(t, 'key')
        this._ref(ref, 'key')
        const checked = this._pose(pose)
        this._spec.keys.push({ t, ref, pose: checked, ...(easing ? { easing: this._easing(easing, 'key') } : {}) })
        return this
    }

    /** Hidden from `t` on. */
    hide(ref: any, t: number = 0): this
    {
        this._time(t, 'hide')
        this._ref(ref, 'hide')
        this._spec.visible.push({ t, ref, value: false })
        return this
    }

    /** Shown from `t` on, and hidden before unless an earlier key says otherwise. */
    show(ref: any, t: number = 0): this
    {
        this._time(t, 'show')
        this._ref(ref, 'show')
        this._spec.visible.push({ t, ref, value: true })
        return this
    }

    /** Fade between two opacities from t0 to t1. Default [0, 1]: fade in, invisible before.
     *  @param opacity [from, to], 0..1 */
    fade(ref: any, t0: number, t1: number, opacity: Array<number> | { opacity: Array<number> } = [0, 1], easing?: Easing): this
    {
        this._time(t0, 'fade')
        this._time(t1, 'fade')
        this._ref(ref, 'fade')
        const [a, b] = Array.isArray(opacity) ? opacity : (opacity?.opacity ?? [0, 1])
        ;[a, b].forEach(v => this._opacity(v, 'fade'))
        if (t1 < t0) { throw new Error(`${this._where('fade')}: it ends (${t1} s) before it starts (${t0} s).`) }

        this._spec.opacity.push({ t: t0, ref, value: a, easing: 'linear' })
        this._spec.opacity.push({ t: t1, ref, value: b, ...(easing ? { easing: this._easing(easing, 'fade') } : {}) })
        return this
    }

    /** Colour a part from t0 to t1, then back to its own colour. */
    highlight(ref: any, t0: number, t1: number, color: any = 'orange'): this
    {
        this._time(t0, 'highlight')
        this._time(t1, 'highlight')
        this._ref(ref, 'highlight')
        if (t1 < t0) { throw new Error(`${this._where('highlight')}: it ends (${t1} s) before it starts (${t0} s).`) }
        const value = this._color(color, 'highlight')

        // a short ramp each way, a quarter of the highlight at most
        const ramp = Math.min(0.25, (t1 - t0) / 4)
        this._spec.color.push(
            { t: t0, ref, value: null, easing: 'linear' },
            { t: t0 + ramp, ref, value, easing: 'easeOut' },
            { t: t1 - ramp, ref, value, easing: 'linear' },
            { t: t1, ref, value: null, easing: 'easeIn' })
        return this
    }

    /** A colour key. `null` is the part's own colour. */
    color(ref: any, t: number, color: any, easing?: Easing): this
    {
        this._time(t, 'color')
        this._ref(ref, 'color')
        const value = (color === null) ? null : this._color(color, 'color')
        this._spec.color.push({ t, ref, value, ...(easing ? { easing: this._easing(easing, 'color') } : {}) })
        return this
    }

    /** An opacity key, 0..1: 1 is the part as the model has it. */
    opacity(ref: any, t: number, value: number, easing?: Easing): this
    {
        this._time(t, 'opacity')
        this._ref(ref, 'opacity')
        this._opacity(value, 'opacity')
        this._spec.opacity.push({ t, ref, value, ...(easing ? { easing: this._easing(easing, 'opacity') } : {}) })
        return this
    }

    //// CAMERA ////

    /** A camera key: a side ('front'), an iso-style direction ([-1,-1,1]) or an eye point,
     *  looking at `lookAt` (a point, a Shape or a part; default the model). */
    camera(t: number, position: CameraInput, lookAt?: any, easing?: Easing): this
    {
        this._time(t, 'camera')
        if (position === undefined || position === null)
        {
            throw new Error(`${this._where('camera')}: Please say where the camera is: a side like 'front', a direction like [-1,-1,1] or a point.`)
        }
        this._spec.camera.push({ t, position, ...(lookAt !== undefined ? { lookAt } : {}),
            ...(easing ? { easing: this._easing(easing, 'camera') } : {}) })
        return this
    }

    /** The camera turns round the model over the animation. Default a full turn.
     *  @param options.elevation degrees above the ground; default that of an iso view */
    turntable(degrees: number = 360, options: { elevation?: number } = {}): this
    {
        if (typeof degrees !== 'number' || !Number.isFinite(degrees))
        {
            throw new Error(`${this._where('turntable')}: Please give the degrees to turn, like .turntable(360). Got ${degrees}.`)
        }
        this._spec.turntable = { degrees, ...(options.elevation !== undefined ? { elevation: options.elevation } : {}) }
        return this
    }

    /** Film it in perspective. Default for an animation's camera. */
    perspective(on: boolean = true): this
    {
        this._spec.projection = on ? 'perspective' : 'orthographic'
        return this
    }

    orthographic(): this
    {
        return this.perspective(false)
    }

    //// INSTRUCTABLES ////

    /** Play an instructable's steps: its parts arrive as the manual says, each step a chapter.
     *  @param instruct its name; default the first one
     *  @param options.hide hide parts until their step shows them. Default true. */
    steps(instruct?: string, options: { hide?: boolean } = {}): this
    {
        this._spec.steps = instruct ?? true
        this._spec.stepsHide = options.hide !== false
        return this
    }

    //// PARAMETERS ////

    /** Sweep a parameter: the script runs once per frame with its values. Run by the editor or
     *  `archiyou animate`, not by a run on its own. Several calls advance together.
     *  @param values a list, or { from, to, frames } */
    param(name: string, values: Array<any> | { from: number, to: number, frames?: number }): this
    {
        if (typeof name !== 'string' || !name)
        {
            throw new Error(`${this._where('param')}: Please name the parameter, like .param('WIDTH', { from: 400, to: 800 }).`)
        }

        const list = Array.isArray(values) ? values : this._range(values)
        if (list.length < 2)
        {
            throw new Error(`${this._where('param')}: '${name}' needs two values or more to animate between.`)
        }
        if (list.length > PARAM_FRAMES_MAX)
        {
            throw new Error(`${this._where('param')}: '${name}' asks for ${list.length} frames; the most is ${PARAM_FRAMES_MAX}, `
                + `because every frame is a run of the whole script.`)
        }
        this._spec.params.push({ name, values: list })
        return this
    }

    //// OUT ////

    /** What can be said without resolving anything.
     *  @internal */
    info(): AnimationInfo
    {
        const s = this._spec
        const duration = s.duration
        const frames = s.params.length ? Math.min(...s.params.map(p => p.values.length)) : 0
        return {
            name: s.name,
            ...(s.title ? { title: s.title } : {}),
            ...(duration !== undefined ? { duration } : {}),
            loop: s.loop ?? 'none',
            ...(s.preset ? { preset: { kind: s.preset.kind, options: plainOptions(s.preset.options) } } : {}),
            ...(frames ? { params: {
                names: s.params.map(p => p.name),
                frames,
                values: Array.from({ length: frames }, (_, i) => Object.fromEntries(s.params.map(p => [p.name, p.values[i]]))),
            } } : {}),
        }
    }

    //// CHECKS ////

    _where(verb: string): string
    {
        return `Animation '${this._spec.name}'.${verb}()`
    }

    _time(t: any, verb: string): void
    {
        if (typeof t !== 'number' || !Number.isFinite(t) || t < 0)
        {
            throw new Error(`${this._where(verb)}: Please give a time in seconds, 0 or more. Got ${t}.`)
        }
    }

    _ref(ref: any, verb: string): void
    {
        if (ref === undefined || ref === null || ref === '')
        {
            throw new Error(`${this._where(verb)}: Please say what it is about: a Shape, a part label like 'A' or a layer name.`)
        }
    }

    _easing(easing: any, verb: string): Easing
    {
        if (!EASINGS.includes(easing))
        {
            throw new Error(`${this._where(verb)}: "${easing}" is not an easing. Use ${EASINGS.map(e => `'${e}'`).join(', ')}.`)
        }
        return easing
    }

    _opacity(value: any, verb: string): void
    {
        if (typeof value !== 'number' || value < 0 || value > 1)
        {
            throw new Error(`${this._where(verb)}: opacity goes from 0 (invisible) to 1 (as modelled). Got ${value}.`)
        }
    }

    _color(color: any, verb: string): string
    {
        try
        {
            return new Color(color).toHex()
        }
        catch
        {
            throw new Error(`${this._where(verb)}: "${color}" is not a colour. Use a name ('orange'), '#ff8000' or 'rgb(255,128,0)'.`)
        }
    }

    _layoutKind(kind: any, verb: string): LayoutKind
    {
        const k = layoutKindOf(kind)
        if (!k) { throw new Error(`${this._where(verb)}: "${kind}" is not a layout. Use 'partstack', 'row' or 'exploded'.`) }
        return k
    }

    _pose(pose: any): PoseInput
    {
        if (!pose || typeof pose !== 'object' || Array.isArray(pose))
        {
            throw new Error(`${this._where('key')}: a pose is an object, like { rotation: [0, 0, 90] } or { move: [0, 0, 100] }. `
                + `{} is the part as modelled.`)
        }
        const vector = (name: string, v: any, sizes: Array<number>) =>
        {
            if (v === undefined) { return }
            if (!Array.isArray(v) || !sizes.includes(v.length) || v.some((n: any) => typeof n !== 'number'))
            {
                throw new Error(`${this._where('key')}: ${name} should be ${sizes.map(n => `${n} numbers`).join(' or ')}. Got ${JSON.stringify(v)}.`)
            }
        }
        vector('position', pose.position, [3])
        vector('move', pose.move, [3])
        vector('rotation', pose.rotation, [3, 4])
        if (typeof pose.scale !== 'number') { vector('scale', pose.scale, [3]) }
        if (pose.position && pose.move)
        {
            throw new Error(`${this._where('key')}: give a position or a move, not both.`)
        }
        return { ...pose }
    }

    _range(spec: any): Array<number>
    {
        const { from, to } = spec ?? {}
        const frames = spec?.frames ?? PARAM_FRAMES_DEFAULT
        if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(frames) || frames < 2)
        {
            throw new Error(`${this._where('param')}: Please give { from, to } numbers and 2 frames or more, like { from: 400, to: 800, frames: 9 }.`)
        }
        return Array.from({ length: frames }, (_, i) => from + (to - from) * i / (frames - 1))
    }
}

/** A layout by any of its names, or null. */
export function layoutKindOf(kind: any): LayoutKind | null
{
    const k = String(kind ?? '').toLowerCase()
    if (['partstack', 'stack', 'stacks'].includes(k)) { return 'partstack' }
    if (['row', 'layout', 'flat'].includes(k)) { return 'row' }
    if (['exploded', 'explode'].includes(k)) { return 'exploded' }
    return null
}

/** Preset options as plain data: a Shape in `only` is shown by its name. */
function plainOptions(options: Record<string, any>): Record<string, any>
{
    const plain = (v: any): any => Array.isArray(v) ? v.map(plain)
        : (v && typeof v === 'object' && typeof v.name === 'function') ? v.name()
        : v
    return Object.fromEntries(Object.entries(options ?? {}).map(([k, v]) => [k, plain(v)]))
}
