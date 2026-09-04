/** Shape serial ids (`sid`) through the Modeler.
 *
 *  The Modeler owns the counter and installs it on the scene root as a provider
 *  (reset() -> setSidProvider), the same arrangement it already uses for the active layer.
 *  meshup's SceneNode.setShape() pulls one number per shape at adoption, which is the single
 *  point every scene entry passes through — for BOTH kernels, since brep shapes live in the
 *  same meshup scene.
 *
 *  Why per-Modeler and not a module global: Runner.initLocalArchiyou() builds a fresh Modeler
 *  for every scope, so the main run and each $component() activation number independently and
 *  cannot interleave. The isolation test below is what that rests on.
 */
import { describe, it, expect, beforeAll } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'

describe('sid: mesh kernel', () =>
{
    let modeler:Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
    })

    it('numbers shapes in the order they are created', async () =>
    {
        modeler.reset()

        const a = modeler.box(10, 10, 10)
        const b = modeler.circle(5)
        const c = modeler.box(2, 2, 2)

        expect([(a as any).sid(), (b as any).sid(), (c as any).sid()]).toEqual([1, 2, 3])
        expect(modeler.lastSid()).toEqual(3)
    })

    it('rebases the sequence on reset()', async () =>
    {
        modeler.reset()
        modeler.box(1, 1, 1)
        expect(modeler.lastSid()).toEqual(1)

        modeler.reset()
        expect(modeler.lastSid()).toEqual(0)
        expect((modeler.box(1, 1, 1) as any).sid()).toEqual(1) // provider re-installed on the new root
    })

    it('gives a copy a fresh sid and records its source', async () =>
    {
        modeler.reset()

        const box = modeler.box(10, 10, 10)
        const copy = (box as any).copy()

        expect((box as any).sid()).toEqual(1)
        expect((copy as any).sid()).toEqual(2)
        expect((copy as any)._sidFrom).toEqual(1)
    })

    it('does not renumber a shape moved into a layer', async () =>
    {
        modeler.reset()

        const box = modeler.box(10, 10, 10)
        const sid = (box as any).sid()
        modeler.layer('boxes').add(box as any) // already in scene -> re-parented

        expect((box as any).sid()).toEqual(sid)
    })

    it('produces the same sids for the same build sequence', async () =>
    {
        const build = () =>
        {
            modeler.reset()
            return [modeler.box(1, 1, 1), modeler.circle(3), modeler.box(4, 4, 4)]
                .map(s => (s as any).sid())
        }
        expect(build()).toEqual(build())
    })

    it('serialises sid into the scenegraph', async () =>
    {
        modeler.reset()
        const box = modeler.box(10, 10, 10)

        const state = modeler.toArchiyouState()
        const findSids = (node:any):Array<number> =>
            [...(node.sid !== undefined ? [node.sid] : []),
             ...(node.children ?? []).flatMap(findSids)]

        expect(findSids(state.scenegraph)).toContain((box as any).sid())
    })
})

describe('sid: per-Modeler isolation', () =>
{
    it('numbers two Modelers independently', async () =>
    {
        // What keeps a $component() scope from consuming the main run's sequence: each scope
        // gets its own Modeler (Runner.initLocalArchiyou), hence its own counter and scene.
        const main = new Modeler()
        const component = new Modeler()
        await main.load()
        component.inheritKernels(main)
        component.reset()

        const mainBox = main.box(10, 10, 10)
        const compBox = component.box(10, 10, 10)
        const mainBox2 = main.box(20, 20, 20)

        expect((mainBox as any).sid()).toEqual(1)
        expect((compBox as any).sid()).toEqual(1)  // its own sequence, not 2
        expect((mainBox2 as any).sid()).toEqual(2) // main is unperturbed
    })
})

describe('sid: brep kernel parity', () =>
{
    let modeler:Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler('brep')
        await modeler.load()
    })

    it('numbers brep shapes from the same scene sequence', async () =>
    {
        modeler.reset()

        const a = modeler.box(10, 10, 10)
        const b = modeler.box(20, 20, 20)

        expect([(a as any).sid(), (b as any).sid()]).toEqual([1, 2])
        expect(modeler.lastSid()).toEqual(2)
    })

    it('gives a brep copy a fresh sid and records its source', async () =>
    {
        modeler.reset()

        const box = modeler.box(10, 10, 10)
        const copy = (box as any).copy()

        expect((box as any).sid()).toEqual(1)
        expect((copy as any).sid()).toEqual(2)
        expect((copy as any)._sidFrom).toEqual(1)
    })
})
