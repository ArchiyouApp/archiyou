/**
 * tests/configurator-url.test.ts — the link a configurator visitor pastes.
 *
 * The codec is where a shared link either survives or quietly lies: a stale link must
 * degrade to the defaults rather than apply a value the script no longer allows, and
 * writing must never drop the other things the URL carries (?lang=, campaign tags).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import { decodeParamValues, encodeParamValues } from '../src/state/configurator-url.js';

/** The params a small configurator would have. */
const WIDTH = ScriptParam.fromData({
  name: 'WIDTH', type: 'number',
  schema: { type: 'number', default: 100, minimum: 10, maximum: 2000, multipleOf: 1 },
} as any);

const ROUNDED = ScriptParam.fromData({
  name: 'ROUNDED', type: 'boolean',
  schema: { type: 'boolean', default: false },
} as any);

const STYLE = ScriptParam.fromData({
  name: 'STYLE', type: 'options',
  schema: { type: 'string', enum: ['modern', 'classic'], default: 'modern' },
} as any);

const LABEL = ScriptParam.fromData({
  name: 'LABEL', type: 'text',
  schema: { type: 'string', default: '', minLength: 0, maxLength: 256 },
} as any);

const SIZES = ScriptParam.fromData({
  name: 'SIZES', type: 'list',
  schema: { type: 'array', items: { type: 'number' }, default: [1, 2] },
} as any);

const PARAMS = [WIDTH, ROUNDED, STYLE, LABEL, SIZES];

afterEach(() => vi.restoreAllMocks());

/** decodeParamValues warns about anything it drops; silence that in the cases that
 *  deliberately feed it junk. */
function quiet()
{
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('decodeParamValues', () =>
{
  it('types each value by its param, not by what it looks like', () =>
  {
    expect(decodeParamValues('?WIDTH=1200&ROUNDED=true&STYLE=classic&LABEL=1200', PARAMS))
      .toEqual({ WIDTH: 1200, ROUNDED: true, STYLE: 'classic', LABEL: '1200' });
  });

  it('reads the booleans people actually type', () =>
  {
    expect(decodeParamValues('?ROUNDED=1', PARAMS)).toEqual({ ROUNDED: true });
    expect(decodeParamValues('?ROUNDED=no', PARAMS)).toEqual({ ROUNDED: false });
    expect(decodeParamValues('?ROUNDED=TRUE', PARAMS)).toEqual({ ROUNDED: true });
  });

  it('matches param names case-insensitively — these get retyped by hand', () =>
  {
    expect(decodeParamValues('?width=250', PARAMS)).toEqual({ WIDTH: 250 });
  });

  it('reads a list as JSON', () =>
  {
    expect(decodeParamValues('?SIZES=[3,4,5]', PARAMS)).toEqual({ SIZES: [3, 4, 5] });
  });

  it('ignores a value the param would not allow', () =>
  {
    quiet();
    // Above maximum, below minimum, not one of the options, not a number at all.
    expect(decodeParamValues('?WIDTH=99999', PARAMS)).toEqual({});
    expect(decodeParamValues('?WIDTH=1', PARAMS)).toEqual({});
    expect(decodeParamValues('?STYLE=baroque', PARAMS)).toEqual({});
    expect(decodeParamValues('?WIDTH=wide', PARAMS)).toEqual({});
    expect(decodeParamValues('?ROUNDED=maybe', PARAMS)).toEqual({});
    expect(decodeParamValues('?SIZES=not-json', PARAMS)).toEqual({});
  });

  it('ignores keys that name no param, including the locale', () =>
  {
    quiet();
    expect(decodeParamValues('?lang=de&utm_source=news&HEIGHT=200', PARAMS)).toEqual({});
  });

  it('keeps the good half of a partly stale link', () =>
  {
    quiet();
    expect(decodeParamValues('?WIDTH=250&STYLE=baroque&GONE=7', PARAMS)).toEqual({ WIDTH: 250 });
  });

  it('is empty for an empty query', () =>
  {
    expect(decodeParamValues('', PARAMS)).toEqual({});
    expect(decodeParamValues('?', PARAMS)).toEqual({});
  });
});

describe('encodeParamValues', () =>
{
  /** Every param at its default, as an untouched configurator has them. */
  const defaults = Object.fromEntries(PARAMS.map(p => [p.name, p.default]));

  it('writes nothing for an untouched configurator', () =>
  {
    expect(encodeParamValues('', PARAMS, defaults)).toBe('');
  });

  it('writes only what differs from the defaults', () =>
  {
    const query = encodeParamValues('', PARAMS, { ...defaults, WIDTH: 1200, ROUNDED: true });
    expect(new URLSearchParams(query).get('WIDTH')).toBe('1200');
    expect(new URLSearchParams(query).get('ROUNDED')).toBe('true');
    expect(new URLSearchParams(query).has('STYLE')).toBe(false);
  });

  it('keeps the rest of the query — the locale a link was shared in, campaign tags', () =>
  {
    const query = encodeParamValues('?lang=de&utm_source=news', PARAMS, { ...defaults, WIDTH: 300 });
    const out = new URLSearchParams(query);
    expect(out.get('lang')).toBe('de');
    expect(out.get('utm_source')).toBe('news');
    expect(out.get('WIDTH')).toBe('300');
  });

  it('drops a param that is back at its default', () =>
  {
    expect(encodeParamValues('?WIDTH=1200', PARAMS, defaults)).toBe('');
  });

  it('measures against the saved _value a published script opens with, not the schema default', () =>
  {
    const saved = ScriptParam.fromData({
      name: 'SIZE', type: 'number', _value: 13,
      schema: { type: 'number', default: 50, minimum: 0, maximum: 100, multipleOf: 1 },
    } as any);

    // 13 is what the visitor sees before touching anything — no link needed for it.
    expect(encodeParamValues('', [saved], { SIZE: 13 })).toBe('');
    expect(encodeParamValues('', [saved], { SIZE: 50 })).toBe('SIZE=50');
  });

  it('recognises a list back at its default by value, not identity', () =>
  {
    expect(encodeParamValues('', PARAMS, { ...defaults, SIZES: [1, 2] })).toBe('');
    expect(new URLSearchParams(encodeParamValues('', PARAMS, { ...defaults, SIZES: [9] })).get('SIZES'))
      .toBe('[9]');
  });

  it('round-trips through decode', () =>
  {
    const values = { WIDTH: 1200, ROUNDED: true, STYLE: 'classic', LABEL: 'Kast & Co', SIZES: [3, 4] };
    const query = encodeParamValues('', PARAMS, values);
    expect(decodeParamValues(`?${query}`, PARAMS)).toEqual(values);
  });

  it('escapes what has to be escaped and stays readable otherwise', () =>
  {
    const query = encodeParamValues('', PARAMS, { ...defaults, WIDTH: 1200, LABEL: 'a&b=c' });
    expect(query).toContain('WIDTH=1200');           // numbers stay plain
    expect(query).not.toContain('a&b=c');            // the text is escaped
    expect(decodeParamValues(`?${query}`, PARAMS).LABEL).toBe('a&b=c');
  });
});
