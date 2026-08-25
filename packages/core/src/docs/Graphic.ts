import type { ContainerData, ContainerContent, DocUnits, PageSVGContext } from './types'
import { Container } from './Container'

import type { DocGraphicType, DocGraphicInputBase, DocGraphicInputRect, DocGraphicInputCircle, DocGraphicInputLine } from './types'
import { pathStyleToSVGAttrs } from './utils'

//// MAIN CLASS ////

export class Graphic extends Container
{
    DEFAULT_GRAPHIC_UNITS = 'mm' as DocUnits;
    DEFAULT_GRAPHIC_PIVOT = [0.5,0.5]; // for graphics it intuitive to have pivot at center

    _options:DocGraphicInputBase|DocGraphicInputRect|DocGraphicInputCircle|DocGraphicInputLine;

    constructor(type:DocGraphicType, input:DocGraphicInputBase|DocGraphicInputRect|DocGraphicInputCircle|DocGraphicInputLine)
    {
        super(); 
        this._type = 'graphic'; // main type
        this.setOptions({ 
                            ...input, 
                            type: type 
                        }); // give type of graphic to settings
    }

    /** Set options and defaults */
    setOptions(input:DocGraphicInputBase|DocGraphicInputRect|DocGraphicInputCircle|DocGraphicInputLine)
    {
        this._options = input; // NOTE: leave tests up to Doc.rect(), Doc.line() etc
        this._options.units = this._options.units || this.DEFAULT_GRAPHIC_UNITS; // unless given by user, we use mm as units for this graphic
        this.pivot(this.DEFAULT_GRAPHIC_PIVOT);
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(_ctx: PageSVGContext, wMm: number, hMm: number): Promise<string>
    {
        const fmt      = (n: number) => +n.toFixed(4);
        const type     = this._options?.type as string;
        const style    = this._options?.style;
        const styleStr = pathStyleToSVGAttrs(style);

        switch (type)
        {
            case 'rect':
            {
                const rx = (this._options as DocGraphicInputRect).round
                    ? ` rx="${fmt((this._options as DocGraphicInputRect).round)}"`
                    : '';
                return `<rect x="0" y="0" width="${fmt(wMm)}" height="${fmt(hMm)}"${rx} ${styleStr}/>`;
            }
            case 'circle':
            {
                const r = fmt(wMm / 2);
                return `<circle cx="${r}" cy="${fmt(hMm / 2)}" r="${r}" ${styleStr}/>`;
            }
            case 'ellipse':
                return `<ellipse cx="${fmt(wMm / 2)}" cy="${fmt(hMm / 2)}" rx="${fmt(wMm / 2)}" ry="${fmt(hMm / 2)}" ${styleStr}/>`;

            case 'hline':
                return `<line x1="0" y1="${fmt(hMm / 2)}" x2="${fmt(wMm)}" y2="${fmt(hMm / 2)}" ${styleStr}/>`;

            case 'vline':
                return `<line x1="${fmt(wMm / 2)}" y1="0" x2="${fmt(wMm / 2)}" y2="${fmt(hMm)}" ${styleStr}/>`;

            case 'line':
                return `<line x1="0" y1="0" x2="${fmt(wMm)}" y2="${fmt(hMm)}" ${styleStr}/>`;

            case 'triangle':
            {
                const pts = `0,${fmt(hMm)} ${fmt(wMm / 2)},0 ${fmt(wMm)},${fmt(hMm)}`;
                return `<polygon points="${pts}" ${styleStr}/>`;
            }
            default:
                console.warn(`Graphic::_toSVGContent(): Unknown graphic type "${type}"`);
                return '';
        }
    }

    //// OUTPUT: DATA ////

    async toData():Promise<ContainerData> // TODO
    {
        return {
            ...this._toContainerData(),
            content: {
                data: this._options?.data, // TODO? Things like filled data in graphic  
                settings: this._options
            } as ContainerContent,
        }
    }

}
