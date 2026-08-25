/**
 * state/locale.ts — the end-user's display language for a configurator.
 *
 * Mirrors state/units.ts: a signal for the explicit override, a computed that falls back,
 * and setters. Same script-level-vs-viewer-level split, for the same reason — the script
 * carries what the AUTHOR wrote, the viewer picks how THEY want to read it.
 *
 * This is CONTENT localization (the configurator's own title, param labels, presets),
 * which is data stored on the script and generated at publish time. It is a different
 * mechanism from the app chrome's @lit/localize strings — but both draw their locale
 * vocabulary from the one list in @archiyou/core/src/i18n/locales.
 *
 * The rule that runs through all of it: the source language is whatever the author wrote
 * in, NOT English. A Dutch-authored configurator shows Dutch to a Dutch visitor from its
 * own source strings, and English is one of its translations.
 */

import { signal, computed } from '@lit-labs/signals';

import {
  baseLocale, localeLabel, isRTL, pickPreferredLocale,
} from '@archiyou/core/src/i18n/locales';
import {
  makeTranslator, availableLocales as localesFor, scriptSourceLocale,
  identityTranslator, type TranslatorFn,
} from '@archiyou/core/src/i18n/resolve';

import { editorScript } from './core';

export type { TranslatorFn };
export { localeLabel, isRTL, identityTranslator };

/** Remembers the viewer's choice across configurators. Not per script: someone who
 *  reads German wants German everywhere, not to re-pick on every page. */
const STORAGE_KEY = 'ay.locale';

/** Explicit choice (picker or ?lang=). Null ⇒ derive from the browser. */
const _configuratorLocale = signal<string | null>(null);

//// DERIVED ////

/** The language the active script was authored in. */
export const scriptLocale = computed<string>(() => scriptSourceLocale(editorScript.get()?.toData()));

/** Locales this configurator can actually be shown in: its source first, then every
 *  translation it carries. The picker offers exactly these — never a language that
 *  would silently fall back to the original. */
export const availableLocales = computed<string[]>(() => localesFor(editorScript.get()?.toData()));

/** The locale in force. */
export const configuratorLocale = computed<string>(() =>
{
  const available = availableLocales.get();
  const explicit = baseLocale(_configuratorLocale.get());
  if (explicit && available.includes(explicit)) return explicit;
  return detectPreferredLocale(available);
});

/** The translator components call as `t(key, sourceString)`. Identity when the viewer is
 *  reading the language the script was written in, which is what structurally guarantees
 *  the editor's authoring views never show translated text. */
export const translate = computed<TranslatorFn>(() =>
  makeTranslator(editorScript.get()?.toData(), configuratorLocale.get()));

/** True when the active locale is written right-to-left. */
export const configuratorRTL = computed<boolean>(() => isRTL(configuratorLocale.get()));

//// ACTIONS ////

export function setConfiguratorLocale(locale: string): void
{
  const next = baseLocale(locale);
  if (!next) return;
  _configuratorLocale.set(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode — not worth failing over */ }
}

/** Apply a `?lang=de` override from the URL. Highest precedence: a shared link should
 *  open in the language it was shared in, whatever the recipient's browser says. */
export function applyLocaleFromQuery(search: string): void
{
  const lang = new URLSearchParams(search).get('lang');
  if (lang) setConfiguratorLocale(lang);
}

//// DETECTION ////

/**
 * Best locale for this viewer, chosen ONLY from what the script actually offers.
 *
 * Order: stored choice → the browser's language list, most-preferred first → the
 * script's own source language. That last fallback is the point: for a Dutch-authored
 * configurator a viewer with no match sees Dutch, not English.
 */
export function detectPreferredLocale(available: string[]): string
{
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); }
  catch { /* private mode — fall through to the browser's preference */ }

  const browser = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
  // The precedence rule itself lives in core (and is tested there); this function only
  // gathers the platform inputs.
  return pickPreferredLocale(available, [stored, ...browser]);
}
