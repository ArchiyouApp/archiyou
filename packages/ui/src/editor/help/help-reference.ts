/**
 * help-reference.ts — search the script API and find the entry for the code at the cursor.
 *
 * The data is api.generated.json, written by packages/core/scripts/generate-api.ts from
 * the doc comments (TypeDoc). Loaded lazily by the editor (state/help.ts); everything
 * here is pure so it can be tested without a DOM.
 *
 * Lookup is deliberately simple, the way Godot's and Processing's "help for the word
 * under the cursor" work: take the word, and if it follows a `.`, work out the class of
 * what is before the dot by walking the chain from its start (`box(…)` is a Mesh,
 * `.move()` returns the same Mesh, …). The start is typed with the same inference the
 * autocomplete uses (completions.ts). When the class cannot be known, every class that
 * has a member of that name is offered.
 */

import { FACTORY_RETURN_TYPES, buildScopeTypeMap, extractChainRoot, resolveType } from '../completions.js';

//// TYPES ////

/** Same format as generate-api.ts writes */
export interface ApiParam
{
  name: string;
  type: string;
  optional?: boolean;
  default?: string;
  doc?: string;
}

export interface ApiEntry
{
  /** 'box', 'Mesh', 'Mesh.move', '$component' */
  id: string;
  name: string;
  /** Class the member belongs to; absent for globals and classes */
  owner?: string;
  kind: 'function' | 'method' | 'property' | 'class' | 'module';
  static?: boolean;
  sig?: string;
  alt?: string[];
  /** Class name of the result */
  returns?: string;
  doc?: string;
  returnsDoc?: string;
  params?: ApiParam[];
  examples?: string[];
  extends?: string;
  deprecated?: boolean;
}

export interface ApiIndex
{
  entries: ApiEntry[];
  byId: Map<string, ApiEntry>;
  /** Members per class, in source order */
  byOwner: Map<string, ApiEntry[]>;
  /** Members with this name, across classes */
  byName: Map<string, ApiEntry[]>;
  /** Global functions and modules */
  globals: ApiEntry[];
  classes: ApiEntry[];
}

export interface ApiLookup
{
  /** The word at the cursor */
  word: string;
  /** Class of what is before the `.`, when it could be worked out */
  receiver: string | null;
  /** Best match first; several when the word is ambiguous */
  entries: ApiEntry[];
  /** A script parameter like `$WIDTH` (entries then holds $PARAMS) */
  param?: string;
}

//// INDEX ////

export function indexApi(raw: ApiEntry[]): ApiIndex
{
  // The modeling factories are typed with the kernel-neutral AnyKernelShape; a script
  // gets the mesh class, which is the one worth showing and linking to
  const entries = raw.map(e =>
  {
    const concrete = !e.owner && e.returns === 'AnyKernelShape' ? FACTORY_RETURN_TYPES[e.name] : undefined;
    return concrete
      ? { ...e, returns: concrete, sig: e.sig?.replace(/: AnyKernelShape$/, `: ${concrete}`) }
      : e;
  });

  const group = (key: (e: ApiEntry) => string | undefined) => entries.reduce((map, e) =>
  {
    const k = key(e);
    if (k !== undefined) map.set(k, [...(map.get(k) ?? []), e]);
    return map;
  }, new Map<string, ApiEntry[]>());

  return {
    entries,
    byId: new Map(entries.map(e => [e.id, e])),
    byOwner: group(e => e.owner),
    byName: group(e => (e.owner ? e.name : undefined)),
    globals: entries.filter(e => !e.owner && e.kind !== 'class'),
    classes: entries.filter(e => e.kind === 'class'),
  };
}

//// SEARCH ////

