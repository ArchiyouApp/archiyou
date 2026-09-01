/** Baking an instructable into a GLB: one continuous clip, a camera per step, and the step
 *  data in root extras.
 *
 *  The split these tests keep honest: glTF animates translation/rotation/scale and NOTHING
 *  else, so the clip carries the motion and only the motion. Hiding a part and highlighting
 *  one are the viewer's job, driven off `extras.instruct` — which is why the step data has to
 *  survive into the file intact and address nodes by a path that is actually resolvable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Modeler } from '../../src/modeler/Modeler'
import { Calc } from '../../src/calc/Calc'
import { Docs } from '../../src/docs/Docs'
import type { Instruct } from '../../src/docs/instruct/Instruct'
import type { ArchiyouModules } from '../../src/types'
import { createNodeIO } from '@archiyou/meshup'

let modeler: Modeler
let docs: Docs

async function buildTable()
{
    modeler = new Modeler()
    await modeler.load()
    const calc = new Calc()
    docs = new Docs(null, {} as any)
    const modules = { modeler, calc, docs } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    calc.setArchiyou(modules)
    docs.setArchiyou(modules)

    modeler.group('legs',
        ...[0, 1, 2, 3].map(i => modeler.box(44, 44, 700)
            .moveToX(i % 2 ? 1100 : 0).moveToY(i < 2 ? 500 : 0).name('leg')))
    modeler.group('frame',
        ...[0, 1].map(i => modeler.box(1180, 44, 60).moveToY(i * 500).moveToZ(600).name('rail')))
    modeler.group('top', modeler.box(1200, 600, 18).moveToZ(730).name('top panel'))
}

/** A three-step manual: legs, then rails move in, then the top drops on. */
function manual(): Instruct
{
    const m = docs.instruct('assembly').title('Workbench').duration(1)
        .parts({ print: false, table: false })

    m.step('Stand the legs up').shapes('A').subject('A')
    m.step('Bolt the rails on').shapes('A', 'B').subject('B').move({ from: 'top', distance: 300 })
    m.step('Drop the top on').shapes('A', 'B', 'C').subject('C')
        .move({ from: 'top', distance: 400, duration: 2 })
    return m
}

async function readGLB(instruct: Instruct, options?: any)
{
    const glb = await modeler.toGLB({ instruct: instruct._name, ...(options ?? {}) })
    const doc = await createNodeIO().readBinary(glb)
    return { doc, root: doc.getRoot(), extras: doc.getRoot().getExtras() as any }
}

beforeEach(async () => { await buildTable() })

describe('extras.instruct', () =>
{
    it('carries the whole instructable into the file', async () =>
    {
        const { extras } = await readGLB(manual())
        const data = extras.instruct

        expect(data.name).toBe('assembly')
        expect(data.title).toBe('Workbench')
        expect(data.parts.map((p: any) => p.label)).toEqual(['A', 'B', 'C'])
        expect(data.steps).toHaveLength(3)
    })

    it('lays the steps out on one contiguous timeline', async () =>
    {
        const { extras } = await readGLB(manual())
        const steps = extras.instruct.steps

        expect(steps.map((s: any) => [s.tStart, s.tEnd]))
            .toEqual([[0, 1], [1, 2], [2, 4]])          // the last step asked for 2 seconds
        expect(extras.instruct.duration).toBe(4)

        // contiguous: no gaps for a scrubber to fall into
        steps.slice(1).forEach((s: any, i: number) => expect(s.tStart).toBe(steps[i].tEnd))
    })

    it('addresses parts by scene paths that actually resolve against the file', async () =>
    {
        const { root, extras } = await readGLB(manual())
        const names = new Set(root.listNodes().map((n: any) => n.getName()))

        const paths: Array<string> = extras.instruct.steps.flatMap((s: any) => s.visible)
        expect(paths.length).toBeGreaterThan(0)

        /*  Every path must name a node that is in the file. Paths, not names: four legs are
            four nodes all called 'leg', and a name would address only the last of them. */
        paths.forEach(path =>
        {
            const leaf = decodeURIComponent(path.split('/').pop() as string)
            expect(names.has(leaf.replace(/\[\d+\]$/, ''))).toBe(true)
        })
        expect(new Set(extras.instruct.parts[0].paths).size).toBe(4)
    })

    it('keeps the state block alongside it', async () =>
    {
        const { extras } = await readGLB(manual())
        expect(extras.state?.scenegraph).toBeDefined()
        expect(extras.instruct).toBeDefined()
    })
})

