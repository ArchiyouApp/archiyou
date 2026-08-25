import * as brep from '../../../src/modeler/brep/index'
import { test, expect } from 'vitest'

test("init", async () =>
{
    const oc = await brep.init();
    expect(oc).toBeDefined();
})
