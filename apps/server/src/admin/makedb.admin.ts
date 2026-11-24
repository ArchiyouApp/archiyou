/**
 * makedb — the snapshots of the product sheet this server keeps for make.db().
 *
 * A snapshot is made from the sheet with the CLI, where the Google key is
 * (`archiyou makedb --sheet <url>`), and handed to the server here. It is checked
 * with core's schema first: a snapshot with errors is refused and nothing changes.
 * See services/MakeDbStore.ts.
 *
 * Exit codes:
 *   0  added, or the listing printed
 *   1  refused: not usable, or the version is kept already
 *   2  usage error
 *
 * Usage (from apps/server):
 *   pnpm admin:makedb list
 *   pnpm admin:makedb add <makedb-2026-11-24.1.json> [--replace]
 */

import '../env';

import fs from 'node:fs';

import { MakeDbStore } from '../services/MakeDbStore';
import { config } from '../config';

const [command, file] = process.argv.slice(2);
const store = new MakeDbStore();

if (command === 'list')
{
  const versions = store.versions();
  console.log(versions.length ? versions.map(v => `${v}${v === versions.at(-1) ? '  (latest)' : ''}`).join('\n') : `none in ${config.makedb.path}`);
  process.exit(0);
}

if (command === 'add' && file)
{
  if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(2); }
  try
  {
    const { version, warnings } = store.add(fs.readFileSync(file), { replace: process.argv.includes('--replace') });
    console.log(`added make-db ${version}${warnings ? ` (${warnings} warning(s): see archiyou makedb)` : ''}; latest is ${store.latest()}`);
    process.exit(0);
  }
  catch (e)
  {
    console.error((e as Error).message);
    process.exit(1);
  }
}

console.error('usage: pnpm admin:makedb list | add <file.json> [--replace]');
process.exit(2);
