/**
 *  products/recipes.ts
 *
 *  What the sheet says about the work on a product, read from its componenten tab.
 *
 *  A block of that tab is one representative component (a wall of 8.1 m2). It has a row per
 *  product (fase 'materiaal'), and under each product the operations on it. Three columns say how:
 *
 *      product             on an operation: the product it belongs to; empty for the work on
 *                          the element as a whole (bouwdeel 'element')
 *      per, factor         the operation is factor x that quantity of the product:
 *                          afkorten = 2 x st, schulpen = 1 x zaaglengte
 *
 *  So the recipes stay where partners can read and change them, and a product's labour follows
 *  from its quantities. The same rows give the block's costs, for a component priced as a whole.
 */

/** A quantity of a line, in the units of the sheet: st, m1, m2, m3, m1 sawn. */
export type QuantityKey = 'st' | 'lengte' | 'oppervlak' | 'volume' | 'zaaglengte';

/** The cost columns: material, and the work by its phase. */
export type CostCategory = 'material' | 'onsite' | 'voorbewerking' | 'assemblage' | 'montage' | 'afbouw';

const COST_COLUMNS: Record<CostCategory, string> = {
    material: 'materiaalkosten',
    onsite: 'onsitekosten',
    voorbewerking: 'voorbewerkingskosten',
    assemblage: 'assemblagekosten',
    montage: 'montagekosten',
    afbouw: 'afbouwkosten',
};

const UNIT_QUANTITY: Record<string, QuantityKey> = { st: 'st', m1: 'lengte', m2: 'oppervlak', m3: 'volume' };

/** One operation of a product's recipe: factor x the product's quantity `per`. */
export interface RecipeStep
{
    operation: string;
    /** The cost category it counts in. */
    fase: string;
    per: QuantityKey;
    factor: number;
}

export interface ComponentSpecProduct
{
    id: string;
    vorm: string;
    /** What part of the component it is: constructiehout, isolatie, bevestigingsmiddelen, ... */
    bouwdeel?: string;
    /** Its quantities in the representative component. */
    quantities: Record<QuantityKey, number>;
    steps: Array<RecipeStep>;
}

/** Work on the element as a whole: `amount` of `quantity` for the representative size. In the
 *  table layout it says how: `factor` per element, or per m2 of it (`per` 'oppervlak'). */
export interface ElementWork
{
    operation: string;
    quantity: QuantityKey;
    amount: number;
    per?: 'element' | 'oppervlak';
    factor?: number;
}

/** What a component's first row says about it. */
export interface ComponentSpecInfo
{
    gebouwdeel: string;
    groep: string;
    naam: string;
    /** The component it is a variant of, or ''. */
    variantOf: string;
    /** m2K/W, or null when the sheet has none. */
    rc: number | null;
    /** Where it came from: 'archiyou/timberwall@0.31', or 'handmatig'. */
    bron: string;
}

/** One representative component of the sheet. */
export interface ComponentSpec
{
    id: string;
    /** m2 or st */
    unit: string;
    /** The representative size, in `unit`. */
    size: number;
    /** The representative volume (m3). */
    volume: number;
    info: ComponentSpecInfo;
    products: Array<ComponentSpecProduct>;
    element: Array<ElementWork>;
    /** The costs of the representative component, excluding margins. */
    costs: Record<CostCategory, number>;
    /** Its hours of work by phase, as the sheet's `arbeidstijd (uur)` (time x labour factor). */
    hours: Record<CostCategory, number>;
    /** The CO2 of the representative component, kg: A1-A3, A4-C4, D. */
    gwp: [number, number, number];
    /** The layout it was read from: a block of rows under its id ('block'), or a table with the
     *  id on every row ('table'). */
    layout: 'block' | 'table';
}

const text = (value: unknown): string => String(value ?? '').trim();

