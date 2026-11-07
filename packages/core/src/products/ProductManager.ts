/**
 *  products/ProductManager.ts
 *
 *  From the parts of a model to the products of a product sheet, and from there to costs.
 *
 *  The sheet is the core: it holds the products with their sizes and prices, the operations
 *  with their norms, the recipes that turn a product's quantities into labour (the rows under
 *  a product in its componenten tab, see recipes.ts), and the margins. Partners can read and
 *  check all of it. This class only does what a sheet cannot: measure the parts of a model,
 *  match them to products, add up the quantities, and price them by the sheet's rows.
 *
 *      products = make.products().fromSheet('https://docs.google.com/spreadsheets/d/…')  // opened with cloudcalc
 *      products.assign('SLS', wall, { component: 'hsbwand' })  // every part that fits a size of the group
 *      products.assign('houtvezel-flex-140', wall.insulation, { component: 'hsbwand' })  // or one product, by id
 *      products.elementWork('hsbwand', { oppervlak: 8.1 })     // the work on the element as a whole
 *      products.add('tape-universeel-60', { lengte: 12 })      // what the model does not show
 *      overview = products.compute()                // costs per category and per line
 *
 *  A component maps its own parts, without a sheet: there assign(), add() and complete() only
 *  note on each shape what it is, so the component loads nothing. The model that uses it opens
 *  the sheet once and collects them, see collect():
 *
 *      products = make.products()                                    // in the wall component
 *      products.assign(['SLS', 'SLS-GEVINGERLAST'], wall.studs, { component: 'hsbwand' })
 *      products.complete('hsbwand', { oppervlak: 8.1 })              // what it does not model
 *
 *      products = make.products().fromSheet(url).collect(all())      // in the house
 *
 *  How a part is measured follows the product's vorm, not how the part looks: a wall's
 *  insulation is long for its section (a beam to partList()), but it is filled with mats.
 *   - linear (balk, paal, profiel): the section picks the size; stuks and lengte (m1)
 *   - sheet (plaat, mat, rol, baan, laag, pan): the thickness picks the size; stuks
 *     (pieces of stock needed), oppervlak (m2) and, for sawn sheets, zaaglengte (m1)
 *   - anything else is a piece (stuk, raam, deur, ...): stuks
 *  Volume (m3) is always given. Quantities are net: the costs add the waste.
 *
 *  The labour of a product follows its recipe in the sheet. `component` says which: the product
 *  in that component's block, else one like it there (same group, same vorm), else the same
 *  product, group or vorm anywhere in the sheet. The overview says which one it took.
 *
 *  A shape that is only a mass (a box for a wall, a block for a bathroom) is not measured for
 *  products at all: assign it to a component of the sheet ('hsbwand', 'badkamer_klein') and its
 *  volume is priced at the component's cost per m3. That is rough on purpose: the component
 *  stands for a representative build-up, and its block in the sheet's componenten tab says
 *  which. A component is what has an output `outputs.<component>.costm3`, next to its cost per
 *  unit, `costm2` or `costst`.
 *
 *  Sizes are in mm, as in the sheet, and so is the model.
 */

import { ShapeCollection } from '@archiyou/meshup';

import { collectParts, type PartMeasure } from '../modeler/parts';
import type { ArchiyouModules } from '../types';
import type { Table } from '../calc/Table';
import { ModuleUnavailableError } from '../modules/unavailableStub';
import { offerPageData, renderOfferHtml, type OfferPageOptions, type OfferSource } from './offer-html';
import { combineRows, materialPrice, mergeRecipes, quantityOfUnit, readBlocks, type Block, type BlockProduct, type RecipeStep } from './recipes';

//// TYPES ////

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

/** A row of the operations table (`tables.bewerkingen`). */
export interface OperationRow
{
    naam: string;
    /** onsite, voorbewerking, assemblage, montage or afbouw: the cost column it counts in */
    fase?: string | null;
    werkeenheid?: string | null;
    omschrijving?: string | null;
    [column: string]: unknown;
}

/** A component, as fromRows() takes it. fromSheet() reads them from the sheet's outputs:
 *  `outputs.<component>.costm3`, and `costm2` or `costst` for its unit. */
export interface ComponentRow
{
    component: string;
    /** What one unit of the component is: m2 or st. */
    eenheid?: string | null;
    gebouwdeel?: string | null;
    [column: string]: unknown;
}

