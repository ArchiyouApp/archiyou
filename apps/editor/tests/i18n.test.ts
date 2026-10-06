/**
 * tests/i18n.test.ts — the app's own strings (@lit/localize) against the content locales.
 *
 * A configurator shows its buttons in the language its picker shows the content in, so
 * the two locale lists must not drift apart, and no language may lag behind the others:
 * a string translated into nine languages shows English in the tenth.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TRANSLATION_LOCALES } from '@archiyou/core/src/i18n/locales';
import { allLocales, sourceLocale, targetLocales } from '../src/i18n/locale-codes.js';
import { chromeLocaleFor } from '../src/i18n/locale-config.js';

/** Ids of the trans-units that carry a <target> in translations/<locale>.xlf. */
function translatedIds(locale: string): string[]
{
  const xlf = readFileSync(fileURLToPath(new URL(`../src/i18n/translations/${locale}.xlf`, import.meta.url)), 'utf-8');
  return [...xlf.matchAll(/<trans-unit id="([^"]+)">((?:(?!<\/trans-unit>)[\s\S])*)<\/trans-unit>/g)]
    .filter(([, , body]) => body.includes('<target>'))
    .map(([, id]) => id)
    .sort();
}

describe('chrome locales', () =>
{
  it('are the content locales', () =>
  {
    expect([...allLocales].sort()).toEqual([...TRANSLATION_LOCALES].sort());
    expect(sourceLocale).toBe('en');
  });

  it('take a content locale as is, or fall back to the source', () =>
  {
    expect(chromeLocaleFor('de')).toBe('de');
    expect(chromeLocaleFor('pt-BR')).toBe('pt');
    expect(chromeLocaleFor('it')).toBe('en');
    expect(chromeLocaleFor('')).toBe('en');
  });

  it('translate the same strings in every language', () =>
  {
    const reference = translatedIds('nl');
    expect(reference.length).toBeGreaterThan(0);
    targetLocales.forEach(locale => expect(translatedIds(locale), locale).toEqual(reference));
  });
});
