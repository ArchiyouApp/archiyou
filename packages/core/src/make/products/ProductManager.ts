/**
 *  products/ProductManager.ts
 *
 *  The engine of make.estimate() and make.offer(): from parts and quantities to the products
 *  of the make database, and from there to costs, hours, order lists and offers. Not used by
 *  scripts directly: they give shapes a product (shape.product()) and ask make.estimate().
 *
 *  The sheet is the core: it holds the products with their sizes and prices, the operations
 *  with their norms and times, the recipes that turn a product's quantities into labour (the
 *  componenten tab, see recipes.ts), and the margins. Partners can read and check all of it.
 *  This class only does what a sheet cannot: add up the quantities of the parts (place()) and
 *  of what the model does not show (add(), complete()), and price them by the sheet's rows.
 *
 *      pm = new ProductManager(modules).fromDb(make.db())          // the snapshot of the sheet
 *      pm.place(stud, { product: 'sls-38x235', measure, block: 'hsbwand' })
 *      pm.add('tape-universeel-60', { lengte: 12 })                // what the model does not show
 *      pm.complete('hsbwand', { oppervlak: 8.1 })                  // the rest of the component
 *      overview = pm.compute()                                     // costs and hours per category and line
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
 *  products at all: it is a component of the sheet (shape.component('hsbwand')) and its
 *  volume is priced at the component's cost per m3. That is rough on purpose: the component
 *  stands for a representative build-up, and its rows in the sheet's componenten tab say which.
 *  That tab is a table (see recipes.ts): the component's id on every row, its first row with its
 *  name, group, size and Rc, no totals; its costs are added up from its rows. In the older layout
 *  of blocks, a component is what has an output `outputs.<component>.costm3`, next to its cost
 *  per unit, `costm2` or `costst`.
 *
 *  A product without a recipe of its own follows one like it; `recipe` says which where the
 *  likeness is wrong: an ESB board on a wall's outside is worked as the wood fibre board it
 *  replaces, `{ recipe: 'houtvezel-buitenplaat-16-mg4-635x2510' }`, not as the gypsum board inside.
 *
 *  Sizes are in mm, as in the sheet, and so is the model.
 */

import type { PartMeasure } from '../../modeler/parts';
import type { ArchiyouModules } from '../../types';
import type { Table } from '../../calc/Table';
import { ModuleUnavailableError } from '../../modules/unavailableStub';
import type { MakeDb } from '../db';
import { offerPageData, renderOfferHtml, type OfferPageOptions, type OfferSource } from './offer-html';
import { combineRows, materialPrice, mergeRecipes, quantityOfUnit, readComponents, type ComponentSpec, type ComponentSpecProduct, type RecipeStep } from './recipes';
import { toProduct, partQuantities, productLabel,
    type Product, type ProductMeasure, type ProductRow, type ProductQuantities } from '../catalog/products';

export { toProduct, type Product, type ProductMeasure, type ProductRow, type ProductQuantities };

//// TYPES ////

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

/** A component, as fromRows() takes it. fromWorkbook() reads them from the componenten table's
 *  first rows, or in the older layout from the sheet's outputs: `outputs.<component>.costm3`,
 *  and `costm2` or `costst` for its unit. */
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


