/**
 * i18n/extract.ts — pull every end-user-facing string out of a script.
 *
 * This is the single definition of "what gets translated". It runs on the server to
 * build the translation request, and again to compute the fingerprint that decides
 * whether a stored translation set is still current. Both sides must see exactly the
 * same set, so there is one implementation and it lives in core.
 *
 * What is deliberately NOT extracted:
 *   - `params.*.name`   — the code identifier ($WIDTH). Translating it would break the
 *                         script that references it.
 *   - `params.*.units`  — unit symbols (mm, in, °) are not language.
 *   - option VALUES     — the values a script compares against. Their display labels are
 *                         extracted instead (see paramOptionKey), which is presentation
 *                         only and cannot change behaviour.
 *   - licence / url / library / tags / exports — identifiers and machine values.
 */

import type { ScriptData } from '../ScriptSchema'
import type { ScriptParamData } from '../execution/types'

import { hashStrings } from './hash'
import {
    TITLE_KEY, DESCRIPTION_KEY, DETAILS_KEY,
    paramLabelKey, paramDescriptionKey, paramOptionKey,
    groupKey, presetKey, metricKey, fulfillmentNameKey, fulfillmentDescriptionKey,
} from './keys'

export interface ExtractedStrings
{
    /** Flat key → source string. Empty when the script has nothing worth translating. */
    strings: Record<string, string>
    /** Fingerprint of `strings` — see hash.ts. */
    sourceHash: string
}

/** Strings shorter than this carry no linguistic content worth a round trip. */
const MIN_LENGTH = 1

/** Add a string under `key` when it is a non-blank string. Purely numeric or symbolic
 *  values ("100", "—", "±") are skipped: there is nothing to translate and asking a
 *  model to "translate" them invites it to change them. */
function put(into: Record<string, string>, key: string, value: unknown): void
{
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length < MIN_LENGTH) return
    if (!/\p{Letter}/u.test(trimmed)) return
    into[key] = trimmed
}

/**
 * Every translatable string in a script, keyed by the grammar in keys.ts.
 *
 * Reads `published` overrides where they exist (a published configurator can carry its
 * own title/description/params/presets) and falls back to the script's own fields —
 * matching exactly what the configurator UI renders, so nothing is translated that is
 * never shown and nothing shown is left untranslated.
 */
export function extractTranslatableStrings(data: ScriptData): ExtractedStrings
{
    const strings: Record<string, string> = {}
    const published = data.published ?? null

    // ── Script level ──
    put(strings, TITLE_KEY, published?.title ?? data.name)
    put(strings, DESCRIPTION_KEY, published?.description ?? data.description)
    put(strings, DETAILS_KEY, data.details)

    // ── Params ──
    // A published configurator may override the param definitions; that override is what
    // end-users see, so it is what gets translated.
    const params = (published?.params ?? data.params ?? {}) as Record<string, ScriptParamData>
    const groups = new Set<string>()

    for (const [name, param] of Object.entries(params))
    {
        if (!param || typeof param !== 'object') continue
        // Hidden params are translated too: a behaviour can show one at run time (a house
        // whose per-side overhangs appear once "same overhangs" is switched off), and the
        // stored definition cannot tell those apart from params that never show.

        // `label` defaults to `name` when unset, so fall back explicitly — otherwise a
        // param that never customised its label would silently stay untranslated.
        put(strings, paramLabelKey(name), param.label ?? name)
        put(strings, paramDescriptionKey(name), param.description)

        if (param.group) groups.add(param.group)

        // Enum options: translate the DISPLAY label, keyed by the raw value.
        const options = (param.schema as { enum?: Array<unknown> } | undefined)?.enum
        if (Array.isArray(options))
        {
            for (const option of options) put(strings, paramOptionKey(name, option), option)
        }
    }

    for (const group of groups) put(strings, groupKey(group), group)

    // ── Presets ──
    // The preset's map key is its identifier AND its current display name, so the key
    // doubles as the source string.
    const presets = data.presets ?? {}
    const presetNames = published?.presets ?? Object.keys(presets)
    for (const name of presetNames) put(strings, presetKey(name), name)

    // ── Metrics ──
    // Metrics only exist once the script runs, so their names are read from the code.
    metricLabelsInCode(data.code).forEach(label => put(strings, metricKey(label), label))

    // ── Fulfillments ──
    const fulfillments = published?.fulfillments ?? []
    fulfillments.forEach((f, i) =>
    {
        if (!f || typeof f !== 'object') return
        put(strings, fulfillmentNameKey(i), f.name)
        put(strings, fulfillmentDescriptionKey(i), f.description)
    })

    return { strings, sourceHash: hashStrings(strings) }
}

/**
 * The text of every `metric('Floor area', …)` call in the code: its name, or its `label`
 * option when that is written out, which is what the metric card shows instead.
 *
 * Read from the source because metrics only exist once the script runs, and a published
 * version is translated without running it. Literal names cover the scripts in use; a
 * name built at run time (a variable, a template with `${…}`) is not found, and that
 * metric shows as written.
 */
export function metricLabelsInCode(code: string | undefined): Array<string>
{
    if (!code) return []
    return Array.from(code.matchAll(/\bmetric\s*\(/g)).flatMap((call) =>
    {
        const args = callArguments(code, (call.index ?? 0) + call[0].length)
        const name = args.match(/^\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,/s)
        const label = args.match(/\blabel\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/s)
        const text = (label ?? name)?.[2]
        return (text && !text.includes('${')) ? [text] : []
    })
}

/** Longest argument list read for one call; a metric call is a line or two. */
const MAX_CALL_LENGTH = 2000

/** The source between an opening parenthesis (`start` is just after it) and the one that
 *  closes it, stepping over strings so a `)` inside one does not end the call. */
function callArguments(code: string, start: number): string
{
    interface Scan { depth: number; quote: string | null; escaped: boolean; end: number }
    // split(''), not Array.from(): `i` must count UTF-16 units, as slice() does
    const scan = code.slice(start, start + MAX_CALL_LENGTH).split('').reduce<Scan>((s, char, i) =>
    {
        if (s.end >= 0) return s
        if (s.quote)
        {
            if (s.escaped) return { ...s, escaped: false }
            if (char === '\\') return { ...s, escaped: true }
            return (char === s.quote) ? { ...s, quote: null } : s
        }
        if (char === '"' || char === "'" || char === '`') return { ...s, quote: char }
        if (char === '(') return { ...s, depth: s.depth + 1 }
        if (char === ')') return (s.depth === 0) ? { ...s, end: i } : { ...s, depth: s.depth - 1 }
        return s
    }, { depth: 0, quote: null, escaped: false, end: -1 })
    return code.slice(start, start + (scan.end >= 0 ? scan.end : MAX_CALL_LENGTH))
}
