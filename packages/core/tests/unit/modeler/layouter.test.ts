import { beforeAll, describe, expect, test } from 'vitest'

import { createNodeIO } from '@archiyou/meshup'

import { Layouter } from '../../../src/modeler/Layouter'
import { Modeler } from '../../../src/modeler/Modeler'
import { SceneNode as SmartSceneNode } from '@archiyou/meshup'

import type { Mesh as SmartMesh } from '@archiyou/meshup'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'

import { save } from '@archiyou/meshup/src/utils'

const TEST_OUTPUTS_PATH = './tests/outputs/layouter/'

describe('Layouter', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
    })

    const buildNestedScene = () =>
    {
        modeler.reset()

        const rootBox = modeler.box(2, 2, 2).move(-2, 0, 1)
        const nestedBox = modeler.box(1, 4, 1).move(3, 0, 0)

        const parent = new SmartSceneNode('nested-parent')
        const child = new SmartSceneNode('nested-child')

        modeler.scene().addChild(parent)
        parent.addChild(child)
        child.add(nestedBox)

        return { rootBox, nestedBox }
    }

    test('throws when applying without a cached layout', () =>
    {
        modeler.reset()
        expect(() => new Layouter(modeler.scene()).apply()).toThrow(/no cached layout/i)
        expect(() => new Layouter(modeler.scene()).applyAsCopy()).toThrow(/no cached layout/i)
    })


    test('applies cached transforms to the bound scene', () =>
    {
        const { rootBox, nestedBox } = buildNestedScene()
        const before = [rootBox.center().x, nestedBox.center().x]

        new Layouter(modeler.scene())
            .exploded({ distance: 10 })
            .apply()

        const after = [rootBox.center().x, nestedBox.center().x]

        // The algorithm keeps the first (closest-to-center) shape anchored;
        // at least one shape must have moved.
        expect(after).not.toEqual(before)
    })

    test('applyAsCopy returns a transformed clone without mutating the original scene', () =>
    {
        const { rootBox, nestedBox } = buildNestedScene()
        const originalXs = [rootBox.center().x, nestedBox.center().x]

        const copiedScene = new Layouter(modeler.scene())
            .exploded({ distance: 10 })
            .applyAsCopy()

        const originalAfter = [rootBox.center().x, nestedBox.center().x]
        const copiedXs = copiedScene.shapes().toArray().map(shape => (shape as SmartMesh).center().x)

        expect(copiedScene).toBeInstanceOf(SmartSceneNode)
        expect(copiedScene).not.toBe(modeler.scene())
        expect(copiedScene.shapes().length).toBe(modeler.scene().shapes().length)
        expect(originalAfter).toEqual(originalXs)
        expect(copiedXs.some((x, index) => x !== originalXs[index])).toBe(true)
    })

    test('serializes the cached layout as a GLTF animation', async () =>
    {
        buildNestedScene()

        const glb = await modeler.scene().toGLB()
        const animated = await new Layouter(modeler.scene())
            .exploded()
            .saveAsAnimation(glb)

        const doc = await createNodeIO().readBinary(animated)
        const animationNames = doc.getRoot().listAnimations().map((animation: any) => animation.getName())

        expect(animationNames).toEqual(['exploded'])
    })

    /** Extended example for visual inspection */
    test('Visual example: Exploded View', async () =>
    {
        const leg = modeler.box(10,10,100).move(0,0,50);
        const legs = (leg as SmartMesh).grid(2,2,1,100); // allow TS error for now

        expect(legs.length).toBe(4);

        const top = modeler.boxBetween(
                        legs.bbox().min().setZ(100), 
                        legs.bbox().max().moveZ(10)) as SmartMesh; // for meshup for now

        const coll = new SmartShapeCollection(legs, top);

        await save(TEST_OUTPUTS_PATH + 'test.layouter.table.gltf', await coll.toGLTF());

        // now layout: exploded view
        const layouter = new Layouter(coll)
                            .exploded()
                            .apply(); // apply to collection in place

        await save(TEST_OUTPUTS_PATH + 'test.layouter.table.exploded.gltf', await coll.toGLTF());

    });

    /** Extended example for visual inspection */
    test('Visual example: Flat Layout', async () =>
    {
        const randomBoxes = (modeler.box() as SmartMesh).replicate(20, () => {
            const w = 5 + Math.random() * 40;
            const d = 5 + Math.random() * 10;
            const h = 20 + Math.random() * 50;
            return modeler.box(w, d, h)
                    .move(Math.random()*100, Math.random()*100, 0)
                    .rotateX(Math.random()*360)
                    .rotateY(Math.random()*360)
                    .rotateZ(Math.random()*360) as SmartMesh
        });

        const coll = new SmartShapeCollection(randomBoxes).color('blue');
        
        await save(TEST_OUTPUTS_PATH + 'test.layouter.randomBoxes.gltf', await coll.toGLTF());

        // now layout: flat ortho
        const colLayout = coll.copy().color('red'); // copy for layout to keep original for comparison
        const layouter = new Layouter(colLayout)
                            .rowOrtho()
                            .apply(); // apply to collection in place

        const all = new SmartShapeCollection(coll,  colLayout);

        await save(TEST_OUTPUTS_PATH + 'test.layouter.flatortho.gltf', await all.toGLTF());

    });
})