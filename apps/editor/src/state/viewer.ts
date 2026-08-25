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
