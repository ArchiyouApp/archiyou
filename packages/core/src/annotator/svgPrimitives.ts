/**
 *  svgPrimitives.ts
 *
 *  The pieces an annotation is drawn from: a line, a leader, an arrowhead, a circular anchor
 *  marker, and a text label with the backing box that keeps it readable over geometry.
 *
 *  Everything here is a pure function taking SVG-space coordinates — y already flipped by the
 *  caller — and page-scaled sizes. It holds no annotation state on purpose: a DimensionLine
 *  and a Label draw the same leader and the same boxed text, and before this module they
 *  could only do that by one of them owning the writers and the other going without. (The
 *  other was Label, which is why a label reached the viewer but never the page.)
 *
 *  A note on styling: `stroke:black` and friends are written inline rather than left to the
 *  drawing's stylesheet. An annotation has to survive being pulled OUT of that stylesheet —
 *  a DOM-less rasterizer, or a copy of just the `<g class="dimensionline">` — and SVG's
 *  default stroke is `none`, so without it the arrowheads are simply not drawn. The classes
 *  are still emitted so a document CAN restyle them.
 */

import { DOC_DEFAULT_SVG_FONT_FAMILY } from '../constants'

/** Proportions of a boxed text label, as multiples of the text height — so they hold at any
 *  text size and any drawing scale. Mirrors the Annotator's DIMENSION_TEXT_* settings, which
 *  is where a script changes them; these are the fallbacks. */
export interface SvgTextLabelStyle
{
    /** The box the text sits in: a square-cornered rectangle, or the circle a manual numbers
     *  its parts with. Default 'rect' — a dimension's value box, which is what this drew
     *  before there was a choice. */
    shape?: 'rect' | 'circle'
    /** Width of the backing box per character, in text heights. */
    charWidthFactor?: number
    /** Padding of that box, in text heights. */
    paddingFactor?: number
    /** Height of that box, in text heights. */
    heightFactor?: number
    /** Fill of that box. Null/'' draws no box — except a circle, which keeps its ring, since
     *  a circled letter with no circle is just a letter. */
    background?: string | null
    /** Outline of the box, in SVG units. 0 draws none, which is what a rectangle does unless
     *  it is asked otherwise. */
    strokeWidth?: number
    /** Rotation of the whole label in SVG degrees. Default 0. */
    angle?: number
    /** Extra class on the wrapping `<g>`, after `annotation`. Default 'dimension-label'. */
    cssClass?: string
    /** Font family. Defaults to the document's SVG font stack. */
    fontFamily?: string
}

const DEFAULTS: Required<Omit<SvgTextLabelStyle, 'background' | 'fontFamily'>> = {
    shape: 'rect',
    charWidthFactor: 0.6,
    paddingFactor: 0.5,
    heightFactor: 1.2,
    strokeWidth: 0,
    angle: 0,
    cssClass: 'dimension-label',
}

/** Cap height of the UI/label fonts, as a fraction of the font size.
 *
 *  A label's text is centred on its CAP BAND — baseline to cap height — because that is what
 *  the eye reads as the middle of 'A', '3' or 'B12'. Neither renderer can be told to do that
 *  directly: SVG centres on a baseline keyword and CSS centres the line box, and both of those
 *  include descender room the glyphs do not use, which is why a circled letter came out
 *  visibly off centre in both.
 *
 *  0.70 is the cap height of Outfit and of Plus Jakarta Sans (the drawing and UI faces) to
 *  within a percent, and of essentially every other grotesque, so a script that swaps the font
 *  is out by well under a pixel at label sizes.
 *
 *  To re-measure: render a label at a large font size with the glyphs recoloured, screenshot
 *  it, and compare the ink's bounding box centre with the ring's. */
export const CAP_HEIGHT_EM = 0.7

export interface XY { x: number, y: number }

