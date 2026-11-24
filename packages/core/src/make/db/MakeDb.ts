/**
 *  make/db/MakeDb.ts — a snapshot of the product sheet, ready to reckon with.
 *
 *  What a script gets from make.db(): the tables and settings of one snapshot (snapshot.ts), and
 *  which one it is. Checked when it is made: a snapshot with errors is refused, with all of them
 *  in the message; its warnings stay readable on `issues`.
 *
 *      db = make.db()                  // the latest the run was given
 *      db = make.db('2026-11-24.1')    // a pinned one
 *      db.version                      // '2026-11-24.1'
 *      db.table('producten')           // rows as the sheet has them
 *      db.setting('settings.rate_labor')
 */

import { MAKE_DB_TABLES, validateSnapshot, type MakeDbIssue, type MakeDbRow, type MakeDbSnapshot, type MakeDbTableName } from './snapshot';

export class MakeDb
{
    readonly snapshot: MakeDbSnapshot;
    /** What the check found that does not stop the snapshot from being used */
    readonly issues: Array<MakeDbIssue>;

    constructor(snapshot: MakeDbSnapshot)
    {
        const issues = validateSnapshot(snapshot);
        const errors = issues.filter(i => i.level === 'error');
        if (errors.length)
        {
            const shown = errors.slice(0, 10).map(e => `  ${e.at}: ${e.message}`).join('\n');
            throw new Error(`make.db(): the snapshot ${(snapshot as any)?.version ?? ''} is not usable:\n${shown}`
                + (errors.length > 10 ? `\n  ... and ${errors.length - 10} more` : ''));
        }
        this.snapshot = snapshot;
        this.issues = issues;
    }

    /** A snapshot from its file's text */
    static fromJSON(json: string): MakeDb
    {
        let parsed: unknown;
        try { parsed = JSON.parse(json); }
        catch (e) { throw new Error(`make.db(): the snapshot is not JSON (${(e as Error).message})`); }
        return new MakeDb(parsed as MakeDbSnapshot);
    }

    /** From the bytes a run was handed as content */
    static fromBytes(bytes: ArrayBuffer | Uint8Array): MakeDb
    {
        return MakeDb.fromJSON(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    }

    get version(): string { return this.snapshot.version; }
    get date(): string { return this.snapshot.date; }
    get source(): MakeDbSnapshot['source'] { return this.snapshot.source; }

    /** The rows of a table, as the sheet has them; without the notes (a row without the
     *  table's key, see MAKE_DB_TABLES) */
    table(name: MakeDbTableName): Array<MakeDbRow>
    {
        const key = MAKE_DB_TABLES[name].key;
        return key ? this.snapshot.tables[name].filter(r => String(r[key] ?? '').trim() !== '') : this.snapshot.tables[name];
    }

    /** A setting by the name of its named range in the sheet: 'settings.rate_labor' */
    setting<T = unknown>(name: string): T | undefined
    {
        return this.snapshot.settings[name] as T | undefined;
    }

    /** What a result names to say which numbers it used: 'make-db 2026-11-24.1 (URBUILD_DATABASE_CORE)' */
    toString(): string
    {
        return `make-db ${this.version}${this.source.title ? ` (${this.source.title})` : ''}`;
    }
}
