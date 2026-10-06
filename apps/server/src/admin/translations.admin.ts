/**
 * translations — inspect and fill in the machine translations of published configurators.
 *
 * Translation normally runs on its own: publishing a version, or editing its published
 * details in place, queues a background job (translation/TranslationQueue.ts). A version
 * published while that could not run — no Gemini key, no Redis — has none, and nothing
 * ever queues it again. This runs the same job (translation/translateJob.ts) directly for
 * the LATEST version of each configurator: no Redis needed, and every outcome is printed.
 *
 * It writes to whatever SERVER_DATABASE_URL points at, with this machine's Gemini key.
 * --list never writes.
 *
 * Exit codes:
 *   0  listed, or every job ran (a skipped version is reported, not a failure)
 *   1  a job threw
 *   2  usage error, or --translate without a Gemini key — nothing was changed
 *
 * Usage (from apps/server):
 *   pnpm admin:translations --list [--author <handle>]
 *   pnpm admin:translations --translate [--author <handle>] [--name <script>] [--force]
 */

import '../env';

import type { ScriptData } from '@archiyou/core/src/execution/types';
import { extractTranslatableStrings } from '@archiyou/core/src/i18n/extract';
import { translationsAreStale } from '@archiyou/core/src/i18n/resolve';

import { closeDb } from '../db/client';
import { scriptStore } from '../services/ScriptStore';
import { translatorService } from '../services/Translator';
import { runTranslateJob } from '../translation/translateJob';

//// ARGS ////

function argValue(flag: string): string | undefined
{
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? '' : v;
}

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

function usage(message?: string): never
{
  if (message) console.error(`\n✗ ${message}`);
  console.error(`
Usage:
  pnpm admin:translations --list [--author <handle>]
  pnpm admin:translations --translate [--author <handle>] [--name <script>] [--force]

Works on the latest published version of each configurator. --translate skips the
ones whose translations are current, unless --force. Writes to SERVER_DATABASE_URL.
`);
  process.exit(2);
}

//// STATUS ////

type Status = 'nothing to translate' | 'none' | 'stale' | 'current';

function statusOf(script: ScriptData): Status
{
  if (Object.keys(extractTranslatableStrings(script).strings).length === 0) return 'nothing to translate';
  const translations = script.published?.translations;
  if (!translations || Object.keys(translations.locales ?? {}).length === 0) return 'none';
  return translationsAreStale(script) ? 'stale' : 'current';
}

function describe(script: ScriptData): string
{
  const strings = Object.keys(extractTranslatableStrings(script).strings).length;
  const translations = script.published?.translations;
  const locales = Object.keys(translations?.locales ?? {});
  return [
    `${script.author}/${script.name}:${script.version}`.padEnd(40),
    `${strings} strings`.padEnd(12),
    statusOf(script).padEnd(22),
    translations ? `from ${translations.sourceLocale}, ${locales.length} locales (${translations.generated?.slice(0, 10)})` : '',
  ].join(' ').trimEnd();
}

/** The latest published version of each configurator, by author then name. */
async function targets(author?: string, name?: string): Promise<Array<ScriptData>>
{
  const all = author ? await scriptStore.listPublishedByAuthor(author) : await scriptStore.listPublished();
  return all
    .filter(s => !name || s.name?.toLowerCase() === name.toLowerCase())
    .sort((a, b) => `${a.author}/${a.name}`.localeCompare(`${b.author}/${b.name}`));
}

//// MAIN ////

async function main(): Promise<number>
{
  if (hasFlag('--help') || hasFlag('-h')) usage();
  const list = hasFlag('--list');
  const translate = hasFlag('--translate');
  if (list === translate) usage('give exactly one of --list or --translate');

  const author = argValue('--author');
  const name = argValue('--name');
  if (author === '' || name === '') usage('--author and --name take a value');

  const scripts = await targets(author, name);
  if (scripts.length === 0)
  {
    console.log('\nNo published configurators match.\n');
    return 0;
  }

  if (list)
  {
    console.log(`\nLatest published versions (${scripts.length}):`);
    scripts.forEach(s => console.log(`  ${describe(s)}`));
    console.log('');
    return 0;
  }

  if (!translatorService.available()) usage('no SERVER_GEMINI_API_KEY in the environment');

  const force = hasFlag('--force');
  const todo = scripts.filter(s => statusOf(s) !== 'nothing to translate' && (force || statusOf(s) !== 'current'));
  console.log(`\nTranslating ${todo.length} of ${scripts.length} configurators${force ? ' (--force)' : ''}:`);

  // One at a time: each is several model calls, and the output should read in order.
  const failures = await todo.reduce<Promise<number>>(async (failed, script) =>
  {
    const count = await failed;
    const label = `${script.author}/${script.name}:${script.version}`;
    const started = Date.now();
    try
    {
      const result = await runTranslateJob({ author: script.author as string, versionId: script.id as string, fileId: script.fileId as string, force });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const detail = (result.status === 'skipped')
        ? result.reason
        : `${result.locales} locales from ${result.sourceLocale}${('failedLocales' in result && result.failedLocales.length) ? `, failed: ${result.failedLocales.join(', ')}` : ''}`;
      console.log(`  ${label.padEnd(40)} ${result.status.padEnd(10)} ${detail} (${seconds}s)`);
      return count;
    }
    catch (error)
    {
      console.error(`  ${label.padEnd(40)} FAILED     ${(error as Error).message}`);
      return count + 1;
    }
  }, Promise.resolve(0));

  console.log('');
  return failures > 0 ? 1 : 0;
}

const code = await main();
// Without this the pg pool keeps the process alive until its idle timeout.
await closeDb();
process.exit(code);