export interface ProductOptions
{
    /** Material waste as a fraction (0.1 is 10 %). Default: the sheet's waste for the vorm. */
    waste?: number;
    /** Describes the line, for the table. Default: the parts' group names. */
    label?: string;
    /** The component of the sheet this is part of ('hsbwand'): its block has the recipe. */
    component?: string;
    /** A product whose recipe this one follows, where it has none of its own: an ESB board on
     *  the outside of a wall is worked as the wood fibre board it replaces, not as the gypsum
     *  board that is a plaat too. */
    recipe?: string;
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
    /** Hours of work by phase (time x the labour factor, as the sheet's arbeidstijd), after
     *  compute(); `material` is always 0. */
    hours: ProductCosts | null;
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

/** One line of the offer (a component group) with what it costs the client in each scenario. */
export interface OfferScenarioLine
{
    /** The section of the offer the line is in ('CASCO'). */
    gebouwdeel: string;
    /** The component group, as the offer names the row ('Wanden'). */
    onderdeel: string;
    /** The component chosen for it ('HSB wand 160'). */
    type: string;
    hoeveelheid: number | null;
    eenheid: string;
    /** The line's total per scenario, in the order of `OfferScenarios.scenarios`; null where the offer gives none. */
    totals: Array<number | null>;
}

/** The last offer() in every scenario: see offerScenarios(). */
export interface OfferScenarios
{
    scenarios: Array<string>;
    lines: Array<OfferScenarioLine>;
    /** The offer's totals per scenario, in the order of `scenarios`. */
    totals: Array<{ subtotaal: number, opslagen: number, totaal: number, exclBtw: number, btw: number }>;
}

/** A line of block(): a product with the work its recipe gives, or work on the element. */
export interface ComponentRowLine extends Required<ProductQuantities>
{
    id: string;
    kind: LineKind;
    vorm: string;
    description: string;
    /** Waste as a fraction: the line's own, else the sheet's default for its vorm. */
    waste: number | null;
    /** The product's groups, most specific first ('SLS', ...); empty for work on the element. */
    groups: Array<string>;
    /** Costs excluding margins. */
    costs: ProductCosts;
    /** Whose recipe gave the steps: 'hsbwand/sls-38x235', 'hsbwand/SCHROEF-RVS'; null when none. */
    recipe: string | null;
    /** The products of the sheet's rows that recipe was read from: the line itself, or ones like it. */
    like: Array<string>;
    steps: Array<ComponentRowStep>;
}

/** An operation on a product in block(): factor x its quantity `per`. */
export interface ComponentRowStep
{
    operation: string;
    fase: string;
    per: keyof ProductQuantities;
    factor: number;
    quantity: number;
    /** Excluding margins. */
    cost: number;
}

/** What block() returns: the lines, and the totals including margins as compute() has them. */
export interface ComponentRows
{
    lines: Array<ComponentRowLine>;
    totals: ProductCosts;
    noRecipe: Array<string>;
    noPrice: Array<string>;
}

/** What compute() returns: the costs including margins, and the lines with theirs. */
export interface ProductOverview extends ProductCosts
{
    lines: Array<ProductLine>;
    /** Hours of work by phase, see ProductLine.hours */
    hours: ProductCosts;
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

/** What fromWorkbook() reads, by name. The defaults are those of the URHOUSE sheet. */
export interface ProductSheetOptions
{
    /** The products table. Default 'producten'. */
    products?: string;
    /** The operations table. Default 'bewerkingen'. */
    operations?: string;
    /** The recipes and representative components, see recipes.ts. Default 'componenten'. */
    components?: string;
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
    blocks: Map<string, ComponentSpec>;
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

//// SETTINGS ////

const QUANTITY_KEYS = ['st', 'lengte', 'oppervlak', 'volume', 'zaaglengte'] as const;
const COST_KEYS = ['material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw', 'total'] as const;
const CATEGORIES = COST_KEYS.slice(0, 6) as ReadonlyArray<Exclude<typeof COST_KEYS[number], 'total'>>;

const DEFAULT_TOLERANCE = 1;
/** The width of a saw cut (mm), between two parts cut from one length. */
const DEFAULT_KERF = 4;
const KIND_ORDER: Array<LineKind> = ['product', 'component', 'operation'];

//// PRODUCTS ////

const round = (v: number): number => Math.round(v * 1e6) / 1e6;

/** How many lengths of stock (mm) the parts (mm) are cut from: longest first, each into the
 *  first length it still fits in, with a saw cut of `kerf` between two parts. */
export function cutLengths(parts: Array<number>, stock: number, kerf: number = DEFAULT_KERF): number
{
    return cutPlan(parts.map(length => ({ length, label: '' })), stock, kerf).length;
}

/** The lengths of stock (mm) the parts are cut from, and which parts each: as cutLengths() */
export function cutPlan<P extends { length: number }>(parts: Array<P>, stock: number, kerf: number = DEFAULT_KERF): Array<{ parts: Array<P>, rest: number }>
{
    const bars: Array<{ parts: Array<P>, rest: number }> = [];
    [...parts].sort((a, b) => b.length - a.length).forEach(part =>
    {
        const bar = bars.find(b => b.rest >= part.length + kerf);
        if (bar) { bar.rest -= part.length + kerf; bar.parts.push(part); }
        else { bars.push({ parts: [part], rest: stock - part.length }); }
    });
    return bars;
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

/** The shapes' names without their index, as partList() writes them: 'insulation0' → 'insulation'. */
const baseNames = (shapes: Array<any>): string =>
    [...new Set(shapes
        .map(s => (typeof s?.name === 'function' ? s.name() : '') ?? '')
        .map((n: string) => n.replace(/[\s_\-.]*\d+$/, '') || n)
        .filter(Boolean))]
        .join(', ');

//// MANAGER ////

/**
 *  Products of the make database for the parts of a model, and their costs: the engine of
 *  make.estimate() and make.offer(). Nothing is read until fromDb(), fromWorkbook(),
 *  fromOffer() or fromRows().
 */
export class ProductManager
{
    private _modules: (() => ArchiyouModules) | null;
    private _products: Array<Product> = [];
    private _operations: Array<OperationRow> = [];
    private _components: Array<Component> = [];
    private _workbook: SheetWorkbook | null = null;
    private _sheet: Required<ProductSheetOptions> = { products: 'producten', operations: 'bewerkingen', components: 'componenten' };
    /** Per shape, what it is (place()). A later place() replaces it. */
    private _assigned = new Map<any, Assignment>();
    private _added: Array<Addition> = [];
    /** What complete() added, so a later complete() of the component does not take it as modelled */
    private _completed = new Set<Addition>();
    private _waste = new Map<string, number>();
    /** Per product, the product whose recipe it follows (the option `recipe`). */
    private _recipeOf = new Map<string, string>();
    private _costs: Array<ProductCosts> | null = null;
    private _hours: Array<ProductCosts> | null = null;
    /** Hours paid per hour of an operation's time: the sheet's settings.labor_factor (fromDb()) */
    private _labourFactor = 1;
    /** Per line of the last compute(), whose recipe gave its labour. */
    private _labour: Array<string | null> | null = null;
    /** The sheet's outputs, for the components' prices and the margins. */
    private _outputs: Record<string, any> | null = null;
    private _costData: CostData | null = null;
    private _recipes = new Map<string, { steps: Array<RecipeStep>, source: string, like: Array<string> } | null>();
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
     *  Read the products, operations, components and margins from a workbook: the tables and the
     *  outputs of the sheet (fromDb() makes one of a snapshot; tests give one written out).
     *
     *  @param options - Other names for the tables than the defaults.
     */
    fromWorkbook(wb: SheetWorkbook, options: ProductSheetOptions = {}): this
    {
        if (typeof wb?.table !== 'function' || typeof wb?.compute !== 'function')
        {
            throw new Error('ProductManager.fromWorkbook(): expected a workbook: table(), tables(), compute(), namedRanges()');
        }
        this._sheet = { ...this._sheet, ...options };
        const operations = wb.tables().some(t => t.name === this._sheet.operations) ? wb.table(this._sheet.operations) : [];
        // a component is what has a cost per m3; costm2 or costst says its unit
        // in the order of the sheet: the row their cost per m3 is on
        const ranges = wb.namedRanges();
        const costs = ranges
            .map(r => r.name.match(/^outputs\.([^.]+)\.cost(m2|st|m3)$/))
            .filter((m): m is RegExpMatchArray => m !== null);
        // the row of the cell after the tab: 'componenten2'!$AD$40 is 40
        const rowOf = (id: string) => Number(String(ranges.find(r => r.name === `outputs.${id}.costm3`)?.range ?? '').split('!').pop()!.match(/[A-Z]+\$?(\d+)/i)?.[1] ?? Infinity);
        let components: Array<ComponentRow> = [...new Set(costs.filter(m => m[2] === 'm3').map(m => m[1]!))]
            .sort((a, b) => rowOf(a) - rowOf(b))
            .map(id => ({ component: id, eenheid: costs.find(m => m[1] === id && m[2] !== 'm3')?.[2] ?? null }));
        // the table layout has no named ranges per component, nor has a snapshot: its components are its first rows
        const specs = wb.tables().some(t => t.name === this._sheet.components) ? readComponents(wb.table(this._sheet.components)) : null;
        if (specs && (components.length === 0 || [...specs.values()].some(b => b.layout === 'table')))
        {
            components = [...specs.values()].map(b => ({ component: b.id, eenheid: b.unit || null, gebouwdeel: b.info.gebouwdeel }));
        }
        this.fromRows(wb.table(this._sheet.products) as Array<ProductRow>, operations as Array<OperationRow>, components);
        this._workbook = wb;
        return this;
    }

    /**
     *  Read the components from an offer template instead of a product sheet: what its builders
     *  published (the template's BOUWERSPRIJZEN tab). Enough to make an offer, without access to any
     *  builder's own sheet: make.offer(OFFER_TEMPLATE) (see make/offer/Offer.ts).
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

    /**
     *  Products (and operations and components) given as rows with the columns of the sheet:
     *  product_id, productgroep, vorm, dikte, breedte, hoogte, lengte; naam, werkeenheid;
     *  component, eenheid. Without the componenten tab and margins compute() is not available,
     *  but add() and list() are.
     */
    fromRows(products: Array<ProductRow>, operations: Array<OperationRow> = [], components: Array<ComponentRow> = []): this
    {
        // what place() and add() took holds products of the set loaded before
        if (this._assigned.size || this._added.length)
        {
            throw new Error('ProductManager: products are loaded once, before place() and add()');
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
        this._costs = null;
        return this;
    }

    /**
     *  Read everything from a snapshot of the sheet (make.db()) instead of the sheet itself: the
     *  same tables and outputs, computed when the snapshot was made. For make.estimate().
     */
    fromDb(db: MakeDb): this
    {
        // the snapshot as a workbook: its tables, and its outputs as the sheet computes them
        const outputs: Record<string, any> = {};
        Object.entries(db.snapshot.settings).filter(([name]) => name.startsWith('outputs.')).forEach(([name, value]) =>
        {
            const path = name.split('.').slice(1);
            const last = path.pop()!;
            const node = path.reduce((o, key) => (o[key] ??= {}), outputs);
            node[last] = value;
        });
        const names = Object.keys(db.snapshot.tables);
        const wb: SheetWorkbook = {
            table: (name: string) => db.table(name as any) as Array<Record<string, unknown>>,
            tables: () => names.map(name => ({ name })),
            compute: () => outputs,
            namedRanges: () => [],
        };
        this.fromWorkbook(wb);
        this._labourFactor = Number(db.setting('settings.labor_factor')) || 1;
        return this;
    }

    /**
     *  Take a shape as a part of what it already is, as shape.product() or shape.component()
     *  resolved it: no matching again. For make.estimate().
     *
     *  @param what - `{ product, measure }` or `{ component, volume }` (mm, mm3), with `label` and
     *    `block`: the component of the sheet whose rows give a product's recipe.
     */
    place(shape: any, what: { product?: string, measure?: PartMeasure, component?: string, volume?: number, label?: string, block?: string, recipe?: string, waste?: number }): this
    {
        const label = what.label ?? baseNames([shape]);
        this._checkComponent('place', what.block);
        if (what.component)
        {
            const component = this._components.find(c => c.id === what.component);
            if (!component) { throw new Error(`'${what.component}' is no component of the sheet`); }
            this._assigned.set(shape, { kind: 'component', component, volume: what.volume ?? 0, label, block: what.block });
        }
        else
        {
            const product = this._products.find(p => p.id === what.product);
            if (!product) { throw new Error(`'${what.product}' is no product of the sheet`); }
            if (!what.measure) { throw new Error(`${product.id}: the shape has no size`); }
            if (what.recipe) { this._recipeOf.set(product.id, what.recipe); }
            if (what.waste !== undefined) { this._waste.set(product.id, what.waste); }
            this._assigned.set(shape, { kind: 'product', product, measure: what.measure, label, block: what.block });
        }
        this._costs = null;
        return this;
    }

    /** The sheet's components as it reckons with them (see recipes.ts), by id. Needs fromDb() or fromWorkbook(). */
    componentSpecs(): Map<string, ComponentSpec>
    {
        return this._loadCostData('componentSpecs').blocks;
    }

    //// ASSIGNING ////

    /**
     *  Add what the model does not show: a product (screws, tape), an operation of the sheet
     *  (montagewand, aftapen) or a component (wall, per m3, m2 or piece), with its quantities.
     *  Adding the same id again adds up.
     *
     *  @param id - A product id, the name of an operation, or a component.
     *  @param quantities - In the sheet's units: st, lengte (m1), oppervlak (m2), volume (m3), zaaglengte (m1).
     *
     *      pm.add('schroef-rvs-6x100', { st: 32 }).add('montagewand', { st: 1 })
     *
     *  In a script: make.add() (see Make), which goes with the shapes to make.estimate().
     */
    add(id: string, quantities: ProductQuantities, options: ProductOptions = {}): this
    {
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
        if (options.recipe && kind === 'product') { this._recipeOf.set(id, options.recipe); }
        this._costs = null;
        return this;
    }

    /**
     *  The work on an element as a whole, which is on no product: its mounting, squaring and
     *  handling, as the `element` rows of the component's block say. Scaled by size from the
     *  representative component, so this agrees with the component's price per m2 or per piece.
     *  Adds them as operation lines. Needs the sheet: fromDb().
     *
     *  @param component - A component of the sheet: 'hsbwand'.
     *  @param quantities - How much of it the model has, in its unit: `{ oppervlak: 21.6 }` or `{ st: 2 }`.
     */
    elementWork(component: string, quantities: ProductQuantities, options: Pick<ProductOptions, 'label'> & { elements?: number } = {}): this
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
        // per element: once for each (a component sized in m2 is one element here, or as many as
        // `elements` says: the estimate of a wall used twice); per m2 of it; or, in the block
        // layout, as much as the block has, scaled by size
        const elements = block.unit === 'st' ? amount : (options.elements ?? 1);
        block.element.forEach(work => this.add(work.operation, {
            [work.quantity]: work.per === 'element' ? work.factor! * elements
                : work.per === 'oppervlak' ? work.factor! * (quantities.oppervlak ?? amount)
                : work.amount * amount / block.size,
        }, { label: options.label ?? component, component }));
        return this;
    }

    /**
     *  Complete a component with what the model does not show: the products of its block in the
     *  sheet that nothing assigned or added with this component stands for, scaled by size, and
     *  the work on the element as a whole (elementWork()). A product of the block is shown when
     *  the model has it, or a product of the same line (its first productgroep): rafters of
     *  sls-38x170 stand for the block's sls-38x285. Call it after the place()s of the component.
     *
     *  @param component - A component of the sheet: 'hsbwand'.
     *  @param quantities - How much of it the model has, in its unit: `{ oppervlak: 21.6 }` or `{ st: 2 }`.
     *  @param options.except - Products of the block to leave out (the model has another build-up).
     *
     *      pm.complete('hsbwand', { oppervlak: 8.1 })  // sheathing, gypsum, screws, tape and the element work
     *
     *  In a script: make.complete() (see Make), which goes with the shapes to make.estimate().
     */
    complete(component: string, quantities: ProductQuantities, options: Pick<ProductOptions, 'label'> & { except?: Array<string>, elements?: number } = {}): this
    {
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
            // what an earlier complete() added is the block's, not the model's: a second wall completes too
            ...this._added.filter(a => a.kind === 'product' && a.component === component && !this._completed.has(a)).map(a => a.id),
        ];
        const shownLines = new Set(shown.map(line));
        const scale = amount / block.size;
        block.products
            .filter(p => !shownLines.has(line(p.id)) && !(options.except ?? []).includes(p.id))
            .map(p => ({ id: p.id, scaled: Object.fromEntries(Object.entries(p.quantities)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => [k, v * scale])) }))
            .filter(p => Object.keys(p.scaled).length > 0)
            .forEach(p =>
            {
                this.add(p.id, p.scaled, { label: options.label ?? component, component });
                this._completed.add(this._added[this._added.length - 1]!);
            });
        return this.elementWork(component, quantities, options);
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
                    st: 0, lengte: 0, oppervlak: 0, volume: 0, zaaglengte: 0, costs: null, hours: null, labour: null });
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
                l.hours = this._hours?.[i] ?? null;
                l.labour = this._labour?.[i] ?? null;
            });
        }
        return ordered;
    }

    /**
     *  The costs, from the rows of the sheet: per category including the sheet's margins, and per
     *  line excluding them. Material is the product's price with its waste, labour its recipe in
     *  the sheet at the operations' costs per unit. A component line is priced as a whole: do not
     *  also list its products. Needs fromDb().
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
            const hours: ProductCosts = { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0, total: 0 };
            const sources = new Set<string>();
            // amount: units of work of the operation
            const work = (operation: string, fase: string, amount: number) =>
            {
                if (!(CATEGORIES as ReadonlyArray<string>).includes(fase)) { return; }
                costs[fase as typeof CATEGORIES[number]] += amount * this._rate(operation);
                hours[fase as typeof CATEGORIES[number]] += amount * this._hoursPer(operation);
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
                    recipe.steps.forEach(step => work(step.operation, step.fase, step.factor * q[step.per]));
                });
            }
            else if (line.kind === 'operation')
            {
                const operation = this._operations.find(o => o.naam === line.id)!;
                const key = quantityOfUnit(operation.werkeenheid);
                const amount = key ? line[key] + (key === 'lengte' ? line.zaaglengte : 0) : 0;
                if (!this._rate(line.id)) { noPrice.add(line.id); }
                work(line.id, String(operation.fase ?? '').trim(), amount);
            }
            else
            {
                const block = data.blocks.get(line.id);
                const key = block ? quantityOfUnit(block.unit) : null;
                // priced per m3 when it has a volume, else per its own unit
                const scale = !block ? 0 : line.volume ? line.volume / block.volume : (key ? line[key] : 0) / block.size;
                if (!block || !Number.isFinite(scale)) { noPrice.add(line.id); }
                else { CATEGORIES.forEach(k => { costs[k] = block.costs[k] * scale; hours[k] = (block.hours?.[k] ?? 0) * scale; }); }
            }
            costs.total = CATEGORIES.reduce((sum, k) => sum + costs[k], 0);
            hours.total = CATEGORIES.reduce((sum, k) => sum + hours[k], 0);
            return { costs, hours, source: [...sources].join(', ') || null };
        });

        this._costs = priced.map(p => p.costs);
        this._hours = priced.map(p => p.hours);
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

        const hours: ProductCosts = { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0, total: 0 };
        COST_KEYS.forEach(k => { hours[k] = priced.reduce((sum, p) => sum + p.hours[k], 0); });
        return { ...totals, hours, lines: this.list(), noRecipe: [...noRecipe], noPrice: [...noPrice] };
    }

    /**
     *  The model as rows of the sheet's componenten tab: what a component is made of at the
     *  size it was run at. Per product its quantities and, under it, the work its recipe gives
     *  (factor x the quantity it is per); then the work on the element as a whole. This is how a
     *  component's rows are made from its script, run at its reference size: the quantities come
     *  from the model, its recipes (per, factor) stay the sheet's. Needs fromDb().
     *
     *      make.estimate().componentRows().lines   // [{ product: 'sls-38x235', st: 9, lengte: 24.5, steps: [{ operation: 'afkorten', per: 'st', factor: 2, quantity: 18 }, ...] }, ...]
     */
    componentRows(): ComponentRows
    {
        const overview = this.compute();
        const data = this._loadCostData('componentRows');
        const blockOf = new Map<string, string>();
        this._entries().forEach(e => { if (e.block && !blockOf.has(e.id)) { blockOf.set(e.id, e.block); } });

        const lines: Array<ComponentRowLine> = overview.lines.map(line =>
        {
            const quantities = Object.fromEntries(QUANTITY_KEYS.map(k => [k, line[k]])) as Required<ProductQuantities>;
            const base = { id: line.id, kind: line.kind, vorm: line.vorm, description: line.description, waste: line.waste, groups: [] as Array<string>, like: [] as Array<string>, ...quantities, costs: line.costs!, steps: [] as Array<ComponentRowStep>, recipe: null as string | null };
            if (line.kind !== 'product') { return base; }
            const product = this._products.find(p => p.id === line.id)!;
            const recipe = this._recipe(product, blockOf.get(line.id) ?? '', data);
            base.recipe = recipe?.source ?? null;
            base.like = recipe?.like ?? [];
            base.waste = line.waste ?? data.waste.get(product.vorm) ?? null;
            base.groups = product.groups;
            base.steps = (recipe?.steps ?? []).map(step => ({
                operation: step.operation, fase: step.fase, per: step.per, factor: step.factor,
                quantity: round(step.factor * quantities[step.per]),
                cost: step.factor * quantities[step.per] * this._rate(step.operation),
            }));
            return base;
        });
        const { lines: _lines, hours: _hours, noRecipe, noPrice, ...totals } = overview;
        return { lines, totals, noRecipe, noPrice };
    }

    /**
     *  The order list: the products to buy for the whole project, a line each, in the stock they
     *  are sold in: what a supplier is asked for. Beams in lengths of stock, the parts cut from
     *  them longest first (with a saw cut between two parts); sheets in pieces of stock by their
     *  area, with the waste of the sheet; what is sold per m1 or m2 in those, with the waste. A
     *  component the model has as a whole (add('verdiepingsvloer', ...), or a mass) brings the
     *  products of its block in the sheet, scaled by size. Priced by the sheet's product rows,
     *  excluding its margins and BTW: the purchase, not the client's price. Beams first, then
     *  sheets, then the rest. Needs fromDb().
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
        const outputs = this._componentOutputs('orderTable');
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
        const out = this._componentOutputs('prices');
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
     *  mass given by its volume is converted at the builder's own price), the others 0. Which rows
     *  are on and their type stay the template's choice: in the client's copy the client can switch
     *  them, the builder and the scenario. In a script: make.offer() (make/offer/Offer.ts).
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
            ? this._offer ?? (() => { throw new Error('ProductManager.offer(): needs the offer template: make.offer(OFFER_TEMPLATE)'); })()
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

    /**
     *  The last offer() in every scenario of the template: per offer line (a component group:
     *  Wanden, Dak, Keuken...) what it costs the client when the builder does it all and when the
     *  client does part of it themselves, and the totals of each scenario. The offer itself is left
     *  as offer() made it.
     *
     *      products.offer({ bouwer: 'URBUILD' })
     *      products.offerScenarios().lines    // [{ onderdeel: 'Wanden', type: 'HSB wand', totals: [1658, 1200, 990] }, ...]
     *
     *  @param options.scenarios - The scenarios to compute. Default: those of the template (its table
     *                             scenarios) that the builder offers; without such a table, the offer's own.
     */
    offerScenarios(options: { scenarios?: Array<string> } = {}): OfferScenarios
    {
        const source = this._offerSource('offerScenarios');
        const { wb, input } = this._offered!;
        const text = (v: unknown) => String(v ?? '').trim();
        const builder = (source.bouwers ?? []).find(b => text(b['bouwer']) === text(input['bouwer']));
        const ofTemplate = (source.scenarios ?? []).length > 0
            ? Object.keys(source.scenarios![0]!).filter(c => c.trim().toLowerCase() !== 'kosten')
            : [];
        const scenarios = options.scenarios
            ?? (ofTemplate.length > 0 ? ofTemplate.filter(s => builder?.[s] !== false) : [text(input['scenario'])].filter(Boolean));
        if (scenarios.length === 0)
        {
            throw new Error('ProductManager.offerScenarios(): the template names no scenarios; give them: offerScenarios({ scenarios: [...] })');
        }

        // every scenario: the offer's inputs with that scenario
        const perScenario = scenarios.map(scenario =>
        {
            const inputs = { ...input, scenario };
            const outputs = wb.compute(inputs) as Record<string, any>;
            const data = offerPageData({ bouwkosten: wb.table('bouwkosten', inputs), outputs, input: inputs });
            const lines = data.sections.flatMap(s => s.lines.map(l => ({ ...l, gebouwdeel: s.titel })));
            return { lines, totals: data.totals };
        });
        wb.compute(input); // the offer as offer() made it, for what the script reads from it next

        // the lines by the template's row, in order of first appearance: a scenario does not add rows, but be safe
        const keyOf = (l: { gebouwdeel: string, onderdeel: string, type: string }) => [l.gebouwdeel, l.onderdeel, l.type].join('|');
        const keys = [...new Set(perScenario.flatMap(s => s.lines.map(keyOf)))];
        const lines = keys.map(key =>
        {
            const found = perScenario.map(s => s.lines.find(l => keyOf(l) === key));
            const first = found.find(l => l !== undefined)!;
            return {
                gebouwdeel: first.gebouwdeel,
                onderdeel: first.onderdeel,
                type: first.type,
                hoeveelheid: first.hoeveelheid,
                eenheid: first.eenheid,
                totals: found.map(l => l?.totaal ?? null),
            };
        });
        return {
            scenarios,
            lines,
            totals: perScenario.map(({ totals: t }) => ({ subtotaal: t.subtotaal, opslagen: t.opslagen, totaal: t.totaal, exclBtw: t.exclBtw, btw: t.btw })),
        };
    }

    /**
     *  offerScenarios() as a table of the script: a row per offer line with its total (incl. BTW,
     *  rounded to euros) in each scenario, and the offer's subtotal, surcharges, BTW and total per
     *  scenario under it. Lines with nothing in them (no quantity, no cost) are left out.
     *
     *      products.offer({ bouwer: 'URBUILD' })
     *      products.scenarioTable('costs')     // columns gebouwdeel, onderdeel, type, hoeveelheid, eenheid, <scenario>...
     *
     *  @param name - Name of the table. Default 'scenarios'.
     *  @param options.scenarios - As offerScenarios().
     */
    scenarioTable(name = 'scenarios', options: { scenarios?: Array<string> } = {}): Table
    {
        const calc = this._modules?.()?.calc;
        if (!calc)
        {
            throw new Error('ProductManager.scenarioTable(): tables are only available inside a run');
        }
        const data = this.offerScenarios(options);
        const euros = (v: number | null) => (v === null ? '' : Math.round(v));
        const rows = data.lines
            .filter(l => (l.hoeveelheid ?? 0) > 0 || l.totals.some(t => (t ?? 0) !== 0))
            .map(l => [l.gebouwdeel, l.onderdeel, l.type, l.hoeveelheid ?? '', l.eenheid, ...l.totals.map(euros)]);
        const columns = ['gebouwdeel', 'onderdeel', 'type', 'hoeveelheid', 'eenheid', ...data.scenarios];
        const table = calc.table(name, rows, columns) as Table;

        const totalRows: Array<[string, (t: OfferScenarios['totals'][number]) => number]> = [
            ['Subtotaal', t => t.subtotaal],
            ['Opslagen', t => t.opslagen],
            ['BTW', t => t.btw],
            ['Totaal incl. BTW', t => t.totaal],
        ];
        return totalRows.reduce((tbl, [label, pick], i) => tbl.footer(
            { onderdeel: label, ...Object.fromEntries(data.scenarios.map((s, j) => [s, () => Math.round(pick(data.totals[j]!))])) },
            { line: i === 0, bold: i === totalRows.length - 1 }), table);
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
            throw new Error(`ProductManager.${method}(): needs the sheet: fromDb(make.db())`);
        }
        const name = this._sheet.components;
        const blocks = wb.tables().some(t => t.name === name) ? readComponents(wb.table(name)) : null;
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

    /** The hours paid for one unit of an operation: its time (`tijd (seconden)`) x the labour factor */
    private _hoursPer(operation: string): number
    {
        return (Number(this._operations.find(o => o.naam === operation)?.['tijd (seconden)']) || 0) / 3600 * this._labourFactor;
    }

    /** The recipe a product follows, nearest first: its own row in the component's block, one like
     *  it in that block, then the same product, group or vorm anywhere. Its own row counts even
     *  without operations: the sheet then says there is no work on it. */
    private _recipe(product: Product, block: string, data: CostData): { steps: Array<RecipeStep>, source: string, like: Array<string> } | null
    {
        const key = `${block}|${product.id}`;
        if (this._recipes.has(key)) { return this._recipes.get(key)!; }

        // told to follow another product's recipe, where it has no row of its own in the block
        const like = this._products.find(p => p.id === this._recipeOf.get(product.id) && p.id !== product.id);
        const ownRow = data.blocks.get(block)?.products.some(r => r.id === product.id);
        if (like && !ownRow)
        {
            const followed = this._recipe(like, block, data);
            this._recipes.set(key, followed);
            return followed;
        }

        const inGroup = (id: string, group: string) => this._products.find(p => p.id === id)?.groups.includes(group) === true;
        const scope = (rows: Array<ComponentSpecProduct>, prefix: string) => [
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
                return { steps: exact ? combineRows(c.rows) : mergeRecipes(c.rows.map(r => r.steps)), source: c.source, exact, like: c.rows.map(r => r.id) };
            })
            .find(c => c.exact || c.steps.length > 0);

        const recipe = found ? { steps: found.steps, source: found.source, like: [...new Set(found.like)] } : null;
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

    /** Open a sheet by its URL with the run's cloudcalc module. A sheet the run does not have yet
     *  ends the run with cloudcalc's own error, which the editor answers by fetching it. cloudcalc is
     *  a standard module: the run loads it when the code calls make.offer() or names a
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
            throw new ModuleUnavailableError('cloudcalc', 'make.offer(url): the offer template is opened with the cloudcalc module, '
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
    /**
     *  The sheet's outputs, with per component what its outputs.<id>.* say: in the table layout,
     *  which has none, made from its rows: its first row's names, its costs per unit (incl. the
     *  margins), its CO2 per unit, its Rc and its products.
     */
    private _componentOutputs(method: string): Record<string, any>
    {
        const outputs = { ...this._sheetOutputs(method) };
        // a sheet without the componenten table has its components in its outputs only
        const name = this._sheet.components;
        if (!this._workbook!.tables().some(t => t.name === name)) { return outputs; }
        const data = this._loadCostData(method);
        const { materiaal, arbeid, algemeen } = data.margins;
        data.blocks.forEach(b =>
        {
            if (b.layout !== 'table' || outputs[b.id]?.naam) { return; }
            const per = b.size > 0 ? 1 / b.size : 0;
            const onMaterial = (1 + materiaal / 100) * (1 + algemeen / 100);
            const onLabour = (1 + arbeid / 100) * (1 + algemeen / 100);
            outputs[b.id] = {
                gebouwdeel: b.info.gebouwdeel, groep: b.info.groep, naam: b.info.naam,
                costs: CATEGORIES.map(k => b.costs[k] * per * (k === 'material' ? onMaterial : onLabour)),
                gwp: b.gwp.map(v => v * per),
                rc: b.info.rc,
                producten: [...new Set(b.products.filter(p => !['bevestigingsmiddelen', 'luchtdichting'].includes(p.bouwdeel ?? '')).map(p => p.id))].join(', '),
            };
        });
        return outputs;
    }

    private _sheetOutputs(method: string): Record<string, any>
    {
        if (!this._workbook)
        {
            throw new Error(`ProductManager.${method}(): needs the sheet: fromDb(make.db())`);
        }
        this._outputs ??= this._workbook.compute({}) as Record<string, any>;
        return this._outputs;
    }
}
