/**
 *  animator/standard.ts
 *
 *  The standard animations, as data. Each is the list of calls that makes it:
 *
 *      flyin = animator.create('flyin')
 *          .from('partstack').order('bottomUp').stagger({ last: 0.6 }).duration(3).easing('easeOut')
 *
 *  `animator.preset('flyin')` makes a new animation and runs these calls on it. What comes
 *  after the calls wins, as it does in any chain: `animator.preset('flyin').duration(6)` is the
 *  fly-in in 6 seconds. The editor's Animation tool writes them out in full instead, keys and
 *  camera keys, as examples to change (exampleCode() in animator/code.ts).
 *
 *  No imports at runtime, so the editor can list them without loading the animator (or a
 *  kernel) on the main thread. Animator.ts re-exports all of it.
 */

import type { PresetKind } from './types'

export const PRESET_KINDS: Array<PresetKind> = ['flyin', 'exploded', 'layout', 'turntable', 'build', 'assembly']

/** A call on an Animation: the verb and its arguments. */
export type PresetCall = [verb: string, ...args: Array<any>]

/** What the editor shows of a standard animation. */
export const PRESETS: Record<PresetKind, { title: string, description: string }> = {
    flyin: { title: 'Fly in', description: 'The parts fly from stacks of stock beside the model to where the model has them.' },
    exploded: { title: 'Exploded', description: 'The model comes apart along its explode directions.' },
    layout: { title: 'Layout', description: 'Every shape laid flat in a row.' },
    turntable: { title: 'Turntable', description: 'The camera circles the model.' },
    build: { title: 'Build', description: 'The parts appear one after another, lowest first, each dropping into place.' },
    assembly: { title: 'Assembly', description: 'The first instructable of the script, played step by step.' },
}

/** The calls of a standard animation, with the options of `animator.preset(kind, options)`
 *  folded in: duration, easing (or interpolation), loop, order, stagger, only, title,
 *  turntable (degrees), elevation, perspective, and per kind spacing, beside, distance,
 *  degrees, drop, instruct and hide. Without options, the calls the editor writes. */
export function presetCalls(kind: PresetKind, options: Record<string, any> = {}): Array<PresetCall>
{
    const o = options ?? {}
    const defined = (values: Record<string, any>) =>
        Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
    const layout = defined({ spacing: o.spacing, beside: o.beside, distance: o.distance })
    const elevation = defined({ elevation: o.elevation })

    // 1 s for exploded and layout: what `animations: true` has always baked them at
    const own: Record<PresetKind, Array<PresetCall>> = {
        // the last part leaves at 60 % of the way, so it still has time to arrive
        flyin: [['from', 'partstack', layout], ['order', 'bottomUp'], ['stagger', { last: 0.6 }],
            ['duration', 3], ['easing', 'easeOut']],
        exploded: [['to', 'exploded', layout], ['duration', 1], ['loop', 'pingpong']],
        // where the row has always been: from the origin, as rowOrtho() puts it
        layout: [['to', 'row', { beside: false, ...layout }], ['duration', 1], ['loop', 'pingpong']],
        turntable: [['turntable', o.degrees ?? 360, elevation], ['duration', 8], ['loop', 'loop'], ['easing', 'linear']],
        build: [['build', defined({ drop: o.drop })], ['order', 'bottomUp'], ['easing', 'easeOut']],
        assembly: [['steps', o.instruct, defined({ hide: o.hide })]],
    }

    const only = (o.only === undefined || o.only === null) ? [] : [o.only].flat()
    const tuned: Array<PresetCall | false> = [
        o.title !== undefined && ['title', o.title],
        o.duration !== undefined && ['duration', o.duration],
        (o.easing ?? o.interpolation) !== undefined && ['easing', o.easing ?? o.interpolation],
        o.loop !== undefined && ['loop', o.loop],
        o.order !== undefined && ['order', o.order],
        o.stagger !== undefined && ['stagger', o.stagger],
        only.length > 0 && ['only', ...only],
        (kind !== 'turntable' && typeof o.turntable === 'number') && ['turntable', o.turntable, elevation],
        o.perspective === false && ['orthographic'],
    ]

    return [...own[kind], ...tuned.filter((c): c is PresetCall => !!c)]
}

/** The names `?animations=true` bakes: what it meant before there was an animator. */
export const LEGACY_ANIMATIONS: Array<PresetKind> = ['exploded', 'layout']

export function isPresetKind(name: any): name is PresetKind
{
    return PRESET_KINDS.includes(name)
}
