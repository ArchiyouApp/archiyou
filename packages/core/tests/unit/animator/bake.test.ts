/**
 *  The one keyframe baker every Archiyou animation goes through (GLTFBuilder.addAnimationData):
 *  poses about a part's own centre, visibility, colour and opacity, a camera.
 */

import { beforeAll, describe, expect, test } from 'vitest'
import * as meshup from '@archiyou/meshup'

import { GLTFBuilder, createNodeIO, EASED_KEYFRAME_SAMPLE_COUNT } from '../../../src/GLTFBuilder'
import { Layouter } from '../../../src/modeler/Layouter'
import { KHR_ANIMATION_POINTER } from '../../../src/animator/AnimationPointerExtension'
import { rotatePoint } from '../../../src/animator/sampling'
import type { AnimationData, Quat, Vec3 } from '../../../src/animator/types'

beforeAll(async () =>
{
    await meshup.init()
})

/** Two boxes away from the origin, one of them on its side so a row layout turns it. */
function sceneFixture()
{
    const scene = meshup.SceneNode.root<meshup.SceneNode>('root')
    scene.addChild(meshup.SceneNode.from(meshup.Mesh.Box(20, 40, 60).move(100, 50, 30), 'standing'))
    scene.addChild(meshup.SceneNode.from(meshup.Mesh.Box(30, 30, 10).move(-80, 20, 5), 'flat'))
    return scene
}

async function bakeAndRead(scene: meshup.SceneNode<any>, data: AnimationData | Array<AnimationData>)
{
    const glb = await new GLTFBuilder(await scene.toGLB()).addAnimationData(data).then(b => b.toGLB())
    const doc = await createNodeIO().readBinary(glb)
    return { glb, doc }
}

const nodeNamed = (doc: any, name: string) => doc.getRoot().listNodes().find((n: any) => n.getName() === name)
const channelsOf = (doc: any, animation: string) =>
    doc.getRoot().listAnimations().find((a: any) => a.getName() === animation)?.listChannels() ?? []
const outputOf = (channel: any) => Array.from(channel.getSampler().getOutput().getArray() as Float32Array)
const inputOf = (channel: any) => Array.from(channel.getSampler().getInput().getArray() as Float32Array)
const vec3At = (values: Array<number>, i: number): Vec3 => [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]]
const quatAt = (values: Array<number>, i: number): Quat => [values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]]

/** Where a part's centre is in the world, given its container's translation and rotation and
 *  its geometry child's local translation (the centre as modelled). */
function worldCentre(translation: Vec3, rotation: Quat, local: Vec3): Vec3
{
    const r = rotatePoint(rotation, local)
    return [translation[0] + r[0], translation[1] + r[1], translation[2] + r[2]]
}

