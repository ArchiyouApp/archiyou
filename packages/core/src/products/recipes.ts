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

export interface BlockProduct
{
    id: string;
    vorm: string;
    /** Its quantities in the representative component. */
    quantities: Record<QuantityKey, number>;
    steps: Array<RecipeStep>;
}

/** Work on the element as a whole: `amount` of `quantity` for the representative size. */
export interface ElementWork
{
    operation: string;
    quantity: QuantityKey;
    amount: number;
}

/** One representative component of the sheet. */
export interface Block
{
    id: string;
    /** m2 or st */
    unit: string;
    /** The representative size, in `unit`. */
    size: number;
    /** The representative volume (m3). */
    volume: number;
    products: Array<BlockProduct>;
    element: Array<ElementWork>;
    /** The costs of the representative component, excluding margins. */
    costs: Record<CostCategory, number>;
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

/** The blocks of the componenten table, by component id. Null when these rows are not such a
 *  table (a builder's componenten tab has the same name and another layout). */
export function readBlocks(rows: Array<Record<string, unknown>>): Map<string, Block> | null
{
    const first = rows[0];
    if (!first || !['bewerking', 'fase', 'product', 'per', 'factor'].every(column => column in first))
    {
        return null;
    }

    const blocks = new Map<string, Block>();
    let block: Block | null = null;

    rows.forEach(row =>
    {
        const id = text(row['component']);
        if (id)
        {
            const size = number(row['representatieve maat']);
            const [width, height, depth] = ['breedte', 'hoogte', 'diepte'].map(side => number(row[`representatieve ${side} (mm)`]));
            block = {
                id, size,
                unit: text(row['eenheid maat']),
                volume: width! * height! * depth! / 1e9,
                products: [],
                element: [],
                costs: { material: 0, onsite: 0, voorbewerking: 0, assemblage: 0, montage: 0, afbouw: 0 },
            };
            blocks.set(id, block);
        }
        // the rows under a block's total have no phase
        const fase = text(row['fase']);
        if (!block || !fase) { return; }
        const current: Block = block;

        (Object.keys(COST_COLUMNS) as Array<CostCategory>).forEach(category =>
        {
            current.costs[category] += number(row[COST_COLUMNS[category]]);
        });

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
            if (quantity)
            {
                current.element.push({ operation, quantity, amount: number(row['hoeveelheid in prijseenheid']) });
            }
            return;
        }
        // the product row above it: a block can have the same product twice
        const owner = [...current.products].reverse().find(p => p.id === product);
        const per = text(row['per']) as QuantityKey;
        if (owner && per) { owner.steps.push({ operation, fase, per, factor: number(row['factor']) }); }
    });
    return blocks;
}

/** The recipe of one product that a block has on several rows (framing and blocking of the same
 *  beam): each step weighed by the quantity it works on, so together they cost what the rows do. */
export function combineRows(rows: Array<BlockProduct>): Array<RecipeStep>
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
