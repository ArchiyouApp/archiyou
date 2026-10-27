/**
 * tests/host-events.test.ts — what an embedded configurator tells the page around it.
 *
 * A site counts these messages (visitors who changed a design, downloads, the configuration
 * at that moment), so their shape is a contract: the envelope, the numeric metrics, and that
 * posting is a silent no-op wherever there is no frame to post to.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { editorScript } from '../src/state/core.js';
import { hostMessage, listenToHost, metricValues, parseHostCommand, postToHost, HOST_MESSAGE_SOURCE, HOST_MESSAGE_VERSION } from '../src/services/host-events.js';

const metricsOutput = (output: unknown) => ({ path: { category: 'metrics' }, output }) as any;

describe('hostMessage', () =>
{
  it('wraps an event in the envelope a site checks', () =>
  {
    const message = hostMessage({ type: 'download', fulfillment: 'Model', formats: ['stl'], params: { WIDTH: 4500 }, metrics: {}, query: 'WIDTH=4500' }, 'archiyou/ur_house_sketch:0.4');
    expect(message).toEqual({
      source: HOST_MESSAGE_SOURCE, version: HOST_MESSAGE_VERSION, script: 'archiyou/ur_house_sketch:0.4',
      type: 'download', fulfillment: 'Model', formats: ['stl'], params: { WIDTH: 4500 }, metrics: {}, query: 'WIDTH=4500',
    });
    expect(HOST_MESSAGE_SOURCE).toBe('archiyou-configurator');
  });
});

describe('metricValues', () =>
{
  it('keeps the single values of a run, by name, from lists and records', () =>
  {
    const outputs = [
      metricsOutput([{ name: 'area', data: 44 }, { name: 'price (DIY)', data: '38k' }]),
      metricsOutput({ volume: { name: 'volume', data: 117 }, broken: { name: 'broken', data: Number.NaN } }),
      metricsOutput([{ name: 'series', data: [1, 2, 3] }]),
      { path: { category: 'model' }, output: { name: 'ignored', data: 1 } } as any,
      metricsOutput(null),
    ];
    expect(metricValues(outputs)).toEqual({ area: 44, 'price (DIY)': '38k', volume: 117 });
  });

  it('is empty without metrics', () =>
  {
    expect(metricValues([])).toEqual({});
  });
});

describe('postToHost', () =>
{
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing outside a frame', () =>
  {
    const self: any = { postMessage: vi.fn() };
    self.parent = self;
    vi.stubGlobal('window', self);
    postToHost({ type: 'error', message: 'x' });
    expect(self.postMessage).not.toHaveBeenCalled();
  });

  it('posts to the embedding page with the script it runs, as plain data', () =>
  {
    const parent = { postMessage: vi.fn() };
    vi.stubGlobal('window', { parent });
    editorScript.set({ author: 'archiyou', name: 'ur_house_sketch', version: '0.4' } as any);

    postToHost({ type: 'change', changed: ['WIDTH'], via: 'host', params: { WIDTH: 4500, NOTE: undefined }, metrics: { area: 44 }, query: 'WIDTH=4500' });

    expect(parent.postMessage).toHaveBeenCalledWith({
      source: 'archiyou-configurator', version: 1, script: 'archiyou/ur_house_sketch:0.4',
      type: 'change', changed: ['WIDTH'], via: 'host', params: { WIDTH: 4500 }, metrics: { area: 44 }, query: 'WIDTH=4500',
    }, '*');
  });

  it('never throws when the page cannot be reached', () =>
  {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', { parent: { postMessage: () => { throw new Error('gone'); } } });
    expect(() => postToHost({ type: 'error', message: 'x' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('parseHostCommand', () =>
{
  it('reads an apply command with its query', () =>
  {
    expect(parseHostCommand({ source: 'archiyou-host', version: 1, type: 'apply', query: 'preset=Large&WIDTH=900' }))
      .toEqual({ type: 'apply', query: 'preset=Large&WIDTH=900' });
  });

  it('ignores other sources, versions, types and malformed commands', () =>
  {
    expect(parseHostCommand({ source: 'archiyou-configurator', version: 1, type: 'apply', query: 'WIDTH=900' })).toBeNull();
    expect(parseHostCommand({ source: 'archiyou-host', version: 2, type: 'apply', query: 'WIDTH=900' })).toBeNull();
    expect(parseHostCommand({ source: 'archiyou-host', version: 1, type: 'eval', query: 'WIDTH=900' })).toBeNull();
    expect(parseHostCommand({ source: 'archiyou-host', version: 1, type: 'apply', query: { WIDTH: 900 } })).toBeNull();
    expect(parseHostCommand('preset=Large')).toBeNull();
    expect(parseHostCommand(null)).toBeNull();
  });
});

describe('listenToHost', () =>
{
  afterEach(() => vi.unstubAllGlobals());

  /** A frame's window: its parent, and the message listeners the configurator adds. */
  function frame()
  {
    const listeners = new Set<(e: any) => void>();
    const parent = {};
    const self = {
      parent,
      addEventListener:    (_: string, fn: (e: any) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: any) => void) => listeners.delete(fn),
    };
    vi.stubGlobal('window', self);
    return { parent, listeners, post: (data: unknown, source: unknown) => listeners.forEach(fn => fn({ data, source })) };
  }

  const apply = { source: 'archiyou-host', version: 1, type: 'apply', query: 'WIDTH=900' };

  it('passes on commands from the parent window only', () =>
  {
    const { parent, post } = frame();
    const handler = vi.fn();
    listenToHost(handler);

    post(apply, {});         // another window, e.g. a frame inside the configurator
    post({ hello: 1 }, parent);
    post(apply, parent);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'apply', query: 'WIDTH=900' });
  });

  it('stops listening when asked', () =>
  {
    const { listeners } = frame();
    const stop = listenToHost(() => {});
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('does not listen outside a frame', () =>
  {
    const self: any = { addEventListener: vi.fn() };
    self.parent = self;
    vi.stubGlobal('window', self);
    listenToHost(() => {});
    expect(self.addEventListener).not.toHaveBeenCalled();
  });
});