describe('layouts turn a part about its own centre', () =>
{
    test('a turned part ends with its centre where the layout puts it, not swung round the origin', async () =>
    {
        const scene = sceneFixture()
        const layout = new Layouter(scene).rowOrtho({ spacing: 10 })
        const placements = layout.placements()
        const standing = placements.find(p => p.path.endsWith('standing'))!

        const glb = await new GLTFBuilder(await scene.toGLB())
            .addAnimations([{ result: layout.result(), options: { duration: 1, interpolation: 'linear' } }])
            .then(b => b.toGLB())
        const doc = await createNodeIO().readBinary(glb)

        const channels = channelsOf(doc, 'layout').filter((c: any) => c.getTargetNode()?.getName() === 'standing')
        const translation = channels.find((c: any) => c.getTargetPath() === 'translation')
        const rotation = channels.find((c: any) => c.getTargetPath() === 'rotation')
        expect(rotation).toBeDefined()     // the layout lays it down

        const t = outputOf(translation)
        const r = outputOf(rotation)
        const last = inputOf(translation).length - 1
        const local = nodeNamed(doc, 'standing_shape_0').getTranslation() as Vec3

        const end = worldCentre(vec3At(t, last), quatAt(r, last), local)
        end.forEach((v, i) => expect(v).toBeCloseTo(standing.position[i], 3))
    })

    test('while it turns, its centre travels the straight line it is given', async () =>
    {
        const scene = sceneFixture()
        const layout = new Layouter(scene).rowOrtho({ spacing: 10 })
        const standing = layout.placements().find(p => p.path.endsWith('standing'))!

        const { doc } = await bakeAndRead(scene, {
            name: 'turn', duration: 2, loop: 'none',
            tracks: [{
                path: standing.path, centre: standing.centre,
                pose: [{ t: 0, easing: 'linear' },
                    { t: 2, position: standing.position, rotation: standing.rotation, easing: 'linear' }],
            }],
        })

        const channels = channelsOf(doc, 'turn')
        const translation = channels.find((c: any) => c.getTargetPath() === 'translation')
        const rotation = channels.find((c: any) => c.getTargetPath() === 'rotation')

        // a linear move that turns is sampled densely, so the centre can be followed
        expect(inputOf(translation)).toHaveLength(EASED_KEYFRAME_SAMPLE_COUNT)

        const local = nodeNamed(doc, 'standing_shape_0').getTranslation() as Vec3
        const t = outputOf(translation)
        const r = outputOf(rotation)
        inputOf(translation).forEach((time, i) =>
        {
            const u = time / 2
            const expected = standing.centre.map((c, k) => c + (standing.position[k] - c) * u)
            worldCentre(vec3At(t, i), quatAt(r, i), local).forEach((v, k) => expect(v).toBeCloseTo(expected[k], 2))
        })
    })
})

describe('visibility', () =>
{
    test('is a STEP scale channel on the part\'s geometry, leaving its container free for the pose', async () =>
    {
        const scene = sceneFixture()
        const { doc } = await bakeAndRead(scene, {
            name: 'appear', duration: 3, loop: 'none',
            tracks: [{
                path: 'Scene/standing',
                visible: [{ t: 0, value: false }, { t: 1, value: true }],
                pose: [{ t: 0, position: [100, 50, 130], easing: 'linear' }, { t: 2, easing: 'easeOut' }],
            }],
        })

        const channels = channelsOf(doc, 'appear')
        const scale = channels.find((c: any) => c.getTargetPath() === 'scale')
        expect(scale.getTargetNode().getName()).toBe('standing_shape_0')
        expect(scale.getSampler().getInterpolation()).toBe('STEP')
        expect(inputOf(scale)).toEqual([0, 1, 3])
        expect(vec3At(outputOf(scale), 0)[0]).toBeCloseTo(1e-4, 8)
        expect(vec3At(outputOf(scale), 1)).toEqual([1, 1, 1])

        const pose = channels.find((c: any) => c.getTargetPath() === 'translation')
        expect(pose.getTargetNode().getName()).toBe('standing')
    })

    test('a layer hidden with one of its parts hidden too is one channel per mesh, visible while both say so', async () =>
    {
        const scene = meshup.SceneNode.root<meshup.SceneNode>('root')
        const frame = new meshup.SceneNode('frame')
        scene.addChild(frame)
        frame.addChild(meshup.SceneNode.from(meshup.Mesh.Box(10, 10, 10), 'post'))
        frame.addChild(meshup.SceneNode.from(meshup.Mesh.Box(10, 10, 10).move(30, 0, 0), 'beam'))

        const { doc } = await bakeAndRead(scene, {
            name: 'layers', duration: 4, loop: 'none',
            tracks: [
                { path: 'Scene/frame', visible: [{ t: 0, value: false }, { t: 1, value: true }] },
                { path: 'Scene/frame/post', visible: [{ t: 0, value: true }, { t: 2, value: false }, { t: 3, value: true }] },
            ],
        })

        const scales = channelsOf(doc, 'layers').filter((c: any) => c.getTargetPath() === 'scale')
        expect(scales).toHaveLength(2)
        const post = scales.find((c: any) => c.getTargetNode().getName() === 'post_shape_0')
        expect(inputOf(post)).toEqual([0, 1, 2, 3, 4])
        expect([0, 1, 2, 3].map(i => vec3At(outputOf(post), i)[0] > 0.5)).toEqual([false, true, false, true])
    })
})