describe('the animation', () =>
{
    it('is one clip, not one per step', async () =>
    {
        const { root } = await readGLB(manual())
        expect(root.listAnimations().map((a: any) => a.getName())).toEqual(['assembly'])
    })

    it('animates only the parts that actually move', async () =>
    {
        const { root } = await readGLB(manual())
        const anim = root.listAnimations()[0] as any

        // two moving steps: the rails (x2) and the top (x1)
        expect(anim.listChannels()).toHaveLength(3)
        anim.listChannels().forEach((c: any) => expect(c.getTargetPath()).toBe('translation'))
    })

    it('parks a part at its approach position until its step comes round', async () =>
    {
        const { root } = await readGLB(manual())
        const anim = root.listAnimations()[0] as any

        /*  This is what makes the movie read as an assembly rather than as a finished model
            with one twitching component: glTF cannot hide anything, so a part that arrives in
            step 3 has to be somewhere sensible for steps 1 and 2. */
        const top = anim.listChannels().find((c: any) =>
            c.getTargetNode().getName() === 'top panel') as any

        const times = Array.from(top.getSampler().getInput().getArray() as Float32Array)
        const values = Array.from(top.getSampler().getOutput().getArray() as Float32Array)

        expect(times[0]).toBe(0)
        expect(times[1]).toBe(2)                       // held until its step starts
        expect(values.slice(0, 3)).toEqual(values.slice(3, 6))    // and held at one place
        expect(times[times.length - 1]).toBe(4)        // arriving at the end of its step
    })

    it('ends every part at the position the model actually has it in', async () =>
    {
        const { root } = await readGLB(manual())
        const anim = root.listAnimations()[0] as any

        anim.listChannels().forEach((channel: any) =>
        {
            const node = channel.getTargetNode()
            const authored = node.getTranslation()
            const out = Array.from(channel.getSampler().getOutput().getArray() as Float32Array)
            const last = out.slice(-3)

            last.forEach((v: number, i: number) => expect(v).toBeCloseTo(authored[i], 3))
        })
    })

    it('starts it offset by exactly the distance asked for', async () =>
    {
        const { root } = await readGLB(manual())
        const anim = root.listAnimations()[0] as any
        const top = anim.listChannels().find((c: any) =>
            c.getTargetNode().getName() === 'top panel') as any

        const out = Array.from(top.getSampler().getOutput().getArray() as Float32Array)
        const start = out.slice(0, 3)
        const end = out.slice(-3)
        const travelled = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])

        expect(travelled).toBeCloseTo(400, 3)
        expect(start[2]).toBeGreaterThan(end[2])       // it comes down from above
    })

    it('writes no animation at all when nothing moves', async () =>
    {
        const still = docs.instruct('still').parts({ print: false, table: false })
        still.step('just look at it').shapes('A')

        const { root, extras } = await readGLB(still)
        expect(root.listAnimations()).toHaveLength(0)
        expect(extras.instruct.steps).toHaveLength(1)   // the step data is still there
    })

    it('animates one part once, and says so if a script asks twice', async () =>
    {
        const m = docs.instruct('twice').duration(1).parts({ print: false, table: false })
        m.step('in').shapes('C').subject('C').move({ from: 'top' })
        m.step('again').shapes('C').subject('C').move({ from: 'left' })

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { root } = await readGLB(m)
        const messages = warn.mock.calls.flat().join(' ')
        warn.mockRestore()

        expect((root.listAnimations()[0] as any).listChannels()).toHaveLength(1)
        expect(messages).toContain('moves in more than one step')
    })
})

