/**
 *  scale.ts
 *
 *  What scale a drawing is shown at, and what to call it.
 *
 *  A view has always fitted its drawing to whatever room it had, so the same elevation came
 *  out at a different scale in every view and no drawing could honestly say "1:100". This is
 *  the arithmetic behind saying it: pure, no DOM, no Container, so it can be tested on its
 *  own and called from both toData() and the renderer without the two drifting apart.
 *
 *  The units: a scale RATIO is page length over model length, both as real-world lengths
 *  (1/100 = one millimeter of paper per hundred millimeters of building). What the renderer
 *  needs is `unitsPerMm` — MODEL units per page millimeter — which is the ratio inverted and
 *  converted through the model's own unit:
 *
 *      unitsPerMm = 1 / (ratio * MM_PER_UNIT[modelUnits])
 *
 *  The page side is always millimeters (Page.toSVG works in mm whatever the doc units are),
 *  so no unit system enters the arithmetic at all — only the LABEL is a metric/imperial
 *  matter.
 */

import { MM_PER_UNIT, toFraction } from '../units/UnitConverter'
import type { ModelUnits } from '../modeler/types'
import type { ScaleInput } from './types'

/** Standard metric drawing scales, largest first. The ladder an architect actually uses —
 *  enlargements at the top, then the 1, 2, 5 progression. */
export const METRIC_SCALE_LADDER:Array<number> = [
    5, 2, 1,
    1/2, 1/5, 1/10, 1/20, 1/25, 1/50, 1/100, 1/200, 1/250, 1/500, 1/1000, 1/2000, 1/5000,
]

/** Standard imperial (US architectural) scales, largest first, as ratios.
 *  1:12 is 1"=1', 1:48 is 1/4"=1', and so on down to 1/32"=1'. */
export const IMPERIAL_SCALE_LADDER:Array<number> = [
    2, 1,
    1/2, 1/4, 1/8, 1/12, 1/16, 1/24, 1/32, 1/48, 1/64, 1/96, 1/192, 1/384,
]

export function scaleLadder(unitSystem?:'metric'|'imperial'):Array<number>
{
    return (unitSystem === 'imperial') ? IMPERIAL_SCALE_LADDER : METRIC_SCALE_LADDER
}

//// PARSING ////

/** A scale as written by a human.
 *
 *  Accepts what people actually type: a plain ratio (1/100, 0.01, 2 for 2:1), the drawing
 *  convention ('1:100'), and the imperial architect's form ('1/4"=1\'', '3/8 in = 1 ft').
 *  Returns null for anything it cannot read, so callers can say what was wrong. */
