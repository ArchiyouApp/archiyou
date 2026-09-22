/**
 * help-content.ts — parse help markdown (onboarding, tutorials) into steps.
 *
 * The files live in `help/<section>/<locale>/` at the repository root and are plain markdown,
 * so they read well on GitHub, on a future docs site and to a translator. Three
 * conventions carry the extra meaning, all invisible to a normal markdown renderer:
 *
 *   1. Flat frontmatter (`key: value` lines between `---`) — title, description, order,
 *      tags (comma separated, see HELP_TAGS) and thumbnail (an image next to the file).
 *      Images in the text (`![alt](tour.gif)`) are also relative to the file.
 *   2. Every `## ` heading starts a step. Text before the first one is the intro.
 *   3. A word after a code fence's language says what the editor does with it:
 *        ```js run     replace the tutorial's code with this block, then execute
 *        ```js append  add this block to the tutorial's code so far, then execute
 *        ```js         display only
 *      and an HTML comment `<!-- highlight: viewer -->` spotlights a UI element
 *      (ids in HELP_TARGETS) while the step is shown.
 *
 * Pure and DOM-free: the editor, the unit tests and the Runner test that executes
 * every tutorial step all use it.
 */

/** What an editor does with a code block. */
export type HelpFenceAction = 'run' | 'append';

export interface HelpMarkdownBlock
{
  kind: 'markdown';
  text: string;
}

export interface HelpCodeBlock
{
  kind: 'code';
  lang: string;
  /** null for a display-only block */
  action: HelpFenceAction | null;
  code: string;
}

export type HelpBlock = HelpMarkdownBlock | HelpCodeBlock;

export interface HelpStep
{
  title: string;
  /** UI targets to spotlight while this step is shown */
  highlight: string[];
  blocks: HelpBlock[];
}

export interface HelpDoc
{
  meta: Record<string, string>;
  /** Blocks before the first step */
  intro: HelpBlock[];
  steps: HelpStep[];
}

/** UI elements a help step may spotlight, each marked with `data-help="<id>"` in the editor.
 *  Add the attribute and the id together; a unit test fails on ids used in content but not listed here. */
export const HELP_TARGETS = Object.freeze([
  'main-menu',
  'file-menu',
  'file-info',
  'params',
  'code',
  'run',
  'viewer',
  'toolbar',
  'tool-console',
  'tool-scene',
  'tool-docs',
  'tool-help',
] as const);

export type HelpTarget = typeof HELP_TARGETS[number];

/** Tags a tutorial may carry; each is a tab in the tutorial list, in this order.
 *  A unit test fails on tags used in content but not listed here. */
export const HELP_TAGS = Object.freeze([
  'beginner',
  'advanced',
  'practical',
  'modeling',
  'documentation',
  'io',
  'publishing',
] as const);

export type HelpTag = typeof HELP_TAGS[number];

/** The document's tags from its `tags:` frontmatter, lower case. */
export function helpTags(doc: HelpDoc): string[]
{
  return (doc.meta.tags ?? '')
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
}

/** Tags the content uses that have no tab. */
export function unknownTags(doc: HelpDoc): string[]
{
  return helpTags(doc).filter(tag => !(HELP_TAGS as readonly string[]).includes(tag));
}

/** Resolve a path written in a help file (`thumbnail:`, an image) against that file's
 *  own path, e.g. ('tutorials/en/table', './table.png') → 'tutorials/en/table.png'.
 *  null for an absolute URL or a path that climbs out of the help directory. */
export function resolveHelpPath(filePath: string, relative: string): string | null
{
  if (/^([a-z]+:|\/)/i.test(relative)) return null;

  const parts = relative.split('/').reduce<string[] | null>((dir, part) =>
  {
    if (!dir || part === '.' || part === '') return dir;
    if (part === '..') return dir.length ? dir.slice(0, -1) : null;
    return [...dir, part];
  }, filePath.split('/').slice(0, -1));

  return parts ? parts.join('/') : null;
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)\s*(.*)$/;
const STEP = /^##\s+(.+?)\s*#*\s*$/;
const HIGHLIGHT = /<!--\s*highlight:\s*([^>]*?)\s*-->/g;
const COMMENT = /<!--[\s\S]*?-->/g;

