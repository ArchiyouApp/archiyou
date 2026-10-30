/**
 *  products/ProductManager.ts
 *
 *  From the parts of a model to the products of a product sheet, and from there to costs.
 *
 *  The sheet is the core: it holds the products with their sizes and prices, the operations
 *  with their norms, the recipes that turn a product's quantities into labour, and the
 *  margins. Partners can read and check all of it. This class only does what a sheet cannot:
 *  measure the parts of a model, match them to products, add up the quantities, and send
 *  them to the sheet's `project` tab to be priced.
 *
 *      $module('cloudcalc')                         // the sheet is opened with the cloudcalc module
 *      products = make.products().fromSheet('https://docs.google.com/spreadsheets/d/…')
 *      products.assign('SLS', wall)                 // every part that fits a size of the group
 *      products.assign('houtvezel-flex-140', wall.insulation)  // or one product, by id
 *      products.add('montagewand', { st: 1 })       // what the model does not show
 *      overview = products.compute()                // costs per category and per line
 *
 *  How a part is measured follows the product's vorm, not how the part looks: a wall's
 *  insulation is long for its section (a beam to partList()), but it is filled with mats.
 *   - linear (balk, paal, profiel): the section picks the size; stuks and lengte (m1)
 *   - sheet (plaat, mat, rol, baan, laag, pan): the thickness picks the size; stuks
 *     (pieces of stock needed), oppervlak (m2) and, for sawn sheets, zaaglengte (m1)
 *   - anything else is a piece (stuk, raam, deur, ...): stuks
 *  Volume (m3) is always given. Quantities are net: the sheet adds the waste.
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
    /** Describes the line, for the table and the sheet. Default: the parts' group names. */
    label?: string;
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
}

/** What fromSheet() reads and writes, by name. The defaults are those of the URHOUSE sheet. */
export interface ProductSheetOptions
{
    /** The products table. Default 'producten'. */
    products?: string;
    /** The operations table. Default 'bewerkingen'. */
    operations?: string;
    /** The inputs and outputs of the lines: `inputs.<project>.regels` (id, description),
     *  `inputs.<project>.hoeveelheden` (st, lengte, oppervlak, volume, zaaglengte, verlies),
     *  `outputs.<project>.regels` and `outputs.<project>.<category>`. Default 'project'. */
    project?: string;
    /** For a private sheet opened by its URL: the name of the Google key in Keys to read it
     *  with, as `cloudcalc.open(url, { key })` takes it. Default: the user's default key. */
    key?: string;
}

/** A workbook of the cloudcalc module, as far as this class uses it. */
interface SheetWorkbook
{
    table(name: string): Array<Record<string, unknown>>;
    tables(): Array<{ name: string }>;
    compute(input: Record<string, unknown>): Record<string, unknown>;
    namedRanges(): Array<{ name: string, range: string }>;
}

/** One shape: matched to a product, or standing for a component by its volume (mm3). */
type Assignment =
    | { kind: 'product', product: Product, measure: PartMeasure, label: string }
    | { kind: 'component', component: Component, volume: number, label: string };

