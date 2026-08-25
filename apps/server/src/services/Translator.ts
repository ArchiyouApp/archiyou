/**
 * Translator.ts — Gemini-backed translation of a configurator's end-user-facing copy.
 *
 * Two operations, both structured-output calls:
 *   detectSourceLocale()  what language did the author actually WRITE in?
 *   translate()           that copy, rendered into every other supported locale
 *
 * Detection is not optional and its result is not assumed. Authors write param labels
 * and descriptions in their own language, and treating a Dutch-authored configurator as
 * English produces garbage in all ten targets AND overwrites the `nl` slot with Dutch
 * re-translated into Dutch. So the source is detected first, then excluded from the
 * targets, then stated explicitly in the translation prompt.
 *
 * Structured output (`responseSchema`) rather than prompt-and-parse: the schema is built
 * per request from the exact key set, which makes the response shape non-negotiable and
 * removes the ```json-fence stripping that DbBuilder.ts has to do.
 *
 * Nothing here throws for operational reasons — a missing API key, a refused batch, a
 * timeout all degrade to "fewer or no translations". The caller is a background job
 * whose failure must be invisible to the author.
 */

import { GoogleGenAI, Type as GenAIType } from '@google/genai';

import {
  DEFAULT_SOURCE_LOCALE, baseLocale, localeLabel, targetLocalesFor,
} from '@archiyou/core/src/i18n/locales';

import { config } from '../config';

//// TYPES ////

export interface DetectResult {
  /** Base locale code ('nl'), possibly outside TRANSLATION_LOCALES — that is fine. */
  locale: string;
  confidence: 'high' | 'low';
}

export interface TranslateInput {
  strings: Record<string, string>;
  sourceLocale: string;
  /** Defaults to every supported locale except the source. */
  locales?: ReadonlyArray<string>;
  /** Disambiguating context: what IS this configurator? */
  context?: { title?: string; description?: string; units?: string };
}

export interface TranslateOutput {
  locales: Record<string, Record<string, string>>;
  model: string;
  /** Locales that could not be produced. Not an error — the rest still ship. */
  failedLocales: string[];
}

//// TUNING ////

/** Split the work when locales × keys exceeds this. Keeps each response comfortably
 *  inside the output-token limit and bounds the blast radius of one bad response. */
const MAX_CELLS = 600;
/** Max keys per call once split. Stable ordering, so batches are reproducible. */
const MAX_KEYS_PER_CALL = 120;
/** Concurrent calls. Modest on purpose — this is a background job, not a request. */
const CONCURRENCY = 3;
/** Retries per batch on a transient (429/5xx) failure. */
const MAX_RETRIES = 1;

/** Strings with the most linguistic signal go to the detector. Single-word labels
 *  ("Width", "Radius") are near-identical across several European languages; prose is
 *  where the language is actually visible. */
