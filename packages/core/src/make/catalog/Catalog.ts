/**
 *  make/catalog/Catalog.ts — the products of a make database, found by what a script calls them.
 *
 *  A script names a product the way a person would: its id ('sls-38x235'), its group ('SLS'), a
 *  word for it in English or Dutch ('stud', 'regel', 'OSB'), or something close to one ('stdu').
 *  find() turns that into the products it can mean, in this order, the first that gives any:
 *
 *   1. id       the product id
 *   2. group    a product group ('SLS', 'OSB')
 *   3. alias    one of the product's aliases (the sheet's column `aliassen`: English and Dutch)
 *   4. words    every word of the name is in the product's term, aliases, groups or id
 *               ('SLS 38x235', 'osb 18', 'wood fibre insulation')
 *   5. fuzzy    an alias, group or id within a few letters of the name ('stdu' → 'stud')
 *
 *  resolve() then lets a part's size choose among them (a group has many sizes), as the
 *  products API always did: as measured, else turned (an offcut thinner than it is thick).
 *  It never quietly guesses: what it had to choose, or could not, comes back as issues.
 */

import type { PartMeasure } from '../../modeler/parts';
import type { MakeDb } from '../db';
import { toProduct, fit, orient, compareRanks, sizeText, type Product } from './products';

export type LookupHow = 'id' | 'group' | 'alias' | 'words' | 'fuzzy';

export interface Lookup
{
    how: LookupHow | null;
    /** The products the name can mean, in the sheet's order */
    candidates: Array<Product>;
    /** For a fuzzy match: the alias, group or id it was read as */
    read?: string;
}

export interface ResolveIssue
{
    level: 'warning' | 'error';
    message: string;
}

export interface Resolution extends Lookup
{
    /** The product, or null when none could be chosen */
    product: Product | null;
    /** The part's measure, turned where that made it fit */
    measure: PartMeasure | null;
    issues: Array<ResolveIssue>;
}

/** Lower case, without accents, words split on spaces and punctuation */
export function normalize(text: unknown): string
{
    return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[_\-/,.;:()]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Edit distance between two strings (insert, delete, change one letter, swap two) */
export function distance(a: string, b: string): number
{
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as Array<number>);
    for (let j = 1; j <= b.length; j++) { d[0]![j] = j; }
    for (let i = 1; i <= a.length; i++)
    {
        for (let j = 1; j <= b.length; j++)
        {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) { d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1); }
        }
    }
    return d[a.length]![b.length]!;
}

/** How many letters a name may be off and still be read as another: none for short ones */
const allowance = (name: string): number => (name.length <= 3 ? 0 : name.length <= 6 ? 1 : 2);

interface Entry
{
    product: Product;
    id: string;
    groups: Array<string>;
    aliases: Array<string>;
    /** Every word the product is known by */
    words: Set<string>;
}

export class Catalog
{
    readonly products: Array<Product>;
    private readonly entries: Array<Entry>;

    constructor(readonly db: MakeDb)
    {
        this.products = db.table('producten').map(row => toProduct(row as any));
        this.entries = this.products.map(product =>
        {
            const aliases = String(product.row['aliassen'] ?? '').split(',').map(normalize).filter(Boolean);
            const groups = product.groups.map(normalize);
            const term = normalize(product.row['term']);
            const id = normalize(product.id);
            const words = new Set([...aliases, ...groups, term, id].flatMap(t => t.split(' ')).filter(Boolean));
            return { product, id, groups, aliases, words };
        });
    }

    /** A product by its id, or undefined */
    get(id: string): Product | undefined
    {
        return this.products.find(p => p.id === id);
    }

    /** The products a name can mean: see the top of this file */
    find(name: string): Lookup
    {
        const q = normalize(name);
        if (!q) { return { how: null, candidates: [] }; }
        const pick = (how: LookupHow, test: (e: Entry) => boolean): Lookup | null =>
        {
            const candidates = this.entries.filter(test).map(e => e.product);
            return candidates.length ? { how, candidates } : null;
        };
        const tokens = q.split(' ');
        const found = pick('id', e => e.id === q)
            ?? pick('group', e => e.groups.includes(q))
            ?? pick('alias', e => e.aliases.includes(q))
            ?? pick('words', e => tokens.every(t => e.words.has(t)));
        if (found) { return found; }

        // fuzzy: the nearest alias, group or id within the allowance
        let best = Infinity;
        const near: Array<{ entry: Entry; read: string }> = [];
        this.entries.forEach(e =>
        {
            [...e.aliases, ...e.groups, e.id].forEach(key =>
            {
                const dist = distance(q, key);
                if (dist > allowance(key) || dist > best) { return; }
                if (dist < best) { best = dist; near.length = 0; }
                near.push({ entry: e, read: key });
            });
        });
        if (!near.length) { return { how: null, candidates: [] }; }
        const candidates = [...new Set(near.map(n => n.entry.product))];
        return { how: 'fuzzy', candidates, read: near[0]!.read };
    }

