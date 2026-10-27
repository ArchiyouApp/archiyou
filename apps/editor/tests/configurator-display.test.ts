/**
 * tests/configurator-display.test.ts — what the link of an embedded configurator asks it to
 * show, and the presets and params a link (or a command of the page around it) applies.
 *
 * A site builds these links from its editors' settings, so a key it gets wrong must leave the
 * configurator as it always opens, and a script's own params must never be taken for options.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import { DEFAULT_DISPLAY, displayFromQuery, presetFromQuery } from '../src/state/configurator-display.js';
import { applyConfiguratorQuery, configurationQuery } from '../src/state/configurator-url.js';
import { configuratorValues } from '../src/state/configurator.js';
import { editorScript } from '../src/state/core.js';

const WIDTH = ScriptParam.fromData({
  name: 'WIDTH', type: 'number',
  schema: { type: 'number', default: 100, minimum: 10, maximum: 2000, multipleOf: 1 },
} as any);

const ROOF = ScriptParam.fromData({
  name: 'ROOF', type: 'options',
  schema: { type: 'string', enum: ['flat', 'gable'], default: 'gable' },
} as any);

const GRID = ScriptParam.fromData({
  name: 'GRID', type: 'number',
  schema: { type: 'number', default: 600, minimum: 100, maximum: 1200, multipleOf: 1 },
} as any);

afterEach(() =>
{
  vi.restoreAllMocks();
  configuratorValues.set({});
});

describe('displayFromQuery', () =>
{
  it('opens as always without options', () =>
  {
    expect(displayFromQuery('')).toEqual(DEFAULT_DISPLAY);
    expect(displayFromQuery('?WIDTH=1200&lang=nl&embed=1')).toEqual(DEFAULT_DISPLAY);
  });

  it('reads every option', () =>
  {
    expect(displayFromQuery('?ui.header=0&ui.metrics=no&ui.style=TechDraw&ui.styles=realistic, techdraw&ui.projection=ortho&ui.grid=1&ui.menu=left'))
      .toEqual({ header: false, metrics: false, style: 'techdraw', styles: ['realistic', 'techdraw'], ortho: true, grid: true, menu: 'left', animation: null, loop: null });
  });

  it('reads the animation to play, as the script names it, and how it loops', () =>
  {
    expect(displayFromQuery('?ui.animation=flyIn&ui.loop=1')).toMatchObject({ animation: 'flyIn', loop: 'loop' });
    expect(displayFromQuery('?ui.animation=turntable&ui.loop=0').loop).toBe('none');
    expect(displayFromQuery('?ui.animation=deur-open&ui.loop=pingpong')).toMatchObject({ animation: 'deur-open', loop: 'pingpong' });
    expect(displayFromQuery('?ui.animation=swing').loop).toBeNull();
  });

  it('takes no animation whose name an animation cannot have', () =>
  {
    expect(displayFromQuery('?ui.animation=a,b').animation).toBeNull();
    expect(displayFromQuery('?ui.animation=<script>').animation).toBeNull();
    expect(displayFromQuery('?ui.animation=&ui.loop=sometimes')).toMatchObject({ animation: null, loop: null });
  });

  it('takes isometric for orthographic, and hides the menu with none', () =>
  {
    expect(displayFromQuery('?ui.projection=isometric').ortho).toBe(true);
    expect(displayFromQuery('?ui.projection=perspective').ortho).toBe(false);
    expect(displayFromQuery('?ui.menu=none').menu).toBe('none');
  });

  it('ignores what it cannot read', () =>
  {
    expect(displayFromQuery('?ui.header=maybe&ui.grid=&ui.menu=middle&ui.styles=,'))
      .toEqual(DEFAULT_DISPLAY);
  });

  it('never takes a param for an option', () =>
  {
    expect(displayFromQuery('?GRID=0&HEADER=0').grid).toBeNull();
    expect(displayFromQuery('?GRID=0&HEADER=0').header).toBe(true);
  });
});

describe('presetFromQuery', () =>
{
  it('names the preset of a link', () =>
  {
    expect(presetFromQuery('?preset=Large&WIDTH=900', [WIDTH])).toBe('Large');
    expect(presetFromQuery('?WIDTH=900', [WIDTH])).toBeNull();
  });

  it('leaves the key to a param called PRESET', () =>
  {
    const PRESET = ScriptParam.fromData({ name: 'PRESET', type: 'text', schema: { type: 'string', default: '' } } as any);
    expect(presetFromQuery('?preset=Large', [PRESET])).toBeNull();
  });
});

describe('applyConfiguratorQuery', () =>
{
  /** A script with three params and two presets, as the published page loads it. */
  function openScript()
  {
    editorScript.set({
      params:  { WIDTH, ROOF, GRID },
      presets: {
        Large: { WIDTH: { default: 1500 }, ROOF: { default: 'flat' } },
        Small: { WIDTH: { default: 50 } },
      },
    } as any);
  }

  it('applies the preset, then the params on top', () =>
  {
    openScript();
    expect(applyConfiguratorQuery('preset=large&WIDTH=900')).toEqual({ preset: 'Large', changed: ['WIDTH'] });
    expect(configuratorValues.get()).toEqual({ WIDTH: 900, ROOF: 'flat' });
  });

  it('keeps what the query does not mention', () =>
  {
    openScript();
    applyConfiguratorQuery('ROOF=flat&GRID=300');
    applyConfiguratorQuery('WIDTH=700');
    expect(configuratorValues.get()).toEqual({ ROOF: 'flat', GRID: 300, WIDTH: 700 });
  });

  it('applies nothing for an unknown preset or an invalid value', () =>
  {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    openScript();
    expect(applyConfiguratorQuery('preset=Huge&WIDTH=99999')).toEqual({ preset: null, changed: [] });
    expect(configuratorValues.get()).toEqual({});
  });

  it('writes the configuration as the query of its link, defaults left out', () =>
  {
    openScript();
    applyConfiguratorQuery('preset=Large&GRID=600');
    expect(configurationQuery()).toBe('WIDTH=1500&ROOF=flat');
  });
});
