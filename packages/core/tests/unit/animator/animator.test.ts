/**
 *  The animator as a script uses it: declared through the scope, resolved only when an output
 *  asks, baked into the model's GLB.
 */

import { describe, expect, it } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { createNodeIO } from '../../../src/GLTFBuilder'
import { Animator, animationNamesFor, PRESET_KINDS } from '../../../src/animator/Animator'
import { KHR_ANIMATION_POINTER } from '../../../src/animator/AnimationPointerExtension'
import { rotatePoint } from '../../../src/animator/sampling'
import type { Quat, Vec3 } from '../../../src/animator/types'

const MODEL = `
legs = group('legs',
    box(44,44,700).moveTo(0,0,350).name('leg'),
    box(44,44,700).moveTo(1100,0,350).name('leg'));
top = box(1200,600,18).moveTo(550,250,709).name('top');
`

const ANIMATED = MODEL + `
animator.preset('flyin', { duration: 4 });

swing = animator.create('swing').duration(2).loop('pingpong');
swing.key(0, top, {});
swing.key(2, top, { rotation: [0, 0, 90] }, 'easeInOut');
swing.highlight('legs', 0.5, 1.5, 'orange');
swing.fade(top, 0, 1);
`

async function run(code: string, outputs: Array<string> = [])
{
    const runner = new Runner()
    await runner.load()
    const result = await runner.execute({ script: { code }, outputs, kernel: 'mesh', messages: ['user', 'warn'] } as RunnerScriptExecutionRequest)
    return { runner, result }
}

async function glbOf(result: any)
{
    const output = result.outputs?.find((o: any) => o.path.format === 'glb')
    const bytes = output?.output as any
    return createNodeIO().readBinary(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.data ?? bytes))
}

const clipNames = (doc: any) => doc.getRoot().listAnimations().map((a: any) => a.getName())
const clip = (doc: any, name: string) => doc.getRoot().listAnimations().find((a: any) => a.getName() === name)
const outputOf = (c: any) => Array.from(c.getSampler().getOutput().getArray() as Float32Array)
const inputOf = (c: any) => Array.from(c.getSampler().getInput().getArray() as Float32Array)

describe('declaring', () =>
{
    const animator = () => new Animator()

    it('says what is wrong where the script says it', () =>
    {
        expect(() => animator().create('a').duration(0)).toThrow(/duration in seconds above 0/)
        expect(() => animator().create('a').easing('bouncy' as any)).toThrow(/"bouncy" is not an easing/)
        expect(() => animator().create('a').key(-1, 'A', {})).toThrow(/time in seconds, 0 or more/)
        expect(() => animator().create('a').key(0, 'A', { position: [1, 2] })).toThrow(/position should be 3 numbers/)
        expect(() => animator().create('a').key(0, 'A', { position: [0, 0, 0], move: [1, 0, 0] })).toThrow(/not both/)
        expect(() => animator().create('a').highlight('A', 0, 1, 'notacolour')).toThrow(/is not a colour/)
        expect(() => animator().create('a').from('pile' as any)).toThrow(/"pile" is not a layout/)
        expect(() => animator().preset('spin' as any)).toThrow(/"spin" is not a standard animation/)
        expect(() => animator().create('a').param('W', { from: 0, to: 1, frames: 49 })).toThrow(/the most is 48/)
    })

    it('gives back the animation of a name already declared, so a script can add to it', () =>
    {
        const a = animator()
        const first = a.create('x').duration(3)
        expect(a.create('x')).toBe(first)
        expect(a.names()).toEqual(['x'])
    })

    it('tells what it declared without resolving anything', () =>
    {
        const a = animator()
        a.preset('flyin')
        a.create('swing').duration(2).loop('pingpong')
        a.create('widths').param('WIDTH', { from: 400, to: 800, frames: 5 })

        expect(a.info()).toEqual([
            { name: 'flyin', duration: 3, loop: 'none', preset: { kind: 'flyin', options: {} } },
            { name: 'swing', duration: 2, loop: 'pingpong' },
            { name: 'widths', loop: 'none', params: { names: ['WIDTH'], frames: 5,
                values: [400, 500, 600, 700, 800].map(WIDTH => ({ WIDTH })) } },
        ])
    })
})