/** x/y of a PointLike, whatever shape it arrives in.
 *
 *  The writers below are fed plain `[x,y,z]` arrays by the annotations (they flip y on the
 *  array). Reading `.x` off one silently produced `x1="undefined"`, i.e. annotations that
 *  were emitted but could never be drawn — hence this, rather than a cast. */
export function svgXY(p: any): XY
{
    if (Array.isArray(p)) { return { x: p[0] ?? 0, y: p[1] ?? 0 } }
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
}

/** A straight segment. */
export function svgLine(start: any, end: any, strokeWidth: number = 0.5): string
{
    const startPoint = svgXY(start);
    const endPoint = svgXY(end);
    return `<line class="annotation line" style="stroke:black;stroke-width:${+strokeWidth.toFixed(4)}" x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}"/>`
}

/** The leader from an anchor out to the text that belongs to it. */
export function svgLeader(from: any, to: any, strokeWidth: number = 0.5): string
{
    const a = svgXY(from);
    const b = svgXY(to);
    return `<line class="annotation line leader" style="stroke:black;stroke-width:${+strokeWidth.toFixed(4)}" `
        + `x1="${+a.x.toFixed(4)}" y1="${+a.y.toFixed(4)}" `
        + `x2="${+b.x.toFixed(4)}" y2="${+b.y.toFixed(4)}"/>`;
}

/** An arrowhead, tip at `at`, rotated `rotation` degrees in SVG space.
 *
 *  The glyph is drawn 10 units wide with its tip at [0,0] pointing up (in SVG space, so
 *  "up" is -y), and scaled by `arrowScale` — which is why a 5mm arrowhead is half a
 *  millimeter of scale per glyph unit. The stroke width is divided by the scale so the
 *  outline keeps its weight however big the head is.
 */
export function svgArrow(at: any, rotation: number, strokeWidth: number = 0.5,
    arrowScale: number = 1, flip: boolean = false): string
{
    const SIZE = '10 5'; // Size of non-rotated graphic, use this for scaling
    const ARROWS_SVG = {
        default: `<path class="arrow-path" style="fill:none;stroke:black;stroke-width:${+(strokeWidth / arrowScale).toFixed(4)}" d="M -5 5 L 0 0 L 5 5" />`
    }
    const DEFAULT_ARROW_SVG = 'default'

    const atPoint = svgXY(at);

    // NOTE: underscores _ in attributes are omitted (_worldSize => worldSize)
    return `
          <g 
                class="annotation arrow ${(flip) ? 'end' : 'start'}"
                worldSize="${SIZE}"
                transform="translate(${atPoint.x} ${atPoint.y}) 
                            rotate(${rotation})
                            scale(${+arrowScale.toFixed(4)} ${+arrowScale.toFixed(4)})
                            ">
                            ${ARROWS_SVG[DEFAULT_ARROW_SVG]}
          </g>`
}

/** A small filled circle at an anchor point — a label's alternative to an arrowhead.
 *  It marks WHERE without implying a direction, which is what a callout wants and a
 *  dimension does not. */
export function svgCircleMarker(at: any, diameter: number, strokeWidth: number = 0.5): string
{
    const atPoint = svgXY(at);
    return `<circle class="annotation marker" `
        + `cx="${+atPoint.x.toFixed(4)}" cy="${+atPoint.y.toFixed(4)}" r="${+(diameter / 2).toFixed(4)}" `
        + `style="fill:black;stroke:black;stroke-width:${+strokeWidth.toFixed(4)}"/>`;
}

/** Text with a backing box, centred on `at`.
 *
 *  The box is sized by glyph count rather than measured: there are no font metrics here
 *  (this runs in a worker and in node alike), and the legacy code only got them because it
 *  measured inside jsPDF at draw time. An over-wide box merely hides a little more of
 *  whatever it sits on.
 *
 *  Both `dominant-baseline` and `alignment-baseline` are written on purpose — browsers read
 *  the first, svg2pdf (the PDF export) reads the second.
 */