export interface Component
{
    id: string;
    /** m2 or st */
    unit: string;
    row: ComponentRow;
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

export interface ProductOptions
{
    /** Material waste as a fraction (0.1 is 10 %). Default: the sheet's waste for the vorm. */
    waste?: number;
    /** Describes the line, for the table. Default: the parts' group names. */
    label?: string;
    /** The component of the sheet this is part of ('hsbwand'): its block has the recipe. */
    component?: string;
}

export interface AssignOptions extends ProductOptions
{
    /** How far a size may be off and still fit (mm). Default 1. */
    tolerance?: number;
    /** Include hidden shapes. Default false: as in partList(), a hidden shape is not part of
     *  what is built. */
    hidden?: boolean;
}

/** Costs by category, as the sheet's cost columns: material, and the work by its phase, in the
 *  order of building: voorbewerking (product → part) and assemblage (parts → element) in the
 *  workshop, montage (element → building) and afbouw (finishing after montage) on site, and
 *  onsite: work for the project as a whole. */
export interface ProductCosts
{
    material: number;
    onsite: number;
    voorbewerking: number;
    assemblage: number;
    montage: number;
    afbouw: number;
    total: number;
}

export interface ProductLine extends Required<ProductQuantities>
{
    /** A product id, a component, or the name of an operation. */
    id: string;
    kind: LineKind;
    /** The product's vorm, the operation's unit of work, or 'component'. */
    vorm: string;
    description: string;
    /** Waste as a fraction, or null for the sheet's default for the vorm. */
    waste: number | null;
    /** How many shapes of the model are in this line. */
    shapes: number;
    /** Costs excluding margins, after compute(). */
    costs: ProductCosts | null;
    /** Whose recipe gave the labour, after compute(): 'hsbwand/sls-38x235', 'hsbwand/balk', 'SLS'. */
    labour: string | null;
}

export type LineKind = 'product' | 'component' | 'operation';

/** A component of the sheet as the offer's price list has it: its price per unit by cost
 *  category, including the sheet's margins, excluding BTW and the project surcharges. */
export interface OfferPrice
{
    gebouwdeel: string;
    /** The component group: the components of one group are alternatives for one row of the
     *  offer, chosen with its dropdown (wanden: HSB wand, strobalen wand). */
    groep: string;
    component: string;
    /** The name the offer shows in its dropdown. */
    naam: string;
    /** The component's main products, for the offer's specification. */
    omschrijving: string;
    /** m2 or st */
    eenheid: string;
    material: number;
    onsite: number;
    voorbewerking: number;
    assemblage: number;
    montage: number;
    afbouw: number;
}

export interface OfferOptions
{
    /** The builder whose prices the offer shows, by their name in the template (its BOUWERS tab):
     *  anonymous, as each builder publishes it from their own product sheet. Default: the first. */
    bouwer?: string;
    /** What the client takes from the builder: one of the template's scenarios ('Full Service',
     *  'DIY Casco Afbouw', 'DIY Bouwpakket', 'DIY Full'). Default: as the template has it. */
    scenario?: string;
    /** More inputs of the template, by name: `{ client: 'Jansen', floorarea_net: 54 }`. */
    inputs?: Record<string, unknown>;
    /** For a private template opened by its URL: the name of the Google key in Keys. */
    key?: string;
}

/** What compute() returns: the costs including margins, and the lines with theirs. */
export interface ProductOverview extends ProductCosts
{
    lines: Array<ProductLine>;
    /** Products the sheet has no recipe for, nor for anything like them: no labour in the costs. */
    noRecipe: Array<string>;
    /** Lines the sheet has no price for: not in the costs. */
    noPrice: Array<string>;
}

/** A line of the order list: a product to buy for one component, in the stock it is sold in. */
export interface OrderLine
{
    /** The component of the sheet it is for ('hsbwand'), with `byComponent`; else, and when the
     *  model did not say, ''. */
    component: string;
    product: string;
    /** The product as a specification names it: 'SLS-regel 38x235'. */
    description: string;
    /** The stock it is bought in (mm): [length] of a beam, [width, length] of a sheet; empty
     *  for what is sold per m1, per m2 or per piece. */
    stock: Array<number>;
    /** How many to buy, in `unit`. */
    quantity: number;
    /** st (pieces of stock, or pieces), m1 or m2 */
    unit: 'st' | 'm1' | 'm2';
    /** What the model needs, net, in `netUnit`. */
    net: number;
    /** m1 for a beam, m2 for a sheet, st for anything else */
    netUnit: 'st' | 'm1' | 'm2';
    /** The price of one `unit`, excluding the sheet's margins and BTW. */
    price: number;
    /** quantity x price */
    total: number;
}

/** What fromSheet() reads, by name. The defaults are those of the URHOUSE sheet. */
export interface ProductSheetOptions
{
    /** The products table. Default 'producten'. */
    products?: string;
    /** The operations table. Default 'bewerkingen'. */
    operations?: string;
    /** The recipes and representative components, see recipes.ts. Default 'componenten'. */
    components?: string;
    /** For a private sheet opened by its URL: the name of the Google key in Keys to read it
     *  with, as `cloudcalc.open(url, { key })` takes it. Default: the user's default key. */
    key?: string;
}

/** A workbook of the cloudcalc module, as far as this class uses it. */
interface SheetWorkbook
{
    /** A table's rows, computed with `input` (cloudcalc: else with the last compute()'s). */
    table(name: string, input?: Record<string, unknown>): Array<Record<string, unknown>>;
    tables(): Array<{ name: string }>;
    compute(input: Record<string, unknown>): Record<string, unknown>;
    namedRanges(): Array<{ name: string, range: string }>;
}

/** One shape: matched to a product, or standing for a component by its volume (mm3). */
type Assignment =
    | { kind: 'product', product: Product, measure: PartMeasure, label: string, block?: string }
    | { kind: 'component', component: Component, volume: number, label: string, block?: string };

/** The quantities of one shape or one add(), before they are added up to lines. */
interface Entry
{
    id: string;
    kind: LineKind;
    vorm: string;
    quantities: ProductQuantities;
    label?: string;
    /** The component whose recipe it follows. */
    block?: string;
}

/** What compute() reads from the sheet. */
interface CostData
{
    blocks: Map<string, Block>;
    /** Percentages. */
    margins: { materiaal: number, arbeid: number, algemeen: number };
    /** Waste as a fraction, by vorm. */
    waste: Map<string, number>;
}

interface Addition extends ProductOptions
{
    id: string;
    kind: LineKind;
    quantities: ProductQuantities;
}

/** What add() and complete() said in a script without products (a component), shared by the
 *  shapes its assign() mapped. Each of them brings an equal share of it to collect(): a copy
 *  of the whole (three cached bents, a wall copied) brings all of it again. */
interface TakeOff
{
    /** How many shapes share it. */
    shapes: number;
    adds: Array<{ id: string, quantities: ProductQuantities, options: ProductOptions }>;
    completes: Array<{ component: string, quantities: ProductQuantities, options: Pick<ProductOptions, 'label'> & { except?: Array<string> } }>;
}

/** What a shape is as a part, as assign() maps it without products: kept on the shape
 *  (`_product`), resolved by collect() against the sheet. */
interface ProductMapping
{
    kind: 'product-mapping';
    /** The product id, product group or component assign() was given, or the candidates. */
    of: string | Array<string>;
    /** Its options, with the label of the part's group. */
    options: AssignOptions;
    takeOff: TakeOff;
}

const isMapping = (value: unknown): value is ProductMapping => (value as ProductMapping | undefined)?.kind === 'product-mapping';

//// SETTINGS ////

const LINEAR = new Set(['balk', 'paal', 'profiel']);
const SHEET = new Set(['plaat', 'mat', 'rol', 'baan', 'laag', 'pan']);
/** Mats are pressed into a bay across their width, so only the cut to length is sawn. */
const SAWN_TO_LENGTH_ONLY = new Set(['mat']);
const SAWN = new Set(['plaat', 'mat']);

const QUANTITY_KEYS = ['st', 'lengte', 'oppervlak', 'volume', 'zaaglengte'] as const;
const COST_KEYS = ['material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw', 'total'] as const;
const CATEGORIES = COST_KEYS.slice(0, 6) as ReadonlyArray<Exclude<typeof COST_KEYS[number], 'total'>>;

const DEFAULT_TOLERANCE = 1;
/** The width of a saw cut (mm), between two parts cut from one length. */
const DEFAULT_KERF = 4;
const KIND_ORDER: Array<LineKind> = ['product', 'component', 'operation'];

//// PRODUCTS ////

/** A positive number from a cell, else null. */
function size(value: unknown): number | null
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
function fit(product: Product, m: PartMeasure, tolerance: number): Array<number> | null
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
function orient(product: Product, m: PartMeasure, tolerance: number): PartMeasure
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
const compareRanks = (a: Array<number>, b: Array<number>): number =>
    a.map((v, i) => (v === b[i] ? 0 : v - b[i]!)).find(d => d !== 0) ?? 0;

/** How many pieces of stock a part takes, and how much is sawn (mm), in the orientation
 *  that takes the fewest pieces. A side the stock has no size for is not cut. */
function sheetUse(product: Product, m: PartMeasure, tolerance: number): { pieces: number, sawn: number }
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
function partQuantities(product: Product, m: PartMeasure, tolerance: number): Required<ProductQuantities>
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

const sizeText = (m: PartMeasure): string =>
    [m.thickness, m.width, m.length].map(v => Math.round(v * 10) / 10).join(' x ');

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

/** How many lengths of stock (mm) the parts (mm) are cut from: longest first, each into the
 *  first length it still fits in, with a saw cut of `kerf` between two parts. */
export function cutLengths(parts: Array<number>, stock: number, kerf: number = DEFAULT_KERF): number
{
    const left: Array<number> = [];
    [...parts].sort((a, b) => b - a).forEach(length =>
    {
        const i = left.findIndex(rest => rest >= length + kerf);
        if (i >= 0) { left[i] -= length + kerf; }
        else { left.push(stock - length); }
    });
    return left.length;
}

/** The price of a quantity of a product, excluding margins: see materialPrice(). */
const priceOf = (product: Product, q: ProductQuantities): number =>
    materialPrice(product.row, { st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0, ...q });

/** What to buy of a product for the parts (lengths in mm, beams only) and the quantities
 *  added by size: beams in lengths of stock, cut from them; sheets in pieces of stock by
 *  their area with its waste; what is sold per m1 or m2 in those, with its waste. */
function orderOf(product: Product, parts: Array<number>, added: Required<ProductQuantities>, waste: number, kerf: number)
    : Pick<OrderLine, 'stock' | 'quantity' | 'unit' | 'net' | 'netUnit' | 'price'>
{
    const up = (v: number, step: number) => Math.ceil(Math.round(v / step * 1e6) / 1e6) * step;
    if (product.measure === 'linear')
    {
        const [stock] = product.stock as [number];
        const net = (parts.reduce((sum, l) => sum + l, 0) + added.lengte * 1000) / 1000;
        if (stock === Infinity)
        {
            return { stock: [], quantity: up(net * (1 + waste), 0.1), unit: 'm1', net, netUnit: 'm1', price: priceOf(product, { lengte: 1 }) };
        }
        // added by size: lengths of stock with the waste; added in pieces: those
        const extra = added.lengte ? up(added.lengte * 1000 * (1 + waste) / stock, 1) : up(added.st, 1);
        return { stock: [stock], quantity: cutLengths(parts, stock, kerf) + extra, unit: 'st', net, netUnit: 'm1', price: priceOf(product, { lengte: stock / 1000 }) };
    }
    if (product.measure === 'sheet')
    {
        const [a, b] = product.stock as [number, number];
        const net = added.oppervlak;
        if (b === Infinity)
        {
            return { stock: [], quantity: up(net * (1 + waste), 0.1), unit: 'm2', net, netUnit: 'm2', price: priceOf(product, { oppervlak: 1 }) };
        }
        const area = a * b / 1e6;
        const quantity = net ? up(net * (1 + waste) / area, 1) : up(added.st, 1);
        return { stock: [a, b], quantity, unit: 'st', net, netUnit: 'm2', price: priceOf(product, { oppervlak: area }) || priceOf(product, { st: 1 }) };
    }
    return { stock: [], quantity: up(added.st, 1), unit: 'st', net: added.st, netUnit: 'st', price: priceOf(product, { st: 1 }) };
}

/** A product as a specification names it: its type and the size that tells it apart
 *  ('SLS-regel 38x235', 'Houtvezel buitenplaat 16 mm'). */
function productLabel(p: Product): string
{
    // the type up to its first comma that is not inside brackets: 'Bouwplank (gezaagd, ruw), vuren'
    const type = String(p.row['type'] ?? p.id).replace(/\([^)]*\)/g, m => m.replace(/,/g, '\u0000')).split(',')[0]!.replace(/\u0000/g, ',').trim();
    const size = p.measure === 'linear' && p.dims.length === 2 ? p.dims.map(d => Math.round(d)).join('x')
        : p.measure === 'sheet' && p.thickness ? `${p.thickness} mm` : '';
    return size ? `${type} ${size}` : type;
}

/** The shapes' names without their index, as partList() writes them: 'insulation0' → 'insulation'. */
const baseNames = (shapes: Array<any>): string =>
    [...new Set(shapes
        .map(s => (typeof s?.name === 'function' ? s.name() : '') ?? '')
        .map((n: string) => n.replace(/[\s_\-.]*\d+$/, '') || n)
        .filter(Boolean))]
        .join(', ');

//// MANAGER ////

/**
 *  Products of a product sheet for the parts of a model, and their costs.
 *  Made by `make.products()`; nothing is read until fromSheet() or fromRows().
 *
 *  @example
 *  // Products as rows, here written out; in practice fromSheet(url) reads them from the sheet
 *  products = make.products().fromRows([
 *      { product_id: 'sls-38x140', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 5400 },
 *      { product_id: 'houtvezel-flex-140', productgroep: 'HOUTVEZEL-FLEX', vorm: 'mat', dikte: 140, breedte: 575, lengte: 1350 },
 *  ])
 *  wall = make.wall(3000, 2700, 140)
 *  products.assign('SLS', wall)
 *  products.assign('HOUTVEZEL-FLEX', wall.insulation)
 *  products.toTable()
 */
export class ProductManager
{
    private _modules: (() => ArchiyouModules) | null;
    private _products: Array<Product> = [];
    private _operations: Array<OperationRow> = [];
    private _components: Array<Component> = [];
    private _workbook: SheetWorkbook | null = null;
    private _sheet: Required<Omit<ProductSheetOptions, 'key'>> = { products: 'producten', operations: 'bewerkingen', components: 'componenten' };
    /** Per shape, the product it was matched to. A later assign() replaces it. */
    private _assigned = new Map<any, Assignment>();
    /** Shapes a group assign() saw but found no product for, until something else takes them. */
    private _unmatched = new Set<any>();
    private _added: Array<Addition> = [];
    /** Without products: what add() and complete() said, for the shapes assign() mapped to bring along. */
    private _mappedTakeOff: TakeOff | null = null;
    private _waste = new Map<string, number>();
    private _costs: Array<ProductCosts> | null = null;
    /** Per line of the last compute(), whose recipe gave its labour. */
    private _labour: Array<string | null> | null = null;
    /** The sheet's outputs, for the components' prices and the margins. */
    private _outputs: Record<string, any> | null = null;
    private _costData: CostData | null = null;
    private _recipes = new Map<string, { steps: Array<RecipeStep>, source: string } | null>();
    /** The offer template fromOffer() read. */
    private _offer: SheetWorkbook | null = null;
    /** The template and inputs of the last offer(), for its page. */
    private _offered: { wb: SheetWorkbook, input: Record<string, unknown> } | null = null;

