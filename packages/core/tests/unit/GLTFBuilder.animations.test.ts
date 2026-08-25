import { beforeAll, describe, expect, test } from 'vitest'

import { GLTFBuilder } from '../../src/GLTFBuilder'
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

describe('GLTFBuilder animations', () =>
{
    test('getExplodedViewTransformsWorld returns world-space translations and identity rotations', () =>
    {
        const distance = 2.5
        const { scene, entries } = createSceneFixture()
        const transforms = new GLTFBuilder().getExplodedViewTransformsWorld(scene, { distance })

        expect(transforms).toHaveLength(entries.length)

        const transformByName = new Map(transforms.map(transform => [transform.name, transform]))
        const centers = entries.map(entry => ({
            name: entry.name,
            center: pointFromShape(entry.shape.center()),
        }))
        const centroid = averagePoint(centers.map(entry => entry.center))

        transforms.forEach(transform =>
        {
            expect(transform.rotation).toEqual([0, 0, 0, 1])
            expect(transform.scale).toEqual([1, 1, 1])

            const entry = centers.find(item => item.name === transform.name)
            expect(entry).toBeDefined()

            if (entry && lengthOf(transform.translation) > EPSILON)
            {
                const dir = normalizePoint(subtractPoint(entry.center, centroid))
                expect(dot(normalizePoint(transform.translation), dir)).toBeGreaterThan(0.999)
            }
        })

        const sortedFinalCenters = centers
            .map(entry => ({
                ...entry,
                finalCenter: addPoint(entry.center, transformByName.get(entry.name)?.translation ?? [0, 0, 0]),
                dist: lengthOf(subtractPoint(entry.center, centroid)),
            }))
            .sort((left, right) => left.dist - right.dist)

        for (let index = 1; index < sortedFinalCenters.length; index++)
        {
            const separation = lengthOf(subtractPoint(sortedFinalCenters[index].finalCenter, sortedFinalCenters[index - 1].finalCenter))
            expect(separation).toBeGreaterThanOrEqual(distance - EPSILON)
        }
    })

    test('getLayoutViewTransformsWorld returns world-space transforms that flatten shapes onto the XY plane', () =>
    {
        const spacing = 1.75
        const { scene, entries } = createSceneFixture()
        const transforms = new GLTFBuilder().getLayoutViewTransformsWorld(scene, { spacing })

        expect(transforms).toHaveLength(entries.length)

        let expectedX = 0

        entries.forEach(entry =>
        {
            const transform = transforms.find(item => item.name === entry.name)
            expect(transform).toBeDefined()

            const obbox = entry.shape.obbox()
            const halfExtents = obbox.halfExtents()
            const flatAxis = pointFromShape(obbox.axes()[2])
            const worldCenter = pointFromShape(entry.shape.center())

            if (!transform) { return }

            expect(transform.scale).toEqual([1, 1, 1])

            const rotatedFlatAxis = meshup.Vector
                .from(flatAxis)
                .rotateQuaternion({
                    w: transform.rotation[3],
                    x: transform.rotation[0],
                    y: transform.rotation[1],
                    z: transform.rotation[2],
                })
                .normalize()
                .toArray()

            expectPointClose(rotatedFlatAxis, [0, 0, 1], 1e-4)

            const rotatedCenter = meshup.Vector
                .from(worldCenter)
                .rotateQuaternion({
                    w: transform.rotation[3],
                    x: transform.rotation[0],
                    y: transform.rotation[1],
                    z: transform.rotation[2],
                })
                .toArray() as [number, number, number]

            const finalCenter = addPoint(rotatedCenter, transform.translation)
            const halfThickness = halfExtents[2]
            const footprint = halfExtents[0] * 2

            expect(finalCenter[0]).toBeCloseTo(expectedX, 5)
            expect(finalCenter[1]).toBeCloseTo(0, 5)
            expect(finalCenter[2]).toBeCloseTo(halfThickness, 5)

            expectedX += footprint + spacing
        })
    })

    test('addExplodedView creates translation channels with separated final centers for simple shapes', async () =>
    {
        const distance = 2.5
        const duration = 1.25
        const { scene, entries } = createSceneFixture()
        const baseGlb = await scene.toGLB()

        const glb = await new GLTFBuilder().addExplodedView(baseGlb, scene, { distance, duration })
        const doc = await meshup.createNodeIO().readBinary(glb)
        const animation = doc.getRoot().listAnimations().find((item: any) => item.getName() === 'ExplodedView') as any

        expect(animation).toBeDefined()
        expect(animation.listChannels()).toHaveLength(entries.length)

        const channelsByNode = new Map<string, any>()
        animation.listChannels().forEach((channel: any) =>
        {
            channelsByNode.set(channel.getTargetNode()?.getName(), channel)
            expect(channel.getTargetPath()).toBe('translation')

            const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)
            expect(input).toEqual([0, duration])
        })

        const centers = entries.map(entry => ({
            name: entry.name,
            center: zUpToYUp(entry.shape.center()),
        }))

        const centroid = averagePoint(centers.map(entry => entry.center))
        const sorted = centers
            .map(entry =>
            {
                const delta = subtractPoint(entry.center, centroid)
                const dist = lengthOf(delta)
                const dir = dist < 1e-6
                    ? [1, 0, 0] as [number, number, number]
                    : scalePoint(delta, 1 / dist)

                return { ...entry, dist, dir }
            })
            .sort((left, right) => left.dist - right.dist)

        const finalCenters: Array<[number, number, number]> = []

        sorted.forEach(entry =>
        {
            const channel = channelsByNode.get(entry.name)
            expect(channel).toBeDefined()

            const output = Array.from(channel.getSampler().getOutput().getArray() as Float32Array)
            const endTranslation: [number, number, number] = [output[3], output[4], output[5]]
            const finalCenter = addPoint(entry.center, endTranslation)
            finalCenters.push(finalCenter)

            if (lengthOf(endTranslation) > EPSILON)
            {
                expect(dot(normalizePoint(endTranslation), entry.dir)).toBeGreaterThan(0.999)
            }
        })

        for (let index = 1; index < finalCenters.length; index++)
        {
            const separation = lengthOf(subtractPoint(finalCenters[index], finalCenters[index - 1]))
            expect(separation).toBeGreaterThanOrEqual(distance - EPSILON)
        }
    })

    test('addLayoutView creates rotation and translation channels that flatten mixed simple shapes onto the XZ plane', async () =>
    {
        const spacing = 1.75
        const duration = 2.0
        const { scene, entries } = createSceneFixture()
        const baseGlb = await scene.toGLB()

        const glb = await new GLTFBuilder().addLayoutView(baseGlb, scene, { spacing, duration })
        const doc = await meshup.createNodeIO().readBinary(glb)
        const animation = doc.getRoot().listAnimations().find((item: any) => item.getName() === 'LayoutView') as any

        expect(animation).toBeDefined()
        expect(animation.listChannels()).toHaveLength(entries.length * 2)

        const channelsByNode = new Map<string, { rotation?: any; translation?: any }>()

        animation.listChannels().forEach((channel: any) =>
        {
            const nodeName = channel.getTargetNode()?.getName()
            const record = channelsByNode.get(nodeName) || {}

            if (channel.getTargetPath() === 'rotation')
            {
                record.rotation = channel
            }
            else if (channel.getTargetPath() === 'translation')
            {
                record.translation = channel
            }

            channelsByNode.set(nodeName, record)

            const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)
            expect(input).toEqual([0, duration])
        })

        let expectedX = 0

        entries.forEach(entry =>
        {
            const channels = channelsByNode.get(entry.name)
            expect(channels?.rotation).toBeDefined()
            expect(channels?.translation).toBeDefined()

            const rotationOutput = Array.from(channels?.rotation.getSampler().getOutput().getArray() as Float32Array)
            const translationOutput = Array.from(channels?.translation.getSampler().getOutput().getArray() as Float32Array)

            const endQuaternion: [number, number, number, number] = [
                rotationOutput[4],
                rotationOutput[5],
                rotationOutput[6],
                rotationOutput[7],
            ]
            const endTranslation: [number, number, number] = [
                translationOutput[3],
                translationOutput[4],
                translationOutput[5],
            ]

            const obbox = entry.shape.obbox()
            const halfExtents = obbox.halfExtents()
            const gltfFlatAxis = zUpToYUp(obbox.axes()[2])
            const rotatedFlatAxis = meshup.Vector
                .from(gltfFlatAxis)
                .rotateQuaternion({ w: endQuaternion[3], x: endQuaternion[0], y: endQuaternion[1], z: endQuaternion[2] })
                .normalize()
                .toArray()

            expectPointClose(rotatedFlatAxis, [0, 1, 0], 1e-4)

            const gltfCenter = zUpToYUp(entry.shape.center())
            const rotatedCenter = meshup.Vector
                .from(gltfCenter)
                .rotateQuaternion({ w: endQuaternion[3], x: endQuaternion[0], y: endQuaternion[1], z: endQuaternion[2] })
                .toArray() as [number, number, number]

            const finalCenter = addPoint(rotatedCenter, endTranslation)
            const halfThickness = halfExtents[2]
            const footprint = halfExtents[0] * 2

            expect(finalCenter[0]).toBeCloseTo(expectedX, 5)
            expect(finalCenter[1]).toBeCloseTo(halfThickness, 5)
            expect(finalCenter[2]).toBeCloseTo(0, 5)

            expectedX += footprint + spacing
        })
    })

    test('addCachedLayoutAnimations writes multiple animations in one pass', async () =>
    {
        const duration = 1.5
        const { scene, entries } = createSceneFixture()
        const baseGlb = await scene.toGLB()

        const exploded = new Layouter(scene.shapes()).exploded({ distance: 2.5 }).result()
        const layout = new Layouter(scene.shapes()).rowOrtho({ spacing: 1.75 }).result()

        const glb = await new GLTFBuilder().addCachedLayoutAnimations(baseGlb, [
            {
                result: exploded,
                options: {
                    duration,
                    interpolation: 'linear',
                    animationName: 'exploded',
                },
            },
            {
                result: layout,
                options: {
                    duration,
                    interpolation: 'linear',
                    animationName: 'layout',
                },
            },
        ])

        const doc = await meshup.createNodeIO().readBinary(glb)
        const animations = doc.getRoot().listAnimations() as Array<any>
        const animationByName = new Map(animations.map(animation => [animation.getName(), animation]))
        const explodedChannelCount = exploded.transforms.reduce((count, transform) =>
        {
            return count +
                (isZeroVector(transform.translation) ? 0 : 1) +
                (isIdentityQuaternion(transform.rotation) ? 0 : 1) +
                (isIdentityScale(transform.scale) ? 0 : 1)
        }, 0)
        const layoutChannelCount = layout.transforms.reduce((count, transform) =>
        {
            return count +
                (isZeroVector(transform.translation) ? 0 : 1) +
                (isIdentityQuaternion(transform.rotation) ? 0 : 1) +
                (isIdentityScale(transform.scale) ? 0 : 1)
        }, 0)

        expect(animationByName.get('exploded')).toBeDefined()
        expect(animationByName.get('layout')).toBeDefined()
        expect(animationByName.get('exploded').listChannels()).toHaveLength(explodedChannelCount)
        expect(animationByName.get('layout').listChannels()).toHaveLength(layoutChannelCount)

        animations.forEach(animation =>
        {
            animation.listChannels().forEach((channel: any) =>
            {
                const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)
                expect(input).toEqual([0, duration])
            })
        })
    })

    test('addCachedLayoutAnimations defaults to eased keyframes when interpolation is omitted', async () =>
    {
        const duration = 2.0
        const { scene } = createSceneFixture()
        const baseGlb = await scene.toGLB()
        const exploded = new Layouter(scene.shapes()).exploded({ distance: 2.5 }).result()

        const glb = await new GLTFBuilder().addCachedLayoutAnimations(baseGlb, [
            {
                result: exploded,
                options: {
                    duration,
                    animationName: 'exploded-eased-default',
                },
            },
        ])

        const doc = await meshup.createNodeIO().readBinary(glb)
        const animation = doc.getRoot().listAnimations().find((item: any) => item.getName() === 'exploded-eased-default') as any
        const channel = animation.listChannels().find((item: any) =>
        {
            if (item.getTargetPath() !== 'translation')
            {
                return false
            }

            const output = Array.from(item.getSampler().getOutput().getArray() as Float32Array)
            const endIndex = output.length - 3
            const end: [number, number, number] = [output[endIndex], output[endIndex + 1], output[endIndex + 2]]
            return lengthOf(end) > EPSILON
        }) as any

        expect(animation).toBeDefined()
        expect(channel).toBeDefined()

        const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)
        const output = Array.from(channel.getSampler().getOutput().getArray() as Float32Array)
        const quarterIndex = Math.floor((input.length - 1) / 4)
        const endIndex = input.length - 1
        const quarterSampleIndex = quarterIndex * 3
        const endSampleIndex = endIndex * 3
        const quarter: [number, number, number] = [
            output[quarterSampleIndex],
            output[quarterSampleIndex + 1],
            output[quarterSampleIndex + 2],
        ]
        const end: [number, number, number] = [
            output[endSampleIndex],
            output[endSampleIndex + 1],
            output[endSampleIndex + 2],
        ]

        expect(input.length).toBeGreaterThan(2)
        expect(input[quarterIndex]).toBeCloseTo(duration * 0.25, 5)
        expect(lengthOf(end)).toBeGreaterThan(EPSILON)
        expect(lengthOf(quarter) / lengthOf(end)).toBeLessThan(0.2)
    })

    test('addCachedLayoutAnimations samples eased keyframes for explicit easeInOut interpolation', async () =>
    {
        const { scene } = createSceneFixture()
        const baseGlb = await scene.toGLB()
        const exploded = new Layouter(scene.shapes()).exploded({ distance: 2.5 }).result()

        const glb = await new GLTFBuilder().addCachedLayoutAnimations(baseGlb, [
            {
                result: exploded,
                options: {
                    duration: 1.0,
                    animationName: 'exploded-eased-explicit',
                    interpolation: 'easeInOut',
                },
            },
        ])

        const doc = await meshup.createNodeIO().readBinary(glb)
        const animation = doc.getRoot().listAnimations().find((item: any) => item.getName() === 'exploded-eased-explicit') as any
        const channel = animation.listChannels().find((item: any) => item.getTargetPath() === 'translation') as any
        const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)

        expect(animation).toBeDefined()
        expect(channel).toBeDefined()
        expect(input.length).toBeGreaterThan(2)
    })

    test('addCachedLayoutAnimations accepts tween as an alias for interpolation', async () =>
    {
        const { scene } = createSceneFixture()
        const baseGlb = await scene.toGLB()
        const exploded = new Layouter(scene.shapes()).exploded({ distance: 2.5 }).result()

        const glb = await new GLTFBuilder().addCachedLayoutAnimations(baseGlb, [
            {
                result: exploded,
                options: {
                    duration: 1.5,
                    animationName: 'exploded-tween',
                    tween: 'easeOut',
                },
            },
        ])

        const doc = await meshup.createNodeIO().readBinary(glb)
        const animation = doc.getRoot().listAnimations().find((item: any) => item.getName() === 'exploded-tween') as any
        const channel = animation.listChannels().find((item: any) => item.getTargetPath() === 'translation') as any
        const input = Array.from(channel.getSampler().getInput().getArray() as Float32Array)

        expect(animation).toBeDefined()
        expect(channel).toBeDefined()
        expect(input.length).toBeGreaterThan(2)
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