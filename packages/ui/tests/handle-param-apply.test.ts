import { describe, it, expect } from 'vitest';

import { applyParamMap, parseParamRef, snapClampChanged, snapClampToSchema } from '../src/viewer/handle-param';
import type { HandleParamMap } from '@archiyou/core/src/interaction/types';

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
const MAP: HandleParamMap = { u: 'left', v: 'sill' };
const drag = (over: Partial<Record<'x'|'y'|'z'|'u'|'v', number>> = {}) =>
  ({ x: 0, y: 0, z: 0, u: 0, v: 0, ...over });

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

describe('applyParamMap — relative range (delta mode)', () =>
{
  it('adds the drag delta to the current property value', () =>
  {
    expect(applyParamMap(drag({ u: 300, v: -200 }), ENTRY, MAP, true, SCHEMA))
      .toMatchObject({ left: 900, sill: 700 });
  });

  it('snaps the result to the property step', () =>
  {
    expect(applyParamMap(drag({ u: 137 }), ENTRY, { u: 'left' }, true, SCHEMA)!['left']).toBe(740);
  });

  it('clamps at the property bounds rather than letting validation reject the write', () =>
  {
    expect(applyParamMap(drag({ u: -5000, v: -5000 }), ENTRY, MAP, true, SCHEMA))
      .toMatchObject({ left: 0, sill: 0 });
  });

  it('leaves unmapped properties exactly as they were', () =>
  {
    expect(applyParamMap(drag({ u: 300 }), ENTRY, { u: 'left' }, true, SCHEMA))
      .toMatchObject({ name: 'kitchen window', sill: 900, width: 1000, height: 1300 });
  });

  it('never mutates the value it was given', () =>
  {
    const entry = { ...ENTRY };
    applyParamMap(drag({ u: 300 }), entry, MAP, true, SCHEMA);
    expect(entry).toEqual(ENTRY);
  });
});

describe('applyParamMap — absolute range (world coordinate mode)', () =>
{
  it('writes the world coordinate straight into the property', () =>
  {
    expect(applyParamMap(drag({ x: 2400, z: 1500 }), ENTRY, { x: 'left', z: 'sill' }, false, SCHEMA))
      .toMatchObject({ left: 2400, sill: 1500 });
  });

  it('still snaps and clamps', () =>
  {
    expect(applyParamMap(drag({ x: 99123 }), ENTRY, { x: 'left' }, false, SCHEMA)!['left']).toBe(12000);
  });
});

describe('applyParamMap — refusals', () =>
{
  it('returns null when there is no object to write into', () =>
  {
    expect(applyParamMap(drag({ u: 10 }), undefined as any, MAP, true, SCHEMA)).toBeNull();
    expect(applyParamMap(drag({ u: 10 }), [] as any, MAP, true, SCHEMA)).toBeNull();
  });

  it('skips a property the schema does not declare, and says so', () =>
  {
    const warnings: string[] = [];
    const next = applyParamMap(drag({ u: 137 }), ENTRY, { u: 'depth' }, true, SCHEMA, m => warnings.push(m));
    // Writing a stray key can fail validation outright under additionalProperties:false —
    // a typo'd property name must not silently become part of the value.
    expect(next).not.toHaveProperty('depth');
    expect(next).toEqual(ENTRY);
    expect(warnings.join()).toMatch(/no property "depth".*left/);
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
