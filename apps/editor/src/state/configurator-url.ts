/**
 * state/configurator-url.ts — the configurator's parameter values in the address bar.
 *
 * A standalone configurator (/configurators/:user/:script:version) keeps the visitor's
 * configuration in the query string:
 *
 *     /configurators/archiyou/shelf:1.2?WIDTH=1200&SHELVES=4&lang=de
 *
 * so a link can be pasted, bookmarked or mailed and opens on that exact model. Values
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

import { configuratorParams, configuratorValues, configuratorValueFor } from './configurator';

// The codec itself lives in core, next to ScriptParam: the server reads the same links
// for a configurator's social card, and must read them exactly as this page does.
export { decodeParamValues, encodeParamValues };

//// SIGNALS + ADDRESS BAR ////

/** Seed the configurator's values from a link. Call once, AFTER the script is loaded:
 *  the param definitions are what give the raw strings a type. */
export function applyConfiguratorParamsFromQuery(search: string): void
{
  const values = decodeParamValues(search, configuratorParams.get());
  if (Object.keys(values).length === 0) return;
  configuratorValues.set({ ...configuratorValues.get(), ...values });
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
  const query  = encodeParamValues(window.location.search, params, values);

  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

  // A configurator embedded in a sandboxed iframe may not touch its own history.
  // Nothing about the model depends on this, so a refusal is not worth an error.
  try { window.history.replaceState(window.history.state, '', url); }
  catch (err) { console.warn('configurator-url: could not update the address bar:', err); }
}