describe('a laid-out step', () =>
{
    /** The workbench, with a "here is what you need" step in front of the assembly. */
    function laidOut(): Instruct
    {
        const m = docs.instruct('assembly').duration(1).parts({ print: false, table: false })
        m.step('Get the parts ready').shapes('A', 'B', 'C').layout('row', { spacing: 50 })
        m.step('Stand the legs up').shapes('A').subject('A')
        m.step('Bolt the rails on').shapes('A', 'B').subject('B').move({ from: 'top', distance: 300 })
        return m
    }

    const channelFor = (root: any, name: string, target: string) =>
        (root.listAnimations()[0] as any).listChannels().find((c: any) =>
            c.getTargetNode().getName() === name && c.getTargetPath() === target)

    const samplesOf = (channel: any) => ({
        times: Array.from(channel.getSampler().getInput().getArray() as Float32Array),
        values: Array.from(channel.getSampler().getOutput().getArray() as Float32Array),
    })

    it('starts the parts where the layout puts them, not where the model has them', async () =>
    {
        /*  A layout only ever reached the drawings: the exported clip opened on the finished
            workbench, so the first step of the manual showed nothing the second did not. */
        const { root, extras } = await readGLB(laidOut())

        const leg = channelFor(root, 'leg', 'translation')
        expect(leg).toBeDefined()

        const { times, values } = samplesOf(leg)
        const placement = extras.instruct.steps[0].placements
            .find((p: any) => p.path.includes('leg'))

        expect(times[0]).toBe(0)
        // the node sits at the origin with the geometry at the part centre, so the node's own
        // translation is `position - rotation * centre` — far from zero, and out along the row
        expect(Math.hypot(values[0], values[1], values[2])).toBeGreaterThan(0)
        expect(placement.position[0]).toBeGreaterThan(0)
    })

    it('brings them back to where the model has them by the end of the clip', async () =>
    {
        const { root, extras } = await readGLB(laidOut())
        const { times, values } = samplesOf(channelFor(root, 'leg', 'translation'))

        expect(times[times.length - 1]).toBeCloseTo(extras.instruct.duration, 3)
        values.slice(-3).forEach(v => expect(v).toBeCloseTo(0, 3))
    })

    it('holds the layout for the whole of the step it belongs to', async () =>
    {
        const { root, extras } = await readGLB(laidOut())
        const { times, values } = samplesOf(channelFor(root, 'leg', 'translation'))

        const held = times.indexOf(extras.instruct.steps[0].tEnd)
        expect(held).toBeGreaterThan(0)                       // there is a keyframe there
        expect(values.slice(0, 3)).toEqual(values.slice(held * 3, held * 3 + 3))
    })

    it('turns a part the layout turns, on its own channel', async () =>
    {
        const { root } = await readGLB(laidOut())
        const rotation = channelFor(root, 'leg', 'rotation')
        expect(rotation).toBeDefined()

        const { values } = samplesOf(rotation)
        expect(values.slice(0, 4)).not.toEqual([0, 0, 0, 1])   // laid flat
        expect(values.slice(-4).map(v => Math.round(v))).toEqual([0, 0, 0, 1])  // and upright again
    })

    it('holds a part that never assembles at its laid-out position for the whole clip', async () =>
    {
        /*  A manual whose only step lays the parts out has nothing to animate — and a glTF
            animation is the only place a file can say a part is anywhere other than where its
            node puts it, so "nothing to animate" still needs a constant track.

            An exploded workbench also shows the other half of the rule: its frame is already
            clear of itself and barely moves, and a part that ends up where it started needs
            no track at all. */
        const m = docs.instruct('assembly').duration(1).parts({ print: false, table: false })
        m.step('spread them out').shapes('A', 'B', 'C').layout('exploded', { distance: 200 })

        const { root, extras } = await readGLB(m)
        const placements = extras.instruct.steps[0].placements
        const moved = placements.filter((p: any) =>
            p.position.some((v: number, i: number) => Math.abs(v - p.centre[i]) > 1e-6))

        expect(moved.length).toBeGreaterThan(0)
        expect(moved.length).toBeLessThan(placements.length)

        const channels = (root.listAnimations()[0] as any).listChannels()
        expect(channels).toHaveLength(moved.length)     // one each, and nothing for the rest

        const { times, values } = samplesOf(channels[0])
        expect(times).toEqual([0, extras.instruct.duration])
        expect(values.slice(0, 3)).toEqual(values.slice(3, 6))    // held, not animated
    })

    it('resolves a laid-out AND moving part into the one track glTF allows', async () =>
    {
        /*  glTF permits exactly one channel per node per path in an animation. A part that is
            laid out in step 1 and fitted in step 3 has two things to say and one track to say
            them in: out in the row, back to its approach position, then in. */
        const { root, extras } = await readGLB(laidOut())

        const rails = (root.listAnimations()[0] as any).listChannels()
            .filter((c: any) => c.getTargetNode().getName() === 'rail'
                             && c.getTargetPath() === 'translation')
        expect(rails).toHaveLength(2)                          // one per rail, not two per rail

        const { times } = samplesOf(rails[0])
        const fitted = extras.instruct.steps[2]
        expect(times.some((t: number) => Math.abs(t - fitted.tStart) < 1e-3)).toBe(true)
        expect(times.every((t: number, i: number) => i === 0 || t > times[i - 1])).toBe(true)
    })
})

