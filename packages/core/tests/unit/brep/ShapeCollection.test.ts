import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Bbox", () =>
{
    let b1 = new brep.Face().makePlane(100,100);
    let b2 = new brep.Face().makePlane(100,100).move(50,50);
    let c = new brep.ShapeCollection(b1,b2);
    expect(c.bbox().toData()).toEqual([-50,100,-50,100,0,0]);
});

test("copy", () =>
{
    const g1 = new brep.ShapeCollection(new brep.Solid().makeBox(10), new brep.Solid().makeBox(20));
    const g2 = g1.copy();
    expect(g2[0].bbox().width() === g1[0].bbox().width()).toEqual(true);
});

test("fakeKeyIndices", () =>
{
    const g1 = new brep.ShapeCollection(new brep.Solid().makeBox(10), new brep.Solid().makeBox(20));
    const g2 = g1.shallowCopy();
    console.log(g1[0]);
    console.log(g2[0]);
    expect(g2[0].equals(g1[0])).toEqual(true);
});
