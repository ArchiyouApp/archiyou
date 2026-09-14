import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Shape OC", () =>
{
    expect(brep.Shape.prototype._oc).not.toBeNull();
})

test("Shape Basics", () =>
{
    const p = new brep.Point(10,20,30);
    expect(brep.Shape.isShape(p)).toEqual(false)

    const v = p.toVertex();
    expect(brep.Shape.isShape(v)).toEqual(true);

    const box = new brep.Solid().makeBox(100);
    expect(brep.Shape.isShape(box)).toEqual(true);

    // Shape attributes
    box.attribute('hidden', true);
    expect(box.attr('hidden')).toEqual(true);

    box.attribute('someattr', 'helloattribute!');
    expect(box.attr('someattr')).toEqual('helloattribute!');

    // Basic Shape properties
    expect(box.center().toArray()).toEqual([0,0,0]);

    // Styling (meshup Style — see scene.test.ts)
    box.color('blue');
    expect(box.getColor()).toEqual(255); // is converted to int

    // Shape subshapes
    expect(box.vertices().length).toEqual(8);
    expect(box.edges().length).toEqual(12);
    expect(box.faces().length).toEqual(6);

    // Bbox
    expect(box.bbox().width()).toEqual(100);
    expect(box.bbox().depth()).toEqual(100);
    expect(box.bbox().height()).toEqual(100);

    // Transformations
    expect(box.copy().move(100).center().toArray()).toEqual([100,0,0]);

    // Copy/Clone
    const copyBox = box.copy();
    expect(box.equals(copyBox)).toEqual(true);
    expect(box.same(copyBox)).toEqual(false);
    const cloneBox = box.clone();
    expect(cloneBox.isClone()).toEqual(true);
    expect(cloneBox.same(box)).toEqual(false);
    expect(cloneBox.clonedFrom().same(box)).toEqual(true);
})

test("Shape trim() is cutoffBy() with another Shape and cutoff() with an axis", () =>
{
    const box = () => new brep.Solid().makeBox(100);
    const { min, max } = { min: box().bbox().min(), max: box().bbox().max() };
    const level = min.x + 30;

    const cutter = () => new brep.Solid().makeBox(100).move(70, 0, 0); // overlaps the last 30 along x

    expect(box().trim(cutter()).volume()).toBeCloseTo(box().cutoffBy(cutter()).volume(), 3);
    expect(box().trim(cutter(), true).volume()).toBeCloseTo(box().cutoffBy(cutter(), true).volume(), 3);
    expect(box().trim(cutter(), true).volume()).toBeLessThan(box().trim(cutter()).volume());

    expect(box().trim('x', level).volume()).toBeCloseTo(0.7 * 100**3, 0);
    expect(box().trim('x', level, true).volume()).toBeCloseTo(0.3 * 100**3, 0);
    expect(max.x - min.x).toBeCloseTo(100);
})
