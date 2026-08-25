import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Bbox3D", () =>
{
    const b = new brep.Solid().makeBox(100,10,200).rotateZ(10);
    const obb = b.obbox();
    expect(obb.width()).toEqual(10);
    expect(obb.depth()).toEqual(100);
    expect(obb.height()).toEqual(200);
    expect(Array.isArray(obb.corners())).toEqual(true);
    expect(obb.is3D()).toEqual(true);
    expect(obb.is2D()).toEqual(false);
})

test("Bbox2D", () =>
{
    const r = new brep.Face().makePlane(100,10).moveY(-100).rotateZ(30);
    expect(r.obbox().is2D()).toEqual(true);
    expect(r.obbox().depthHalfLine().type).toEqual('Edge');
})

test("shape() 3D gives a box Solid on the OBbox axes", () =>
{
    const b = new brep.Solid().makeBox(100,10,200).rotateZ(10).move(30,40,50);
    const s = b.obbox().shape();

    expect(s.type).toEqual('Solid');
    // Volume of the original box, not of the (much larger) axis-aligned bbox.
    // NOTE: OC's OBB is not perfectly tight — it comes out ~0.05% too big
    expect(s.volume()).toBeGreaterThanOrEqual(100*10*200);
    expect(s.volume()).toBeLessThan(100*10*200 * 1.01);
    const bb = b.bbox();
    expect(s.volume()).toBeLessThan(bb.width() * bb.depth() * bb.height()); // an axis-aligned box would be bigger
    expect(s.center().equals(b.center())).toEqual(true);
})

test("shape() 2D gives a rectangle Face", () =>
{
    const r = new brep.Face().makePlane(100,10).moveY(-100).rotateZ(30);
    const s = r.obbox().shape();

    expect(s.type).toEqual('Face');
    expect(s.area()).toBeCloseTo(100*10, 0);
})

test("shape() 2D also works when the flat axis is not the OBbox z axis", () =>
{
    // A circle in the YZ plane: OC hands back an OBbox with width (x) 0, so the
    // rectangle has to be built on the y/z axes instead of the x/y ones
    const c = new brep.Edge().makeCircle(50);
    const obb = c.obbox();

    expect(obb.width()).toEqual(0);
    const s = obb.shape();
    expect(s.type).toEqual('Face');
    expect(s.area()).toBeCloseTo(100*100, 0);
})

test("shape() 1D gives a line Edge", () =>
{
    const e = new brep.Edge().makeLine([0,0,0],[100,50,25]);
    const s = e.obbox().shape();

    expect(s.type).toEqual('Edge');
    expect(s.length()).toBeCloseTo(e.length(), 1);
})