const DETECT_SAMPLE_KEYS = ['description', 'details', 'title'];
const DETECT_EXTRA_STRINGS = 15;
const DETECT_MIN_CHARS = 40;

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = String((error as Error)?.message ?? '');
  return status === 429 || (typeof status === 'number' && status >= 500)
    || /429|rate limit|timeout|unavailable|internal/i.test(message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `tasks` with a bounded number in flight. Never rejects — a failed task yields null. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(tasks.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      try { results[i] = await tasks[i](); }
      catch { results[i] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

export class TranslatorService {
  private client: GoogleGenAI | null = null;

  /** False when no API key is configured — the feature is simply off, not broken. */
  available(): boolean {
    return config.gemini.apiKey.length > 0;
  }

  private gemini(): GoogleGenAI {
    if (!this.client) this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    return this.client;
  }

  /**
   * Which language did the author write in?
   *
   * Cheap (~200 tokens) and run before the fan-out, because the answer determines which
   * locales are even requested. `confidence: 'low'` means "there was not enough prose to
   * tell" and resolves to the default rather than to a guess.
   */
  async detectSourceLocale(strings: Record<string, string>): Promise<DetectResult> {
    if (!this.available()) return { locale: DEFAULT_SOURCE_LOCALE, confidence: 'low' };

    const sample = this.detectionSample(strings);
    if (sample.join(' ').length < DETECT_MIN_CHARS) {
      // Nothing but terse labels — any answer would be a coin flip dressed as a fact.
      return { locale: DEFAULT_SOURCE_LOCALE, confidence: 'low' };
    }

    try {
      const response = await this.gemini().models.generateContent({
        model: config.gemini.model,
        contents:
          'Identify the language these user-interface strings are written in. '
          + 'They come from a 3D product configurator (parameter labels and descriptions).\n\n'
          + sample.map((s) => `- ${s}`).join('\n'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: GenAIType.OBJECT,
            properties: {
              locale: { type: GenAIType.STRING, description: 'ISO 639-1 code, e.g. "nl", "de", "ja"' },
              confidence: { type: GenAIType.STRING, enum: ['high', 'low'] },
            },
            required: ['locale', 'confidence'],
          },
          temperature: 0,
        },
      });

      const parsed = JSON.parse(response.text ?? '{}') as Partial<DetectResult>;
      const locale = baseLocale(parsed.locale);
      if (!locale) return { locale: DEFAULT_SOURCE_LOCALE, confidence: 'low' };
      return { locale, confidence: parsed.confidence === 'high' ? 'high' : 'low' };
    } catch (error) {
      console.warn('Translator: language detection failed:', (error as Error).message);
      return { locale: DEFAULT_SOURCE_LOCALE, confidence: 'low' };
    }
  }

  /** Highest-signal strings for detection: prose first, then the longest remaining. */
  private detectionSample(strings: Record<string, string>): string[] {
    const sample: string[] = [];
    for (const key of DETECT_SAMPLE_KEYS) {
      if (strings[key]) sample.push(strings[key]);
    }
    const rest = Object.entries(strings)
      .filter(([key]) => !DETECT_SAMPLE_KEYS.includes(key))
      .map(([, value]) => value)
      .sort((a, b) => b.length - a.length)
      .slice(0, DETECT_EXTRA_STRINGS);
    return [...sample, ...rest];
  }

  /**
   * Translate `strings` into every target locale.
   *
   * Splits by LOCALE first when the work is large: locales are independent, so a batch
   * that fails costs one language rather than the whole run.
   */
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const model = config.gemini.model;
    const empty: TranslateOutput = { locales: {}, model, failedLocales: [] };
    if (!this.available()) return empty;

    const sourceLocale = baseLocale(input.sourceLocale) || DEFAULT_SOURCE_LOCALE;
    const targets = (input.locales ?? targetLocalesFor(sourceLocale))
      .map(baseLocale)
      .filter((l) => l && l !== sourceLocale);

    const keys = Object.keys(input.strings).sort();
    if (keys.length === 0 || targets.length === 0) return empty;
    if (keys.length > config.gemini.maxKeys) {
      console.warn(`Translator: ${keys.length} strings exceeds maxKeys (${config.gemini.maxKeys}); skipping.`);
      return empty;
    }

    // One call per (locale, key-chunk). Chunking only kicks in for large scripts.
    const chunkSize = keys.length * targets.length > MAX_CELLS
      ? Math.min(MAX_KEYS_PER_CALL, keys.length)
      : keys.length;

    const batches: Array<{ locale: string; keys: string[] }> = [];
    for (const locale of targets) {
      for (let i = 0; i < keys.length; i += chunkSize) {
        batches.push({ locale, keys: keys.slice(i, i + chunkSize) });
      }
    }

    const results = await pooled(
      batches.map((batch) => () => this.translateBatch(input, sourceLocale, batch.locale, batch.keys)),
      CONCURRENCY,
    );

    const locales: Record<string, Record<string, string>> = {};
    const failed = new Set<string>();
    results.forEach((result, i) => {
      const { locale } = batches[i];
      if (!result) { failed.add(locale); return; }
      locales[locale] = { ...(locales[locale] ?? {}), ...result };
    });

    // A locale that produced nothing at all is a failure, not an empty translation.
    for (const locale of Object.keys(locales)) {
      if (Object.keys(locales[locale]).length === 0) { delete locales[locale]; failed.add(locale); }
    }

    return { locales, model, failedLocales: [...failed] };
  }

  private async translateBatch(
    input: TranslateInput,
    sourceLocale: string,
    targetLocale: string,
    keys: string[],
  ): Promise<Record<string, string> | null> {
    const subset: Record<string, string> = {};
    for (const key of keys) subset[key] = input.strings[key];

    // The schema names every key explicitly, so "return all of them, renamed none" is
    // enforced by the API rather than requested in prose.
    const properties: Record<string, { type: typeof GenAIType.STRING }> = {};
    for (const key of keys) properties[key] = { type: GenAIType.STRING };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.gemini().models.generateContent({
          model: config.gemini.model,
          contents: this.userPrompt(subset, sourceLocale, targetLocale, input.context),
          config: {
            systemInstruction: this.systemPrompt(sourceLocale, targetLocale),
            responseMimeType: 'application/json',
            responseSchema: { type: GenAIType.OBJECT, properties, required: keys },
            temperature: 0.2,
          },
        });
        return this.validate(JSON.parse(response.text ?? '{}'), subset);
      } catch (error) {
        if (attempt < MAX_RETRIES && isRetryable(error)) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        console.warn(`Translator: batch ${targetLocale} failed:`, (error as Error).message);
        return null;
      }
    }
    return null;
  }

  /** Keep only well-formed translations of keys we actually asked about. */
  private validate(raw: unknown, subset: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!(key in subset)) continue;               // never invent keys
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      // NOT filtered: values identical to the source. "Modern" is legitimately "Modern"
      // in Dutch and German, and dropping those would leave real gaps.
      out[key] = trimmed;
    }
    return out;
  }

  private systemPrompt(sourceLocale: string, targetLocale: string): string {
    return [
      `You translate user-interface copy for a 3D product configurator from ${localeLabel(sourceLocale)} into ${localeLabel(targetLocale)}.`,
      '',
      'Rules, all mandatory:',
      '1. Return every key you were given, with the same key names. Keys are opaque identifiers — translate only the VALUES, never a key.',
      '2. Keys ending in ".label", or starting with "groups." or "presets.", are short UI captions. Keep them terse: at most ~1.3x the source length, and prefer the shortest natural term. Use the caption style conventional for the target language (capitalised nouns in German, no article in French, noun form in Japanese, no terminal punctuation in Chinese).',
      '3. Keys ending in ".description", plus "details", are prose. Translate as full, natural sentences.',
      '4. Keys under "fulfillments." are product deliverables: ".name" is a short noun phrase, ".description" is one or two sentences.',
      '5. Keys containing ".options." are the choices of one dropdown. Within a locale they must stay clearly distinct from one another.',
      '6. Never translate: unit symbols (mm, cm, m, in, ft, °, %, kg), numbers or number formats, ALL-CAPS identifiers, text in backticks, brand and product names, file extensions, licence identifiers, URLs.',
      '7. Preserve leading and trailing whitespace, punctuation style, capitalisation style, and any {placeholder} token exactly as given.',
      '8. If a value is an identifier, a number, or otherwise has no meaning to translate, return it unchanged.',
      '',
      'Output JSON only, matching the provided schema.',
    ].join('\n');
  }

  private userPrompt(
    subset: Record<string, string>,
    sourceLocale: string,
    targetLocale: string,
    context?: TranslateInput['context'],
  ): string {
    // Context is cheap and disambiguates domain terms — "Depth" means something
    // different in a furniture configurator than in a drilling one.
    const lines: string[] = [];
    if (context?.title || context?.description) {
      lines.push('This configurator is:');
      if (context.title) lines.push(`  Title: ${context.title}`);
      if (context.description) lines.push(`  About: ${context.description}`);
      if (context.units) lines.push(`  Units: ${context.units}`);
      lines.push('');
    }
    lines.push(`Translate these ${localeLabel(sourceLocale)} strings into ${localeLabel(targetLocale)}:`);
    lines.push(JSON.stringify(subset, null, 2));
    return lines.join('\n');
  }
}

export const translatorService = new TranslatorService();