export function parseScaleRatio(input:number|string):number|null
{
    if(typeof input === 'number'){ return (isFinite(input) && input > 0) ? input : null }
    if(typeof input !== 'string'){ return null }

    const s = input.trim().toLowerCase();
    if(s === '' || s === 'fit' || s === 'auto'){ return null }

    // '1:100' / '1 : 100' — and '2:1' for an enlargement
    const colon = s.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if(colon)
    {
        const a = parseFloat(colon[1]); const b = parseFloat(colon[2]);
        return (b > 0) ? a / b : null;
    }

    // '1/4" = 1'' — inches on the page per foot of building, the US architectural form
    const perFoot = s.match(/^([\d\s./]+)\s*(?:"|''|in|inch|inches)?\s*=\s*([\d\s./]*)\s*(?:'|ft|foot|feet)$/);
    if(perFoot)
    {
        const inches = parseMixedNumber(perFoot[1]);
        const feet = perFoot[2].trim() === '' ? 1 : parseMixedNumber(perFoot[2]);
        if(inches === null || feet === null || !(feet > 0)){ return null }
        return inches / (feet * 12);
    }

    // '1/100' or a plain '0.01'
    const value = parseMixedNumber(s);
    return (value !== null && value > 0) ? value : null;
}

/** '3', '1/4', '1 1/2' → 3, 0.25, 1.5 */
function parseMixedNumber(s:string):number|null
{
    const parts = s.trim().split(/\s+/).filter(Boolean);
    if(parts.length === 0){ return null }

    let total = 0;
    for(const part of parts)
    {
        const frac = part.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
        if(frac)
        {
            const d = parseFloat(frac[2]);
            if(!(d > 0)){ return null }
            total += parseFloat(frac[1]) / d;
            continue;
        }
        if(!/^\d+(\.\d+)?$/.test(part)){ return null }
        total += parseFloat(part);
    }
    return total;
}

//// LABELS ////

/** How a scale is written on a drawing.
 *  '1:100' in metric; the architect's '1/4" = 1'-0"' in imperial when the ratio is one of the
 *  standard ones, since that is how such a drawing is read. */
export function scaleLabel(ratio:number, unitSystem?:'metric'|'imperial'):string
{
    if(!(ratio > 0) || !isFinite(ratio)){ return '' }

    if(unitSystem === 'imperial')
    {
        const inchesPerFoot = ratio * 12;
        // Only for scales that land on a sensible fraction of an inch — otherwise the
        // architect's form is less readable than the plain ratio it stands for.
        const f = toFraction(inchesPerFoot, 32);
        const exact = f.whole + (f.den ? f.num / f.den : 0);
        if(Math.abs(exact - inchesPerFoot) < 1e-9 && inchesPerFoot > 0 && inchesPerFoot <= 12)
        {
            const text = (f.num === 0) ? `${f.whole}`
                        : (f.whole > 0) ? `${f.whole} ${f.num}/${f.den}`
                        : `${f.num}/${f.den}`;
            return `${text}" = 1'-0"`;
        }
    }

    if(ratio >= 1)
    {
        return `${roundNice(ratio)}:1`;
    }
    return `1:${roundNice(1/ratio)}`;
}

function roundNice(n:number):number
{
    const rounded = Math.round(n);
    return (Math.abs(n - rounded) < 0.005) ? rounded : +n.toFixed(2);
}

//// RESOLUTION ////

export interface ResolveScaleOptions
{
    /** What the drawing spans, in model units. */
    extents:{ width:number, height:number }
    /** The page area the drawing is given, in millimeters. */
    wMm:number
    hMm:number
    /** Room the annotations need on every side, in page millimeters. */
    marginMm?:number
    modelUnits?:ModelUnits
    unitSystem?:'metric'|'imperial'
    /** 'fit' (default) | 'auto' | a ratio | a list of ratios | '1:100' | '1/4"=1\'' */
    input?:ScaleInput
    /** Only used to say which view a warning is about. */
    name?:string
}

export interface ResolvedScale
{
    /** Page length over model length. 1/100 is 1:100. */
    ratio:number
    /** Model units per page millimeter — what the renderer frames with. */
    unitsPerMm:number
    /** '1:100' — what to print under the drawing. */
    label:string
    /** True when the scale was derived from the room available rather than requested. */
    fitted:boolean
    /** False when the drawing is bigger than its view at this scale (it will be clipped). */
    fits:boolean
    /** The largest standard scale that WOULD have fitted — for the warning, and for
     *  anyone offering to fix it. */
    largestFitting:number|null
}

/** Work out what scale a drawing is shown at. Never throws: a scale that cannot be honoured
 *  falls back to fitting, with one warning saying so. */
export function resolveScale(options:ResolveScaleOptions):ResolvedScale
{
    const marginMm = options.marginMm ?? 0;
    const availableW = options.wMm - 2*marginMm;
    const availableH = options.hMm - 2*marginMm;

    const extW = options.extents?.width ?? 0;
    const extH = options.extents?.height ?? 0;

    const mmPerUnit = MM_PER_UNIT[options.modelUnits as ModelUnits];
    /*  Fitting does not care what the model unit IS — the drawing simply fills the room it
        has — so an unknown unit is no reason to refuse. It only matters for a REQUESTED
        scale, which is a statement about real-world size. */
    const perUnit = (mmPerUnit > 0) ? mmPerUnit : 1;

    /** The ratio at which the drawing exactly fills the room available. */
    const fitRatio = (availableW > 0 && availableH > 0 && extW > 0 && extH > 0)
                        ? Math.min(availableW / (extW * perUnit), availableH / (extH * perUnit))
                        : null;

    const asResolved = (ratio:number, fitted:boolean):ResolvedScale =>
    {
        const unitsPerMm = 1 / (ratio * perUnit);
        const fits = (fitRatio === null) ? true : ratio <= fitRatio * (1 + 1e-9);
        return {
            ratio,
            unitsPerMm,
            label: scaleLabel(ratio, options.unitSystem),
            fitted,
            fits,
            largestFitting: (fitRatio === null) ? null : fitRatio,
        };
    }

    const input = options.input ?? 'fit';

    // No model unit to convert through — a Doc built without a modeler, for instance. Fitting
    // is the one answer that needs no unit, so take it rather than inventing a millimeter.
    if(!(mmPerUnit > 0) && input !== 'fit')
    {
        console.warn(`resolveScale(): no model units available${options.name ? ` for view "${options.name}"` : ''}, `
            + `so the requested scale (${JSON.stringify(input)}) cannot be converted to page millimeters. `
            + `Fitted the drawing to the view instead.`);
        return asResolved(fitRatio ?? 1, true);
    }

    if(input === 'fit' || fitRatio === null && input === 'auto')
    {
        return asResolved(fitRatio ?? 1, true);
    }

    if(input === 'auto' || Array.isArray(input))
    {
        const candidates = Array.isArray(input)
                            ? input.map(c => parseScaleRatio(c as any)).filter((r):r is number => r !== null)
                            : scaleLadder(options.unitSystem);

        if(candidates.length === 0)
        {
            console.warn(`resolveScale(): no usable scales in ${JSON.stringify(input)}`
                + `${options.name ? ` for view "${options.name}"` : ''}. Fitted the drawing to the view instead.`);
            return asResolved(fitRatio ?? 1, true);
        }

        // The largest scale that still fits — the biggest the drawing can honestly be drawn.
        const fitting = candidates.filter(r => fitRatio === null || r <= fitRatio);
        if(fitting.length > 0)
        {
            return asResolved(Math.max(...fitting), false);
        }

        // Nothing fits: take the smallest offered and say so, rather than silently fitting to
        // a nonstandard ratio that the caller did not ask for.
        const smallest = Math.min(...candidates);
        console.warn(`resolveScale(): none of the scales offered${options.name ? ` for view "${options.name}"` : ''} `
            + `fit the drawing in ${round2(options.wMm)}x${round2(options.hMm)}mm — the largest that would is `
            + `${scaleLabel(fitRatio as number, options.unitSystem)}. Used ${scaleLabel(smallest, options.unitSystem)}, `
            + `which will be clipped.`);
        return asResolved(smallest, false);
    }

    const ratio = parseScaleRatio(input as any);
    if(ratio === null)
    {
        console.warn(`resolveScale(): "${input}" is not a scale`
            + `${options.name ? ` (view "${options.name}")` : ''}. Use 'fit', 'auto', a ratio like 1/100, `
            + `a list of them, or a written scale like '1:100'. Fitted the drawing to the view instead.`);
        return asResolved(fitRatio ?? 1, true);
    }

    const resolved = asResolved(ratio, false);

    if(!resolved.fits)
    {
        console.warn(`resolveScale(): at ${resolved.label} the drawing`
            + `${options.name ? ` in view "${options.name}"` : ''} is bigger than the `
            + `${round2(options.wMm)}x${round2(options.hMm)}mm it has to sit in, so it will be clipped. `
            + `The largest scale that fits is ${scaleLabel(fitRatio as number, options.unitSystem)}. `
            + `Use scale:'auto' to pick the largest standard scale that fits.`);
    }

    return resolved;
}

const round2 = (n:number) => Math.round(n*100)/100
