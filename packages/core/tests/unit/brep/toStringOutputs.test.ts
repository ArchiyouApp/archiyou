import * as brep from '../../../src/modeler/brep/index'
import { SceneNode } from '@archiyou/meshup'

import { test, beforeAll, expect } from 'vitest'

console.geom = console.log;

beforeAll(async () => { await brep.init() });

// Every toString() ends with the Shape's scene membership. None of these Shapes was
// added to a scene, so they all report the detached form.
const NO_SCENE = 'node=<not in scene>';

test("toStringOutputs", () =>
{
    expect(new brep.Vertex(0).toString()).toEqual(`<Vertex position="[0,0,0]" ${NO_SCENE}>`);
    expect(new brep.Edge().makeLine([0,0,0],[100,0,0]).toString()).toEqual(`<Edge:Line start="[0,0,0]" end="[100,0,0]" ${NO_SCENE}>`);
    expect(new brep.Face().makeCircle(50).toString()).toEqual(`<Face:Planar numVertices="1" numEdges="1" ${NO_SCENE}>`);
    expect(new brep.Face().makePlane().toString()).toEqual(`<Face:Planar numVertices="4" numEdges="4" ${NO_SCENE}>`);
});

test("toString() shows the SceneNode a Shape sits in", () =>
{
    const scene = new SceneNode('root');
    const s = new brep.Solid().makeBox();

    expect(s.toString()).toContain(NO_SCENE);

    scene.addShape(s as any);
    s.name('myBox');
    expect(s.toString()).toEqual(`<Solid:${s.solidType()} numShells="${s.shells().length}" node={ name: 'myBox', id: '${s.node().id()}' }>`);

    s.removeFromScene();
    expect(s.toString()).toContain(NO_SCENE);
});
