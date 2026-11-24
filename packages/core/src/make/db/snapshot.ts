/**
 *  make/db/snapshot.ts — the make database as a file: a snapshot of the product sheet.
 *
 *  The sheet (URBUILD_DATABASE_CORE) is where people keep the materials, products, operations,
 *  components and settings. A sync (the CLI: `archiyou makedb`) takes the computed values of its
 *  tables and settings, checks them against the schema below and writes them as one JSON file
 *  with a version. The core reckons with such a file, never with the live sheet: it needs no
 *  formulas and no Google access, and every result can say which numbers it used.
 *
 *      {
 *        "format": 1,
 *        "version": "2026-11-24.1",
 *        "date": "2026-11-24T14:05:00.000Z",
 *        "source": { "sheet": "1o0_…", "title": "URBUILD_DATABASE_CORE" },
 *        "tables": { "materialen": [{…}], "producten": [{…}], "bewerkingen": [{…}], "componenten": [{…}] },
 *        "settings": { "settings.rate_labor": 40, "outputs.marges.materiaal": 10, "settings.waste": [["balk", 0.1], …] }
 *      }
 *
 *  A table is its rows as records by the sheet's header, as the sheet has them: the core's
 *  readers (materials, products, recipes) take them as they took the sheet's tables. Settings are
 *  the sheet's named ranges by name: a value for a cell, rows of values for a range.
 */

export const MAKE_DB_FORMAT = 1;

/** The tables of a snapshot, by the name of their named range in the sheet (tables.<name>). */
export type MakeDbTableName = 'materialen' | 'producten' | 'bewerkingen' | 'componenten';

export type MakeDbRow = Record<string, unknown>;

export interface MakeDbSource
{
    /** The sheet's id */
    sheet: string;
    /** Its title, when the sync could read it */
    title?: string;
}

export interface MakeDbSnapshot
{
    format: number;
    /** Date and number of the day: '2026-11-24.1'. What a script pins, what a result names. */
    version: string;
    /** When the sync read the sheet (ISO 8601) */
    date: string;
    source: MakeDbSource;
    tables: Record<MakeDbTableName, Array<MakeDbRow>>;
    /** The sheet's settings by the name of their named range: a value, or rows of values */
    settings: Record<string, unknown>;
}

/** What a table needs: the column that names a row, and the columns a reader depends on */
interface TableSchema
{
    /** The column that names a row; unique and not empty in every row that has data */
    key: string | null;
    required: Array<string>;
    /** Columns of numbers: a value there that is not a number is a problem */
    numbers?: Array<string>;
}

export const MAKE_DB_TABLES: Record<MakeDbTableName, TableSchema> = {
    materialen: {
        key: 'materiaal_id',
        required: ['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'],
        numbers: ['dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'],
    },
    producten: {
        key: 'product_id',
        required: ['product_id', 'productgroep', 'vorm', 'materiaal'],
        numbers: ['dikte', 'breedte', 'hoogte', 'lengte'],
    },
    bewerkingen: {
        key: 'naam',
        // time is the norm; the cost per unit is the sheet's: time / 3600 x rate x labour factor
        required: ['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'],
        numbers: ['tijd (seconden)', 'kosten (EUR per werkeenheid)'],
    },
    componenten: {
        key: null,   // a component has several rows; its id is on its first (or every) row
        required: ['component', 'fase', 'product', 'bewerking', 'per', 'factor'],
    },
};

/** The settings a reckoning cannot do without */
export const MAKE_DB_SETTINGS = ['settings.rate_labor', 'outputs.marges.materiaal', 'outputs.marges.arbeid', 'outputs.marges.algemeen'];

export interface MakeDbIssue
{
    level: 'error' | 'warning';
    /** Where: 'producten', 'producten:sls-38x235', 'settings.rate_labor', 'version' */
    at: string;
    message: string;
}

const text = (v: unknown): string => String(v ?? '').trim();
const isNumber = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) : (text(v) !== '' && Number.isFinite(Number(v)));
const hasData = (row: MakeDbRow): boolean => Object.values(row).some(v => text(v) !== '');

/**
 *  Check a snapshot against the schema. Errors make it unusable (a table or a column a reader
 *  needs is missing, two products with one id); warnings are what a person should look at (a
 *  price that is not a number). Returns every problem found, not only the first.
 */
