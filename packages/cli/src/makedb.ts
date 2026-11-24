/**
 *  `archiyou makedb --sheet <url>`: a snapshot of the product sheet for the make database.
 *
 *  Reads the computed values of the sheet's tables (tables.materialen, .producten, .bewerkingen,
 *  .componenten) and settings (settings.*, outputs.marges.*, outputs.opslagen.*, outputs.verlies)
 *  with the service account of the environment (see google.ts), checks them with core's schema
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
const TABLES = ['materialen', 'producten', 'bewerkingen', 'componenten'] as const;
/** The named ranges that are settings: a value, or a range of rows */
const SETTING = /^(settings\.|outputs\.marges\.|outputs\.opslagen\.|outputs\.verlies$)/;

export async function makedb(args: Args): Promise<number>
{
    const sheet = args.values.sheet?.[0];
    if (!sheet) { fail(`usage: ${USAGE}`); return 1; }
    if (!serviceAccount()) { fail('no service account: set GOOGLE_SERVICE_ACCOUNT (the key\'s JSON or its path), shared on the sheet'); return 1; }
    const dir = userPath(args.values.out?.[0] ?? '.');
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }

    const id = sheetId(sheet);
    const meta = await spreadsheet(id);
    const names: Array<string> = (meta.namedRanges ?? []).map((n: any) => n.name);
    const missing = TABLES.filter(t => !names.includes(`tables.${t}`));
    if (missing.length) { fail(`the sheet has no named range ${missing.map(t => `tables.${t}`).join(', ')}`); return 1; }
    const settingNames = names.filter(n => SETTING.test(n)).sort();

    const values = await namedValues(id, [...TABLES.map(t => `tables.${t}`), ...settingNames]);
    const settings = Object.fromEntries(settingNames.map(n =>
    {
        const v = values[n] ?? [];
        // a cell is its value; a range stays rows
        return [n, (v.length <= 1 && (v[0]?.length ?? 0) <= 1) ? (v[0]?.[0] ?? '') : v];
    }));

    const core: any = await quiet(args.bools.has('verbose'), () => import('@archiyou/core'));
    const existing = readdirSync(dir).map(f => f.match(/^makedb-(\d{4}-\d{2}-\d{2}\.\d+)\.json$/)?.[1]).filter((v): v is string => !!v);
    const version = core.nextVersion(new Date(), existing);
    const snapshot = core.snapshotFromTables({
        version,
        source: { sheet: id, title: await title(id) },
        tables: Object.fromEntries(TABLES.map(t => [t, values[`tables.${t}`] ?? []])),
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
        out(`${snapshot.source.title || id}: ${TABLES.map(t => `${snapshot.tables[t].length} ${t}`).join(', ')}, ${settingNames.length} settings`);
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