    /** @param modules - the run's modules, asked for only when a table is made. */
    constructor(modules: (() => ArchiyouModules) | null = null)
    {
        this._modules = modules;
    }

    //// LOADING ////

    /**
     *  Read the products and operations from a product sheet, to price the lines by its rows on
     *  compute(). The sheet is opened with the cloudcalc module, a standard module the run loads
     *  for this call; no `$module()` needed.
     *
     *  @param sheet - The sheet's URL (or id), or a workbook the script opened itself with
     *  `cloudcalc.open(url)`, to use it for more than the products.
     *  @param options - Other names for the tables than the defaults, and `key` for a private sheet.
     */
    fromSheet(sheet: SheetWorkbook | string, options: ProductSheetOptions = {}): this
    {
        const wb = (typeof sheet === 'string') ? this._openSheet(sheet, options.key) : sheet;
        if (typeof wb?.table !== 'function' || typeof wb?.compute !== 'function')
        {
            throw new Error('ProductManager.fromSheet(): expected the URL of a Google Sheet, or a workbook of the cloudcalc module');
        }
        const { key: _key, ...names } = options;
        this._sheet = { ...this._sheet, ...names };
        const operations = wb.tables().some(t => t.name === this._sheet.operations) ? wb.table(this._sheet.operations) : [];
        // a component is what has a cost per m3; costm2 or costst says its unit
        // in the order of the sheet: the row their cost per m3 is on
        const ranges = wb.namedRanges();
        const costs = ranges
            .map(r => r.name.match(/^outputs\.([^.]+)\.cost(m2|st|m3)$/))
            .filter((m): m is RegExpMatchArray => m !== null);
        // the row of the cell after the tab: 'componenten2'!$AD$40 is 40
        const rowOf = (id: string) => Number(String(ranges.find(r => r.name === `outputs.${id}.costm3`)?.range ?? '').split('!').pop()!.match(/[A-Z]+\$?(\d+)/i)?.[1] ?? Infinity);
        const components = [...new Set(costs.filter(m => m[2] === 'm3').map(m => m[1]!))]
            .sort((a, b) => rowOf(a) - rowOf(b))
            .map(id => ({ component: id, eenheid: costs.find(m => m[1] === id && m[2] !== 'm3')?.[2] ?? null }));
        this.fromRows(wb.table(this._sheet.products) as Array<ProductRow>, operations as Array<OperationRow>, components);
        this._workbook = wb;
        return this;
    }

    /**
     *  Read the components from an offer template instead of a product sheet: what its builders
     *  published (the template's BOUWERSPRIJZEN tab). Enough to make an offer, without access to any
     *  builder's own sheet: `make.products().fromOffer(OFFER_TEMPLATE).add('hsbwand', { oppervlak: 48 }).offer()`.
     *
     *  @param template - The offer template's URL, or its workbook opened with cloudcalc.
     *  @param options - `key` for a private template.
     */
    fromOffer(template: SheetWorkbook | string, options: { key?: string } = {}): this
    {
        const wb = this._openTemplate('fromOffer', template, options.key);
        const seen = new Set<string>();
        const components = this._offerPrices(wb)
            .filter(r => r.bouwer !== 'alle' && !seen.has(r.component) && seen.add(r.component))
            .map(r => ({ component: r.component, eenheid: r.eenheid, gebouwdeel: r.gebouwdeel, groep: r.groep }));
        this.fromRows([], [], components);
        this._offer = wb;
        return this;
    }

    /** The workbook fromSheet() read, for what else the sheet computes:
     *  `products.workbook.compute().wall.costm3`. Null before fromSheet(). */
    get workbook(): SheetWorkbook | null
    {
        return this._workbook;
    }

    /**
     *  Products (and operations and components) given as rows with the columns of the sheet:
     *  product_id, productgroep, vorm, dikte, breedte, hoogte, lengte; naam, werkeenheid;
     *  component, eenheid. Without a sheet, compute() is not available, but assign(), add(),
     *  list() and toTable() are.
     */
    fromRows(products: Array<ProductRow>, operations: Array<OperationRow> = [], components: Array<ComponentRow> = []): this
    {
        // what assign() and add() matched holds products of the set loaded before
        if (this._assigned.size || this._unmatched.size || this._added.length)
        {
            throw new Error('ProductManager: products are loaded once, before assign() and add(). For another product set use another make.products()');
        }
        this._products = products.filter(r => r?.product_id).map(toProduct);
        this._operations = operations.filter(r => r?.naam);
        this._components = components
            .filter(r => r?.component)
            .map(row => ({ id: String(row.component).trim(), unit: String(row.eenheid ?? '').trim(), row }));
        // an offer template has components only
        if (this._products.length === 0 && this._components.length === 0)
        {
            throw new Error('ProductManager: no products: the rows need a product_id column');
        }
        this._workbook = null;
        this._outputs = null;
        this._costData = null;
        this._recipes.clear();
        this._matchCache.clear();
        this._costs = null;
        return this;
    }

    /** The products with this id, or in this group (case does not matter for groups). */
    find(idOrGroup: string): Array<Product>
    {
        const exact = this._products.filter(p => p.id === idOrGroup);
        if (exact.length) { return exact; }
        const group = idOrGroup.trim().toUpperCase();
        return this._products.filter(p => p.groups.some(g => g.toUpperCase() === group));
    }

    //// ASSIGNING ////

