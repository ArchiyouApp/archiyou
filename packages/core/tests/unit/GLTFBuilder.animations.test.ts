/** Baking a Layouter's transforms into GLB keyframe animations.
 *
 *  This file used to exercise `GLTFBuilder.getExplodedViewTransformsWorld()`,
 *  `.getLayoutViewTransformsWorld()`, `.addExplodedView()`, `.addLayoutView()` and
 *  `.addCachedLayoutAnimations()`. None of those exist any more: computing a layout moved to
 *  `Layouter` (exploded / rowOrtho) and baking it moved to `GLTFBuilder.addAnimations()`. The
 *  whole suite therefore threw "is not a function" on every test — 8 of 8 red, in a file
 *  vitest was collecting the whole time. Rewritten against the current API; the scene fixture
 *  and the vector helpers below are the parts worth keeping.
 *
 *  Two things it pins that the old suite could not:
 *    - the keyframe COUNT follows the interpolation (linear is the only two-sample one), and
 *      is asserted against the exported constants rather than a literal, so tuning the easing
 *      does not silently re-break the tests.
 *    - animations target nodes by SCENE PATH. Four siblings all named `leg` used to collapse
 *      onto one glTF node, because the lookup was keyed on a name that is not unique.
 */
import { beforeAll, describe, expect, test } from 'vitest'

import {
    GLTFBuilder,
    EASED_KEYFRAME_SAMPLE_COUNT,
    SPRING_KEYFRAME_SAMPLE_COUNT,
} from '../../src/GLTFBuilder'
import { Layouter } from '../../src/modeler/Layouter'
import * as meshup from '@archiyou/meshup'

type TestShape = meshup.Mesh | meshup.Curve

interface SceneEntry {
    name: string
    shape: TestShape
}

const EPSILON = 1e-5

beforeAll(async () =>
{
    await meshup.init()
})

/** Bake one layout result into a GLB and read the animation back out. */
async function bake(scene: meshup.SceneNode<any>, layout: Layouter, options: Record<string, any> = {})
{
    const glb = await new GLTFBuilder(await scene.toGLB())
        .addAnimations([{ result: layout.result(), options }])
        .then(b => b.toGLB())

    const doc = await meshup.createNodeIO().readBinary(glb)
    const name = options.animationName ?? layout.result().name
    const animation = doc.getRoot().listAnimations().find((a: any) => a.getName() === name) as any
    return { doc, animation }
}

const channelsFor = (animation: any, path: string) =>
    animation.listChannels().filter((c: any) => c.getTargetPath() === path)

const outputOf = (channel: any) => Array.from(channel.getSampler().getOutput().getArray() as Float32Array)
const inputOf = (channel: any) => Array.from(channel.getSampler().getInput().getArray() as Float32Array)

