import { beforeAll, describe, expect, test, vi } from 'vitest'

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

    //// PART STACK ////

    /** A workbench: 4 legs, 2 rails, a top — three parts in three quantities. */
    const buildWorkbench = () =>
    {
        modeler.reset()

        modeler.group('legs',
            ...[0, 1, 2, 3].map(i => modeler.box(44, 44, 700)
                .moveToX(i % 2 ? 1100 : 0).moveToY(i < 2 ? 500 : 0).name('leg')))
        modeler.group('frame',
            ...[0, 1].map(i => modeler.box(1180, 44, 60).moveToY(i * 500).moveToZ(600).name('rail')))
        modeler.group('top', modeler.box(1200, 600, 18).moveToZ(730).name('top panel'))
    }

    /** Every laid-out shape, by its bbox after the layout has been applied. */
    const stackedBoxes = () => modeler.all().toArray()
        .map((shape: any) => shape.bbox())
        .sort((a: any, b: any) => (a.center().x - b.center().x) || (a.center().z - b.center().z))

    test('partStack stacks the pieces of a part and rows the stacks up, most used first', () =>
    {
        buildWorkbench()

        const transforms = new Layouter(modeler.scene()).partStack().result().transforms
        expect(transforms).toHaveLength(7)          // one per piece, not one per part

        new Layouter(modeler.scene()).partStack().apply()

        const boxes = stackedBoxes()

        /*  Four legs in one stack, then two rails, then the top: the most-used part leads, and
            every piece of a part shares its stack's footprint. */
        const columns = boxes.reduce((groups: Array<Array<any>>, box: any) =>
        {
            const column = groups.find(g => Math.abs(g[0].center().x - box.center().x) < 1e-6)
            if (column) { column.push(box) } else { groups.push([box]) }
            return groups
        }, [])

        expect(columns.map((c: Array<any>) => c.length)).toEqual([4, 2, 1])
    })

    test('partStack lays every piece flat, thinnest side up', () =>
    {
        buildWorkbench()
        new Layouter(modeler.scene()).partStack().apply()

        // a 44x44x700 leg and a 1200x600x18 top both end up as thick as their thinnest side
        const heights = stackedBoxes().map((b: any) => +(b.max().z - b.min().z).toFixed(6))
        expect(heights.slice(0, 4)).toEqual([44, 44, 44, 44])
        expect(heights[heights.length - 1]).toBe(18)
    })

    test('partStack piles a stack up from the ground, one thickness at a time', () =>
    {
        buildWorkbench()
        new Layouter(modeler.scene()).partStack().apply()

        const legs = stackedBoxes().slice(0, 4)
        ;[0, 44, 88, 132].forEach((z, i) => expect(legs[i].min().z).toBeCloseTo(z, 6))
        expect(new Set(legs.map((b: any) => +b.center().x.toFixed(6))).size).toBe(1)
        expect(new Set(legs.map((b: any) => +b.center().y.toFixed(6))).size).toBe(1)
    })

    test('partStack leaves a gap between stacks, and none inside one unless asked', () =>
    {
        buildWorkbench()
        new Layouter(modeler.scene()).partStack({ spacing: 100, gap: 10 }).apply()

        const boxes = stackedBoxes()

        // inside the leg stack: 44 of board, then 10 of air
        ;[0, 54, 108, 162].forEach((z, i) => expect(boxes[i].min().z).toBeCloseTo(z, 6))

        // between the leg stack and the rail stack: 100
        const legsEnd = Math.max(...boxes.slice(0, 4).map((b: any) => b.max().x))
        const railsStart = Math.min(...boxes.slice(4, 6).map((b: any) => b.min().x))
        expect(railsStart - legsEnd).toBeCloseTo(100, 6)
    })

    test('partStack does not touch the scene until it is applied', () =>
    {
        buildWorkbench()
        const before = modeler.all().toArray().map((s: any) => s.center().toArray())

        new Layouter(modeler.scene()).partStack().result()

        expect(modeler.all().toArray().map((s: any) => s.center().toArray())).toEqual(before)
    })

    test('partStack says so when it is handed something that is not a part', () =>
    {
        buildWorkbench()
        modeler.line([0, 0, 0], [100, 0, 0])

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const transforms = new Layouter(modeler.scene()).partStack().result().transforms
        const messages = warn.mock.calls.flat().join(' ')
        warn.mockRestore()

        expect(transforms).toHaveLength(7)          // the line is not one of them
        expect(messages).toContain('not a part')
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