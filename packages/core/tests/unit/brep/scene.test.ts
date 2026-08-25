/**
 *  Scene membership and styling for brep Shapes.
 *
 *  Replaces the old Obj.test.ts: brep no longer has its own `Obj` scenegraph/style container —
 *  Shapes carry a meshup SceneNode (`_node`) and a meshup Style (`style`), the same as mesh
 *  kernel Shapes, so one scene graph and one style model serve both kernels.
 */
import * as brep from '../../../src/modeler/brep/index'
import { SceneNode } from '@archiyou/meshup'

import { test, describe, beforeAll, expect } from 'vitest'

beforeAll(async () => { await brep.init() });

describe('brep Shape scene + style', () =>
{
    test("a standalone Shape is not in any scene", () =>
    {
        const b = new brep.Solid().makeBox()
        expect(b._node).toBeNull();
        expect(b._scene).toBeNull();
        // addToScene() on a Shape with no host modeler is a no-op, not an error
        expect(() => b.addToScene()).not.toThrow();
        expect(b._node).toBeNull();
    })

    test("styling writes to the meshup Style, and getColor() resolves it to an int", () =>
    {
        const b = new brep.Solid().makeBox()

        b.color('green');
        expect(b.getColor()).toEqual(32768);

        b.lineWidth(10);
        expect(b.style.stroke.width).toEqual(10);

        b.dashed();
        expect(b.style.stroke.dash).toEqual([5,5]);

        // later colors override earlier ones
        b.color('blue')
        expect(b.getColor()).toEqual(255);
    })

    test("hide/show drive Style.visible", () =>
    {
        const b = new brep.Solid().makeBox()
        expect(b.visible()).toEqual(true);
        b.hide();
        expect(b.visible()).toEqual(false);
        b.show();
        expect(b.visible()).toEqual(true);
    })

    test("naming a Shape mirrors onto its SceneNode", () =>
    {
        const b = new brep.Solid().makeBox()
        b.name('mybox')
        expect(b.name()).toEqual('mybox');

        const node = new SceneNode('layer');
        node.addShape(b as any);
        expect(b._node).not.toBeNull();

        b.name('renamed');
        expect(b._node!.name).toEqual('renamed');
    })

    test("color cascades down from a layer when the Shape sets none", () =>
    {
        const layer = SceneNode.root('root');
        layer.color('green');

        const b = new brep.Solid().makeBox()
        layer.addShape(b as any);

        // the Shape has no color of its own, so it takes the layer's
        expect(b.getColor()).toEqual(32768);

        // ...and its own explicit color wins over the layer's
        b.color('blue');
        expect(b.getColor()).toEqual(255);
    })

    test("removeFromScene detaches the Shape", () =>
    {
        const layer = SceneNode.root('root');
        const b = new brep.Solid().makeBox()
        layer.addShape(b as any);
        expect(b._node).not.toBeNull();

        b.removeFromScene();
        expect(b._node).toBeNull();
        expect(layer.shapes().length).toEqual(0);
    })

    test("@sceneAdd puts an operation's result in the scene, keeping the operand", () =>
    {
        const layer = SceneNode.root('root');
        layer.setActiveLayer(layer);

        const box = new brep.Solid().makeBox(100);
        layer.addShape(box as any);
        expect(layer.shapes().length).toEqual(1);

        // moved() returns a copy — @sceneAdd lands it in the active layer next to the original
        const moved = box.copy().move(200);
        expect(layer.shapes().length).toEqual(2);
        expect(box._node).not.toBeNull();      // operand stays in the scene
        expect(moved._node).not.toBeNull();    // result joined it
    })

    test("@sceneCarry hands sub-shapes the scene context without touching the scene", () =>
    {
        const layer = SceneNode.root('root');
        layer.setActiveLayer(layer);

        const box = new brep.Solid().makeBox(100);
        layer.addShape(box as any);
        (box as any)._modeler = { marker: true };

        const before = layer.shapes().length;
        const faces = box.faces();

        expect(faces.length).toEqual(6);
        expect(layer.shapes().length).toEqual(before);   // pure: no scene mutation
        // ...but the sub-shapes can still reach the host app
        expect((faces.first() as any)._modeler?.marker).toBe(true);
    })

    test("a tmp() Shape stays out of the scene, and so do shapes derived from it", () =>
    {
        const layer = SceneNode.root('root');
        layer.setActiveLayer(layer);

        const helper = new brep.Solid().makeBox(10);
        layer.addShape(helper as any);
        helper.tmp();

        expect(helper._node).toBeNull();
        expect(layer.shapes().length).toEqual(0);

        const derived = helper.copy().move(50);
        expect(derived._suppressScene).toBe(true);
        expect(layer.shapes().length).toEqual(0);
    })
})

describe('brep layout helpers (parity with the mesh kernel)', () =>
{
    test("row() repeats the Shape along a direction, spaced by bbox", () =>
    {
        const b = new brep.Solid().makeBox(100)
        const r = b.row(3, 10)

        expect(r.length).toEqual(3)
        // 100 wide + 10 gap => centres at 0, 110, 220
        expect(r.toArray().map((s: any) => Math.round(s.center().x))).toEqual([0, 110, 220])
    })

    test("place() drops the Shape onto a height by its bounding box", () =>
    {
        expect(Math.round(new brep.Solid().makeBox(100).place().bbox().min().z)).toEqual(0)
        expect(Math.round(new brep.Solid().makeBox(100).place(50).bbox().min().z)).toEqual(50)
    })
})
