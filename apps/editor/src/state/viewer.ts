/**
 * state/viewer.ts — 3D viewer UI state.
 *
 * The viewer keeps most of its state as component properties (view style, camera
 * projection, AR). What a tool drives — instruct steps, animation playback — goes through
 * signals here, so the controls can live in a tool without reaching for the viewer element.
 */

import { signal } from '@lit-labs/signals';

import type { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';

export const viewStyleId      = signal<string | null>(null);
export const cameraOrtho      = signal<boolean>(false);
export const arActive         = signal<boolean>(false);

/** Incremented each time the user opens a new script.
 *  model-viewer watches this and forces a camera re-frame on the next GLB load. */
export const resetCameraCounter = signal<number>(0);

//// INSTRUCT ////

/*  Step-by-step playback of an instructable. The viewer owns the API and the scene work; a
    tool drives it from here, so the controls can live wherever they read best without the
    tool having to reach across shadow roots for the viewer element. */

/** Which instructable is being stepped through, null when playback is off. */
export const instructName = signal<string | null>(null);
/** Which step, -1 when off. */
export const instructStep = signal<number>(-1);
/** What the viewer found in the current run — the tool renders its list off this. */
export const instructAvailable = signal<Array<{ name: string; title?: string; steps: number }>>([]);

export function setInstructStep(name: string | null, index: number): void
{
  instructName.set(name);
  instructStep.set(index);
}

export function clearInstructStep(): void
{
  instructName.set(null);
  instructStep.set(-1);
}

export function setInstructAvailable(list: Array<{ name: string; title?: string; steps: number }>): void
{
  instructAvailable.set(list);
}

export function setViewStyleId(id: string | null): void { viewStyleId.set(id); }
export function setCameraOrtho(ortho: boolean): void { cameraOrtho.set(ortho); }
export function setArActive(active: boolean): void { arActive.set(active); }
export function triggerResetCamera(): void { resetCameraCounter.set(resetCameraCounter.get() + 1); }

//// ANIMATIONS ////

/*  Playback of the animations in the GLB on screen. Like the instructables: the viewer owns
    the API and the scene work, a tool drives it. Commands go one way (tool → viewer) and
    status the other (viewer → tool), so neither side ever writes what it reads. */

export type AnimationLoopMode = 'none' | 'loop' | 'pingpong';

/** An animation the GLB on screen carries: its clip, and its data when Archiyou baked it. */
export interface BakedAnimation
{
  name: string;
  title?: string;
  /** Seconds. */
  duration: number;
  loop: AnimationLoopMode;
  chapters?: Array<{ title: string; tStart: number; tEnd: number }>;
  /** It carries a camera of its own, to follow. */
  camera: boolean;
}

export interface AnimationCommand
{
  seq: number;
  action: 'play' | 'pause' | 'resume' | 'stop' | 'seek' | 'options';
  name?: string;
  /** Seconds: where to seek to, or where to start playing. */
  t?: number;
  loop?: AnimationLoopMode;
  speed?: number;
  /** Look through the animation's own camera. */
  follow?: boolean;
}

export interface AnimationStatus
{
  /** The animation loaded into the mixer, null when none. */
  name: string | null;
  playing: boolean;
  /** Seconds. */
  time: number;
  duration: number;
  loop: AnimationLoopMode;
  speed: number;
  follow: boolean;
}

/** What the GLB on screen carries. The viewer writes it on every load. */
export const animationsBaked = signal<BakedAnimation[]>([]);
/** The last commands for the viewer, oldest first. A tool may send several in one go (play,
 *  then pause), before the viewer renders: it applies every one it has not applied yet. */
export const animationCommands = signal<AnimationCommand[]>([]);
/** How many are kept: more than a tool sends in one go. */
const COMMANDS_KEPT = 16;
/** What the viewer is doing. Written by the viewer, also every frame while one plays. */
export const animationStatus = signal<AnimationStatus>(
  { name: null, playing: false, time: 0, duration: 0, loop: 'none', speed: 1, follow: false });

export function sendAnimationCommand(command: Omit<AnimationCommand, 'seq'>): void
{
  const list = animationCommands.get();
  const seq = (list[list.length - 1]?.seq ?? 0) + 1;
  animationCommands.set([...list.slice(1 - COMMANDS_KEPT), { ...command, seq }]);
}

export function setAnimationsBaked(list: BakedAnimation[]): void { animationsBaked.set(list); }
export function setAnimationStatus(status: AnimationStatus): void { animationStatus.set(status); }

/** Callback registered by the editor (or any execution host) so that
 *  viewer-side interactions (e.g. handle drag-end) can trigger a
 *  re-execute without the editor being in the component tree. */
let _scheduleExecutionCb: (() => void) | null = null;

export function registerScheduleExecution(cb: () => void): void
{
  _scheduleExecutionCb = cb;
}

export function scheduleExecution(): void
{
  _scheduleExecutionCb?.();
}

/** Where viewer-side param edits (handle drags, dimension edits) read and write values.
 *  Without one they go to the editor's script params. The configurator keeps its
 *  end-user values apart from those, so it registers itself while mounted — otherwise
 *  an edit in its viewer lands in the editor's script and never reaches its own menu. */
export interface ViewerParamStore
{
  /** Current value of a param, as a handle map or dimension remap sees it. */
  value(param: ScriptParam): any;
  /** Store new values (by param name) and re-run once. */
  set(values: Record<string, any>): void;
}

let _paramStore: ViewerParamStore | null = null;

/** Returns the function that unregisters it again. */
export function registerViewerParamStore(store: ViewerParamStore): () => void
{
  _paramStore = store;
  return () =>
  {
    if (_paramStore === store) _paramStore = null;
  };
}

export function viewerParamStore(): ViewerParamStore | null
{
  return _paramStore;
}
