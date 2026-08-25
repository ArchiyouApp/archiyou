import type { DocUnitsWithPerc, DocPathStyle, ContainerAlignment } from './types'
import { isDocUnitsWithPerc } from './typeguards'
import { isNumeric } from '../utils'
import { DOC_DEFAULT_SVG_FONT_FAMILY, DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR } from '../constants'

// ─── SVG rendering constants ────────────────────────────────────────────────

export const SVG_TEXT_FONT_FAMILY = DOC_DEFAULT_SVG_FONT_FAMILY;

/** Convert a value between units of measure */
export function convertValueFromToUnit(v:number, from:DocUnitsWithPerc, to:DocUnitsWithPerc, relativeToNum?:number):number
{
    // convert incoming string if numeric
    if (typeof v === 'string' && isNumeric(v))
    {
        v = parseFloat(v);
    }

    const INCH_TO_MM = 25.4;
    const MM_TO_INCH = 0.0393700787;
    const INCH_TO_PNT = 72;

    if( typeof v !== 'number'){ console.warn(`utils::convertValueFromToUnit(): Please supply a number!`); return null; }
    
    if((from === '%' || to === '%') && !relativeToNum ){ console.warn(`utils::convertValueFromToUnit(): Converting from/to % is not supported without a number to which we relate to! Returned original`); return v; } 
    if(!isDocUnitsWithPerc(from) || !isDocUnitsWithPerc(to)){ console.warn(`utils::convertValueFromToUnit(): Please supply valid from/to units ('mm', 'cm', 'inch'). Got "${from}"=>"${to}". Returned original`); return v; } 

    if(from === to)
    {
        return v;
    }
    else if(from === 'inch')
    {
        if(to === 'mm'){ return v*INCH_TO_MM }
        if(to === 'cm'){ return v*INCH_TO_MM/10 }
        if(to === 'pnt'){ return v*INCH_TO_PNT }
        if(to === '%'){ return v/relativeToNum*100 }
    }
    else if(from === 'cm')
    {
        if(to === 'mm'){ return v*10 }
        if(to === 'inch'){ return v*10*MM_TO_INCH }
        if(to === 'pnt'){ return v/10*MM_TO_INCH*INCH_TO_PNT }
        if(to === '%'){ return v/relativeToNum*100 }
    }
    else if(from === 'mm')
    {
        if(to === 'cm'){ return v/10 }
        if(to === 'inch'){ return v*10*MM_TO_INCH }
        if(to === 'pnt'){ return v*MM_TO_INCH*INCH_TO_PNT }
        if(to === '%'){ return v/relativeToNum*100 }
    }
    else if(from === 'pnt')
    {
        if(to === 'mm'){ return v/INCH_TO_PNT*INCH_TO_MM }
        if(to === 'cm'){ return v/INCH_TO_PNT*INCH_TO_MM/10 }
        if(to === 'inch'){ return v/INCH_TO_PNT }
        if(to === '%'){ return v/relativeToNum*100 }
    }
    else if(from === '%')
    {
        if(to === 'mm'){ return v/100*relativeToNum }
        if(to === 'cm'){ return v/100*relativeToNum }
        if(to === 'pnt'){ return v/100*relativeToNum }
        if(to === 'inch'){ return v/100*relativeToNum }
    }

    console.warn(`Doc::_convertValueFromToUnit(): Could not convert. Check values for from ("${from}") and to ("${to}")!`);
    return null;
}

export function pointsToMm(p:number):number
{
    return p*1/72*25.4;
}

export function mmToPoints(m:number):number
{
    return m/25.4*72
}

/** Convert a size value with optional units to font points.
 *  Accepts plain numbers (treated as points), or strings like '7mm', '0.5cm', '0.3inch', '10pnt'.
 */
export function convertSizeUnitsToFontPoints(size: number|string): number
{
    if (typeof size === 'number') { return size; }

    const match = size.match(/^([\d.]+)\s*(mm|cm|inch|pnt)?$/);
    if (!match) { console.warn(`convertSizeUnitsToFontPoints: cannot parse "${size}", returning 0`); return 0; }

    const val = parseFloat(match[1]);
    const unit = match[2] ?? 'pnt';

    if (unit === 'pnt') { return val; }
    if (unit === 'mm')  { return mmToPoints(val); }
    if (unit === 'cm')  { return mmToPoints(val * 10); }
    if (unit === 'inch'){ return val * 72; }

    return val;
}

/**
 * Convert a requested physical text height to a typographic font-size in points.
 *
 * Plain numbers and explicit point sizes remain untouched because they already
 * describe typographic sizes. Physical units like mm/cm/inch are calibrated so
 * the visible glyph height on page better matches the requested height.
 */
