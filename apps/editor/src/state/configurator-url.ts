/**
 * state/configurator-url.ts — the configurator's parameter values in the address bar.
 *
 * A standalone configurator (/configurators/:user/:script:version) keeps the visitor's
 * configuration in the query string:
 *
 *     /configurators/archiyou/shelf:1.2?WIDTH=1200&SHELVES=4&lang=de
 *
 * so a link can be pasted, bookmarked or mailed and opens on that exact model. A link may
 * also name a preset (`?preset=Large&WIDTH=900`: that preset, then 900 wide). Values
 * are written with the param's own name, in the plainest form the type allows, so the
 * link stays readable and hand-editable — the point of a shareable URL.
 *
 * Two rules keep it honest:
 *   - only values that DIFFER from what the configurator opens with are written, so an
 *     untouched configurator has a clean URL and a link never pins a value nobody chose
 *   - anything unreadable — an unknown param, a value the param's schema rejects — is
 *     ignored with a warning, never applied. A link shared before the script was
 *     re-published must degrade to the defaults, not break the page.
 *
 * Reading happens once, when the published page has loaded the script (the param
 * definitions are what makes '4' a number and 'true' a boolean); writing happens on
 * every change the visitor makes. Only in the standalone configurator: inside the
 * editor's Configurator Preview the address bar belongs to the editor.
 */

import { decodeParamValues, encodeParamValues } from '@archiyou/core/src/execution/ScriptParam';

import { applyConfiguratorPreset, configuratorParams, configuratorPresets, configuratorValues, configuratorValueFor } from './configurator';
import { presetFromQuery } from './configurator-display';

// The codec itself lives in core, next to ScriptParam: the server reads the same links
// for a configurator's social card, and must read them exactly as this page does.
export { decodeParamValues, encodeParamValues };

/**
 * `?embed=1` (or a bare `?embed`): the configurator is shown inside another site's page,
 * which offers its own links. The configurator then leaves out the buttons that send the
 * visitor elsewhere ("View source", "Embed"). `?embed=0` or no key: the standalone page.
 */
export function isEmbedded(search: string): boolean
{
  const value = new URLSearchParams(search).get('embed');
  return value !== null && value !== '0' && value !== 'false';
}

//// SIGNALS + ADDRESS BAR ////

/** Seed the configurator's values from a link: its preset (`?preset=Large`), then its params
 *  on top. Call once, AFTER the script is loaded: the param definitions are what give the raw
 *  strings a type. */
export function applyConfiguratorParamsFromQuery(search: string): void
{
  applyConfiguratorQuery(search);
}

/**
 * Apply what a query string says to the configuration on screen: the preset it names first,
 * then its param values. What it does not mention stays as it is. Returns the preset that was
 * applied (by its own name) and the params the query set, so the caller can report them.
 *
 * Used for the link a configurator opens with, and for the commands of the page it is
 * embedded in (services/host-events), which use the same form: `preset=Large&WIDTH=900`.
 */
export function applyConfiguratorQuery(search: string): { preset: string | null, changed: string[] }
{
  const params = configuratorParams.get();
  const wanted = presetFromQuery(search, params);
  // Matched like param names, case-insensitively: links are typed by hand.
  const preset = wanted ? (configuratorPresets.get().find(p => p.name.toLowerCase() === wanted.toLowerCase())?.name ?? null) : null;
  if (wanted && !preset) console.warn(`configurator-url: ignoring preset "${wanted}" — the script has no such preset.`);
  if (preset) applyConfiguratorPreset(preset);

  const values = decodeParamValues(search, params);
  if (Object.keys(values).length > 0) configuratorValues.set({ ...configuratorValues.get(), ...values });
  return { preset, changed: Object.keys(values) };
}

/** The configuration on screen as a query string: every param that differs from what the
 *  configurator opens with, nothing else. What the page around an embedded configurator puts
 *  in its own address, so its link reopens this model. */
export function configurationQuery(): string
{
  const params = configuratorParams.get();
  return encodeParamValues('', params, Object.fromEntries(params.map(p => [p.name, configuratorValueFor(p)])));
}

/**
 * Write the current configuration into the address bar, so the URL a visitor copies is
 * the model they are looking at.
 *
 * replaceState, not pushState: dragging a slider must not fill the back button with a
 * hundred entries. The link is still complete at any moment — that is what people copy.
 */
export function syncConfiguratorParamsToUrl(): void
{
  if (typeof window === 'undefined' || !window.history?.replaceState) return;

  const params = configuratorParams.get();
  const values = Object.fromEntries(params.map(p => [p.name, configuratorValueFor(p)]));
  // Once the visitor changes something the values say it all: a preset the link opened with
  // would otherwise be applied again under them, and undo a value set back to its default.
  const search = new URLSearchParams(window.location.search);
  if (presetFromQuery(window.location.search, params)) search.delete('preset');
  const query  = encodeParamValues(search.toString(), params, values);

  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

  // A configurator embedded in a sandboxed iframe may not touch its own history.
  // Nothing about the model depends on this, so a refusal is not worth an error.
  try { window.history.replaceState(window.history.state, '', url); }
  catch (err) { console.warn('configurator-url: could not update the address bar:', err); }
}
