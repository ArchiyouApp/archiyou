/**
 * svgSanitize.ts — validate a thumbnail SVG before it is written to disk.
 *
 * Thumbnails are produced by our own exporter (packages/core/src/modeler/SVGExporter.ts),
 * but they reach the server inside a client-controlled request body and are afterwards
 * served from our own origin as a file. That makes them untrusted input on the way in and
 * a potential XSS vector on the way out, so this is an allowlist, not a blocklist scan:
 * anything the exporter does not legitimately emit is rejected outright.
 *
 * Rejecting (returning null) is always safe — the caller stores no thumbnail and the UI
 * falls back to its placeholder icon. There is never a reason to "clean up and keep" a
 * document that does not look like our own output.
 *
 * Serving is additionally hardened with `Content-Security-Policy: sandbox`, `nosniff` and
 * <img>-only rendering (see plugin.ts), so this is one layer of several.
 */

/** Elements the exporter emits. Everything else is a rejection. */
const ALLOWED_ELEMENTS = new Set(['svg', 'style', 'title', 'g', 'path', 'circle', 'line', 'polyline']);

/** Attributes the exporter emits. Note the absence of every `href` variant. */
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns', 'viewbox', 'preserveaspectratio', 'role', 'class', 'transform',
  'width', 'height', 'data-units',
  'd', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points',
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'opacity',
]);

/** Constructs that must never appear, checked before any parsing. */
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/<\s*script/i,            'script element'],
  [/<\s*foreignObject/i,     'foreignObject element'],
  [/<\s*image\b/i,           'image element'],
  [/<\s*use\b/i,             'use element'],
  [/<\s*iframe/i,            'iframe element'],
  [/<\s*(a|animate|set|handler)\b/i, 'scriptable/animation element'],
  [/<!DOCTYPE/i,             'doctype'],
  [/<!ENTITY/i,              'entity declaration'],
  [/<!\[CDATA\[/i,           'CDATA section'],
  [/\son\w+\s*=/i,           'event handler attribute'],
  [/javascript\s*:/i,        'javascript: URL'],
  [/data\s*:\s*text\/html/i, 'data: html URL'],
  [/xlink:href/i,            'xlink:href'],
  [/\bhref\s*=/i,            'href attribute'],
  [/@import/i,               'CSS @import'],
  [/url\s*\(/i,              'CSS url()'],
];

export interface SanitizeResult {
  ok: boolean;
  /** Why it was rejected. Logged, never returned to the client. */
  reason?: string;
}

/**
 * Check an SVG string. Returns the ORIGINAL string when it passes — this deliberately does
 * not rewrite the document, because a sanitizer that edits its input can be tricked into
 * producing something neither the caller nor the checker anticipated.
 */
export function sanitizeThumbnailSvg(svg: unknown, maxBytes: number): string | null {
  return checkThumbnailSvg(svg, maxBytes).ok ? (svg as string) : null;
}

/** As {@link sanitizeThumbnailSvg}, but reports why — used by tests and for logging. */
export function checkThumbnailSvg(svg: unknown, maxBytes: number): SanitizeResult {
  if (typeof svg !== 'string' || svg.length === 0) {
    return { ok: false, reason: 'not a non-empty string' };
  }

  // Size first: never run regexes over an unbounded body.
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > maxBytes) {
    return { ok: false, reason: `too large (${bytes} > ${maxBytes} bytes)` };
  }

  const trimmed = svg.trim();
  if (!trimmed.startsWith('<svg') || !trimmed.endsWith('</svg>')) {
    return { ok: false, reason: 'not a bare <svg> document' };
  }
  // One root element only — a second <svg> means something was appended.
  if ((trimmed.match(/<svg\b/gi) ?? []).length !== 1) {
    return { ok: false, reason: 'multiple <svg> roots' };
  }

  for (const [pattern, what] of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) return { ok: false, reason: `contains ${what}` };
  }

  // Every tag must be on the element allowlist.
  for (const match of trimmed.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) return { ok: false, reason: `disallowed element <${tag}>` };
  }

  // Every attribute must be on the attribute allowlist. Attributes only appear inside
  // tags, so scan tag interiors rather than the whole document (which contains CSS).
  for (const tagMatch of trimmed.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const body = tagMatch[0].replace(/^<[a-zA-Z][\w:-]*/, '');
    for (const attrMatch of body.matchAll(/([a-zA-Z_:][\w.:-]*)\s*=/g)) {
      const attr = attrMatch[1].toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(attr)) return { ok: false, reason: `disallowed attribute "${attr}"` };
    }
  }

  return { ok: true };
}
