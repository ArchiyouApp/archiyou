/**
 *  animator/Animator.ts
 *
 *  The script module for animations: what a script reaches as `animator`.
 *
 *      animator.preset('flyin');                                     // a standard one
 *      animator.create('flyin-slow').from('partstack').duration(6);  // tuned
 *      anim = animator.create('swing').duration(2).loop('pingpong'); // keyframed
 *
 *  An animation is the model over time: a deviation from the finished scene, never a change
 *  to it (animator/types.ts). It is exported with the model, as a glTF clip:
 *  `default/model/glb?animations=flyin,swing`.
 *
 *  ## Nothing runs unless asked
 *
 *  The Runner puts `animator` on the scope as a getter: a script that never names it never
 *  creates one. Declaring stores raw arguments (Animation.ts). Resolving — laying out,
 *  measuring parts, reading instructables — happens in resolve.ts, which this module loads
 *  with `import()` only when an output names an animation, and does once per run. A run asked
 *  for no animation computes none, whatever the script declared.
 */

import { Animation, layoutKindOf, type LayoutKind, type LayoutOptions } from './Animation'
import { layoutPlacements } from './layouts'
import { LEGACY_ANIMATIONS, PRESET_KINDS, isPresetKind, presetCalls } from './standard'
import type { AnimationData, AnimationInfo, PresetKind } from './types'

export { LEGACY_ANIMATIONS, PRESETS, PRESET_KINDS, isPresetKind, presetCalls } from './standard'

/** The animation names an `animations` export option asks for.
 *
 *  | false, 0, ''         | none                                                        |
 *  | true, 1              | 'exploded' and 'layout', as before there was an animator     |
 *  | 'declared'           | every animation the script declared                         |
 *  | '*'                  | declared, then every preset                                 |
 *  | 'flyin,swing' / list | those, declared or preset                                   |
 *
 *  A comma may arrive as %2C: ScriptOutputPath re-encodes the options of a path. */
export function animationNamesFor(option: unknown, declared: () => Array<string>): Array<string>
{
    if (option === undefined || option === null || option === false || option === 0 || option === '' || option === 'false')
    {
        return []
    }
    if (option === true || option === 1 || option === 'true') { return [...LEGACY_ANIMATIONS] }

    const list = Array.isArray(option) ? option.map(String) : decodeURIComponent(String(option)).split(',')
    const names = list.map(n => n.trim()).filter(Boolean).flatMap(n =>
        (n === '*') ? [...declared(), ...PRESET_KINDS]
        : (n === 'declared') ? declared()
        : [n])

    return [...new Set(names)]
}

export class Animator
{
    _archiyou: any = null
    _animations: Array<Animation> = []
    /** Resolved once per run, however many outputs ask. */
    _resolved: Map<string, AnimationData | null> = new Map()

    constructor(archiyou?: any)
    {
        this._archiyou = archiyou ?? null
    }

    //// DECLARING ////

    /** A new animation, or the one of that name already declared. */
    create(name: string): Animation
    {
        const existing = this.get(name)
        if (existing) { return existing }

        const made = new Animation(name)
        this._animations.push(made)
        return made
    }

    /** A standard animation: 'flyin', 'exploded', 'layout', 'turntable', 'build' or 'assembly'.
     *  Options tune it: duration, easing, loop, order, stagger, spacing, distance, turntable,
     *  elevation, drop, instruct, only, title; `name` to declare it under another name.
     *  It is the calls of standard.ts on a new animation, and returns it, so it can be tuned
     *  further like any other: the calls after it win. */
    preset(kind: PresetKind, options: Record<string, any> = {}): Animation
    {
        if (!isPresetKind(kind))
        {
            throw new Error(`animator.preset(): "${kind}" is not a standard animation. `
                + `Use ${PRESET_KINDS.map(k => `'${k}'`).join(', ')}, or animator.create('${kind}') for your own.`)
        }

        const { name, ...rest } = options ?? {}
        return applyPreset(this.create(name ?? kind), kind, rest)
    }

