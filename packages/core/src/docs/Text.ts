import { Container } from './Container'
import type { ContainerData, ContainerContent, TextOptions, PageSVGContext } from './types'
import { convertSizeUnitsToFontPoints, convertTextHeightUnitsToFontPoints, pointsToMm, escapeXml, SVG_TEXT_FONT_FAMILY } from './utils'
import { Color } from '@archiyou/meshup'

export class Text extends Container
{
    DEFAULT_SIZE = '7mm'; // converted to points
    DEFAULT_COLOR = 'black'; // converted to hex
    DEFAULT_TEXT_PIVOT_POSITION = [0,1]; // top left
    DEFAULT_TEXT_POSITION = [0,1]; // top left
    FONT_SIZE_TO_HEIGHT_FACTOR = 1.6; // height of container always is a bit bigger than font size

    _text:string;
    _origOptions:TextOptions = {}; // saved, to check back later, when container is added to page
    _options:TextOptions = {};

    constructor(text:string, options:TextOptions)
    {
        super();
        this._type = 'text';
        this._text = text;

        this._setDefaults();
        this._origOptions = options;

    }

    /** with Text Container width/height is less important than position and size - reflect this in setting to null by default */
    _setDefaults(): void  // overloading the function on Container
    {
        this._width = null;
        this._height = null;
        this._pivot = this.DEFAULT_TEXT_PIVOT_POSITION;
        this._position = this.DEFAULT_TEXT_POSITION;
    }

    /** Set content of this Text Container */
    setContent(v:any):this
    {
        console.info(`Text::setContent(): Setting content of container "${this.name}" from "${this._content}" to: ${v}`);
        this._text = v;
        return this;
    }

    /** Set options after added to page (overriden from parent class) */
    _onPlaced(options?:TextOptions)
    {
        options = options ?? this._origOptions ?? {};

        this._options = options; // first set, then override some

        this._setSize(  options?.size ?? this.DEFAULT_SIZE);
        this._setColor( options?.color ?? this.DEFAULT_COLOR);

        // if on page, we can make height relative to font height
        if(!this._height && this._options?.size && this._page)
        {
            // font height is container height is not set by user
            this.height(`${(this._options.size as number) * this.FONT_SIZE_TO_HEIGHT_FACTOR}pnt`);
        }
    }
    
    /** Set size of text in traditional 'points'. Real doc units (mm,cm,inch) are converted to points 
     *  NOTE: a measure relative to page height does not work here!
    */
    _setSize(size:number|string)
    {
        this._options.size = convertTextHeightUnitsToFontPoints(size); 
    }

    _setColor(color:string)
    {
        this._options.color = new Color(color).toHex();
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(_ctx: PageSVGContext, wMm: number, hMm: number): Promise<string>
    {
        const text = this._text;
        if (!text) { return ''; }

        const fmt = (n: number) => +n.toFixed(4);

        const fontSizePt       = convertSizeUnitsToFontPoints(this._options.size ?? 10);
        const fontSizeMm       = fmt(pointsToMm(fontSizePt));
        const fill             = this._options.color ?? 'black';
        const bold             = this._options.bold    ? 'bold'   : 'normal';
        const italic           = this._options.oblique ? 'italic' : 'normal';

        const [hAlign] = this._contentAlign ?? ['left', 'top'];
        const textAnchor       = hAlign === 'center' ? 'middle' : hAlign === 'right' ? 'end' : 'start';
        const xPos             = hAlign === 'center' ? fmt(wMm / 2) : hAlign === 'right' ? fmt(wMm) : '0';

        const [, vAlign] = this._contentAlign ?? ['left', 'top'];
        const yPos             = vAlign === 'center' ? fmt(hMm / 2) : vAlign === 'bottom' ? fmt(hMm) : '0';
        // Vertical alignment needs BOTH attributes — the two renderers read different ones:
        //  - Browsers honour `dominant-baseline`. 'text-before-edge' (not 'hanging') puts
        //    the top of the em box on y=0 so glyphs sit inside the container; the `hanging`
        //    baseline is a typographic baseline ~0.8em up, which Latin caps and ascenders
        //    overshoot — their tops then land outside the container's clip rect (0,0,w,h)
        //    and get shaved off.
        //  - svg2pdf (PDF export) reads only `vertical-align`/`alignment-baseline` and
        //    ignores dominant-baseline entirely, defaulting to 'alphabetic' — which is why
        //    top-aligned text sat an ascent too high in exported PDFs. 'text-top' is the
        //    value it maps to jsPDF's top baseline.
        // `alignment-baseline` does not apply to <text> in browsers (only to inline-level
        // children), so the two never fight.
        const dominantBaseline  = vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'auto'     : 'text-before-edge';
        const alignmentBaseline = vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'baseline' : 'text-top';

        const attrs = [
            `x="${xPos}"`,
            `y="${yPos}"`,
            `font-family="${SVG_TEXT_FONT_FAMILY}"`,
            `font-size="${fontSizeMm}"`,
            `font-weight="${bold}"`,
            `font-style="${italic}"`,
            `fill="${escapeXml(fill)}"`,
            `text-anchor="${textAnchor}"`,
            `dominant-baseline="${dominantBaseline}"`,
            `alignment-baseline="${alignmentBaseline}"`,
        ].join(' ');

        return `<text ${attrs}>${escapeXml(text)}</text>`;
    }

    //// OUTPUT: DATA ////

    async toData():Promise<ContainerData> // TODO
    {
        return {
            ...this._toContainerData(),
            caption: null, // caption does not make sense for text
            title: null,
            content: { 
                data: this._text, 
                settings: this._options as TextOptions // size, color
            } as ContainerContent,
        }
    }

}
