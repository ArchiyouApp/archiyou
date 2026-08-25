/**
 * i18n/resolve.ts — read translations back at render time.
 *
 * The UI never reaches into the stored translation blob directly. It builds a
 * TranslatorFn once and calls `t(key, sourceString)` per string, so:
 *   - a missing key falls back to the source string, per key, with no null checks
 *   - the SOURCE locale (whatever the author wrote in — not necessarily English)
 *     resolves to the identity function, which is what structurally guarantees the
 *     editor's authoring views can never show translated text
 */

import type { ScriptData } from '../ScriptSchema'

import { DEFAULT_SOURCE_LOCALE, baseLocale } from './locales'
import { extractTranslatableStrings } from './extract'

/** `(key, fallback) => string`. Always returns something renderable. */
export type TranslatorFn = (key: string, fallback: string) => string

/** Returns the fallback unchanged. Used for the source locale and for untranslated
 *  scripts — and exported so components can default a `t` property to it. */
export const identityTranslator: TranslatorFn = (_key, fallback) => fallback

/** The language a script was authored in (detected at publish time), or the default
 *  fallback when it has never been translated. Never assume 'en'. */
export function scriptSourceLocale(data: ScriptData | null | undefined): string
{
    return baseLocale(data?.published?.translations?.sourceLocale) || DEFAULT_SOURCE_LOCALE
}

/**
 * Locales this script can actually be displayed in: its own source language first
 * (that is the authored copy, not a machine translation), then every stored target.
 *
 * The picker must only ever offer these — a configurator with no German should not
 * present German and then silently render English.
 */
export function availableLocales(data: ScriptData | null | undefined): Array<string>
{
    const source = scriptSourceLocale(data)
    const stored = Object.keys(data?.published?.translations?.locales ?? {})
        .map(baseLocale)
        .filter((l) => l && l !== source)
    return [source, ...Array.from(new Set(stored))]
}

/**
 * Build the translator for one locale.
 *
 * Lookup order: exact locale → its base code ('pt-BR' → 'pt') → the source string.
 * It never falls through to a DIFFERENT language: showing French to someone who asked
 * for German is worse than showing them the original.
 */
export function makeTranslator(data: ScriptData | null | undefined, locale: string): TranslatorFn
{
    const translations = data?.published?.translations
    if (!translations || !translations.locales) return identityTranslator

    const source = scriptSourceLocale(data)
    const wanted = baseLocale(locale)
    // Asking for the language it was written in means the source strings ARE the answer.
    if (!wanted || wanted === source) return identityTranslator

    const table = translations.locales[locale] ?? translations.locales[wanted]
    if (!table) return identityTranslator

    return (key, fallback) =>
    {
        const value = table[key]
        return typeof value === 'string' && value.length > 0 ? value : fallback
    }
}

/**
 * True when the stored translations describe text that has since changed.
 *
 * A published configurator's metadata can be edited in place (title, description,
 * fulfillments), so without this check a script would keep serving translated copy about
 * something it no longer says. The background job re-checks this before writing, and
 * discards its result if the source moved on while it was running.
 */
export function translationsAreStale(data: ScriptData | null | undefined): boolean
{
    const translations = data?.published?.translations
    if (!translations) return false
    if (!translations.sourceHash) return true
    return extractTranslatableStrings(data as ScriptData).sourceHash !== translations.sourceHash
}
