/**
 * components — a component script of the library as a file, to publish its variants to the
 * product sheet from where the Google key is.
 *
 * A component's variants (its presets: hsbwand, hsbwand_esb, ...) become rows of the sheet's
 * componenten tab with the CLI: `archiyou blocks <script.json> --makedb <snapshot> --write`.
 * The server keeps no Google key (plans/PROTECTED_CONTENT.md §12.4), so it only hands out the
 * script: its code, params and presets, and which version it is, so every row in the sheet says
 * what made it (bron: 'archiyou/timberwall@0.31', bron-id: the version's id).
 *
 * Exit codes:
 *   0  written, or the listing printed
 *   1  no such script or version
 *   2  usage error
 *
 * Usage (from apps/server):
 *   pnpm admin:components versions archiyou/timberwall
 *   pnpm admin:components export archiyou/timberwall[:0.31] [--out <dir>]
 *     without a version: the latest saved one (its bron then says it has none, with its date)
 */

import '../env';

import fs from 'node:fs';
import path from 'node:path';

import { scriptStore } from '../services/ScriptStore';

const args = process.argv.slice(2);
const [command, ref] = args;
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : '.';

const USAGE = 'usage: pnpm admin:components versions <author>/<name> | export <author>/<name>[:<version>] [--out <dir>]';
const match = ref?.match(/^@?([^/\s]+)\/([^:\s]+)(?::(.+))?$/);
if (!['versions', 'export'].includes(command ?? '') || !match || (outAt >= 0 && !out))
{
  console.error(USAGE);
  process.exit(2);
}
const [, author, name, version] = match as unknown as [string, string, string, string | undefined];

const fileId = await scriptStore.resolveFileIdByName(author, name);
if (!fileId)
{
  console.error(`no script ${author}/${name}`);
  process.exit(1);
}
const versions = await scriptStore.listVersions(author, fileId); // newest first

if (command === 'versions')
{
  versions.forEach(v => console.log(`${(v.version ?? '-').padEnd(10)} ${new Date(v.updated).toISOString().slice(0, 16).replace('T', ' ')}  ${String(v.lines).padStart(5)} lines  ${v.id}`));
  process.exit(0);
}

const chosen = version ? versions.find(v => v.version === version) : versions[0];
if (!chosen)
{
  console.error(`${author}/${name} has no version ${version}; it has: ${[...new Set(versions.map(v => v.version).filter(Boolean))].join(', ') || 'none'}`);
  process.exit(1);
}
const data = await scriptStore.getVersion(author, fileId, chosen.id);
const day = new Date(chosen.updated).toISOString().slice(0, 10);
const bron = `${author}/${name}@${chosen.version ?? `zonder versie, ${day}`}`;
const file = path.join(out, `${name}@${chosen.version ?? day}.json`);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(file, JSON.stringify({ ...data, source: { bron, id: chosen.id } }, null, 1));
console.log(`written ${file} (${bron})`);
process.exit(0);