/** Entries matching a query on name or id (`move`, `Mesh.mo`), best first. */
export function searchApi(index: ApiIndex, query: string, limit = 60): ApiEntry[]
{
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const score = (e: ApiEntry): number =>
  {
    const name = e.name.toLowerCase();
    const id = e.id.toLowerCase();
    const base = name === q || id === q ? 100
      : name.startsWith(q) || id.startsWith(q) ? 60
      : name.includes(q) || id.includes(q) ? 30
      : e.doc?.toLowerCase().includes(q) ? 5
      : 0;
    // Globals and classes are what people look for first
    return base && (base + (e.owner ? 0 : 10) - (e.deprecated ? 20 : 0));
  };

  return index.entries
    .map(e => ({ e, s: score(e) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length || a.e.id.localeCompare(b.e.id))
    .slice(0, limit)
    .map(({ e }) => e);
}

//// LOOKUP AT CURSOR ////

const WORD = /[A-Za-z0-9_$]/;

/** The API entries for the word at `pos` in `code`. */
export function lookupAt(index: ApiIndex, code: string, pos: number): ApiLookup
{
  const { word, start } = wordAt(code, pos);
  if (!word) return { word: '', receiver: null, entries: [] };

  const before = code.slice(0, start).replace(/\s+$/, '');
  if (before.endsWith('.'))
  {
    const receiver = typeOfExpression(index, code, before.slice(0, -1));
    const exact = receiver ? index.byId.get(`${receiver}.${word}`) : undefined;
    const entries = exact ? [exact] : (index.byName.get(word) ?? []);
    return { word, receiver: exact ? receiver : null, entries };
  }

  const global = index.byId.get(word);
  if (global && !global.owner) return { word, receiver: null, entries: [global] };

  // $WIDTH: a script parameter, made by $PARAMS.define('WIDTH', …)
  if (/^\$[A-Z][A-Z0-9_]*$/.test(word) && word !== '$PARAMS')
  {
    const params = index.byId.get('$PARAMS');
    return { word, receiver: null, entries: params ? [params] : [], param: word.slice(1) };
  }

  const prefixed = index.globals
    .filter(e => e.name.startsWith(word))
    .sort((a, b) => a.name.length - b.name.length);
  const cls = index.byId.get(word);
  return { word, receiver: null, entries: prefixed.length ? prefixed : cls ? [cls] : searchApi(index, word, 20) };
}

/** The word around `pos`; a cursor just after `name(` means `name`. */
function wordAt(code: string, pos: number): { word: string, start: number }
{
  const at = (p: number) => p >= 0 && p < code.length && WORD.test(code[p]);
  let end = pos;
  let start = pos;

  // In the parentheses of a call just opened: `box(|` or `box( |`
  if (!at(pos) && !at(pos - 1))
  {
    const back = code.slice(0, pos).match(/([A-Za-z0-9_$]+)\(\s*$/);
    if (back) return { word: back[1], start: pos - back[0].length };
  }

  while (at(start - 1)) start--;
  while (at(end)) end++;
  return { word: code.slice(start, end), start };
}

/** Class of an expression ending right before a `.`, or null when it cannot be told. */
function typeOfExpression(index: ApiIndex, code: string, textBefore: string): string | null
{
  // A chain continued on the next line: `doc.create('x')⏎   .page(…)`
  const flat = textBefore.trimEnd().replace(/\n\s*(?=\.)/g, '');
  const root = extractChainRoot(flat);
  if (!root) return null;

  const rest = flat.slice(flat.lastIndexOf(root) + root.length);
  const type = rootType(index, code, root);

  return chainNames(rest).reduce<string | null>((owner, name) =>
  {
    if (!owner) return null;
    return index.byId.get(`${owner}.${name}`)?.returns ?? null;
  }, type);
}

function rootType(index: ApiIndex, code: string, root: string): string | null
{
  const scope = buildScopeTypeMap(code);
  // Variables made by a global the autocomplete does not know, like `c = $component(…)`
  [...code.matchAll(/\b(?:(?:let|const|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g)]
    .forEach(([, variable, fn]) =>
    {
      const returns = globalReturns(index, fn);
      if (returns && !scope.has(variable)) scope.set(variable, returns);
    });

  const known = resolveType(root, scope);
  if (known) return known;

  const call = root.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call) return globalReturns(index, call[1]);

  // A module (`doc`, `calc`, `$PARAMS`) or a class name used for its statics (`Mesh.Box`)
  const entry = index.byId.get(root);
  if (entry?.kind === 'module') return entry.returns ?? null;
  if (entry?.kind === 'class') return entry.id;
  return null;
}

/** What a global function returns, with the modeling factories' kernel type made concrete */
function globalReturns(index: ApiIndex, fn: string): string | null
{
  const entry = index.byId.get(fn);
  if (!entry || entry.owner) return null;
  return FACTORY_RETURN_TYPES[fn] ?? (entry.returns && index.byId.has(entry.returns) ? entry.returns : null);
}

/** Member names in a chain tail: `.move(1, 2).color('red')` → ['move', 'color'] */
function chainNames(tail: string): string[]
{
  const names: string[] = [];
  let depth = 0;
  let current: string | null = null;

  [...tail].forEach(c =>
  {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === '.') { if (current) names.push(current); current = ''; }
    else if (depth === 0 && current !== null && WORD.test(c)) current += c;
  });
  if (current) names.push(current);
  return names;
}
