/**
 * i18n/locales.ts — the locale vocabulary, shared by chrome i18n and content i18n.
 *
 * Two different mechanisms use these codes and they must not drift apart:
 *   - CHROME strings (buttons, menus) via @lit/localize — see apps/editor/src/i18n/.
 *   - CONTENT strings (a published configurator's own title, param labels, presets…)
 *     which are machine-translated at publish time and stored on the script itself.
 *
 * Flat base codes with no regional subtag, so they line up with what a browser reports
 * once `navigator.language` is split on '-' (nl-BE and nl-NL both resolve to 'nl').
 */

import { Type, type TLiteral } from 'typebox'

/**
 * Fallback source language, used ONLY when detection could not reach a confident
 * answer (see the server's Translator).
 *
 * This is emphatically NOT "the" source language. Authors write their param labels and
 * descriptions in whatever language they think in, so a script's real source locale is
 * detected per script and stored on `ScriptPublished.translations.sourceLocale`. Any
 * code that hardcodes 'en' as the source is a bug.
 */
export const DEFAULT_SOURCE_LOCALE = 'en'

/**
 * The locales a published configurator is translated into.
 *
 * Ten of the world's most spoken languages, plus 'nl' — the existing chrome target
 * locale and home market — which displaces Bengali/Urdu from a pure speaker-count list.
 *
 * `en` is a member rather than a privileged source: for a Dutch-authored configurator
 * English is a TARGET like any other. The effective target set for a given script is
 * this list minus its detected source locale, so nothing is ever "translated" into the
 * language it was already written in.
 */
export const TRANSLATION_LOCALES = [
    'en', 'zh', 'es', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru', 'nl',
] as const

export type TranslationLocale = typeof TRANSLATION_LOCALES[number]

/** Native names — shown in the configurator's language picker, where an end-user
 *  looking for their own language expects to see it written in that language. */
export const LOCALE_LABELS: Record<string, string> = {
    en: 'English',
    zh: '中文',
    es: 'Español',
    hi: 'हिन्दी',
    ar: 'العربية',
    pt: 'Português',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
    ru: 'Русский',
    nl: 'Nederlands',
}

/** Locales written right-to-left, so a configurator can flip its layout direction. */
export const RTL_LOCALES = new Set<string>(['ar'])

/**
 * Reduce any BCP-47 tag to the flat base code used throughout: 'pt-BR' → 'pt'.
 * Returns '' for anything unusable, so callers can test with a simple falsy check.
 */
export function baseLocale(locale: string | null | undefined): string
{
    if (typeof locale !== 'string') return ''
    const base = locale.trim().toLowerCase().split(/[-_]/)[0]
    return /^[a-z]{2,3}$/.test(base) ? base : ''
}

/** Human-readable name for a locale, falling back to the code itself — a script may
 *  legitimately be authored in a language outside TRANSLATION_LOCALES. */
export function localeLabel(locale: string): string
{
    return LOCALE_LABELS[baseLocale(locale)] ?? locale
}

export function isRTL(locale: string): boolean
{
    return RTL_LOCALES.has(baseLocale(locale))
}

/** The locales to translate a given source into: everything except the source itself. */
export function targetLocalesFor(sourceLocale: string): Array<string>
{
    const source = baseLocale(sourceLocale)
    return TRANSLATION_LOCALES.filter((l) => l !== source)
}

/**
 * Pick the best locale for a reader, choosing ONLY from what is actually available.
 *
 * `preferences` is the reader's wish list in descending priority (a stored choice, then
 * `navigator.languages`); `available` is what the script can actually render. Anything
 * not on offer is skipped rather than selected-and-silently-fallen-back.
 *
 * The final fallback is `available[0]` — by convention the script's own SOURCE language.
 * That is the point: a reader with no match on a Dutch-authored configurator gets Dutch,
 * the author's own words, not English.
 */
export function pickPreferredLocale(
    available: ReadonlyArray<string>,
    preferences: ReadonlyArray<string | null | undefined>,
): string
{
    if (available.length === 0) return DEFAULT_SOURCE_LOCALE
    for (const preference of preferences)
    {
        const base = baseLocale(preference)
        if (base && available.includes(base)) return base
    }
    return available[0]
}

//// SCHEMA HELPERS ////

/** See the identical helper in ScriptSchema.ts: `Type.Union` over a mapped array widens
 *  to TLiteral[] rather than a tuple, and Static<> over that resolves to `never`. */
type LiteralTuple<T extends readonly string[]> = { -readonly [K in keyof T]: TLiteral<T[K] & string> }

/** For places that genuinely want to constrain to a supported target locale.
 *  NOTE: deliberately NOT used for the stored `translations.locales` keys — see the
 *  comment on ScriptTranslationsSchema in ScriptSchema.ts. */
export const TranslationLocaleSchema = Type.Union(
    TRANSLATION_LOCALES.map((l) => Type.Literal(l)) as LiteralTuple<typeof TRANSLATION_LOCALES>,
)
