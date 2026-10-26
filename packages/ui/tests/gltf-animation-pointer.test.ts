import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as meshup from '@archiyou/meshup';

import { GLTFBuilder } from '@archiyou/core/src/GLTFBuilder';
import { animationPointerPlugin, finishPointerTracks, pointerDataOf, setPointerData, GLTFAnimationPointerPlugin } from '../src/viewer/gltf-animation-pointer.js';
import { captureFading, updateFading, restoreFading, chapterAt } from '../src/viewer/animation-playback.js';

/**
 *  The colour and opacity channels core bakes (KHR_animation_pointer), played by three.js
 *  through the loader plugin: a real GLB from GLTFBuilder, parsed by GLTFLoader.
 */

beforeAll(async () =>
{
  await meshup.init();
});

async function bakedGlb(): Promise<ArrayBuffer>
{
  const scene = meshup.SceneNode.root<meshup.SceneNode>('root');
  scene.addChild(meshup.SceneNode.from(meshup.Mesh.Box(10, 10, 10), 'fading'));
  scene.addChild(meshup.SceneNode.from(meshup.Mesh.Box(10, 10, 10).move(30, 0, 0), 'still'));

  const glb = await new GLTFBuilder(await scene.toGLB()).addAnimationData({
    name: 'fade', duration: 2, loop: 'none',
    tracks: [{
      path: 'Scene/fading',
      opacity: [{ t: 0, value: 0, easing: 'linear' }, { t: 2, value: 1, easing: 'linear' }],
      color: [{ t: 0, value: '#2060c0', easing: 'linear' }, { t: 2, value: null, easing: 'linear' }],
      pose: [{ t: 0, position: [0, 0, 50], easing: 'linear' }, { t: 2, easing: 'linear' }],
    }],
  }).then(b => b.toGLB());

  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
}

function parse(data: ArrayBuffer, plugin = true): Promise<GLTF>
{
  const loader = new GLTFLoader();
  if (plugin) loader.register(animationPointerPlugin);
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

describe('KHR_animation_pointer in three.js', () =>
{
  it('without the plugin the file loads and only the colour stays still', async () =>
  {
    const gltf = await parse(await bakedGlb(), false);
    const [clip] = gltf.animations;
    expect(clip.tracks.map(t => t.name.split('.').pop())).toEqual(['position']);
  });

  it('with it, the faces of the faded part get colour and opacity tracks, and nothing else does', async () =>
  {
    const gltf = await parse(await bakedGlb());
    const [clip] = gltf.animations;

    const material = clip.tracks.filter(t => /\.material\.(color|opacity)$/.test(t.name));
    expect(material.length).toBe(2);

    const target = gltf.scene.getObjectByProperty('uuid', material[0].name.split('.')[0]) as THREE.Mesh;
    expect(target?.isMesh).toBe(true);
    expect(target.parent?.name === 'fading' || target.name.startsWith('fading')).toBe(true);
    expect(pointerDataOf(clip)?.fading).toContain(target);
    expect(clip.duration).toBeCloseTo(2, 5);
  });

  it('plays: invisible and blue at the start, as modelled at the end, restored when it stops', async () =>
  {
    const gltf = await parse(await bakedGlb());
    const [clip] = gltf.animations;
    finishPointerTracks(gltf.scene, gltf.animations);

    const target = gltf.scene.getObjectByProperty('uuid', clip.tracks.find(t => t.name.endsWith('.material.opacity'))!.name.split('.')[0]) as THREE.Mesh;
    const material = target.material as THREE.MeshStandardMaterial;
    const own = material.color.clone();

    const mixer = new THREE.AnimationMixer(gltf.scene);
    // once and hold, as the viewer plays 'none': the default loop wraps at the end, back to 0
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    mixer.setTime(0);
    expect(material.opacity).toBeCloseTo(0, 5);
    expect(material.color.r).toBeCloseTo(Math.pow((0x20 / 255 + 0.055) / 1.055, 2.4), 3);

    const fade = captureFading([target]);
    updateFading(fade);
    expect(material.depthWrite).toBe(false);   // see-through: no depth

    mixer.setTime(1.999);
    updateFading(fade);
    expect(material.opacity).toBeGreaterThan(0.99);

    mixer.setTime(2);
    updateFading(fade);
    expect(material.depthWrite).toBe(true);    // solid again: writes depth

    mixer.stopAllAction();
    restoreFading(fade);
    expect(material.depthWrite).toBe(true);    // at rest: solid, as finishPointerTracks() left it
    expect(material.color.equals(own)).toBe(true);
  });

  it('leaves a clip without pointer channels to the loader', () =>
  {
    const parser = { json: { animations: [{ channels: [{ target: { node: 0, path: 'translation' } }], samplers: [] }] } };
    expect(new GLTFAnimationPointerPlugin(parser as never).loadAnimation(0)).toBeNull();
  });

  it('follows a line the edge styling swapped for a fat one', () =>
  {
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const fat = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    line.userData.replacedBy = fat;

    const clip = new THREE.AnimationClip('x', -1, [
      new THREE.NumberKeyframeTrack(`${line.uuid}.material.opacity`, [0, 1], [0, 1]),
    ]);
    setPointerData(clip, { fading: [line], edgeFades: [] });

    finishPointerTracks(new THREE.Group(), [clip]);
    expect(clip.tracks[0].name).toBe(`${fat.uuid}.material.opacity`);
    expect(pointerDataOf(clip)?.fading).toEqual([fat]);
  });
});

describe('chapters', () =>
{
  const chapters = [{ title: 'a', tStart: 0, tEnd: 1 }, { title: 'b', tStart: 1, tEnd: 2 }];

  it('finds the chapter a time is in, the later one on a boundary', () =>
  {
    expect(chapterAt(chapters, 0.5)).toBe(0);
    expect(chapterAt(chapters, 1)).toBe(1);
    expect(chapterAt(chapters, 2)).toBe(1);
    expect(chapterAt([], 1)).toBe(-1);
  });
});
