/**
 * markdown.ts — render authored markdown to HTML safe to inject with unsafeHTML().
 *
 * Written for module READMEs (see editor/modules-menu.ts), which are documentation
 * files authored outside this repository and installed by whoever deploys the
 * backend. They are not user input, but they are also not ours, so nothing here
 * trusts them:
 *
 *   1. `html: false` — raw HTML in the source is ESCAPED, not rendered. Every tag
 *      in the output is one markdown-it itself emitted from the token stream, so
 *      there is no path from README text to live markup.
 *   2. markdown-it's own link validation already refuses `javascript:` and friends,
 *      and the rules below narrow it further: only absolute http(s)/data images
 *      load at all.
 *   3. DOMPurify on the way out, as defence in depth — the same belt-and-braces
 *      the document viewer applies to script-produced SVG. It is a no-op outside a
 *      browser, which is why the unit tests assert against the markdown-it layer
 *      rather than relying on it.
 *
 * Relative links and images are the one thing markdown cannot express here on its own:
 * a README's `./docs/diagram.png` is a path in the module's own repository, which
 * the editor has no way to resolve. Those images become their alt text rather than
 * a broken-image icon, and such links lose their anchor — unless the caller can
 * resolve them (`resolveImage` and `resolveLink`, used by the help panel for the
 * images and documents bundled next to its markdown).
 *
 * Starlight's asides (`:::tip[Title]` … `:::`, also note/caution/danger) render as
 * `<aside class="aside aside-tip">` with a title paragraph, so help written for the
 * docs site reads the same in the editor's help panel.
 *
 * Synchronous, and markdown-it is imported statically: the editor already pulls it
 * in through @dile/editor (prosemirror-markdown), so deferring it would buy no
 * bundle at all — only a warning from the bundler about a module that is in the
 * eager graph either way.
 */

import MarkdownIt from 'markdown-it';
import type { default as StateBlock, ParentType } from 'markdown-it/lib/rules_block/state_block.mjs';
import DOMPurify from 'dompurify';

/** Absolute, loadable resource — anything else in a README points into a
 *  repository layout the editor cannot see. */
const ABSOLUTE = /^(https?:|data:)/i;

/** External destination, which should leave the editor rather than replace it. */
const EXTERNAL = /^https?:/i;

/** Starlight aside fences: `:::<type>` with an optional `[Title]`, closed by a bare `:::` */
const ASIDE_OPEN = /^:::(note|tip|caution|danger)(?:\[(.*)\])?\s*$/;
const ASIDE_CLOSE = /^:::\s*$/;

/** The configured parser, built once and shared. */
const md = configure(new MarkdownIt({
  // See the file header — this is the property everything else rests on.
  html: false,
  // Bare URLs in documentation are meant as links; readers expect them to be.
  linkify: true,
  typographer: false,
}));

