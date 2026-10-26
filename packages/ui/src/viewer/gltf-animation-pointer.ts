/**
 * gltf-animation-pointer.ts
 *
 * KHR_animation_pointer for three.js, which (r171) does not read it: a GLTFLoader plugin that
 * turns the colour and opacity channels Archiyou bakes (GLTFBuilder._bakeStyle in core) into
 * tracks three.js plays natively.
 *
 * Such a channel animates `/materials/{i}/pbrMetallicRoughness/baseColorFactor`: RGB and
 * alpha in one VEC4, and no target node. GLTFLoader skips every channel without a node, so a
 * file with them loads anywhere and only the colour stays still. This plugin takes the
 * loader's own clip and adds, for every object drawn with material `i`:
 *
 *   - a ColorKeyframeTrack  `<object>.material.color`   (linear RGB, as material.color holds it)
 *   - a NumberKeyframeTrack `<object>.material.opacity` (alpha)
 *
 * From there the AnimationMixer does the rest: seeking, looping, and putting colour and
 * opacity back as they were when the action stops (PropertyBinding.restoreOriginalState).
 *
 * Two things the mixer cannot do are left to animation-playback.ts and finishPointerTracks():
 * depth writing while a part fades (pointerDataOf(clip).fading), and the CAD edge lines, which
 * are made after loading from the edge material.
 *
 * A clip without pointer channels is left to the loader entirely: `loadAnimation()` returns
 * null and nothing here runs.
 */

import * as THREE from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const KHR_ANIMATION_POINTER = 'KHR_animation_pointer';

const BASE_COLOR_POINTER = /^\/materials\/(\d+)\/pbrMetallicRoughness\/baseColorFactor$/;

/** An edge material's fade, to bind once the edge lines exist (see finishPointerTracks). */
export interface EdgeFade
{
  material: number;
  times: Float32Array;
  opacity: Float32Array;
  interpolation: THREE.InterpolationModes;
}

/** What the plugin knows about a clip it extended. */
export interface PointerClipData
{
  /** Objects whose material colour or opacity the clip animates. */
  fading: THREE.Object3D[];
  edgeFades: EdgeFade[];
}

/** Kept beside the clip rather than on it: AnimationClip has no userData in r171. */
const clipData = new WeakMap<THREE.AnimationClip, PointerClipData>();

export class GLTFAnimationPointerPlugin implements GLTFLoaderPlugin
{
  readonly name = KHR_ANIMATION_POINTER;

  constructor(private readonly parser: GLTFParser) {}

  loadAnimation(animationIndex: number): Promise<THREE.AnimationClip> | null
  {
    const def = (this.parser.json as any).animations?.[animationIndex];
    const pointers = (def?.channels ?? []).filter((c: any) => typeof c?.target?.extensions?.[KHR_ANIMATION_POINTER]?.pointer === 'string');
    if (!pointers.length) return null;

    return this._load(animationIndex, def, pointers);
  }

  private async _load(animationIndex: number, def: any, pointers: any[]): Promise<THREE.AnimationClip>
  {
    // The loader's own clip, for the channels it knows: it skips the ones without a node.
    // Called on the parser directly, so it does not come back here.
    const clip = await (this.parser as any).loadAnimation(animationIndex) as THREE.AnimationClip;

    const data: PointerClipData = { fading: [], edgeFades: [] };
    const tracks: THREE.KeyframeTrack[] = [];

    for (const channel of pointers)
    {
      const match = String(channel.target.extensions[KHR_ANIMATION_POINTER].pointer).match(BASE_COLOR_POINTER);
      if (!match) continue; // a pointer at something else: not ours to play

      const material = parseInt(match[1], 10);
      const sampler = def.samplers?.[channel.sampler];
      if (!sampler) continue;

      const [input, output] = await Promise.all([
        this.parser.getDependency('accessor', sampler.input),
        this.parser.getDependency('accessor', sampler.output),
      ]);

      const times = input.array as Float32Array;
      const values = (this.parser as any)._getArrayFromAccessor(output) as Float32Array;
      const interpolation = (sampler.interpolation === 'STEP') ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      const { rgb, alpha } = splitRgba(values);

      const objects = await this._objectsDrawnWith(material);
      objects.forEach(object =>
      {
        tracks.push(new THREE.ColorKeyframeTrack(`${object.uuid}.material.color`, times, rgb, interpolation));
        tracks.push(new THREE.NumberKeyframeTrack(`${object.uuid}.material.opacity`, times, alpha, interpolation));
        data.fading.push(object);
      });

      // a material the faces do not use is an edge material, or nothing: try it on the edges
      if (!objects.length)
      {
        data.edgeFades.push({ material, times, opacity: alpha, interpolation });
      }
    }

    const extended = new THREE.AnimationClip(clip.name, -1, [...clip.tracks, ...tracks]);
    setPointerData(extended, data);
    return extended;
  }