    /** Where each shape lies in a layout, to key the shapes yourself: 'partstack' (stacks of
     *  stock beside the model), 'row' (laid flat in a row in front of it) or 'exploded'.
     *
     *      animator.layout('partstack').forEach(stock =>
     *          flyin.key(0, stock.shape, { position: stock.position, rotation: stock.rotation }));
     *
     *  `position` is where the shape's centre goes, `rotation` a quaternion about that centre:
     *  a pose as key() takes it. It lays the model out when called, on every run of the script.
     *  @param options spacing, beside (default true: on the ground in front of the model),
     *      distance (exploded) */
    layout(kind: LayoutKind, options: LayoutOptions = {}): Array<{ shape: any, position: Array<number>, rotation: Array<number> }>
    {
        const k = layoutKindOf(kind)
        if (!k)
        {
            throw new Error(`animator.layout(): "${kind}" is not a layout. Use 'partstack', 'row' or 'exploded'.`)
        }
        const modeler = this._archiyou?.modeler
        if (!modeler?.scene)
        {
            throw new Error(`animator.layout(): there is no model to lay out.`)
        }
        return layoutPlacements(modeler, k, options ?? {})
            .map(p => ({ shape: p.shape, position: [...p.position], rotation: [...p.rotation] }))
    }

    get(name: string): Animation | null
    {
        return this._animations.find(a => a.name === name) ?? null
    }

    /** Names of the declared animations. */
    names(): Array<string>
    {
        return this._animations.map(a => a.name)
    }

    /** @internal */
    animations(): Array<Animation>
    {
        return [...this._animations]
    }

    /** The declarations as plain data, without resolving any of them: `state.animations`.
     *  @internal */
    info(): Array<AnimationInfo>
    {
        return this._animations.map(a => a.info())
    }

    /** @internal */
    reset(): this
    {
        this._animations = []
        this._resolved = new Map()
        return this
    }

    //// RESOLVING ////

    /** Resolve animations by name — declared ones, and standard ones by kind when the script
     *  did not declare them. Loads resolve.ts on first use. One that cannot be resolved is said
     *  in the console and left out: an animation is never the reason a model fails to export.
     *  @param overrides preset options for standard animations the script did not declare
     *      (what `duration` and `interpolation` of the export options become)
     *  @internal */
    async resolve(names: Array<string>, overrides: Record<string, any> = {}): Promise<Array<AnimationData>>
    {
        if (!names.length) { return [] }

        const { resolveAnimation } = await import('./resolve')
        const context = { modeler: this._archiyou?.modeler, docs: this._archiyou?.docs }

        return names.flatMap(name =>
        {
            const declared = this.get(name)
            const animation = declared ?? (isPresetKind(name) ? this._undeclaredPreset(name, overrides) : null)
            if (!animation)
            {
                this._warn(`Animator: there is no animation "${name}" to export. `
                    + `Declared: ${this.names().join(', ') || '(none)'}. Standard: ${PRESET_KINDS.join(', ')}.`)
                return []
            }

            const key = declared ? `declared:${name}` : `preset:${name}:${JSON.stringify(overrides)}`
            if (!this._resolved.has(key))
            {
                try
                {
                    this._resolved.set(key, resolveAnimation(animation._spec, context))
                }
                catch (e)
                {
                    this._warn(`Animator: could not make animation "${name}": ${(e as Error)?.message ?? e}`)
                    this._resolved.set(key, null)
                }
            }

            const data = this._resolved.get(key)
            return data ? [data] : []
        })
    }

    _undeclaredPreset(kind: PresetKind, overrides: Record<string, any>): Animation
    {
        return applyPreset(new Animation(kind), kind, overrides)
    }

    /** To the script's console when there is one, so the author sees it. */
    _warn(message: string): void
    {
        const out = (typeof this._archiyou?.console?.warn === 'function') ? this._archiyou.console : console
        out.warn(message)
    }
}

/** Run a standard animation's calls on an animation. A call the options made wrong throws, as
 *  the same call in a script would. */
function applyPreset(animation: Animation, kind: PresetKind, options: Record<string, any>): Animation
{
    presetCalls(kind, options).forEach(([verb, ...args]) => (animation as any)[verb](...args))
    animation._spec.preset = { kind, options: { ...options } }
    return animation
}
