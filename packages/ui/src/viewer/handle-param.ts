import type { HandleAxis, HandleParamMap } from '@archiyou/core/src/interaction/types';

/** The drag scalars model-viewer hands to script map functions at drag end.
 *  `x`/`y`/`z` are the handle's world position; `u`/`v` its projection onto the drag axes,
 *  which under a relative range is the drag delta (see _resolveHandleScalars). */
export interface HandleDragScalars
{
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

/** Split a param reference into its name and, for `NAME[index]`, its element index.
 *  Mirrors Handle.parseParamRef() in core so both ends read a reference the same way —
 *  the viewer cannot import the core class here without dragging the kernel in with it. */
export function parseParamRef(ref: string): { name: string; index: number | null }
{
  const m = /^\s*([^[\s]+)\s*\[\s*(\d+)\s*\]\s*$/.exec(ref ?? '');
  return m ? { name: m[1]!, index: Number(m[2]) } : { name: (ref ?? '').trim(), index: null };
}

/** Round to a schema `multipleOf` and clamp to its `minimum`/`maximum`.
 *
 *  This is not optional politeness. ScriptParam.validateValue() runs one TypeBox Check over
 *  the whole param value, so a `left` of 1234.7 against `multipleOf: 10` fails the entire
 *  write and the drag appears to do nothing at all. Deliberately NOT folded into
 *  model-viewer's PARAM_MAP_PRECHECKS: that table snaps but never clamps, and clamping
 *  there would turn its "reject an out-of-range map-fn result with a warning" into
 *  "silently accept it". */
export function snapClampToSchema(value: any, propSchema: Record<string, any> | undefined): any
{
  if (typeof value !== 'number' || !isFinite(value) || !propSchema) return value;

  let v = value;
  const step = propSchema['multipleOf'];
  if (typeof step === 'number' && step > 0) v = Math.round(v / step) * step;

  // Bounds win over the step: an out-of-range value is rejected by validation, an
  // off-grid one usually is not.
  const min = propSchema['minimum'];
  const max = propSchema['maximum'];
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

/**
 * Apply one finished drag to an object-valued param via its declarative axis → property
 * map, returning a NEW object.
 *
 * Two modes, chosen by the script through range() rather than by a separate flag:
 *
 *   absolute (`.range(0, 4000)`)          prop  = handle[axis]
 *   relative (`.range('-4000','+4000')`)  prop += handle[axis]     (a delta)
 *
 * Relative is the robust one: it needs no correspondence between a property value and a
 * world coordinate, so it survives geometry that is offset, rotated or nested.
 *
 * Kept pure — no signals, THREE or DOM — because this is where the schema constraints are
 * actually enforced, and that is the part worth testing.
 *
 * @param objectSchema  the JSON Schema of the object being written (an `object` param's own
 *                      schema, or `schema.items` for one entry of an object list).
 * @param onWarn        called once per property the schema does not declare.
 * @returns the new object, or null when the map cannot be applied at all.
 */
export function applyParamMap(
  handle: HandleDragScalars,
  value: Record<string, any>,
  map: HandleParamMap,
  relative: boolean,
  objectSchema: Record<string, any>,
  onWarn?: (message: string) => void,
): Record<string, any> | null
{
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const properties = (objectSchema?.['properties'] ?? {}) as Record<string, Record<string, any>>;
  const next: Record<string, any> = { ...value };

  Object.entries(map).forEach(([axis, prop]) =>
  {
    if (!prop) return;
    const scalar = handle[axis as HandleAxis];
    if (typeof scalar !== 'number') return;

    // An undeclared property is a typo far more often than an intent. Writing it would add
    // a stray key that can fail validation outright under additionalProperties:false.
    if (!properties[prop])
    {
      onWarn?.(`no property "${prop}" on this value — known: ${Object.keys(properties).join(', ') || '(none)'}`);
      return;
    }

    const current = next[prop];
    next[prop] = relative ? (typeof current === 'number' ? current + scalar : scalar) : scalar;
    next[prop] = snapClampToSchema(next[prop], properties[prop]);
  });

  return next;
}

/** Snap and clamp whatever a map FUNCTION changed. The function is free-form, so the
 *  properties it touched are found by diffing — which keeps the escape hatch subject to
 *  the same schema constraints as the declarative map. */
export function snapClampChanged(
  before: Record<string, any>,
  after: Record<string, any>,
  objectSchema: Record<string, any>,
): Record<string, any>
{
  const properties = (objectSchema?.['properties'] ?? {}) as Record<string, Record<string, any>>;
  const next = { ...after };
  Object.keys(next).forEach((prop) =>
  {
    if (next[prop] === before[prop]) return; // untouched — leave the user's value exactly as-is
    next[prop] = snapClampToSchema(next[prop], properties[prop]);
  });
  return next;
}
