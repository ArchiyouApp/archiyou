/**
 * Help content: the markdown conventions of help/<locale>/*.md (see
 * src/editor/help/help-content.ts), and the content files themselves.
 *
 * The files are checked here, not only parsed at runtime, because a broken help
 * file fails quietly in the editor: a step without its code, a spotlight that
 * never shows. The Runner test in packages/core (runner.help.test.ts) executes
 * every tutorial step; this suite checks structure.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  parseHelpDoc, codeAt, hasCode, unknownHighlights, helpTags, unknownTags, resolveHelpPath,
} from '../src/editor/help/help-content.js';

const HELP_DIR = path.resolve(import.meta.dirname, '../../../help');

const SAMPLE = `---
title: "A sample"
level: beginner
order: 3
---

Intro text.

## First step
<!-- highlight: code, run -->
Some *prose*.

\`\`\`js run
a = box(10)
\`\`\`

\`\`\`js
// display only
\`\`\`

## Second step
<!-- a plain comment is dropped -->
\`\`\`js append
b = sphere(5)
\`\`\`

More prose.

## Third step

No code here.
`;

describe('parseHelpDoc', () =>
{
  const doc = parseHelpDoc(SAMPLE);

  it('reads flat frontmatter and strips quotes', () =>
  {
    expect(doc.meta).toEqual({ title: 'A sample', level: 'beginner', order: '3' });
  });

  it('keeps text before the first step as the intro', () =>
  {
    expect(doc.intro).toEqual([{ kind: 'markdown', text: 'Intro text.' }]);
  });

  it('starts a step at every ## heading', () =>
  {
    expect(doc.steps.map(s => s.title)).toEqual(['First step', 'Second step', 'Third step']);
  });

  it('reads highlight comments and removes every comment from the prose', () =>
  {
    expect(doc.steps[0].highlight).toEqual(['code', 'run']);
    expect(doc.steps[1].highlight).toEqual([]);
    const prose = doc.steps.flatMap(s => s.blocks).filter(b => b.kind === 'markdown').map(b => b.text).join('\n');
    expect(prose).not.toContain('<!--');
  });

  it('splits prose and code blocks in order, with the fence action', () =>
  {
    expect(doc.steps[0].blocks).toEqual([
      { kind: 'markdown', text: 'Some *prose*.' },
      { kind: 'code', lang: 'js', action: 'run', code: 'a = box(10)' },
      { kind: 'code', lang: 'js', action: null, code: '// display only' },
    ]);
    expect(doc.steps[1].blocks.map(b => b.kind)).toEqual(['code', 'markdown']);
  });

  it('does not start a step at a ## line inside a code block', () =>
  {
    const inner = parseHelpDoc('## Step\n```md\n## not a step\n```\n');
    expect(inner.steps).toHaveLength(1);
    expect(inner.steps[0].blocks[0]).toMatchObject({ kind: 'code', code: '## not a step' });
  });

  it('works without frontmatter and with CRLF line ends', () =>
  {
    const crlf = parseHelpDoc('## One\r\n```js run\r\nx = 1\r\n```\r\n');
    expect(crlf.meta).toEqual({});
    expect(codeAt(crlf, 0)).toBe('x = 1');
  });
});

describe('codeAt', () =>
{
  const doc = parseHelpDoc(SAMPLE);

  it('folds run and append blocks up to a step', () =>
  {
    expect(codeAt(doc, 0)).toBe('a = box(10)');
    expect(codeAt(doc, 1)).toBe('a = box(10)\nb = sphere(5)');
  });

  it('carries the code through a step without code', () =>
  {
    expect(codeAt(doc, 2)).toBe(codeAt(doc, 1));
  });

  it('stops at a block within a step', () =>
  {
    expect(codeAt(doc, 1, -1)).toBe('a = box(10)');
    expect(codeAt(doc, 1, 0)).toBe('a = box(10)\nb = sphere(5)');
  });

  it('lets run replace everything before it', () =>
  {
    const replaced = parseHelpDoc('## A\n```js run\nx\n```\n## B\n```js run\ny\n```\n');
    expect(codeAt(replaced, 1)).toBe('y');
  });

  it('is null when nothing has touched the code yet', () =>
  {
    expect(codeAt(parseHelpDoc('## Only prose\nHello'), 0)).toBeNull();
  });
});

describe('tags and paths', () =>
{
  it('reads comma separated tags, trimmed and lower case', () =>
  {
    const doc = parseHelpDoc('---\ntags: Beginner, modeling ,IO\n---\n## A\n');
    expect(helpTags(doc)).toEqual(['beginner', 'modeling', 'io']);
    expect(unknownTags(doc)).toEqual([]);
    expect(unknownTags(parseHelpDoc('---\ntags: beginner, cooking\n---\n'))).toEqual(['cooking']);
    expect(helpTags(parseHelpDoc('## no frontmatter'))).toEqual([]);
  });

  it('resolves a path against the file it is written in', () =>
  {
    expect(resolveHelpPath('en/tutorials/table', 'table.webp')).toBe('en/tutorials/table.webp');
    expect(resolveHelpPath('en/tutorials/table', './img/a.gif')).toBe('en/tutorials/img/a.gif');
    expect(resolveHelpPath('en/tutorials/table', '../tour.gif')).toBe('en/tour.gif');
    expect(resolveHelpPath('en/onboarding', '../../../secret.png')).toBeNull();
    expect(resolveHelpPath('en/onboarding', 'https://x.org/a.png')).toBeNull();
    expect(resolveHelpPath('en/onboarding', '/abs.png')).toBeNull();
  });
});

describe('help content files', () =>
{
  const files = listMarkdown(HELP_DIR);
  const locales = fs.readdirSync(HELP_DIR).filter(f => fs.statSync(path.join(HELP_DIR, f)).isDirectory());

  it('has English content', () =>
  {
    expect(files.some(f => f.startsWith('en/tutorials/'))).toBe(true);
    expect(files).toContain('en/onboarding.md');
  });

  files.forEach(file =>
  {
    const doc = parseHelpDoc(fs.readFileSync(path.join(HELP_DIR, file), 'utf8'));

    it(`${file}: has a title and steps`, () =>
    {
      expect(doc.meta.title).toBeTruthy();
      expect(doc.steps.length).toBeGreaterThan(0);
    });

    it(`${file}: only spotlights targets the editor provides`, () =>
    {
      expect(unknownHighlights(doc)).toEqual([]);
    });

    it(`${file}: has every image it refers to, next to it`, () =>
    {
      const markdown = doc.steps.flatMap(s => s.blocks).concat(doc.intro)
        .filter(b => b.kind === 'markdown')
        .map(b => b.text)
        .join('\n');
      const images = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map(m => m[1])
        .concat(doc.meta.thumbnail ? [doc.meta.thumbnail] : [])
        .filter(src => !/^(https?:|data:)/i.test(src));

      images.forEach(src =>
      {
        const target = resolveHelpPath(file.replace(/\.md$/, ''), src);
        // A translation may lean on the English image
        const english = target?.replace(/^[^/]+\//, 'en/');
        const found = [target, english].some(p => p && fs.existsSync(path.join(HELP_DIR, p)));
        expect(found, `${file}: missing image ${src}`).toBe(true);
      });
    });

    if (file.includes('/tutorials/'))
    {
      it(`${file}: has tags, all of them tabs in the tutorial list`, () =>
      {
        expect(helpTags(doc).length).toBeGreaterThan(0);
        expect(unknownTags(doc)).toEqual([]);
      });

      it(`${file}: is a tutorial whose first code block replaces the script`, () =>
      {
        expect(hasCode(doc)).toBe(true);
        const first = doc.steps.flatMap(s => s.blocks).find(b => b.kind === 'code' && b.action);
        expect(first).toMatchObject({ action: 'run' });
      });
    }
  });

  // A translation must keep the structure of its English source, or Back/Next and
  // the code of each step would differ between languages.
  locales.filter(l => l !== 'en').forEach(locale =>
  {
    files.filter(f => f.startsWith(`${locale}/`)).forEach(file =>
    {
      it(`${file}: matches the steps and code of the English file`, () =>
      {
        const source = path.join(HELP_DIR, 'en', file.slice(locale.length + 1));
        expect(fs.existsSync(source), `no English source for ${file}`).toBe(true);
        const en = parseHelpDoc(fs.readFileSync(source, 'utf8'));
        const tr = parseHelpDoc(fs.readFileSync(path.join(HELP_DIR, file), 'utf8'));
        expect(tr.steps.map(s => s.highlight)).toEqual(en.steps.map(s => s.highlight));
        expect(tr.steps.map((_, i) => codeAt(tr, i))).toEqual(en.steps.map((_, i) => codeAt(en, i)));
      });
    });
  });
});

/** Markdown files under `dir`, relative to it, with forward slashes. */
function listMarkdown(dir: string): string[]
{
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map(f => f.split(path.sep).join('/'))
    .filter(f => f.endsWith('.md'))
    .sort();
}
