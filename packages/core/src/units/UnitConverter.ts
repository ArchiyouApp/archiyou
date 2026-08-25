/**
 * UnitConverter — pure, dependency-free unit conversion & formatting.
 *
 * Geometry in archiyou is always expressed in a script's *source* model unit
 * (`Modeler.units()`, default `mm`). This module converts raw numbers from that
 * source unit into a chosen unit *system* (metric or imperial) for display, and
 * formats them — auto-picking a sensible unit and, for imperial, using fractional
 * inches (e.g. `1' 6 1/2"`). It never mutates geometry; it is presentation-only.
 *
 * Reused by the annotator (dimension lines), docs (SVG/PDF), the 3D viewer and
 * the param UI, so it must stay free of any module/DOM dependencies.
 */

import type { ModelUnits } from '../modeler/types'

export type UnitSystem = 'metric' | 'imperial'

// ─── Conversion table (millimetres per unit) ────────────────────────────────

/** Millimetres in one of each unit. */
export const MM_PER_UNIT: Record<ModelUnits, number> = {
    mm:   1,
    cm:   10,
    dm:   100,
    m:    1000,
    km:   1_000_000,
    inch: 25.4,
    feet: 304.8,
    yd:   914.4,
    mi:   1_609_344,
}

/** Units belonging to each system, smallest → largest. */
export const UNIT_SYSTEMS: Record<UnitSystem, ModelUnits[]> = {
    metric:   ['mm', 'cm', 'dm', 'm', 'km'],
    imperial: ['inch', 'feet', 'yd', 'mi'],
}

/** Which system a unit belongs to. */
export function systemOfUnit(unit: ModelUnits): UnitSystem
{
    return UNIT_SYSTEMS.imperial.includes(unit) ? 'imperial' : 'metric';
}

// ─── Editable-value display precision (param UI) ─────────────────────────────

/**
 * Decimal places used when displaying an *editable* param value, per unit.
 * Millimetres show whole integers (a fraction of a mm is meaningless in the
 * UI); every other unit shows 2 decimals. Adjust per unit here — this is the
 * single source of truth for param-value rounding.
 */
export const PARAM_DISPLAY_DECIMALS: Record<ModelUnits, number> = {
    mm:   0,
    cm:   2,
    dm:   2,
    m:    2,
    km:   2,
    inch: 2,
    feet: 2,
    yd:   2,
    mi:   2,
}

/** Decimals to show for an editable value in `unit`. Unitless (null) → 2. */
export function paramDisplayDecimals(unit: ModelUnits | null | undefined): number
{
    if (!unit) return 2;
    return PARAM_DISPLAY_DECIMALS[unit] ?? 2;
}

/** Max decimals a step-derived precision may ask for (guards odd/converted steps). */
export const PARAM_MAX_STEP_DECIMALS = 6;

/**
 * Decimals needed to display values on a `step` grid: step 1 → 0, 0.1 → 1,
 * 0.25 → 2, 0.001 → 3. Non-finite/non-positive steps → null (no opinion), so
 * callers can fall back to the per-unit default.
 */
export function stepDecimals(step: number | null | undefined): number | null
{
    if (step === null || step === undefined) return null;
    if (!Number.isFinite(step) || step <= 0) return null;

    // Walk the decimals up until the step lands on the grid it implies. Uses a
    // relative epsilon so 0.1/0.3-style float noise doesn't cost extra digits.
    for (let d = 0; d <= PARAM_MAX_STEP_DECIMALS; d++)
    {
        const scaled = step * Math.pow(10, d);
        if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d;
    }
    return null;
}

/** The canonical base unit of a system: metric → 'mm', imperial → 'inch'. */
export function baseUnitForSystem(system: UnitSystem): ModelUnits
{
    return system === 'imperial' ? 'inch' : 'mm';
}

// ─── Tunable thresholds ─────────────────────────────────────────────────────

/** Denominator for imperial fractional inches (16 = nearest 1/16"). */
export const IMPERIAL_FRACTION_DENOM = 16;

/** Below this many mm imperial readouts use inches, above it feet(+inches). */
export const FEET_THRESHOLD_MM = 2000;   // ≈ 6.5 ft — 1000mm→inch, 10m→feet

