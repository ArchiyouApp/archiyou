import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

import type { HandleMinimized, HandleParamMap } from '@archiyou/core/src/interaction/types';

/** A serialized Handle as stored in GLB extras / execution result state. */
export interface HandleRawData
{
  id: string;
  type: 'handle';
  position: [number, number, number];
  icon: string;
  minimized?: HandleMinimized | null;
  visible: boolean;
  rangeType: '1d' | '2d';
  rangeMin: number | [number, number];
  rangeMax: number | [number, number];
  rangeRelative: boolean;
  plane: {
    origin: [number, number, number];
    uAxis:  [number, number, number];
    vAxis:  [number, number, number];
  };
  param: string | null;
  paramFnSrc: string | null;
  paramsFnSrc: string | null;
  paramMap: HandleParamMap | null;
}

/** The viewer-internal representation of a Handle, with Three.js vectors. */
export interface HandleDef
{
  id: string;
  anchorLocal: THREE.Vector3;   // position in model-group-local coords (Z-up world = identity)
  icon: string;
  minimized: HandleMinimized | null;
  visible: boolean;
  rangeType: '1d' | '2d';
  rangeMin: number | [number, number];
  rangeMax: number | [number, number];
  rangeRelative: boolean;
  plane: {
    origin: THREE.Vector3;
    uAxis:  THREE.Vector3;
    vAxis:  THREE.Vector3;
  };
  param: string | null;
  paramFnSrc: string | null;
  paramsFnSrc: string | null;
  /** Declarative drag-axis → property map. Plain data — no THREE conversion. */
  paramMap: HandleParamMap | null;
}

/**
 * Convert a single raw handle definition (from an 'add' op or GLB extras) into
 * the viewer-internal HandleDef with Three.js vectors.
 * World → viewer is identity (Z-up end-to-end).
 */
export function handleDefFromData(h: HandleRawData): HandleDef
{
  return {
    id:            h.id,
    anchorLocal:   new THREE.Vector3(h.position[0], h.position[1], h.position[2]),
    icon:          h.icon ?? 'move',
    minimized:     h.minimized ?? null,
    visible:       h.visible !== false,
    rangeType:     h.rangeType ?? '1d',
    rangeMin:      h.rangeMin,
    rangeMax:      h.rangeMax,
    rangeRelative: h.rangeRelative ?? false,
    plane: {
      origin: new THREE.Vector3(...h.plane.origin),
      uAxis:  new THREE.Vector3(...h.plane.uAxis),
      vAxis:  new THREE.Vector3(...h.plane.vAxis),
    },
    param:        h.param ?? null,
    paramFnSrc:   h.paramFnSrc ?? null,
    paramsFnSrc:  h.paramsFnSrc ?? null,
    paramMap:     h.paramMap ?? null,
  };
}

/**
 * Build HandleDef[] from GLB extras (static-GLB fallback when no live result).
 * For live execution results use the op-based reconciliation in model-viewer instead.
 */
export function buildHandles(
  gltf: GLTF,
  override?: HandleRawData[],
): HandleDef[]
{
  const raw: HandleRawData[] = override
    ?? (gltf.parser?.json?.extras?.state?.handles as HandleRawData[] | undefined)
    ?? [];

  return raw.map(handleDefFromData);
}