  /** The meshes, lines and points drawn with material `index`, as three.js objects. */
  private async _objectsDrawnWith(index: number): Promise<THREE.Object3D[]>
  {
    const json = this.parser.json as any;
    const found = new Set<THREE.Object3D>();

    const nodes = (json.nodes ?? [])
      .map((node: any, n: number) => ({ node, n }))
      .filter(({ node }: any) => node.mesh !== undefined
        && (json.meshes?.[node.mesh]?.primitives ?? []).some((p: any) => p.material === index));

    for (const { node, n } of nodes)
    {
      const object = await this.parser.getDependency('node', n) as THREE.Object3D;
      const primitives: any[] = json.meshes[node.mesh].primitives;

      object.traverse(child =>
      {
        const association = this.parser.associations.get(child) as { meshes?: number, primitives?: number } | undefined;
        if (!association || association.meshes !== node.mesh || association.primitives === undefined) return;
        if (primitives[association.primitives]?.material === index) found.add(child);
      });
    }

    return [...found];
  }
}

/** The plugin, in the form GLTFLoader.register() takes. */
export function animationPointerPlugin(parser: GLTFParser): GLTFAnimationPointerPlugin
{
  return new GLTFAnimationPointerPlugin(parser);
}

/** What this module knows about a clip, if anything. */
export function pointerDataOf(clip: THREE.AnimationClip): PointerClipData | undefined
{
  return clipData.get(clip);
}

/** Record what a clip fades: the plugin does for the clips it makes, anything that builds clips
 *  with material tracks itself can too. */
export function setPointerData(clip: THREE.AnimationClip, data: PointerClipData): void
{
  clipData.set(clip, data);
}

/** Finish the pointer tracks once the model is built: applyEdgeExtensions() makes the CAD
 *  edge lines after loading, and swaps a curve drawn wider than a hairline for a fat line.
 *
 *  - a track bound to a line that was swapped follows it to its replacement;
 *  - under every mesh whose edges are drawn with a faded edge material, the edge overlay
 *    fades too. Lines get their own material per mesh, so each is bound on its own.
 *
 *  Call before the clips are first played: the mixer binds tracks when an action is made. */
export function finishPointerTracks(model: THREE.Object3D, clips: THREE.AnimationClip[]): void
{
  const extended = clips.filter(c => pointerDataOf(c));
  if (!extended.length) return;

  extended.forEach(clip =>
  {
    const data = pointerDataOf(clip)!;
    data.fading = data.fading.map(object =>
    {
      const replacement = object.userData?.replacedBy as THREE.Object3D | undefined;
      if (!replacement) return object;
      clip.tracks.forEach(track =>
      {
        if (track.name.startsWith(`${object.uuid}.`)) track.name = replacement.uuid + track.name.slice(object.uuid.length);
      });
      return replacement;
    });

    /*  A part that can fade is a BLEND material in the file, and GLTFLoader gives every BLEND
        material `depthWrite: false`. At rest such a part is as solid as the model has it, so it
        writes depth like any solid part; animation-playback.ts turns that off while it fades. */
    data.fading.forEach(object =>
    {
      const m = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(m) ? m : m ? [m] : []).forEach(material =>
      {
        if (material.transparent && material.opacity >= 0.999) material.depthWrite = true;
      });
    });
  });

  const withEdgeFades = extended.filter(c => pointerDataOf(c)!.edgeFades.length);
  if (!withEdgeFades.length) return;

  model.traverse(object =>
  {
    const ext = object.userData?.gltfExtensions?.['EXT_mesh_primitive_edge_visibility'];
    if (ext?.material === undefined) return;

    const lines = object.children.filter(c => c.userData?.isEdgeOverlay);
    withEdgeFades.forEach(clip =>
    {
      const data = pointerDataOf(clip)!;
      data.edgeFades.filter(f => f.material === ext.material).forEach(fade =>
      {
        lines.forEach(line =>
        {
          const material = (line as THREE.Line).material as THREE.Material;
          if (material) material.transparent = true;
          clip.tracks.push(new THREE.NumberKeyframeTrack(`${line.uuid}.material.opacity`, fade.times, fade.opacity, fade.interpolation));
          data.fading.push(line);
        });
      });
    });
  });

  withEdgeFades.forEach(clip => clip.resetDuration());
}

function splitRgba(values: Float32Array): { rgb: Float32Array, alpha: Float32Array }
{
  const count = Math.floor(values.length / 4);
  const rgb = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  Array.from({ length: count }, (_, i) => i).forEach(i =>
  {
    rgb[i * 3] = values[i * 4];
    rgb[i * 3 + 1] = values[i * 4 + 1];
    rgb[i * 3 + 2] = values[i * 4 + 2];
    alpha[i] = values[i * 4 + 3];
  });
  return { rgb, alpha };
}
