import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => 
{
    const oc = await brep.init(); // saved globally for reuse
});

test("AlignByPoint2", () => 
{
    const b1 = new brep.Solid().makeBox(100,50,10).alignByPoints(
        ['leftfrontbottom','rightfrontbottom'], 
        [[0,0,0],[1,1,0]]); 
    expect(b1.edges()[1].direction().normalized().round().toArray()).toEqual([-0.707, 0.707, 0]);
});


test("AlignByPoint3", () => 
{
    const b2 = new brep.Solid().makeBox(100,50,10).alignByPoints(
        ['leftfrontbottom','rightfrontbottom','rightbackbottom'], 
        [[0,0,0],[1,0,0],[0,1,1]]);
    expect(b2.faces()[2].normal().round().toArray()).toEqual([-0, -0.707, -0.707]);
});