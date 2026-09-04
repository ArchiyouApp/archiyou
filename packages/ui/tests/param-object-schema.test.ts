/**
 * The pure schema layer behind object params ($PARAMS.defineObject). These statics
 * are shared by the script side and by both param menus, so they are tested here —
 * packages/ui is one of the two suites CI actually runs.
 *
 * Node environment, no DOM: the Lit components themselves are not covered.
 */

import { describe, it, expect } from 'vitest';

import { ParamManager } from '@archiyou/core/src/execution/ParamManager';

// ── property shorthands ──────────────────────────────────────────────────────

describe('ParamManager.normalizeProperty()', () =>
{
  it('expands a bare type name', () =>
  {
    expect(ParamManager.normalizeProperty('number')).toEqual({ type: 'number' });
    expect(ParamManager.normalizeProperty('text')).toEqual({ type: 'string' });
    expect(ParamManager.normalizeProperty('boolean')).toEqual({ type: 'boolean' });
  });

  it('leaves a bare number UNBOUNDED', () =>
  {
    // Inheriting PARAM_TYPE_SCHEMAS.number would impose maximum:100, which would
    // reject anything a real model needs (a 3000mm wall).
    const s = ParamManager.normalizeProperty('number');
    expect(s.maximum).toBeUndefined();
    expect(s.minimum).toBeUndefined();
  });

  it('turns an array into an enum, inferring the type', () =>
  {
    expect(ParamManager.normalizeProperty(['left', 'right']))
      .toEqual({ type: 'string', enum: ['left', 'right'] });
    expect(ParamManager.normalizeProperty([10, 20, 30]))
      .toEqual({ type: 'number', enum: [10, 20, 30] });
  });

  it('applies the min/max/step aliases and carries the archiyou extras', () =>
  {
    const s = ParamManager.normalizeProperty(
      { type: 'number', min: 100, max: 5000, step: 10, default: 1200, units: 'mm', label: 'Width' });

    expect(s.minimum).toBe(100);
    expect(s.maximum).toBe(5000);
    expect(s.multipleOf).toBe(10);
    expect(s.default).toBe(1200);
    expect(s.units).toBe('mm');
    expect(s.label).toBe('Width');
  });

  it('lets an explicit JSON-Schema keyword beat its alias', () =>
  {
    expect(ParamManager.normalizeProperty({ type: 'number', min: 1, minimum: 7 }).minimum).toBe(7);
  });

  it('rejects an options type with no values', () =>
  {
    expect(() => ParamManager.normalizeProperty('options')).toThrow();
    expect(() => ParamManager.normalizeProperty({ type: 'options' })).toThrow();
  });
});

// ── object schemas ───────────────────────────────────────────────────────────

const OPENING_PROPS = {
  name:   'text',
  wall:   ['left', 'right', 'front', 'back'],
  width:  { type: 'number', min: 100, max: 5000, step: 10, default: 1200 },
  active: { type: 'boolean', default: true },
};

describe('ParamManager.buildObjectSchema()', () =>
{
  it('builds a JSON Schema object with a title', () =>
  {
    const s = ParamManager.buildObjectSchema('Opening', OPENING_PROPS);

    expect(s.type).toBe('object');
    expect(s.title).toBe('Opening');
    expect(Object.keys(s.properties)).toEqual(['name', 'wall', 'width', 'active']);
    expect(s.properties.width.maximum).toBe(5000);
  });

  it('does NOT default required / additionalProperties', () =>
  {
    // Both are enforced by TypeBox. Defaulting them makes schema evolution
    // destructive: add a property later and every list the user already edited
    // fails validation, which silently reverts it to the script's default.
    const s = ParamManager.buildObjectSchema('Opening', OPENING_PROPS);
    expect(s.required).toBeUndefined();
    expect(s.additionalProperties).toBeUndefined();
  });

  it('accepts required / additionalProperties when explicitly asked for', () =>
  {
    const s = ParamManager.buildObjectSchema('Opening', OPENING_PROPS,
      { required: ['width'], additionalProperties: false, title: 'Hole', labelProp: 'name' });

    expect(s.required).toEqual(['width']);
    expect(s.additionalProperties).toBe(false);
    expect(s.title).toBe('Hole');
    expect(s.labelProp).toBe('name');
  });

  it('names the offending property when one is malformed', () =>
  {
    expect(() => ParamManager.buildObjectSchema('Opening', { wall: 'options' } as any))
      .toThrow(/wall/);
  });

  it('rejects an empty property map', () =>
  {
    expect(() => ParamManager.buildObjectSchema('Opening', {})).toThrow();
  });
});

// ── blank entries ────────────────────────────────────────────────────────────

describe('ParamManager.objectDefaults()', () =>
{
  it('fills every property, so "add" never yields a half-built entry', () =>
  {
    expect(ParamManager.objectDefaults(ParamManager.buildObjectSchema('Opening', OPENING_PROPS)))
      .toEqual({ name: '', wall: 'left', width: 1200, active: true });
  });

  it('falls back per type when a property has no default', () =>
  {
    const s = ParamManager.buildObjectSchema('T', {
      n: 'number', t: 'text', b: 'boolean', m: { type: 'number', min: 5, max: 9 },
    });
    expect(ParamManager.objectDefaults(s)).toEqual({ n: 0, t: '', b: false, m: 5 });
  });
});

// ── entry labels ─────────────────────────────────────────────────────────────

describe('ParamManager.objectEntryLabel()', () =>
{
  const schema = ParamManager.buildObjectSchema('Opening', OPENING_PROPS);

  it('uses the conventional name property', () =>
  {
    expect(ParamManager.objectEntryLabel(schema, { name: 'kitchen window' }, 0)).toBe('kitchen window');
  });

  it('prefers an explicit labelProp over name', () =>
  {
    const withProp = ParamManager.buildObjectSchema('Opening', OPENING_PROPS, { labelProp: 'wall' });
    expect(ParamManager.objectEntryLabel(withProp, { name: 'a', wall: 'front' }, 0)).toBe('front');
  });

  it('falls back to a positional label — including for a blank name', () =>
  {
    expect(ParamManager.objectEntryLabel(schema, {}, 0)).toBe('Opening 1');
    expect(ParamManager.objectEntryLabel(schema, { name: '   ' }, 2)).toBe('Opening 3');
  });
});