describe('colour and opacity', () =>
{
    test('are KHR_animation_pointer channels on the part\'s own materials', async () =>
    {
        const scene = sceneFixture()
        const { doc, glb } = await bakeAndRead(scene, {
            name: 'fade', duration: 2, loop: 'none',
            tracks: [{
                path: 'Scene/standing',
                opacity: [{ t: 0, value: 0, easing: 'linear' }, { t: 1, value: 1, easing: 'easeInOut' }],
                color: [{ t: 0, value: '#ff8000', easing: 'linear' }, { t: 2, value: null, easing: 'linear' }],
            }],
        })

        const pointers = channelsOf(doc, 'fade').filter((c: any) => c.getExtension(KHR_ANIMATION_POINTER))
        expect(pointers.length).toBeGreaterThan(0)
        pointers.forEach((c: any) =>
        {
            expect(c.getTargetNode()).toBeNull()
            expect(c.getTargetPath()).toBe('pointer')
        })

        // the JSON as other tools see it
        const json = await createNodeIO().writeJSON(await createNodeIO().readBinary(glb))
        const gltf = json.json as any
        expect(gltf.extensionsUsed).toContain(KHR_ANIMATION_POINTER)
        expect(gltf.extensionsRequired ?? []).not.toContain(KHR_ANIMATION_POINTER)

        const channel = gltf.animations[0].channels.find((c: any) => c.target.path === 'pointer')
        expect(channel.target.node).toBeUndefined()
        const pointer = channel.target.extensions[KHR_ANIMATION_POINTER].pointer as string
        expect(pointer).toMatch(/^\/materials\/\d+\/pbrMetallicRoughness\/baseColorFactor$/)

        // that material is the standing box's, and it blends while it is translucent
        const index = parseInt(pointer.split('/')[2], 10)
        const standing = doc.getRoot().listNodes().find((n: any) => n.getName() === 'standing_shape_0')
        const material = standing.getMesh().listPrimitives()[0].getMaterial()
        expect(doc.getRoot().listMaterials().indexOf(material)).toBe(index)
        expect(material.getAlphaMode()).toBe('BLEND')

        // starts invisible and orange (linear), ends as the model has it
        const values = outputOf(pointers.find((c: any) => c.getExtension(KHR_ANIMATION_POINTER).material === material))
        expect(values[3]).toBeCloseTo(0, 5)
        expect(values[0]).toBeCloseTo(1, 5)
        expect(values[1]).toBeCloseTo(Math.pow((128 / 255 + 0.055) / 1.055, 2.4), 3)
        const own = material.getBaseColorFactor()
        values.slice(-4).forEach((v: number, i: number) => expect(v).toBeCloseTo(own[i], 5))
    })

    test('a material another part shares is cloned first, so only this part changes', async () =>
    {
        const scene = sceneFixture()
        const source = await scene.toGLB()

        // make both boxes share one material, as a GLB from elsewhere may
        const shared = await createNodeIO().readBinary(source)
        const prims = shared.getRoot().listMeshes().flatMap((m: any) => m.listPrimitives()).filter((p: any) => p.getMode() === 4)
        prims.forEach((p: any) => p.setMaterial(prims[0].getMaterial()))
        const sharedGlb = await createNodeIO().writeBinary(shared)

        const glb = await new GLTFBuilder(sharedGlb).addAnimationData({
            name: 'highlight', duration: 1, loop: 'none',
            tracks: [{ path: 'Scene/standing', color: [{ t: 0, value: null, easing: 'linear' }, { t: 1, value: '#2060c0', easing: 'linear' }] }],
        }).then(b => b.toGLB())

        const doc = await createNodeIO().readBinary(glb)
        const materialOf = (name: string) => doc.getRoot().listNodes()
            .find((n: any) => n.getName() === name).getMesh().listPrimitives().find((p: any) => p.getMode() === 4).getMaterial()
        expect(materialOf('standing_shape_0')).not.toBe(materialOf('flat_shape_0'))

        const animated = channelsOf(doc, 'highlight').map((c: any) => c.getExtension(KHR_ANIMATION_POINTER).material)
        expect(animated).toContain(materialOf('standing_shape_0'))
        expect(animated).not.toContain(materialOf('flat_shape_0'))
    })
})

