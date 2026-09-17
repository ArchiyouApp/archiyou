/**
 * breputils.ts
 * Utility functions for the brep module.
 * Re-exports selected functions from the main utils and provides brep-specific utilities.
 */

export { isNumeric, hash, toRad, toDeg, uuid4 as uuidv4 } from '../../utils'
export { convertValueFromToUnit } from '../../docs/utils'

// NOTE: typeguards.ts imports from this module too. The cycle is harmless because both sides
// only call across it at runtime, never during module evaluation.
import { isCoordArray, isAnyShape, isPointLike } from './typeguards'

/** Round a coordinate to the kernel's working precision.
 *
 *  3 decimals — matching OpenCascade's SHAPE_TOLERANCE of 0.001 (see OcLoader). Rounding
 *  coarser than the kernel's own tolerance quietly degrades every coordinate that passes
 *  through _fromOcPoint and friends. */
export function roundToTolerance(n: number, decimals: number = 3): number {
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
}

/** Check if code is running in a browser environment */
export function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/** Generate an array of integers from start to end (inclusive).
 *
 *  Accepts numeric strings: the only caller is the Selector's index-range syntax
 *  (`'E[0-3]'`), which hands over raw regex-match groups. Parsing here — rather than
 *  iterating whatever came in — is what stops `i += 1` from concatenating strings forever.
 *  Returns [] for an inverted range. */
export function intRange(start: string | number, end: string | number): number[] {
    const from = typeof start === 'string' ? parseInt(start) : start;
    const to = typeof end === 'string' ? parseInt(end) : end;

    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    if (to < from) return [];

    const result: number[] = [];
    for (let i = from; i <= to; i++) {
        result.push(i);
    }
    return result;
}

/** Flatten a nested array of entities into a single flat array.
 *
 *  Coordinate arrays are left intact: `[[0,0,0],[100,0,0]]` flattens to two points, NOT to
 *  six numbers. Without that guard `new VertexCollection([0,0,0],[100,100,100])` produced one
 *  Vertex per coordinate instead of one per point. */
export function flattenEntities(arr: any[]): any[] {
    return arr.reduce((out: any[], next: any) => {
        if (Array.isArray(next) && !isCoordArray(next)) {
            out.push(...flattenEntities(next));
        }
        else {
            out.push(next);
        }
        return out;
    }, []);
}

/** Flatten ONE level of entities: an inner array is spread only when it is not a coordinate
 *  array and holds nothing but Shapes/PointLikes. Unlike flattenEntities this does not
 *  recurse — it is used where a nested grouping is meaningful. */
export function flattenEntitiesToArray(entities: any): any[] {
    if (!Array.isArray(entities)) return [entities]; // single entity

    const out: any[] = [];
    entities.forEach(e => {
        if (Array.isArray(e) && !isCoordArray(e) && e.every(s => isAnyShape(s) || isPointLike(s))) {
            out.push(...e);
        }
        else {
            out.push(e);
        }
    })
    return out;
}

/** Convert a hex color string (e.g. '#ff0000') to an integer */
export function colorHexToInt(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** Check if a string represents a relative coordinate (prefixed with +/- or ends with %) */
export function isRelativeCoordString(s: any): boolean {
    if (typeof s !== 'string') return false;
    const trimmed = s.trim();
    return /^[+-]/.test(trimmed) || trimmed.endsWith('%');
}

/** Check if a string is a relative cartesian coordinate (e.g. '+10', '-5.5') */
export function isRelativeCartesianCoordString(s: any): boolean {
    if (typeof s !== 'string') return false;
    return /^[+-][0-9.]+$/.test(s.trim());
}

/** Parse a relative polar coordinate string (e.g. '@10<45') into length/angle */
export function parseRelativePolarCoordString(s: string): { length: number; angle: number } | null {
    const match = s.match(/@?([0-9.]+)<([0-9.-]+)/);
    if (!match) return null;
    return { length: parseFloat(match[1]), angle: parseFloat(match[2]) };
}

/** Convert a relative coordinate string to a number, optionally relative to a base value */
export function relativeCoordToNumber(s: string, relValue: number = 0): number {
    if (typeof s !== 'string') return Number(s);
    const trimmed = s.trim();
    if (trimmed.endsWith('%')) {
        return relValue * parseFloat(trimmed) / 100;
    }
    return parseFloat(trimmed);
}

/** Register an OpenCascade object for garbage collection (stub) */
export function targetOcForGarbageCollection(_obj: any): void {
    // OpenCascade GC management - implementation depends on OC wasm bindings
}

/** Unregister an OpenCascade object from garbage collection (stub) */
export function removeOcTargetForGarbageCollection(_obj: any): void {
    // OpenCascade GC management - implementation depends on OC wasm bindings
}

/** The curve parameter at a fraction of the curve's ARC LENGTH — what `pointAt(perc)` means on
 *  the mesh kernel. The bindings have no GCPnts_AbscissaPoint, so the curve is sampled: chord
 *  lengths are accumulated over `samples` parameters, the interval where the running length
 *  passes the target is found, and that interval is sampled again (twice), so a polyline corner
 *  inside an interval costs nothing measurable. `totalLength` is the exact length when the
 *  caller knows it (Edge/Wire.length()), else the chord sum is used. */
export function paramAtLengthPerc(valueAt: (u: number) => { X(): number, Y(): number, Z(): number },
                                  uMin: number, uMax: number, perc: number, totalLength?: number): number
{
    const p = Math.min(1, Math.max(0, perc));
    if (p === 0) return uMin;
    if (p === 1) return uMax;
    const total = (totalLength && totalLength > 0) ? totalLength : chordLength(valueAt, uMin, uMax, 256);
    return paramAtLength(valueAt, uMin, uMax, total * p, 256, 2);
}

function chordLength(valueAt: (u: number) => { X(): number, Y(): number, Z(): number }, uMin: number, uMax: number, samples: number): number
{
    let sum = 0, prev = valueAt(uMin);
    for (let i = 1; i <= samples; i++)
    {
        const pt = valueAt(uMin + (uMax - uMin) * i / samples);
        sum += Math.hypot(pt.X() - prev.X(), pt.Y() - prev.Y(), pt.Z() - prev.Z());
        prev = pt;
    }
    return sum;
}

/** The parameter where the running (chord) length from uMin reaches `target`. */
function paramAtLength(valueAt: (u: number) => { X(): number, Y(): number, Z(): number },
                       uMin: number, uMax: number, target: number, samples: number, depth: number): number
{
    const lengths: Array<number> = [0];
    let prev = valueAt(uMin);
    for (let i = 1; i <= samples; i++)
    {
        const pt = valueAt(uMin + (uMax - uMin) * i / samples);
        lengths.push(lengths[i - 1] + Math.hypot(pt.X() - prev.X(), pt.Y() - prev.Y(), pt.Z() - prev.Z()));
        prev = pt;
    }
    if (!(lengths[samples] > 0)) return uMin;
    if (target >= lengths[samples]) return uMax;
    let i = 1;
    while (i < samples && lengths[i] < target) i++;
    const u0 = uMin + (uMax - uMin) * (i - 1) / samples;
    const u1 = uMin + (uMax - uMin) * i / samples;
    const need = target - lengths[i - 1];
    if (depth <= 0)
    {
        const seg = lengths[i] - lengths[i - 1];
        return u0 + (u1 - u0) * (seg > 0 ? need / seg : 0);
    }
    return paramAtLength(valueAt, u0, u1, need, 64, depth - 1);
}
