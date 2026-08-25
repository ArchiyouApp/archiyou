/**
 * i18n — extraction, hashing and resolution.
 *
 * The load-bearing property, asserted from several angles: NOTHING may hardcode English
 * as the source language. Authors write their labels in Dutch, German, Japanese; a
 * script's source locale is detected and stored, and the resolver must honour it.
 */

import { describe, it, expect } from 'vitest'

import type { ScriptData } from '../../../src/ScriptSchema'
import { Script } from '../../../src/Script'
import { ScriptParamType, type ScriptParamData } from '../../../src/execution/types'

import { extractTranslatableStrings } from '../../../src/i18n/extract'
import { hashStrings } from '../../../src/i18n/hash'
import {
    makeTranslator, availableLocales, scriptSourceLocale, translationsAreStale,
} from '../../../src/i18n/resolve'
import {
    encodeKeySegment, paramLabelKey, presetKey, paramOptionKey, groupKey,
} from '../../../src/i18n/keys'
import {
    TRANSLATION_LOCALES, LOCALE_LABELS, targetLocalesFor, baseLocale, DEFAULT_SOURCE_LOCALE,
    pickPreferredLocale,
} from '../../../src/i18n/locales'

function script(over: Partial<ScriptData> = {}): ScriptData
{
    return {
        id: 'v1', fileId: 'f1', name: 'bookshelf', author: 'someone',
        code: 'const a = 1;', tags: [], params: {}, presets: {},
        published: null, shared: null, ...over,
    } as ScriptData
}

function param(over: Partial<ScriptParamData> & Record<string, unknown> = {}): ScriptParamData
{
    return { type: ScriptParamType.number, schema: {}, ...over } as ScriptParamData
}

describe('locales', () =>
{
    it('gives every supported locale a native label', () =>
    {
        for (const locale of TRANSLATION_LOCALES) expect(LOCALE_LABELS[locale]).toBeTruthy()
    })

    it('never asks for a translation into the source language', () =>
    {
        const targets = targetLocalesFor('nl')
        expect(targets).not.toContain('nl')
        expect(targets).toContain('en')          // English is a TARGET for a Dutch script
        expect(targets).toHaveLength(TRANSLATION_LOCALES.length - 1)
    })

    it('reduces regional tags to the base code', () =>
    {
        expect(baseLocale('pt-BR')).toBe('pt')
        expect(baseLocale('nl_BE')).toBe('nl')
        expect(baseLocale('')).toBe('')
        expect(baseLocale(undefined)).toBe('')
    })

    describe('pickPreferredLocale', () =>
    {
        // available[0] is the script's SOURCE language by convention.
        const dutchScript = ['nl', 'en', 'de']

        it('honours the reader\'s order of preference', () =>
        {
            expect(pickPreferredLocale(dutchScript, ['de', 'en'])).toBe('de')
            expect(pickPreferredLocale(dutchScript, ['en', 'de'])).toBe('en')
        })

        it('skips preferences the script cannot render', () =>
        {
            // Offering French and then silently showing Dutch would be worse than
            // never offering it — so unavailable preferences are passed over.
            expect(pickPreferredLocale(dutchScript, ['fr', 'ja', 'de'])).toBe('de')
        })

        it('matches on the base of a regional tag', () =>
        {
            expect(pickPreferredLocale(dutchScript, ['de-AT'])).toBe('de')
        })

        it('falls back to the script\'s own language, not English', () =>
        {
            // THE rule: a reader with no match on a Dutch-authored configurator gets the
            // author's own Dutch words.
            expect(pickPreferredLocale(dutchScript, ['ja', 'ko'])).toBe('nl')
            expect(pickPreferredLocale(dutchScript, [])).toBe('nl')
            expect(pickPreferredLocale(dutchScript, [null, undefined, ''])).toBe('nl')
        })

        it('degrades safely when the script offers nothing', () =>
        {
            expect(pickPreferredLocale([], ['de'])).toBe(DEFAULT_SOURCE_LOCALE)
        })
    })
})