export function convertTextHeightUnitsToFontPoints(size: number|string): number
{
    if (typeof size === 'number')
    {
        return size;
    }

    const match = size.match(/^([\d.]+)\s*(mm|cm|inch|pnt)?$/);
    if (!match)
    {
        console.warn(`convertTextHeightUnitsToFontPoints: cannot parse "${size}", returning 0`);
        return 0;
    }

    const unit = match[2] ?? 'pnt';
    const fontSizePt = convertSizeUnitsToFontPoints(size);

    if (unit === 'mm' || unit === 'cm' || unit === 'inch')
    {
        return fontSizePt * DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR;
    }

    return fontSizePt;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string
{
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
}

// ─── SVG utility functions (used by toSVG() on each doc class) ──────────────

/** Escape special XML characters. */
export function escapeXml(s: string): string
{
    if (!s) { return ''; }
    return s
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

/** Serialize a DocPathStyle to SVG presentation attribute string. */
export function pathStyleToSVGAttrs(style?: DocPathStyle): string
{
    if (!style) { return ''; }

    const attrs: string[] = [];
    const fmt = (n: number) => +n.toFixed(4);

    if (style.strokeColor)   { attrs.push(`stroke="${escapeXml(style.strokeColor)}"`); }
    else                     { attrs.push(`stroke="none"`); }

    if (style.fillColor)     { attrs.push(`fill="${escapeXml(style.fillColor)}"`); }
    else                     { attrs.push(`fill="none"`); }

    if (style.lineWidth != null)
    {
        attrs.push(`stroke-width="${fmt(pointsToMm(style.lineWidth))}mm"`);
    }

    if (style.strokeOpacity != null) { attrs.push(`stroke-opacity="${style.strokeOpacity}"`); }
    if (style.fillOpacity   != null) { attrs.push(`fill-opacity="${style.fillOpacity}"`);     }

    if (style.lineCap)  { attrs.push(`stroke-linecap="${style.lineCap}"`);  }
    if (style.lineJoin) { attrs.push(`stroke-linejoin="${style.lineJoin}"`); }

    if (style.lineDashPattern && style.lineDashPattern.length > 0)
    {
        attrs.push(`stroke-dasharray="${style.lineDashPattern.map(n => fmt(pointsToMm(n))).join(' ')}"`);
    }

    return attrs.join(' ');
}

/** Strip XML declaration (<?xml ... ?>) from a string. */
export function stripXMLDeclaration(s: string): string
{
    return s.replace(/<\?xml[^?]*\?>\s*/i, '').trim();
}

/**
 * Strip outer <svg ...>...</svg> tags from an SVG string, keeping inner content.
 * Also removes any <?xml?> declarations.
 */
export function stripOuterSVGTags(svg: string): string
{
    return stripXMLDeclaration(svg)
        .replace(/^[\s\S]*?<svg[^>]*>/i,  '')
        .replace(/<\/svg>\s*$/i,           '')
        .trim();
}

/**
 * Word-wrap text into SVG <tspan> elements.
 * Uses an estimated character width since no font metric API is available.
 */
export function wrapTextToTspans(
    text: string,
    maxWidthMm: number,
    charWidthMm: number,
    lineHeightMm: number,
    xBase: string,
): string
{
    const fmt = (n: number) => +n.toFixed(4);
    const paragraphs = text.split('\n');
    const tspans: string[] = [];
    let firstLine = true;

    for (const para of paragraphs)
    {
        const words  = para.split(/\s+/).filter(w => w.length > 0);
        let   line   = '';
        let   linePx = 0;

        const flushLine = () =>
        {
            const dy = firstLine ? '0' : `${fmt(lineHeightMm)}`;
            tspans.push(`<tspan x="${xBase}" dy="${dy}">${escapeXml(line.trim())}</tspan>`);
            firstLine = false;
            line  = '';
            linePx = 0;
        };

        if (words.length === 0)
        {
            const dy = firstLine ? '0' : `${fmt(lineHeightMm)}`;
            tspans.push(`<tspan x="${xBase}" dy="${dy}"> </tspan>`);
            firstLine = false;
            continue;
        }

        for (const word of words)
        {
            const wordW = (word.length + 1) * charWidthMm;
            if (linePx + wordW > maxWidthMm && line.length > 0) { flushLine(); }
            line   += (line.length > 0 ? ' ' : '') + word;
            linePx += wordW;
        }

        if (line.length > 0) { flushLine(); }
    }

    return tspans.join('');
}

/**
 * Map ContainerAlignment + fit mode to SVG preserveAspectRatio value.
 * Default: xMidYMid meet (center/center, maintain aspect ratio).
 */
export function getPreserveAspectRatio(contentAlign?: ContainerAlignment, fit?: string): string
{
    if (!contentAlign) { return 'xMidYMid meet'; }

    const [h, v]    = contentAlign;
    const resolvedFit = fit ?? 'contain';
    const meetSlice = resolvedFit === 'cover' ? 'slice' : 'meet';

    const hMap: Record<string, string> = { left: 'Min', center: 'Mid', right: 'Max' };
    const vMap: Record<string, string> = { top: 'Min', center: 'Mid', bottom: 'Max' };

    const xPart = `x${hMap[h] ?? 'Min'}`;
    const yPart = `Y${vMap[v] ?? 'Min'}`;

    if (resolvedFit === 'fill') { return 'none'; }

    return `${xPart}${yPart} ${meetSlice}`;
}