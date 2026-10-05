import { Container } from './Container'
import type { ContainerData, ContainerContent, TableContainerOptions, PageSVGContext } from './types'
import type { DataRows, DataRowsColumnValue } from '../calc/types'
import { convertSizeUnitsToFontPoints, convertTextHeightUnitsToFontPoints, pointsToMm, escapeXml, SVG_TEXT_FONT_FAMILY } from './utils'
import { Color } from '@archiyou/meshup'
import { isLengthUnit, formatFromUnit } from '../units/UnitConverter'
import type { UnitSystem } from '../units/UnitConverter'
import { DOC_UNIT_SYSTEM_DEFAULT } from '../constants'

//// MAIN CLASS ////

export class Table extends Container
{
    DEFAULT_FONT_SIZE = 10; // in points
    DEFAULT_FONT_COLOR = 'black'; // converted to hex

    DEFAULT_TABLE_PIVOT_POSITION = [0,1]; // top left is most widely used as default
    DEFAULT_TABLE_POSITION = [0,1]; // top left
    DEFAULT_TABLE_WIDTH = '100mm'; 
    DEFAULT_TABLE_HEIGHT = '100mm';

    _data:DataRows; // DataRows: Array of column-values { [ {col1: val1, col2: val2 }, {...} ] }
    _options:TableContainerOptions = {}

    constructor(data:DataRows, options:TableContainerOptions)
    {
        super();
        this._type = 'table';
        this._data = data;
        this.setOptions(options);
    }

    /** with Text Container width/height is less important than position and size - reflect this in setting to null by default */
    // WARNING: some functions here use reference to page or doc, Container needs to be linked already
    _setDefaults(): void  // overloading the function on Container
    {
        this.width(this.DEFAULT_TABLE_WIDTH);
        this.height(this.DEFAULT_TABLE_HEIGHT);
        this.pivot(this.DEFAULT_TABLE_PIVOT_POSITION);
        this.position(this.DEFAULT_TABLE_POSITION);
    }

    /** Set options and defaults */
    setOptions(options:TableContainerOptions = {})
    {
        this._setFontSize(options?.fontsize || this.DEFAULT_FONT_SIZE);
        this._setFontColor(options?.fontcolor || this.DEFAULT_FONT_COLOR);
        this._options.footer = options?.footer ?? [];
        this._options.units = options?.units ?? {};
    }

    /** Set size of text in traditional 'points'. Real doc units (mm,cm,inch) are converted to points */
    _setFontSize(size:number|string)
    {
        this._options.fontsize = convertTextHeightUnitsToFontPoints(size);
    }

    _setFontColor(color:string)
    {
        this._options.fontcolor = new Color(color).toHex();
    }

    //// OUTPUT: SVG ////

    async _toSVGContent(_ctx: PageSVGContext, wMm: number, _hMm: number): Promise<string>
    {
        const rows = this._data;
        if (!rows || !Array.isArray(rows) || rows.length === 0) { return ''; }

        const TABLE_CELL_PAD_MM = 1;
        const TABLE_BORDER_MM   = 0.1;
        const TABLE_HEADER_FILL = '#eeeeee';

        const fmt = (n: number) => +n.toFixed(4);

        const fontSizePt = convertSizeUnitsToFontPoints(this._options.fontsize ?? 8);
        const fontSizeMm = pointsToMm(fontSizePt);
        const fill       = this._options.fontcolor ?? 'black';
        const rowHMm     = fontSizeMm * 1.6 + 2 * TABLE_CELL_PAD_MM;

        const cols    = Object.keys(rows[0]);
        const numCols = cols.length;
        const colW    = wMm / numCols;

        const lines: string[] = [];

        const drawRow = (values: string[], rowY: number, opts:{ bold?:boolean, fill?:string } = {}) =>
        {
            values.forEach((val, ci) =>
            {
                const cx = ci * colW;
                const bg = opts.fill ?? 'none';
                lines.push(`<rect x="${fmt(cx)}" y="${fmt(rowY)}" width="${fmt(colW)}" height="${fmt(rowHMm)}" fill="${bg}" stroke="black" stroke-width="${TABLE_BORDER_MM}"/>`);
                lines.push(`<text x="${fmt(cx + TABLE_CELL_PAD_MM)}" y="${fmt(rowY + rowHMm / 2)}" font-family="${SVG_TEXT_FONT_FAMILY}" font-size="${fmt(fontSizeMm)}" fill="${escapeXml(fill)}" dominant-baseline="middle"${opts.bold ? ' font-weight="bold"' : ''}>${escapeXml(String(val ?? ''))}</text>`);
            });
        };

        drawRow(cols.map(col => this._headerText(col)), 0, { bold: true, fill: TABLE_HEADER_FILL });
        rows.forEach((row, ri) =>
        {
            const rowY = (ri + 1) * rowHMm;
            const vals = cols.map(col => this._cellText(col, (row as Record<string, DataRowsColumnValue>)[col]));
            drawRow(vals, rowY);
        });

        // Footer rows (aggregations) below the body, with optional separating line + bold styling
        const footer = this._options.footer ?? [];
        footer.forEach((fRow, fi) =>
        {
            const rowY = (rows.length + 1 + fi) * rowHMm;
            if(fRow.line)
            {
                // thicker separating line spanning the full table width above this footer row
                lines.push(`<line x1="0" y1="${fmt(rowY)}" x2="${fmt(wMm)}" y2="${fmt(rowY)}" stroke="black" stroke-width="${TABLE_BORDER_MM * 4}"/>`);
            }
            const vals = cols.map(col => this._cellText(col, fRow.values?.[col]));
            drawRow(vals, rowY, { bold: fRow.bold !== false, fill: fRow.fill });
        });

        return `<g>${lines.join('')}</g>`;
    }

    /** A cell as text. A number in a column with a unit (see TableContainerOptions.units) is
     *  written the imperial way when the document is imperial; metric keeps it as it is, in
     *  the unit its header names. */
    _cellText(col:string, val:any):string
    {
        const unit = this._options.units?.[col];
        if(isLengthUnit(unit) && typeof val === 'number' && this._unitSystem() === 'imperial')
        {
            return formatFromUnit(val, unit, 'imperial');
        }
        return String(val ?? '');
    }

    /** A column header. A metric length column names its unit, which its cells leave out:
     *  'length (mm)'. Imperial values carry their own marks. */
    _headerText(col:string):string
    {
        const unit = this._options.units?.[col];
        return (isLengthUnit(unit) && this._unitSystem() === 'metric') ? `${col} (${unit})` : col;
    }

    _unitSystem():UnitSystem
    {
        return this._page?._doc?.resolveUnitSystem() ?? DOC_UNIT_SYSTEM_DEFAULT;
    }

    //// OUTPUT: DATA ////

    async toData():Promise<ContainerData> // TODO
    {
        return {
            ...this._toContainerData(),
            content: {
                data: this._data,
                footer: this._options.footer ?? [],
                settings: this._options
            } as ContainerContent,
        }
    }

}
