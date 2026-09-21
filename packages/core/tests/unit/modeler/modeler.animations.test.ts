import { beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { createNodeIO } from '@archiyou/meshup'
import { ShapeCollection } from '@archiyou/meshup'
import { Layouter } from '../../../src/modeler/Layouter'
import { EASED_KEYFRAME_SAMPLE_COUNT } from '../../../src/GLTFBuilder'
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
        /*  The GLB carries the kernel's native Z-up coordinates, and the layouter's transforms
            are already in that same space — so the quaternion arrives in the animation exactly
            as the obbox gave it. This used to be wrapped in a -90 degrees X axis conversion,
            left over from when the export flipped to Y-up; see
            GLTFBuilder._worldToGltfQuaternion(), which is now the identity. */
        const obboxQuaternion = box.obbox().toOrthoQuaternion()
        const expectedQuaternion: [number, number, number, number] = [
            obboxQuaternion.x,
            obboxQuaternion.y,
            obboxQuaternion.z,
            obboxQuaternion.w,
        ]

        const gltf = JSON.parse(await modeler.toGLTF({ animations: true }))
        const layoutAnimation = (gltf.animations ?? []).find((animation: any) => animation.name === 'layout')
        const rotationChannel = layoutAnimation.channels.find((channel: any) => channel.target.path === 'rotation')
        const rotationSampler = layoutAnimation.samplers[rotationChannel.sampler]
        const rotationValues = decodeAccessorFloat32(gltf, rotationSampler.output)

        /*  The LAST keyframe, wherever it is. This used to read indices 4..7 and assert a
            length of 8, i.e. two keyframes — true only while the default easing was linear.
            Easing is baked into the samples rather than expressed as a glTF CUBICSPLINE, so
            the default now writes EASED_KEYFRAME_SAMPLE_COUNT of them and the literal went
            stale. Derived from the constant so tuning the easing cannot re-break this. */
        const end = rotationValues.length - 4
        const finalQuaternion: [number, number, number, number] = [
            rotationValues[end],
            rotationValues[end + 1],
            rotationValues[end + 2],
            rotationValues[end + 3],
        ]

        expect(layoutAnimation).toBeDefined()
        expect(rotationChannel).toBeDefined()
        expect(rotationValues).toHaveLength(EASED_KEYFRAME_SAMPLE_COUNT * 4)   // VEC4 per sample
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