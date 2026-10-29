/**
 * state/configurator-display.ts — how a published configurator presents itself, set by
 * the link that opens it.
 *
 * A site that embeds a configurator decides what its visitors see around the model:
 *
 *     /configurators/urbuild/urhouse:1.2?embed=1&ui.header=0&ui.style=techdraw&ui.menu=top
 *
 *   ui.header=0                    no title and description above the parameters
 *   ui.metrics=0                   no metric cards (the Download button stays)
 *   ui.project=0                   no "Save as project" button
 *   ui.style=xray                  the view style it opens in
 *   ui.styles=realistic,techdraw   the view styles the viewer menu offers
 *   ui.projection=ortho            opens isometric (orthographic) instead of in perspective
 *   ui.grid=0 | ui.grid=1          grid hidden or shown, whatever the style's default
 *   ui.menu=bottom|top|left|right|none   where the viewer menu sits, or no menu
 *   ui.animation=flyin             plays that animation once the model is shown: one the
 *                                  script declares, or a standard one (flyin, build,
 *                                  exploded, layout, turntable, assembly)
 *   ui.loop=1 | 0 | pingpong       over and over, once, or back and forth; without it the
 *                                  animation's own
 *
 * The `ui.` prefix keeps these apart from the script's params: a param name is a script
 * identifier and can never contain a dot, so `?GRID=600` stays the GRID param of a script
 * that has one. Anything unreadable is ignored: the configurator opens as it always does.
 *
 * `?preset=Large` applies a preset before the params of the link (so `?preset=Large&WIDTH=900`
 * is that preset at 900 wide), unless the script has a param called PRESET: then it is that
 * param, as it was before presets could be linked.
 */

import { signal } from '@lit-labs/signals';

import type { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import type { AnimationLoopMode } from './viewer.js';

export type ViewerMenuPlacement = 'bottom' | 'top' | 'left' | 'right' | 'none';

export interface ConfiguratorDisplay
{
  header:     boolean;
  metrics:    boolean;
  /** The "Save as project" button over the viewer. */
  project:    boolean;
  /** View style id to open in; null: the viewer's default. Unknown ids are ignored by the viewer. */
  style:      string | null;
  /** View style ids the menu offers; null: all of them. */
  styles:     string[] | null;
  ortho:      boolean;
  /** Grid visibility; null: what the view style says. */
  grid:       boolean | null;
  menu:       ViewerMenuPlacement;
  /** The animation to play once the model is shown; null: none. */
  animation:  string | null;
  /** How it plays; null: as the animation says. */
  loop:       AnimationLoopMode | null;
}

export const DEFAULT_DISPLAY: ConfiguratorDisplay = {
  header:  true,
  metrics: true,
  project: true,
  style:   null,
  styles:  null,
  ortho:   false,
  grid:    null,
  menu:    'bottom',
  animation: null,
  loop:      null,
};

const MENU_PLACEMENTS: ViewerMenuPlacement[] = ['bottom', 'top', 'left', 'right', 'none'];

/** A name an animation can have, as the animator has it (animator/code.ts, isAnimationName). */
export function isAnimationName(name: string): boolean
{
  return /^[\p{L}\p{N}_-]+$/u.test(name);
}

/** `ui.loop`: 1/loop over and over, 0/once once, pingpong back and forth; anything else is no
 *  answer. */
function loopMode(raw: string | null): AnimationLoopMode | null
{
  const v = raw?.trim().toLowerCase();
  if (v === 'pingpong' || v === 'backandforth') return 'pingpong';
  if (v === 'once' || v === 'none') return 'none';
  if (v === 'loop' || v === 'repeat') return 'loop';
  const on = flag(raw ?? null);
  return (on === null) ? null : (on ? 'loop' : 'none');
}

/** The configurator as the link that opened it asks for. Always the defaults in the editor's
 *  Configurator Preview, which nothing sets. */
export const configuratorDisplay = signal<ConfiguratorDisplay>(DEFAULT_DISPLAY);

/** `1/true/yes/on` and `0/false/no/off`; anything else is no answer. */
function flag(raw: string | null): boolean | null
{
  const v = raw?.trim().toLowerCase();
  if (v === undefined) return null;
  if (['1', 'true', 'yes', 'on', 'show'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'hide'].includes(v)) return false;
  return null;
}

/** The display options of a query string; what it does not say (or says unreadably) stays
 *  the default. */
export function displayFromQuery(search: string): ConfiguratorDisplay
{
  const query = new URLSearchParams(search);
  const text = (key: string) => query.get(key)?.trim().toLowerCase() || null;

  const styles = text('ui.styles')?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const menu = text('ui.menu') as ViewerMenuPlacement | null;
  // as written: an animation's name is the script's, and can have capitals
  const animation = query.get('ui.animation')?.trim() || null;

  return {
    header:  flag(query.get('ui.header')) ?? DEFAULT_DISPLAY.header,
    metrics: flag(query.get('ui.metrics')) ?? DEFAULT_DISPLAY.metrics,
    project: flag(query.get('ui.project')) ?? DEFAULT_DISPLAY.project,
    style:   text('ui.style'),
    styles:  styles.length > 0 ? styles : null,
    ortho:   ['ortho', 'orthographic', 'iso', 'isometric'].includes(text('ui.projection') ?? ''),
    grid:    flag(query.get('ui.grid')),
    menu:    (menu && MENU_PLACEMENTS.includes(menu)) ? menu : DEFAULT_DISPLAY.menu,
    animation: (animation && isAnimationName(animation)) ? animation : null,
    loop:      loopMode(query.get('ui.loop')),
  };
}

/** Set the configurator's display from the link it was opened with. */
export function applyDisplayFromQuery(search: string): void
{
  configuratorDisplay.set(displayFromQuery(search));
}

/** Back to showing everything, for whatever opens the configurator next. */
export function resetDisplay(): void
{
  configuratorDisplay.set(DEFAULT_DISPLAY);
}

/** The preset a query string names (`?preset=Large`), or null. Null too when the script has
 *  a param called PRESET: the key is that param's. */
export function presetFromQuery(search: string, params: Array<ScriptParam>): string | null
{
  if (params.some(p => p.name.toUpperCase() === 'PRESET')) return null;
  return new URLSearchParams(search).get('preset')?.trim() || null;
}