/** At/above this many mm imperial readouts switch to miles. */
export const MILE_THRESHOLD_MM = 0.5 * MM_PER_UNIT.mi;

/** At/above this many mm metric readouts use metres; below it, millimetres. */
export const METRE_THRESHOLD_MM = 1000;

/** At/above this many mm metric readouts use kilometres. */
export const KM_THRESHOLD_MM = MM_PER_UNIT.km;

// ─── Primitive conversion ───────────────────────────────────────────────────

/** Convert a value expressed in `unit` to millimetres. */
export function toMM(value: number, unit: ModelUnits): number
{
    const f = MM_PER_UNIT[unit];
    if (f === undefined) { console.warn(`UnitConverter::toMM(): unknown unit "${unit}", treating as mm`); return value; }
    return value * f;
}

/** Convert a value in millimetres to `unit`. */
export function fromMM(mm: number, unit: ModelUnits): number
{
    const f = MM_PER_UNIT[unit];
    if (f === undefined) { console.warn(`UnitConverter::fromMM(): unknown unit "${unit}", treating as mm`); return mm; }
    return mm / f;
}

/** Convert a value directly between two units. */
export function convert(value: number, from: ModelUnits, to: ModelUnits): number
{
    return fromMM(toMM(value, from), to);
}

// ─── Auto unit selection ────────────────────────────────────────────────────

export interface PickUnitOpts
{
    feetThresholdMm?: number;
    mileThresholdMm?: number;
    metreThresholdMm?: number;
    kmThresholdMm?: number;
}

/**
 * Pick the most readable unit for a length (given in mm) within a system.
 * Metric:   < 1000mm → mm, < 1e6 → m, else km.
 * Imperial: < ~2000mm → inch, < 0.5mi → feet, else mi.
 */
export function pickBestUnit(mm: number, system: UnitSystem, opts: PickUnitOpts = {}): ModelUnits
{
    const a = Math.abs(mm);
    if (system === 'imperial')
    {
        if (a >= (opts.mileThresholdMm ?? MILE_THRESHOLD_MM)) return 'mi';
        if (a >= (opts.feetThresholdMm ?? FEET_THRESHOLD_MM)) return 'feet';
        return 'inch';
    }
    if (a >= (opts.kmThresholdMm    ?? KM_THRESHOLD_MM))    return 'km';
    if (a >= (opts.metreThresholdMm ?? METRE_THRESHOLD_MM)) return 'm';
    return 'mm';
}

// ─── Fractional inches ──────────────────────────────────────────────────────

export interface InchFraction { whole: number; num: number; den: number; neg: boolean }

/** Greatest common divisor. */
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/**
 * Round a decimal inch value to the nearest 1/denom and split into whole +
 * reduced fraction. Carries when the fraction rounds up to a full unit.
 * e.g. 6.5 → {whole:6, num:1, den:2}; 6.999(→16/16) → {whole:7, num:0, den:1}.
 */
export function toFraction(inchDecimal: number, denom: number = IMPERIAL_FRACTION_DENOM): InchFraction
{
    const neg = inchDecimal < 0;
    const abs = Math.abs(inchDecimal);
    let whole = Math.floor(abs);
    let num   = Math.round((abs - whole) * denom);
    if (num === denom) { whole += 1; num = 0; }
    if (num === 0)     { return { whole, num: 0, den: 1, neg }; }
    const g = gcd(num, denom);
    return { whole, num: num / g, den: denom / g, neg };
}

// ─── Snapping to "nice" values ──────────────────────────────────────────────

/**
 * Snap a length (in mm) to a nice value in the given system, so switching units
 * yields clean numbers: imperial → nearest 1/denom inch (e.g. 25mm → 25.4mm = 1"),
 * metric → nearest whole millimetre (e.g. 25.4mm → 25mm). Returned value is in mm.
 */
