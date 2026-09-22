/**
 * CodeMirror autocompletion source for the Archiyou Modeler API.
 *
 * Provides completions for:
 *  - top-level Modeler functions (box, sphere, line, sketch, …)
 *  - instance methods on the shapes they return (Mesh, Curve, Polygon, ShapeCollection, …)
 *
 * Shape class data is auto-generated — run:
 *   pnpm --filter @archiyou/core generate:completions
 */

import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from '@codemirror/autocomplete';

import { localCompletionSource } from '@codemirror/lang-javascript';

import { FACTORY_RETURN_TYPES } from '@archiyou/core/src/constants';

import {
  type MethodInfo,
  modelerFunctions as autoModelerFunctions,
  shapeClasses,
} from './completions-data.generated';

/* ------------------------------------------------------------------ */
/*  Sketch-forwarded global commands (not static Modeler methods)      */
/* ------------------------------------------------------------------ */

/**
 * These are injected into global scope at runtime via MODELER_METHODS_INTO_GLOBAL
 * but do not exist as methods on the Modeler class — they're delegated to the
 * active Sketch at execution time.  Keep this short supplement in sync with
 * the MODELER_METHODS_INTO_GLOBAL list in archiyou-core-next/src/constants.ts.
 */
const sketchForwardedFunctions: MethodInfo[] = [
  { label: 'isTemp',       detail: '(): any',                                   type: 'function', info: 'Mark shapes as temporary (hidden from output)' },
  { label: 'moveTo',       detail: '(...coords): this',                          type: 'function', info: 'Move sketch cursor to position' },
  { label: 'lineTo',       detail: '(...coords): this',                          type: 'function', info: 'Draw a line to position' },
  { label: 'splineTo',     detail: '(...coords): this',                          type: 'function', info: 'Draw a spline to position' },
  { label: 'arcTo',        detail: '(mid, end): this',                           type: 'function', info: 'Draw an arc through mid to end' },
  { label: 'rectTo',       detail: '(...coords): this',                          type: 'function', info: 'Draw a rectangle to position' },
  { label: 'circleTo',     detail: '(...coords): this',                          type: 'function', info: 'Draw a circle' },
  { label: 'mirror',       detail: '(dir, pos?): this',                          type: 'function', info: 'Mirror sketch' },
  { label: 'offset',       detail: '(distance): this',                           type: 'function', info: 'Offset sketch' },
  { label: 'offsetted',    detail: '(distance): this',                           type: 'function', info: 'Returns an offset copy' },
  { label: 'fillet',       detail: '(radius, at?): this',                        type: 'function', info: 'Fillet sketch corners' },
  { label: 'chamfer',      detail: '(distance?, edges?): this',                  type: 'function', info: 'Chamfer sketch corners' },
  { label: 'thicken',      detail: '(amount, direction?): this',                 type: 'function', info: 'Thicken a face or shell' },
  { label: 'thickened',    detail: '(amount, direction?): this',                 type: 'function', info: 'Returns a thickened copy' },
  { label: 'combine',      detail: '(): this',                                   type: 'function', info: 'Combine sketch segments' },
  { label: 'close',        detail: '(): this',                                   type: 'function', info: 'Close sketch' },
  { label: 'importSketch', detail: '(sketch): this',                             type: 'function', info: 'Import an existing sketch' },
];

/** All top-level global functions: auto-generated from Modeler.ts + sketch forwarding supplement. */
const modelerFunctions: MethodInfo[] = [...autoModelerFunctions, ...sketchForwardedFunctions];

/* ------------------------------------------------------------------ */
/*  Factory → shape class mapping (mesh mode default)                  */
/* ------------------------------------------------------------------ */

// Which class each factory returns lives in core, next to the list of globals (imported above)
export { FACTORY_RETURN_TYPES };

/**
 * Scans the document text for variable assignments like:
 *   `let b = box(10, 10, 10)` · `const s = sphere(50)` · `c = line(...)`
 * and returns a map from variable name → inferred shape class name.
 */
export function buildScopeTypeMap(docText: string): Map<string, string>
{
  const map = new Map<string, string>();
  const re = /\b(?:(?:let|const|var)\s+)?([a-zA-Z_$]\w*)\s*=\s*([a-z_$]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null)
  {
    const [, varName, fnName] = m;
    const resolved = FACTORY_RETURN_TYPES[fnName];
    if (resolved) map.set(varName, resolved);
  }
  return map;
}

