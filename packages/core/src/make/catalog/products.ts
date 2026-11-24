/**
 *  make/catalog/products.ts — what a product of the sheet is, and which product a part is.
 *
 *  A product row (the sheet's producten) read for matching: its groups, how its parts are
 *  measured (by its vorm: linear, sheet or piece), its sizes and the stock it is cut from. And,
 *  for a part of a model with its measure, how well it fits a product and what quantities it
 *  adds. Shared by shape.product() and the products API; no state, no sheet, no run.
 */

import type { PartMeasure } from '../../modeler/parts';

/** A row of the products table (`tables.producten`): the columns this class reads. The
 *  other columns (prices, LCA, sources) are kept and shown, but not needed. */
export interface ProductRow
{
    product_id: string;
    /** One or more groups, comma separated: a product line and families ('OSB-SQE, OSB'). */
    productgroep?: string | null;
    /** balk, plaat, mat, rol, baan, laag, pan, profiel, paal, stuk, raam, deur, ... */
    vorm?: string | null;
    dikte?: number | null;
    breedte?: number | null;
    hoogte?: number | null;
    lengte?: number | null;
    basiseenheid?: string | null;
    [column: string]: unknown;
}

/** Quantities of a line, in the units of the sheet's `project` tab. */
export interface ProductQuantities
{
    /** pieces */
    st?: number;
    /** m1 */
    lengte?: number;
    /** m2 */
    oppervlak?: number;
    /** m3 */
    volume?: number;
    /** m1 */
    zaaglengte?: number;
}

/** How parts are measured for a product: see the top of this file. */
export type ProductMeasure = 'linear' | 'sheet' | 'piece';

export interface Product
{
    id: string;
    groups: Array<string>;
    vorm: string;
    measure: ProductMeasure;
    /** Linear: the cross-section, sorted (mm). Piece: every size the sheet gives, sorted. */
    dims: Array<number>;
    /** Sheet: the thickness (mm), or null when the sheet gives none. */
    thickness: number | null;
    /** The stock a part is cut from (mm), Infinity for what is sold by the metre or m2.
     *  Linear: [length]. Sheet: [width, length], sorted. */
    stock: Array<number>;
    row: ProductRow;
}

export const LINEAR = new Set(['balk', 'paal', 'profiel']);
export const SHEET = new Set(['plaat', 'mat', 'rol', 'baan', 'laag', 'pan']);
/** Mats are pressed into a bay across their width, so only the cut to length is sawn. */
const SAWN_TO_LENGTH_ONLY = new Set(['mat']);
const SAWN = new Set(['plaat', 'mat']);



