/**
 *  `archiyou blocks <file.js> --makedb <snapshot.json>`: the variants of a component script as
 *  rows of its product sheet's componenten tab.
 *
 *  A component script names its variants as presets: the reference size and the layers of each,
 *  the preset's name the component's id in the sheet, with a label and what it is a variant of:
 *
 *      $PARAMS.preset('hsbwand_esb', { WIDTH: 3000, HEIGHT: 2700, DEPTH: 235, SHEATHING: 'esb15' },
 *          { label: 'HSB wand 235, houtvezel, ESB', variantOf: 'hsbwand' })
 *
 *  Per preset the script runs with the make database (a snapshot of the sheet, archiyou makedb);
 *  its shapes are taken off as products (make.takeoff(all()).block()) and its Rc is taken from the
 *  layers (materials.rc(), ISO 6946). The table says what each component holds; --write puts them
 *  in the tab componenten of the sheet the snapshot was made from (or --sheet), each replacing its
 *  rows there, a new variant after its family, with where it came from (bron). Writing needs the
 *  service account (GOOGLE_SERVICE_ACCOUNT, google.ts).
 *
 *  The script is a local .js file (bron: its name and a hash of its code), or a script of the
 *  library as the server's admin command writes it (bron: author/name@version, bron-id the
 *  version's id):
 *
 *      pnpm admin:components export archiyou/timberwall:0.31 --out ./components     (apps/server)
 *      archiyou blocks ./components/timberwall@0.31.json --makedb makedb-2026-11-24.1.json --write
 */

import { createHash } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { type Args, columns, fail, out, quiet, round, userPath } from './common';
import { engine, makeDbContent, moduleDirs, scriptFile, linkComponents } from './run';
import { serviceAccount, sheetId } from './google';
import { writeBlocks, type GeneratedBlock } from './sheetBlocks';

const USAGE = 'archiyou blocks <file.js|script.json> --makedb <snapshot.json> [--sheet <url>] [--preset name]... [--write] [--json]';

/** What the script is given after its own code, to hand its block back */
const TAIL = `
__blocks_take = make.takeoff(all());
__blocks_block = __blocks_take.block();
__blocks_check = __blocks_take.check();
__blocks_rc = (() => { try { return materials.rc(all()); } catch (e) { return { error: String(e.message ?? e) }; } })();
`;

export async function blocks(args: Args): Promise<number>
{
    const file = scriptFile(args, USAGE);
    if (!file) { return 1; }
    const snapshotFile = args.values.makedb?.[0] ? userPath(args.values.makedb[0]) : null;
    if (!snapshotFile || !existsSync(snapshotFile)) { fail(`usage: ${USAGE} (make a snapshot with archiyou makedb --sheet <url>)`); return 1; }
    const verbose = args.bools.has('verbose');
    const content = makeDbContent(snapshotFile);
    const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
    // the sheet to write to: the one the snapshot was made from, unless said otherwise
    const id = args.values.sheet?.[0] ? sheetId(args.values.sheet[0]) : String(snapshot.source?.sheet ?? '');

    const { runner, catalog } = await engine(verbose, moduleDirs(args));
    linkComponents(runner, [dirname(file), ...(args.values.components ?? []).map(userPath)]);
    // a .js file, or a script of the library as `pnpm admin:components export` writes it: its code,
    // params and presets, and which version it is
    const stored = extname(file) === '.json' ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (stored && typeof stored.code !== 'string') { fail(`${file}: not a script (no code)`); return 1; }
    const name = stored?.name ?? basename(file, extname(file));
    const own: string = stored?.code ?? readFileSync(file, 'utf8');
    const code = own + TAIL;
    // from the library: author, name and version; a local file has no version: its name and a hash of its code
    const source = stored
        ? { bron: stored.source?.bron ?? `${stored.author}/${stored.name}@${stored.version ?? 'zonder versie'}`, bronId: stored.source?.id ?? stored.id }
        : { bron: `bestand ${basename(file)} #${createHash('sha256').update(own).digest('hex').slice(0, 8)}` };
    const execute = async (params: Record<string, any>) =>
    {
        const script = stored ? { ...stored, code } : { name, code };
        const res: any = await quiet(verbose, () => runner.execute({ script, params, modules: catalog, content, outputs: [], messages: ['user', 'warn'] }));
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
            warnings: [...(res.warnings ?? []).map((w: any) => (typeof w === 'string' ? w : w.message)), ...(scope.__blocks_check ?? []).map((i: any) => `${i.where}: ${i.message}`)].filter(Boolean),
        });
    }

    if (args.bools.has('json')) { out(JSON.stringify(made, null, 1)); }
    else
    {
        out(`${made.length} block(s) from ${name}, priced by make database ${snapshot.version} (${snapshot.source?.title ?? id})`);
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
        made.forEach(b => (b.warnings ?? []).filter((w: string) => w.startsWith('make.') || w.includes('.product(')).forEach((w: string) => out(`${b.id}: ${w}`)));
    }

    if (args.bools.has('write'))
    {
        if (!serviceAccount()) { fail('--write needs a service account (GOOGLE_SERVICE_ACCOUNT) with edit rights on the sheet'); return 1; }
        if (!id) { fail('--write: the snapshot names no sheet; give it with --sheet <url>'); return 1; }
        const written = await writeBlocks(id, made);
        written.forEach(w => out(`written ${w.id}: componenten!A${w.from}:A${w.to}`));
    }
    return 0;
}

const values = (b: GeneratedBlock): Record<string, any> => b.values ?? {};
