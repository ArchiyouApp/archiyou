/**
 * Rendering a module README to HTML.
 *
 * The source is a markdown file authored outside this repository and installed
 * by whoever deploys the backend — not user input, but not ours either, and it
 * ends up inside unsafeHTML(). DOMPurify is a no-op here (node, no DOM), which
 * is the point: everything asserted below is a property of the markdown-it layer
 * alone, so the safety does not rest on the sanitizer that only exists in a
 * browser.
 */

import { describe, it, expect } from 'vitest';

import { markdownToHtml, renderMarkdown } from '../src/utils/markdown.js';

describe('markdownToHtml — what a README may not do', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const out = markdownToHtml('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');

    // The text survives, as text. No tag in the output came from the source.
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('refuses a javascript: link', () => {
    const out = markdownToHtml('[click](javascript:alert(1))');

    // markdown-it declines to make a link at all, leaving the source as inert
    // text — so the assertion is about the anchor, not about the substring.
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href=');
  });

  it('refuses a javascript: image', () => {
    const out = markdownToHtml('![x](javascript:alert(1))');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('src=');
  });

  it('leaves an inline HTML comment inert', () => {
    // A comment is the classic way to smuggle markup past a naive renderer.
    expect(markdownToHtml('<!-- <script>alert(1)</script> -->')).not.toContain('<script>');
  });
});

describe('markdownToHtml — what a README is for', () => {
  it('renders headings, code fences and tables', () => {
    const out = markdownToHtml([
      '# Title',
      '',
      '```js',
      "box(10)",
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n'));

    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<pre><code');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>1</td>');
  });

  it('opens external links in a new tab, safely', () => {
    const out = markdownToHtml('[docs](https://archiyou.com/docs)');

    // The editor holds unsaved work; navigating it away to read a link would
    // be data loss.
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('leaves an in-page anchor alone', () => {
    const out = markdownToHtml('[section](#usage)');
    expect(out).toContain('href="#usage"');
    expect(out).not.toContain('target=');
  });

  it('linkifies a bare URL', () => {
    expect(markdownToHtml('See https://archiyou.com for more'))
      .toContain('href="https://archiyou.com"');
  });

  it('keeps an absolute image', () => {
    const out = markdownToHtml('![diagram](https://example.com/d.png)');
    expect(out).toContain('<img');
    expect(out).toContain('https://example.com/d.png');
  });

  it('replaces a repository-relative image with its alt text', () => {
    // './docs/diagram.png' is a path in the module's own repository, which the
    // editor cannot resolve — a broken-image icon would say less than the words.
    const out = markdownToHtml('![a diagram](./docs/diagram.png)');

    expect(out).not.toContain('<img');
    expect(out).toContain('a diagram');
  });

  it('escapes the alt text it falls back to', () => {
    const out = markdownToHtml('![<b>bold</b>](./x.png)');
    expect(out).not.toContain('<b>');
  });

  it('renders an empty source to nothing', () => {
    expect(markdownToHtml('')).toBe('');
  });
});

describe('renderMarkdown', () => {
  it('does not throw where there is no DOM for DOMPurify', () => {
    // The sanitizer's default export outside a browser is a bare factory with
    // no sanitize() on it. Calling it anyway threw — and it is reached from the
    // modules menu, where a throw takes the whole modal down.
    const source = '# Title\n\nSome **text**.';
    expect(renderMarkdown(source)).toBe(markdownToHtml(source));
  });
});
