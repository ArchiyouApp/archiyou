import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as meshup from '@archiyou/meshup';

import { applyEdgeExtensions } from '../src/viewer/gltf-edge-extensions.js';

/**
 *  Copies of a shape (a row of studs) share their vertex data in the GLB. GLTFLoader turns
 *  that into one BufferGeometry for all of them, and the edge lines the viewer builds from it
 *  are worked out once and shared as well. Each copy is still its own object, in its own place.
 */

beforeAll(async () =>
{
  await meshup.init();
});

function parse(glb: Uint8Array): Promise<GLTF>
{
  const data = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
}

describe('a row of copies', () =>
{
  it('shares one geometry and one edge geometry, each copy in its own place', async () =>
  {
    const scene = meshup.SceneNode.root<meshup.SceneNode>('root');
    const stud = meshup.Mesh.Box(38, 140, 2400);
    stud.style.strokeWidth = 1;   // edges drawn, as a styled part has them
    Array.from({ length: 5 }, (_, i) =>
      scene.addChild(meshup.SceneNode.from(stud._copy().move(i * 600, 0, 0), `stud${i + 1}`)));

    const gltf = await parse(await scene.toGLB());
    await applyEdgeExtensions(gltf, gltf.scene);
    gltf.scene.updateMatrixWorld(true);

    const meshes: Array<THREE.Mesh> = [];
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && !o.userData.isEdgeOverlay) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(5);
    expect(new Set(meshes.map(m => m.geometry)).size).toBe(1);
    expect(new Set(meshes.map(m => m.material)).size).toBe(5);

    const edges = meshes.map(m => m.children.find(c => c.userData.isEdgeOverlay) as THREE.Mesh);
    edges.forEach(e => expect(e).toBeDefined());
    expect(new Set(edges.map(e => e.geometry)).size).toBe(1);

    const centresX = meshes.map(m => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).x);
    centresX.forEach((x, i) => expect(x - centresX[0]).toBeCloseTo(i * 600, 3));
  });
});
