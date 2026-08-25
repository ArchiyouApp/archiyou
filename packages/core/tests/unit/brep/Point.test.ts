import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

// Point's constructor grabs the OC handle (see Point.ts), so the kernel has to be up.
beforeAll(async () => { await brep.init() })

test("Point test", () =>
{
    let point = new brep.Point();
    expect(point.toArray()).toEqual([0,0,0])
})

test("Point from a meshup-shaped point", () =>
{
    // The shared kernel point contract: anything with x/y/z reads as a Point.
    expect(new brep.Point({ x: 1, y: 2, z: 3 } as any).toArray()).toEqual([1,2,3])
    expect(new brep.Point({ x: 1, y: 2 } as any).toArray()).toEqual([1,2,0])
})