function configure(md: MarkdownIt): MarkdownIt
{
  /** Where every link ends up. External ones open in a new tab: the editor is a
   *  workspace with unsaved state in it, so navigating it away to read documentation
   *  would be a data loss. A relative one points into the caller's own collection of
   *  documents (a help file next to this one), which only the caller can resolve —
   *  what it resolves to becomes `data-help-doc` for the caller to act on, and an
   *  unresolvable link leaves its text behind, as an unresolvable image does. */
  md.core.ruler.push('links', state =>
  {
    const env = state.env as MarkdownOptions | undefined;

    state.tokens.forEach(block => block.children?.forEach((token, i, children) =>
    {
      if (token.type !== 'link_open') return;
      const href = token.attrGet('href') ?? '';

      if (EXTERNAL.test(href))
      {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
        return;
      }
      if (ABSOLUTE.test(href) || href.startsWith('#')) return;   // data:, mailto:, an anchor

      const doc = env?.resolveLink?.(href) ?? null;
      if (doc)
      {
        token.attrSet('href', '#');
        token.attrSet('data-help-doc', doc);
        return;
      }

      // Nothing to link to: unwrap it. Markdown cannot nest links, so the first
      // close belongs to this open.
      const close = children.slice(i + 1).find(t => t.type === 'link_close');
      [token, close].forEach(t => { if (t) { t.type = 'text'; t.tag = ''; t.attrs = null; t.content = ''; } });
    }));
  });

  /** Drop images the editor cannot resolve, keeping their alt text. */
  md.renderer.rules.image = (tokens, idx, options, env: MarkdownOptions | undefined, self) =>
  {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const alt = self.renderInlineAsText(token.children ?? [], options, env);

    const resolved = ABSOLUTE.test(src) ? null : env?.resolveImage?.(src) ?? null;
    if (!ABSOLUTE.test(src) && !resolved) return md.utils.escapeHtml(alt);
    if (resolved) token.attrSet('src', resolved);

    token.attrSet('alt', alt);
    token.attrSet('loading', 'lazy');
    return self.renderToken(tokens, idx, options);
  };

  md.block.ruler.before('fence', 'aside', aside, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  return md;
}

/** Block rule for Starlight's asides. The body is parsed as ordinary markdown; an
 *  aside without its closing `:::` runs to the end of the text, as a fence does. */
function aside(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean
{
  const lineText = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);

  if (state.sCount[startLine] - state.blkIndent >= 4) return false;   // indented code
  const open = ASIDE_OPEN.exec(lineText(startLine));
  if (!open) return false;
  if (silent) return true;

  // The ::: closing this aside, skipping those of asides nested inside it
  let depth = 0;
  const close = Array.from({ length: Math.max(0, endLine - startLine - 1) }, (_, i) => startLine + 1 + i)
    .find(line =>
    {
      const text = lineText(line);
      if (ASIDE_OPEN.test(text)) depth++;
      else if (ASIDE_CLOSE.test(text)) depth--;
      return depth < 0;
    });
  const end = close ?? endLine;

  const [, type, title] = open;
  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'aside' as ParentType;
  state.lineMax = end;

  const asideOpen = state.push('aside_open', 'aside', 1);
  asideOpen.attrSet('class', `aside aside-${type}`);
  asideOpen.markup = ':::';
  asideOpen.block = true;
  asideOpen.map = [startLine, end];

  state.push('aside_title_open', 'p', 1).attrSet('class', 'aside-title');
  const inline = state.push('inline', '', 0);
  inline.content = title?.trim() || type[0].toUpperCase() + type.slice(1);
  inline.map = [startLine, startLine + 1];
  inline.children = [];
  state.push('aside_title_close', 'p', -1);

  state.md.block.tokenize(state, startLine + 1, end);

  state.push('aside_close', 'aside', -1).block = true;
  state.parentType = oldParent;
  state.lineMax = oldLineMax;
  state.line = close === undefined ? end : end + 1;
  return true;
}

export interface MarkdownOptions
{
  /** URL for a relative image path, or null to show its alt text instead.
   *  Only ever given paths the source wrote; the URL returned is trusted. */
  resolveImage?: (src: string) => string | null;
  /** The document a relative link points to, or null to show its text unlinked.
   *  The value lands in `data-help-doc`; the component that injected the HTML
   *  opens it (the anchor's href is only `#`, so a stray click goes nowhere). */
  resolveLink?: (href: string) => string | null;
}

/**
 * Markdown → HTML, with none of the source's own markup surviving.
 *
 * Exported separately from renderMarkdown() so the escaping rules can be tested
 * where there is no DOM for DOMPurify to use.
 */
export function markdownToHtml(source: string, options: MarkdownOptions = {}): string
{
  return md.render(source ?? '', options);
}

/** Markdown → HTML, sanitized. This is what a component injects.
 *
 *  Outside a browser DOMPurify has no DOM to work with and its default export is
 *  a bare factory — no `sanitize` at all — so the call is skipped rather than
 *  allowed to throw. Nothing is lost by that: point 1 in the file header is what
 *  makes the output safe, and the sanitizer is the second lock on the same door. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string
{
  const html = markdownToHtml(source, options);
  if (typeof DOMPurify.sanitize !== 'function') return html;

  return DOMPurify.sanitize(html, {
    // `target` and `loading` are set by the rules above; DOMPurify's default
    // profile keeps both, but naming them makes the dependency explicit rather
    // than something a library upgrade can quietly take away.
    ADD_ATTR: ['target', 'loading', 'data-help-doc'],
  });
}