export function svgTextLabel(at: any, text: string, fontSize: number = 1,
    style?: SvgTextLabelStyle): string
{
    const atPoint = svgXY(at);
    const s = { ...DEFAULTS, ...(style ?? {}) };
    const background = style?.background;
    const fontFamily = style?.fontFamily ?? DOC_DEFAULT_SVG_FONT_FAMILY;

    const { width: w, height: h } = textBoxSize(text, fontSize, s);

    const stroke = (s.strokeWidth > 0)
        ? `stroke:black;stroke-width:${+s.strokeWidth.toFixed(4)}`
        : 'stroke:none';

    /*  A circle is CIRCUMSCRIBED about the same box a rectangle would be, so a letter never
        touches the ring however wide the text is, and both shapes are sized by one piece of
        arithmetic that svgTextLabelSize() can answer for. */
    const box = (s.shape === 'circle')
        ? `<circle class="annotation text-background" `
            + `cx="${+atPoint.x.toFixed(4)}" cy="${+atPoint.y.toFixed(4)}" `
            + `r="${+(Math.hypot(w, h) / 2).toFixed(4)}" `
            + `style="fill:${background || 'none'};${stroke}" />`
        : (!background && s.strokeWidth <= 0) ? '' :
          `<rect class="annotation text-background" `
            + `x="${+(atPoint.x - w / 2).toFixed(4)}" y="${+(atPoint.y - h / 2).toFixed(4)}" `
            + `width="${+w.toFixed(4)}" height="${+h.toFixed(4)}" `
            + `style="fill:${background || 'none'};${stroke}" />`;

    /*  NOTE: the rotation is applied HERE, not left on a `data-angle` for a renderer to
        pick up later. There is no later any more — this SVG is the drawing, in the editor
        and in the PDF alike.

        The text sits on the DEFAULT alphabetic baseline, half a cap height below the middle
        of the box, rather than on `dominant-baseline="central"`. Two reasons: `central` is the
        font's own centre and not the glyphs' — it put the text 0.09em high, which is what a
        circled letter shows up — and it is a baseline keyword, which the PDF writer (svg2pdf)
        does not implement at all. An explicit y needs neither renderer to agree about
        anything. */
    return `<g class="annotation ${s.cssClass}" transform="rotate(${+s.angle.toFixed(4)} ${atPoint.x} ${atPoint.y})">
                    ${box}
                    <text
                        class="annotation text"
                        text-anchor="middle"
                        font-family="${fontFamily}"
                        font-size="${+fontSize.toFixed(4)}"
                        style="fill:black;stroke-opacity:0;stroke-width:0"
                        x="${atPoint.x}"
                        y="${+(atPoint.y + fontSize * CAP_HEIGHT_EM / 2).toFixed(4)}">${text}</text>
                </g>`;
}

/** The size a boxed text label takes in SVG units, for callers that need to reserve room
 *  for it (a drawing frame that must not crop the label it is framing). Same arithmetic as
 *  svgTextLabel's box, so the two can never disagree.
 *
 *  A circle is circumscribed about this box, so it reaches `hypot(w,h)/2` from the centre in
 *  every direction — wider than the box on both axes. */
export function svgTextLabelSize(text: string, fontSize: number,
    style?: SvgTextLabelStyle): { width: number, height: number }
{
    const s = { ...DEFAULTS, ...(style ?? {}) };
    const box = textBoxSize(text, fontSize, s);

    if (s.shape !== 'circle') { return box }

    const diameter = Math.hypot(box.width, box.height);
    return { width: diameter, height: diameter };
}

/** The rectangle the glyphs need. A circle is drawn around this, so it is the one measurement
 *  both shapes are built from. */
function textBoxSize(text: string, fontSize: number,
    s: Required<Omit<SvgTextLabelStyle, 'background' | 'fontFamily'>>): { width: number, height: number }
{
    return {
        width: Math.max(1, (text ?? '').trim().length) * fontSize * s.charWidthFactor
            + fontSize * s.paddingFactor,
        height: fontSize * s.heightFactor,
    };
}
