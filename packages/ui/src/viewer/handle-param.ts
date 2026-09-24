/** What a map FUNCTION's result means. An object or list value may be changed in place,
 *  so for one a returned value only counts when it is an object or list too: a concise
 *  `(param, handle) => param.left = handle.u` returns the number it assigned, and taking
 *  that would replace the whole object with it. A plain value cannot be changed in place,
 *  so its returned value is the new value (none: unchanged). */
export function mapFunctionResult(copy: any, returned: any): any
{
  const isObject = (v: any) => v !== null && typeof v === 'object';
  if (isObject(copy)) return isObject(returned) ? returned : copy;
  return (returned !== undefined) ? returned : copy;
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

/** Snap and clamp whatever a map FUNCTION changed. The function is free-form, so the
 *  properties it touched are found by diffing, and each one is held to its own schema: a
 *  step:10 `left` of 1234 becomes 1230 instead of failing the whole write. */
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
