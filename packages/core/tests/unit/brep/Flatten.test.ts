/** Shape.flatten() / ShapeCollection.flatten() — brep parity with meshup's Mesh.flatten():
 *  keep the Faces aligned with the axis (default 'z'), collapse them onto the plane at 0
 *  and filter out the doubles that creates. */
import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

beforeAll(async () => 
{
    await brep.init();
});

test("flatten a Box defaults to axis z and gives a single Face at z=0", () => 
{
    const flat = new brep.Solid().makeBox(100,50,20).move(0,0,30).flatten() as any;

    expect(flat.type).toEqual('Face');
    expect(flat.bbox().min().z).toBeCloseTo(0);
    expect(flat.bbox().max().z).toBeCloseTo(0);
    expect(flat.bbox().width()).toBeCloseTo(100);
    expect(flat.bbox().depth()).toBeCloseTo(50);
});

test("flatten collapses along the given axis", () => 
{
    const flat = new brep.Solid().makeBox(100,50,20).flatten('x') as any;

    expect(flat.type).toEqual('Face');
    expect(flat.bbox().min().x).toBeCloseTo(0);
    expect(flat.bbox().max().x).toBeCloseTo(0);
    expect(flat.bbox().depth()).toBeCloseTo(50);
    expect(flat.bbox().height()).toBeCloseTo(20);
});

test("ShapeCollection.flatten() removes Shapes that flattened onto each other", () => 
{
    const a = new brep.Solid().makeBox(100,50,20);
    const b = new brep.Solid().makeBox(100,50,20).move(0,0,200); // same footprint
    const c = new brep.Solid().makeBox(60,60,20).move(500,0,0);

    const col = new brep.ShapeCollection([a,b,c]).flatten();

    expect(col.length).toEqual(2);
    expect(col.toArray().every(s => Math.abs(s.bbox().max().z) < 0.001)).toEqual(true);
});
