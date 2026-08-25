import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Wire perpendicularPointTo finds a foot on every side", () =>
{
    const w = new brep.Wire().makeRect(100, 50);
    const from = new brep.Point(10, 5, 0);
    const feet = w.perpendicularPointTo(from, true) as Array<brep.Point>;

    expect(feet.length).toEqual(4);
    feet.forEach( f =>
    {
        const connector = f.toVector().subtracted(from.toVector()).normalize();
        expect(Math.abs(connector.dot(w.directionAt(f).normalize()))).toBeLessThan(0.05);
    });
})

test("Wire perpendicularPointTo reports the nearest foot first", () =>
{
    const w = new brep.Wire().makeRect(100, 50);
    const feet = w.perpendicularPointTo([200, 10, 0], true) as Array<brep.Point>;

    // the near side and the far side, the two sides parallel to the y axis
    expect(feet.length).toEqual(2);
    expect(feet[0].distance([50, 10, 0])).toBeCloseTo(0, 6);
    expect(feet[1].distance([-50, 10, 0])).toBeCloseTo(0, 6);
    expect((w.perpendicularPointTo([200, 10, 0]) as brep.Point).distance([50, 10, 0])).toBeCloseTo(0, 6);
})

test("Wire perpendicularPointTo skips corners, which have no tangent", () =>
{
    const w = new brep.Wire().makeRect(100, 50);

    // straight out from a corner nothing on the Wire is perpendicular...
    expect(w.perpendicularPointTo([200, 200, 0], true)).toEqual([]);
    // ...but the closest point is still reported
    expect((w.perpendicularPointTo([200, 200, 0]) as brep.Point).distance([50, 25, 0])).toBeCloseTo(0, 6);
})

test("Wire perpendicularPointTo spans the Edges of an open Wire", () =>
{
    const w = new brep.Wire().fromPoints([[0, 0, 0], [100, 0, 0], [100, 50, 0]]);
    const feet = w.perpendicularPointTo([50, 25, 0], true) as Array<brep.Point>;

    expect(feet.length).toEqual(2); // one per Edge
    expect(feet[0].distance([50, 0, 0])).toBeCloseTo(0, 6);
    expect(feet[1].distance([100, 25, 0])).toBeCloseTo(0, 6);

    // nothing is perpendicular below the start of the Wire
    expect(w.perpendicularPointTo([-50, -50, 0], true)).toEqual([]);
    expect((w.perpendicularPointTo([-50, -50, 0]) as brep.Point).distance([0, 0, 0])).toBeCloseTo(0, 6);
})

test("Wire perpendicularPointTo reports a shared corner once", () =>
{
    const w = new brep.Wire().fromPoints([[0, 0, 0], [100, 0, 0], [100, 50, 0]]);
    // (100,0,0) is the foot of both Edges: perpendicular to the first along z, and the start of the second
    const feet = w.perpendicularPointTo([100, 0, 80], true) as Array<brep.Point>;

    expect(feet.length).toEqual(1);
    expect(feet[0].distance([100, 0, 0])).toBeCloseTo(0, 6);
})
