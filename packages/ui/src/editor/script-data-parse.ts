/**
 * script-data-parse — parse pasted/imported script data WITHOUT evaluating it.
 *
 * Exported script objects use backtick-delimited strings for multi-line `code`
 * fields, which JSON and JSON5 cannot read. The importer used to fall back to
 * `new Function('return (' + text + ')')()`, i.e. it executed whatever the user
 * pasted. That is a paste-jacking vector — and since the session JWT is kept in
 * localStorage, injected script can read it and impersonate the user.
 *
 * Instead we rewrite plain template literals into ordinary JSON strings and hand
 * the result to JSON5. No JS engine is involved, so pasted data cannot run.
 */

/**
 * Rewrite backtick-delimited template literals into JSON double-quoted strings.
 *
 * Scans character by character, tracking which kind of string it is inside, so a
 * backtick appearing *within* a normal '…' or "…" string is left alone. Newlines
 * and quotes inside a template literal are escaped by JSON.stringify.
 *
 * @throws when a literal contains `${` interpolation — that cannot be represented
 *   as a static string, and evaluating it is exactly what this exists to avoid.
 */
export function templateLiteralsToJsonStrings(src: string): string
{
  let out = '';
  let i = 0;

  while (i < src.length)
  {
    const ch = src[i];

    // Pass ordinary quoted strings through verbatim (respecting escapes), so a
    // backtick inside them is not mistaken for the start of a template literal.
    if (ch === '"' || ch === '\'')
    {
      const end = findStringEnd(src, i, ch);
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '`')
    {
      const end = findStringEnd(src, i, '`');
      // `end` is one past the closing backtick; strip both delimiters.
      const raw = src.slice(i + 1, end - 1);
      if (/\$\{/.test(raw))
      {
        throw new Error(
          'Template literals with ${...} interpolation are not supported in pasted '
          + 'script data. Export the script as JSON instead.',
        );
      }
      // \` and \$ are only special inside a template literal — unescape them
      // before re-encoding as a JSON string.
      out += JSON.stringify(raw.replace(/\\`/g, '`').replace(/\\\$/g, '$'));
      i = end;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Index just past the closing `quote` for the string starting at `start`. */
function findStringEnd(src: string, start: number, quote: string): number
{
  let i = start + 1;
  while (i < src.length)
  {
    if (src[i] === '\\') { i += 2; continue; }   // skip escaped char
    if (src[i] === quote) return i + 1;
    i++;
  }
  return src.length;   // unterminated — let the JSON5 parse report it
}
