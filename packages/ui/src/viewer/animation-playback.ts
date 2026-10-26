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
 */

import * as THREE from 'three';

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

/** The chapter a time falls in, or -1. A time on a boundary is the later chapter. */
export function chapterAt(chapters: AnimationChapter[] | undefined, t: number): number
{
  if (!chapters?.length) return -1;
  const index = chapters.findIndex((c, i) => t >= c.tStart && (t < c.tEnd || i === chapters.length - 1));
  return index;
}