describe('cameras', () =>
{
    it('writes one per step, named for it', async () =>
    {
        const { root } = await readGLB(manual())
        expect(root.listCameras().map((c: any) => c.getName()))
            .toEqual(['assembly-step-1', 'assembly-step-2', 'assembly-step-3'])
    })

    it('makes them orthographic by default, and sizes them to the step', async () =>
    {
        const { root } = await readGLB(manual())
        const camera = root.listCameras()[0] as any

        expect(camera.getType()).toBe('orthographic')
        expect(camera.getXMag()).toBeGreaterThan(0)
        expect(camera.getZFar()).toBeGreaterThan(camera.getZNear())
    })

    it('makes them perspective when the instructable asks — the one place that setting shows', async () =>
    {
        const m = manual()
        m.perspective()
        const { root } = await readGLB(m)

        expect((root.listCameras()[0] as any).getType()).toBe('perspective')
    })

    it('points each one at what its step is about', async () =>
    {
        const { root, extras } = await readGLB(manual())

        const node = root.listNodes().find((n: any) => n.getName() === 'assembly-step-3-camera') as any
        expect(node).toBeDefined()

        const eye = node.getTranslation()
        const step = extras.instruct.steps[2]
        eye.forEach((v: number, i: number) => expect(v).toBeCloseTo(step.camera.position[i], 3))

        // and it really faces the target: its own -Z, rotated, points from eye to lookAt
        const forward = rotateByQuaternion([0, 0, -1], node.getRotation())
        const toTarget = normalize([
            step.camera.lookAt[0] - eye[0], step.camera.lookAt[1] - eye[1], step.camera.lookAt[2] - eye[2],
        ])
        forward.forEach((v, i) => expect(v).toBeCloseTo(toTarget[i], 4))
    })

    it('survives looking straight down, where up and the view direction are parallel', async () =>
    {
        const m = docs.instruct('topdown').parts({ print: false, table: false })
        m.step('from above').shapes('A', 'B', 'C').camera('top')

        const { root, extras } = await readGLB(m)
        const node = root.listNodes().find((n: any) => n.getName() === 'topdown-step-1-camera') as any

        const eye = node.getTranslation()
        const forward = rotateByQuaternion([0, 0, -1], node.getRotation())
        const toTarget = normalize([
            extras.instruct.steps[0].camera.lookAt[0] - eye[0],
            extras.instruct.steps[0].camera.lookAt[1] - eye[1],
            extras.instruct.steps[0].camera.lookAt[2] - eye[2],
        ])

        forward.forEach((v, i) => expect(v).toBeCloseTo(toTarget[i], 4))
        expect(node.getRotation().every((n: number) => Number.isFinite(n))).toBe(true)
    })

    it('can be turned off', async () =>
    {
        const { root } = await readGLB(manual(), { instructCameras: false })
        expect(root.listCameras()).toHaveLength(0)
    })
})

describe('the export option', () =>
{
    it('says so rather than silently writing nothing when the name is wrong', async () =>
    {
        manual()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await modeler.toGLB({ instruct: 'nope' })
        const messages = warn.mock.calls.flat().join(' ')
        warn.mockRestore()

        expect(messages).toContain('no instructable named "nope"')
        expect(messages).toContain('Available: assembly')
    })

    it('takes the first instructable for `instruct: true`', async () =>
    {
        manual()
        const glb = await modeler.toGLB({ instruct: true })
        const doc = await createNodeIO().readBinary(glb)
        expect((doc.getRoot().getExtras() as any).instruct.name).toBe('assembly')
    })

    it('is off unless asked for', async () =>
    {
        manual()
        const glb = await modeler.toGLB()
        const doc = await createNodeIO().readBinary(glb)
        expect((doc.getRoot().getExtras() as any).instruct).toBeUndefined()
    })
})

//// helpers ////

function normalize(v: Array<number>): Array<number>
{
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
}

/** v rotated by quaternion [x,y,z,w]. */
function rotateByQuaternion(v: Array<number>, q: Array<number>): Array<number>
{
    const [x, y, z, w] = q
    const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]
    return [
        v[0] + w * t[0] + (y * t[2] - z * t[1]),
        v[1] + w * t[1] + (z * t[0] - x * t[2]),
        v[2] + w * t[2] + (x * t[1] - y * t[0]),
    ]
}