    /**
     *  The product a part is: the one of `find(name)` its size fits best. Without a measure (a
     *  shape that is no solid) only a name that means one product resolves. Ties, fuzzy reads
     *  and misfits are chosen, and said, as warnings; what cannot be chosen is an error.
     */
    resolve(name: string, measure: PartMeasure | null, tolerance: number = 1): Resolution
    {
        const lookup = this.find(name);
        const issues: Array<ResolveIssue> = [];
        const ids = (ps: Array<Product>) => ps.slice(0, 6).map(p => p.id).join(', ') + (ps.length > 6 ? `, ... (${ps.length})` : '');
        if (!lookup.candidates.length)
        {
            const close = this.suggest(name);
            issues.push({ level: 'error', message: `'${name}' is no product of the sheet` + (close.length ? `; did you mean: ${close.join(', ')}?` : '') });
            return { ...lookup, product: null, measure, issues };
        }
        if (lookup.how === 'fuzzy') { issues.push({ level: 'warning', message: `'${name}' read as '${lookup.read}'` }); }

        if (!measure)
        {
            if (lookup.candidates.length === 1) { return { ...lookup, product: lookup.candidates[0]!, measure, issues }; }
            issues.push({ level: 'error', message: `'${name}' can be ${lookup.candidates.length} products (${ids(lookup.candidates)}) and the shape has no size to choose by` });
            return { ...lookup, product: null, measure, issues };
        }

        type Ranked = { product: Product; measure: PartMeasure; rank: Array<number> };
        const rank = (turn: boolean) => lookup.candidates
            .map(product => { const m = turn ? orient(product, measure, tolerance) : measure; return { product, measure: m, rank: fit(product, m, tolerance) }; })
            .filter((r): r is Ranked => r.rank !== null)
            .sort((a, b) => compareRanks(a.rank, b.rank));
        const asMeasured = rank(false);
        const ranked = asMeasured.length ? asMeasured : rank(true);

        if (!ranked.length)
        {
            if (lookup.candidates.length === 1)
            {
                issues.push({ level: 'warning', message: `${lookup.candidates[0]!.id} does not fit the part's size ${sizeText(measure)}` });
                return { ...lookup, product: lookup.candidates[0]!, measure, issues };
            }
            issues.push({ level: 'error', message: `no product of '${name}' fits the part's size ${sizeText(measure)}; it has: ${ids(lookup.candidates)}` });
            return { ...lookup, product: null, measure, issues };
        }
        const best = ranked[0]!;
        const tied = ranked.filter(r => compareRanks(r.rank, best.rank) === 0).map(r => r.product);
        if (tied.length > 1)
        {
            issues.push({ level: 'warning', message: `${tied.length} products of '${name}' fit ${sizeText(measure)} equally well (${ids(tied)}): took ${best.product.id}; name one of them, or a narrower group` });
        }
        return { ...lookup, product: best.product, measure: best.measure, issues };
    }

    /** Names close to `name`, to suggest when nothing matched: aliases, groups and ids */
    suggest(name: string, max: number = 5): Array<string>
    {
        const q = normalize(name);
        const keys = [...new Set(this.entries.flatMap(e => [...e.groups, ...e.aliases]))];
        return keys
            .map(k => ({ k, d: distance(q, k) - (k.startsWith(q) || q.startsWith(k) ? 2 : 0) }))
            .filter(x => x.d <= Math.max(2, allowance(x.k) + 1))
            .sort((a, b) => a.d - b.d)
            .slice(0, max)
            .map(x => x.k);
    }

    /** The components of the sheet by id: their first rows */
    components(): Array<string>
    {
        return [...new Set(this.db.table('componenten').map(r => String(r['component'] ?? '').trim()).filter(Boolean))];
    }
}
