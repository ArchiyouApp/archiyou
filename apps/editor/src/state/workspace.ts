/**
 * state/workspace.ts — public barrel for the workspace state.
 *
 * The state is split into a small core plus per-feature substates:
 *   - types.ts        shared types + canonical ScriptParam re-export
 *   - core.ts         user, active script, all scripts, executing, result
 *   - editor.ts       editor UI + param/preset authoring (on core.script)
 *   - configurator.ts configurator runtime values + UI (derives from core)
 *   - configurator-url.ts  those values ⇄ the query string of a shared link
 *   - browser.ts      browser UI state (stub)
 *   - viewer.ts       viewer UI state (stub)
 *
 * Components keep importing from `state/workspace`; import from a specific
 * substate directly when you want to be explicit about the dependency.
 */

export * from './types';
export * from './core';
export * from './editor';
export * from './configurator';
export * from './configurator-url';
export * from './browser';
export * from './viewer';
export * from './units';