export function snapMMToSystem(mm: number, system: UnitSystem, fractionDenom: number = IMPERIAL_FRACTION_DENOM): number
{
    if (system === 'imperial')
    {
        const step = MM_PER_UNIT.inch / fractionDenom; // e.g. 25.4/16
        return Math.round(mm / step) * step;
    }
    return Math.round(mm); // nearest millimetre
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export interface FormatOpts extends PickUnitOpts
{
    /** Fixed display unit; when omitted, auto-picked via pickBestUnit. */
    unit?: ModelUnits;
    /** Fractional denominator for imperial (default 1/16). */
    fractionDenom?: number;
    /** Decimal places for metric (default: unit-dependent). */
    metricDecimals?: number;
    /** Append the unit symbol/label (default true). */
    withUnit?: boolean;
}

/** Format a fractional-inch string like `6 1/2"`, `6"`, `1/2"`. */
function fractionToInchStr(f: InchFraction, withUnit: boolean): string
{
    const sym = withUnit ? '"' : '';
    let body: string;
    if (f.num === 0)        { body = `${f.whole}`; }
    else if (f.whole === 0) { body = `${f.num}/${f.den}`; }
    else                    { body = `${f.whole} ${f.num}/${f.den}`; }
    return `${f.neg ? '-' : ''}${body}${sym}`;
}

/** Format a length (in mm) as imperial with fractional inches. */
export function formatImperial(mm: number, opts: FormatOpts = {}): string
{
    const withUnit = opts.withUnit !== false;
    const denom    = opts.fractionDenom ?? IMPERIAL_FRACTION_DENOM;
    const unit     = opts.unit ?? pickBestUnit(mm, 'imperial', opts);

    if (unit === 'inch')
    {
        return fractionToInchStr(toFraction(fromMM(mm, 'inch'), denom), withUnit);
    }
    if (unit === 'feet')
    {
        const neg        = mm < 0;
        const totalInch  = Math.abs(fromMM(mm, 'inch'));
        const feet       = Math.floor(totalInch / 12);
        const frac       = toFraction(totalInch - feet * 12, denom);
        // fraction may carry the inch remainder up to 12 → roll into feet
        let ft = feet, inchWhole = frac.whole, inchNum = frac.num, inchDen = frac.den;
        if (inchWhole >= 12) { ft += Math.floor(inchWhole / 12); inchWhole = inchWhole % 12; }
        const feetStr = `${neg ? '-' : ''}${ft}'`;
        const inchPart: InchFraction = { whole: inchWhole, num: inchNum, den: inchDen, neg: false };
        const inchStr = (inchWhole === 0 && inchNum === 0)
            ? (withUnit ? '' : '')
            : ' ' + fractionToInchStr(inchPart, withUnit);
        return `${feetStr}${inchStr}`;
    }
    // yd / mi — decimal
    const v = fromMM(mm, unit);
    return `${roundStr(v, 2)}${withUnit ? ' ' + unit : ''}`;
}

/** Format a length (in mm) as metric. */
export function formatMetric(mm: number, opts: FormatOpts = {}): string
{
    const withUnit = opts.withUnit !== false;
    const unit     = opts.unit ?? pickBestUnit(mm, 'metric', opts);
    const decimals = opts.metricDecimals ?? defaultMetricDecimals(unit);
    const v        = fromMM(mm, unit);
    return `${roundStr(v, decimals)}${withUnit ? ' ' + unit : ''}`;
}

/** Top-level: format a length (in mm) for a system. */
export function formatLength(mm: number, system: UnitSystem, opts: FormatOpts = {}): string
{
    return system === 'imperial' ? formatImperial(mm, opts) : formatMetric(mm, opts);
}

/**
 * Convenience: format a value expressed in `sourceUnit` (the script's model
 * unit) into `system`.
 */
export function formatFromUnit(value: number, sourceUnit: ModelUnits, system: UnitSystem, opts: FormatOpts = {}): string
{
    return formatLength(toMM(value, sourceUnit), system, opts);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function defaultMetricDecimals(unit: ModelUnits): number
{
    switch (unit)
    {
        case 'mm': return 0;
        case 'cm': return 1;
        case 'dm': return 2;
        case 'm':  return 3;
        case 'km': return 3;
        default:   return 2;
    }
}

/** Round to `decimals` and drop trailing zeros. */
function roundStr(v: number, decimals: number): string
{
    const f = Math.pow(10, decimals);
    const r = Math.round(v * f) / f;
    return String(r);
}
