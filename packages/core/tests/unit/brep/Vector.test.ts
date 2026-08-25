import * as brep from '../../../src/modeler/brep/index';

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => 
{
    const oc = await brep.init(); // saved globally for reuse
});

test("Vector OC", () => 
{
    expect(brep.Vector.prototype._oc).not.toBeNull();
})

test("Vector", () => 
{
    // basic zero Vector
    let v1 = new brep.Vector(0,0,0);
    expect(v1).not.toBeNull();
    expect(v1._ocVector).not.toBeNull();
    expect(v1.toArray()).toEqual([0,0,0]);
    expect(v1.move(100).toArray()).toEqual([100,0,0]);
    // non-zero Vectors created with different methods
    expect(new brep.Vector(100).toArray()).toEqual([100,0,0]);
    expect(new brep.Vector(100,50).toArray()).toEqual([100,50,0]);
    expect(new brep.Vector(100,50,150).toArray()).toEqual([100,50,150]);
    expect(new brep.Vector([10,20,30]).toArray()).toEqual([10,20,30]);
    expect(new brep.Vector().random().length()).toBeGreaterThan(0);
    //expect(new Vector('bla').toArray()).toEqual([0,0,0]) // with error msg
    // Vector methods
    expect(new brep.Vector(100,0,0).magnitude()).toEqual(100);
    expect(new brep.Vector(100,0,0).length()).toEqual(100);
    expect(new brep.Vector(1,1,1).squareMagnitude()).toEqual(3);
    expect(new brep.Vector(1,1,1).angles()).toEqual([45,45,45]);
    expect(new brep.Vector(1,1,1).multiply(10).toArray()).toEqual([10,10,10]);
    //expect(new Vector(1,1,1).multiply(10,1,0).toArray()).toEqual([10,1,0]); // BUG
    expect(new brep.Vector(100,0,0).normalize().toArray()).toEqual([1,0,0]);
    expect(new brep.Vector(100,100,100).scale(2).toArray()).toEqual([200,200,200]);
    expect(new brep.Vector(100,100,100).divide(2).toArray()).toEqual([50,50,50]);
    expect(new brep.Vector(0,1,0).crossed(1,0,0).toArray()).toEqual([0,0,-1]);
    expect(new brep.Vector(0,1,0).crossed([1,0,0]).toArray()).toEqual([0,0,-1]);
    expect(new brep.Vector(1,3,-5).dot([4,-2,-1])).toEqual(3);
    expect(new brep.Vector(11,12,13).reverse().toArray()).toEqual([-11,-12,-13]);
    expect(new brep.Vector(-1,1,0).mirror().toArray()).toEqual([1,1,0]);
    expect(new brep.Vector(-1,1,0).mirror([0,0,0],[0,-1,0]).toArray()).toEqual([1,1,-0]); // ts jest cares about diff between -0 and +0
    expect(new brep.Vector(-1,1,0).mirror([0,0,0],[0,1,0]).toArray()).toEqual([1,1,0]);
    expect(new brep.Vector(-1,0,0).rotate(-180).round().toArray()).toEqual([1,0,0]);
    expect(new brep.Vector(1,0,0).isOpposite(-1,0,0)).toEqual(true);
    expect(new brep.Vector(1,1,1).isParallel(2,2,2)).toEqual(true);
    expect(new brep.Vector(1,0,0).angle(0,1,0)).toEqual(90);
    //expect(new brep.Vector(1,1,1).angle('bla')).toEqual(null); // with error msg
    expect(new brep.Vector(10,10,10).equals(new brep.Vector(10,10,10))).toEqual(true);
    expect(new brep.Vector(10,10,10).equals(10,10,10)).toEqual(true);
    expect(new brep.Vector(10,10,10).equals(10,20,10)).toEqual(false);
    //expect(new brep.Vector(10,10,10).equals(null)).toEqual(null); // with error msg
    expect(new brep.Vector(13,0,0).isWhatAxis()).toEqual('x');
    expect(new brep.Vector(0,0,1).isWhatAxis()).toEqual('z');
})


//// MAIN ////




