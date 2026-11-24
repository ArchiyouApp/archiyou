/**
 *  make/estimate/Estimate.ts — from the shapes of a model to what it weighs, costs and takes to make.
 *
 *  The shapes say what they are (shape.product(), shape.component()); the make database says the
 *  rest: prices, recipes, times, margins, waste. make.estimate() adds it up:
 *
 *      stud = box(38, 235, 2700).product('SLS', { component: 'hsbwand' })
 *      est = make.estimate()             // every shape of the scene, or make.estimate(wall)
 *      est.weight()                      // kg
 *      est.cost()                        // { material, onsite, voorbewerking, ..., total }: incl. the sheet's margins
 *      est.time()                        // hours by phase: time x the labour factor, as the sheet's arbeidstijd
 *      est.by('component')               // the same per component, product, label, material, vorm, group or phase
 *      est.order()                       // what to buy, in the stock it is sold in
 *      est.cuts()                        // per length of stock, the parts sawn from it
 *      est.check()                       // what it could not reckon with, and why
 *
 *  The reckoning is ProductManager's, read from the snapshot (fromDb()): one engine for the
 *  sheet's own components and for a model. Line costs exclude the margins (as the sheet's
 *  component rows); cost() and by() include them (as the sheet's component prices).
 */

import { collectParts, partSource, type PartMeasure } from '../../modeler/parts';
import type { MakeDb } from '../db';
import { ProductManager, cutPlan, type ProductCosts, type ProductLine, type OrderLine, type ProductQuantities, type Product } from '../products/ProductManager';
import { toProduct } from '../catalog/products';
import { Catalog } from '../catalog/Catalog';
import type { Table } from '../../calc/Table';
import type { MakeExtras } from '../Make';

export type EstimateKey = 'component' | 'product' | 'label' | 'material' | 'vorm' | 'group' | 'phase';

export interface EstimateOptions
{
    /** A version of the make database; default the latest the run was given */
    db?: string;
    /** The width of a saw cut (mm), for the order and cut lists. Default 4. */
    kerf?: number;
    /** Include hidden shapes. Default false: a hidden shape is not part of what is built. */
    hidden?: boolean;
}

export interface EstimateLine extends ProductLine
{
    /** kg, net: the parts as modelled, without waste */
    weight: number;
}

export interface EstimateGroup
{
    key: string;
    /** kg */
    weight: number;
    /** incl. the sheet's margins */
    cost: ProductCosts;
    hours: ProductCosts;
    lines: Array<EstimateLine>;
}

export interface EstimateIssue
{
    level: 'warning' | 'error';
    where: string;
    name: string;
    message: string;
}

/** A length of stock and the parts sawn from it (mm) */
export interface CutBar
{
    component: string;
    product: string;
    description: string;
    stock: number;
    parts: Array<{ length: number, label: string }>;
    /** What is left of it (mm), the saw cuts taken off */
    rest: number;
}

/** One shape, as the estimate takes it */
interface Placed
{
    shape: any;
    product?: Product;
    measure?: PartMeasure;
    component?: string;
    volume?: number;
    block: string;
    label: string;
    recipe?: string;
    waste?: number;
}

interface Added
{
    kind: 'add' | 'complete';
    id: string;
    quantities: ProductQuantities;
    options: { label?: string, component?: string, waste?: number, recipe?: string, except?: Array<string>, elements?: number };
}

const CATEGORIES = ['material', 'onsite', 'voorbewerking', 'assemblage', 'montage', 'afbouw'] as const;
const zero = (): ProductCosts => ({ material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0, total: 0 });
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const text = (v: unknown): string => String(v ?? '').trim();

export class Estimate
{
    readonly db: MakeDb;
    private _placed: Array<Placed> = [];
    private _added: Array<Added> = [];
    private _loose: Array<any> = [];
    private _issues: Array<EstimateIssue> = [];
    private _shapes: any;
    private _cache = new Map<string, ProductManager>();

