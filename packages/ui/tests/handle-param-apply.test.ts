import { describe, it, expect } from 'vitest';

import { mapFunctionResult, parseParamRef, rebuildFunction, snapClampChanged, snapClampToSchema } from '../src/viewer/handle-param';
import type { HandleDrag } from '@archiyou/core/src/interaction/types';

/** The Opening type from roomwithopeningsbox, as ParamManager.buildObjectSchema emits it. */
const SCHEMA = {
  type: 'object',
  title: 'Opening',
  properties: {
    name:   { type: 'string' },
    left:   { type: 'number', minimum: 0,   maximum: 12000, multipleOf: 10 },
    sill:   { type: 'number', minimum: 0,   maximum: 3000,  multipleOf: 10 },
    width:  { type: 'number', minimum: 300, maximum: 3000,  multipleOf: 10 },
    height: { type: 'number', minimum: 300, maximum: 3000,  multipleOf: 10 },
  },
};

const ENTRY = { name: 'kitchen window', left: 600, sill: 900, width: 1000, height: 1300 };
const drag = (over: Partial<Record<'x'|'y'|'z'|'u'|'v'|'du'|'dv'|'tu'|'tv', number>> = {}): HandleDrag =>
{
  const { x = 0, y = 0, z = 0, ...rest } = over;
  return { u: 0, v: 0, du: 0, dv: 0, tu: 0, tv: 0, range: [0, 1], position: () => [x, y, z], ...rest };
};

describe('parseParamRef', () =>
{
  it('reads a plain param name', () =>
  {
    expect(parseParamRef('WIDTH')).toEqual({ name: 'WIDTH', index: null });
  });

  it('reads an indexed reference', () =>
  {
    expect(parseParamRef('OPENINGS[2]')).toEqual({ name: 'OPENINGS', index: 2 });
    expect(parseParamRef('OPENINGS[0]')).toEqual({ name: 'OPENINGS', index: 0 });
    expect(parseParamRef(' OPENINGS[ 12 ] ')).toEqual({ name: 'OPENINGS', index: 12 });
  });

  it('does not mistake a malformed reference for an index', () =>
  {
    expect(parseParamRef('OPENINGS[]').index).toBeNull();
    expect(parseParamRef('OPENINGS[x]').index).toBeNull();
    expect(parseParamRef('OPENINGS[-1]').index).toBeNull();
  });
});

describe('snapClampToSchema', () =>
{
  it('rounds to multipleOf', () =>
  {
    expect(snapClampToSchema(1234, SCHEMA.properties.left)).toBe(1230);
    expect(snapClampToSchema(1236, SCHEMA.properties.left)).toBe(1240);
  });

  it('clamps to minimum and maximum', () =>
  {
    expect(snapClampToSchema(-500, SCHEMA.properties.left)).toBe(0);
    expect(snapClampToSchema(99999, SCHEMA.properties.left)).toBe(12000);
  });

  it('leaves non-numbers and unknown properties untouched', () =>
  {
    expect(snapClampToSchema('door', SCHEMA.properties.name)).toBe('door');
    expect(snapClampToSchema(1234.5, undefined)).toBe(1234.5);
  });
});

describe('mapFunctionResult — what a map function means', () =>
{
  const run = (value: any, fn: (param: any, handle: HandleDrag) => any, handle = drag({ u: 50, du: 7 })) =>
  {
    const copy = structuredClone(value);
    return mapFunctionResult(copy, fn(copy, handle));
  };

  it('takes an object changed in place, also when a concise arrow returns the assigned number', () =>
  {
    expect(run(ENTRY, (param, handle) => param.left = handle.u)).toMatchObject({ left: 50, sill: 900 });
    expect(run(ENTRY, (param, handle) => { param.left += handle.du; })).toMatchObject({ left: 607 });
  });

  it('takes a returned object', () =>
  {
    expect(run(ENTRY, (param, handle) => ({ ...param, sill: handle.u }))).toMatchObject({ sill: 50, left: 600 });
  });

  it('changes a list in place too', () =>
  {
    expect(run([1, 2], (param) => param.push(3))).toEqual([1, 2, 3]);
  });

  it('moves an entry by the drag distance, snapped and clamped to each property', () =>
  {
    // What the viewer does for OPENINGS[i]: run the function, then hold what it changed to the schema
    const moved = run(ENTRY, (param, handle) => { param.left += handle.du; param.sill += handle.dv; }, drag({ du: 137, dv: -5000 }));
    expect(snapClampChanged(ENTRY, moved, SCHEMA)).toMatchObject({ left: 740, sill: 0, width: 1000 });
  });

  it('takes the returned value of a plain param, and keeps it without one', () =>
  {
    expect(run(false, (_param, handle) => handle.u > 10)).toBe(true);
    expect(run(100, (param, handle) => param + handle.du)).toBe(107);
    expect(run(100, () => undefined)).toBe(100);
  });
});

describe('snapClampChanged — the map-function escape hatch', () =>
{
  it('snaps only what the function actually changed', () =>
  {
    // A sign flip, which the declarative map cannot express.
    const after = { ...ENTRY, left: ENTRY.left - 137 };
    expect(snapClampChanged(ENTRY, after, SCHEMA)).toMatchObject({ left: 460, sill: 900 });
  });

  it('clamps a function result that ran out of bounds', () =>
  {
    expect(snapClampChanged(ENTRY, { ...ENTRY, sill: -9000 }, SCHEMA)['sill']).toBe(0);
  });

  it('leaves an untouched property alone even when it is off-grid', () =>
  {
    const odd = { ...ENTRY, left: 604.5 };
    expect(snapClampChanged(odd, { ...odd }, SCHEMA)['left']).toBe(604.5);
  });
});

describe('rebuildFunction — a script function rebuilt in the viewer', () =>
{
  it('gives the function the values the script passed along as variables', () =>
  {
    const fn = rebuildFunction<(param: any, handle: any) => void>(
      '(param, handle) => { param.left += dragDir * handle.du }', { dragDir: -1 });
    const entry = { left: 1000 };
    fn(entry, { du: 200 });
    expect(entry.left).toBe(800);
  });

  it('rebuilds a function without values, like a dimension remap', () =>
  {
    expect(rebuildFunction<(v: number) => number>('(v) => v / 10')(800)).toBe(80);
  });

  it('has no access to anything else of the page', () =>
  {
    const fn = rebuildFunction<() => unknown>('() => typeof ENTRY');
    expect(fn()).toBe('undefined');
  });
});
