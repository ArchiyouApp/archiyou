import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Shelling", () =>
{
    // Solid Box
    expect(new brep.Solid().makeBox(100).copy().shell(5).faces().length).toEqual(32);
    expect(new brep.Solid().makeBox(100).copy().shell(5, 'F||top').faces().length).toEqual(23); // top off
    expect(new brep.Solid().makeBox(100).copy().shell(-5).faces().length).toEqual(12);
    expect(new brep.Solid().makeBox(100).copy().shell(-5, 'F||top').faces().length).toEqual(11); // top off
    expect(new brep.Solid().makeBox(100).copy().shell(5, 'F||top', 'intersection').faces().length).toEqual(11); // top off, with straight join type
    // Solid Sphere
    expect(new brep.Solid().makeSphere(100).copy().shell(5).faces().length).toEqual(2);
    expect(new brep.Solid().makeSphere(100).copy().shell(-5).faces().length).toEqual(2);
    // Face
    expect(new brep.Face([0,0,0],[100,100,100],[0,100,0]).copy().shell(5).faces().length).toEqual(5);
    // Shell
    let a1 = new brep.Edge().makeArc([0,0,0],[100,0,-50],[200,0,0])
    let l = new brep.Edge().makeLine([50,100,0],[150,100,20])
    let a2 = new brep.Edge().makeArc([0,200,0],[100,200,90],[200,200,0])
    let loft = a1.copy().loft([l,a2]).move(0,0,150);
    expect(loft.copy().shell(5).move(300).faces().length).toEqual(6);
});


test("ShellingBoxes", () =>
{
    let b1 = new brep.Solid().makeBox(100).hide();
    let b2 = new brep.Solid().makeBox(20,20,50).move(0,0,50).hide();
    let u1 = b1.copy().union(b2).hide();
    let u2 = u1.copy().fillet(3, 'V[7-10]').hide();
    let u3 = u2.copy().shell(-2, null).hide();
    let cutbox = new brep.Solid().makeBox(300,300,300).move(150);
    let u4 = u3.copy().subtract(cutbox.hide());
    expect(u4.faces().length).toEqual(33);
});
