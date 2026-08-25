import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Edge OC", () =>
{
    expect(brep.Edge.prototype._oc).not.toBeNull();
})

test("Edge Basics", () =>
{
    // Basics: Line Edge
    const l = new brep.Edge().makeLine([0,0],[100,0]);
    expect(l.type).toEqual('Edge');
    expect(l.edgeType()).toEqual('Line');
    expect(l.toWire().type).toEqual('Wire');
    expect(l.start().toArray()).toEqual([0,0,0]);
    expect(l.end().toArray()).toEqual([100,0,0]);
    expect(l.is2DXY()).toEqual(true);
    expect(l.isCircular()).toEqual(false);
    expect(l.length()).toEqual(100);
    expect(l.center().toArray()).toEqual([50,0,0]);

    // Circle Edge
    const radius = 100;
    const c = new brep.Edge().makeCircle(radius);
    expect(c.type).toEqual('Edge');
    expect(c.edgeType()).toEqual('Circle');
    expect(c.length()).toEqual(brep.roundToTolerance(radius*Math.PI*2));
    expect(Math.round(c.bbox().width())).toEqual(200);

    // Arc Edge
    // TODO

})


test("Edge Advanced", () =>
{
    // ExtendTo Line to Plane
    const l = new brep.Edge().makeLine([0,0,0],[0,0,100])
    const pl = new brep.Face().makePlane(3000,3000).moveZ(-500)
    l.extendTo(pl)
    expect(l.start().toArray()).toEqual([0,0,-500]);

    // ExtendTo Line to Solid
    const l2 = new brep.Edge().makeLine([0,0,10],[0,0,200]);
    const pl2 = new brep.Solid().makeBox(2000,2000).moveZ(-1000);
    l2.extendTo(pl2);
    expect(l2.start().toArray()).toEqual([0,0,0]);

    // extendTo Arc to Line
    const a = new brep.Edge().makeArc([0,0],[100,50],[200,0]);
    const ln = new brep.Edge().makeLine([150,0,0],[300,0,0]).moveY(-50);
    a.extendTo(ln);
    expect(a.end().toArray()).toEqual([222.474,-50,0]);
})

//// PERPENDICULAR POINTS ////

test("Edge perpendicularPointTo on a Line", () =>
{
    const l = new brep.Edge().makeLine([0,0,0],[100,0,0]);

    expect((l.perpendicularPointTo([50,30,0]) as brep.Point).toArray()).toEqual([50,0,0]);
    expect((l.perpendicularPointTo([50,30,0], true) as Array<brep.Point>).length).toEqual(1);
    // a point already on the Edge projects onto itself
    expect((l.perpendicularPointTo([30,0,0]) as brep.Point).toArray()).toEqual([30,0,0]);

    // past the end there is no perpendicular, so the closest point is returned instead
    expect(l.perpendicularPointTo([150,30,0], true)).toEqual([]);
    expect((l.perpendicularPointTo([150,30,0]) as brep.Point).toArray()).toEqual([100,0,0]);
})

test("Edge perpendicularPointTo on a Circle", () =>
{
    const c = new brep.Edge().makeCircle(50);

    // a circle seen from outside has a near and a far foot
    const feet = c.perpendicularPointTo([200,0,0], true) as Array<brep.Point>;
    expect(feet.length).toEqual(2);
    expect(feet[0].distance([50,0,0])).toBeCloseTo(0, 6); // nearest first
    expect(feet[1].distance([-50,0,0])).toBeCloseTo(0, 6);
    expect((c.perpendicularPointTo([200,0,0]) as brep.Point).distance([50,0,0])).toBeCloseTo(0, 6);

    // and so does one seen from inside
    expect((c.perpendicularPointTo([10,0,0], true) as Array<brep.Point>).length).toEqual(2);
})

test("Edge perpendicularPointTo respects the Edge's placement", () =>
{
    // NOTE: the OC basis curve of a moved Edge still sits at the origin - Point.project() patches
    // that up for circles afterwards, perpendicularPointTo() projects in the Edge's own frame
    const c = new brep.Edge().makeCircle(50).move(200,100,0);
    const feet = c.perpendicularPointTo([200,300,0], true) as Array<brep.Point>;

    expect(feet.length).toEqual(2);
    expect(feet[0].distance([200,150,0])).toBeCloseTo(0, 6);
    expect(feet[1].distance([200,50,0])).toBeCloseTo(0, 6);
})

test("Edge perpendicularPointTo stays within a trimmed Arc", () =>
{
    const a = new brep.Edge().makeArc([50,0,0],[0,50,0],[-50,0,0]); // upper half circle

    // (0,-50) is a foot on the full circle, but it is not on this Arc
    const feet = a.perpendicularPointTo([0,-200,0], true) as Array<brep.Point>;
    expect(feet.length).toEqual(1);
    expect(feet[0].distance([0,50,0])).toBeCloseTo(0, 6);

    // both ends of the half circle are perpendicular when seen along its axis
    const ends = a.perpendicularPointTo([200,0,0], true) as Array<brep.Point>;
    expect(ends.length).toEqual(2);
    expect(ends[0].distance([50,0,0])).toBeCloseTo(0, 6);
})

test("Edge perpendicularPointTo on a Spline", () =>
{
    const s = new brep.Edge().makeSpline([[0,0,0],[50,50,0],[100,-50,0],[150,0,0]]);
    const from = new brep.Point(75,100,0);
    const feet = s.perpendicularPointTo(from, true) as Array<brep.Point>;

    expect(feet.length).toBeGreaterThan(1);
    feet.forEach( f =>
    {
        const connector = f.toVector().subtracted(from.toVector()).normalize();
        expect(Math.abs(connector.dot(s.tangentAt(f)))).toBeLessThan(0.05);
    });
})