export function validateSnapshot(snapshot: unknown): Array<MakeDbIssue>
{
    const issues: Array<MakeDbIssue> = [];
    const error = (at: string, message: string) => issues.push({ level: 'error', at, message });
    const warn = (at: string, message: string) => issues.push({ level: 'warning', at, message });
    const s = snapshot as Partial<MakeDbSnapshot> | null;

    if (!s || typeof s !== 'object') { error('snapshot', 'not an object'); return issues; }
    if (s.format !== MAKE_DB_FORMAT) { error('format', `format ${String(s.format)}; this core reads format ${MAKE_DB_FORMAT}`); }
    if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(text(s.version))) { error('version', `"${text(s.version)}" is not a version like 2026-11-24.1`); }
    if (Number.isNaN(Date.parse(text(s.date)))) { error('date', `"${text(s.date)}" is not a date`); }
    if (!text(s.source?.sheet)) { error('source', 'no sheet'); }

    (Object.keys(MAKE_DB_TABLES) as Array<MakeDbTableName>).forEach(name =>
    {
        const rows = s.tables?.[name];
        if (!Array.isArray(rows) || rows.length === 0) { error(name, 'missing or empty'); return; }
        const schema = MAKE_DB_TABLES[name];
        const columns = new Set(rows.flatMap(r => Object.keys(r ?? {})));
        const missing = schema.required.filter(c => !columns.has(c));
        if (missing.length) { error(name, `no column ${missing.map(c => `"${c}"`).join(', ')}`); return; }

        const seen = new Map<string, number>();
        rows.forEach((row, i) =>
        {
            if (!hasData(row)) { return; }
            const key = schema.key ? text(row[schema.key]) : '';
            const at = key ? `${name}:${key}` : `${name}:row ${i + 1}`;
            if (schema.key)
            {
                // the sheet's own convention: a row without its key is a note (bewerkingen ends
                // with an explanation in column B), not part of the table
                if (!key) { warn(at, `no ${schema.key}: a note, not read`); return; }
                else if (seen.has(key)) { error(at, `${schema.key} "${key}" also on row ${seen.get(key)! + 1}`); }
                else { seen.set(key, i); }
            }
            (schema.numbers ?? []).forEach(c =>
            {
                if (text(row[c]) !== '' && !isNumber(row[c])) { warn(at, `${c} "${text(row[c])}" is not a number`); }
            });
        });
    });

    MAKE_DB_SETTINGS.forEach(name =>
    {
        if (!isNumber(s.settings?.[name])) { error(name, 'missing, or not a number'); }
    });
    return issues;
}

/** The next version for a day, given the versions there are: '2026-11-24.1', then '.2' */
export function nextVersion(date: Date, existing: Array<string> = []): string
{
    const day = date.toISOString().slice(0, 10);
    const numbers = existing.filter(v => v.startsWith(`${day}.`)).map(v => Number(v.slice(day.length + 1))).filter(Number.isFinite);
    return `${day}.${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

/** Order versions oldest first ('2026-11-24.2' after '2026-11-24.10' is wrong as text) */
export function compareVersions(a: string, b: string): number
{
    const [da, na] = a.split('.');
    const [db, nb] = b.split('.');
    return da === db ? Number(na) - Number(nb) : (da! < db! ? -1 : 1);
}

/**
 *  A snapshot from what a sync read: the tables as rows of cells with their header first, and
 *  the settings as named values. Blank rows go; a cell keeps its value as the sheet computed it.
 */
export function snapshotFromTables(input: {
    version: string;
    date?: Date;
    source: MakeDbSource;
    tables: Record<MakeDbTableName, Array<Array<unknown>>>;
    settings: Record<string, unknown>;
}): MakeDbSnapshot
{
    const tables = Object.fromEntries((Object.keys(input.tables) as Array<MakeDbTableName>).map(name =>
    {
        const [head = [], ...rows] = input.tables[name];
        const columns = head.map(h => text(h));
        const records = rows
            .map(cells => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ''] as [string, unknown]).filter(([c]) => c !== '')))
            .filter(hasData);
        return [name, records];
    })) as Record<MakeDbTableName, Array<MakeDbRow>>;
    return {
        format: MAKE_DB_FORMAT,
        version: input.version,
        date: (input.date ?? new Date()).toISOString(),
        source: input.source,
        tables,
        settings: input.settings,
    };
}
