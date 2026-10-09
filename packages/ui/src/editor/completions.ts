/**
 * CodeMirror autocompletion source for the Archiyou Modeler API.
 *
 * Provides completions for:
 *  - top-level Modeler functions (box, sphere, line, sketch, …)
 *  - instance methods on the shapes they return (Mesh, Curve, Polygon, ShapeCollection, …)
 *  - the `doc` global and the Document its chains build (doc.create('x').page('y').image(…))
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

/** A generated method as a completion. One with documented parameters, a return value or an
 *  example shows them in its info box, the example as code. */
function toCompletion(m: MethodInfo, type: string = (m.type === 'property' ? 'property' : 'method')): Completion
{
  const documented = m.params || m.returns || m.example;
  return { label: m.label, type, detail: m.detail, info: documented ? () => completionInfo(m) : m.info };
}

/** The info box of a documented method: what it does, its parameters, what it returns and an
 *  example. Built from text nodes only: the docs are not HTML. */
export function completionInfo(m: MethodInfo): HTMLElement
{
  const box = document.createElement('div');
  box.className = 'ay-completion-info';
  const add = (tag: string, className: string, text: string) =>
  {
    const el = box.appendChild(document.createElement(tag));
    el.className = className;
    el.textContent = text;
    return el;
  };

  if (m.info) add('div', 'ay-completion-doc', m.info);
  m.params?.forEach(p =>
  {
    const row = add('div', 'ay-completion-param', '');
    row.appendChild(document.createElement('code')).textContent = p.name;
    row.append(` ${p.info}`);
  });
  if (m.returns) add('div', 'ay-completion-returns', `Returns ${m.returns}`);
  if (m.example) add('pre', 'ay-completion-example', m.example);
  return box;
}

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
const topLevelCompletions: Completion[] = modelerFunctions.map(f => toCompletion(f, 'function'));