describe('which animations an output asks for', () =>
{
    const declared = () => ['swing', 'flyin']

    it('none unless asked', () =>
    {
        [undefined, false, 0, '', 'false'].forEach(v => expect(animationNamesFor(v, declared)).toEqual([]))
    })

    it('`true` keeps meaning the two layout views', () =>
    {
        expect(animationNamesFor(true, declared)).toEqual(['exploded', 'layout'])
        expect(animationNamesFor(1, declared)).toEqual(['exploded', 'layout'])
    })

    it('a list, the declared ones, or everything', () =>
    {
        expect(animationNamesFor('turntable,swing', declared)).toEqual(['turntable', 'swing'])
        expect(animationNamesFor('turntable%2Cswing', declared)).toEqual(['turntable', 'swing'])
        expect(animationNamesFor('declared', declared)).toEqual(['swing', 'flyin'])
        expect(animationNamesFor('*', declared)).toEqual(['swing', ...PRESET_KINDS])
    })
})

describe('nothing runs unless asked', () =>
{
    it('a script that never names the animator has none', async () =>
    {
        const { runner, result } = await run(MODEL, ['default/model/glb'])
        expect(result.status).toBe('success')
        expect((runner as any).getActiveScope()._archiyou.animator).toBeUndefined()
        expect((result.state as any).animations).toBeUndefined()
        expect(result.meta?.animations).toEqual([])
    })

    it('a run that asks for no animation bakes none, whatever the script declared', async () =>
    {
        const { result } = await run(ANIMATED, ['default/model/glb'])
        expect(result.status).toBe('success')

        const doc = await glbOf(result)
        expect(clipNames(doc)).toEqual([])
        expect((doc.getRoot().getExtras() as any).animations).toBeUndefined()

        // but it says what there is to ask for
        expect(result.meta?.animations).toEqual(['flyin', 'swing'])
        expect((result.state as any).animations.map((a: any) => a.name)).toEqual(['flyin', 'swing'])
    })
})

