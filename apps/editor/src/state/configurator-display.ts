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
 *   ui.primary=1a659e              the colours of the site around it, as 6-digit hex (the #
 *   ui.secondary=180c2d            may stay or go): primary paints buttons, links and active
 *   ui.accent=f1c232               states, secondary the author mark and metric icons, accent
 *   ui.alert=dc2626                the slider thumb, tab indicator and preset buttons, alert
 *                                  errors; one not given keeps Archiyou's own (styles/brand-colors)
 *   ui.theme=light | dark          light or dark chrome, whatever the visitor's own preference
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

export type BrandColorName = 'primary' | 'secondary' | 'accent' | 'alert';
export const BRAND_COLOR_NAMES: BrandColorName[] = ['primary', 'secondary', 'accent', 'alert'];
/** The colours of the site around an embedded configurator, as `#rrggbb`; null: Archiyou's own. */
export type BrandColors = Record<BrandColorName, string | null>;
export type ChromeTheme = 'light' | 'dark';

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
  colors:     BrandColors;
  /** Light or dark chrome; null: the visitor's preference. */
  theme:      ChromeTheme | null;
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
  colors:    { primary: null, secondary: null, accent: null, alert: null },
  theme:     null,
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

/** `1a659e`, `#1a659e` or the short `#1a6` as `#rrggbb`; anything else is no colour. Only a hex
 *  colour gets through: the value becomes a CSS custom property, where nothing else belongs. */
export function hexColor(raw: string | null): string | null
{
  const m = raw?.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/** The colours a query string gives (`ui.primary=1a659e`), null for the ones it does not. */
function brandColors(query: URLSearchParams): BrandColors
{
  return BRAND_COLOR_NAMES.reduce(
    (colors, name) => ({ ...colors, [name]: hexColor(query.get(`ui.${name}`)) }),
    {} as BrandColors,
  );
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
  const theme = text('ui.theme');

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
    colors:    brandColors(query),
    theme:     (theme === 'light' || theme === 'dark') ? theme : null,
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
