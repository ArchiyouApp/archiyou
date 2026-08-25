import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Selectors Basics", () =>
{
    const W = 10;
    const H = 20;
    const D = 30;
    const b = new brep.Solid().makeBox(W,D,H);
    // Parallel
    expect(b.select('E|X').length).toEqual(4);
    expect(b.select('E|Z').length).toEqual(4);
    expect(b.select('E|[0,0,1]').length).toEqual(4);
    expect(b.select('E|[1,1,1]')).toEqual(null);

    // Distance Along Axis
    expect(b.select('V>>X').length).toEqual(4);

    // Side Selector
    expect(b.select('F||top').area()).toEqual(W*D);
    expect(b.select('E||top').length).toEqual(4);
    const vr = new brep.Edge().makeLine([0,0],[100,100])
                .select('V||right') as brep.Vertex;
    expect(vr.toArray()).toEqual([100,100,0]);

    expect((new brep.Face().makePlane(100,100).select('V||frontleft') as brep.Vertex).toArray()).toEqual([-50,-50,0]); // Shape with 2D Bbox

    expect((new brep.Edge().makeLine([0,0],[100,0]).select('V>>X') as brep.Vertex).toArray()).toEqual([100,0,0]);
    expect(new brep.Edge().makeLine([0,0],[100,0]).select('V>>Y').length).toEqual(2);

})

/** select() hands back a single Shape when there is only one result */
const asArray = (r:any):Array<any> => (r?.type === 'ShapeCollection') ? r.toArray() : (r) ? [r] : [];

test("Side selectors on a Box", () =>
{
    const b = new brep.Solid().makeBox(10,10,10);

    // flush: the subshapes really lying on the bbox side plane
    const front = asArray(b.select('F||front'));
    expect(front.length).toEqual(1);
    expect(front[0].area()).toBeCloseTo(100, 3);
    front[0].vertices().toArray().forEach(v => expect(v.y).toBeCloseTo(-5, 6));

    expect(asArray(b.select('V||front')).length).toEqual(4);   // greedy: all 4 front corners
    expect(asArray(b.select('E||frontleft')).length).toEqual(1); // 2 sides meet in an Edge
    expect(asArray(b.select('V||frontlefttop')).length).toEqual(1); // 3 in a Vertex

    // side() picks the subshape type from the number of sides given
    expect(asArray(b.side('front'))[0].type).toEqual('Face');
    expect(asArray(b.side('frontleft'))[0].type).toEqual('Edge');
    expect(asArray(b.side('frontlefttop'))[0].type).toEqual('Vertex');
})

// Regression: a rotated Shape has no subshape flush with its (axis-aligned) bounding box.
// The selector used to return nothing at all there ("Cannot find side Shape"), now it falls
// back to the subshapes facing the side - same two-pass behaviour as the meshup kernel.
test("Side selectors on a rotated Shape", () =>
{
    const box = new brep.Solid().makeBox(10,10,100).rotateX(-10).rotateY(10); // select() does not mutate

    ['front','back','left','right','top','bottom'].forEach(side =>
    {
        expect(asArray(box.select(`F||${side}`)).length, `F||${side}`).toBeGreaterThan(0);
    })

    // F||front is the box own 10 x 100 side Face - and no Face of the box faces front more
    const front = asArray(box.select('F||front'))[0];
    expect(front.area()).toBeCloseTo(1000, 1);
    const facesFront = (f:any) => f.normal().dot(new brep.Vector(0,-1,0));
    box.faces().toArray().forEach(f => expect(facesFront(f)).toBeLessThanOrEqual(facesFront(front) + 1e-9));

    // F||top is the 10 x 10 top Face, still pointing mostly up
    const top = asArray(box.select('F||top'))[0];
    expect(top.area()).toBeCloseTo(100, 1);
    expect(top.normal().dot(new brep.Vector(0,0,1))).toBeGreaterThan(0.9);

    // V||front: rotateY leaves y untouched, so both corners of one Edge tie as front-most
    const verts = asArray(box.select('V||front'));
    expect(verts.length).toEqual(2);
    verts.forEach(v => expect(v.y).toBeCloseTo(box.bbox().minY(), 2)); // brep Bbox is rounded

    // E||front is an Edge of the box itself (10, 10 or 100 long), not a bbox Edge
    const edges = asArray(box.select('E||front'));
    expect(edges.length).toBeGreaterThan(0);
    const edgeLengths = box.edges().toArray().map((e:any) => e.length());
    edges.forEach(e => expect(edgeLengths.some(l => Math.abs(l - e.length()) < 1e-6)).toBe(true));
}, 20000) // OCC under a loaded parallel run is slow