const number = (value: unknown): number =>
{
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/** The quantity an operation's unit of work is counted in. */
export function quantityOfUnit(unit: unknown): QuantityKey | null
{
    return UNIT_QUANTITY[text(unit)] ?? null;
}

/** The column of the Rc in either layout */
const rcOf = (row: Record<string, unknown>): number | null =>
{
    const v = row['Rc (m2K/W)'] ?? row['R (m2K/W)'];
    return v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
};

/**
 *  The components of the componenten table, by id. Null when these rows are not such a table
 *  (a builder's componenten tab has the same name and another layout). Two layouts:
 *   - blocks: the id on a component's first row only, its rows below it, then its totals
 *   - a table: the id on every row; its first row (with its name) says what the component is,
 *     then per product a row (fase materiaal) with the operations on it below it, and the work on
 *     the element as a whole. An operation is per all rows of its product in the component.
 */
export function readComponents(rows: Array<Record<string, unknown>>): Map<string, ComponentSpec> | null
{
    const first = rows[0];
    if (!first || !['bewerking', 'fase', 'product', 'per', 'factor'].every(column => column in first))
    {
        return null;
    }

    const blocks = new Map<string, ComponentSpec>();
    let block: ComponentSpec | null = null;
    const tableSteps = new Map<ComponentSpec, Map<string, Array<RecipeStep>>>();

    rows.forEach(row =>
    {
        const id = text(row['component']);
        if (id && id !== block?.id)
        {
            const known = blocks.get(id);
            if (known) { block = known; }
            else
            {
                const size = number(row['representatieve maat']);
                const [width, height, depth] = ['breedte', 'hoogte', 'diepte'].map(side => number(row[`representatieve ${side} (mm)`]));
                block = {
                    id, size,
                    unit: text(row['eenheid maat']),
                    volume: width! * height! * depth! / 1e9,
                    info: { gebouwdeel: text(row['gebouwdeel']), groep: text(row['componentgroep']), naam: text(row['naam (in de offerte)']),
                        variantOf: text(row['variant van']), rc: rcOf(row), bron: text(row['bron']) },
                    products: [],
                    element: [],
                    costs: { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0 },
                    hours: { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0 },
                    gwp: [0, 0, 0],
                    layout: 'block',
                };
                blocks.set(id, block);
            }
        }
        else if (id && block && !text(row['naam (in de offerte)'])) { block.layout = 'table'; }
        // the rows under a block's total have no phase, nor has a component's first row in a table
        const fase = text(row['fase']);
        if (!block || !fase) { return; }
        const current: ComponentSpec = block;

        (Object.keys(COST_COLUMNS) as Array<CostCategory>).forEach(category =>
        {
            current.costs[category] += number(row[COST_COLUMNS[category]]);
        });
        if (fase !== 'materiaal' && fase in COST_COLUMNS) { current.hours[fase as CostCategory] += number(row['arbeidstijd (uur)']); }
        ['GWP A1-A3 (kg)', 'GWP A4-C4 (kg)', 'GWP D (kg)'].forEach((column, i) => { current.gwp[i] += number(row[column]); });

        // a material row is a product of the block; any other row with a product is work on it
        const operation = text(row['bewerking']);
        const product = text(row['product']);
        if (fase === 'materiaal')
        {
            if (product)
            {
                current.products.push({
                    id: product,
                    vorm: text(row['vorm / werkeenheid']).toLowerCase(),
                    bouwdeel: text(row['bouwdeel']),
                    quantities: {
                        st: number(row['stuks (totaal)']),
                        lengte: number(row['lengte (totaal m1)']),
                        oppervlak: number(row['oppervlak (totaal m2)']),
                        volume: number(row['volume (totaal m3)']),
                        zaaglengte: number(row['zaaglengte (totaal m1)']),
                    },
                    steps: [],
                });
            }
            return;
        }

        if (!operation) { return; }
        if (!product)
        {
            const quantity = quantityOfUnit(row['vorm / werkeenheid']);
            const per = text(row['per']);
            if (quantity)
            {
                current.element.push({ operation, quantity, amount: number(row['hoeveelheid in prijseenheid']),
                    ...(per === 'element' || per === 'oppervlak' ? { per, factor: number(row['factor']) } : {}) });
            }
            return;
        }
        const per = text(row['per']) as QuantityKey;
        if (!per) { return; }
        const step = { operation, fase, per, factor: number(row['factor']) };
        if (text(row['component']))
        {
            // the table: per all rows of the product in the component, whichever comes first
            const steps = tableSteps.get(current) ?? new Map<string, Array<RecipeStep>>();
            tableSteps.set(current, steps);
            steps.set(product, [...(steps.get(product) ?? []), step]);
            return;
        }
        // the product row above it: a block can have the same product twice
        const owner = [...current.products].reverse().find(p => p.id === product);
        if (owner) { owner.steps.push(step); }
    });
    // in a table a product's operations go with each of its rows, so combineRows() weighs them back
    tableSteps.forEach((steps, b) => b.products.forEach(p => { p.steps.push(...(steps.get(p.id) ?? [])); }));
    return blocks;
}

/** The recipe of one product that a block has on several rows (framing and blocking of the same
 *  beam): each step weighed by the quantity it works on, so together they cost what the rows do. */
export function combineRows(rows: Array<ComponentSpecProduct>): Array<RecipeStep>
{
    if (rows.length === 1) { return rows[0]!.steps; }
    const steps = new Map<string, RecipeStep>();
    rows.forEach(row => row.steps.forEach(step =>
    {
        const key = `${step.operation}|${step.per}`;
        const total = rows.reduce((sum, r) => sum + r.quantities[step.per], 0);
        const share = total > 0 ? step.factor * row.quantities[step.per] / total : 0;
        const known = steps.get(key);
        steps.set(key, { ...step, factor: (known?.factor ?? 0) + share });
    }));
    return [...steps.values()];
}

/** One recipe for several products: the steps most of them have, each with its median factor. */
export function mergeRecipes(recipes: Array<Array<RecipeStep>>): Array<RecipeStep>
{
    if (recipes.length === 1) { return recipes[0]!; }
    const steps = new Map<string, Array<RecipeStep>>();
    recipes.flat().forEach(step =>
    {
        const key = `${step.operation}|${step.per}`;
        steps.set(key, [...(steps.get(key) ?? []), step]);
    });
    return [...steps.values()]
        .filter(found => found.length * 2 >= recipes.length)
        .map(found =>
        {
            const factors = found.map(s => s.factor).sort((a, b) => a - b);
            const middle = factors.length / 2;
            const median = Number.isInteger(middle) ? (factors[middle - 1]! + factors[middle]!) / 2 : factors[Math.floor(middle)]!;
            return { ...found[0]!, factor: median };
        });
}

/** The material of a line before waste, as the sheet prices a product row: by area when it has
 *  one, else by length, else per piece of its basic unit, else by volume. */
export function materialPrice(row: Record<string, unknown>, q: Record<QuantityKey, number>): number
{
    if (q.oppervlak) { return q.oppervlak * number(row['prijs per m2']); }
    if (q.lengte)
    {
        const stock = number(row['lengte']) / 1000;
        const perMetre = text(row['prijseenheid']) === 'm1' ? number(row['prijs'])
            : stock > 0 ? number(row['prijs per basiseenheid']) / stock : 0;
        return q.lengte * perMetre;
    }
    if (q.st) { return q.st * number(row['prijs per basiseenheid']); }
    return q.volume * number(row['prijs per m3']);
}
