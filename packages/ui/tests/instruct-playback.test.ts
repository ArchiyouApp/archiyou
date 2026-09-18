import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import {
  applyInstructStep, clearInstructStep, startInstructMove,
  advanceInstructMove, instructCamera,
} from '../src/viewer/instruct-playback.js';
import type { InstructStep } from '../src/viewer/instruct-playback.js';

/**
 * Stepping through an instructable in the viewer.
 *
 * glTF animates translation/rotation/scale and nothing else — it cannot hide a part or
 * recolour one — so hiding, ghosting and framing are the viewer's own work off the step data.
 * These cover that work on a plain THREE tree, no canvas involved.
 */

/** A scene shaped like the one model-viewer builds: layer nodes holding part nodes, each part
 *  node holding its mesh. `shapeId` is what tells a part from a layer. */
function scene(): { root: THREE.Object3D; paths: Map<string, THREE.Object3D> }
{
  const root = new THREE.Object3D();
  const paths = new Map<string, THREE.Object3D>();
  paths.set('Scene', root);

  const addLayer = (name: string) =>
  {
    const layer = new THREE.Object3D();
    layer.name = name;
    root.add(layer);
    paths.set(`Scene/${name}`, layer);      // no shapeId: a layer, not a part
    return layer;
  };

  const addPart = (layer: THREE.Object3D, layerName: string, name: string, at: number[]) =>
  {
    const part = new THREE.Object3D();
    part.name = name;
    part.userData.shapeId = `${layerName}-${name}`;
    part.position.set(at[0], at[1], at[2]);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    );
    part.add(mesh);
    layer.add(part);
    paths.set(`Scene/${layerName}/${name}`, part);
    return part;
  };

  const legs = addLayer('legs');
  addPart(legs, 'legs', 'leg%5B0%5D', [0, 0, 0]);
  addPart(legs, 'legs', 'leg%5B1%5D', [10, 0, 0]);

  const top = addLayer('top');
  addPart(top, 'top', 'panel', [5, 0, 7]);

  return { root, paths };
}

const step = (over: Partial<InstructStep> = {}): InstructStep => ({
  index: 0, number: 1, title: 'a step', tStart: 0, tEnd: 1,
  visible: [], subject: [], uses: [], ...over,
});

const meshesOf = (obj: THREE.Object3D) =>
{
  const out: THREE.Mesh[] = [];
  obj.traverse(o => { if ((o as any).isMesh) out.push(o as THREE.Mesh) });
  return out;
};

describe('visibility', () =>
{
  it('hides every part the step does not use', () =>
  {
    const { paths } = scene();
    applyInstructStep(step({ visible: ['Scene/legs/leg%5B0%5D'] }), paths);

    expect(paths.get('Scene/legs/leg%5B0%5D')!.visible).toBe(true);
    expect(paths.get('Scene/legs/leg%5B1%5D')!.visible).toBe(false);
    expect(paths.get('Scene/top/panel')!.visible).toBe(false);
  });

  it('never hides a layer, which would take its children with it', () =>
  {
    const { paths } = scene();
    applyInstructStep(step({ visible: ['Scene/legs/leg%5B0%5D'] }), paths);

    expect(paths.get('Scene/legs')!.visible).toBe(true);
    expect(paths.get('Scene')!.visible).toBe(true);
  });

  it('puts everything back on clear', () =>
  {
    const { paths } = scene();
    const applied = applyInstructStep(step({ visible: ['Scene/top/panel'] }), paths);
    clearInstructStep(applied);

    for (const obj of paths.values()) expect(obj.visible).toBe(true);
  });
});

