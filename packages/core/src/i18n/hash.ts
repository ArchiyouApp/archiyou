/**
 * i18n/hash.ts — a stable fingerprint of a script's translatable strings.
 *
 * Used to answer two questions:
 *   - "have we already paid to translate exactly these strings?" (reuse across a version
 *     bump whose copy did not change — republishing v1.2 must not re-bill)
 *   - "are the stored translations still about the current text?" (a configurator's
 *     metadata can be edited in place, which would otherwise leave the translated copy
 *     silently describing something else)
 *
 * Deliberately NOT node:crypto: this module runs in a browser Web Worker as well as in
 * Node, and both sides must produce byte-identical hashes for the comparison to mean
 * anything. FNV-1a is more than adequate here — the input is our own strings and the
 * consequence of a collision is a skipped re-translation, not a security failure.
 */

/** FNV-1a (32-bit), operating on UTF-16 code units. */
function fnv1a(input: string): number
{
    let h = 0x811c9dc5
    for (let i = 0; i < input.length; i++)
    {
        h ^= input.charCodeAt(i)
        // h *= 16777619, kept in 32-bit range without overflowing the float mantissa.
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
    }
    return h >>> 0
}

/**
 * Hash a key→string map. Independent of insertion order (keys are sorted), and both key
 * and value take part, so renaming a key or editing a value both invalidate the result.
 *
 * Two hashes are concatenated with different seeds' worth of input framing to widen the
 * space beyond 32 bits, which matters because these are compared across every version of
 * every script an author owns.
 */
export function hashStrings(strings: Record<string, string>): string
{
    const parts: Array<string> = []
    for (const key of Object.keys(strings).sort())
    {
        // NUL/SOH frame both key and value: neither can occur in a script's copy, so
        // { "a": "b.c" } and { "a.b": "c" } can never hash alike. Written as escapes
        // rather than literal control bytes so the source survives editors and linters.
        parts.push(`${key}\u0000${strings[key]}\u0001`)
    }
    const joined = parts.join('')
    const a = fnv1a(joined)
    const b = fnv1a(`${joined.length}\u0002${joined}`)
    return a.toString(36) + b.toString(36)
}
