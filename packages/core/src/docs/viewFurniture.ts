/**
 *  viewFurniture.ts
 *
 *  What a drawing carries besides its geometry: a caption saying what it is and at what
 *  scale, and a graduated bar saying the same thing in geometry rather than in words (which
 *  is the half that survives being photocopied or rescaled).
 *
 *  It is drawn in PAGE MILLIMETERS — the page SVG's user unit is 1mm throughout — in a band
 *  reserved at the bottom of the view. The drawing above it is given the rest, so nothing
 *  ever overlaps and the view's footprint on the page is exactly what the script asked for.
 *
 *  Reaching the PDF costs nothing: the exporter paints the page SVG through svg2pdf, so
 *  whatever is written here is drawn there too — provided every `<text>` carries BOTH
 *  `dominant-baseline` (browsers) and `alignment-baseline` (svg2pdf), which is the same pair
 *  Container.toSVG() uses for its own captions.
 */

import type { BarOptions, CaptionOptions, ContainerHAlignment } from './types'
import type { ModelUnits } from '../modeler/types'
import type { ResolvedScale } from './scale'
import { escapeXml, SVG_TEXT_FONT_FAMILY } from './utils'
import { MM_PER_UNIT, formatLength } from '../units/UnitConverter'

//// SIZES (millimeters on the page) ////

const CAPTION_SIZE_MM = 3
const CAPTION_GAP_MM  = 1.5
const BAR_HEIGHT_MM   = 1.5
const BAR_LABEL_SIZE_MM = 2.5
const BAR_GAP_MM      = 1.5
const BAR_LINE_MM     = 0.25
/** How much of the view's width an 'auto' bar aims to take. */
const BAR_TARGET_FRACTION = 1/3

export interface FurnitureInput
{
    /** The view's box on the page. */
    wMm:number
    hMm:number
    /*  Where the DRAWING actually sits across that box, in page millimeters.
        A caption belongs under the drawing, not under the container: a view at a fixed scale
        frames the whole box and anchors the geometry in a corner of it, so the two are only
        the same thing when the drawing happens to fill its view. Left/center/right are read
        against this span; without one they fall back to the box. */
    drawingXMm?:{ min:number, max:number }
    /** Resolved by the view — the bar's length and the caption's label both come from it. */
    scale:ResolvedScale|null
    /** Default caption text. */
    name?:string
    caption?:boolean|string|CaptionOptions
    bar?:boolean|BarOptions
    modelUnits?:ModelUnits
    unitSystem?:'metric'|'imperial'
    /** True when the script asked for a scale, rather than the view fitting the drawing.
     *  A fitted drawing has no scale worth printing. */
    hasRequestedScale?:boolean
}

export interface Furniture
{
    /** Height reserved at the bottom of the view. 0 when there is nothing to draw. */
    bandMm:number
    /** SVG elements, in page millimeters, positioned within the view's own box. */
    svg:string
}

/** Lay out and draw a view's caption and scale bar. */
export function buildViewFurniture(input:FurnitureInput):Furniture
{
    const caption = normalizeCaption(input);
    const bar = normalizeBar(input);

    if(!caption && !bar){ return { bandMm: 0, svg: '' } }

    const barBlockMm = bar ? bar.heightMm + (bar.labels ? BAR_GAP_MM + BAR_LABEL_SIZE_MM : 0) : 0;
    const captionBlockMm = caption ? caption.sizeMm : 0;

    const bandMm = (bar ? BAR_GAP_MM + barBlockMm : 0)
                 + (caption ? CAPTION_GAP_MM + captionBlockMm : 0);

    // The band hangs off the bottom of the view box.
    let y = input.hMm - bandMm;
    const parts:Array<string> = [];

    if(bar)
    {
        y += BAR_GAP_MM;
        parts.push(drawBar(bar, input.wMm, y, input.drawingXMm));
        y += barBlockMm;
    }

    if(caption)
    {
        y += CAPTION_GAP_MM;
        parts.push(drawCaption(caption, input.wMm, y, input.drawingXMm));
    }

    return { bandMm, svg: `<g class="view-furniture">${parts.join('')}</g>` };
}

//// CAPTION ////

interface ResolvedCaption { text:string, sizeMm:number, align:ContainerHAlignment, color:string }

function normalizeCaption(input:FurnitureInput):ResolvedCaption|null
{
    const o = input.caption;
    if(!o){ return null }

    const options:CaptionOptions = (o === true) ? {}
                                 : (typeof o === 'string') ? { text: o }
                                 : o;

    const name = options.text ?? input.name ?? '';
    // A fitted drawing is at no particular scale, so saying one would be noise — unless the
    // script asks for it outright.
    const withScale = options.scale ?? !!input.hasRequestedScale;
    const label = withScale ? (input.scale?.label ?? '') : '';

    const format = options.format ?? '{name} — {scale}';
    let text = (name && label) ? format.replace('{name}', name).replace('{scale}', label)
             : (name || label);
    text = text.trim();

    if(!text){ return null }

    return {
        text,
        sizeMm: options.size ?? CAPTION_SIZE_MM,
        align: options.align ?? 'center',
        color: options.color ?? 'black',
    };
}

function drawCaption(c:ResolvedCaption, wMm:number, yMm:number, extent?:{ min:number, max:number }):string
{
    const { x, anchor } = alignX(c.align, wMm, extent);
    return `<text class="view-caption" x="${fmt(x)}" y="${fmt(yMm)}"`
        + ` font-family="${SVG_TEXT_FONT_FAMILY}" font-size="${fmt(c.sizeMm)}" fill="${c.color}"`
        + ` text-anchor="${anchor}" dominant-baseline="text-before-edge" alignment-baseline="text-before-edge"`
        + `>${escapeXml(c.text)}</text>`;
}