describe('ghosting', () =>
{
  const twoParts = () => step({
    visible: ['Scene/legs/leg%5B0%5D', 'Scene/top/panel'],
    subject: ['Scene/top/panel'],
  });

  it('fades the context but not the subject', () =>
  {
    const { paths } = scene();
    applyInstructStep(twoParts(), paths);

    const contextMat = meshesOf(paths.get('Scene/legs/leg%5B0%5D')!)[0].material as THREE.Material;
    const subjectMat = meshesOf(paths.get('Scene/top/panel')!)[0].material as THREE.Material;

    expect(contextMat.transparent).toBe(true);
    expect(contextMat.opacity).toBeCloseTo(0.22, 4);
    expect(subjectMat.transparent).toBe(false);
  });

  it('does not touch a hidden part', () =>
  {
    const { paths } = scene();
    const applied = applyInstructStep(twoParts(), paths);

    // leg[1] is not in `visible`, so it is hidden and never ghosted
    expect(applied.ghosted.has(meshesOf(paths.get('Scene/legs/leg%5B1%5D')!)[0])).toBe(false);
  });

  it('restores the exact original material object, not a copy', () =>
  {
    const { paths } = scene();
    const mesh = meshesOf(paths.get('Scene/legs/leg%5B0%5D')!)[0];
    const original = mesh.material;

    const applied = applyInstructStep(twoParts(), paths);
    expect(mesh.material).not.toBe(original);

    clearInstructStep(applied);
    expect(mesh.material).toBe(original);
    expect((mesh.material as THREE.Material).transparent).toBe(false);
  });

  it('leaves everything solid when the step names no subject', () =>
  {
    const { paths } = scene();
    const applied = applyInstructStep(
      step({ visible: ['Scene/legs/leg%5B0%5D', 'Scene/top/panel'] }), paths);

    expect(applied.ghosted.size).toBe(0);
  });

  it('can be turned off', () =>
  {
    const { paths } = scene();
    const applied = applyInstructStep(twoParts(), paths, { ghost: false });
    expect(applied.ghosted.size).toBe(0);
  });
});

describe('motion', () =>
{
  const arriving = () => step({
    visible: ['Scene/top/panel'],
    subject: ['Scene/top/panel'],
    move: { direction: [0, 0, -1], distance: 20, duration: 1, interpolation: 'easeInOut', arrow: true },
  });

  it('parks the subject at its approach position', () =>
  {
    const { paths } = scene();
    const panel = paths.get('Scene/top/panel')!;

    applyInstructStep(arriving(), paths);
    // comes down from above: 20 back along [0,0,-1] is 20 higher
    expect(panel.position.z).toBeCloseTo(27, 4);
  });

  it('slides it home over the step duration', () =>
  {
    const { paths } = scene();
    const panel = paths.get('Scene/top/panel')!;
    const applied = applyInstructStep(arriving(), paths);

    expect(advanceInstructMove(applied.move!, 0.5)).toBe(true);
    expect(panel.position.z).toBeLessThan(27);
    expect(panel.position.z).toBeGreaterThan(7);

    expect(advanceInstructMove(applied.move!, 0.5)).toBe(false);   // done
    expect(panel.position.z).toBeCloseTo(7, 6);                    // exactly home
  });

  it('snaps home when a step is abandoned mid-flight', () =>
  {
    const { paths } = scene();
    const panel = paths.get('Scene/top/panel')!;
    const applied = applyInstructStep(arriving(), paths);

    advanceInstructMove(applied.move!, 0.3);
    clearInstructStep(applied);

    expect(panel.position.z).toBeCloseTo(7, 6);
  });

  it('is absent for a step that does not move anything', () =>
  {
    const { paths } = scene();
    expect(startInstructMove(step({ subject: ['Scene/top/panel'] }), paths)).toBeUndefined();
  });

  it('is absent when the subject is not in the model', () =>
  {
    const { paths } = scene();
    const orphan = { ...arriving(), subject: ['Scene/gone'] };
    expect(startInstructMove(orphan, paths)).toBeUndefined();
  });
});

describe('camera', () =>
{
  it('reads the step position and target, and stands up in Z', () =>
  {
    const view = instructCamera(step({
      camera: { position: [100, -100, 80], lookAt: [0, 0, 10], projection: 'orthographic' },
    }))!;

    expect(view.position.toArray()).toEqual([100, -100, 80]);
    expect(view.target.toArray()).toEqual([0, 0, 10]);
    expect(view.up.toArray()).toEqual([0, 0, 1]);
  });

  it('picks another up vector when looking straight down, where +Z means nothing', () =>
  {
    const view = instructCamera(step({
      camera: { position: [0, 0, 500], lookAt: [0, 0, 0], projection: 'orthographic' },
    }))!;

    // +Z up here is parallel to the view direction: OrbitControls gimbal-locks on it
    expect(view.up.toArray()).toEqual([0, 1, 0]);
  });

  it('is undefined for a step with no camera', () =>
  {
    expect(instructCamera(step())).toBeUndefined();
  });
});

