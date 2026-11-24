/**
 *  Components of a product sheet's componenten tab, written from a model (components.ts).
 *
 *  The tab is a table: the component's id on every row. Its first row says what it is (name,
 *  group, size, Rc, where it came from), then per product a row (fase materiaal) with the
 *  operations on it below it, then the work on the element as a whole. Every formula reads its
 *  own row only (an operation's quantity is factor x its product's rows in the component, by
 *  SUMIFS), so a row of any kind can be taken from the tab itself as the template of that kind:
 *  the formulas stay the sheet's, only the row number moves.
 *
 *  What a script writes: the first row, and the products with their operations (the recipe's
 *  per and factor). The work on the element stays the sheet's: a component written again keeps
 *  its element rows, a new variant takes those of the component it is a variant of.
 *
 *  A component written again replaces its rows where they are; a new one goes after its family
 *  (the component it is a variant of and that one's variants), else at the end.
 */

import { batchUpdate, formulas, spreadsheet, writeValues } from './google';

/** Where a written component came from */
export interface Provenance
{
    /** 'archiyou/timberwall@0.31', or for a local file 'bestand timberwall.js #3f2a9c1d' */
    bron: string;
    /** The id of the script's version in the library, when it is from there */
    bronId?: string;
    /** The main model it was published from: 'archiyou/ur_house_detailed@0.12' */
    via?: string;
}

export interface GeneratedComponent
{
    id: string;
    label: string;
    variantOf: string | null;
    values: Record<string, any>;
    script: string;
    source: Provenance;
    rows: any;              // make.estimate().componentRows()
    rc: any | null;         // MaterialManager.rc()
    rcError: string | null;
    warnings: Array<string>;
}

const TAB = 'componenten';
const HEADER_ROWS = 2;
/** The columns that say where a component came from, added to the tab when it has not got them */
export const PROVENANCE_COLUMNS = ['variant van', 'bron', 'bron-id', 'preset', 'via', 'gegenereerd'];
const QUANTITY_COLUMNS: Record<string, string> = { st: 'stuks (totaal)', lengte: 'lengte (totaal m1)', oppervlak: 'oppervlak (totaal m2)', volume: 'volume (totaal m3)', zaaglengte: 'zaaglengte (totaal m1)' };

const letter = (i: number): string => (i < 26 ? '' : letter(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26));
const num = (v: number, digits = 4): number => Math.round(v * 10 ** digits) / 10 ** digits;
const dec = (v: number, digits: number): string => num(v, digits).toFixed(digits).replace('.', ',');