//// SCALE BAR ////

interface ResolvedBar
{
    /** Length on the page. */
    lengthMm:number
    /** The same length in model units, for the labels. */
    lengthUnits:number
    divisions:number
    heightMm:number
    align:ContainerHAlignment
    style:'alternating'|'ticks'
    labels:boolean
    unitSystem?:'metric'|'imperial'
    modelUnits?:ModelUnits
}

function normalizeBar(input:FurnitureInput):ResolvedBar|null
{
    const o = input.bar;
    if(!o){ return null }
    if(!input.scale || !(input.scale.unitsPerMm > 0)){ return null }

    const options:BarOptions = (o === true) ? {} : o;
    const unitsPerMm = input.scale.unitsPerMm;

    const lengthUnits = (typeof options.length === 'number' && options.length > 0)
                            ? options.length
                            : niceLength(input.wMm * BAR_TARGET_FRACTION * unitsPerMm);

    const lengthMm = lengthUnits / unitsPerMm;
    if(!(lengthMm > 0) || lengthMm > input.wMm){ return null } // no room for a bar

    return {
        lengthMm,
        lengthUnits,
        divisions: Math.max(1, Math.round(options.divisions ?? 4)),
        heightMm: options.height ?? BAR_HEIGHT_MM,
        align: options.align ?? 'left',
        style: options.style ?? 'alternating',
        labels: options.labels !== false,
        unitSystem: input.unitSystem,
        modelUnits: options.units && options.units !== 'auto' ? options.units : input.modelUnits,
    };
}

/** A round number to put on a scale bar: 1, 2 or 5 times a power of ten, at or below `n`.
 *  A bar reading "1.83m" tells you nothing you can measure with. */
function niceLength(n:number):number
{
    if(!(n > 0)){ return 0 }
    const magnitude = Math.pow(10, Math.floor(Math.log10(n)));
    for(const step of [5, 2, 1])
    {
        if(magnitude * step <= n){ return magnitude * step }
    }
    return magnitude;
}

function drawBar(b:ResolvedBar, wMm:number, yMm:number, extent?:{ min:number, max:number }):string
{
    const { x: originX, anchor } = alignX(b.align, wMm, extent);
    const x0 = (anchor === 'middle') ? originX - b.lengthMm/2
             : (anchor === 'end') ? originX - b.lengthMm
             : originX;

    const segment = b.lengthMm / b.divisions;
    const parts:Array<string> = [];

    if(b.style === 'ticks')
    {
        parts.push(`<line x1="${fmt(x0)}" y1="${fmt(yMm + b.heightMm)}" x2="${fmt(x0 + b.lengthMm)}" y2="${fmt(yMm + b.heightMm)}"`
            + ` stroke="black" stroke-width="${fmt(BAR_LINE_MM)}"/>`);
        for(let i = 0; i <= b.divisions; i++)
        {
            const x = x0 + i*segment;
            parts.push(`<line x1="${fmt(x)}" y1="${fmt(yMm)}" x2="${fmt(x)}" y2="${fmt(yMm + b.heightMm)}"`
                + ` stroke="black" stroke-width="${fmt(BAR_LINE_MM)}"/>`);
        }
    }
    else
    {
        // Alternating filled and open segments — the checkerboard on every map legend.
        for(let i = 0; i < b.divisions; i++)
        {
            parts.push(`<rect x="${fmt(x0 + i*segment)}" y="${fmt(yMm)}" width="${fmt(segment)}" height="${fmt(b.heightMm)}"`
                + ` fill="${(i % 2 === 0) ? 'black' : 'white'}" stroke="black" stroke-width="${fmt(BAR_LINE_MM)}"/>`);
        }
    }

    if(b.labels)
    {
        const labelY = yMm + b.heightMm + BAR_GAP_MM;
        const end = formatBarLength(b.lengthUnits, b);
        parts.push(barLabel('0', x0, labelY, 'middle'));
        parts.push(barLabel(end, x0 + b.lengthMm, labelY, 'middle'));
    }

    return parts.join('');
}

function barLabel(text:string, xMm:number, yMm:number, anchor:string):string
{
    return `<text class="view-bar-label" x="${fmt(xMm)}" y="${fmt(yMm)}"`
        + ` font-family="${SVG_TEXT_FONT_FAMILY}" font-size="${fmt(BAR_LABEL_SIZE_MM)}" fill="black"`
        + ` text-anchor="${anchor}" dominant-baseline="text-before-edge" alignment-baseline="text-before-edge"`
        + `>${escapeXml(text)}</text>`;
}

/** The bar's length written for a reader: "2 m", "500 mm", "6'-0"" — in the unit system the
 *  rest of the drawing's numbers use. */
function formatBarLength(units:number, b:ResolvedBar):string
{
    const mmPerUnit = MM_PER_UNIT[b.modelUnits as ModelUnits];
    if(!(mmPerUnit > 0)){ return `${roundNice(units)}` }

    return formatLength(units * mmPerUnit, b.unitSystem ?? 'metric', { withUnit: true });
}

//// SHARED ////

function alignX(align:ContainerHAlignment, wMm:number, extent?:{ min:number, max:number }):{ x:number, anchor:string }
{
    const min = extent?.min ?? 0;
    const max = extent?.max ?? wMm;

    switch(align)
    {
        case 'left':   return { x: min, anchor: 'start' }
        case 'right':  return { x: max, anchor: 'end' }
        default:       return { x: (min + max)/2, anchor: 'middle' }
    }
}

const fmt = (n:number) => +n.toFixed(4)
const roundNice = (n:number) => (Math.abs(n - Math.round(n)) < 0.005) ? Math.round(n) : +n.toFixed(2)
