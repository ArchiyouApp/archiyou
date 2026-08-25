import { beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { createNodeIO } from '@archiyou/meshup'
import { ShapeCollection } from '@archiyou/meshup'
import { Layouter } from '../../../src/modeler/Layouter'
import { save } from '@archiyou/meshup/src/utils'

describe('Modeler animations', () =>
{
    let modeler: Modeler

    const decodeAccessorFloat32 = (gltf: any, accessorIndex: number): Float32Array =>
    {
        const accessor = gltf.accessors[accessorIndex]
        const bufferView = gltf.bufferViews[accessor.bufferView]
        const bufferUri = gltf.buffers[bufferView.buffer].uri as string
        const base64 = bufferUri.split(',')[1]
        const raw = Buffer.from(base64, 'base64')
        const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
        const byteLength = accessor.count * 4 * (accessor.type === 'VEC4' ? 4 : 1)
        const slice = raw.subarray(byteOffset, byteOffset + byteLength)

        return new Float32Array(slice.buffer, slice.byteOffset, byteLength / 4)
    }

    const multiplyQuaternion = (
        quaternionA: [number, number, number, number],
        quaternionB: [number, number, number, number],
    ): [number, number, number, number] =>
    {
        const [ax, ay, az, aw] = quaternionA
        const [bx, by, bz, bw] = quaternionB

        return [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    }

    const worldToGltfQuaternion = (
        rotation: [number, number, number, number],
    ): [number, number, number, number] =>
    {
        const axisConversion: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
        const axisConversionInverse: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]

        return multiplyQuaternion(
            multiplyQuaternion(axisConversion, rotation),
            axisConversionInverse,
        )
    }

    const normalizeQuaternion = (
        quaternion: [number, number, number, number],
    ): [number, number, number, number] =>
    {
        const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]) || 1
        return quaternion.map(component => component / length) as [number, number, number, number]
    }

    const quaternionDistance = (
        quaternionA: [number, number, number, number],
        quaternionB: [number, number, number, number],
    ): number =>
    {
        const normalizedA = normalizeQuaternion(quaternionA)
        const normalizedB = normalizeQuaternion(quaternionB)
        const dot = Math.abs(
            normalizedA[0] * normalizedB[0]
            + normalizedA[1] * normalizedB[1]
            + normalizedA[2] * normalizedB[2]
            + normalizedA[3] * normalizedB[3],
        )

        return 1 - Math.min(1, dot)
    }

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
    })

    beforeEach(() =>
    {
        modeler.scene().children().forEach(child =>
        {
            modeler.scene().removeChild(child)
        })

        modeler.box(2, 4, 6).move(-0.6, 0, 0.75)
        modeler.box(5, 2, 1).move(0.2, 0.15, 0)
        modeler.rect(6, 2).move(0.95, -0.25, 0)
        modeler.circle(1.5).move(1.45, 0.35, 0)
    })

    test('toGLB includes exploded and layout animations for a simple mesh scene', async () =>
    {
        const glb = await modeler.toGLB({ animations: true })
        const doc = await createNodeIO().readBinary(glb)
        const animationNames = doc.getRoot().listAnimations().map((animation: any) => animation.getName()).sort()

        expect(animationNames).toEqual(['exploded', 'layout'])
    })

    test('toGLTF includes exploded and layout animations for a simple mesh scene', async () =>
    {
        const gltf = await modeler.toGLTF({ animations: true })
        const animationNames = (JSON.parse(gltf).animations ?? [])
            .map((animation: any) => animation.name)
            .sort()

        expect(animationNames).toEqual(['exploded', 'layout'])
    })

    test('layout animation rotation matches the rotated box obbox ortho quaternion', async () =>
    {
        modeler.scene().children().forEach(child =>
        {
            modeler.scene().removeChild(child)
        })

        const box = modeler.box(2, 4, 6).rotateX(45)
        const obboxQuaternion = box.obbox().toOrthoQuaternion()
        const expectedQuaternion = worldToGltfQuaternion([
            obboxQuaternion.x,
            obboxQuaternion.y,
            obboxQuaternion.z,
            obboxQuaternion.w,
        ])

        const gltf = JSON.parse(await modeler.toGLTF({ animations: true }))
        const layoutAnimation = (gltf.animations ?? []).find((animation: any) => animation.name === 'layout')
        const rotationChannel = layoutAnimation.channels.find((channel: any) => channel.target.path === 'rotation')
        const rotationSampler = layoutAnimation.samplers[rotationChannel.sampler]
        const rotationValues = decodeAccessorFloat32(gltf, rotationSampler.output)
        const finalQuaternion: [number, number, number, number] = [
            rotationValues[4],
            rotationValues[5],
            rotationValues[6],
            rotationValues[7],
        ]

        expect(layoutAnimation).toBeDefined()
        expect(rotationChannel).toBeDefined()
        expect(rotationValues).toHaveLength(8)
        expect(quaternionDistance(finalQuaternion, expectedQuaternion)).toBeLessThan(1e-5)
    })

    test('exploded animation with a couple of shapes', async () =>
    {
        const b = modeler.box(10,10,10).color('red');
        const s = modeler.sphere(5).color('blue').move(5,5,5);
        b.subtract(s);
        const c = modeler.circle(15).color('yellow');
        const r = modeler.rect(20,20).color('green');

        const col = new ShapeCollection(b, s, c, r).color('blue');
        const colExp = col.copy().color('red');
        new Layouter(colExp).exploded().apply();
        const all = new ShapeCollection(col, colExp);

        await save('./tests/outputs/modeler/test.modeler.animations.exploded.gltf', await all.toGLTF());

    });

        
})