/** A formula with its row numbers moved: `map` old row -> new row (1-based) */
export function retarget(formula: string, map: Map<number, number>): string
{
    if (!formula.startsWith('=')) { return formula; }
    return formula.replace(/(?<![A-Za-z0-9_.!"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (all, d1, col, d2, row) =>
    {
        const to = map.get(Number(row));
        return to === undefined ? all : `${d1}${col}${d2}${to}`;
    });
}

type Kind = 'component' | 'materiaal' | 'bewerking' | 'element';

/** The tab as read: its rows from row 1, the columns by name, and what kind each row is */
export class Tab
{
    readonly head: Array<string>;
    constructor(readonly rows: Array<Array<string>>)
    {
        this.head = (rows[HEADER_ROWS - 1] ?? []).map(h => h.trim());
    }
    col(name: string): number { return this.head.findIndex(h => h.toLowerCase() === name.toLowerCase()); }
    cell(row: number, name: string): string { return (this.rows[row - 1]?.[this.col(name)] ?? '').trim(); }
    id(row: number): string { return this.cell(row, 'component'); }
    kind(row: number): Kind | null
    {
        if (!this.id(row)) { return null; }
        if (this.cell(row, 'naam (in de offerte)')) { return 'component'; }
        if (this.cell(row, 'fase') === 'materiaal') { return 'materiaal'; }
        if (!this.cell(row, 'bewerking')) { return null; }
        return this.cell(row, 'product') ? 'bewerking' : 'element';
    }
    /** 1-based rows of a component, in order */
    rowsOf(id: string): Array<number>
    {
        return this.rows.map((_, i) => i + 1).filter(r => r > HEADER_ROWS && this.id(r) === id);
    }
    /** The first row of a kind, the template of that kind */
    template(kind: Kind): number
    {
        const r = this.rows.findIndex((_, i) => i + 1 > HEADER_ROWS && this.kind(i + 1) === kind) + 1;
        if (!r) { throw new Error(`the tab ${TAB} has no row of the kind ${kind} to take the formulas from`); }
        return r;
    }
    /** The last row with anything in it */
    get used(): number { return this.rows.reduce((last, r, i) => (r.some(v => v !== '') ? i + 1 : last), HEADER_ROWS); }
}

/** The rows of one component at `start` (1-based), each with the row its format comes from */
export function sheetRows(t: Tab, b: GeneratedComponent, start: number, date: string): Array<{ cells: Array<string | number>; from: number }>
{
    const width = t.head.length;
    const base = b.variantOf ?? b.id;
    const own = t.rowsOf(b.id);
    const family = own.length ? own : t.rowsOf(base);
    const first = family.find(r => t.kind(r) === 'component');
    const fromTemplate = (from: number, to: number) => Array.from({ length: width }, (_, i) => retarget(t.rows[from - 1]?.[i] ?? '', new Map([[from, to]]))) as Array<string | number>;
    const put = (cells: Array<string | number>, name: string, value: string | number | null | undefined) =>
    {
        const i = t.col(name);
        if (i >= 0) { cells[i] = value ?? ''; }
    };
    // what the family says about a product: its row, or the row of the product it is like
    const productRow = (ids: Array<string>) => family.find(r => t.kind(r) === 'materiaal' && ids.includes(t.cell(r, 'product')));
    const operationRow = (ids: Array<string>, operation: string) => family.find(r => t.kind(r) === 'bewerking' && ids.includes(t.cell(r, 'product')) && t.cell(r, 'bewerking') === operation);
    const renamed = (text: string, from: Array<string>, to: string) => from.filter(id => id !== to).reduce((s, id) => s.split(id).join(to), text);

    const out: Array<{ cells: Array<string | number>; from: number }> = [];
    let row = start;

    // its first row
    {
        const from = t.template('component');
        const cells = fromTemplate(from, row);
        ['gebouwdeel', 'componentgroep', 'eenheid maat'].forEach(n => put(cells, n, first ? t.cell(first, n) : ''));
        put(cells, 'component', b.id);
        put(cells, 'naam (in de offerte)', b.rc ? `${b.label} (Rc ${dec(b.rc.rc, 1)})` : b.label);
        put(cells, 'representatieve breedte (mm)', b.values.WIDTH ?? (first ? t.cell(first, 'representatieve breedte (mm)') : ''));
        put(cells, 'representatieve hoogte (mm)', b.values.HEIGHT ?? (first ? t.cell(first, 'representatieve hoogte (mm)') : ''));
        put(cells, 'representatieve diepte (mm)', b.rc ? num(b.rc.layers.reduce((s: number, l: any) => s + l.thickness, 0) * 1000, 1) : (first ? t.cell(first, 'representatieve diepte (mm)') : ''));
        put(cells, 'Rc (m2K/W)', b.rc ? num(b.rc.rc, 2) : '');
        put(cells, 'opmerkingen', b.rc ? `Rc ISO 6946 uit de lagen van het model (bovengrens ${dec(b.rc.upper - 0.17, 2)}, ondergrens ${dec(b.rc.lower - 0.17, 2)})` : '');
        put(cells, 'variant van', b.variantOf ?? '');
        put(cells, 'bron', b.source.bron);
        put(cells, 'bron-id', b.source.bronId ?? '');
        put(cells, 'preset', b.id);
        put(cells, 'via', b.source.via ?? '');
        put(cells, 'gegenereerd', date);
        out.push({ cells, from });
        row++;
    }

    // the products, each with the operations of its recipe
    (b.rows.lines as Array<any>).filter(l => l.kind === 'product').forEach(line =>
    {
        const ids = [line.id, ...(line.like ?? [])];
        const known = productRow(ids);
        const from = t.template('materiaal');
        const cells = fromTemplate(from, row);
        Object.values(QUANTITY_COLUMNS).forEach(n => put(cells, n, ''));
        put(cells, 'component', b.id);
        put(cells, 'bouwdeel', known ? t.cell(known, 'bouwdeel') : '');
        put(cells, 'fase', 'materiaal');
        put(cells, 'product', line.id);
        put(cells, 'bewerking', '');
        put(cells, 'omschrijving', line.description || '');
        if (line.st > 0) { put(cells, 'stuks (totaal)', num(line.st, 3)); }
        if (line.oppervlak > 0) { put(cells, 'oppervlak (totaal m2)', num(line.oppervlak, 3)); }
        else if (line.lengte > 0) { put(cells, 'lengte (totaal m1)', num(line.lengte, 3)); }
        if (line.vorm === 'balk' && line.volume > 0) { put(cells, 'volume (totaal m3)', num(line.volume, 4)); }
        if (line.zaaglengte > 0) { put(cells, 'zaaglengte (totaal m1)', num(line.zaaglengte, 3)); }
        put(cells, 'materiaalverlies', line.waste ?? (known ? t.cell(known, 'materiaalverlies') : ''));
        put(cells, 'opmerkingen', '');
        put(cells, 'per', '');
        put(cells, 'factor', '');
        PROVENANCE_COLUMNS.forEach(n => put(cells, n, ''));
        out.push({ cells, from });
        row++;

        (line.steps as Array<any>).forEach(step =>
        {
            const op = operationRow(ids, step.operation);
            const opFrom = t.template('bewerking');
            const c2 = fromTemplate(opFrom, row);
            Object.values(QUANTITY_COLUMNS).forEach(n => put(c2, n, ''));
            put(c2, 'component', b.id);
            put(c2, 'bouwdeel', known ? t.cell(known, 'bouwdeel') : '');
            put(c2, 'fase', step.fase);
            put(c2, 'product', line.id);
            put(c2, 'bewerking', step.operation);
            const text = op ? t.cell(op, 'omschrijving') : '';
            put(c2, 'omschrijving', text ? renamed(text, ids, line.id) : `${line.id}: ${dec(step.factor, 2)} per ${step.per}`);
            put(c2, 'per', step.per);
            put(c2, 'factor', num(step.factor, 6));
            put(c2, 'opmerkingen', '');
            PROVENANCE_COLUMNS.forEach(n => put(c2, n, ''));
            out.push({ cells: c2, from: opFrom });
            row++;
        });
    });

    // the work on the element: the sheet's, as this component (or the one it is a variant of) has it
    family.filter(r => t.kind(r) === 'element').forEach(r =>
    {
        const cells = fromTemplate(r, row);
        put(cells, 'component', b.id);
        out.push({ cells, from: r });
        row++;
    });
    return out;
}

/** Write the components to the tab componenten; returns where each went */
export async function writeComponents(id: string, components: Array<GeneratedComponent>): Promise<Array<{ id: string; from: number; to: number }>>
{
    const date = new Date().toISOString().slice(0, 10);
    let meta = await spreadsheet(id);
    const tabOf = (m: any) => m.sheets.map((s: any) => s.properties).find((s: any) => s.title === TAB);
    let sheet = tabOf(meta);
    if (!sheet) { throw new Error(`the sheet has no tab ${TAB}`); }

    // the columns of where it came from, after the last, also in the table of the components
    const head = ((await formulas(id, `${TAB}!A${HEADER_ROWS}:ZZ${HEADER_ROWS}`))[0] ?? []).map(h => h.trim());
    if (!head.some(h => h.toLowerCase() === 'rc (m2k/w)'))
    {
        throw new Error(`the tab ${TAB} is not a table (no column "Rc (m2K/W)"): convert it first`);
    }
    const missing = PROVENANCE_COLUMNS.filter(n => !head.some(h => h.toLowerCase() === n));
    if (missing.length)
    {
        const at = head.length;
        const requests: Array<any> = [];
        if (sheet.gridProperties.columnCount < at + missing.length)
        {
            requests.push({ appendDimension: { sheetId: sheet.sheetId, dimension: 'COLUMNS', length: at + missing.length - sheet.gridProperties.columnCount } });
        }
        const table = (meta.namedRanges ?? []).find((n: any) => n.name === `tables.${TAB}`);
        if (table && (table.range.endColumnIndex ?? 0) === at)
        {
            requests.push({ updateNamedRange: { namedRange: { ...table, range: { ...table.range, endColumnIndex: at + missing.length } }, fields: 'range' } });
        }
        await batchUpdate(id, requests);
        await writeValues(id, [{ range: `${TAB}!${letter(at)}${HEADER_ROWS}:${letter(at + missing.length - 1)}${HEADER_ROWS}`, values: [missing] }]);
        meta = await spreadsheet(id);
        sheet = tabOf(meta);
    }

    // the components others are a variant of first: their rows are what a variant takes
    const ordered = [...components].sort((a, b) => Number(!!a.variantOf) - Number(!!b.variantOf));
    const written: Array<{ id: string; from: number; to: number }> = [];
    for (const b of ordered)
    {
        meta = await spreadsheet(id);
        sheet = tabOf(meta);
        const width = Math.max(sheet.gridProperties.columnCount, 1);
        const t = new Tab(await formulas(id, `${TAB}!A1:${letter(width - 1)}${sheet.gridProperties.rowCount}`));
        const own = t.rowsOf(b.id);
        if (own.some((r, i) => i > 0 && r !== own[i - 1]! + 1)) { throw new Error(`${b.id}: its rows are not together in the tab; put them together first`); }

        // where: in place of its rows, else after its family, else after the last row
        let index: number;     // 0-based row the new rows start at
        if (own.length) { index = own[0]! - 1; }
        else
        {
            const base = b.variantOf ?? b.id;
            const family = t.rows.map((_, i) => i + 1).filter(r => r > HEADER_ROWS && (t.id(r) === base || t.id(r).startsWith(`${base}_`)));
            index = family.length ? family[family.length - 1]! : t.used;
        }
        const start = index + 1;
        const rows = sheetRows(t, b, start, date);
        const room = rows.length;
        const shift = (r: number) => (r - 1 >= index ? r + room : r);   // a row of the tab after the insert

        // the new rows first, so templates and element rows that move are still there for their formats
        await batchUpdate(id, [
            { insertDimension: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + room }, inheritFromBefore: index > HEADER_ROWS } },
            ...rows.map((r, i) => ({ copyPaste: {
                source: { sheetId: sheet.sheetId, startRowIndex: shift(r.from) - 1, endRowIndex: shift(r.from), startColumnIndex: 0, endColumnIndex: t.head.length },
                destination: { sheetId: sheet.sheetId, startRowIndex: index + i, endRowIndex: index + i + 1, startColumnIndex: 0, endColumnIndex: t.head.length },
                pasteType: 'PASTE_FORMAT' } })),
        ]);
        await writeValues(id, [{ range: `${TAB}!A${start}:${letter(t.head.length - 1)}${start + room - 1}`, values: rows.map(r => r.cells) }]);
        if (own.length)
        {
            await batchUpdate(id, [{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: own[0]! - 1 + room, endIndex: own[own.length - 1]! + room } } }]);
        }
        written.push({ id: b.id, from: start, to: start + room - 1 });
    }
    return written;
}
