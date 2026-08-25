/**
 * i18n/keys.ts — the key grammar for a script's translatable strings.
 *
 * A translation set is a FLAT map of dotted key → translated string, one map per locale:
 *
 *     { "title": "Boekenkast",
 *       "params.WIDTH.label": "Breedte",
 *       "presets.tall": "Hoog" }
 *
 * Flat rather than nested because it is strictly cheaper to generate (no repeated
 * structural braces in the model's output), merges with a plain Object.assign when a
 * large script has to be translated in batches, and degrades one key at a time — a
 * missing key falls back to its source string with no null-safe descent at every level.
 *
 * Dynamic segments are percent-escaped. Param names are uppercase identifiers, but
 * PRESET names and GROUP names are free-form user strings that can legitimately contain
 * a dot ("v1.2", "Frame · 2.0"), which would otherwise silently collide with a
 * structural separator and mis-key someone's translation.
 */

/** Escape a value that becomes one dotted-path segment. `%` first, or unescaping
 *  a literal `%2E` would produce a phantom dot. */
export function encodeKeySegment(segment: string): string
{
    return String(segment).replace(/%/g, '%25').replace(/\./g, '%2E')
}

export function decodeKeySegment(segment: string): string
{
    return String(segment).replace(/%2E/gi, '.').replace(/%25/g, '%')
}

//// SCRIPT-LEVEL KEYS ////

/** The configurator's display title (`published.title`, else the script name). */
export const TITLE_KEY = 'title'
/** Short description shown under the title (`published.description`, else `description`). */
export const DESCRIPTION_KEY = 'description'
/** The longer "read more" body (`details`). */
export const DETAILS_KEY = 'details'

//// PARAM KEYS ////

/** Human-readable caption for a param. NOTE: the param's `name` is the code identifier
 *  ($WIDTH) and is never translated — only its label is. */
export function paramLabelKey(paramName: string): string
{
    return `params.${encodeKeySegment(paramName)}.label`
}

export function paramDescriptionKey(paramName: string): string
{
    return `params.${encodeKeySegment(paramName)}.description`
}

/**
 * Display label for ONE option of an enum param, keyed by the option's raw value.
 *
 * Keyed by value rather than index on purpose: reordering a script's options must not
 * silently re-point every translation. The raw value stays the value the script compares
 * against (`if ($STYLE === 'modern')`) — only the text shown in the dropdown is
 * translated, so this can never change behaviour.
 */
export function paramOptionKey(paramName: string, optionValue: unknown): string
{
    return `params.${encodeKeySegment(paramName)}.options.${encodeKeySegment(String(optionValue))}`
}

/** Caption of a param group (rendered as a tab in the configurator). */
export function groupKey(groupName: string): string
{
    return `groups.${encodeKeySegment(groupName)}`
}

/** Display name of a preset. The preset's map key stays the identifier. */
export function presetKey(presetName: string): string
{
    return `presets.${encodeKeySegment(presetName)}`
}

//// FULFILLMENT KEYS ////

/** Fulfillments are an ordered list with no stable id, so they are keyed by index.
 *  The stored `sourceHash` covers their names, so a reorder invalidates the set and
 *  triggers a regeneration rather than leaving keys pointing at the wrong entry. */
export function fulfillmentNameKey(index: number): string
{
    return `fulfillments.${index}.name`
}

export function fulfillmentDescriptionKey(index: number): string
{
    return `fulfillments.${index}.description`
}