describe('Layouter transforms', () =>
{
    test('exploded() pushes every shape away from the collection centre', () =>
    {
        const distance = 2.5
        const { scene, entries } = createSceneFixture()
        const transforms = new Layouter(scene).exploded({ distance }).result().transforms

        expect(transforms).toHaveLength(entries.length)

        const centers = entries.map(entry => ({
            name: entry.name,
            center: pointFromShape(entry.shape.center()),
        }))
        /*  The origin of the explosion is the collection's BBOX centre — not the centroid of
            the shape centres, which is a different point as soon as the shapes differ in
            size. See Layouter.exploded(): `this.shapeCollection().bbox().center()`. */
        const origin = pointFromShape(new meshup.ShapeCollection(scene.shapes()).bbox().center())

        transforms.forEach(transform =>
        {
            expect(isIdentityQuaternion(transform.rotation)).toBe(true)
            expect(isIdentityScale(transform.scale)).toBe(true)

            const entry = centers.find(item => item.name === transform.sceneNode.name)
            expect(entry).toBeDefined()

            // Each shape moves along the origin → shape ray, or not at all (the anchor shape).
            if (entry && !isZeroVector(transform.translation))
            {
                const dir = normalizePoint(subtractPoint(entry.center, origin))
                expect(dot(normalizePoint(transform.translation as [number, number, number]), dir))
                    .toBeGreaterThan(0.999)
            }
        })
    })

    test('rowOrtho() lays every shape out along +X with the asked-for spacing', () =>
    {
        const spacing = 1.75
        const { scene, entries } = createSceneFixture()
        const transforms = new Layouter(scene).rowOrtho({ spacing }).result().transforms

        expect(transforms).toHaveLength(entries.length)

        let expectedX = 0
        entries.forEach(entry =>
        {
            const transform = transforms.find(item => item.sceneNode.name === entry.name)
            expect(transform).toBeDefined()
            if (!transform) { return }

            expect(isIdentityScale(transform.scale)).toBe(true)

            const obbox = entry.shape.obbox()
            const width = obbox.width()

            // The transform moves the obbox centre to the row position; only x is pinned here,
            // because the rotation that squares the shape up is asserted in layouter.test.ts.
            const finalX = obbox.center().x + transform.translation[0]
            expect(finalX).toBeCloseTo(expectedX + width / 2, 4)

            expectedX += width + spacing
        })
    })

    test('translations are model-space Z-up, passed through unconverted', async () =>
    {
        const { scene, entries } = createSceneFixture()
        const layout = new Layouter(scene).exploded({ distance: 2.5 })
        const transforms = layout.result().transforms
        const { animation } = await bake(scene, layout, { duration: 1, interpolation: 'linear' })

        const byNode = new Map(channelsFor(animation, 'translation')
            .map((c: any) => [c.getTargetNode().getName(), c]))

        transforms.filter(t => !isZeroVector(t.translation)).forEach(t =>
        {
            const channel = byNode.get(t.sceneNode.name)
            expect(channel).toBeDefined()
            const output = outputOf(channel)
            // last keyframe = the layouter's own translation, component for component
            expectPointClose([output[3], output[4], output[5]], t.translation, 1e-4)
        })

        expect(entries.length).toBeGreaterThan(0)
    })
})

