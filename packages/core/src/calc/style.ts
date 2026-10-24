/**
 *  style.ts
 *      Helpers for TableStyle, shared by the calc Table and the views that show its data.
 */

import type { CellStyle, TableStyle } from './types';

/** The style of a body cell: its column's look (without the width) with the cell's own on top */
export function cellStyleOf(style:TableStyle|null|undefined, rowIndex:number, column:string):CellStyle
{
    const { width, ...col } = style?.columns?.[column] ?? {};
    return { ...col, ...(style?.cells?.[rowIndex]?.[column] ?? {}) };
}