describe('extractTranslatableStrings', () =>
{
    it('extracts what an end-user reads and nothing they do not', () =>
    {
        const { strings } = extractTranslatableStrings(script({
            description: 'A shelf', details: 'Long description here',
            params: {
                WIDTH: param({ label: 'Width', description: 'How wide', group: 'Frame', units: 'mm' }),
                STYLE: param({ type: ScriptParamType.options, schema: { enum: ['modern', 'classic'] } }),
            },
            presets: { tall: {}, wide: {} },
            published: {
                title: 'Bookshelf', description: 'A configurable shelf',
                fulfillments: [{ name: 'Model', description: 'The 3D model', exports: [], delivery: 'anonymous download' }],
            },
        } as Partial<ScriptData>))

        // published overrides win — they are what the configurator actually shows
        expect(strings.title).toBe('Bookshelf')
        expect(strings.description).toBe('A configurable shelf')
        expect(strings.details).toBe('Long description here')

        expect(strings[paramLabelKey('WIDTH')]).toBe('Width')
        expect(strings['params.WIDTH.description']).toBe('How wide')
        expect(strings[groupKey('Frame')]).toBe('Frame')
        expect(strings[paramOptionKey('STYLE', 'modern')]).toBe('modern')
        expect(strings[presetKey('tall')]).toBe('tall')
        expect(strings['fulfillments.0.name']).toBe('Model')

        // Identifiers and machine values must never be handed to a translator.
        expect(strings['params.WIDTH.name']).toBeUndefined()
        expect(strings['params.WIDTH.units']).toBeUndefined()
        expect(Object.values(strings)).not.toContain('mm')
    })

    it('falls back to the param name when no label was set', () =>
    {
        const { strings } = extractTranslatableStrings(script({ params: { DEPTH: param() } } as Partial<ScriptData>))
        // Otherwise a param that never customised its label stays untranslated forever.
        expect(strings[paramLabelKey('DEPTH')]).toBe('DEPTH')
    })

    it('skips hidden params and purely numeric or symbolic strings', () =>
    {
        const { strings } = extractTranslatableStrings(script({
            params: {
                SECRET: param({ label: 'Secret', visible: false }),
                COUNT:  param({ label: '100' }),
                RATIO:  param({ label: '±' }),
            },
        } as Partial<ScriptData>))
        expect(strings[paramLabelKey('SECRET')]).toBeUndefined()
        expect(strings[paramLabelKey('COUNT')]).toBeUndefined()
        expect(strings[paramLabelKey('RATIO')]).toBeUndefined()
    })

    it('escapes dots in free-form preset and group names', () =>
    {
        // Preset names are bare user-authored map keys and CAN contain dots; unescaped
        // they would collide with the structural separator and mis-key a translation.
        expect(encodeKeySegment('v1.2')).toBe('v1%2E2')
        expect(presetKey('v1.2')).toBe('presets.v1%2E2')
        expect(presetKey('100%')).toBe('presets.100%25')

        const { strings } = extractTranslatableStrings(script({ presets: { 'v1.2': {} } } as Partial<ScriptData>))
        expect(strings['presets.v1%2E2']).toBe('v1.2')
    })
})

describe('hashStrings', () =>
{
    it('is independent of insertion order', () =>
    {
        expect(hashStrings({ a: '1', b: '2' })).toBe(hashStrings({ b: '2', a: '1' }))
    })

    it('changes when any key or value changes', () =>
    {
        const base = hashStrings({ a: '1', b: '2' })
        expect(hashStrings({ a: '1', b: '3' })).not.toBe(base)
        expect(hashStrings({ a: '1', c: '2' })).not.toBe(base)
        expect(hashStrings({ a: '1' })).not.toBe(base)
    })

    it('does not confuse key/value boundaries', () =>
    {
        // Without unambiguous framing these two would hash alike.
        expect(hashStrings({ 'a': 'b.c' })).not.toBe(hashStrings({ 'a.b': 'c' }))
    })
})