    /**
     *  @param db - the make database to reckon with
     *  @param shapes - the shapes, collections or groups to estimate
     *  @param modules - the run's modules (for tables), or null
     *  @param report - where problems go: make's list (check(), strict())
     */
    constructor(db: MakeDb, shapes: any, private readonly options: EstimateOptions = {}, private readonly modules: (() => any) | null = null,
        private readonly report: (issue: EstimateIssue) => void = () => {}, own: MakeExtras | null = null)
    {
        this.db = db;
        this._shapes = shapes;
        const parts = collectParts(partSource(shapes), { labels: false, order: 'scene', includeHidden: options.hidden === true });
        const seen = new Set<any>();
        // what make.add() and make.complete() added, per script: each of its shapes brings a share
        const shares = new Map<MakeExtras, number>();
        parts.forEach(part => part.shapes.forEach(shape =>
        {
            if (seen.has(shape)) { return; }
            seen.add(shape);
            const extras = shape?._product?.extras as MakeExtras | undefined;
            if (extras?.shapes) { shares.set(extras, (shares.get(extras) ?? 0) + 1 / extras.shapes); }
            if (shape?._fastening) { return; }    // screws of make.fasten(): counted by their heads, below
            const made = shape?._product;
            if (made?.kind !== 'make') { this._loose.push(shape); return; }
            if (made.partOf) { return; }    // reckoned as part of something else (shape.partOf())
            if (made.db && made.db !== db.version)
            {
                this._issue('warning', `${this._name(shape)}`, `its product was found in make database ${made.db}; the estimate reckons with ${db.version}`);
            }
            const label = made.label ?? (part.group && part.group !== 'main' ? part.group : this._name(shape));
            if (made.component)
            {
                const own = typeof shape?.volume === 'function' ? Math.abs(Number(shape.volume())) : NaN;
                this._placed.push({ shape, component: made.component, volume: Number.isFinite(own) && own > 0 ? own : part.measure.volume, block: made.component, label });
                return;
            }
            if (made.pending)
            {
                // named in a run without the make database: found now, as shape.product() would have
                const { name, resolution: r } = this._catalog().resolveFirst(made.pending, made.measure ?? part.measure, made.tolerance, made.fit !== false);
                r.issues.forEach(i => this._issue(i.level, `${this._name(shape)}.product(${made.said ?? `'${name}'`})`, i.message));
                if (r.product) { this._placed.push({ shape, product: r.product, measure: r.measure ?? part.measure, block: made.block ?? '', label, recipe: made.recipe, waste: made.waste }); }
                return;
            }
            const product = this._products().get(made.product);
            if (!product) { this._issue('error', this._name(shape), `'${made.product}' is not in make database ${db.version}`); return; }
            this._placed.push({ shape, product, measure: made.measure ?? part.measure, block: made.block ?? '', label, recipe: made.recipe, waste: made.waste });
        }));
        // the problems of the components the shapes come from: their own make.check()
        shares.forEach((_, extras) =>
        {
            if (extras === own) { return; }
            (extras.issues ?? []).forEach(i => this._issue(i.level, `in a component: ${i.where}`, i.message));
        });
        // the run's own, when none of its shapes carries it (it gave no shape a product)
        if (own && (own.adds.length || own.completes.length) && !shares.has(own) && own.shapes === 0) { shares.set(own, 1); }
        const scaled = (q: Record<string, number>, share: number) => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, Number(v) * share]));
        // a complete() per use of a component: a wall used twice is two elements to square and mount
        shares.forEach((share, extras) =>
        {
            extras.adds.forEach(a => this._added.push({ kind: 'add', id: a.id, quantities: scaled(a.quantities, share), options: a.options }));
            extras.completes.forEach(c => this._added.push({ kind: 'complete', id: c.component, quantities: scaled(c.quantities, share),
                options: { ...c.options, elements: share } }));
        });

        if (this._loose.length)
        {
            const names = [...new Set(this._loose.map(s => this._name(s)))];
            this._issue('warning', 'make.estimate()', `${this._loose.length} shape(s) have no product and are not reckoned with: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', ...' : ''}`);
        }
    }

    //// WHAT THE MODEL DOES NOT SHOW ////

    /** Add what the model does not show: `est.add('tape-universeel-60', { lengte: 12 }, { component: 'hsbwand' })` */
    add(id: string, quantities: ProductQuantities, options: Added['options'] = {}): this
    {
        this._added.push({ kind: 'add', id, quantities, options });
        this._cache.clear();
        return this;
    }

    /** Add what a component of the sheet has that the model does not: its rows scaled to `quantities`,
     *  except the products the model has. `est.complete('hsbwand', { oppervlak: 8.1 })` */
    complete(component: string, quantities: ProductQuantities, options: { label?: string, except?: Array<string> } = {}): this
    {
        this._added.push({ kind: 'complete', id: component, quantities, options });
        this._cache.clear();
        return this;
    }

    //// RESULTS ////

    /** The lines: a product, component or operation each, with quantities, weight, costs (excl. margins) and hours */
    lines(): Array<EstimateLine>
    {
        return this._lines(this._engine(null));
    }

    /** kg, net: the parts as modelled, without waste */
    weight(): number
    {
        return this.lines().reduce((sum, l) => sum + l.weight, 0);
    }

    /** The costs by category, including the sheet's margins, excluding BTW and the project surcharges */
    cost(): ProductCosts
    {
        const { lines: _l, hours: _h, noRecipe: _r, noPrice: _p, ...costs } = this._engine(null).compute();
        return costs;
    }

    /** Hours of work by phase: each operation's time x the sheet's labour factor */
    time(): ProductCosts
    {
        return this._engine(null).compute().hours;
    }

    /**
     *  The same, per group: component (of the sheet), product, label (the shapes' groups or the
     *  label given), material, vorm, group (the product's first group) or phase (one group per
     *  cost category). In the order the model first has them.
     */
    by(key: EstimateKey): Array<EstimateGroup>
    {
        if (key === 'phase')
        {
            const overview = this._engine(null).compute();
            const lines = this._lines(this._engine(null));
            return CATEGORIES.map(k => ({
                key: k,
                weight: k === 'material' ? lines.reduce((sum, l) => sum + l.weight, 0) : 0,
                cost: { ...zero(), [k]: overview[k], total: overview[k] },
                hours: { ...zero(), [k]: overview.hours[k], total: overview.hours[k] },
                lines: lines.filter(l => (l.costs?.[k] ?? 0) !== 0 || (l.hours?.[k] ?? 0) !== 0),
            })).filter(g => g.cost.total !== 0 || g.hours.total !== 0);
        }
        const keys = [...new Set([...this._placed.map(p => this._keyOf(p, key)), ...this._added.map(a => this._keyOfAdded(a, key))])];
        return keys.map(k =>
        {
            const pm = this._engine({ key, value: k });
            const { lines: _l, hours, noRecipe: _r, noPrice: _p, ...cost } = pm.compute();
            const lines = this._lines(pm);
            return { key: k, weight: lines.reduce((sum, l) => sum + l.weight, 0), cost, hours, lines };
        });
    }

    /** The order list: what to buy, in the stock it is sold in, priced excl. margins and BTW (see ProductManager.orderList()) */
    order(options: { byComponent?: boolean } = {}): Array<OrderLine>
    {
        return this._engine(null).orderList({ ...options, kerf: this.options.kerf });
    }

    /** Per length of stock of a beam, the parts sawn from it: longest first, a saw cut between two */
    cuts(options: { byComponent?: boolean } = {}): Array<CutBar>
    {
        const kerf = this.options.kerf ?? 4;
        const groups = new Map<string, { component: string, product: Product, parts: Array<{ length: number, label: string }> }>();
        this._placed.forEach(p =>
        {
            if (!p.product || p.product.measure !== 'linear' || !p.measure) { return; }
            const component = options.byComponent ? p.block : '';
            const key = `${component}|${p.product.id}`;
            if (!groups.has(key)) { groups.set(key, { component, product: p.product, parts: [] }); }
            groups.get(key)!.parts.push({ length: p.measure.length, label: p.label });
        });
        return [...groups.values()].flatMap(g =>
        {
            const [stock] = g.product.stock as [number];
            if (stock === Infinity) { return []; }
            const description = text(g.product.row['term']) || g.product.id;
            return cutPlan(g.parts, stock, kerf).map(bar => ({ component: g.component, product: g.product.id, description, stock, ...bar }));
        });
    }

    /**
     *  The model as rows of the sheet's componenten tab: per product its quantities and the work
     *  its recipe gives, then the work on the element; totals incl. margins. What `archiyou components`
     *  writes for a component's variants (see ProductManager.componentRows()).
     */
    componentRows(): ReturnType<ProductManager['componentRows']>
    {
        return this._engine(null).componentRows();
    }

    /** The shapes that have no product or component, so are not reckoned with */
    loose(): Array<any>
    {
        return [...this._loose];
    }

    /** What it could not reckon with: shapes without a product, products without a recipe or price or weight */
    check(): Array<EstimateIssue>
    {
        const overview = this._engine(null).compute();
        const issues = [...this._issues];
        if (overview.noRecipe.length) { issues.push({ level: 'warning', where: 'make.estimate()', name: '', message: `no recipe in the sheet, so no labour, for: ${overview.noRecipe.join(', ')}` }); }
        if (overview.noPrice.length) { issues.push({ level: 'warning', where: 'make.estimate()', name: '', message: `no price in the sheet for: ${overview.noPrice.join(', ')}` }); }
        const weightless = this.lines().filter(l => l.kind !== 'operation' && l.weight === 0).map(l => l.id);
        if (weightless.length) { issues.push({ level: 'warning', where: 'make.estimate()', name: '', message: `no density or mass in the sheet, so no weight, for: ${weightless.join(', ')}` }); }
        return issues;
    }

    //// TABLES ////

    /** The lines as a table; with `by`, a row per group */
    table(name = 'estimate', options: { by?: EstimateKey } = {}): Table
    {
        const calc = this.modules?.()?.calc;
        if (!calc) { throw new Error('make.estimate().table(): tables are only available inside a run'); }
        const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
        if (options.by)
        {
            const rows = this.by(options.by).map(g => [g.key, r(g.weight, 1), r(g.hours.total), ...CATEGORIES.map(k => r(g.cost[k])), r(g.cost.total)]);
            return calc.table(name, rows, [options.by, 'weight (kg)', 'hours', ...CATEGORIES, 'total']) as Table;
        }
        const rows = this.lines().map(l => [l.id, l.description, l.vorm, r(l.st, 3), r(l.lengte, 3), r(l.oppervlak, 3), r(l.volume, 4),
            r(l.weight, 1), r(l.hours?.total ?? 0), r(l.costs?.total ?? 0), l.labour ?? '']);
        return calc.table(name, rows, ['product', 'description', 'vorm', 'st', 'm1', 'm2', 'm3', 'weight (kg)', 'hours', 'cost excl. margins', 'recipe']) as Table;
    }

    /** The order list as a table: see ProductManager.orderTable() */
    orderTable(name = 'order', options: { byComponent?: boolean, component?: string } = {}): Table
    {
        return this._engine(null).orderTable(name, { ...options, kerf: this.options.kerf });
    }

    /** The cut list as a table: a row per length of stock */
    cutTable(name = 'cuts', options: { byComponent?: boolean } = {}): Table
    {
        const calc = this.modules?.()?.calc;
        if (!calc) { throw new Error('make.estimate().cutTable(): tables are only available inside a run'); }
        const rows = this.cuts(options).map(b => [...(options.byComponent ? [b.component] : []), b.product, b.description, Math.round(b.stock),
            b.parts.map(p => Math.round(p.length)).join(' + '), Math.round(b.rest)]);
        return calc.table(name, rows, [...(options.byComponent ? ['component'] : []), 'product', 'description', 'stock (mm)', 'parts (mm)', 'rest (mm)']) as Table;
    }

    //// INSIDE ////

    /** The reckoning for all shapes, or for those of one group */
    private _engine(group: { key: EstimateKey, value: string } | null): ProductManager
    {
        const id = group ? `${group.key}=${group.value}` : '';
        const known = this._cache.get(id);
        if (known) { return known; }
        const pm = new ProductManager(this.modules).fromDb(this.db);
        this._placed.filter(p => !group || this._keyOf(p, group.key) === group.value).forEach(p =>
        {
            try
            {
                pm.place(p.shape, p.component
                    ? { component: p.component, volume: p.volume, label: p.label, block: p.block || undefined }
                    : { product: p.product!.id, measure: p.measure, label: p.label, block: p.block || undefined, recipe: p.recipe, waste: p.waste });
            }
            catch (e) { if (!group) { this._issue('error', this._name(p.shape), (e as Error).message); } }
        });
        // the screws make.fasten() drew, of the shapes of this group
        if (!group || group.key === 'component' || group.key === 'product') { this._fastenings(pm, group); }
        this._added.filter(a => !group || this._keyOfAdded(a, group.key) === group.value).forEach(a =>
        {
            try
            {
                if (a.kind === 'add') { pm.add(a.id, a.quantities, a.options); }
                else { pm.complete(a.id, a.quantities, { label: a.options.label, except: a.options.except, elements: a.options.elements }); }
            }
            catch (e) { if (!group) { this._issue('error', `est.${a.kind}('${a.id}')`, (e as Error).message); } }
        });
        this._cache.set(id, pm);
        return pm;
    }

    /** The screws make.fasten() drew: one per head, by product and component */
    private _fastenings(pm: ProductManager, group: { key: EstimateKey, value: string } | null): void
    {
        const counts = new Map<string, { id: string, component?: string, count: number, labels: Set<string> }>();
        const walk = (s: any): void =>
        {
            if (s == null) { return; }
            if (Array.isArray(s)) { s.forEach(walk); return; }
            const f = s._fastening;
            if (f?.head && f.product)
            {
                const value = group?.key === 'component' ? (f.component ?? '') : f.product;
                if (!group || value === group.value)
                {
                    const key = `${f.product}|${f.component ?? ''}`;
                    const entry = counts.get(key) ?? { id: f.product, component: f.component ?? undefined, count: 0, labels: new Set<string>() };
                    entry.count++;
                    entry.labels.add(f.label ?? 'fastening');
                    counts.set(key, entry);
                }
            }
            if (typeof s.toArray === 'function' && s.isShapeCollection?.()) { s.toArray().forEach(walk); }
        };
        walk(this._shapes);
        counts.forEach(({ id, component, count, labels }) =>
        {
            try { pm.add(id, { st: count }, { label: [...labels].join(', '), ...(component ? { component } : {}) }); }
            catch (e) { if (!group) { this._issue('error', `make.fasten('${id}')`, (e as Error).message); } }
        });
    }

    private _keyOf(p: Placed, key: EstimateKey): string
    {
        switch (key)
        {
            case 'component': return p.block;
            case 'product': return p.product?.id ?? p.component ?? '';
            case 'label': return p.label;
            case 'material': return p.product ? text(p.product.row['materiaal']) : '';
            case 'vorm': return p.product?.vorm ?? 'component';
            case 'group': return p.product?.groups[0] ?? p.component ?? '';
            default: return '';
        }
    }

    private _keyOfAdded(a: Added, key: EstimateKey): string
    {
        const product = a.kind === 'add' ? this._products().get(a.id) : undefined;
        switch (key)
        {
            case 'component': return a.kind === 'complete' ? a.id : (a.options.component ?? '');
            case 'product': return a.id;
            case 'label': return a.options.label ?? a.id;
            case 'material': return product ? text(product.row['materiaal']) : '';
            case 'vorm': return product?.vorm ?? '';
            case 'group': return product?.groups[0] ?? a.id;
            default: return '';
        }
    }

    private _lines(pm: ProductManager): Array<EstimateLine>
    {
        pm.compute();
        const specs = pm.componentSpecs();
        return pm.list().map(line =>
        {
            let weight = 0;
            if (line.kind === 'product')
            {
                const product = this._products().get(line.id);
                weight = product ? this._weightOf(product, line) : 0;
            }
            else if (line.kind === 'component')
            {
                // the component's rows: their weight per m3 of the representative component
                const spec = specs.get(line.id);
                if (spec && spec.volume > 0)
                {
                    const mass = spec.products.reduce((sum, p) => { const product = this._products().get(p.id); return sum + (product ? this._weightOf(product, p.quantities) : 0); }, 0);
                    weight = mass / spec.volume * line.volume;
                }
            }
            return { ...line, weight };
        });
    }

    /** kg of a quantity of a product: its volume x density, else its mass per piece of its basic unit */
    private _weightOf(product: Product, q: ProductQuantities): number
    {
        const row = product.row;
        const density = num(row['dichtheid (kg/m3)']) || num(this._densities().get(text(row['materiaal'])));
        if (num(q.volume) > 0 && density > 0) { return num(q.volume) * density; }
        const mass = num(row['massa (kg)']);
        if (!mass) { return 0; }
        if (num(q.st) > 0 && product.measure === 'piece') { return num(q.st) * mass; }
        const [a, b] = product.stock;
        if (product.measure === 'linear' && num(q.lengte) > 0 && Number.isFinite(a!)) { return num(q.lengte) * 1000 / a! * mass; }
        if (product.measure === 'sheet' && num(q.oppervlak) > 0 && Number.isFinite(a! * b!)) { return num(q.oppervlak) * 1e6 / (a! * b!) * mass; }
        return num(q.st) * mass;
    }

    private _catalogOf: Catalog | null = null;
    private _catalog(): Catalog
    {
        return this._catalogOf ??= new Catalog(this.db);
    }

    private _productMap: Map<string, Product> | null = null;
    private _products(): Map<string, Product>
    {
        return this._productMap ??= new Map(this.db.table('producten').map(row => { const p = toProduct(row as any); return [p.id, p]; }));
    }

    private _densityMap: Map<string, number> | null = null;
    private _densities(): Map<string, number>
    {
        return this._densityMap ??= new Map(this.db.table('materialen').map(row => [text(row['materiaal_id']), num(row['dichtheid (kg/m3)'])]));
    }

    private _issue(level: 'warning' | 'error', where: string, message: string): void
    {
        const issue = { level, where, name: '', message };
        this._issues.push(issue);
        this.report(issue);
    }

    private _name(shape: any): string
    {
        return (typeof shape?.name === 'function' ? shape.name() : shape?._name) || 'shape';
    }
}
