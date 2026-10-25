/**
 * host-events.ts — a published configurator tells the page it is embedded in what the
 * visitor does, so that site can count it (analytics, campaign funnels).
 *
 * Only inside a frame (window.parent !== window), only for the published configurator (never
 * the editor's Configurator Preview), and outbound only: the configurator does not listen to
 * its host, so embedding stays a plain iframe. Every message has the same envelope:
 *
 *     { source: 'archiyou-configurator', version: 1, type, script: 'author/name:version', ... }
 *
 *   ready     the first model is shown        { execution: 'server' | 'client', loadMs, params, metrics }
 *   change    the visitor changed the model,  { changed: [param names], params, metrics }
 *             and the new one is shown
 *   preset    the visitor applied a preset,   { preset, params, metrics }
 *             and the new model is shown
 *   download  a download finished             { fulfillment, formats, params, metrics }
 *   error     the model could not be made     { message }
 *
 * `params` holds every param value as the configurator holds it (numbers, booleans, strings,
 * lists), `metrics` the metrics of the model on screen ({ name: value }: a number, or the text
 * the script shows, such as '38k'). A message
 * carries nothing about the visitor, only what they see on screen, so it is posted with
 * targetOrigin '*': the configurator cannot know which site embeds it. A site checks
 * `event.origin` and `event.source` (its own frame) before it trusts one.
 */

import type { Metric } from '@archiyou/core/src/calc/types';
import type { ScriptOutputData } from '@archiyou/core/src/execution/types';

import { editorScript, executionResult } from '../state/core.js';
import { configuratorParams, configuratorValueFor } from '../state/configurator.js';

export const HOST_MESSAGE_SOURCE = 'archiyou-configurator';
export const HOST_MESSAGE_VERSION = 1;

export type Configuration = { params: Record<string, unknown>, metrics: Record<string, number | string> };

export type HostEvent =
  | { type: 'ready', execution: 'server' | 'client', loadMs: number } & Configuration
  | { type: 'change', changed: string[] } & Configuration
  | { type: 'preset', preset: string } & Configuration
  | { type: 'download', fulfillment: string, formats: string[] } & Configuration
  | { type: 'error', message: string };

export type HostMessage = HostEvent & { source: typeof HOST_MESSAGE_SOURCE, version: typeof HOST_MESSAGE_VERSION, script: string };

/** The message for an event of the configurator `script` ("author/name:version"). */
export function hostMessage(event: HostEvent, script: string): HostMessage
{
  return { source: HOST_MESSAGE_SOURCE, version: HOST_MESSAGE_VERSION, script, ...event };
}

/** The metrics among a run's outputs, by metric name: numbers, and text as the script shows
 *  it ('38k'). Series (bar, line and radar data) are left out: a site counts single values. */
export function metricValues(outputs: ScriptOutputData[]): Record<string, number | string>
{
  return outputs
    .filter(o => o.path.category === 'metrics')
    .flatMap(o => (Array.isArray(o.output) ? o.output : Object.values(o.output ?? {})) as Metric[])
    .filter(m => m?.name && ((typeof m.data === 'number' && Number.isFinite(m.data)) || typeof m.data === 'string'))
    .reduce((values, m) => ({ ...values, [m.name]: m.data as number | string }), {} as Record<string, number | string>);
}

/** Every param value of the configurator, as it holds them now. */
export function currentParams(): Record<string, unknown>
{
  return Object.fromEntries(configuratorParams.get().map(p => [p.name, configuratorValueFor(p)]));
}

/** The model on screen: every param value and the numeric metrics of the last run. */
export function currentConfiguration(): Configuration
{
  return { params: currentParams(), metrics: metricValues(executionResult.get()?.outputs ?? []) };
}

/** Post an event to the page this configurator is embedded in. A no-op when it is not in a
 *  frame, and never an error: nothing in the configurator depends on the host listening. */
export function postToHost(event: HostEvent): void
{
  if (typeof window === 'undefined' || window.parent === window) return;

  const script = editorScript.get();
  const ref = script ? `${script.author}/${script.name}:${script.version}` : '';

  try
  {
    // Through JSON: param values are plain data, but a value the structured clone cannot
    // copy must not cost the visitor anything.
    window.parent.postMessage(JSON.parse(JSON.stringify(hostMessage(event, ref))), '*');
  }
  catch (err)
  {
    console.warn('host-events: could not post to the embedding page:', err);
  }
}
