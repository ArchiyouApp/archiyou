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
 *   ui.style=xray                  the view style it opens in
 *   ui.styles=realistic,techdraw   the view styles the viewer menu offers
 *   ui.projection=ortho            opens isometric (orthographic) instead of in perspective
 *   ui.grid=0 | ui.grid=1          grid hidden or shown, whatever the style's default
 *   ui.menu=bottom|top|left|right|none   where the viewer menu sits, or no menu
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

export type ViewerMenuPlacement = 'bottom' | 'top' | 'left' | 'right' | 'none';

export interface ConfiguratorDisplay
{
  header:     boolean;
  metrics:    boolean;
  /** View style id to open in; null: the viewer's default. Unknown ids are ignored by the viewer. */
  style:      string | null;
  /** View style ids the menu offers; null: all of them. */
  styles:     string[] | null;
  ortho:      boolean;
  /** Grid visibility; null: what the view style says. */
  grid:       boolean | null;
  menu:       ViewerMenuPlacement;
}

export const DEFAULT_DISPLAY: ConfiguratorDisplay = {
  header:  true,
  metrics: true,
  style:   null,
  styles:  null,
  ortho:   false,
  grid:    null,
  menu:    'bottom',
};

const MENU_PLACEMENTS: ViewerMenuPlacement[] = ['bottom', 'top', 'left', 'right', 'none'];

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

  return {
    header:  flag(query.get('ui.header')) ?? DEFAULT_DISPLAY.header,
    metrics: flag(query.get('ui.metrics')) ?? DEFAULT_DISPLAY.metrics,
    style:   text('ui.style'),
    styles:  styles.length > 0 ? styles : null,
    ortho:   ['ortho', 'orthographic', 'iso', 'isometric'].includes(text('ui.projection') ?? ''),
    grid:    flag(query.get('ui.grid')),
    menu:    (menu && MENU_PLACEMENTS.includes(menu)) ? menu : DEFAULT_DISPLAY.menu,
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
