import { Container } from './Container'
import type { ContainerContent, TextAreaAlign, TextAreaOptions, PageSVGContext } from './types'
import { isTextAreaAlign } from './typeguards'
import { convertSizeUnitsToFontPoints, convertTextHeightUnitsToFontPoints, pointsToMm, escapeXml, wrapTextToTspans, SVG_TEXT_FONT_FAMILY } from './utils'
import { Color } from '@archiyou/meshup'



export class TextArea extends Container
{
    DEFAULT_SIZE = '7mm'; // font size converted to points
    DEFAULT_COLOR = 'black'; // converted to hex
    DEFAULT_ALIGN:TextAreaAlign = 'left';
    DEFAULT_TEXTAREA_PIVOT_POSITION = [0,1]; // top left is most widely used as default
    DEFAULT_TEXTAREA_POSITION = [0,1]; // top left
    DEFAULT_TEXTAREA_WIDTH = '100mm'; 
    DEFAULT_TEXTAREA_HEIGHT = '60%';

    _text:string;
    _options:TextAreaOptions = {}

    constructor(text:string, options:TextAreaOptions)
    {
        super();
        this._type = 'textarea';
        this._text = text;
        this.setOptions(options);
    }

    // WARNING: some functions here use reference to page or doc, Container needs to be linked already
    _setDefaults(): void  // overloading the function on Container
    {
        this.width(this.DEFAULT_TEXTAREA_WIDTH);
        this.height(this.DEFAULT_TEXTAREA_HEIGHT);
        this.pivot(this.DEFAULT_TEXTAREA_PIVOT_POSITION);
        this.position(this.DEFAULT_TEXTAREA_POSITION);
    }

    /** Set options and defaults */
    setOptions(options:TextAreaOptions = {})
    {
        this._setSize( (options?.size) ? options.size : this.DEFAULT_SIZE);
        this._setColor((options?.color) ? options.color : this.DEFAULT_COLOR);
        this._setAlignment((options?.align) ? options.align : this.DEFAULT_ALIGN);
    }
    
    /** Set size of text in traditional 'points'. Real doc units (mm,cm,inch) are converted to points */
    _setSize(size:number|string)
    {
        this._options.size = convertTextHeightUnitsToFontPoints(size);
    }

    _setColor(color:string)
    {
        this._options.color = new Color(color).toHex();
    }

    /** Set alignment */
    _setAlignment(align:TextAreaAlign)
    {
        if(isTextAreaAlign(align))
        {
            this._options.align = align;
        }
        else {
            throw new Error(`DocPageContainerTextArea::_setAlignment: Invalid alignment '${align}. Use 'left','right','center' or 'fill'`);
        }
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(_ctx: PageSVGContext, wMm: number, _hMm: number): Promise<string>
    {
        const text = this._text;
        if (!text) { return ''; }

        const fmt = (n: number) => +n.toFixed(4);

        const fontSizePt    = convertSizeUnitsToFontPoints(this._options.size ?? 10);
        const fontSizeMm    = pointsToMm(fontSizePt);
        const lineHeightMm  = fontSizeMm * 1.4;
        const fill          = this._options.color ?? 'black';

        const align      = this._options.align ?? 'left';
        const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
        const xBase      = align === 'center' ? String(fmt(wMm / 2)) : align === 'right' ? String(fmt(wMm)) : '0';

        const charWidthMm = fontSizeMm * 0.55;
        const tspans      = wrapTextToTspans(text, wMm, charWidthMm, lineHeightMm, xBase);

        const attrs = [
            `font-family="${SVG_TEXT_FONT_FAMILY}"`,
            `font-size="${fmt(fontSizeMm)}"`,
            `fill="${escapeXml(fill)}"`,
            `text-anchor="${textAnchor}"`,
            // Both attributes on purpose — see Text.ts: browsers read dominant-baseline,
            // svg2pdf (PDF export) reads alignment-baseline.
            `dominant-baseline="text-before-edge"`,
            `alignment-baseline="text-top"`,
        ].join(' ');

        return `<text ${attrs}>${tspans}</text>`;
    }

    //// OUTPUT: DATA ////

    async toData():Promise<any> // TODO
    {
        return {
            ...this._toContainerData(),
            caption: null, // caption does not make sense for text area
            title: null,
            content: { 
                data: this._text, 
                settings: this._options 
            } as ContainerContent,
        }
    }

}
