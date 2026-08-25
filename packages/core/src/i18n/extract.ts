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
    groupKey, presetKey, fulfillmentNameKey, fulfillmentDescriptionKey,
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
        // Hidden params are never rendered, so translating them is wasted budget.
        if ((param as { visible?: boolean }).visible === false) continue

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
