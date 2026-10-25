/**
 * tests/host-events.test.ts — what an embedded configurator tells the page around it.
 *
 * A site counts these messages (visitors who changed a design, downloads, the configuration
 * at that moment), so their shape is a contract: the envelope, the numeric metrics, and that
 * posting is a silent no-op wherever there is no frame to post to.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { editorScript } from '../src/state/core.js';
import { hostMessage, metricValues, postToHost, HOST_MESSAGE_SOURCE, HOST_MESSAGE_VERSION } from '../src/services/host-events.js';

const metricsOutput = (output: unknown) => ({ path: { category: 'metrics' }, output }) as any;

describe('hostMessage', () =>
{
  it('wraps an event in the envelope a site checks', () =>
  {
    const message = hostMessage({ type: 'download', fulfillment: 'Model', formats: ['stl'], params: { WIDTH: 4500 }, metrics: {} }, 'archiyou/ur_house_sketch:0.4');
    expect(message).toEqual({
      source: HOST_MESSAGE_SOURCE, version: HOST_MESSAGE_VERSION, script: 'archiyou/ur_house_sketch:0.4',
      type: 'download', fulfillment: 'Model', formats: ['stl'], params: { WIDTH: 4500 }, metrics: {},
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

    postToHost({ type: 'change', changed: ['WIDTH'], params: { WIDTH: 4500, NOTE: undefined }, metrics: { area: 44 } });

    expect(parent.postMessage).toHaveBeenCalledWith({
      source: 'archiyou-configurator', version: 1, script: 'archiyou/ur_house_sketch:0.4',
      type: 'change', changed: ['WIDTH'], params: { WIDTH: 4500 }, metrics: { area: 44 },
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
