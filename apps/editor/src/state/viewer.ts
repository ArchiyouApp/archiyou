/**
 * state/viewer.ts — 3D viewer UI state.
 *
 * Stub: the viewer keeps most of this state as component properties today
 * (view style, camera projection, AR, active animation). Signals are declared
 * here so the structure is in place; wiring is a follow-up.
 */

import { signal } from '@lit-labs/signals';

export const viewStyleId      = signal<string | null>(null);
export const cameraOrtho      = signal<boolean>(false);
export const arActive         = signal<boolean>(false);
export const activeAnimation  = signal<string | null>(null);

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
export function setActiveAnimation(name: string | null): void { activeAnimation.set(name); }
export function triggerResetCamera(): void { resetCameraCounter.set(resetCameraCounter.get() + 1); }

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
