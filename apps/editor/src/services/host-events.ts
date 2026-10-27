/**
 * host-events.ts — a published configurator tells the page it is embedded in what the
 * visitor does, so that site can count it (analytics, campaign funnels) and keep the
 * configuration in its own address; and it takes commands from that page, so buttons on the
 * page can change the model.
 *
 * Only inside a frame (window.parent !== window) and only for the published configurator (never
 * the editor's Configurator Preview). Embedding stays a plain iframe: a page that neither
 * listens nor sends commands loses nothing.
 *
 * OUT, to the page. Every message has the same envelope:
 *
 *     { source: 'archiyou-configurator', version: 1, type, script: 'author/name:version', ... }
 *
 *   ready     the first model is shown        { execution: 'server' | 'client', loadMs, commands, animations, params, metrics, query }
 *   change    the visitor changed the model,  { changed: [param names], params, metrics, query, via? }
 *             and the new one is shown
 *   preset    the visitor applied a preset,   { preset, params, metrics, query, via? }
 *             and the new model is shown
 *   download  a download finished             { fulfillment, formats, params, metrics, query }
 *   error     the model could not be made     { message }
 *
 * `params` holds every param value as the configurator holds it (numbers, booleans, strings,
 * lists), `metrics` the metrics of the model on screen ({ name: value }: a number, or the text
 * the script shows, such as '38k'), `query` the configuration as the configurator writes it in
 * a link (every param that differs from what it opens with: 'WIDTH=900&ROOF=flat'), `commands`
 * the commands below that this configurator takes (['apply', 'animate']), `animations` the
 * animations the script declares (the standard ones can be played too), `via: 'host'`
 * marks a change the page itself asked for with a command. A message carries nothing about the
 * visitor, only what they see on screen, so it is posted with targetOrigin '*': the
 * configurator cannot know which site embeds it. A site checks `event.origin` and
 * `event.source` (its own frame) before it trusts one.
 *
 * IN, from the page. Only messages from the frame's parent window, with the envelope
 *
 *     { source: 'archiyou-host', version: 1, type: 'apply', query: 'preset=Large&WIDTH=900' }
 *
 *   apply     change the model on screen as a link with this query would open it: the preset
 *             first, then the params. What the query does not mention stays as it is; what it
 *             gets wrong is ignored. Answered with `preset` and/or `change` (via: 'host').
 *
 *     { source: 'archiyou-host', version: 1, type: 'animate', name: 'flyin', loop: 'loop' }
 *
 *   animate   play an animation: one the script declares, or a standard one (flyin, build,
 *             exploded, layout, turntable, assembly), through its own camera when it has
 *             one. `loop` is 'none', 'loop' or 'pingpong'; without it, the animation's own.
 *             `name: null` stops it and shows the model as it is. An animation the model
 *             does not carry yet takes a run to make first. Unknown names are ignored.
 *
 * Send commands after `ready`: the configurator listens once its script is loaded, and a
 * command that arrives earlier is lost. A command can do nothing a visitor cannot do with the
 * controls, so it is taken from any origin.
 */

import type { Metric } from '@archiyou/core/src/calc/types';
import type { ScriptOutputData } from '@archiyou/core/src/execution/types';

import { editorScript, executionResult } from '../state/core.js';
import { configuratorParams, configuratorValueFor } from '../state/configurator.js';
import { configurationQuery } from '../state/configurator-url.js';
import { isAnimationName } from '../state/configurator-display.js';
import type { AnimationLoopMode } from '../state/viewer.js';

export const HOST_MESSAGE_SOURCE = 'archiyou-configurator';
export const HOST_MESSAGE_VERSION = 1;
export const HOST_COMMAND_SOURCE = 'archiyou-host';

export type Configuration = { params: Record<string, unknown>, metrics: Record<string, number | string>, query: string };

export type HostEvent =
  | { type: 'ready', execution: 'server' | 'client', loadMs: number, commands: HostCommand['type'][], animations: string[] } & Configuration
  | { type: 'change', changed: string[], via?: 'host' } & Configuration
  | { type: 'preset', preset: string, via?: 'host' } & Configuration
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

/** The model on screen: every param value, the metrics of the last run and the query of its link. */
export function currentConfiguration(): Configuration
{
  return { params: currentParams(), metrics: metricValues(executionResult.get()?.outputs ?? []), query: configurationQuery() };
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

//// COMMANDS FROM THE PAGE ////

export type HostCommand =
  | { type: 'apply', query: string }
  | { type: 'animate', name: string | null, loop?: AnimationLoopMode };

const LOOP_MODES: AnimationLoopMode[] = ['none', 'loop', 'pingpong'];

/** The commands this configurator takes, announced in its `ready` message: a page that finds one
 *  missing (an older configurator) reloads the frame with a new URL instead. */
export const HOST_COMMANDS: HostCommand['type'][] = ['apply', 'animate'];

/** A command from the page, or null for anything else a window may post. */
export function parseHostCommand(data: unknown): HostCommand | null
{
  const m = (data && typeof data === 'object') ? data as Record<string, unknown> : null;
  if (m?.source !== HOST_COMMAND_SOURCE || m.version !== HOST_MESSAGE_VERSION) return null;
  if (m.type === 'apply' && typeof m.query === 'string') return { type: 'apply', query: m.query };
  if (m.type === 'animate' && (m.name === null || typeof m.name === 'string'))
  {
    const name = (typeof m.name === 'string') ? (m.name.trim() || null) : null;
    if (name && !isAnimationName(name)) return null;
    const loop = LOOP_MODES.find(l => l === m.loop);
    return { type: 'animate', name, ...(loop ? { loop } : {}) };
  }
  return null;
}

/** Call `handler` with each command the page around this frame sends. Returns the function
 *  that stops listening. A no-op when not in a frame. */
export function listenToHost(handler: (command: HostCommand) => void): () => void
{
  if (typeof window === 'undefined' || window.parent === window) return () => {};

  const onMessage = (e: MessageEvent) =>
  {
    if (e.source !== window.parent) return;
    const command = parseHostCommand(e.data);
    if (command) handler(command);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
