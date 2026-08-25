import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Spiral", () =>
{
    expect(new brep.Wire().makeSpiral(100,100, 360).length()).toEqual(628.319); // 2*PI*100
})

test("Helix", () =>
{
    expect(new brep.Wire().makeHelix(200,200,360).length()).toEqual(1272.453); // 2*PI*100
})