/** A positive number from a cell, else null. */
export function size(value: unknown): number | null
{
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

const sorted = (values: Array<number | null>): Array<number> =>
    values.filter((v): v is number => v !== null).sort((a, b) => a - b);

/** A product row, read for matching. */
export function toProduct(row: ProductRow): Product
{
    const vorm = String(row.vorm ?? '').trim().toLowerCase();
    const [dikte, breedte, hoogte, lengte] = [row.dikte, row.breedte, row.hoogte, row.lengte].map(size);
    const measure: ProductMeasure = LINEAR.has(vorm) ? 'linear' : SHEET.has(vorm) ? 'sheet' : 'piece';
    const groups = String(row.productgroep ?? '').split(',').map(g => g.trim()).filter(Boolean);

    const shape = {
        linear: { dims: sorted([dikte, breedte, hoogte]), thickness: null, stock: [lengte ?? Infinity] },
        sheet: { dims: [], thickness: dikte, stock: [breedte ?? Infinity, lengte ?? Infinity].sort((a, b) => a - b) },
        piece: { dims: sorted([dikte, breedte, hoogte, lengte]), thickness: null, stock: [] },
    }[measure];

    return { id: String(row.product_id).trim(), groups, vorm, measure, ...shape, row };
}

/** How well a part fits a product: a rank (lower is better), or null when it does not fit. */
export function fit(product: Product, m: PartMeasure, tolerance: number): Array<number> | null
{
    const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
    const part = [m.thickness, m.width, m.length];

    if (product.measure === 'linear')
    {
        const [stock] = product.stock as [number];
        const section = product.dims.length >= 2
            ? near(m.thickness, product.dims[0]!) && near(m.width, product.dims[1]!)
            : product.dims.every(d => near(m.thickness, d));
        // the shortest stock length that is long enough
        return section && m.length <= stock + tolerance ? [stock] : null;
    }

    if (product.measure === 'sheet')
    {
        if (product.thickness !== null && !near(m.thickness, product.thickness)) { return null; }
        // the smallest sheet that holds the part whole, else the largest sheet
        const [a, b] = product.stock as [number, number];
        return sheetUse(product, m, tolerance).pieces === 1 ? [0, a * b, a, b] : [1, -a * b, -a, -b];
    }

    // a piece: the sizes the sheet gives are the part's largest ones (a part has three, a row
    // with dikte, breedte, hoogte and lengte four: its largest three)
    const dims = product.dims.slice(-part.length);
    const largest = part.slice(part.length - dims.length);
    return dims.every((d, i) => near(largest[i]!, d)) ? [0] : null;
}

/** A part of a sheet product turned so that its size equal to the product's thickness is its
 *  thickness. An offcut can be smaller than it is thick: insulation under a window, 80 mm high
 *  in a wall of 140, has 80 as its smallest size. Unchanged when no size matches. */
export function orient(product: Product, m: PartMeasure, tolerance: number): PartMeasure
{
    const thickness = product.thickness;
    if (product.measure !== 'sheet' || thickness === null || Math.abs(m.thickness - thickness) <= tolerance) { return m; }
    const dims = [m.thickness, m.width, m.length];
    const i = dims.findIndex(d => Math.abs(d - thickness) <= tolerance);
    if (i < 0) { return m; }
    const [width, length] = dims.filter((_, k) => k !== i) as [number, number];
    return { ...m, thickness: dims[i]!, width, length };
}

/** Ranks compare value by value; equal infinite sizes (sold per m2) are equal. */
export const compareRanks = (a: Array<number>, b: Array<number>): number =>
    a.map((v, i) => (v === b[i] ? 0 : v - b[i]!)).find(d => d !== 0) ?? 0;

/** How many pieces of stock a part takes, and how much is sawn (mm), in the orientation
 *  that takes the fewest pieces. A side the stock has no size for is not cut. */
export function sheetUse(product: Product, m: PartMeasure, tolerance: number): { pieces: number, sawn: number }
{
    const [a, b] = product.stock as [number, number];
    const count = (x: number, s: number) => (s === Infinity ? 1 : Math.max(1, Math.ceil((x - tolerance) / s)));
    const cut = (x: number, s: number) =>
    {
        if (s === Infinity) { return false; }
        const rest = x % s;
        return rest > tolerance && s - rest > tolerance;
    };

    // width along a and length along b, or the other way round
    const [across, along] = count(m.width, a) * count(m.length, b) <= count(m.width, b) * count(m.length, a) ? [a, b] : [b, a];
    const pieces = count(m.width, across) * count(m.length, along);

    if (!SAWN.has(product.vorm)) { return { pieces, sawn: 0 }; }
    const rip = !SAWN_TO_LENGTH_ONLY.has(product.vorm) && cut(m.width, across) ? m.length : 0;
    const crosscut = cut(m.length, along) ? m.width : 0;
    return { pieces, sawn: rip + crosscut };
}

/** The quantities one part adds to its product's line, in the sheet's units. */
export function partQuantities(product: Product, m: PartMeasure, tolerance: number): Required<ProductQuantities>
{
    const volume = m.volume / 1e9;
    if (product.measure === 'linear')
    {
        return { st: 1, lengte: m.length / 1000, oppervlak: 0, volume, zaaglengte: 0 };
    }
    if (product.measure === 'sheet')
    {
        const { pieces, sawn } = sheetUse(product, m, tolerance);
        return { st: pieces, lengte: 0, oppervlak: m.width * m.length / 1e6, volume, zaaglengte: sawn / 1000 };
    }
    return { st: 1, lengte: 0, oppervlak: 0, volume, zaaglengte: 0 };
}

export const sizeText = (m: PartMeasure): string =>
    [m.thickness, m.width, m.length].map(v => Math.round(v * 10) / 10).join(' x ');

/** A product as a specification names it: its type and the size that tells it apart
 *  ('SLS-regel 38x235', 'Houtvezel buitenplaat 16 mm'). */
export function productLabel(p: Product): string
{
    // the type up to its first comma that is not inside brackets: 'Bouwplank (gezaagd, ruw), vuren'
    const type = String(p.row['type'] ?? p.id).replace(/\([^)]*\)/g, m => m.replace(/,/g, '\u0000')).split(',')[0]!.replace(/\u0000/g, ',').trim();
    const size = p.measure === 'linear' && p.dims.length === 2 ? p.dims.map(d => Math.round(d)).join('x')
        : p.measure === 'sheet' && p.thickness ? `${p.thickness} mm` : '';
    return size ? `${type} ${size}` : type;
}