/** Parse one help markdown file. Never throws: malformed input yields fewer steps, not an error. */
export function parseHelpDoc(source: string): HelpDoc
{
  const { meta, body } = splitFrontmatter(source.replace(/\r\n?/g, '\n'));

  const doc: HelpDoc = { meta, intro: [], steps: [] };
  let blocks = doc.intro;
  let prose: string[] = [];
  let fence: { marker: string, lang: string, action: HelpFenceAction | null, lines: string[] } | null = null;

  const flushProse = () =>
  {
    const text = prose.join('\n').replace(COMMENT, '').trim();
    if (text) blocks.push({ kind: 'markdown', text });
    prose = [];
  };

  body.split('\n').forEach(line =>
  {
    if (fence)
    {
      if (line.trim().startsWith(fence.marker) && line.trim().replace(/[`~]/g, '') === '')
      {
        blocks.push({ kind: 'code', lang: fence.lang, action: fence.action, code: fence.lines.join('\n') });
        fence = null;
      }
      else
      {
        fence.lines.push(line);
      }
      return;
    }

    const open = line.match(FENCE);
    if (open)
    {
      flushProse();
      const words = open[4].split(/\s+/);
      const action = (['run', 'append'] as const).find(a => words.includes(a)) ?? null;
      fence = { marker: open[2], lang: open[3], action, lines: [] };
      return;
    }

    const heading = line.match(STEP);
    if (heading)
    {
      flushProse();
      const step: HelpStep = { title: heading[1], highlight: [], blocks: [] };
      doc.steps.push(step);
      blocks = step.blocks;
      return;
    }

    const step = doc.steps[doc.steps.length - 1];
    if (step)
    {
      [...line.matchAll(HIGHLIGHT)]
        .flatMap(m => m[1].split(/[\s,]+/))
        .filter(Boolean)
        .forEach(id => step.highlight.push(id));
    }
    prose.push(line);
  });

  // An unclosed fence still counts, as markdown renderers treat it
  if (fence)
  {
    const open = fence as { lang: string, action: HelpFenceAction | null, lines: string[] };
    blocks.push({ kind: 'code', lang: open.lang, action: open.action, code: open.lines.join('\n') });
  }
  flushProse();

  return doc;
}

/** The tutorial's code after applying every run/append block up to and including
 *  `stepIndex` (and within that step up to `blockIndex`, when given).
 *  null when nothing up to there touches the code. */
export function codeAt(doc: HelpDoc, stepIndex: number, blockIndex?: number): string | null
{
  return doc.steps
    .slice(0, stepIndex + 1)
    .flatMap((step, i) => i === stepIndex && blockIndex !== undefined
      ? step.blocks.slice(0, blockIndex + 1)
      : step.blocks)
    .reduce<string | null>((code, block) =>
    {
      if (block.kind !== 'code' || !block.action) return code;
      if (block.action === 'run' || code === null) return block.code;
      return code.replace(/\n*$/, '\n') + block.code;
    }, null);
}

/** True when the document changes the script, i.e. is a tutorial rather than a tour. */
export function hasCode(doc: HelpDoc): boolean
{
  return doc.steps.some(step => step.blocks.some(b => b.kind === 'code' && b.action));
}

/** Highlight ids the content uses that the editor does not provide. */
export function unknownHighlights(doc: HelpDoc): string[]
{
  return doc.steps
    .flatMap(step => step.highlight)
    .filter(id => !(HELP_TARGETS as readonly string[]).includes(id));
}

/** Split `---` frontmatter of flat `key: value` lines off the body. */
function splitFrontmatter(source: string): { meta: Record<string, string>, body: string }
{
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, body: source };

  const meta = Object.fromEntries(match[1]
    .split('\n')
    .map(line => line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]));

  return { meta, body: source.slice(match[0].length) };
}
