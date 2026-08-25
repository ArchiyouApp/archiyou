/**
 * tests/script-data-parse.test.ts — the eval-free replacement for the importer's
 * old `new Function` fallback.
 *
 * The importer accepts pasted script data. It previously ran
 * `new Function('return (' + pasted + ')')()`, so pasted text executed with full
 * page privileges — and the session JWT is in localStorage. These tests pin both
 * halves of the fix: the template-literal support that made the eval look
 * necessary still works, and code can no longer run.
 */
import { describe, it, expect } from 'vitest';
import JSON5 from 'json5';

import { templateLiteralsToJsonStrings } from '../src/editor/script-data-parse.js';

/** What the importer does: rewrite, then JSON5-parse. */
function parse(src: string): any
{
  return JSON5.parse(templateLiteralsToJsonStrings(src));
}

describe('templateLiteralsToJsonStrings — the cases the eval used to handle', () =>
{
  it('converts a single-line template literal', () =>
  {
    expect(parse('{ code: `box(10)` }')).toEqual({ code: 'box(10)' });
  });

  it('converts a multi-line template literal, preserving newlines', () =>
  {
    const src = '{ name: \'demo\', code: `line1\nline2\nline3` }';
    expect(parse(src)).toEqual({ name: 'demo', code: 'line1\nline2\nline3' });
  });

  it('keeps double quotes appearing inside a template literal', () =>
  {
    expect(parse('{ code: `say "hi"` }')).toEqual({ code: 'say "hi"' });
  });

  it('handles several template literals in one object', () =>
  {
    expect(parse('{ a: `one`, b: `two`, c: 3 }')).toEqual({ a: 'one', b: 'two', c: 3 });
  });

  it('unescapes \\` and \\$ which are only special inside a template literal', () =>
  {
    expect(parse('{ code: `a \\` b \\$ c` }')).toEqual({ code: 'a ` b $ c' });
  });

  it('leaves input without template literals untouched', () =>
  {
    const src = '{ name: "x", n: 1, arr: [1, 2], nested: { k: \'v\' } }';
    expect(templateLiteralsToJsonStrings(src)).toBe(src);
    expect(parse(src)).toEqual({ name: 'x', n: 1, arr: [1, 2], nested: { k: 'v' } });
  });

  it('does not treat a backtick inside a normal string as a delimiter', () =>
  {
    // The ` here is ordinary data. Mis-scanning it would swallow the rest of the
    // object and corrupt the parse.
    expect(parse('{ a: "back ` tick", b: 2 }')).toEqual({ a: 'back ` tick', b: 2 });
    expect(parse("{ a: 'back ` tick', b: 2 }")).toEqual({ a: 'back ` tick', b: 2 });
  });

  it('respects escaped quotes when scanning normal strings', () =>
  {
    expect(parse('{ a: "he said \\"hi\\"", b: `x` }')).toEqual({ a: 'he said "hi"', b: 'x' });
  });
});

describe('templateLiteralsToJsonStrings — refuses what would need an engine', () =>
{
  it('rejects ${...} interpolation instead of evaluating it', () =>
  {
    expect(() => templateLiteralsToJsonStrings('{ code: `${1 + 1}` }'))
      .toThrow(/interpolation are not supported/i);
  });

  it('rejects interpolation that wraps a side effect', () =>
  {
    // The payload shape that mattered: with the old `new Function` fallback this
    // ran on paste. It must now be refused, not executed.
    const attack = '{ code: `${globalThis.__pwned = true}` }';
    expect(() => templateLiteralsToJsonStrings(attack)).toThrow();
    expect((globalThis as any).__pwned).toBeUndefined();
  });
});

describe('no code execution on any path', () =>
{
  it('does not run an IIFE payload — it fails to parse instead', () =>
  {
    // `new Function('return (' + src + ')')()` would have executed this.
    const attack = '(function(){ globalThis.__pwned2 = true; return { name: "x" }; })()';
    expect(() => parse(attack)).toThrow();
    expect((globalThis as any).__pwned2).toBeUndefined();
  });

  it('does not run a getter payload', () =>
  {
    const attack = '{ get name(){ globalThis.__pwned3 = true; return "x"; } }';
    expect(() => parse(attack)).toThrow();
    expect((globalThis as any).__pwned3).toBeUndefined();
  });

  it('treats a would-be call expression as unparseable data', () =>
  {
    expect(() => parse('{ code: fetch("https://evil.example.com") }')).toThrow();
  });
});