describe('layout', () =>
{
  /** A leg turned onto its side and moved out into a row. */
  const placement = {
    path: 'Scene/legs/leg%5B0%5D',
    position: [50, 0, 0],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],   // quarter turn about Y
    centre: [0, 0, 0],
  };

  it('puts the parts where the step lays them out, not where the model has them', () =>
  {
    /*  layout() reached the printed drawings and stopped there: the "here is what you need"
        step showed the finished model in the viewer. */
    const { paths } = scene();
    const leg = paths.get('Scene/legs/leg%5B0%5D')!;

    applyInstructStep(step({ visible: ['Scene/legs/leg%5B0%5D'], placements: [placement] }), paths);

    expect(leg.position.toArray()).toEqual([50, 0, 0]);
    expect(leg.quaternion.y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('turns a part about its OWN centre, not about the world origin', () =>
  {
    const { paths } = scene();
    const panel = paths.get('Scene/top/panel')!;

    // the panel is at [5,0,7]; laid flat where it stands, its centre must not move
    applyInstructStep(step({
      visible: ['Scene/top/panel'],
      placements: [{ path: 'Scene/top/panel', position: [5, 0, 7],
                     rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], centre: [5, 0, 7] }],
    }), paths);

    const centre = new THREE.Vector3(5, 0, 7)
      .applyQuaternion(panel.quaternion).add(panel.position);
    expect(centre.toArray().map(v => +v.toFixed(6))).toEqual([5, 0, 7]);
  });

  it('leaves a part the step does not place alone', () =>
  {
    const { paths } = scene();
    const other = paths.get('Scene/legs/leg%5B1%5D')!;

    applyInstructStep(step({
      visible: ['Scene/legs/leg%5B0%5D', 'Scene/legs/leg%5B1%5D'],
      placements: [placement],
    }), paths);

    expect(other.position.toArray()).toEqual([10, 0, 0]);
  });

  it('puts it all back on clear', () =>
  {
    const { paths } = scene();
    const leg = paths.get('Scene/legs/leg%5B0%5D')!;

    const applied = applyInstructStep(
      step({ visible: ['Scene/legs/leg%5B0%5D'], placements: [placement] }), paths);
    clearInstructStep(applied);

    expect(leg.position.toArray()).toEqual([0, 0, 0]);
    expect(leg.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it('does nothing for a step that asked for no layout', () =>
  {
    const { paths } = scene();
    const applied = applyInstructStep(step({ visible: ['Scene/legs/leg%5B0%5D'] }), paths);
    expect(applied.placed).toHaveLength(0);
  });
});

describe('a whole step, applied and undone', () =>
{
  it('leaves the scene exactly as it found it', () =>
  {
    const { paths } = scene();
    const before = [...paths.entries()].map(([path, obj]) => ({
      path,
      visible: obj.visible,
      position: obj.position.toArray(),
      quaternion: obj.quaternion.toArray(),
      materials: meshesOf(obj).map(m => m.material),
    }));

    const applied = applyInstructStep(step({
      visible: ['Scene/legs/leg%5B0%5D', 'Scene/top/panel'],
      subject: ['Scene/top/panel'],
      move: { direction: [0, 0, -1], distance: 20, duration: 1, interpolation: 'easeInOut', arrow: true },
      placements: [{ path: 'Scene/legs/leg%5B0%5D', position: [50, 0, 0],
                     rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], centre: [0, 0, 0] }],
      camera: { position: [10, -10, 10], lookAt: [0, 0, 0], projection: 'orthographic' },
    }), paths);

    advanceInstructMove(applied.move!, 0.4);
    clearInstructStep(applied);

    before.forEach(snap =>
    {
      const obj = paths.get(snap.path)!;
      expect(obj.visible).toBe(snap.visible);
      obj.position.toArray().forEach((v, i) => expect(v).toBeCloseTo(snap.position[i], 6));
      obj.quaternion.toArray().forEach((v, i) => expect(v).toBeCloseTo(snap.quaternion[i], 6));
      meshesOf(obj).forEach((m, i) => expect(m.material).toBe(snap.materials[i]));
    });
  });
});
