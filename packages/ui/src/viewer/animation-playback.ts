/**
 * animation-playback.ts
 *
 * What the AnimationMixer cannot do while an Archiyou animation plays. Free functions over a
 * THREE tree, like instruct-playback.ts, so they can be tested without a canvas.
 *
 * Almost everything plays as glTF: poses as node channels, visibility as a STEP scale channel,
 * colour and opacity as KHR_animation_pointer tracks (gltf-animation-pointer.ts). What is left:
 *
 *  - DEPTH. A part that fades is a BLEND material, and GLTFLoader gives a BLEND material
 *    `depthWrite: false`: right while it is see-through, wrong once it is solid again, when
 *    parts behind it would show through. So while a clip plays, a faded material writes depth
 *    exactly when it is opaque. Toggling `transparent` itself would recompile the shader.
 *  - CHAPTERS, for a scrubber: which step of an instructable a time falls in.
 *  - BACK AND FORTH, with `action.time` the time in the clip both ways (setActionLoop).
 */

import * as THREE from 'three';

import type { AnimationLoopMode } from '@archiyou/editor/src/state/viewer';

/** A material's flags as loaded, to put back when the animation stops. */
export type FadeSnapshot = Map<THREE.Material, { depthWrite: boolean }>;

export interface AnimationChapter
{
  title: string;
  tStart: number;
  tEnd: number;
}

function materialsOf(objects: THREE.Object3D[]): THREE.Material[]
{
  return [...new Set(objects.flatMap(o =>
  {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    return m ? (Array.isArray(m) ? m : [m]) : [];
  }))];
}

/** Remember how the fading objects' materials write depth. */
export function captureFading(objects: THREE.Object3D[]): FadeSnapshot
{
  return new Map(materialsOf(objects).map(m => [m, { depthWrite: m.depthWrite }]));
}

/** Write depth where a faded material is solid. Call after the mixer has updated. */
export function updateFading(snapshot: FadeSnapshot): void
{
  snapshot.forEach((_, material) =>
  {
    if (material.transparent) material.depthWrite = material.opacity >= 0.999;
  });
}

/** Put the flags back as they were loaded. */
export function restoreFading(snapshot: FadeSnapshot): void
{
  snapshot.forEach((flags, material) => { material.depthWrite = flags.depthWrite; });
  snapshot.clear();
}

/** Play an action once (and hold), over and over, or back and forth.
 *
 *  Back and forth plays once in one direction and is turned round at each end (bounceAtEnd)
 *  rather than played with LoopPingPong: on the way back LoopPingPong keeps `action.time`
 *  counting up, the mirror of where the clip is. A player showing that time jumps back to the
 *  start at the turn while the model goes on, and a seek, a change of mode or carrying on
 *  after a run would put the model at the mirrored time. Once and over and over play forward. */
export function setActionLoop(action: THREE.AnimationAction, loop: AnimationLoopMode): void
{
  if (loop === 'loop') { action.setLoop(THREE.LoopRepeat, Infinity); action.clampWhenFinished = false; }
  else { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
  if (loop !== 'pingpong' && action.timeScale < 0) action.setEffectiveTimeScale(-action.timeScale);
}

/** At an end of back and forth, the mixer's `finished`: turn round and carry on. */
export function bounceAtEnd(action: THREE.AnimationAction): void
{
  action.setEffectiveTimeScale(-action.timeScale);
  action.paused = false;
  action.enabled = true;
}

/** The chapter a time falls in, or -1. A time on a boundary is the later chapter. */
export function chapterAt(chapters: AnimationChapter[] | undefined, t: number): number
{
  if (!chapters?.length) return -1;
  const index = chapters.findIndex((c, i) => t >= c.tStart && (t < c.tEnd || i === chapters.length - 1));
  return index;
}