/**
 * Given the text before a `.`, extracts the root expression of the method
 * chain — i.e., the part before the first top-level `.`.
 *
 * Examples:
 *   `b`                          → `b`
 *   `box(10, 10, 10)`            → `box(10, 10, 10)`
 *   `b.color('red')`             → `b`
 *   `box(10).color('red')`       → `box(10)`
 *   `const x = sphere(50)`       → `sphere(50)`   ← assignment stripped
 */
export function extractChainRoot(textBefore: string): string
{
  // Take the last statement (after last newline or semicolon)
  const parts = textBefore.split(/[;\n]/);
  const lastStatement = (parts[parts.length - 1] ?? '').trim();

  // Strip a leading assignment: `let x =`, `const x =`, `x =` (but not `==`)
  const afterAssign = lastStatement.replace(
    /^(?:(?:let|const|var)\s+)?[a-zA-Z_$]\w*\s*=(?!=)\s*/,
    '',
  );

  // Walk to the first top-level `.` (not inside parens / brackets)
  let depth = 0;
  for (let i = 0; i < afterAssign.length; i++)
  {
    const c = afterAssign[i];
    if (c === '(' || c === '[') { depth++; continue; }
    if (c === ')' || c === ']') { depth--; continue; }
    if (c === '.' && depth === 0 && i > 0) return afterAssign.slice(0, i).trim();
  }
  return afterAssign.trim();
}

/**
 * Resolves the inferred shape class of an expression root.
 *  - Plain identifier  → scope-map lookup
 *  - Call expression   → FACTORY_RETURN_TYPES lookup
 */
