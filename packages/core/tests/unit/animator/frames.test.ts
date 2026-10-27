/**
 *  A parameter sweep as one clip: the script run once per frame, the GLBs merged into the
 *  first. A part that keeps its mesh morphs, one that only moves gets a translation, one that
 *  stays is left alone, and one whose mesh changes plays as a flipbook.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { GLTFBuilder, createNodeIO } from '../../../src/GLTFBuilder'
import { frameTimes } from '../../../src/animator/frames'

const SWEEP = `
$PARAMS.define('WIDTH', 'number', { default: 400, minimum: 100, maximum: 1000 });
plank = box($WIDTH, 100, 20).name('plank');
leg = box(40, 40, 400).moveTo($WIDTH / 2, 0, -200).name('leg');
fixed = box(50).moveTo(0, 500, 0).name('fixed');
knob = (($WIDTH > 500) ? sphere(50) : box(50)).moveTo(0, -300, 0).name('knob');
widths = animator.create('widths').param('WIDTH', { from: 200, to: 800, frames: 4 }).duration(3).loop('pingpong');
`

let runner: Runner
const glbOf = async (params: Record<string, any>) =>
{
    const result = await runner.execute({ script: { code: SWEEP }, params, outputs: ['default/model/glb'], kernel: 'mesh' } as RunnerScriptExecutionRequest)
    const output = result.outputs!.find((o: any) => o.path.format === 'glb')!.output as any
    return { result, glb: (output instanceof Uint8Array) ? output : new Uint8Array(output) }
}

/** One run after the other: a Runner runs one script at a time. */
const framesOf = (widths: Array<number>) => widths.reduce(async (acc, WIDTH) =>
    [...await acc, (await glbOf({ WIDTH })).glb], Promise.resolve([] as Array<Uint8Array>))

beforeAll(async () =>
{
    runner = new Runner()
    await runner.load()
})

describe('a parameter sweep', () =>
{
    it('says its frames in the run, and bakes nothing there', async () =>
    {
        const { result } = await glbOf({})
        const [info] = (result.state as any).animations
        expect(info.params).toEqual({ names: ['WIDTH'], frames: 4, values: [{ WIDTH: 200 }, { WIDTH: 400 }, { WIDTH: 600 }, { WIDTH: 800 }] })
        expect(frameTimes(4, 3)).toEqual([0, 1, 2, 3])
    })

    it('merges the frames: morph, move, keep, flipbook', async () =>
    {
        const frames = await framesOf([200, 400, 600, 800])
        const builder = new GLTFBuilder(frames[0])
        const report = await builder.addParamFrames(frames.slice(1), { name: 'widths', duration: 3, loop: 'pingpong', values: [{ WIDTH: 200 }] })
        expect(report).toMatchObject({ frames: 4, morphed: 1, moved: 1, unchanged: 1, flipbook: 1, animated: true })

        const doc = await createNodeIO().readBinary(await builder.toGLB())
        const [clip] = doc.getRoot().listAnimations()
        expect(clip.getName()).toBe('widths')
        const channels = clip.listChannels().map(c => ({ node: c.getTargetNode()!, path: c.getTargetPath(), sampler: c.getSampler()! }))
        const nodeNamed = (prefix: string) => doc.getRoot().listNodes().filter(n => n.getMesh() && n.getName().startsWith(prefix))

        // the plank keeps its mesh and grows: a morph target per later frame, weights 0 → e1 → e2 → e3
        const [plank] = nodeNamed('plank')
        const weights = channels.find(c => c.node === plank && c.path === 'weights')!
        expect(Array.from(weights.sampler.getOutput()!.getArray()!)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
        const [prim] = plank.getMesh()!.listPrimitives()
        expect(prim.listTargets().length).toBe(3)
        // frame 3 is the base plus its target: the 800 wide plank
        const position = prim.getAttribute('POSITION')!.getArray()!
        const delta = prim.listTargets()[2].getAttribute('POSITION')!.getArray()!
        const xs = Array.from({ length: position.length / 3 }, (_, i) => position[i * 3] + delta[i * 3])
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(800, 3)

        // the leg only moves: a translation channel, no targets
        const [leg] = nodeNamed('leg')
        expect(channels.filter(c => c.node === leg).map(c => c.path)).toEqual(['translation'])
        expect(leg.getMesh()!.listPrimitives()[0].listTargets().length).toBe(0)

        // the fixed box: nothing
        const [fixed] = nodeNamed('fixed')
        expect(channels.some(c => c.node === fixed)).toBe(false)

        // the knob is a box, then a sphere: two nodes, each shown for its own frames
        const knobs = nodeNamed('knob')
        expect(knobs.length).toBe(2)
        const shown = knobs.map(k =>
        {
            const scale = channels.find(c => c.node === k && c.path === 'scale')!
            expect(scale.sampler.getInterpolation()).toBe('STEP')
            const values = Array.from(scale.sampler.getOutput()!.getArray()!)
            return Array.from({ length: 4 }, (_, i) => values[i * 3] > 0.5)
        })
        expect(shown).toEqual([[true, true, false, false], [false, false, true, true]])
        expect(knobs[1].getParentNode()).toBe(knobs[0].getParentNode())

        // the data the viewer reads
        expect((doc.getRoot().getExtras() as any).animations).toEqual([
            { name: 'widths', duration: 3, loop: 'pingpong', tracks: [], params: { frames: [{ WIDTH: 200 }] } }])
    })

    it('writes valid targets: bounds on their positions, the mesh weights', async () =>
    {
        const frames = await framesOf([200, 800])
        const builder = new GLTFBuilder(frames[0])
        await builder.addParamFrames(frames.slice(1), { name: 'w', duration: 1, loop: 'none' })
        const { json } = await createNodeIO().writeJSON(await createNodeIO().readBinary(await builder.toGLB()))
        const morphed = json.meshes!.find(m => m.primitives.some(p => p.targets?.length))!
        expect(morphed.weights).toEqual([0])
        const target = morphed.primitives[0].targets![0] as any
        expect(json.accessors![target.POSITION].min).toBeDefined()
        expect(json.accessors![target.POSITION].max).toBeDefined()
    })

    it('writes no clip when nothing changes', async () =>
    {
        const { glb } = await glbOf({ WIDTH: 300 })
        const builder = new GLTFBuilder(glb)
        const report = await builder.addParamFrames([glb, glb], { name: 'still', duration: 1, loop: 'none' })
        expect(report.animated).toBe(false)
        expect((await createNodeIO().readBinary(await builder.toGLB())).getRoot().listAnimations()).toEqual([])
    })
})
