import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("LoftClosed", () =>
{
    let c = new brep.Face().makeCircle(50);
    let r = new brep.Face().makePlane().move(0,0,100);
    let v = new brep.Vertex(200,0,300);
    let lft1 = c.copy().loft([r,v], true).move(100);
    let lft2 = c.copy().loft([r,v], false).move(200); // don't make a solid
    expect(lft1.faces().length).toEqual(6); // 6
    expect(lft2.faces().length).toEqual(5); // 5
});


test("LoftOpen", () =>
{
    let l1 = new brep.Wire([0,0],[100,0],[100,100]).move(0,200);
    let a = new brep.Edge().makeArc([0,0],[0,50],[50,50]).move(0,200,300);
    let v2 = new brep.Vertex(0,150,500)
    let lft3 = l1.copy().loft([a,v2]);
    expect(lft3.faces().length).toEqual(2) // 2
});