describe('baked into the GLB on request', () =>
{
    it('the declared ones by name', async () =>
    {
        const { result } = await run(ANIMATED, ['default/model/glb?animations=flyin,swing'])
        expect(result.status).toBe('success')

        const doc = await glbOf(result)
        expect(clipNames(doc)).toEqual(['flyin', 'swing'])

        const extras = doc.getRoot().getExtras() as any
        expect(extras.animations.map((a: any) => [a.name, a.duration, a.loop])).toEqual([['flyin', 4, 'none'], ['swing', 2, 'pingpong']])
    })

    it('a point of the model is a shape like any other, not a collection of its coordinates', async () =>
    {
        // as the workbench has one: a vertex copied into the model, which all() gives along
        const { result } = await run(MODEL + `
corner = top.select('V||topleftfront').copy().move(0, 0, 100);
lift = animator.create('lift').duration(1);
all().forEach(shape => lift.key(0, shape, {}).key(1, shape, { move: [0, 0, 50] }));
`, ['default/model/glb?animations=lift'])
        expect(result.status).toBe('success')
        expect((result.messages ?? []).map((m: any) => m.message).join('\n')).not.toMatch(/could not make/)
        expect(clipNames(await glbOf(result))).toEqual(['lift'])
    })

    it('flyin starts every part in stacks in front of the model and ends it where the model has it', async () =>
    {
        const { result } = await run(ANIMATED, ['default/model/glb?animations=flyin'])
        const doc = await glbOf(result)
        const flyin = clip(doc, 'flyin')

        const containers = ['leg', 'top']
        const nodes = doc.getRoot().listNodes().filter((n: any) => containers.includes(n.getName()))
        expect(nodes).toHaveLength(3)

        nodes.forEach((node: any) =>
        {
            const channels = flyin.listChannels().filter((c: any) => c.getTargetNode() === node)
            const translation = channels.find((c: any) => c.getTargetPath() === 'translation')
            const rotation = channels.find((c: any) => c.getTargetPath() === 'rotation')
            const t = outputOf(translation)
            const r = rotation ? outputOf(rotation) : [0, 0, 0, 1]
            const local = node.listChildren()[0].getTranslation() as Vec3

            const centreAt = (i: number): Vec3 =>
            {
                const q = (rotation ? r.slice(i * 4, i * 4 + 4) : [0, 0, 0, 1]) as Quat
                const turned = rotatePoint(q, local)
                return [t[i * 3] + turned[0], t[i * 3 + 1] + turned[1], t[i * 3 + 2] + turned[2]]
            }

            // in front of the model (its front is y = -22), in stacks on the ground: two legs
            // of 44 make a stack 88 high, the top lies flat
            const start = centreAt(0)
            expect(start[1]).toBeLessThan(-22)
            expect(start[2]).toBeLessThan(88)

            // and home at the end, as modelled
            const last = inputOf(translation).length - 1
            expect(inputOf(translation)[last]).toBeCloseTo(4, 5)
            centreAt(last).forEach((v, i) => expect(v).toBeCloseTo(local[i], 2))
        })
    })

    it('the parts leave one after another, lowest first, and the last still arrives in time', async () =>
    {
        const { result } = await run(ANIMATED, ['default/model/glb?animations=flyin'])
        const data = ((await glbOf(result)).getRoot().getExtras() as any).animations[0]

        // a part's last two keys: held laid out until it leaves, then home when it arrives
        const departures = data.tracks.map((t: any) =>
            ({ z: t.centre[2], leaves: t.pose.at(-2).t, arrives: t.pose.at(-1).t }))
            .sort((a: any, b: any) => a.leaves - b.leaves)

        expect(departures[0].leaves).toBe(0)
        expect(departures.map((d: any) => d.z)).toEqual([...departures.map((d: any) => d.z)].sort((a, b) => a - b))
        departures.forEach((d: any) => expect(d.arrives).toBeLessThanOrEqual(4 + 1e-9))
        expect(departures[departures.length - 1].leaves).toBeCloseTo(0.6 * 4, 5)
    })

    it('leaves the scene as it was: no shape moved, nothing added', async () =>
    {
        const { runner, result } = await run(ANIMATED + `
            before = all().bbox().max().toArray().concat(all().bbox().min().toArray());
            countBefore = all().length;
        `, ['default/model/glb?animations=*'])
        expect(result.status).toBe('success')

        const scope = (runner as any).getActiveScope()
        const all = scope.modeler.all()
        expect(all.length).toBe(scope.countBefore)
        expect(all.bbox().max().toArray().concat(all.bbox().min().toArray())).toEqual(scope.before)
    })

    it('colour and opacity as KHR_animation_pointer channels; the turn as a rotation', async () =>
    {
        const { result } = await run(ANIMATED, ['default/model/glb?animations=swing'])
        const doc = await glbOf(result)
        const swing = clip(doc, 'swing')

        const pointers = swing.listChannels().filter((c: any) => c.getExtension(KHR_ANIMATION_POINTER))
        // two legs highlighted and the top faded: one material each at least
        expect(pointers.length).toBeGreaterThanOrEqual(3)
        expect(swing.listChannels().some((c: any) => c.getTargetPath() === 'rotation' && c.getTargetNode().getName() === 'top')).toBe(true)
    })

    it('a standard animation the script never declared, made on the spot', async () =>
    {
        const { result } = await run(MODEL, ['default/model/glb?animations=turntable,exploded'])
        const doc = await glbOf(result)
        expect(clipNames(doc)).toEqual(['turntable', 'exploded'])

        const camera = doc.getRoot().listNodes().find((n: any) => n.getName() === 'turntable-camera')
        expect(camera?.getCamera()?.getType()).toBe('perspective')
        const translation = clip(doc, 'turntable').listChannels().find((c: any) => c.getTargetNode() === camera && c.getTargetPath() === 'translation')
        expect(inputOf(translation).at(-1)).toBeCloseTo(8, 5)
    })

    it('a key past the end is said, with both numbers, and that animation is left out', async () =>
    {
        const { result } = await run(MODEL + `
            late = animator.create('late').duration(1);
            late.key(3, top, { move: [0, 0, 100] });
        `, ['default/model/glb?animations=late'])
        expect(result.status).toBe('success')
        expect(clipNames(await glbOf(result))).toEqual([])

        expect(JSON.stringify(result.messages)).toContain('a key at 3 s is past its end at 1 s')
    })

    it('a parameter sweep is declared, not baked by a single run', async () =>
    {
        const { result } = await run(MODEL + `
            animator.create('widths').param('WIDTH', { from: 400, to: 800, frames: 3 });
        `, ['default/model/glb?animations=widths'])
        expect(clipNames(await glbOf(result))).toEqual([])
        expect((result.state as any).animations[0].params).toEqual({ names: ['WIDTH'], frames: 3,
            values: [{ WIDTH: 400 }, { WIDTH: 600 }, { WIDTH: 800 }] })
    })
})