    /**
     *  Match parts of the model to a product, or to the product of a group that fits them.
     *
     *  With a product id, every part gets that product (with a warning for a part that does
     *  not fit its size). With a group, each part gets the product of the group that fits:
     *  the section for a balk, the thickness for a plaat or mat; then the shortest length or
     *  the smallest sheet that holds it. Parts that fit none are left as they are, so one
     *  call can take a whole wall; it is an error when none fits at all, and when two
     *  products fit a part equally well. A later assign() of a shape replaces an earlier one.
     *
     *  A plaat or mat is as thick as its smallest size. An offcut can be smaller than that
     *  (insulation under a window, 80 mm high in a wall of 140): by product id, the size that
     *  equals the product's thickness counts as its thickness; by group, only when nothing in
     *  the group fits it as it is. Assign insulation of a known depth by id.
     *
     *  With a component ('hsbwand'), each shape is only a mass: its volume is priced at the
     *  component's cost per m3. For an abstract model, roughly.
     *
     *  With `component` the parts follow that component's recipe in the sheet: see the top of this file.
     *
     *  @param idOrGroup - A product id ('sls-38x140'), a product group ('SLS') or a component ('hsbwand'),
     *  or several, tried in order: each part gets the first that fits it. `['SLS', 'SLS-GEVINGERLAST']`
     *  takes finger-jointed SLS only for what is longer than SLS comes.
     *  @param shapes - A shape, a collection (with its groups, like a wall) or an array.
     *  @example
     *  products = make.products().fromRows([
     *      { product_id: 'sls-38x140', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 5400 },
     *      { product_id: 'sls-38x235', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 235, lengte: 5400 },
     *  ])
     *  products.assign('SLS', make.wall(3000, 2700, 140))
     *  products.list()
     */
    assign(idOrGroup: string | Array<string>, shapes: any, options: AssignOptions = {}): this
    {
        if (this._mapsOnly()) { return this._map(idOrGroup, shapes, options); }
        if (Array.isArray(idOrGroup)) { return this._assignFirstFit(idOrGroup, shapes, options); }
        this._checkComponent('assign', options.component);
        const component = this._products.some(p => p.id === idOrGroup) ? undefined : this._components.find(c => c.id === idOrGroup);
        if (component) { return this._assignComponent(component, shapes, options); }

        const products = this._requireProducts('assign', idOrGroup);
        const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
        const exact = products.length === 1 && products[0]!.id === idOrGroup ? products[0]! : null;
        const parts = collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true });
        if (parts.length === 0)
        {
            throw new Error(`ProductManager.assign('${idOrGroup}'): no solid shapes to assign`);
        }

        // the group a part is in ('studs' of a wall), else the collection's name, else its shapes' names
        const named = typeof shapes?._name === 'string' && shapes._name !== 'collection' ? shapes._name : '';
        const misfits: Array<string> = [];
        const matched = parts.map(part =>
        {
            const found = exact
                ? { product: exact, measure: orient(exact, part.measure, tolerance) }
                : this._match(idOrGroup, products, part.measure, tolerance);
            if (exact && !fit(exact, found!.measure, tolerance)) { misfits.push(sizeText(part.measure)); }
            const label = options.label ?? (part.group && part.group !== 'main' ? part.group : named || baseNames(part.shapes));
            part.shapes.forEach(shape =>
            {
                if (!found) { if (!this._assigned.has(shape)) { this._unmatched.add(shape); } return; }
                this._assigned.set(shape, { kind: 'product', product: found.product, measure: found.measure, label, block: options.component });
                this._unmatched.delete(shape);
            });
            return found?.product ?? null;
        });

        if (matched.every(p => p === null))
        {
            const sizes = [...new Set(parts.map(p => sizeText(p.measure)))].slice(0, 5).join(', ');
            throw new Error(`ProductManager.assign('${idOrGroup}'): no product of '${idOrGroup}' fits any of the parts (${sizes}). ` +
                `It has: ${products.map(p => p.id).join(', ')}`);
        }
        if (misfits.length)
        {
            console.warn(`ProductManager.assign('${idOrGroup}'): ${misfits.length} part(s) do not fit its size: ${[...new Set(misfits)].slice(0, 5).join(', ')}`);
        }
        if (options.waste !== undefined) { matched.filter(Boolean).forEach(p => this._waste.set(p!.id, options.waste!)); }
        this._costs = null;
        return this;
    }

    /**
     *  Add what the model does not show: a product (screws, tape), an operation of the sheet
     *  (montagewand, aftapen) or a component (wall, per m3, m2 or piece), with its quantities.
     *  Adding the same id again adds up.
     *
     *  @param id - A product id, the name of an operation, or a component.
     *  @param quantities - In the sheet's units: st, lengte (m1), oppervlak (m2), volume (m3), zaaglengte (m1).
     *  @example
     *  products = make.products().fromRows(
     *      [{ product_id: 'schroef-rvs-6x100', productgroep: 'SCHROEF', vorm: 'stuk', breedte: 6, lengte: 100 }],
     *      [{ naam: 'montagewand', fase: 'montage', werkeenheid: 'st' }])
     *  products.add('schroef-rvs-6x100', { st: 32 }).add('montagewand', { st: 1 })
     *  products.list()
     */
    add(id: string, quantities: ProductQuantities, options: ProductOptions = {}): this
    {
        if (this._mapsOnly())
        {
            this._takeOff().adds.push({ id, quantities, options });
            return this;
        }
        this._checkComponent('add', options.component);
        const kind = this._kindOf(id);
        if (!kind)
        {
            const known = [...this._products.map(p => p.id), ...this._operations.map(o => o.naam), ...this._components.map(c => c.id)];
            const close = known.filter(k => k.toLowerCase().includes(id.toLowerCase().slice(0, 4))).slice(0, 8);
            throw new Error(`ProductManager.add('${id}'): not a product, an operation or a component of the sheet` +
                (close.length ? `. Did you mean: ${close.join(', ')}?` : ''));
        }
        const unknown = Object.keys(quantities ?? {}).filter(k => !(QUANTITY_KEYS as ReadonlyArray<string>).includes(k));
        if (unknown.length)
        {
            throw new Error(`ProductManager.add('${id}'): unknown quantities ${unknown.join(', ')}; use ${QUANTITY_KEYS.join(', ')}`);
        }
        if (kind === 'component')
        {
            // priced per m3 when it has a volume, else per its own unit
            const unit = this._components.find(c => c.id === id)!.unit;
            const priced = quantities.volume || (unit === 'm2' ? quantities.oppervlak : unit === 'st' ? quantities.st : 0);
            if (!priced)
            {
                throw new Error(`ProductManager.add('${id}'): a component is priced per m3 (volume)` +
                    (unit === 'm2' ? ' or per m2 (oppervlak)' : unit === 'st' ? ' or per piece (st)' : ''));
            }
        }
        this._added.push({ id, kind, quantities, ...options });
        if (options.waste !== undefined) { this._waste.set(id, options.waste); }
        this._costs = null;
        return this;
    }

    /**
     *  The work on an element as a whole, which is on no product: its mounting, squaring and
     *  handling, as the `element` rows of the component's block say. Scaled by size from the
     *  representative component, so this agrees with the component's price per m2 or per piece.
     *  Adds them as operation lines. Needs the sheet: fromSheet().
     *
     *  @param component - A component of the sheet: 'hsbwand'.
     *  @param quantities - How much of it the model has, in its unit: `{ oppervlak: 21.6 }` or `{ st: 2 }`.
     */
    elementWork(component: string, quantities: ProductQuantities, options: Pick<ProductOptions, 'label'> = {}): this
    {
        this._checkComponent('elementWork', component);
        const block = this._loadCostData('elementWork').blocks.get(component);
        if (!block)
        {
            throw new Error(`ProductManager.elementWork('${component}'): the sheet has no block for this component`);
        }
        const key = quantityOfUnit(block.unit);
        const amount = key ? quantities[key] : undefined;
        if (!key || !amount || !(block.size > 0))
        {
            throw new Error(`ProductManager.elementWork('${component}'): it is sized in ${block.unit}: give ${key ?? 'its size'}`);
        }
        block.element.forEach(work => this.add(work.operation, { [work.quantity]: work.amount * amount / block.size },
            { label: options.label ?? component, component }));
        return this;
    }

    /**
     *  Complete a component with what the model does not show: the products of its block in the
     *  sheet that nothing assigned or added with this component stands for, scaled by size, and
     *  the work on the element as a whole (elementWork()). A product of the block is shown when
     *  the model has it, or a product of the same line (its first productgroep): rafters of
     *  sls-38x170 stand for the block's sls-38x285. Call it after the assign()s of the component.
     *
     *  @param component - A component of the sheet: 'hsbwand'.
     *  @param quantities - How much of it the model has, in its unit: `{ oppervlak: 21.6 }` or `{ st: 2 }`.
     *  @param options.except - Products of the block to leave out (the model has another build-up).
     *  @example
     *  products.assign('SLS', wall, { component: 'hsbwand' })
     *  products.assign('houtvezel-flex-240', wall.insulation, { component: 'hsbwand' })
     *  products.complete('hsbwand', { oppervlak: 8.1 })  // sheathing, gypsum, screws, tape and the element work
     */
    complete(component: string, quantities: ProductQuantities, options: Pick<ProductOptions, 'label'> & { except?: Array<string> } = {}): this
    {
        if (this._mapsOnly())
        {
            this._takeOff().completes.push({ component, quantities, options });
            return this;
        }
        this._checkComponent('complete', component);
        const block = this._loadCostData('complete').blocks.get(component);
        if (!block)
        {
            throw new Error(`ProductManager.complete('${component}'): the sheet has no block for this component`);
        }
        const key = quantityOfUnit(block.unit);
        const amount = key ? quantities[key] : undefined;
        if (!key || !amount || !(block.size > 0))
        {
            throw new Error(`ProductManager.complete('${component}'): it is sized in ${block.unit}: give ${key ?? 'its size'}`);
        }
        const line = (id: string) => this._products.find(p => p.id === id)?.groups[0] ?? id;
        const shown = [
            ...[...this._assigned.values()].filter(a => a.kind === 'product' && a.block === component).map(a => (a as { product: Product }).product.id),
            ...this._added.filter(a => a.kind === 'product' && a.component === component).map(a => a.id),
        ];
        const shownLines = new Set(shown.map(line));
        const scale = amount / block.size;
        block.products
            .filter(p => !shownLines.has(line(p.id)) && !(options.except ?? []).includes(p.id))
            .map(p => ({ id: p.id, scaled: Object.fromEntries(Object.entries(p.quantities)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => [k, v * scale])) }))
            .filter(p => Object.keys(p.scaled).length > 0)
            .forEach(p => this.add(p.id, p.scaled, { label: options.label ?? component, component }));
        return this.elementWork(component, quantities, options);
    }

    /**
     *  Take the parts that components mapped, and price them by this sheet. A component maps
     *  its parts without a sheet: make.products() with assign(), add() and complete() there
     *  only note on each shape what it is ('SLS' for hsbwand), so the component loads nothing.
     *  Here each mapping is resolved as if assign() was called with the sheet, then the add()s
     *  and complete()s, each shape bringing its share: a component used three times brings
     *  them three times. What does not fit is left out with a warning, not an error: see
     *  unassigned(). An assign() after collect() replaces a mapping.
     *
     *  @param shapes - The model, or a part of it: all(), a component's model.
     *  @example
     *  // in the wall component, without a sheet
     *  products = make.products()
     *  products.assign('SLS', wall.studs, { component: 'hsbwand' })
     *  products.complete('hsbwand', { oppervlak: 8.1 })
     *  // in the house
     *  products = make.products().fromSheet(CORE).collect(all())
     *  products.compute()
     */
    collect(shapes: any, options: { hidden?: boolean } = {}): this
    {
        if (this._mapsOnly())
        {
            throw new Error('ProductManager.collect(): needs products to resolve the mappings with: make.products().fromSheet(url).collect(shapes)');
        }
        const mapped = [...new Set(collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true })
            .flatMap(part => part.shapes)
            .filter(shape => isMapping(shape?._product)))];

        // the parts, by what they were mapped to
        const groups = new Map<string, { mapping: ProductMapping, shapes: Array<any> }>();
        mapped.forEach(shape =>
        {
            const mapping = shape._product as ProductMapping;
            const key = JSON.stringify([mapping.of, mapping.options]);
            if (!groups.has(key)) { groups.set(key, { mapping, shapes: [] }); }
            groups.get(key)!.shapes.push(shape);
        });
        // a group that fails as a whole (one offcut fits two products) is tried part by part
        groups.forEach(({ mapping, shapes: list }) =>
        {
            try { this.assign(mapping.of, list, mapping.options); }
            catch
            {
                list.forEach(shape => this._collectStep(`assign('${mapping.of}')`,
                    () => this.assign(mapping.of, shape, mapping.options),
                    () => { if (!this._assigned.has(shape)) { this._unmatched.add(shape); } }));
            }
        });

        // what the components added, each shape bringing its share
        const shares = new Map<TakeOff, number>();
        mapped.forEach(shape =>
        {
            const takeOff = (shape._product as ProductMapping).takeOff;
            shares.set(takeOff, (shares.get(takeOff) ?? 0) + 1 / takeOff.shapes);
        });
        const scaled = (quantities: ProductQuantities, share: number): ProductQuantities =>
            Object.fromEntries(Object.entries(quantities).map(([key, value]) => [key, Number(value) * share]));
        shares.forEach((share, takeOff) => takeOff.adds.forEach(a => this._collectStep(`add('${a.id}')`,
            () => this.add(a.id, scaled(a.quantities, share), a.options))));

        // complete() once per component, for all of it
        const completes = new Map<string, { quantities: ProductQuantities, except: Set<string> }>();
        shares.forEach((share, takeOff) => takeOff.completes.forEach(c =>
        {
            const sum = completes.get(c.component) ?? { quantities: {}, except: new Set<string>() };
            Object.entries(scaled(c.quantities, share)).forEach(([key, value]) =>
            {
                sum.quantities[key as keyof ProductQuantities] = (sum.quantities[key as keyof ProductQuantities] ?? 0) + Number(value);
            });
            (c.options.except ?? []).forEach(id => sum.except.add(id));
            completes.set(c.component, sum);
        }));
        completes.forEach((c, component) => this._collectStep(`complete('${component}')`,
            () => this.complete(component, c.quantities, { except: [...c.except] })));

        this._costs = null;
        return this;
    }

    /**
     *  The shapes that have no product. Of `shapes` when given (say the whole model);
     *  otherwise of what assign() was given.
     */
    unassigned(shapes?: any, options: { hidden?: boolean } = {}): ShapeCollection
    {
        const loose = shapes === undefined
            ? [...this._unmatched]
            : collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true })
                .flatMap(p => p.shapes)
                .filter(s => !this._assigned.has(s));
        return new ShapeCollection(loose);
    }

    //// RESULTS ////

    /** The lines: one per product, component and operation, quantities added up. Products
     *  come first, in the order they were first assigned or added; then the components, then
     *  the operations. With costs after compute(). */
    list(): Array<ProductLine>
    {
        const lines = new Map<string, ProductLine>();
        this._entries().forEach(entry =>
        {
            if (!lines.has(entry.id))
            {
                lines.set(entry.id, { id: entry.id, kind: entry.kind, vorm: entry.vorm, description: '', waste: this._waste.get(entry.id) ?? null, shapes: 0,
                    st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0, costs: null, labour: null });
            }
            const line = lines.get(entry.id)!;
            QUANTITY_KEYS.forEach(k => { line[k] = round(line[k] + (entry.quantities[k] ?? 0)); });
            if (entry.isShape) { line.shapes++; }
            if (entry.label && !line.description.split(', ').includes(entry.label))
            {
                line.description = line.description ? `${line.description}, ${entry.label}` : entry.label;
            }
        });

        const all = [...lines.values()];
        const ordered = KIND_ORDER.flatMap(kind => all.filter(l => l.kind === kind));
        if (this._costs)
        {
            ordered.forEach((l, i) =>
            {
                l.costs = this._costs![i] ?? null;
                l.labour = this._labour?.[i] ?? null;
            });
        }
        return ordered;
    }

    /**
     *  The costs, from the rows of the sheet: per category including the sheet's margins, and per
     *  line excluding them. Material is the product's price with its waste, labour its recipe in
     *  the sheet at the operations' costs per unit. A component line is priced as a whole: do not
     *  also list its products. Needs fromSheet().
     *
     *  @returns `{ material, onsite, voorbewerking, assemblage, montage, afbouw, total, lines, noRecipe, noPrice }`
     */
    compute(): ProductOverview
    {
        const data = this._loadCostData('compute');
        const lines = this.list();
        const noRecipe = new Set<string>();
        const noPrice = new Set<string>();

        // the quantities per line and per component: one line can follow several recipes
        const contexts = new Map<string, Map<string, Required<ProductQuantities>>>();
        this._entries().forEach(entry =>
        {
            const own = contexts.get(entry.id) ?? new Map<string, Required<ProductQuantities>>();
            contexts.set(entry.id, own);
            const q = own.get(entry.block ?? '') ?? { st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0 };
            own.set(entry.block ?? '', q);
            QUANTITY_KEYS.forEach(k => { q[k] += entry.quantities[k] ?? 0; });
        });

        const priced = lines.map(line =>
        {
            const costs: ProductCosts = { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0, total: 0 };
            const sources = new Set<string>();
            const addWork = (fase: string, amount: number) =>
            {
                if ((CATEGORIES as ReadonlyArray<string>).includes(fase)) { costs[fase as typeof CATEGORIES[number]] += amount; }
            };

            if (line.kind === 'product')
            {
                const product = this._products.find(p => p.id === line.id)!;
                const waste = line.waste ?? data.waste.get(product.vorm) ?? 0;
                costs.material = materialPrice(product.row, line) * (1 + waste);
                if (!costs.material) { noPrice.add(line.id); }
                contexts.get(line.id)!.forEach((q, block) =>
                {
                    const recipe = this._recipe(product, block, data);
                    if (!recipe) { noRecipe.add(line.id); return; }
                    sources.add(recipe.source);
                    recipe.steps.forEach(step => addWork(step.fase, step.factor * q[step.per] * this._rate(step.operation)));
                });
            }
            else if (line.kind === 'operation')
            {
                const operation = this._operations.find(o => o.naam === line.id)!;
                const key = quantityOfUnit(operation.werkeenheid);
                const amount = key ? line[key] + (key === 'lengte' ? line.zaaglengte : 0) : 0;
                const rate = this._rate(line.id);
                if (!rate) { noPrice.add(line.id); }
                addWork(String(operation.fase ?? '').trim(), amount * rate);
            }
            else
            {
                const block = data.blocks.get(line.id);
                const key = block ? quantityOfUnit(block.unit) : null;
                // priced per m3 when it has a volume, else per its own unit
                const scale = !block ? 0 : line.volume ? line.volume / block.volume : (key ? line[key] : 0) / block.size;
                if (!block || !Number.isFinite(scale)) { noPrice.add(line.id); }
                else { CATEGORIES.forEach(k => { costs[k] = block.costs[k] * scale; }); }
            }
            costs.total = CATEGORIES.reduce((sum, k) => sum + costs[k], 0);
            return { costs, source: [...sources].join(', ') || null };
        });

        this._costs = priced.map(p => p.costs);
        this._labour = priced.map(p => p.source);

        const { materiaal, arbeid, algemeen } = data.margins;
        const onMaterial = (1 + materiaal / 100) * (1 + algemeen / 100);
        const onLabour = (1 + arbeid / 100) * (1 + algemeen / 100);
        const totals: ProductCosts = { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0, total: 0 };
        CATEGORIES.forEach(k =>
        {
            totals[k] = priced.reduce((sum, p) => sum + p.costs[k], 0) * (k === 'material' ? onMaterial : onLabour);
        });
        totals.total = CATEGORIES.reduce((sum, k) => sum + totals[k], 0);

        const loose = this._unmatched.size;
        if (loose)
        {
            console.warn(`ProductManager.compute(): ${loose} shape(s) have no product and are not in the costs: see products.unassigned()`);
        }
        if (noRecipe.size)
        {
            console.warn(`ProductManager.compute(): no recipe in the sheet, so no labour, for: ${[...noRecipe].join(', ')}`);
        }
        if (noPrice.size)
        {
            console.warn(`ProductManager.compute(): no price in the sheet for: ${[...noPrice].join(', ')}`);
        }
        return { ...totals, lines: this.list(), noRecipe: [...noRecipe], noPrice: [...noPrice] };
    }

    /**
     *  The lines as a table of the script: quantities, and the costs after compute().
     *  @param name - Name of the table. Default 'products'.
     */
    toTable(name = 'products'): Table
    {
        const calc = this._modules?.()?.calc;
        if (!calc)
        {
            throw new Error('ProductManager.toTable(): tables are only available inside a run');
        }
        const lines = this.list();
        const withCosts = lines.some(l => l.costs);
        const columns = ['product', 'description', 'vorm', ...QUANTITY_KEYS, 'waste', ...(withCosts ? [...COST_KEYS, 'labour'] : [])];
        const rows = lines.map(l => [
            l.id, l.description, l.vorm,
            ...QUANTITY_KEYS.map(k => Math.round(l[k] * 1000) / 1000),
            l.waste ?? '',
            ...(withCosts ? [...COST_KEYS.map(k => Math.round((l.costs?.[k] ?? 0) * 100) / 100), l.labour ?? ''] : []),
        ]);
        return calc.table(name, rows, columns) as Table;
    }

    /**
     *  The order list: the products to buy for the whole project, a line each, in the stock they
     *  are sold in: what a supplier is asked for. Beams in lengths of stock, the parts cut from
     *  them longest first (with a saw cut between two parts); sheets in pieces of stock by their
     *  area, with the waste of the sheet; what is sold per m1 or m2 in those, with the waste. A
     *  component the model has as a whole (add('beganegrondvloer', ...), or a mass) brings the
     *  products of its block in the sheet, scaled by size. Priced by the sheet's product rows,
     *  excluding its margins and BTW: the purchase, not the client's price. Beams first, then
     *  sheets, then the rest. Needs fromSheet().
     *
     *  @param options.byComponent - A list per component of the sheet instead, in the order the
     *    model first has them: what each costs. Its beams are cut from lengths of their own.
     *  @param options.kerf - The width of a saw cut (mm). Default 4.
     */
    orderList(options: { byComponent?: boolean, kerf?: number } = {}): Array<OrderLine>
    {
        const data = this._loadCostData('orderList');
        const kerf = options.kerf ?? DEFAULT_KERF;
        const empty = (): Required<ProductQuantities> => ({ st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0 });
        const needs = new Map<string, { component: string, product: Product, parts: Array<number>, added: Required<ProductQuantities> }>();
        const need = (of: string, product: Product) =>
        {
            const component = options.byComponent ? of : '';
            const key = `${component}|${product.id}`;
            if (!needs.has(key)) { needs.set(key, { component, product, parts: [], added: empty() }); }
            return needs.get(key)!;
        };
        const add = (component: string, id: string, quantities: ProductQuantities, scale = 1) =>
        {
            const product = this._products.find(p => p.id === id);
            if (!product) { return; }
            const n = need(component, product);
            QUANTITY_KEYS.forEach(k => { n.added[k] += (quantities[k] ?? 0) * scale; });
        };

        this._entries().forEach(entry =>
        {
            if (entry.kind === 'product' && entry.isShape && this._products.find(p => p.id === entry.id)?.measure === 'linear')
            {
                need(entry.block ?? '', this._products.find(p => p.id === entry.id)!).parts.push((entry.quantities.lengte ?? 0) * 1000);
            }
            else if (entry.kind === 'product')
            {
                add(entry.block ?? '', entry.id, entry.quantities);
            }
            else if (entry.kind === 'component')
            {
                // its block's products, scaled as compute() scales the component's cost
                const block = data.blocks.get(entry.id);
                const key = block ? quantityOfUnit(block.unit) : null;
                const scale = !block ? 0 : entry.quantities.volume ? entry.quantities.volume / block.volume : (key ? (entry.quantities[key] ?? 0) : 0) / block.size;
                if (!block || !Number.isFinite(scale)) { return; }
                block.products.forEach(p => add(entry.id, p.id, p.quantities, scale));
            }
        });

        // per component in the order the model first has it; beams, sheets, the rest; by name
        const components = [...new Set([...needs.values()].map(n => n.component))];
        const measures: Array<ProductMeasure> = ['linear', 'sheet', 'piece'];
        return [...needs.values()]
            .map(n => ({ n, label: productLabel(n.product) }))
            .sort((a, b) => components.indexOf(a.n.component) - components.indexOf(b.n.component)
                || measures.indexOf(a.n.product.measure) - measures.indexOf(b.n.product.measure)
                || a.label.localeCompare(b.label) || a.n.product.id.localeCompare(b.n.product.id))
            .map(({ n, label }) =>
            {
                const waste = this._waste.get(n.product.id) ?? data.waste.get(n.product.vorm) ?? 0;
                const order = orderOf(n.product, n.parts, n.added, waste, kerf);
                // a piece by its sizes too: 'Houtschroef 4.5x50'
                const description = n.product.measure === 'piece' && n.product.dims.length ? `${label} ${n.product.dims.join('x')}` : label;
                return { component: n.component, product: n.product.id, description, ...order, total: order.quantity * order.price };
            })
            .filter(l => l.quantity > 0);
    }

    /**
     *  The order list as a table of the script (see orderList()), with its total. Per component,
     *  with a total per component: a component is named as the sheet names it ('HSB wand').
     *
     *      products.orderTable('order')                              // to order, for the whole project
     *      products.orderTable('order', { byComponent: true })       // what each component costs
     *      products.orderTable('order_wall', { component: 'hsbwand' })
     *
     *  @param name - Name of the table. Default 'order'.
     *  @param options.byComponent - Per component, see orderList().
     *  @param options.component - Only this component ('hsbwand'): its lines and its total.
     *  @param options.kerf - The width of a saw cut (mm). Default 4.
     */
    orderTable(name = 'order', options: { byComponent?: boolean, component?: string, kerf?: number } = {}): Table
    {
        const calc = this._modules?.()?.calc;
        if (!calc)
        {
            throw new Error('ProductManager.orderTable(): tables are only available inside a run');
        }
        const outputs = this._sheetOutputs('orderTable');
        const named = (component: string) => String(outputs[component]?.naam ?? '').trim() || component || 'other';
        const r2 = (v: number) => Math.round(v * 100) / 100;
        // the component column only for a list of several
        const one = options.component !== undefined;
        const split = !one && options.byComponent === true;
        const rows = this.orderList({ ...options, byComponent: one || split })
            .filter(l => !one || l.component === options.component)
            .map(l => [
                ...(split ? [named(l.component)] : []), l.product, l.description, l.stock.map(Math.round).join(' x '),
                r2(l.quantity), l.unit, `${r2(l.net)} ${l.netUnit}`, r2(l.price), r2(l.total),
            ]);
        const columns = [...(split ? ['component'] : []), 'product', 'description', 'stock (mm)', 'quantity', 'unit', 'net', 'price per unit', 'price'];
        const table = calc.table(name, rows, columns) as Table;
        const sum = (values: Array<unknown>) => r2(values.reduce<number>((total, v) => total + (Number(v) || 0), 0));
        if (!split)
        {
            return table.footer({ product: 'Total', description: 'excl. margins and BTW', price: sum });
        }
        return table
            .footer({ product: 'subtotal', price: sum }, { groupBy: 'component' })
            .footer({ component: 'Total', product: 'excl. margins and BTW', price: sum });
    }

    //// OFFER ////

    /**
     *  The components of the sheet with their prices per unit by cost category, including the
     *  sheet's margins and excluding BTW: the price list an offer is made from. A component is in
     *  it when the sheet gives it a group and a name (`outputs.<component>.groep`, `.naam`).
     */
    prices(): Array<OfferPrice>
    {
        const out = this._sheetOutputs('prices');
        return this._components
            .map(c => ({ c, o: out[c.id] ?? {} }))
            .filter(({ o }) => o.groep && o.naam && Array.isArray(o.costs))
            .map(({ c, o }) => ({
                gebouwdeel: String(o.gebouwdeel ?? ''),
                groep: String(o.groep),
                component: c.id,
                naam: String(o.naam),
                omschrijving: String(o.producten ?? '').split(',').map(id => id.trim()).filter(Boolean)
                    .map(id => this._products.find(p => p.id === id))
                    .filter((p): p is Product => p !== undefined)
                    .map(productLabel)
                    .filter((label, i, all) => all.indexOf(label) === i)
                    .join(', '),
                eenheid: c.unit,
                ...Object.fromEntries(CATEGORIES.map((k, i) => [k, Number(o.costs[i]) || 0])) as Pick<OfferPrice, typeof CATEGORIES[number]>,
            }));
    }

    /**
     *  An offer: the template computed with the quantities of this model, at the prices one builder
     *  published to the template. Every component group of the template is a row with its quantity
     *  in inputs.<groep>; a group the model has gets the model's quantity in the component's unit (a
     *  mass assigned by its volume is converted at the builder's own price), the others 0. Which rows are on and their type stay the template's choice: in
     *  the client's copy the client can switch them, the builder and the scenario.
     *
     *      products = make.products().fromOffer(OFFER_TEMPLATE)
     *      products.add('hsbwand', { oppervlak: 48 }).add('dak', { oppervlak: 40 })
     *      offer = products.offer({ bouwer: 'URBUILD', scenario: 'DIY Bouwpakket' })
     *      offer.sheet('BOUWKOSTEN').toTable()     // the offer, here
     *      offer.cloudcopy({ title: 'Offerte Jansen', share: 'writer' })   // the client's copy
     *
     *  @param template - The offer template's URL or workbook. Default: the one of fromOffer().
     *  @param options - The builder, the scenario, more inputs of the template, a key for a private template.
     *  @returns The template's workbook, computed with the offer.
     */
    offer(template?: SheetWorkbook | string | OfferOptions, options: OfferOptions = {}): SheetWorkbook
    {
        if (template !== undefined && typeof template === 'object' && typeof (template as any).compute !== 'function')
        {
            return this.offer(undefined, template as OfferOptions);
        }
        const wb = (template === undefined)
            ? this._offer ?? (() => { throw new Error('ProductManager.offer(): needs the offer template: offer(OFFER_TEMPLATE), or make.products().fromOffer(OFFER_TEMPLATE)'); })()
            : this._openTemplate('offer', template as SheetWorkbook | string, options.key);

        const name = (v: unknown) => String(v ?? '').trim();
        const builders = wb.table('bouwers').filter(b => name(b['bouwer']));
        const bouwer = name(options.bouwer ?? builders[0]?.['bouwer']);
        const builder = builders.find(b => name(b['bouwer']) === bouwer);
        if (!builder)
        {
            throw new Error(`ProductManager.offer(): no builder '${bouwer}' in the template; it has: ${builders.map(b => b['bouwer']).join(', ') || 'none yet'}`);
        }
        if (options.scenario && builder[options.scenario] !== true)
        {
            console.warn(`ProductManager.offer(): ${bouwer} does not offer the scenario '${options.scenario}'`);
        }
        const prices = this._offerPrices(wb).filter(r => r.bouwer === bouwer);

        // the model's components, by group, in the unit of the component
        const used = new Map<string, { component: string, quantity: number }>();
        this.list().filter(l => l.kind === 'component').forEach(l =>
        {
            const price = prices.find(p => p.component === l.id);
            if (!price)
            {
                console.warn(`ProductManager.offer(): ${bouwer} has no price for component '${l.id}'; it is not in the offer`);
                return;
            }
            const quantity = l.volume > 0 && price.perUnit > 0
                ? l.volume * price.perM3 / price.perUnit
                : (price.eenheid === 'm2' ? l.oppervlak : l.st);
            const earlier = used.get(price.groep);
            if (earlier && earlier.component !== l.id)
            {
                console.warn(`ProductManager.offer(): '${earlier.component}' and '${l.id}' are both in group '${price.groep}', `
                    + `which is one row of the offer; it shows '${earlier.component}'`);
                return;
            }
            used.set(price.groep, { component: l.id, quantity: (earlier?.quantity ?? 0) + quantity });
        });
        const lost = this.list().filter(l => l.kind !== 'component').length;
        if (lost)
        {
            console.warn(`ProductManager.offer(): ${lost} product and operation line(s) are not in the offer, which has a row per component group`);
        }

        // the template's rows: a group of the price list with inputs.<groep>, its quantity; 0 when the model has none
        const named = new Set(wb.namedRanges().map(r => r.name));
        const rows = [...new Set(this._offerPrices(wb).map(p => p.groep))].filter(g => named.has(`inputs.${g}`));
        [...used.keys()].filter(g => !rows.includes(g)).forEach(g =>
            console.warn(`ProductManager.offer(): the template has no row for group '${g}' (inputs.${g})`));
        const groups = Object.fromEntries(rows.map(g => [g, Math.round((used.get(g)?.quantity ?? 0) * 100) / 100]));

        const input = {
            ...groups,
            bouwer,
            ...(options.scenario ? { scenario: options.scenario } : {}),
            ...(options.inputs ?? {}),
        };
        wb.compute(input);
        this._offered = { wb, input };
        return wb;
    }

    /**
     *  The outputs of the last offer(): its totals (`bouwkosten.totaal` incl. BTW, `.excl_btw`,
     *  `.incl_proces`) and specifications (`specificaties.gwp_a1c4_m2`, `.rc_wanden`, `.uren`,
     *  `.uren_diy`, ...), computed with the offer's inputs. `inputs` changes some of them for this
     *  call only, so one offer gives the totals of every scenario:
     *
     *      products.offer({ bouwer: 'URBUILD', scenario: 'Full Service' })
     *      full = products.offerOutputs().bouwkosten.totaal
     *      diy = products.offerOutputs({ scenario: 'DIY Full' }).bouwkosten.totaal   // materials only
     *
     *  @param inputs - Inputs of the template to change for this call, over those of offer().
     */
    offerOutputs(inputs: Record<string, unknown> = {}): Record<string, any>
    {
        if (!this._offered)
        {
            throw new Error('ProductManager.offerOutputs(): needs an offer first: products.offer({ bouwer, scenario })');
        }
        const { wb, input } = this._offered;
        return wb.compute({ ...input, ...inputs }) as Record<string, any>;
    }

    /**
     *  The last offer() as one flat HTML page for the client: the ticked rows per section with
     *  their costs by category ('zelf' where the scenario leaves it to the client), the totals,
     *  who does what per scenario and the chosen design and process steps. No scripts, no
     *  external files: to mail, to keep with a project, to open on a phone or print.
     *
     *      offer = products.offer({ bouwer: 'URBUILD', scenario: 'Full Service' })
     *      html = products.offerHtml({ klant: 'Fam. Jansen' })
     *
     *  Reads the template's tables bouwkosten (and proces, scenarios, bouwers when it has them)
     *  and outputs.bouwkosten.*, as computed by offer(). See offer-html.ts.
     */
    offerHtml(options: OfferPageOptions = {}): string
    {
        return renderOfferHtml(offerPageData(this._offerSource('offerHtml'), options));
    }

    /**
     *  The last offer() as a table of the script, a row per offer line, that carries the page of
     *  offerHtml(): the output `<pipeline>/tables/<name>/html` is that page, `.../xlsx` the lines.
     *
     *      products.offerPage('offerte', { klant: 'Fam. Jansen' })   // → default/tables/offerte/html
     *
     *  @param name - Name of the table. Default 'offer'.
     */
    offerPage(name: string = 'offer', options: OfferPageOptions = {}): Table
    {
        const calc = this._modules?.()?.calc;
        if (!calc)
        {
            throw new Error('ProductManager.offerPage(): tables are only available inside a run');
        }
        const data = offerPageData(this._offerSource('offerPage'), options);
        const columns = ['onderdeel', 'type', 'specificatie', 'hoeveelheid', 'eenheid', 'prijs per eenheid', ...data.categories, 'totaal'];
        const rows = data.sections.flatMap(s => s.lines.map(l =>
            [l.onderdeel, l.type, l.specificatie, l.hoeveelheid ?? '', l.eenheid, l.prijs ?? '', ...l.costs.map(c => c ?? ''), l.totaal ?? '']));
        return (calc.table(name, rows, columns) as Table).html(renderOfferHtml(data));
    }

    /** What the offer page reads from the last offer(). */
    private _offerSource(method: string): OfferSource
    {
        if (!this._offered)
        {
            throw new Error(`ProductManager.${method}(): needs an offer first: products.offer({ bouwer, scenario })`);
        }
        const { wb, input } = this._offered;
        const names = new Set(wb.tables().map(t => t.name));
        if (!names.has('bouwkosten'))
        {
            throw new Error(`ProductManager.${method}(): the offer template has no table bouwkosten (a named range tables.bouwkosten over its BOUWKOSTEN rows)`);
        }
        // with the offer's inputs: a compute() of the script in between does not change the page
        const table = (name: string) => (names.has(name) ? wb.table(name, input) : []);
        return {
            bouwkosten: table('bouwkosten'),
            proces: table('proces'),
            scenarios: table('scenarios'),
            bouwers: table('bouwers'),
            outputs: wb.compute(input) as Record<string, any>,
            input,
        };
    }

    //// INTERNAL ////

    /** Without products, as in a component: assign(), add() and complete() only map, for collect(). */
    private _mapsOnly(): boolean
    {
        return this._products.length === 0 && this._components.length === 0 && !this._workbook;
    }

    private _takeOff(): TakeOff
    {
        return this._mappedTakeOff ??= { shapes: 0, adds: [], completes: [] };
    }

    /** assign() without products: note on each shape what it is, with the label of its group. */
    private _map(idOrGroup: string | Array<string>, shapes: any, options: AssignOptions): this
    {
        const parts = collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true });
        if (parts.length === 0)
        {
            throw new Error(`ProductManager.assign('${idOrGroup}'): no solid shapes to assign`);
        }
        const named = typeof shapes?._name === 'string' && shapes._name !== 'collection' ? shapes._name : '';
        const takeOff = this._takeOff();
        parts.forEach(part =>
        {
            const label = options.label ?? (part.group && part.group !== 'main' ? part.group : named || baseNames(part.shapes));
            part.shapes.forEach(shape =>
            {
                if (!isMapping(shape._product) || shape._product.takeOff !== takeOff) { takeOff.shapes++; }
                shape._product = { kind: 'product-mapping', of: idOrGroup, options: { ...options, label }, takeOff } satisfies ProductMapping;
            });
        });
        return this;
    }

    /** assign() with candidates: each part gets the first of them that fits it. An error only
     *  when none of them fits any part. */
    private _assignFirstFit(candidates: Array<string>, shapes: any, options: AssignOptions): this
    {
        const all = collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true }).flatMap(p => p.shapes);
        const errors: Array<string> = [];
        candidates.reduce((rest: any, candidate, i) =>
        {
            const list = i === 0 ? all : rest as Array<any>;
            if (list.length === 0) { return list; }
            const before = new Map(list.map(shape => [shape, this._assigned.get(shape)]));
            try { this.assign(candidate, i === 0 ? shapes : list, options); }
            catch (e) { errors.push((e as Error).message); }
            return list.filter(shape => !this._assigned.has(shape) || this._assigned.get(shape) === before.get(shape));
        }, all);
        if (errors.length === candidates.length)
        {
            throw new Error(errors[0]);
        }
        return this;
    }

    /** One step of collect(): what does not fit is a warning, so one part does not stop the model. */
    private _collectStep(what: string, step: () => void, failed?: () => void): void
    {
        try { step(); }
        catch (e)
        {
            failed?.();
            console.warn(`ProductManager.collect(): ${what} left out: ${(e as Error).message}`);
        }
    }

    /** Shapes standing for a component: each one's own volume, not its bounding box, so an
     *  L-shaped mass is not priced as the block around it. */
    private _assignComponent(component: Component, shapes: any, options: AssignOptions): this
    {
        const parts = collectParts(this._source(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true });
        if (parts.length === 0)
        {
            throw new Error(`ProductManager.assign('${component.id}'): no solid shapes to assign`);
        }
        const named = typeof shapes?._name === 'string' && shapes._name !== 'collection' ? shapes._name : '';
        parts.forEach(part =>
        {
            const label = options.label ?? (part.group && part.group !== 'main' ? part.group : named || baseNames(part.shapes));
            part.shapes.forEach(shape =>
            {
                const own = typeof shape?.volume === 'function' ? Math.abs(Number(shape.volume())) : NaN;
                const volume = Number.isFinite(own) && own > 0 ? own : part.measure.volume;
                this._assigned.set(shape, { kind: 'component', component, volume, label, block: options.component });
                this._unmatched.delete(shape);
            });
        });
        this._costs = null;
        return this;
    }

    /** The quantities of every shape and every add(), in the order they make the lines. */
    private _entries(): Array<Entry & { isShape: boolean }>
    {
        const shapes = [...this._assigned.values()].map(a => ({
            id: a.kind === 'product' ? a.product.id : a.component.id,
            kind: a.kind as LineKind,
            vorm: a.kind === 'product' ? a.product.vorm : 'component',
            quantities: a.kind === 'product' ? partQuantities(a.product, a.measure, DEFAULT_TOLERANCE) : { st: 1, volume: a.volume / 1e9 },
            label: a.label,
            block: a.block,
            isShape: true,
        }));
        const added = this._added.map(a => ({
            id: a.id,
            kind: a.kind,
            vorm: a.kind === 'product' ? this._products.find(p => p.id === a.id)!.vorm
                : a.kind === 'component' ? 'component' : String(this._operations.find(o => o.naam === a.id)?.werkeenheid ?? ''),
            quantities: a.quantities,
            label: a.label,
            block: a.component,
            isShape: false,
        }));
        return [...shapes, ...added];
    }

    /** A component that is not in the sheet is a typo: it would silently give another recipe. */
    private _checkComponent(method: string, component?: string): void
    {
        if (component !== undefined && !this._components.some(c => c.id === component))
        {
            throw new Error(`ProductManager.${method}(): no component '${component}' in the sheet. It has: ${this._components.map(c => c.id).join(', ') || 'none'}`);
        }
    }

    /** What the costs read from the sheet, once. */
    private _loadCostData(method: string): CostData
    {
        if (this._costData) { return this._costData; }
        const wb = this._workbook;
        if (!wb)
        {
            throw new Error(`ProductManager.${method}(): needs the sheet: make.products().fromSheet(url)`);
        }
        const name = this._sheet.components;
        const blocks = wb.tables().some(t => t.name === name) ? readBlocks(wb.table(name)) : null;
        if (!blocks)
        {
            throw new Error(`ProductManager.${method}(): the sheet has no recipes: a named range tables.${name} with the columns bewerking, fase, product, per, factor`);
        }
        const outputs = this._sheetOutputs(method);
        const margins = outputs['marges'];
        if (!margins)
        {
            throw new Error(`ProductManager.${method}(): the sheet has no margins: named ranges outputs.marges.materiaal, .arbeid and .algemeen`);
        }
        const waste = new Map<string, number>((Array.isArray(outputs['verlies']) ? outputs['verlies'] : [])
            .filter((row: Array<unknown>) => row?.[0])
            .map((row: Array<unknown>) => [String(row[0]).trim().toLowerCase(), Number(row[1]) || 0] as [string, number]));
        this._costData = {
            blocks,
            waste,
            margins: { materiaal: Number(margins.materiaal) || 0, arbeid: Number(margins.arbeid) || 0, algemeen: Number(margins.algemeen) || 0 },
        };
        return this._costData;
    }

    /** The cost of one unit of an operation. */
    private _rate(operation: string): number
    {
        return Number(this._operations.find(o => o.naam === operation)?.['kosten (EUR per werkeenheid)']) || 0;
    }

    /** The recipe a product follows, nearest first: its own row in the component's block, one like
     *  it in that block, then the same product, group or vorm anywhere. Its own row counts even
     *  without operations: the sheet then says there is no work on it. */
    private _recipe(product: Product, block: string, data: CostData): { steps: Array<RecipeStep>, source: string } | null
    {
        const key = `${block}|${product.id}`;
        if (this._recipes.has(key)) { return this._recipes.get(key)!; }

        const inGroup = (id: string, group: string) => this._products.find(p => p.id === id)?.groups.includes(group) === true;
        const scope = (rows: Array<BlockProduct>, prefix: string) => [
            { source: `${prefix}${product.id}`, rows: rows.filter(r => r.id === product.id), exact: true },
            ...product.groups.map(group => ({ source: `${prefix}${group}`, rows: rows.filter(r => inGroup(r.id, group)), exact: false })),
            { source: `${prefix}${product.vorm}`, rows: rows.filter(r => r.vorm === product.vorm), exact: false },
        ];
        const everywhere = [...data.blocks.values()].flatMap(b => b.products);
        const own = data.blocks.get(block)?.products;
        const found = [...(own ? scope(own, `${block}/`) : []), ...scope(everywhere, '')]
            .filter(c => c.rows.length > 0)
            .map(c =>
            {
                const exact = c.exact && block !== '' && c.source.startsWith(`${block}/`);
                return { steps: exact ? combineRows(c.rows) : mergeRecipes(c.rows.map(r => r.steps)), source: c.source, exact };
            })
            .find(c => c.exact || c.steps.length > 0);

        const recipe = found ? { steps: found.steps, source: found.source } : null;
        this._recipes.set(key, recipe);
        return recipe;
    }

    private _kindOf(id: string): LineKind | null
    {
        if (this._products.some(p => p.id === id)) { return 'product'; }
        if (this._operations.some(o => o.naam === id)) { return 'operation'; }
        if (this._components.some(c => c.id === id)) { return 'component'; }
        return null;
    }

    private _requireProducts(method: string, idOrGroup: string): Array<Product>
    {
        if (this._products.length === 0)
        {
            throw new Error(`ProductManager.${method}(): no products yet: make.products().fromSheet(url) or fromRows(rows)`);
        }
        const found = this.find(idOrGroup);
        if (found.length === 0)
        {
            const groups = [...new Set(this._products.flatMap(p => p.groups))];
            const key = idOrGroup.toUpperCase().slice(0, 2);
            const close = [...groups, ...this._components.map(c => c.id), ...this._products.map(p => p.id)]
                .filter(k => k.toUpperCase().startsWith(key)).slice(0, 10);
            throw new Error(`ProductManager.${method}('${idOrGroup}'): no product, product group or component '${idOrGroup}'` +
                (close.length ? `. Did you mean: ${close.join(', ')}?` : `. Groups: ${groups.slice(0, 20).join(', ')}`));
        }
        return found;
    }

    /** The product of a group that fits a part best, with the part as measured for it; null
     *  when none fits. Throws when two fit equally well. Measured parts repeat a lot (1792
     *  solids of a house are 21 parts), so the answer is kept per size. */
    private _matchCache = new Map<string, { product: Product, measure: PartMeasure } | null>();

    private _match(group: string, products: Array<Product>, m: PartMeasure, tolerance: number): { product: Product, measure: PartMeasure } | null
    {
        const key = `${group}|${tolerance}|${sizeText(m)}`;
        if (this._matchCache.has(key)) { return this._matchCache.get(key)!; }

        type Ranked = { product: Product, measure: PartMeasure, rank: Array<number> };
        const rank = (turn: boolean) => products
            .map(product =>
            {
                const measure = turn ? orient(product, m, tolerance) : m;
                return { product, measure, rank: fit(product, measure, tolerance) };
            })
            .filter((r): r is Ranked => r.rank !== null)
            .sort((a, b) => compareRanks(a.rank, b.rank));
        // as measured; turned only when nothing fits that way
        const asMeasured = rank(false);
        const ranked = asMeasured.length ? asMeasured : rank(true);
        const best = ranked[0];
        const tied = ranked.filter(r => best && compareRanks(r.rank, best.rank) === 0).map(r => r.product);
        if (tied.length > 1)
        {
            const narrower = [...new Set(tied.flatMap(p => p.groups))].filter(g => g.toUpperCase() !== group.toUpperCase());
            throw new Error(`ProductManager.assign('${group}'): ${tied.length} products fit ${sizeText(m)} equally well: ` +
                `${tied.map(p => p.id).join(', ')}. Assign one of them` +
                (narrower.length ? `, or a narrower group: ${narrower.join(', ')}` : ''));
        }
        const found = best ? { product: best.product, measure: best.measure } : null;
        this._matchCache.set(key, found);
        return found;
    }

    /** Anything assign() takes, as something collectParts() reads. */
    private _source(shapes: any): any
    {
        if (typeof shapes?.forEachGroup === 'function' || typeof shapes?.children === 'function') { return shapes; }
        const list = Array.isArray(shapes) ? shapes : (shapes ? [shapes] : []);
        return { forEachGroup: (fn: (group: string, shapes: Array<any>) => void) => fn('main', list) };
    }

    /** Open a sheet by its URL with the run's cloudcalc module. A sheet the run does not have yet
     *  ends the run with cloudcalc's own error, which the editor answers by fetching it. cloudcalc is
     *  a standard module: the run loads it when the code calls fromSheet()/fromOffer() or names a
     *  sheet (STANDARD_MODULE_USES). It is missing here when the pre-scan could not see the use (a
     *  URL in a variable from elsewhere, a call built dynamically) — then `$module('cloudcalc')`
     *  declares it — or when it is not installed on this server. */
    private _openSheet(url: string, key?: string): SheetWorkbook
    {
        let cloudcalc: { open(ref: string, opts?: { key?: string }): SheetWorkbook } | null = null;
        try
        {
            const module = this._modules?.()?.modules?.resolve('cloudcalc');
            cloudcalc = (typeof module?.open === 'function') ? module : null;
        }
        catch
        {
            // not declared: said below
        }
        if (!cloudcalc)
        {
            throw new ModuleUnavailableError('cloudcalc', 'ProductManager.fromSheet(url): the sheet is opened with the cloudcalc module, '
                + 'which this run did not load; add $module(\'cloudcalc\') at the top of the script, or check that the module is installed');
        }
        return cloudcalc.open(url, key ? { key } : {});
    }

    private _openTemplate(method: string, template: SheetWorkbook | string, key?: string): SheetWorkbook
    {
        const wb = (typeof template === 'string') ? this._openSheet(template, key) : template;
        if (typeof wb?.compute !== 'function' || typeof wb?.table !== 'function' || !this._priceList(wb))
        {
            throw new Error(`ProductManager.${method}(): expected the URL of an offer template (with a price list, tables.bouwersprijzen), or its workbook of the cloudcalc module`);
        }
        return wb;
    }

    /** The name of the template's price list: tables.bouwersprijzen, in copies made before 2026-11-03 tables.prijzen. */
    private _priceList(wb: SheetWorkbook): string | null
    {
        const names = wb.tables().map(t => t.name);
        return ['bouwersprijzen', 'prijzen'].find(name => names.includes(name)) ?? null;
    }

    /** The template's price list: a row per builder and component. */
    private _offerPrices(wb: SheetWorkbook): Array<{ bouwer: string, gebouwdeel: string, groep: string, component: string, naam: string, eenheid: string, perUnit: number, perM3: number }>
    {
        return wb.table(this._priceList(wb)!)
            .filter(r => String(r['bouwer'] ?? '').trim() && String(r['component'] ?? '').trim())
            .map(r => ({
                bouwer: String(r['bouwer']).trim(),
                gebouwdeel: String(r['gebouwdeel'] ?? ''),
                groep: String(r['groep'] ?? ''),
                component: String(r['component']).trim(),
                naam: String(r['naam'] ?? ''),
                eenheid: String(r['eenheid'] ?? ''),
                perUnit: Number(r['totaal per eenheid']) || 0,
                perM3: Number(r['totaal per m3']) || 0,
            }));
    }

    /** The sheet's outputs: of the last compute(), or computed now. */
    private _sheetOutputs(method: string): Record<string, any>
    {
        if (!this._workbook)
        {
            throw new Error(`ProductManager.${method}(): needs the sheet: make.products().fromSheet(url)`);
        }
        this._outputs ??= this._workbook.compute({}) as Record<string, any>;
        return this._outputs;
    }
}