describe('makeTranslator', () =>
{
    const translated = (sourceLocale: string) => script({
        published: {
            title: 'Bookshelf',
            translations: {
                sourceLocale, sourceHash: 'x', generated: '2026-01-01T00:00:00.000Z',
                locales: {
                    de: { title: 'Bücherregal', 'params.WIDTH.label': 'Breite' },
                    pt: { title: 'Estante' },
                },
            },
        },
    } as Partial<ScriptData>)

    it('translates a known key and falls back per-key for unknown ones', () =>
    {
        const t = makeTranslator(translated('en'), 'de')
        expect(t('title', 'Bookshelf')).toBe('Bücherregal')
        expect(t('description', 'A shelf')).toBe('A shelf')
    })

    it('resolves a regional tag to its base language', () =>
    {
        expect(makeTranslator(translated('en'), 'pt-BR')('title', 'Bookshelf')).toBe('Estante')
    })

    it('never falls through to a different language', () =>
    {
        // No Japanese stored ⇒ show the original, not German.
        expect(makeTranslator(translated('en'), 'ja')('title', 'Bookshelf')).toBe('Bookshelf')
    })

    it('is the identity for an untranslated script', () =>
    {
        expect(makeTranslator(script(), 'de')('title', 'bookshelf')).toBe('bookshelf')
        expect(makeTranslator(null, 'de')('title', 'bookshelf')).toBe('bookshelf')
    })

    // THE regression that matters: a Dutch-authored configurator.
    it('honours a non-English source locale', () =>
    {
        const dutch = script({
            published: {
                title: 'Boekenkast',
                translations: {
                    sourceLocale: 'nl', sourceHash: 'x', generated: '2026-01-01T00:00:00.000Z',
                    locales: { en: { title: 'Bookshelf' }, de: { title: 'Bücherregal' } },
                },
            },
        } as Partial<ScriptData>)

        expect(scriptSourceLocale(dutch)).toBe('nl')
        // Dutch is the SOURCE: identity, not a round-trip through a translation table.
        expect(makeTranslator(dutch, 'nl')('title', 'Boekenkast')).toBe('Boekenkast')
        // English is a TARGET here, and must actually be looked up.
        expect(makeTranslator(dutch, 'en')('title', 'Boekenkast')).toBe('Bookshelf')
        // The source language leads the picker, marked as the original.
        expect(availableLocales(dutch)[0]).toBe('nl')
        expect(availableLocales(dutch)).toEqual(['nl', 'en', 'de'])
    })

    it('defaults the source locale only when nothing was detected', () =>
    {
        expect(scriptSourceLocale(script())).toBe(DEFAULT_SOURCE_LOCALE)
        expect(availableLocales(script())).toEqual([DEFAULT_SOURCE_LOCALE])
    })
})

describe('translationsAreStale', () =>
{
    it('is false for a fresh set and true once the copy is edited', () =>
    {
        const base = script({ published: { title: 'Bookshelf' } } as Partial<ScriptData>)
        const { sourceHash } = extractTranslatableStrings(base)

        const fresh = script({
            published: { title: 'Bookshelf', translations: {
                sourceLocale: 'en', sourceHash, generated: 'now', locales: {},
            } },
        } as Partial<ScriptData>)
        expect(translationsAreStale(fresh)).toBe(false)

        // An in-place metadata edit (PUT /scripts/configurators/:id) changes the copy;
        // without this check the configurator would keep serving stale translations.
        const edited = script({
            published: { title: 'Shelving unit', translations: {
                sourceLocale: 'en', sourceHash, generated: 'now', locales: {},
            } },
        } as Partial<ScriptData>)
        expect(translationsAreStale(edited)).toBe(true)
    })

    it('is false when there are no translations at all', () =>
    {
        expect(translationsAreStale(script())).toBe(false)
    })
})

describe('Script round-trip', () =>
{
    it('validates and preserves a stored translation set', () =>
    {
        const data = script({
            published: {
                title: 'Bookshelf',
                translations: {
                    sourceLocale: 'nl', sourceHash: 'abc', generated: '2026-01-01T00:00:00.000Z',
                    model: 'gemini-2.5-flash',
                    locales: { de: { title: 'Bücherregal' } },
                },
            },
        } as Partial<ScriptData>)

        const loaded = Script.fromData(data)
        expect(loaded).not.toBeNull()
        expect(loaded!.toData().published?.translations?.sourceLocale).toBe('nl')
    })

    it('does not reject a script carrying a locale we no longer support', () =>
    {
        // `locales` is keyed by plain string on purpose: a strict union here would make
        // one stale locale key fail validation for the WHOLE script on every read.
        const loaded = Script.fromData(script({
            published: { translations: {
                sourceLocale: 'en', sourceHash: 'abc', generated: 'now',
                locales: { xx: { title: 'Whatever' } },
            } },
        } as Partial<ScriptData>))
        expect(loaded).not.toBeNull()
        expect(makeTranslator(loaded!.toData(), 'de')('title', 'Bookshelf')).toBe('Bookshelf')
    })
})
