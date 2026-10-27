import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as meshup from '@archiyou/meshup';

import { mergeParamFrameGlbs } from '@archiyou/core/src/GLTFBuilder';
import { applyEdgeExtensions } from '../src/viewer/gltf-edge-extensions.js';

/**
 *  A parameter sweep morphs a part that keeps its mesh. Its CAD edges are lines the viewer
 *  builds from the mesh after loading, so they get the mesh's morph targets too, and share its
 *  weights: the edges grow with the faces.
 */

beforeAll(async () =>
{
  await meshup.init();
});

async function frame(width: number): Promise<Uint8Array>
{
  const scene = meshup.SceneNode.root<meshup.SceneNode>('root');
  const box = meshup.Mesh.Box(width, 10, 10);
  box.style.strokeWidth = 1;   // edges drawn, as a styled part has them
  scene.addChild(meshup.SceneNode.from(box, 'plank'));
  return scene.toGLB();
}

function parse(glb: Uint8Array): Promise<GLTF>
{
  const data = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
}

describe('a morphing part', () =>
{
  it('draws its edges with the same targets and weights', async () =>
  {
    const { glb, report } = await mergeParamFrameGlbs([await frame(10), await frame(30)], { name: 'w', duration: 1, loop: 'none' });
    expect(report.morphed).toBe(1);

    const gltf = await parse(glb);
    await applyEdgeExtensions(gltf, gltf.scene);

    let mesh: THREE.Mesh | undefined;
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).morphTargetInfluences?.length) mesh = o as THREE.Mesh; });
    expect(mesh).toBeDefined();
    const edges = mesh!.children.find(c => c.userData.isEdgeOverlay) as THREE.LineSegments;
    expect(edges).toBeDefined();
    expect(edges.geometry.morphAttributes.position.length).toBe(1);
    expect(edges.morphTargetInfluences).toBe(mesh!.morphTargetInfluences);

    // at the end of the clip the edges are as wide as the 30 wide box
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(1);
    expect(mesh!.morphTargetInfluences![0]).toBeCloseTo(1, 5);

    const position = edges.geometry.attributes.position;
    const delta = edges.geometry.morphAttributes.position[0];
    const xs = Array.from({ length: position.count }, (_, i) => position.getX(i) + delta.getX(i));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30, 4);
  });
});
