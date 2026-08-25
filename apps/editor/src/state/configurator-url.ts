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

import type { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';

import { configuratorParams, configuratorValues, configuratorValueFor } from './configurator';

/** Query keys the configurator itself owns; never treated as a param. Params are
 *  matched by name anyway, but a script is free to call a param LANG. */
const RESERVED_KEYS = ['lang'];

//// CODEC (pure — see tests/configurator-url.test.ts) ////

/**
 * Param values from a query string, coerced by each param's declared type and checked
 * against its schema. Keys that name no param, and values the param rejects, are left
 * out. Param names are matched case-insensitively: people retype these by hand.
 */
export function decodeParamValues(search: string, params: ScriptParam[]): Record<string, any>
{
  const byName = new Map(params.map(p => [p.name.toUpperCase(), p]));
  const values: Record<string, any> = {};

  new URLSearchParams(search).forEach((raw, key) =>
  {
    if (RESERVED_KEYS.includes(key.toLowerCase())) return;

    const param = byName.get(key.toUpperCase());
    if (!param) return;

    const value = coerce(raw, param);
    if (value === undefined)
    {
      console.warn(`configurator-url: ignoring "${key}=${raw}" — not a valid ${param.type} value.`);
      return;
    }
    if (!param.validateValue(value))
    {
      console.warn(`configurator-url: ignoring "${key}=${raw}" — outside what "${param.name}" allows.`);
      return;
    }

    values[param.name] = value;
  });

  return values;
}

/**
 * The query string for a set of values: every key that was already in `search` and is
 * not a param is kept as it stands (?lang=, campaign tags, whatever the link carried),
 * every param that differs from its default is added, every param at its default is
 * dropped.
 */
export function encodeParamValues(
  search: string,
  params: ScriptParam[],
  values: Record<string, any>,
): string
{
  const isParam = new Set(params.map(p => p.name.toUpperCase()));
  const next = new URLSearchParams();

  new URLSearchParams(search).forEach((raw, key) =>
  {
    const reserved = RESERVED_KEYS.includes(key.toLowerCase());
    if (reserved || !isParam.has(key.toUpperCase())) next.append(key, raw);
  });

  params.forEach((param) =>
  {
    const value = values[param.name];
    if (value === undefined || sameValue(value, openingValue(param))) return;
    next.set(param.name, serialize(value, param));
  });

  return next.toString();
}

/** What the configurator opens with for this param when the URL says nothing — the
 *  same rule configuratorValueFor() applies. A published script can carry a saved
 *  `_value`, and writing that into the link would pin a value nobody chose. */
function openingValue(param: ScriptParam): any
{
  return param._value ?? param.default;
}

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

//// VALUES ⇄ STRINGS ////

/** One raw query value → a typed param value, or undefined when it cannot be read as
 *  one. Kept deliberately literal: `?WIDTH=1200`, not `?WIDTH=%221200%22`. */
function coerce(raw: string, param: ScriptParam): any
{
  switch (param.type)
  {
    case 'number':
    {
      const n = Number(raw);
      return (raw.trim() !== '' && Number.isFinite(n)) ? n : undefined;
    }
    case 'boolean':
    {
      const v = raw.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(v)) return true;
      if (['false', '0', 'no', 'off'].includes(v)) return false;
      return undefined;
    }
    case 'list':
    case 'object':
    {
      // The only types a URL cannot express plainly; JSON keeps them exact.
      try { return JSON.parse(raw); }
      catch { return undefined; }
    }
    default:
      // text / options — the string IS the value
      return raw;
  }
}

function serialize(value: any, param: ScriptParam): string
{
  switch (param.type)
  {
    case 'list':
    case 'object':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/** Structural equality, so a list/object at its default is recognised as untouched. */
function sameValue(a: any, b: any): boolean
{
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}