interface Addition extends ProductOptions
{
    id: string;
    kind: LineKind;
    quantities: ProductQuantities;
}

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

    // a piece: the sizes the sheet gives are the part's largest ones
    const largest = part.slice(part.length - product.dims.length);
    return product.dims.every((d, i) => near(largest[i]!, d)) ? [0] : null;
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
    private _sheet: Required<Omit<ProductSheetOptions, 'key'>> = { products: 'producten', operations: 'bewerkingen', project: 'project' };
    /** Per shape, the product it was matched to. A later assign() replaces it. */
    private _assigned = new Map<any, Assignment>();
    /** Shapes a group assign() saw but found no product for, until something else takes them. */
    private _unmatched = new Set<any>();
    private _added: Array<Addition> = [];
    private _waste = new Map<string, number>();
    private _costs: Array<ProductCosts> | null = null;
    /** The sheet's outputs of the last compute, for the components' prices. */
    private _outputs: Record<string, any> | null = null;
    /** The offer template fromOffer() read. */
    private _offer: SheetWorkbook | null = null;

    /** @param modules - the run's modules, asked for only when a table is made. */
    constructor(modules: (() => ArchiyouModules) | null = null)
    {
        this._modules = modules;
    }

    //// LOADING ////

    /**
     *  Read the products and operations from a product sheet, and price the lines in its
     *  `project` tab on compute(). The sheet is opened with the cloudcalc module, which the
     *  script declares: `$module('cloudcalc')`.
     *
     *  @param sheet - The sheet's URL (or id), or a workbook the script opened itself with
     *  `cloudcalc.open(url)`, to use it for more than the products.
     *  @param options - Other names for the tables or the project inputs than the defaults, and
     *  `key` for a private sheet.
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
        const rowOf = (id: string) => Number(String(ranges.find(r => r.name === `outputs.${id}.costm3`)?.range ?? '').match(/\d+/)?.[0] ?? Infinity);
        const components = [...new Set(costs.filter(m => m[2] === 'm3').map(m => m[1]!))]
            .sort((a, b) => rowOf(a) - rowOf(b))
            .map(id => ({ component: id, eenheid: costs.find(m => m[1] === id && m[2] !== 'm3')?.[2] ?? null }));
        this.fromRows(wb.table(this._sheet.products) as Array<ProductRow>, operations as Array<OperationRow>, components);
        this._workbook = wb;
        return this;
    }

    /**
     *  Read the components from an offer template instead of a product sheet: what its builders
     *  published (the template's PRIJZEN tab). Enough to make an offer, without access to any
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
     *  @param idOrGroup - A product id ('sls-38x140'), a product group ('SLS') or a component ('hsbwand').
     *  @param shapes - A shape, a collection (with its groups, like a wall) or an array.
     *  @example
     *  products = make.products().fromRows([
     *      { product_id: 'sls-38x140', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 140, lengte: 5400 },
     *      { product_id: 'sls-38x235', productgroep: 'SLS', vorm: 'balk', breedte: 38, hoogte: 235, lengte: 5400 },
     *  ])
     *  products.assign('SLS', make.wall(3000, 2700, 140))
     *  products.list()
     */
    assign(idOrGroup: string, shapes: any, options: AssignOptions = {}): this
    {
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
                this._assigned.set(shape, { kind: 'product', product: found.product, measure: found.measure, label });
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
        const line = (id: string, kind: LineKind, vorm: string): ProductLine =>
        {
            if (!lines.has(id))
            {
                lines.set(id, { id, kind, vorm, description: '', waste: this._waste.get(id) ?? null, shapes: 0,
                    st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0, costs: null });
            }
            return lines.get(id)!;
        };
        const describe = (l: ProductLine, label?: string) =>
        {
            if (label && !l.description.split(', ').includes(label)) { l.description = l.description ? `${l.description}, ${label}` : label; }
        };
        const addUp = (l: ProductLine, q: ProductQuantities) =>
            QUANTITY_KEYS.forEach(k => { l[k] = round(l[k] + (q[k] ?? 0)); });

        this._assigned.forEach(a =>
        {
            const l = a.kind === 'product' ? line(a.product.id, 'product', a.product.vorm) : line(a.component.id, 'component', 'component');
            addUp(l, a.kind === 'product'
                ? partQuantities(a.product, a.measure, DEFAULT_TOLERANCE)
                : { st: 1, volume: a.volume / 1e9 });
            l.shapes++;
            describe(l, a.label);
        });
        this._added.forEach(a =>
        {
            const vorm = a.kind === 'product'
                ? this._products.find(p => p.id === a.id)!.vorm
                : a.kind === 'component' ? 'component' : String(this._operations.find(o => o.naam === a.id)?.werkeenheid ?? '');
            const l = line(a.id, a.kind, vorm);
            addUp(l, a.quantities);
            describe(l, a.label);
        });

        const all = [...lines.values()];
        const ordered = KIND_ORDER.flatMap(kind => all.filter(l => l.kind === kind));
        if (this._costs) { ordered.forEach((l, i) => { l.costs = this._costs![i] ?? null; }); }
        return ordered;
    }

    /**
     *  Send the lines to the sheet's project tab and read back the costs: per category,
     *  including the sheet's margins, and per line (excluding margins). Needs fromSheet().
     *
     *  @returns `{ material, onsite, voorbewerking, assemblage, montage, afbouw, total, lines }`
     */
    compute(): ProductOverview
    {
        const wb = this._workbook;
        if (!wb)
        {
            throw new Error('ProductManager.compute(): needs the sheet: make.products().fromSheet(url)');
        }
        const { project } = this._sheet;
        const lines = this.list();
        const capacity = this._capacity(wb, `inputs.${project}.regels`);
        if (lines.length > capacity)
        {
            throw new Error(`ProductManager.compute(): ${lines.length} lines, but the sheet's ${project} tab has room for ${capacity}`);
        }

        const orNull = (v: number) => (v ? v : null);
        const regels = Array.from({ length: capacity }, (_, i) =>
            lines[i] ? [lines[i]!.id, lines[i]!.description || null] : [null, null]);
        const hoeveelheden = Array.from({ length: capacity }, (_, i) =>
            lines[i] ? [...QUANTITY_KEYS.map(k => orNull(lines[i]![k])), lines[i]!.waste] : Array(QUANTITY_KEYS.length + 1).fill(null));

        this._outputs = wb.compute({ [project]: { regels, hoeveelheden } }) as Record<string, any>;
        const out = this._outputs?.[project];
        if (!out || !Array.isArray(out.regels))
        {
            throw new Error(`ProductManager.compute(): the sheet has no outputs.${project}.regels`);
        }
        const costsOf = (values: Array<unknown>): ProductCosts =>
            Object.fromEntries(COST_KEYS.map((k, i) => [k, Number(values?.[i]) || 0])) as unknown as ProductCosts;

        this._costs = lines.map((_, i) => costsOf(out.regels[i]));
        const totals = Object.fromEntries(COST_KEYS.map(k => [k, Number(out[k]) || 0])) as unknown as ProductCosts;

        const loose = this._unmatched.size;
        if (loose)
        {
            console.warn(`ProductManager.compute(): ${loose} shape(s) have no product and are not in the costs: see products.unassigned()`);
        }
        return { ...totals, lines: this.list() };
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
        const columns = ['product', 'description', 'vorm', ...QUANTITY_KEYS, 'waste', ...(withCosts ? COST_KEYS : [])];
        const rows = lines.map(l => [
            l.id, l.description, l.vorm,
            ...QUANTITY_KEYS.map(k => Math.round(l[k] * 1000) / 1000),
            l.waste ?? '',
            ...(withCosts ? COST_KEYS.map(k => Math.round((l.costs?.[k] ?? 0) * 100) / 100) : []),
        ]);
        return calc.table(name, rows, columns) as Table;
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
     *  An offer: the template's rows filled in with the components of this model, at the prices
     *  one builder published to the template. Every component group of the template is a row; a
     *  group the model has is ticked, with the builder's component and its quantity in the
     *  component's unit (a mass assigned by its volume is converted at the builder's own price).
     *  In the client's copy the client can switch the builder, the scenario and a row's component.
     *
     *      $module('cloudcalc')
     *      products = make.products().fromOffer(OFFER_TEMPLATE)
     *      products.add('hsbwand', { oppervlak: 48 }).add('dak', { oppervlak: 40 })
     *      offer = products.offer({ bouwer: 'Bouwer A', scenario: 'DIY Bouwpakket' })
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

        const builders = wb.table('bouwers').filter(b => String(b['bouwer'] ?? '').trim());
        const bouwer = options.bouwer ?? String(builders[0]?.['bouwer'] ?? '');
        const builder = builders.find(b => b['bouwer'] === bouwer);
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
        const used = new Map<string, { naam: string, component: string, quantity: number }>();
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
            used.set(price.groep, { naam: price.naam, component: l.id, quantity: (earlier?.quantity ?? 0) + quantity });
        });
        const lost = this.list().filter(l => l.kind !== 'component').length;
        if (lost)
        {
            console.warn(`ProductManager.offer(): ${lost} product and operation line(s) are not in the offer, which has a row per component group`);
        }

        // the template's rows: a group is a row when it has inputs.<groep>.type
        const rows = [...new Set(wb.namedRanges()
            .map(r => r.name.match(/^inputs\.([^.]+)\.type$/)?.[1])
            .filter((g): g is string => g !== undefined))];
        [...used.keys()].filter(g => !rows.includes(g)).forEach(g =>
            console.warn(`ProductManager.offer(): the template has no row for group '${g}' (inputs.${g}.type)`));
        const groups = Object.fromEntries(rows.map(g =>
        {
            const u = used.get(g);
            return [g, u
                ? { aan: true, type: u.naam, hoeveelheid: Math.round(u.quantity * 100) / 100 }
                : { aan: false, type: prices.find(p => p.groep === g)?.naam ?? '', hoeveelheid: 0 }];
        }));

        wb.compute({
            ...groups,
            bouwer,
            ...(options.scenario ? { scenario: options.scenario } : {}),
            ...(options.inputs ?? {}),
        });
        return wb;
    }

    //// INTERNAL ////

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
                this._assigned.set(shape, { kind: 'component', component, volume, label });
                this._unmatched.delete(shape);
            });
        });
        this._costs = null;
        return this;
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

    /** How many lines a sheet input takes: the rows of its named range. */
    /** Open a sheet by its URL with the run's cloudcalc module. A sheet the run does not have yet
     *  ends the run with cloudcalc's own error, which the editor answers by fetching it. The module
     *  is missing here only when the script did not declare it: one that is declared but cannot be
     *  loaded stops the script at its $module() line. */
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
            throw new ModuleUnavailableError('cloudcalc', 'ProductManager.fromSheet(url): the sheet is opened with the cloudcalc module; '
                + 'declare it at the top of the script: $module(\'cloudcalc\')');
        }
        return cloudcalc.open(url, key ? { key } : {});
    }

    private _openTemplate(method: string, template: SheetWorkbook | string, key?: string): SheetWorkbook
    {
        const wb = (typeof template === 'string') ? this._openSheet(template, key) : template;
        if (typeof wb?.compute !== 'function' || typeof wb?.table !== 'function' || !wb.tables().some(t => t.name === 'prijzen'))
        {
            throw new Error(`ProductManager.${method}(): expected the URL of an offer template (with a price list, tables.prijzen), or its workbook of the cloudcalc module`);
        }
        return wb;
    }

    /** The template's price list: a row per builder and component. */
    private _offerPrices(wb: SheetWorkbook): Array<{ bouwer: string, gebouwdeel: string, groep: string, component: string, naam: string, eenheid: string, perUnit: number, perM3: number }>
    {
        return wb.table('prijzen')
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

    private _capacity(wb: SheetWorkbook, name: string): number
    {
        const range = wb.namedRanges().find(r => r.name === name)?.range;
        const rows = range?.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/i);
        if (!rows)
        {
            throw new Error(`ProductManager.compute(): the sheet has no ${name} (the lines of its ${this._sheet.project} tab)`);
        }
        return Number(rows[2]) - Number(rows[1]) + 1;
    }
}