topLevelCompletions.push(
  { label: 'new',     type: 'keyword' },
  { label: 'const',   type: 'keyword' },
  { label: 'let',     type: 'keyword' },
  { label: 'await',   type: 'keyword' },
  { label: 'console', type: 'variable', detail: 'Console API' },
  { label: 'docs',    type: 'variable', detail: 'Documents: pages with views, text and images' },
  { label: 'make',    type: 'variable', detail: 'Make: frames, walls, boarding, packing and part lists' },
  { label: '$handle', type: 'function', detail: '(): Handle',
    info: 'Make a handle: a point in the viewer that users drag to change a parameter' },
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

/** The pipelines of the script being edited (`$pipeline('name', …)`), for `.pipeline('…`.
 *  Known from its last run, so the editor registers a provider like the component names. */
let pipelineNamesProvider: () => ReadonlyArray<string> = () => [];

/** Set where the pipeline names come from. Called by the editor. */
export function registerPipelineNames(provider: () => ReadonlyArray<string>): void
{
  pipelineNamesProvider = provider;
}

/** Completion inside `doc.pipeline(` / `.pipeline('dr`: the script's pipelines. Not on a
 *  `$component(…)` chain, whose pipelines are the component's own. */
function pipelineNameCompletion(context: CompletionContext): CompletionResult | null
{
  const m = context.matchBefore(/\.pipeline\(\s*['"`]?[\w -]*$/);
  if (!m) return null;
  if (endsInComponentImporter(context.state.doc.sliceString(0, m.from))) return null;

  const names = [...new Set(pipelineNamesProvider())];
  if (names.length === 0) return null;

  const quoted = /\(\s*['"`]/.test(m.text);
  const nameStart = m.text.search(/[\w -]*$/);
  return {
    from: m.from + nameStart,
    options: names.map(name => ({
      label: name,
      type: 'constant',
      detail: 'pipeline',
      apply: quoted ? name : `'${name}'`,
    })),
    validFor: /^[\w -]*$/,
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

/** Classes that are not shapes: their members only show where the type is known (a Handle
 *  after `$handle()`, Make after `make.`), and they are not made with `new` */
const NON_SHAPE_CLASSES = new Set(['Handle', 'Docs', 'Document', 'Make']);

for (const cls of shapeClasses)
{
  if (cls.statics && cls.statics.length > 0)
  {
    staticMap.set(cls.label, cls.statics.map(m => toCompletion(m)));
  }

  memberMap.set(cls.label, cls.members.map(m => toCompletion(m)));
}

/** All instance members merged (used when variable type cannot be determined) */
const allMembers: Completion[] = [];
{
  const seen = new Set<string>();
  for (const cls of shapeClasses.filter(c => !NON_SHAPE_CLASSES.has(c.label)))
  {
    for (const m of cls.members)
    {
      if (!seen.has(m.label))
      {
        seen.add(m.label);
        allMembers.push(toCompletion(m));
      }
    }
  }
}

/** Shape class names for `new ClassName` completions */
const classNameCompletions: Completion[] = shapeClasses.filter(c => !NON_SHAPE_CLASSES.has(c.label)).map(c => ({
  label: c.label,
  type: 'class',
  detail: c.detail,
}));

/* ------------------------------------------------------------------ */
/*  Docs: doc.create('x').page('y').image(…)                           */
/* ------------------------------------------------------------------ */

/** Methods of Docs/Document that end the chain: they return something other than the
 *  Document (a block, a list of names, an Instruct) */
const DOCS_CHAIN_ENDS = new Set(['lastBlock', 'docs', 'instruct']);

/**
 * Walks a method chain backwards from its end (the text before a `.`), across lines,
 * and returns its root identifier and the methods called on it, in order:
 *   `doc\n  .create('a')\n  .page('b')` → { root: 'doc', calls: ['create', 'page'] }
 * Null when the text does not end in a chain. Parentheses inside strings are not
 * understood — good enough for completion.
 */
export function chainBackwards(textBefore: string): { root: string; calls: string[] } | null
{
  let i = textBefore.length;
  const calls: string[] = [];
  const skipSpace = () => { while (i > 0 && /\s/.test(textBefore[i - 1])) i--; };

  for (;;)
  {
    skipSpace();
    if (textBefore[i - 1] === ')')
    {
      let depth = 0;
      do
      {
        i--;
        if (textBefore[i] === ')') depth++;
        else if (textBefore[i] === '(') depth--;
      }
      while (i > 0 && depth > 0);
      if (depth !== 0) return null;
      skipSpace();
    }

    const name = textBefore.slice(0, i).match(/[A-Za-z_$][\w$]*$/)?.[0];
    if (!name) return null;
    i -= name.length;
    skipSpace();

    if (textBefore[i - 1] !== '.') return { root: name, calls: calls.reverse() };
    calls.push(name);
    i--;
  }
}

/** The docs global, and `doc`, its older name that scripts still use */
const DOCS_GLOBALS = new Set(['docs', 'doc']);

/** Variables holding the docs global or a Document: `d = docs` → Docs, `d = docs.create('x')` → Document */
function buildDocsScopeMap(docText: string): Map<string, 'Docs' | 'Document'>
{
  const map = new Map<string, 'Docs' | 'Document'>();
  const re = /\b([A-Za-z_$][\w$]*)\s*=\s*docs?\b(\s*\.)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) map.set(m[1], m[2] ? 'Document' : 'Docs');
  return map;
}

/** Which docs class the chain before a `.` holds — 'Docs' for `docs.` (or `doc.`), 'Document'
 *  anywhere down a chain on it — or null when it is not a docs chain */
export function resolveDocsType(textBefore: string, docText: string): 'Docs' | 'Document' | null
{
  const chain = chainBackwards(textBefore);
  if (!chain) return null;
  if (chain.calls.some(c => DOCS_CHAIN_ENDS.has(c))) return null;

  const rootType = DOCS_GLOBALS.has(chain.root) ? 'Docs' : buildDocsScopeMap(docText).get(chain.root);
  if (!rootType) return null;

  return (rootType === 'Docs' && chain.calls.length === 0) ? 'Docs' : 'Document';
}

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

  // .pipeline('… → the pipelines of the script
  const pipelineNames = pipelineNameCompletion(context);
  if (pipelineNames) return pipelineNames;

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
    const moduleMembers = moduleRoot ? moduleMemberMap.get(moduleRoot) : undefined;
    if (moduleMembers)
    {
      return {
        from: memberMatch.from + 1,
        options: moduleMembers,
        validFor: /^\w*$/,
      };
    }

    // `make.` → the methods of the make global. What they return are shapes, a Table or
    // angles, so further down a chain the general lookup below takes over.
    const chain = chainBackwards(textBefore);
    if (chain?.root === 'make' && chain.calls.length === 0)
    {
      return {
        from: memberMatch.from + 1,
        options: memberMap.get('Make') ?? [],
        validFor: /^\w*$/,
      };
    }

    // `docs.` and every link of a chain on it (also across lines) → Docs / Document methods
    const docsType = resolveDocsType(textBefore, docText);
    if (docsType)
    {
      return {
        from: memberMatch.from + 1,
        options: memberMap.get(docsType) ?? [],
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
  // declarations, parameters, classes) from the JS syntax tree. A leading `$` is
  // part of the word, so `$ha` completes to `$handle` instead of `$$handle`.
  const wordMatch = context.matchBefore(/(?:\$\w*|\b\w+)$/);
  if (wordMatch)
  {
    return {
      from: wordMatch.from,
      options: mergeLocalIdentifiers(context),
      validFor: /^\$?\w*$/,
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