describe('the clip', () =>
{
    test('an animated camera node', async () =>
    {
        const { doc } = await bakeAndRead(sceneFixture(), {
            name: 'orbit', duration: 4, loop: 'loop', tracks: [],
            camera: {
                kind: 'keys', projection: 'orthographic', radius: 100,
                keys: [
                    { t: 0, position: [300, 0, 100], lookAt: [0, 0, 0], easing: 'linear' },
                    { t: 4, position: [0, 300, 100], lookAt: [0, 0, 0], easing: 'linear' },
                ],
            },
        })

        const camera = nodeNamed(doc, 'orbit-camera')
        expect(camera.getCamera().getType()).toBe('orthographic')
        const paths = channelsOf(doc, 'orbit').filter((c: any) => c.getTargetNode() === camera).map((c: any) => c.getTargetPath())
        expect(paths.sort()).toEqual(['rotation', 'translation'])
    })

    test('holds a part that does not change at no more than its keys', async () =>
    {
        const { doc } = await bakeAndRead(sceneFixture(), {
            name: 'hold', duration: 5, loop: 'none',
            tracks: [{
                path: 'Scene/flat',
                pose: [{ t: 0, position: [-80, 20, 105], easing: 'linear' }, { t: 3, position: [-80, 20, 105], easing: 'easeOut' }],
            }],
        })
        const [translation] = channelsOf(doc, 'hold')
        expect(inputOf(translation)).toEqual([0, 3, 5])
    })

    test('writes no clip when nothing in it changes anything, and its data into extras when it does', async () =>
    {
        const scene = sceneFixture()
        const { doc } = await bakeAndRead(scene, [
            { name: 'nothing', duration: 1, loop: 'none', tracks: [{ path: 'Scene/flat', pose: [{ t: 0, easing: 'linear' }, { t: 1, easing: 'linear' }] }] },
            { name: 'missing', duration: 1, loop: 'none', tracks: [{ path: 'Scene/nope', visible: [{ t: 0, value: false }] }] },
            { name: 'real', duration: 1, loop: 'pingpong', tracks: [{ path: 'Scene/flat', visible: [{ t: 0, value: false }] }] },
        ])

        expect(doc.getRoot().listAnimations().map((a: any) => a.getName())).toEqual(['real'])
        const extras = doc.getRoot().getExtras() as any
        expect(extras.animations.map((a: any) => [a.name, a.loop])).toEqual([['real', 'pingpong']])
    })

    test('a file without colour or opacity does not list the pointer extension', async () =>
    {
        const { glb } = await bakeAndRead(sceneFixture(), {
            name: 'move', duration: 1, loop: 'none',
            tracks: [{ path: 'Scene/flat', pose: [{ t: 0, easing: 'linear' }, { t: 1, position: [0, 0, 0], easing: 'linear' }] }],
        })
        const json = (await createNodeIO().writeJSON(await createNodeIO().readBinary(glb))).json as any
        expect(json.extensionsUsed ?? []).not.toContain(KHR_ANIMATION_POINTER)
    })
})
