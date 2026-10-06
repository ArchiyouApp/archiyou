/**
 * translateJob.ts — translate one published version's copy, in the background.
 *
 * Invisible to the author by design: publishing is the only action they take, and the
 * translations appear on the configurator some seconds later. Every step below is a
 * silent no-op on failure, because the alternative to a translated configurator is an
 * untranslated one — which works fine in the language it was written in.
 *
 * "Silent" means the AUTHOR is never bothered. Every bail-out still logs at warn level
 * with the version id and a reason, or this would be undiagnosable in production.
 */

import { extractTranslatableStrings } from '@archiyou/core/src/i18n/extract';
import { baseLocale } from '@archiyou/core/src/i18n/locales';

import { scriptStore } from '../services/ScriptStore';
import { translatorService } from '../services/Translator';

export interface TranslateJobData {
  author: string;
  versionId: string;
  fileId: string;
  /** Explicit source language, skipping detection. Unused in v1 — it exists so a
   *  "regenerate with this language" affordance needs no service changes. */
  sourceLocale?: string;
  /** Ignore the reuse-by-hash shortcut and translate afresh. */
  force?: boolean;
}

export type TranslateJobResult =
  | { status: 'translated'; locales: number; sourceLocale: string; failedLocales: string[] }
  | { status: 'reused'; locales: number; sourceLocale: string }
  | { status: 'skipped'; reason: string };

function skip(versionId: string, reason: string): TranslateJobResult {
  console.warn(`Translation skipped for version ${versionId}: ${reason}`);
  return { status: 'skipped', reason };
}

export async function runTranslateJob(data: TranslateJobData): Promise<TranslateJobResult> {
  const { author, versionId, fileId, force } = data;

  // 1. The version may have been deleted or un-published since the job was queued.
  const script = await scriptStore.findVersionById(author, versionId);
  if (!script) return skip(versionId, 'version no longer exists');
  if (!script.published) return skip(versionId, 'version is no longer published');

  // 2. What is there to translate?
  const { strings, sourceHash } = extractTranslatableStrings(script);
  if (Object.keys(strings).length === 0) return skip(versionId, 'no translatable strings');

  // 3. Have we already paid for exactly this text? Reuse costs zero model calls, which
  //    is what makes a version bump with unchanged copy free.
  if (!force) {
    const existing = await scriptStore.findTranslationsByHash(author, fileId, sourceHash, data.sourceLocale);
    if (existing) {
      const written = await writeTranslations(author, versionId, sourceHash, existing);
      return written
        ? { status: 'reused', locales: Object.keys(existing.locales).length, sourceLocale: existing.sourceLocale }
        : skip(versionId, 'source changed before reused translations could be stored');
    }
  }

  // 4. No API key configured ⇒ the feature is off, not broken.
  if (!translatorService.available()) return skip(versionId, 'no Gemini API key configured');

  // 5. Detect the author's language, then translate into everything else. Detection is
  //    never skipped on an assumption: a Dutch-authored configurator treated as English
  //    yields garbage in all ten targets.
  const sourceLocale = baseLocale(data.sourceLocale)
    || (await translatorService.detectSourceLocale(strings)).locale;

  const result = await translatorService.translate({
    strings,
    sourceLocale,
    context: {
      title: strings.title,
      description: strings.description,
      units: script.units,
    },
  });

  const localeCount = Object.keys(result.locales).length;
  if (localeCount === 0) return skip(versionId, 'translator produced no locales');

  // 6. Write back — but re-read first. The author may have edited this configurator's
  //    metadata during the seconds this job ran, and blind-writing a stale `published`
  //    object would silently revert their edit. If the copy moved on, drop the result:
  //    that edit already queued a newer job.
  const stored = await writeTranslations(author, versionId, sourceHash, {
    sourceLocale,
    sourceHash,
    generated: new Date().toISOString(),
    model: result.model,
    locales: result.locales,
  });
  if (!stored) return skip(versionId, 'source changed while translating — newer job will supersede');

  return { status: 'translated', locales: localeCount, sourceLocale, failedLocales: result.failedLocales };
}

/**
 * Merge translations onto the version's CURRENT published metadata.
 *
 * Returns false when the source strings no longer hash to `expectedHash`, i.e. the copy
 * changed under us and this result is about text that no longer exists.
 */
async function writeTranslations(
  author: string,
  versionId: string,
  expectedHash: string,
  translations: NonNullable<NonNullable<Awaited<ReturnType<typeof scriptStore.findVersionById>>>['published']>['translations'],
): Promise<boolean> {
  const fresh = await scriptStore.findVersionById(author, versionId);
  if (!fresh?.published) return false;
  if (extractTranslatableStrings(fresh).sourceHash !== expectedHash) return false;

  await scriptStore.updatePublishedVersion(author, versionId, { ...fresh.published, translations });
  return true;
}
