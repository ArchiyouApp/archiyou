import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Intersection Basics", () =>
{
    const v1 = new brep.Vertex(100,0,0);
    const v2 = new brep.Vertex(100,100,100);
    const v3 = new brep.Vertex(100,100,100);
    const lv = new brep.Edge().makeLine([0,-50],[0,50])
    const lh = new brep.Edge().makeLine([-100,0],[200,0])
    const b = new brep.Solid().makeBox();
    const s = new brep.Solid().makeSphere(200);

    // vertex - vertex
    expect(v1.intersection(v2)).toEqual(null); // null
    expect(v2.intersection(v3).toArray()).toEqual([100,100,100]); // Vertex(100,100,100)
    expect(v3.intersection(v2).toArray()).toEqual([100,100,100]); // Vertex(100,100,100)
    // vertex - edge
    expect(v1.intersection(lh).toArray()).toEqual([100,0,0]); // V(100,0,0)
    // edge - edge
    expect(lv.intersection(lh).toArray()).toEqual([0,0,0]); // V(0,0,0)
    // vertex - solid
    expect(b.intersection(v1)).toEqual(null); // null
    expect(s.intersection(v1).toArray()).toEqual([100,0,0]); // vertex(100,0,0)
    // edge - solid
    expect(s.intersection(lv).length()).toEqual(100); // 100

    // TODO: intersections with ShapeCollection
    // TODO: intersections with Wires
});
