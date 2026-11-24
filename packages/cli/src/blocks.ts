/**
 *  `archiyou blocks <file.js> --sheet <url>`: the variants of a component script as blocks of
 *  its product sheet's componenten tab.
 *
 *  A component script names its variants as presets: the reference size and the layers of each,
 *  the preset's name the component's id in the sheet, with a label and what it is a variant of:
 *
 *      $PARAMS.preset('hsbwand-esb', { WIDTH: 3000, HEIGHT: 2700, DEPTH: 235, SHEATHING: 'esb15' },
 *          { label: 'HSB wand 235, houtvezel, ESB', variantOf: 'hsbwand' })
 *
 *  Per preset the script runs with the sheet, its parts are collected as products
 *  (products.block()) and its Rc is taken from the layers (materials.rc(), ISO 6946). The table
 *  says what each component holds; --write puts them in the sheet's tab componenten (sheetBlocks.ts,
 *  the table layout), each replacing its rows there, a new variant after its family, with where
 *  it came from (bron: here the file's name and a hash of its code).
 *
 *  The sheet is read with a service account when the environment has one (GOOGLE_SERVICE_ACCOUNT,
 *  see google.ts), else as a public sheet; writing always needs the account.
 */

import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { readFileSync } from 'node:fs';

import { type Args, columns, fail, out, quiet, round } from './common';
import { engine, moduleDirs, scriptFile } from './run';
import { exportXlsx, serviceAccount, sheetId } from './google';
import { writeBlocks, type GeneratedBlock } from './sheetBlocks';

const USAGE = 'archiyou blocks <file.js> --sheet <url> [--preset name]... [--write] [--json]';

/** What the script is given after its own code, to hand its block back */
function tail(url: string): string
{
    return `
$module('cloudcalc');
__blocks_products = make.products().fromSheet('${url}').collect(all());
__blocks_block = __blocks_products.block();
__blocks_rc = (() => { try { return materials.rc(all()); } catch (e) { return { error: String(e.message ?? e) }; } })();
`;
}

export async function blocks(args: Args): Promise<number>
{
    const file = scriptFile(args, USAGE);
    if (!file) { return 1; }
    const sheet = args.values.sheet?.[0];
    if (!sheet) { fail(`usage: ${USAGE}`); return 1; }
    const verbose = args.bools.has('verbose');
    const id = sheetId(sheet);
    const url = `https://docs.google.com/spreadsheets/d/${id}`;

    // the sheet, as the account sees it, or as anyone does
    let bytes: ArrayBuffer;
    let via = 'key';
    if (serviceAccount()) { bytes = await exportXlsx(id); }
    else
    {
        const res = await fetch(`${url}/export?format=xlsx`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('spreadsheetml'))
        {
            fail('the sheet is not public, and there is no service account (GOOGLE_SERVICE_ACCOUNT) to read it with');
            return 1;
        }
        bytes = await res.arrayBuffer();
        via = 'public';
    }
    const version = createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 16);
    const content = { [`google-sheet:${id}`]: { kind: 'google-sheet', id, bytes, version, via } };

    const { runner, catalog } = await engine(verbose, moduleDirs(args));
    const name = basename(file, extname(file));
    const own = readFileSync(file, 'utf8');
    const code = own + tail(url);
    // a local file has no version: its name and a hash of its code say which it was
    const source = { bron: `bestand ${basename(file)} #${createHash('sha256').update(own).digest('hex').slice(0, 8)}` };
    const execute = async (params: Record<string, any>) =>
    {
        const res: any = await quiet(verbose, () => runner.execute({ script: { name, code }, params, modules: catalog, content, outputs: [], messages: ['user', 'warn'] }));
        return { res, scope: runner.getScope('default') as any };
    };

    // the presets the script declares, run once at its defaults to find them
    const first = await execute({});
    if (first.res.status !== 'success') { fail(`the script fails: ${first.res.errors?.[0]?.message ?? first.res.status}`); return 1; }
    const params = first.scope._paramManager;
    const declared = Object.keys(params.getDefinedPresets());
    const wanted = args.values.preset ?? declared;
    const unknown = wanted.filter((p: string) => !declared.includes(p));
    if (unknown.length) { fail(`no preset ${unknown.join(', ')} in the script; it has: ${declared.join(', ') || 'none'}`); return 1; }
    if (!wanted.length) { fail('the script declares no presets: name its variants with $PARAMS.preset(id, values, { label, variantOf })'); return 1; }

    const made: Array<GeneratedBlock> = [];
    for (const preset of wanted)
    {
        const values = params.presetValues(preset);
        const options = params.presetOptions(preset);
        const { res, scope } = await execute(values);
        if (res.status !== 'success') { fail(`preset ${preset} fails: ${res.errors?.[0]?.message ?? res.status}`); return 1; }
        const rc = scope.__blocks_rc;
        made.push({
            id: preset,
            label: options.label ?? preset,
            variantOf: options.variantOf ?? null,
            values,
            script: name,
            source,
            block: scope.__blocks_block,
            rc: rc?.error ? null : rc,
            rcError: rc?.error ?? null,
            warnings: (res.warnings ?? []).map((w: any) => (typeof w === 'string' ? w : w.message)).filter(Boolean),
        });
    }

    if (args.bools.has('json')) { out(JSON.stringify(made, null, 1)); }
    else
    {
        out(`${made.length} block(s) from ${name}, priced by the sheet`);
        const rows = [['component', 'variant of', 'Rc', 'depth', 'per m2', 'lines', 'label']];
        made.forEach(b =>
        {
            const size = Number(values(b).WIDTH) * Number(values(b).HEIGHT) / 1e6 || 1;
            const depth = b.rc ? b.rc.layers.reduce((s: number, l: any) => s + l.thickness, 0) * 1000 : NaN;
            rows.push([b.id, b.variantOf ?? '', b.rc ? round(b.rc.rc, 2) : '-', isNaN(depth) ? '-' : round(depth, 1), round(b.block.totals.total / size, 2), String(b.block.lines.length), b.label]);
        });
        columns(rows).forEach(l => out(l));
        made.filter(b => b.rcError).forEach(b => out(`${b.id}: no Rc: ${b.rcError}`));
        made.forEach(b => b.block.noRecipe.length && out(`${b.id}: no recipe for ${b.block.noRecipe.join(', ')}`));
    }

    if (args.bools.has('write'))
    {
        if (!serviceAccount()) { fail('--write needs a service account (GOOGLE_SERVICE_ACCOUNT) with edit rights on the sheet'); return 1; }
        const written = await writeBlocks(id, made);
        written.forEach(w => out(`written ${w.id}: componenten!A${w.from}:A${w.to}`));
    }
    return 0;
}

const values = (b: GeneratedBlock): Record<string, any> => b.values ?? {};
