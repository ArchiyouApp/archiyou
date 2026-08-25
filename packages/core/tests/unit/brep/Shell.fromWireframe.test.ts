import * as brep from '../../../src/modeler/brep/index'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

test("Shell.fromWireframe plane", () =>
{
    // Simple plane wireframe
    const edges = new brep.Face().makePlane(100,50).edges().copy().move(150);
    const s1 = new brep.Shell().fromWireFrame(edges);
    expect(s1.type).toEqual('Shell');
    expect(s1.faces().length).toEqual(1);
})

test("Shell.fromWireframe box", () =>
{
    // Box wireframe
    const edges2 = new brep.Solid().makeBox(60,50,20).move(300).edges();
    const s2 = new brep.Shell().fromWireFrame(edges2);
    expect(s2.type).toEqual('Shell')
    expect(s2.faces().length).toEqual(6);
})

test("Shell.fromWireframe fragmented box", () =>
{
    // Fragmented box wireframe
    const edges3 = new brep.Solid().makeBox(60,50,20).move(300).select('E[0-3] and E[7-11]');
    const s3 = new brep.Shell().fromWireFrame(edges3);
    expect(s3.type).toEqual('Shell')
    expect(s3.faces().length).toEqual(2);
})
