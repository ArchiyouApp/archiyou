/**
 * tests/unit/translation.test.ts — the Gemini translator and the background job.
 *
 * The properties that matter, in order:
 *
 *   1. PUBLISHING CAN NEVER FAIL because of translation. No API key, no Redis, a
 *      throwing translator — the publish still returns 201 and the row is intact.
 *   2. NOTHING HARDCODES ENGLISH as the source. A Dutch-authored configurator must be
 *      detected as Dutch, translated into the other ten locales, and must NOT be
 *      "translated" into Dutch.
 *   3. The job never clobbers an author's concurrent edit, and never re-pays for copy
 *      it has already translated.
 *
 * Gemini is mocked throughout — no network, no key, no cost.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import type { ScriptData } from '@archiyou/core/src/execution/types';

//// Gemini mock ////

/** Queue of canned responses; each generateContent() call shifts one off. */
let responses: Array<unknown> = [];
const generateContent = vi.fn(async (req: unknown) => {
  calls.push(req as GenerateArgs);
  const next = responses.shift();
  if (next instanceof Error) throw next;
  return { text: JSON.stringify(next ?? {}) };
});

interface GenerateArgs {
  model: string;
  contents: string;
  config?: { responseSchema?: { properties?: Record<string, unknown>; required?: string[] } };
}
let calls: GenerateArgs[] = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; },
  Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
}));

let store: typeof import('../../src/services/ScriptStore').scriptStore;
let translator: typeof import('../../src/services/Translator').translatorService;
let runTranslateJob: typeof import('../../src/translation/translateJob').runTranslateJob;
let config: typeof import('../../src/config').config;
let extractTranslatableStrings: typeof import('@archiyou/core/src/i18n/extract').extractTranslatableStrings;

const AUTHOR = 'translator-tester';

beforeAll(async () => {
  // A fresh, empty PGlite database in this process — Postgres, same schema and
  // migrations as the server, nothing to install. Set explicitly (never left to a
  // developer's .env) so the suite can never reach a shared database.
  process.env.SERVER_DATABASE_URL = 'memory://';
  process.env.SERVER_THUMBNAIL_PATH = mkdtempSync(join(tmpdir(), 'ay-translate-thumbs-'));

  const { runMigrations } = await import('../../src/db/migrate');
  await runMigrations();
  store = (await import('../../src/services/ScriptStore')).scriptStore;
  translator = (await import('../../src/services/Translator')).translatorService;
  runTranslateJob = (await import('../../src/translation/translateJob')).runTranslateJob;
  config = (await import('../../src/config')).config;
  extractTranslatableStrings = (await import('@archiyou/core/src/i18n/extract')).extractTranslatableStrings;
});

beforeEach(async () => {
  responses = [];
  calls = [];
  generateContent.mockClear();
  config.gemini.apiKey = 'test-key';
});

/** A published version with Dutch copy. Returns its ids. */
async function publishDutch(name: string, version = '1.0.0') {
  const fileId = (await store.create(AUTHOR, {
    name, code: 'const a = 1;',
  } as Record<string, unknown>)).fileId as string;

  const stored = await store.publish(AUTHOR, fileId, {
    name,
    code: 'const a = 1;',
    version,
    description: 'Een verstelbare boekenkast van berkenmultiplex voor in de woonkamer.',
    params: {
      BREEDTE: { type: 'number', schema: {}, label: 'Breedte', description: 'Hoe breed de kast wordt' },
    },
    published: { public: true, title: 'Boekenkast' },
  } as Record<string, unknown>);

  return { fileId, versionId: stored.id as string };
}