describe('GLTFBuilder.addAnimations', () =>
{
    test('writes one named animation with translation channels', async () =>
    {
        const duration = 1.25
        const { scene } = createSceneFixture()
        const layout = new Layouter(scene).exploded({ distance: 2.5 })
        const moved = layout.result().transforms.filter(t => !isZeroVector(t.translation)).length

        const { animation } = await bake(scene, layout, { duration, interpolation: 'linear' })

        expect(animation).toBeDefined()
        expect(animation.getName()).toBe('exploded')
        expect(channelsFor(animation, 'translation')).toHaveLength(moved)

        channelsFor(animation, 'translation').forEach((channel: any) =>
        {
            // Easing is baked into the samples, so the glTF interpolation is always LINEAR
            expect(channel.getSampler().getInterpolation()).toBe('LINEAR')
            expect(inputOf(channel)).toEqual([0, duration])
        })
    })

    test('animationName overrides the layout name', async () =>
    {
        const { scene } = createSceneFixture()
        const layout = new Layouter(scene).exploded({ distance: 2.5 })
        const { doc, animation } = await bake(scene, layout, { animationName: 'my-anim' })

        expect(animation).toBeDefined()
        expect(doc.getRoot().listAnimations().map((a: any) => a.getName())).toContain('my-anim')
    })

    test('several layouts land in the GLB as several animations', async () =>
    {
        const { scene } = createSceneFixture()
        const exploded = new Layouter(scene).exploded({ distance: 2.5 }).result()
        const row = new Layouter(scene).rowOrtho({ spacing: 1.5 }).result()

        const glb = await new GLTFBuilder(await scene.toGLB())
            .addAnimations([
                { result: exploded, options: { animationName: 'exploded' } },
                { result: row, options: { animationName: 'layout' } },
            ])
            .then(b => b.toGLB())

        const doc = await meshup.createNodeIO().readBinary(glb)
        expect(doc.getRoot().listAnimations().map((a: any) => a.getName()).sort())
            .toEqual(['exploded', 'layout'])
    })

    test('rowOrtho also writes rotation channels', async () =>
    {
        const { scene } = createSceneFixture()
        const layout = new Layouter(scene).rowOrtho({ spacing: 1.75 })
        const rotated = layout.result().transforms.filter(t => !isIdentityQuaternion(t.rotation)).length

        const { animation } = await bake(scene, layout, { duration: 2, interpolation: 'linear' })

        expect(rotated).toBeGreaterThan(0)
        expect(channelsFor(animation, 'rotation')).toHaveLength(rotated)
    })

    describe('keyframe sampling follows the interpolation', () =>
    {
        /*  Easing is baked into the SAMPLES rather than expressed as a glTF CUBICSPLINE, so
            the sample count is the observable difference between the modes. Asserted against
            the exported constants: a literal here is what made modeler.animations.test.ts
            fail when the count went from 2 to 17. */
        const cases: Array<[string, number]> = [
            ['linear', 2],
            ['easeIn', EASED_KEYFRAME_SAMPLE_COUNT],
            ['easeOut', EASED_KEYFRAME_SAMPLE_COUNT],
            ['easeInOut', EASED_KEYFRAME_SAMPLE_COUNT],
            ['spring', SPRING_KEYFRAME_SAMPLE_COUNT],
        ]

        cases.forEach(([interpolation, samples]) =>
        {
            test(`${interpolation} → ${samples} keyframes`, async () =>
            {
                const { scene } = createSceneFixture()
                const layout = new Layouter(scene).exploded({ distance: 2.5 })
                const { animation } = await bake(scene, layout, { duration: 1, interpolation })

                const channel = channelsFor(animation, 'translation')[0]
                expect(inputOf(channel)).toHaveLength(samples)
                expect(outputOf(channel)).toHaveLength(samples * 3)   // VEC3
            })
        })

        test('`tween` is still accepted as an alias for `interpolation`', async () =>
        {
            const { scene } = createSceneFixture()
            const layout = new Layouter(scene).exploded({ distance: 2.5 })
            const { animation } = await bake(scene, layout, { duration: 1, tween: 'easeOut' })

            const channel = channelsFor(animation, 'translation')[0]
            expect(inputOf(channel)).toHaveLength(EASED_KEYFRAME_SAMPLE_COUNT)
        })

        test('the default easing is not linear', async () =>
        {
            const { scene } = createSceneFixture()
            const layout = new Layouter(scene).exploded({ distance: 2.5 })
            const { animation } = await bake(scene, layout, { duration: 1 })

            const channel = channelsFor(animation, 'translation')[0]
            expect(inputOf(channel)).toHaveLength(EASED_KEYFRAME_SAMPLE_COUNT)
        })
    })

    test('siblings sharing a name each get their own channels', async () =>
    {
        /*  The regression this method existed to have. Targets were resolved with
            `new Map(nodes.map(n => [n.getName(), n]))`, and SceneNode.name is not unique among
            siblings — so four legs called `leg` collapsed onto the LAST glTF node of that
            name: three of them never moved and one accumulated all four sets of keyframes.
            An assembly of repeated parts is the normal case, not a corner one. */
        const scene = meshup.SceneNode.root('root')
        // close enough together that the explode has to separate all four of them
        const legs = [0, 1, 2, 3].map(i =>
            meshup.Mesh.Box(1, 1, 4).moveToX(i % 2 ? 0.6 : -0.6).moveToY(i < 2 ? 0.6 : -0.6))
        legs.forEach(leg => scene.addChild(meshup.SceneNode.from(leg, 'leg')))

        const layout = new Layouter(scene).exploded({ distance: 3 })
        const { animation } = await bake(scene, layout, { duration: 1, interpolation: 'linear' })

        const channels = channelsFor(animation, 'translation')
        const targets = new Set(channels.map((c: any) => c.getTargetNode()))

        // one channel per moved leg, and every channel on a DIFFERENT node
        expect(channels.length).toBeGreaterThan(1)
        expect(targets.size).toBe(channels.length)

        // and they really do go different ways — a single collapsed node could not
        const ends = channels.map((c: any) =>
        {
            const o = outputOf(c)
            return [o[3], o[4], o[5]] as [number, number, number]
        })
        const unique = new Set(ends.map(e => e.map(n => n.toFixed(3)).join(',')))
        expect(unique.size).toBe(ends.length)
    })
})

/*  addData() without animations writes the extras straight into the source GLB's JSON chunk
    instead of reading the GLB into a Document and writing it out again. */
