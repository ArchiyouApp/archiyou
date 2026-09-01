/**
 *  instruct-playback.ts
 *
 *  The scene work behind stepping through an instructable: show only the parts a step uses,
 *  ghost the ones it is not about, and slide its subject into place.
 *
 *  Free functions over a THREE tree and a path→object map, like gltf-annotations.ts and
 *  gltf-edge-extensions.ts next door — so model-viewer keeps the state and the lifecycle, and
 *  the decisions live somewhere they can be tested without a canvas.
 *
 *  ## Why the viewer does this at all
 *
 *  glTF animates translation, rotation, scale and weights, and nothing else. It cannot hide a
 *  part and it cannot recolour one, and the camera has to stay under the orbit controls. So
 *  the clip baked by GLTFBuilder.addInstruct() is for OTHER viewers — ones that can play an
 *  animation but know nothing about steps — and everything here is Archiyou's own reading of
 *  the same step data.
 */

import * as THREE from 'three';

/** Where one part goes when a step lays its parts out, as core resolves it: a rigid
 *  transform of the part about its own centre, `p' = rotation * (p - centre) + position`. */
export interface InstructPlacement
{
  path: string;
  position: number[];
  /** [x, y, z, w] */
  rotation: number[];
  centre: number[];
}

/** One label a step puts on screen: the part labels the manual is written in ('A', 'B'), and
 *  whatever the script wrote by hand. */
export interface InstructLabel
{
  position: number[];
  text: string;
  part?: string;
  paths?: string[];
  kind?: 'part' | 'custom';
  /** How to draw it, resolved by core so the page and the viewer agree. Mirrors LabelOptions
   *  (annotator/types.ts); typed here to what the overlay actually reads. */
  options?: {
    shape?: 'circle' | 'rect';
    target?: 'circle' | 'arrow' | 'none';
    labelOnly?: boolean;
    line?: boolean;
    length?: number;
    angle?: number;
    circle?: boolean;
    class?: string;
  };
}

/** One step, as core resolves it. Typed to what playback actually reads. */
export interface InstructStep
{
  index: number;
  number: number;
  title: string;
  tStart: number;
  tEnd: number;
  /** Scene paths of everything on screen this step. */
  visible: string[];
  /** Scene paths of what the step is about — a subset of `visible`. */
  subject: string[];
  uses: string[];
  camera?: { position: number[]; lookAt: number[]; projection: string };
  move?: { direction: number[]; distance: number; duration: number; interpolation: string; arrow: boolean };
  /** Set when the step asked for a `layout()`: where its parts go instead of where the
   *  finished model has them. */
  placements?: InstructPlacement[];
  labels?: InstructLabel[];
  note?: string;
  tools?: string[];
  hardware?: Array<{ name: string; quantity: number }>;
}

export interface InstructDoc
{
  name: string;
  title?: string;
  duration: number;
  parts: Array<{ label: string; group: string; name: string; kind: string;
                 section: string; length: number; quantity: number; paths: string[] }>;
  steps: InstructStep[];
}

/** Everything one step changed, and enough to put it all back. */
export interface InstructApplied
{
  hidden: THREE.Object3D[];
  ghosted: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** Objects a `layout()` moved, with the transform they had before it. */
  placed: Array<{ obj: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }>;
  move?: InstructMove;
}

export interface InstructMove
{
  items: Array<{ obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 }>;
  t: number;
  duration: number;
}

export interface InstructStepOptions
{
  /** Ghost the parts the step is not about. Default true. */
  ghost?: boolean;
  /** Opacity of a ghosted part. Default 0.22. */
  ghostOpacity?: number;
  /** Set the subject's approach position so it can slide in. Default true. */
  animate?: boolean;
}

/** True for an object that stands for a real part rather than a layer.
 *
 *  `shapeId` is stamped by model-viewer's _buildPathMap from the scenegraph's own `shape`
 *  field. It matters because hiding a LAYER would take everything under it with it — a step
 *  that shows one leg would blank the whole assembly. */
function isPart(obj: THREE.Object3D): boolean
{
  return obj.userData?.shapeId != null;
}

/** Show only the parts this step uses, ghost the rest, and park its subject ready to arrive.
 *
 *  Returns what it changed; pass that to clearInstructStep() to undo it exactly. Nothing here
 *  reads component state, so a caller that keeps several of these can unwind them in any order.
 */
export function applyInstructStep(
  step: InstructStep,
  pathToObject: Map<string, THREE.Object3D>,
  options?: InstructStepOptions,
): InstructApplied
{
  const applied: InstructApplied = { hidden: [], ghosted: new Map(), placed: [] };

  const shown = new Set(step.visible ?? []);
  const subject = new Set(step.subject ?? []);

  // 1. hide what the step does not use
  for (const [path, obj] of pathToObject)
  {
    if (!isPart(obj) || shown.has(path) || !obj.visible) continue;
    obj.visible = false;
    applied.hidden.push(obj);
  }

  // 2. ghost the work so far, so the new part reads against it
  if (options?.ghost !== false && subject.size > 0)
  {
    const opacity = options?.ghostOpacity ?? 0.22;

    for (const [path, obj] of pathToObject)
    {
      if (!isPart(obj) || !obj.visible || subject.has(path)) continue;

      obj.traverse(child =>
      {
        const mesh = child as THREE.Mesh;
        if (!(mesh as any).isMesh || mesh.userData?.isViewerHelper) return;
        if (applied.ghosted.has(mesh)) return;

        applied.ghosted.set(mesh, mesh.material);
        const ghost = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .map(m =>
          {
            const clone = m.clone();
            clone.transparent = true;
            clone.opacity = opacity;
            clone.depthWrite = false;
            return clone;
          });
        mesh.material = Array.isArray(mesh.material) ? ghost : ghost[0];
      });
    }
  }

  // 3. lay the parts out, when the step asked to see them laid out rather than assembled
  applyInstructLayout(step, pathToObject, applied);

  // 4. park the subject where it approaches from
  if (options?.animate !== false) { applied.move = startInstructMove(step, pathToObject) }

  return applied;
}

