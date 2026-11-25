/**
 *  `archiyou makedb --sheet <url>`: a snapshot of the product sheet for the make database.
 *
 *  Reads the whole sheet, as computed: every tab as a table (a named range tables.<name> on it
 *  when it has one: materialen, producten, bewerkingen, componenten; else the tab itself, from
 *  its first row with data as the header, by the tab's name), and every other named range as a
 *  value (settings.*, outputs.*). Not the builders' tabs (SKIPPED): their prices are the builders'
 *  own, for a layer of their own later. With the service account of the environment (see
 *  google.ts); it checks them with core's schema
 *  (make/db/snapshot.ts) and writes them as one JSON file, named by its version:
 *  makedb-2026-11-24.1.json. The version is the day and the next number for that day among the
 *  snapshots in --out. Hand the file to the server (`pnpm admin:makedb add <file>`), or to a run
 *  (`archiyou run model.js --makedb <file>`).
 *
 *  Exit 1 when the snapshot has errors: then no file is written.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Args, columns, fail, out, quiet, userPath } from './common';
import { namedValues, serviceAccount, sheetId, spreadsheet, title } from './google';

const USAGE = 'archiyou makedb --sheet <url> [--out <dir>] [--json]';
/** The tables the core reckons with: they must be there (core's schema checks them) */
const TABLES = ['materialen', 'producten', 'bewerkingen', 'componenten'] as const;
/** Tabs left out: the builders' own prices (bouwersprijzen, and who they are: bouwers), which every
 *  signed-in user could read in a snapshot; they get a layer of their own later */
const SKIPPED = ['bouwers', 'bouwersprijzen'];

/** A column letter: 0 is A, 26 is AA */
const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + letter(i % 26));

export async function makedb(args: Args): Promise<number>
{
    const sheet = args.values.sheet?.[0];
    if (!sheet) { fail(`usage: ${USAGE}`); return 1; }
    if (!serviceAccount()) { fail('no service account: set GOOGLE_SERVICE_ACCOUNT (the key\'s JSON or its path), shared on the sheet'); return 1; }
    const dir = userPath(args.values.out?.[0] ?? '.');
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }

    const id = sheetId(sheet);
    const meta = await spreadsheet(id);
    const tabs: Array<{ id: number; title: string }> = (meta.sheets ?? []).map((t: any) => ({ id: t.properties.sheetId, title: t.properties.title }));
    const ranges: Array<{ name: string; tab: number }> = (meta.namedRanges ?? []).map((n: any) => ({ name: n.name, tab: n.range?.sheetId ?? 0 }));
    const missing = TABLES.filter(t => !ranges.some(r => r.name === `tables.${t}`));
    if (missing.length) { fail(`the sheet has no named range ${missing.map(t => `tables.${t}`).join(', ')}`); return 1; }

    // the tables: the named ones, and every other tab (not skipped) as a whole
    const named = ranges.filter(r => r.name.startsWith('tables.'));
    const read = tabs.filter(t => !SKIPPED.includes(t.title));
    const whole = read.filter(t => !named.some(r => r.tab === t.id));
    const values = await namedValues(id, ranges.map(r => r.name).concat(whole.map(t => `'${t.title.replace(/'/g, "''")}'`)));

    const tables: Record<string, Array<Array<unknown>>> = {};
    named.filter(r => read.some(t => t.id === r.tab)).forEach(r => { tables[r.name.slice('tables.'.length)] = values[r.name] ?? []; });
    whole.forEach(t =>
    {
        const rows = values[`'${t.title.replace(/'/g, "''")}'`] ?? [];
        const start = rows.findIndex(row => row.some(v => String(v ?? '').trim() !== ''));
        if (start < 0) { return; }
        // a column without a heading is named by its letter: the tab's own first column (A) often has none
        const width = Math.max(...rows.map(row => row.length));
        const head = Array.from({ length: width }, (_, i) => String(rows[start]![i] ?? '').trim() || letter(i));
        tables[t.title] = [head, ...rows.slice(start + 1)];
    });

    // every other named range is a value: a cell its value, a range its rows (on a skipped tab: left out)
    const settings = Object.fromEntries(ranges
        .filter(r => !r.name.startsWith('tables.') && read.some(t => t.id === r.tab))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(r =>
        {
            const v = values[r.name] ?? [];
            return [r.name, (v.length <= 1 && (v[0]?.length ?? 0) <= 1) ? (v[0]?.[0] ?? '') : v];
        }));

    const core: any = await quiet(args.bools.has('verbose'), () => import('@archiyou/core'));
    const existing = readdirSync(dir).map(f => f.match(/^makedb-(\d{4}-\d{2}-\d{2}\.\d+)\.json$/)?.[1]).filter((v): v is string => !!v);
    const version = core.nextVersion(new Date(), existing);
    const snapshot = core.snapshotFromTables({
        version,
        source: { sheet: id, title: await title(id), tabs: read.map(t => t.title), skipped: tabs.filter(t => SKIPPED.includes(t.title)).map(t => t.title) },
        tables,
        settings,
    });
    const issues: Array<{ level: string; at: string; message: string }> = core.validateSnapshot(snapshot);
    const errors = issues.filter(i => i.level === 'error');

    if (args.bools.has('json'))
    {
        out(JSON.stringify({ version, file: errors.length ? null : join(dir, `makedb-${version}.json`), issues }, null, 1));
    }
    else
    {
        out(`${snapshot.source.title || id}: ${Object.keys(snapshot.tables).map(t => `${snapshot.tables[t].length} ${t}`).join(', ')}, ${Object.keys(settings).length} named values`);
        if (snapshot.source.skipped.length) { out(`left out: ${snapshot.source.skipped.join(', ')} (the builders' own prices)`); }
        if (issues.length)
        {
            columns([['', 'where', 'problem'], ...issues.slice(0, 40).map(i => [i.level, i.at, i.message])]).forEach(l => out(l));
            if (issues.length > 40) { out(`... and ${issues.length - 40} more`); }
        }
    }
    if (errors.length) { fail(`${errors.length} error(s): no snapshot written`); return 1; }

    const file = join(dir, `makedb-${version}.json`);
    writeFileSync(file, JSON.stringify(snapshot));
    if (!args.bools.has('json')) { out(`written ${file} (version ${version})`); }
    return 0;
}