describe('GLTFBuilder.addData', () =>
{
    test('only data: merged into the root extras, the model itself untouched', async () =>
    {
        const { scene } = createSceneFixture()
        const source = await scene.toGLB()
        const builder = await new GLTFBuilder(source).addData({ state: { a: 1 } })
        const glb = await builder.addData({ annotations: [1, 2] }).then(b => b.toGLB())

        expect(glb.byteLength % 4).toBe(0)
        const [doc, sourceDoc] = await Promise.all([glb, source].map(g => meshup.createNodeIO().readBinary(g)))
        expect(doc.getRoot().getExtras()).toEqual({ state: { a: 1 }, annotations: [1, 2] })
        expect(doc.getRoot().listNodes().map(n => n.getName())).toEqual(sourceDoc.getRoot().listNodes().map(n => n.getName()))
        expect(doc.getRoot().listAccessors().map(a => Array.from(a.getArray()!)))
            .toEqual(sourceDoc.getRoot().listAccessors().map(a => Array.from(a.getArray()!)))
    })

    test('data added before an animation survives it', async () =>
    {
        const { scene } = createSceneFixture()
        const layout = new Layouter(scene).exploded({ distance: 2.5 })
        const builder = await new GLTFBuilder(await scene.toGLB()).addData({ state: { a: 1 } })
        const glb = await builder.addAnimations([{ result: layout.result(), options: {} }]).then(b => b.toGLB())

        const doc = await meshup.createNodeIO().readBinary(glb)
        expect(doc.getRoot().getExtras()).toEqual({ state: { a: 1 } })
        expect(doc.getRoot().listAnimations().map(a => a.getName())).toEqual(['exploded'])
    })
})

function createSceneFixture(): { scene: meshup.SceneNode<any>; entries: SceneEntry[] }
{
    const scene = meshup.SceneNode.root('root')

    const entries: SceneEntry[] = [
        {
            name: 'box-thin',
            shape: meshup.Mesh.Box(2, 4, 6).moveToX(-0.6).moveToZ(0.75),
        },
        {
            name: 'box-flat',
            shape: meshup.Mesh.Box(5, 2, 1).moveToX(0.2).moveToY(0.15),
        },
        {
            name: 'rect-2d',
            shape: meshup.Curve.Rect(6, 2).moveToX(0.95).moveToY(-0.25),
        },
        {
            name: 'circle-2d',
            shape: meshup.Curve.Circle(1.5).moveToX(1.45).moveToY(0.35),
        },
    ]

    entries.forEach(entry =>
    {
        scene.addChild(meshup.SceneNode.from(entry.shape, entry.name))
    })

    return { scene, entries }
}

function zUpToYUp(v: { x: number; y: number; z: number }): [number, number, number]
{
    return [v.x, v.z, -v.y]
}

function pointFromShape(v: { x: number; y: number; z: number }): [number, number, number]
{
    return [v.x, v.y, v.z]
}

function averagePoint(points: Array<[number, number, number]>): [number, number, number]
{
    return [
        points.reduce((sum, point) => sum + point[0], 0) / points.length,
        points.reduce((sum, point) => sum + point[1], 0) / points.length,
        points.reduce((sum, point) => sum + point[2], 0) / points.length,
    ]
}

function addPoint(left: [number, number, number], right: [number, number, number]): [number, number, number]
{
    return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function isZeroVector(value: [number, number, number]): boolean
{
    return value.every(component => Math.abs(component) < 1e-9)
}

function isIdentityScale(value: [number, number, number]): boolean
{
    return value.every(component => Math.abs(component - 1) < 1e-9)
}

function isIdentityQuaternion(value: [number, number, number, number]): boolean
{
    return Math.abs(value[0]) < 1e-9 &&
        Math.abs(value[1]) < 1e-9 &&
        Math.abs(value[2]) < 1e-9 &&
        Math.abs(value[3] - 1) < 1e-9
}

function subtractPoint(left: [number, number, number], right: [number, number, number]): [number, number, number]
{
    return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scalePoint(point: [number, number, number], factor: number): [number, number, number]
{
    return [point[0] * factor, point[1] * factor, point[2] * factor]
}

function lengthOf(point: [number, number, number]): number
{
    return Math.sqrt(dot(point, point))
}

function normalizePoint(point: [number, number, number]): [number, number, number]
{
    const len = lengthOf(point)
    return len < EPSILON ? [0, 0, 0] : scalePoint(point, 1 / len)
}

function dot(left: [number, number, number], right: [number, number, number]): number
{
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function expectPointClose(actual: Array<number>, expected: Array<number>, tolerance = EPSILON)
{
    expect(actual).toHaveLength(expected.length)

    actual.forEach((value, index) =>
    {
        expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(tolerance)
    })
}