describe('build', () =>
{
    it('shows the parts one after another, lowest first, each dropping into place', async () =>
    {
        const { result } = await run(MODEL + `animator.preset('build');`, ['default/model/glb?animations=build'])
        const data = ((await glbOf(result)).getRoot().getExtras() as any).animations[0]

        // a quarter of a second per part, at least a second
        expect(data.duration).toBe(1)
        const appearances = data.tracks
            .map((t: any) => ({ z: t.centre[2], at: t.visible.find((v: any) => v.value).t, from: t.pose[0].position[2] }))
            .sort((a: any, b: any) => a.at - b.at)
        expect(appearances.map((a: any) => a.z)).toEqual([...appearances.map((a: any) => a.z)].sort((a, b) => a - b))
        appearances.forEach((a: any) => expect(a.from).toBeGreaterThan(a.z))
    })

    it('is a verb of its own too, as the guide writes it', async () =>
    {
        const { result } = await run(MODEL + `animator.create('assemble').build({ drop: 50 }).duration(5);`,
            ['default/model/glb?animations=assemble'])
        const data = ((await glbOf(result)).getRoot().getExtras() as any).animations[0]
        expect(data.duration).toBe(5)
        data.tracks.forEach((t: any) => expect(t.pose[0].position[2]).toBeCloseTo(t.centre[2] + 50, 5))
    })
})

describe('an instructable, played', () =>
{
    const MANUAL = MODEL + `
        manual = docs.instruct('assembly').duration(1).parts({ print: false, table: false });
        manual.step('The legs').shapes('A').subject('A');
        manual.step('The top on').shapes('A', 'B').subject('B').move({ from: 'top', distance: 300 });
        animator.preset('assembly');
    `

    it('has the steps as chapters, and hides a part until its step shows it', async () =>
    {
        const { result } = await run(MANUAL, ['default/model/glb?animations=assembly'])
        expect(result.status).toBe('success')

        const doc = await glbOf(result)
        const data = (doc.getRoot().getExtras() as any).animations[0]
        expect(data.chapters.map((c: any) => c.title)).toEqual(['The legs', 'The top on'])

        const top = data.tracks.find((t: any) => t.path.endsWith('top'))
        expect(top.visible.map((v: any) => v.value)).toEqual([false, true])
        expect(top.pose.length).toBeGreaterThan(1)

        const scale = clip(doc, 'assembly').listChannels()
            .find((c: any) => c.getTargetPath() === 'scale' && c.getTargetNode().getName() === 'top_shape_0')
        expect(scale.getSampler().getInterpolation()).toBe('STEP')
    })
})