export function resolveType(root: string, scopeMap: Map<string, string>): string | null
{
  if (/^[a-zA-Z_$]\w*$/.test(root)) return scopeMap.get(root) ?? null;
  const callMatch = root.match(/^([a-z_$]\w*)\s*\(/);
  if (callMatch) return FACTORY_RETURN_TYPES[callMatch[1]] ?? null;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Build flat lookup maps for fast completion                         */
/* ------------------------------------------------------------------ */

/** Top-level completions: Modeler global functions + keywords */
const topLevelCompletions: Completion[] = modelerFunctions.map(f => ({
  label: f.label,
  type: 'function',
  detail: f.detail,
  info: f.info,
}));

topLevelCompletions.push(
  { label: 'new',     type: 'keyword' },
  { label: 'const',   type: 'keyword' },
  { label: 'let',     type: 'keyword' },
  { label: 'await',   type: 'keyword' },
  { label: 'console', type: 'variable', detail: 'Console API' },
  { label: 'fab',     type: 'variable', detail: 'Fabrication: contacts and fastenings' },
);

/* ------------------------------------------------------------------ */
/*  Gated script modules (registered at runtime)                       */
/* ------------------------------------------------------------------ */

/**
 * Script modules are installed per deployment and gated per user (see
 * modules/README.md), so unlike everything else here their completions cannot be
 * generated at build time — the editor learns about them from `GET /modules`
 * and registers them below.
 *
 * Only ENTITLED modules are registered: offering `example.solve(...)` to someone
 * who would then be told they may not use it is worse than offering nothing.
 */
const moduleGlobalCompletions: Completion[] = [];
const moduleMemberMap = new Map<string, Completion[]>();

/** Minimal shape of a catalog entry — declared structurally so this package does
 *  not need to depend on the module SDK just for autocomplete. */
interface ModuleCompletionSource {
  global: string;
  name?: string;
  description?: string;
  entitled?: boolean;
  completions?: Array<{ label: string; detail?: string; info?: string; type?: string }>;
}

/** Replace the registered module completions. Called by the editor whenever the
 *  module catalog loads or the signed-in user changes. */
export function registerModuleCompletions(modules: ReadonlyArray<ModuleCompletionSource>): void
{
  moduleGlobalCompletions.length = 0;
  moduleMemberMap.clear();

  for (const mod of modules)
  {
    if (!mod?.global || mod.entitled === false) continue;

    moduleGlobalCompletions.push({
      label: mod.global,
      type: 'variable',
      detail: mod.name ?? 'Archiyou module',
      info: mod.description,
    });

    if (mod.completions?.length)
    {
      moduleMemberMap.set(
        mod.global,
        mod.completions.map(c => ({
          label: c.label,
          type: (c.type === 'property' ? 'property' : 'method') as Completion['type'],
          detail: c.detail,
          info: c.info,
        })),
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Components: $component('name')                                     */
/* ------------------------------------------------------------------ */

/** A component offered in $component('…'): its reference, like `@archiyou/timberwall`
 *  (latest shared version) or `@mark/wall:dev` (latest script version, for own scripts),
 *  and whether it is one of the user's own workspace scripts (listed first). */
export interface ComponentNameSource
{
  label: string;
  own: boolean;
}

/** The components usable in $component('@author/name'). Like the modules they are only
 *  known at runtime, so the editor registers a provider, asked on every completion so
 *  the list is never stale. */
let componentNamesProvider: () => ReadonlyArray<ComponentNameSource> = () => [];

/** Set where the component names come from. Called by the editor. */
export function registerComponentNames(provider: () => ReadonlyArray<ComponentNameSource>): void
{
  componentNamesProvider = provider;
}

const COMPONENT_SECTIONS = {
  own:    { name: 'Your scripts', rank: 0 },
  shared: { name: 'Shared',       rank: 1 },
};

/** Methods of the importer $component('name') returns (RunnerComponentImporter). */
const componentImporterMembers: Completion[] = [
  { label: 'params',  type: 'method', detail: '(params: object): this',     info: 'Set the param values of the component' },
  { label: 'pipeline',type: 'method', detail: '(name: string): this',       info: 'Select the pipeline to get outputs from (default: "default")' },
  { label: 'noCache', type: 'method', detail: '(): this',                   info: 'Execute again instead of using a memoised result' },
  { label: 'info',    type: 'method', detail: '(): this',                   info: 'Print the params and outputs of the component to the console' },
  { label: 'model',   type: 'method', detail: '(): ShapeCollection',        info: 'Execute the component and get its model' },
  { label: 'docs',    type: 'method', detail: '(name?: string): Document|Document[]', info: 'Execute the component and get all its documents, or the one with the given name' },
  { label: 'get',     type: 'method', detail: '(...outputs: string|string[])', info: 'Execute the component and get outputs by path, like "default/docs/*"' },
  { label: 'all',     type: 'method', detail: '()',                         info: 'Execute the component and get all outputs of the pipeline' },
  { label: 'list',    type: 'method', detail: '(): string[]',               info: 'Print and return the names of the available components' },
];

/** Methods of `fab`, the fabrication facade (packages/core/src/modeler/Fab.ts). */
const fabMembers: Completion[] = [
  { label: 'operations',  type: 'method', detail: '(shapes, options?): FabOperations', info: 'Read how each part is cut, drilled and fastened, from the model and the norm book. The result has members(), contacts(), fastenings(), fasteners(), list(), parts() (the cut list), warnings(), table() and explain().' },
  { label: 'estimate',    type: 'method', detail: '(ops, options?): FabEstimate',      info: 'Time, stock and cost of the operations, by the norm book: hours, labour, material, total, lines, stock, warnings(), table(), metrics(), explain(). Every number names its norm row.' },
  { label: 'fasten',      type: 'method', detail: '(a, b, options?): Fastening',       info: 'Fasten two touching parts, optionally your way: { count: 3 }, { method: \'toe\' } or { fastener: { type: \'screw\', diameter: 5, length: 90 } }. Later operations() use it.' },
  { label: 'contact',     type: 'method', detail: '(a, b, options?): Contact | null',  info: 'How two parts touch (end-side, side-side, face-side, ...), or null' },
  { label: 'connections', type: 'method', detail: '(shapes, options?): Contact[]',     info: 'Every touching pair among the shapes' },
  { label: 'configure',   type: 'method', detail: '(change): fab',                     info: 'Change the norm book for this run, like { joints: { \'stud-plate\': { count: 3 } } }' },
  { label: 'normBook',    type: 'method', detail: '(tables, { name, version }): fab',  info: 'Use a norm book kept in a sheet for this run: { joints: wb.table(\'joints\'), times: wb.table(\'times\') }. The tables given replace those of fab.json; call it before configure().' },
  { label: 'config',      type: 'method', detail: '(): FabBook',                       info: 'The norm book in effect, with where every value came from' },
];

/** Importer methods that return the importer itself, so a chain stays completable. */
const COMPONENT_CHAIN_METHODS = new Set(['params', 'pipeline', 'noCache', 'info']);

/** Completion inside `$component(` / `$component('@ma`. Without a quote typed yet, the
 *  reference is inserted quoted. Own scripts come first, in their own section. */
function componentNameCompletion(context: CompletionContext): CompletionResult | null
{
  const m = context.matchBefore(/\$component\(\s*['"`]?[@\w./: -]*$/);
  if (!m) return null;

  const seen = new Set<string>();
  const sources = componentNamesProvider().filter(c => !seen.has(c.label) && seen.add(c.label));
  if (sources.length === 0) return null;

  const quoted = /\(\s*['"`]/.test(m.text);
  const nameStart = m.text.search(/[@\w./: -]*$/);

  return {
    from: m.from + nameStart,
    options: sources.map(c => ({
      label: c.label,
      type: 'constant',
      detail: c.own ? 'your latest version' : 'latest shared version',
      section: c.own ? COMPONENT_SECTIONS.own : COMPONENT_SECTIONS.shared,
      boost: c.own ? 1 : 0,
      apply: quoted ? c.label : `'${c.label}'`,
    })),
    validFor: /^[@\w./: -]*$/,
  };
}

/** True when `textBefore` (up to a `.`) ends in `$component(...)`, optionally followed by
 *  importer methods that return the importer (params, pipeline, …). */
function endsInComponentImporter(textBefore: string): boolean
{
  const statement = (textBefore.split(/[;\n]/).pop() ?? '');
  const start = statement.lastIndexOf('$component(');
  if (start < 0) return false;

  // Walk the chain after $component, skipping balanced (...) argument lists.
  let rest = statement.slice(start + '$component'.length);
  for (;;)
  {
    if (!rest.startsWith('(')) return false;
    let depth = 0, i = 0;
    for (; i < rest.length; i++)
    {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')' && --depth === 0) break;
    }
    if (depth !== 0) return false;
    rest = rest.slice(i + 1).trim();
    if (rest === '') return true;

    const call = rest.match(/^\.(\w+)\s*/);
    if (!call || !COMPONENT_CHAIN_METHODS.has(call[1])) return false;
    rest = rest.slice(call[0].length);
  }
}

/** Map from class name → static completions (Point, Vector, Bbox, OBbox) */
const staticMap = new Map<string, Completion[]>();

/** Map from class name → instance member completions */
const memberMap = new Map<string, Completion[]>();

for (const cls of shapeClasses)
{
  if (cls.statics && cls.statics.length > 0)
  {
    staticMap.set(
      cls.label,
      cls.statics.map(m => ({
        label: m.label,
        type: m.type === 'property' ? 'property' : 'method',
        detail: m.detail,
      })),
    );
  }

  memberMap.set(
    cls.label,
    cls.members.map(m => ({
      label: m.label,
      type: m.type === 'property' ? 'property' : 'method',
      detail: m.detail,
    })),
  );
}

/** All instance members merged (used when variable type cannot be determined) */
const allMembers: Completion[] = [];
{
  const seen = new Set<string>();
  for (const cls of shapeClasses)
  {
    for (const m of cls.members)
    {
      if (!seen.has(m.label))
      {
        seen.add(m.label);
        allMembers.push({
          label: m.label,
          type: m.type === 'property' ? 'property' : 'method',
          detail: m.detail,
        });
      }
    }
  }
}

/** Shape class names for `new ClassName` completions */
const classNameCompletions: Completion[] = shapeClasses.map(c => ({
  label: c.label,
  type: 'class',
  detail: c.detail,
}));

/* ------------------------------------------------------------------ */
/*  Completion source                                                  */
/* ------------------------------------------------------------------ */

/**
 * CodeMirror completion source for the Archiyou Modeler API.
 *
 * - `ClassName.` (e.g. `Point.`, `Vector.`) → static method completions
 * - `expr.`                                 → all known instance methods
 * - Top-level word                          → Modeler global functions
 * - After `new `                            → shape class names
 */
export function archiyouCompletions(
  context: CompletionContext,
): CompletionResult | null
{
  // $component('… → the names of the workspace components
  const componentNames = componentNameCompletion(context);
  if (componentNames) return componentNames;

  // ClassName. → static completions (Point.from, Vector.from, etc.)
  const dotMatch = context.matchBefore(/\b([A-Z]\w*)\.(\w*)$/);
  if (dotMatch)
  {
    const className = dotMatch.text.split('.')[0];
    const statics = staticMap.get(className);
    if (statics && statics.length > 0)
    {
      return {
        from: dotMatch.from + className.length + 1,
        options: statics,
        validFor: /^\w*$/,
      };
    }
  }

  // expr. → type-aware instance member completions
  const memberMatch = context.matchBefore(/\.\w*$/);
  if (memberMatch)
  {
    const docText = context.state.doc.toString();
    const textBefore = docText.slice(0, memberMatch.from);

    // `example.` on a registered module global. Checked before the type map,
    // which knows only about shape classes and would fall back to the union of
    // every shape member — badly wrong for a module.
    const moduleRoot = textBefore.match(/(\w+)$/)?.[1];
    if (moduleRoot === 'fab')
    {
      return {
        from: memberMatch.from + 1,
        options: fabMembers,
        validFor: /^\w*$/,
      };
    }
    const moduleMembers = moduleRoot ? moduleMemberMap.get(moduleRoot) : undefined;
    if (moduleMembers)
    {
      return {
        from: memberMatch.from + 1,
        options: moduleMembers,
        validFor: /^\w*$/,
      };
    }

    // `$component('wall').` → the importer's methods
    if (endsInComponentImporter(textBefore))
    {
      return {
        from: memberMatch.from + 1,
        options: componentImporterMembers,
        validFor: /^\w*$/,
      };
    }

    const scopeMap = buildScopeTypeMap(docText);
    const root = extractChainRoot(textBefore);
    const resolvedType = resolveType(root, scopeMap);
    const options = resolvedType ? (memberMap.get(resolvedType) ?? allMembers) : allMembers;
    return {
      from: memberMatch.from + 1,
      options,
      validFor: /^\w*$/,
    };
  }

  // `new ClassName` → shape class names
  const newMatch = context.matchBefore(/\bnew\s+\w*$/);
  if (newMatch)
  {
    const spaceIdx = newMatch.text.indexOf(' ') + 1;
    return {
      from: newMatch.from + spaceIdx,
      options: classNameCompletions,
      validFor: /^\w*$/,
    };
  }

  // Top-level word → Modeler global functions + keywords, merged with
  // identifiers the user defined in their own script (variables, function
  // declarations, parameters, classes) from the JS syntax tree.
  const wordMatch = context.matchBefore(/\b\w+$/);
  if (wordMatch)
  {
    return {
      from: wordMatch.from,
      options: mergeLocalIdentifiers(context),
      validFor: /^\w*$/,
    };
  }

  return null;
}

/**
 * Combines the static Archiyou API completions with identifiers the user defined
 * in their own script. Two sources, deduped by label (API entries win so their
 * richer detail/info is preserved):
 *  - CodeMirror's syntax-tree localCompletionSource — declarations (let/const/var,
 *    functions, parameters, classes).
 *  - A regex scan for bare assignments (`hallo = 'x'`) — implicit globals that the
 *    Archiyou scope allows but the syntax tree does not treat as declarations.
 */
function mergeLocalIdentifiers(context: CompletionContext): Completion[]
{
  const seen = new Set(topLevelCompletions.map(c => c.label));
  const extra: Completion[] = [];

  // Entitled module globals rank with the built-in API, above the user's own
  // identifiers — a module is part of the API for whoever has it.
  for (const m of moduleGlobalCompletions)
  {
    if (!seen.has(m.label)) { seen.add(m.label); extra.push(m); }
  }

  const local = localCompletionSource(context);
  if (local)
  {
    for (const o of local.options)
    {
      if (!seen.has(o.label)) { seen.add(o.label); extra.push(o); }
    }
  }

  for (const name of collectAssignedGlobals(context.state.doc.toString()))
  {
    if (!seen.has(name)) { seen.add(name); extra.push({ label: name, type: 'variable' }); }
  }

  return extra.length > 0 ? [...topLevelCompletions, ...extra] : topLevelCompletions;
}

/**
 * Scans the document for assignment targets at statement start — including bare
 * assignments without let/const/var (implicit globals). The `=` lookahead excludes
 * `==`/`=>`, and requiring the name directly before `=` excludes compound assigns
 * (`+=`, etc.). Returns the assigned identifier names.
 */
function collectAssignedGlobals(docText: string): Set<string>
{
  const names = new Set<string>();
  const re = /(?:^|[;{}\n])\s*(?:(?:let|const|var)\s+)?([a-zA-Z_$][\w$]*)\s*=(?![=>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) names.add(m[1]);
  return names;
}
