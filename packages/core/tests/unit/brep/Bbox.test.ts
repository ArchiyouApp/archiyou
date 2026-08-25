import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Bbox 2D", () =>
{
    let pl = new brep.Face().makePlane(100,200);
    expect(pl.bbox().area()).toEqual(20000);
    expect(pl.bbox(100,100).enlarged(10).width()).toEqual(120);
    expect(pl.bbox(100,100).enlarged(100).height()).toEqual(0); // don't scale zero height so Bbox stays 2D!
})

test("Bbox 3D", () =>
{
    let b = new brep.Solid().makeBox(10,10);
    expect(b.bbox().area()).toEqual(600);
})