/** Put the step's parts where its `layout()` says, rather than where the finished model has
 *  them — the "here is what you need" step, seen in 3D.
 *
 *  The transform arrives as one about the part's own centre, because that is the only form
 *  both output paths can use: the node here (and the glTF node the exporter writes) sits at
 *  the origin with the geometry hanging off it at the part's centre, so the node's own
 *  transform is `rotation` and `position - rotation * centre`.
 *
 *  Records what it overwrote, like every other step change, so clearInstructStep() puts the
 *  model back exactly — nothing here touches the scene permanently.
 */
export function applyInstructLayout(
  step: InstructStep,
  pathToObject: Map<string, THREE.Object3D>,
  applied: InstructApplied,
): void
{
  const turned = new THREE.Quaternion();
  const centre = new THREE.Vector3();

  (step.placements ?? []).forEach(placement =>
  {
    const obj = pathToObject.get(placement.path);
    if (!obj) return;

    applied.placed.push({
      obj, position: obj.position.clone(), quaternion: obj.quaternion.clone(),
    });

    turned.set(placement.rotation[0], placement.rotation[1],
               placement.rotation[2], placement.rotation[3]);
    centre.set(placement.centre[0], placement.centre[1], placement.centre[2])
          .applyQuaternion(turned);

    obj.quaternion.copy(turned);
    obj.position.set(placement.position[0] - centre.x,
                     placement.position[1] - centre.y,
                     placement.position[2] - centre.z);
  });
}

/** Move the step's subject back along its approach direction, ready to slide in.
 *
 *  The same direction and distance GLTFBuilder.addInstruct() bakes into the exported clip, off
 *  the same step data — so the editor and a downloaded file cannot disagree about which way a
 *  part goes in. Returns undefined when the step has no motion. */
export function startInstructMove(
  step: InstructStep,
  pathToObject: Map<string, THREE.Object3D>,
): InstructMove | undefined
{
  const move = step.move;
  if (!move || !step.subject?.length) return undefined;

  const offset = new THREE.Vector3(move.direction[0], move.direction[1], move.direction[2])
    .multiplyScalar(move.distance);

  const items = step.subject
    .map(path => pathToObject.get(path))
    .filter((obj): obj is THREE.Object3D => !!obj)
    .map(obj =>
    {
      const to = obj.position.clone();
      const from = to.clone().sub(offset);
      obj.position.copy(from);
      return { obj, from, to };
    });

  if (!items.length) return undefined;
  return { items, t: 0, duration: Math.max(move.duration ?? 1, 0.01) };
}

/** Advance a move by `dt` seconds. Returns true while it is still running. */
export function advanceInstructMove(move: InstructMove, dt: number): boolean
{
  move.t = Math.min(move.t + dt / move.duration, 1);
  // ease-out, matching the camera tween's feel
  const k = move.t * move.t * (3 - 2 * move.t);

  for (const item of move.items) item.obj.position.lerpVectors(item.from, item.to, k);

  if (move.t >= 1)
  {
    for (const item of move.items) item.obj.position.copy(item.to);
    return false;
  }
  return true;
}

/** Put back everything a step changed: visibility, materials, and any part left mid-flight. */
export function clearInstructStep(applied: InstructApplied | null | undefined): void
{
  if (!applied) return;

  applied.move?.items.forEach(item => item.obj.position.copy(item.to));
  applied.move = undefined;

  /*  Layout last-in, first-out: a move parks a part relative to where the layout put it, so
      putting the layout back first would leave the move's destination behind. */
  applied.placed.forEach(({ obj, position, quaternion }) =>
  {
    obj.position.copy(position);
    obj.quaternion.copy(quaternion);
  });
  applied.placed = [];

  for (const obj of applied.hidden) obj.visible = true;
  applied.hidden = [];

  for (const [mesh, original] of applied.ghosted)
  {
    const current = mesh.material;
    (Array.isArray(current) ? current : [current]).forEach(m => m.dispose());
    mesh.material = original;
  }
  applied.ghosted.clear();
}

/** Where the camera goes for a step, in world coordinates.
 *
 *  `up` is +Z — the GLB carries the kernel's native Z-up — except when looking straight down
 *  it, where "up is +Z" means nothing and OrbitControls gimbal-locks. Undefined when the step
 *  named no camera. */
export function instructCamera(step: InstructStep):
  { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | undefined
{
  const cam = step.camera;
  if (!cam?.position || !cam?.lookAt) return undefined;

  const position = new THREE.Vector3(cam.position[0], cam.position[1], cam.position[2]);
  const target = new THREE.Vector3(cam.lookAt[0], cam.lookAt[1], cam.lookAt[2]);

  const dir = position.clone().sub(target).normalize();
  const up = (Math.abs(dir.z) > 0.999)
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  return { position, target, up };
}
