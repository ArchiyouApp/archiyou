/**
 *  TextFonts.ts
 *
 *  Font sourcing for the Modeler's native text API (see `Modeler.text()`).
 *
 *  meshup itself is font-agnostic: its outline text (`Sketch.textOutline` /
 *  `textSolid`) needs raw TTF/OTF bytes. This module provides:
 *    - a bundled default outline font (reusing the Outfit TTF already shipped
 *      for PDF export), so `text()` works out of the box, and
 *    - a small registry + fetch helper so scripts can register custom fonts by
 *      name (e.g. a Google-Fonts / self-hosted TTF URL) via `Modeler.loadFont()`.
 *
 *  Single-stroke (Hershey) fonts are handled entirely inside meshup and don't
 *  go through here.
 */

// Outfit is stored base64-encoded (TTF magic 00 01 00 00 → "AAEAAAA…").
import { OutfitByteString } from '../../assets/fonts/Outfit'

/** Decode a base64 string to bytes (Node Buffer or browser atob). */
function decodeBase64(str: string): Uint8Array
{
    if (typeof Buffer !== 'undefined')
    {
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return bytes;
}

let _defaultFont: Uint8Array | null = null;

/** The bundled default outline font (Outfit, a geometric sans). Decoded once. */
export function defaultTextFont(): Uint8Array
{
    if (!_defaultFont)
    {
        _defaultFont = decodeBase64(OutfitByteString as unknown as string);
    }
    return _defaultFont;
}

/** Named registry of user-loaded fonts (raw TTF/OTF bytes). */
const _registry = new Map<string, Uint8Array>();

/** Register raw font bytes under a name for later reuse via `Modeler.text({ font: name })`. */
export function registerFont(name: string, bytes: Uint8Array): void
{
    if (!name) { throw new Error('registerFont(): a non-empty name is required.'); }
    _registry.set(name, bytes);
}

/** Look up a previously registered font by name. */
export function getFont(name: string): Uint8Array | undefined
{
    return _registry.get(name);
}

/** Fetch a font file (TTF/OTF) from a URL and return its bytes.
 *  NOTE: woff2 is NOT supported by the outline parser — point this at a `.ttf`
 *  or `.otf`. For Google Fonts, use a direct raw TTF URL (e.g. the file from the
 *  google/fonts GitHub repo) rather than the CSS API (which serves woff2). */
export async function fetchFont(url: string): Promise<Uint8Array>
{
    if (typeof fetch !== 'function')
    {
        throw new Error('fetchFont(): global fetch is not available in this environment.');
    }
    const res = await fetch(url);
    if (!res.ok)
    {
        throw new Error(`fetchFont(): failed to fetch '${url}' (${res.status} ${res.statusText}).`);
    }
    return new Uint8Array(await res.arrayBuffer());
}