describe('TranslatorService — detection', () => {
  it('detects the language the author actually wrote in', async () => {
    responses = [{ locale: 'nl', confidence: 'high' }];
    const result = await translator.detectSourceLocale({
      description: 'Een verstelbare boekenkast van berkenmultiplex voor in de woonkamer.',
      'params.BREEDTE.label': 'Breedte',
    });
    expect(result).toEqual({ locale: 'nl', confidence: 'high' });
  });

  it('normalises a regional tag to its base code', async () => {
    responses = [{ locale: 'nl-BE', confidence: 'high' }];
    const result = await translator.detectSourceLocale({
      description: 'Een verstelbare boekenkast van berkenmultiplex voor in de woonkamer.',
    });
    expect(result.locale).toBe('nl');
  });

  it('does not guess when there is no prose to go on', async () => {
    // Single-word labels are near-identical across European languages. Better to fall
    // back than to assert a language from a coin flip.
    const result = await translator.detectSourceLocale({ 'params.W.label': 'Width' });
    expect(result).toEqual({ locale: 'en', confidence: 'low' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back rather than throwing when the model errors', async () => {
    responses = [new Error('boom')];
    const result = await translator.detectSourceLocale({
      description: 'Een verstelbare boekenkast van berkenmultiplex voor in de woonkamer.',
    });
    expect(result.confidence).toBe('low');
  });
});

describe('TranslatorService — translation', () => {
  it('requests every locale EXCEPT the source, and pins the response shape', async () => {
    const strings = { title: 'Boekenkast', 'params.BREEDTE.label': 'Breedte' };
    responses = Array.from({ length: 10 }, () => ({
      title: 'X', 'params.BREEDTE.label': 'Y',
    }));

    const result = await translator.translate({ strings, sourceLocale: 'nl' });

    // 11 supported locales minus the Dutch source = 10 targets. Dutch is never a target.
    expect(Object.keys(result.locales).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'pt', 'ru', 'zh'],
    );
    expect(result.locales.nl).toBeUndefined();

    // The schema names every key and requires all of them, so "same keys, renamed none"
    // is enforced by the API rather than asked for in prose.
    const schema = calls[0].config?.responseSchema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(Object.keys(strings).sort());
    expect(schema?.required?.sort()).toEqual(Object.keys(strings).sort());
  });

  it('drops keys it was not asked about and keeps source-identical values', async () => {
    responses = Array.from({ length: 10 }, () => ({
      title: 'Modern',          // legitimately identical in several languages — must be kept
      injected: 'nope',         // never asked for — must be dropped
      empty: '',
    }));
    const result = await translator.translate({
      strings: { title: 'Modern', empty: 'x' }, sourceLocale: 'nl',
    });
    expect(result.locales.de.title).toBe('Modern');
    expect(result.locales.de.injected).toBeUndefined();
    expect(result.locales.de.empty).toBeUndefined();
  });

  it('loses only the failing locale when one batch errors', async () => {
    responses = [new Error('rate limited'), new Error('rate limited'),
      ...Array.from({ length: 9 }, () => ({ title: 'ok' }))];
    const result = await translator.translate({ strings: { title: 'Boekenkast' }, sourceLocale: 'nl' });

    expect(result.failedLocales.length).toBe(1);
    expect(Object.keys(result.locales).length).toBe(9);
  });

  it('does nothing at all without an API key', async () => {
    config.gemini.apiKey = '';
    const result = await translator.translate({ strings: { title: 'x' }, sourceLocale: 'nl' });
    expect(result.locales).toEqual({});
    expect(generateContent).not.toHaveBeenCalled();
    expect(translator.available()).toBe(false);
  });

  it('refuses a script with more strings than the configured cap', async () => {
    const strings: Record<string, string> = {};
    for (let i = 0; i < config.gemini.maxKeys + 1; i++) strings[`k${i}`] = `value ${i}`;
    const result = await translator.translate({ strings, sourceLocale: 'nl' });
    expect(result.locales).toEqual({});
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('translateJob', () => {
  it('detects Dutch, translates the rest, and stores the source locale', async () => {
    const { versionId } = await publishDutch('boekenkast');
    responses = [
      { locale: 'nl', confidence: 'high' },
      ...Array.from({ length: 10 }, () => ({
        title: 'Bookshelf', description: 'An adjustable bookshelf.',
        'params.BREEDTE.label': 'Width', 'params.BREEDTE.description': 'How wide it gets',
      })),
    ];

    const result = await runTranslateJob({ author: AUTHOR, versionId, fileId: 'unused' });
    expect(result.status).toBe('translated');

    const stored = await store.findVersionById(AUTHOR, versionId);
    const translations = stored?.published?.translations;
    expect(translations?.sourceLocale).toBe('nl');
    // The authored Dutch is the source — it must never be round-tripped through a
    // translation of itself.
    expect(translations?.locales.nl).toBeUndefined();
    expect(translations?.locales.en.title).toBe('Bookshelf');
    expect(translations?.sourceHash).toBe(extractTranslatableStrings(stored!).sourceHash);
  });

  it('reuses an existing set for unchanged copy, with ZERO model calls', async () => {
    const { fileId, versionId } = await publishDutch('reuse-me');
    responses = [
      { locale: 'nl', confidence: 'high' },
      ...Array.from({ length: 10 }, () => ({ title: 'Bookshelf' })),
    ];
    await runTranslateJob({ author: AUTHOR, versionId, fileId });

    // A new version of the same file with identical copy: republishing must not re-bill.
    const next = await store.publish(AUTHOR, fileId, {
      name: 'reuse-me', code: 'const a = 2;', version: '1.1.0',
      description: 'Een verstelbare boekenkast van berkenmultiplex voor in de woonkamer.',
      params: { BREEDTE: { type: 'number', schema: {}, label: 'Breedte', description: 'Hoe breed de kast wordt' } },
      published: { public: true, title: 'Boekenkast' },
    } as Record<string, unknown>);

    generateContent.mockClear();
    const result = await runTranslateJob({ author: AUTHOR, versionId: next.id as string, fileId });

    expect(result.status).toBe('reused');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('does NOT reuse when the source language differs', async () => {
    const { fileId, versionId } = await publishDutch('lang-change');
    responses = [{ locale: 'nl', confidence: 'high' }, ...Array.from({ length: 10 }, () => ({ title: 'X' }))];
    await runTranslateJob({ author: AUTHOR, versionId, fileId });

    const script = (await store.findVersionById(AUTHOR, versionId))!;
    const { sourceHash } = extractTranslatableStrings(script);
    // Same strings, different declared source language ⇒ the old set is the wrong answer.
    expect(await store.findTranslationsByHash(AUTHOR, fileId, sourceHash, 'de')).toBeNull();
    expect(await store.findTranslationsByHash(AUTHOR, fileId, sourceHash, 'nl')).not.toBeNull();
  });

  it('discards its result when the author edited the copy while it ran', async () => {
    const { fileId, versionId } = await publishDutch('raced');

    // Detection resolves, then the author renames the configurator mid-flight.
    responses = [{ locale: 'nl', confidence: 'high' }];
    for (let i = 0; i < 10; i++) {
      responses.push({ title: 'Bookshelf', description: 'x', 'params.BREEDTE.label': 'Width', 'params.BREEDTE.description': 'y' });
    }
    generateContent.mockImplementationOnce(async (req: unknown) => {
      calls.push(req as GenerateArgs);
      const before = (await store.findVersionById(AUTHOR, versionId))!;
      await store.updatePublishedVersion(AUTHOR, versionId, { ...before.published, title: 'Kast XL' });
      const next = responses.shift();
      return { text: JSON.stringify(next ?? {}) };
    });

    const result = await runTranslateJob({ author: AUTHOR, versionId, fileId });
    expect(result.status).toBe('skipped');

    // The edit survives, and no translations describing the OLD title were written.
    const after = await store.findVersionById(AUTHOR, versionId);
    expect(after?.published?.title).toBe('Kast XL');
    expect(after?.published?.translations).toBeFalsy();
  });

  it('bails quietly when the version was un-published or deleted', async () => {
    const { fileId, versionId } = await publishDutch('gone');
    await store.unpublishVersion(AUTHOR, versionId);
    expect((await runTranslateJob({ author: AUTHOR, versionId, fileId })).status).toBe('skipped');

    expect((await runTranslateJob({ author: AUTHOR, versionId: 'no-such-id', fileId })).status).toBe('skipped');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('bails quietly with no API key, leaving the publish untouched', async () => {
    const { fileId, versionId } = await publishDutch('no-key');
    config.gemini.apiKey = '';

    const result = await runTranslateJob({ author: AUTHOR, versionId, fileId });
    expect(result.status).toBe('skipped');

    const stored = await store.findVersionById(AUTHOR, versionId);
    expect(stored?.published?.title).toBe('Boekenkast');   // publish intact
    expect(stored?.published?.translations).toBeFalsy();
  });

  it('bails quietly when the translator throws for every locale', async () => {
    const { fileId, versionId } = await publishDutch('all-fail');
    responses = [{ locale: 'nl', confidence: 'high' }, ...Array.from({ length: 30 }, () => new Error('down'))];

    const result = await runTranslateJob({ author: AUTHOR, versionId, fileId });
    expect(result.status).toBe('skipped');
    expect((await store.findVersionById(AUTHOR, versionId))?.published?.translations).toBeFalsy();
  });
});

describe('publish is never affected by translation', () => {
  it('stores a publish fully even when nothing about translation works', async () => {
    config.gemini.apiKey = '';
    const { versionId } = await publishDutch('unaffected');

    const stored = (await store.findVersionById(AUTHOR, versionId)) as ScriptData;
    expect(stored.version).toBe('1.0.0');
    expect(stored.published?.public).toBe(true);
    expect(stored.published?.title).toBe('Boekenkast');
  });
});
