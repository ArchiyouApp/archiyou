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
 * Relative links and images are the one thing markdown cannot express safely here:
 * a README's `./docs/diagram.png` is a path in the module's own repository, which
 * the editor has no way to resolve. Those images become their alt text rather than
 * a broken-image icon — unless the caller can resolve them (`resolveImage`, used by
 * the help panel for images bundled next to its markdown).
 *
 * Synchronous, and markdown-it is imported statically: the editor already pulls it
 * in through @dile/editor (prosemirror-markdown), so deferring it would buy no
 * bundle at all — only a warning from the bundler about a module that is in the
 * eager graph either way.
 */

import MarkdownIt from 'markdown-it';
import type { RenderRule } from 'markdown-it/lib/renderer.mjs';
import DOMPurify from 'dompurify';

/** Absolute, loadable resource — anything else in a README points into a
 *  repository layout the editor cannot see. */
const ABSOLUTE = /^(https?:|data:)/i;

/** External destination, which should leave the editor rather than replace it. */
const EXTERNAL = /^https?:/i;

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
  const renderToken: RenderRule = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);
  const defaultLinkOpen = md.renderer.rules.link_open ?? renderToken;

  /** Send external links to a new tab. The editor is a workspace with unsaved
   *  state in it; navigating it away to read documentation would be a data loss. */
  md.renderer.rules.link_open = (tokens, idx, options, env, self) =>
  {
    const href = tokens[idx].attrGet('href') ?? '';
    if (EXTERNAL.test(href))
    {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

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

  return md;
}

export interface MarkdownOptions
{
  /** URL for a relative image path, or null to show its alt text instead.
   *  Only ever given paths the source wrote; the URL returned is trusted. */
  resolveImage?: (src: string) => string | null;
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
    ADD_ATTR: ['target', 'loading'],
  });
}
