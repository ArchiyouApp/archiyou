/**
 * help.ts — what the docs site needs to know about help/ at the repository root:
 * how its files become page ids, which languages it has, and the sidebar.
 *
 * help/ is laid out by section first, help/<section>/<locale>/<page>.md, because the
 * editor's help panel plays the same files. Starlight expects the locale first and its
 * pages in src/content/docs/, so:
 *
 *  - helpId() gives each file the id Starlight routes and localises by (English is the
 *    root locale, without a prefix):
 *      help/tutorials/en/simple-table.md → tutorials/simple-table    → /tutorials/simple-table/
 *      help/tutorials/nl/simple-table.md → nl/tutorials/simple-table → /nl/tutorials/simple-table/
 *      help/guide/en/modeling/index.md   → guide/modeling            → /guide/modeling/
 *      help/site/en/index.md             → index                     → /  (section "site": site pages)
 *  - a language is on as soon as help/ has a folder for it: adding translations is enough
 *  - the sidebar is built here from the English files, because Starlight's `autogenerate`
 *    only looks in src/content/docs/. Items are slugs, so Starlight shows each page in the
 *    reader's language, or in English with a notice when it is not translated yet.
 *
 * Plain Node (no astro:content), so astro.config.mjs can use it too.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_LOCALE = 'en';

/** Every language the help content may come in (plans/HELP.md, first wave). Keys are the
 *  folder names, lower case like Starlight's (zh-cn, not zh-CN). */
export const LANGUAGES: Record<string, { label: string, lang: string, dir?: 'rtl' }> = {
  en:      { label: 'English',    lang: 'en' },
  nl:      { label: 'Nederlands', lang: 'nl' },
  de:      { label: 'Deutsch',    lang: 'de' },
  fr:      { label: 'Français',   lang: 'fr' },
  es:      { label: 'Español',    lang: 'es' },
  pt:      { label: 'Português',  lang: 'pt' },
  it:      { label: 'Italiano',   lang: 'it' },
  pl:      { label: 'Polski',     lang: 'pl' },
  tr:      { label: 'Türkçe',     lang: 'tr' },
  ja:      { label: '日本語',      lang: 'ja' },
  'zh-cn': { label: '简体中文',    lang: 'zh-CN' },
  ko:      { label: '한국어',      lang: 'ko' },
  ar:      { label: 'العربية',    lang: 'ar', dir: 'rtl' },
};

/** The sidebar, top to bottom: help/ sections and their labels. Sections not listed
 *  here (like "site") have pages but no sidebar group. */
const SIDEBAR_SECTIONS = [
  { dir: 'onboarding', label: 'Start' },
  { dir: 'tutorials', label: 'Tutorials' },
  { dir: 'guide', label: 'Guide' },
];

//// IDS ////

/** help/<section>/<locale>/<rest>.md (relative to help/) → Starlight page id */
export function helpId(entry: string): string
{
  const [section, locale, ...rest] = entry.replace(/\.mdx?$/, '').split('/');
  const parts = [
    locale.toLowerCase() === DEFAULT_LOCALE ? null : locale.toLowerCase(),
    section === 'site' ? null : section,
    ...rest,
  ].filter((p): p is string => !!p);

  const id = parts.join('/').replace(/(^|\/)index$/, '');
  return id || 'index';
}

//// LANGUAGES ////

/** Locale folders present in help/, in LANGUAGES order */
export function helpLocales(helpDir: string): string[]
{
  const found = new Set(subdirs(helpDir)
    .flatMap(section => subdirs(join(helpDir, section)).map(l => l.toLowerCase())));
  return Object.keys(LANGUAGES).filter(l => found.has(l));
}

/** Starlight's `locales`: English at the root (no prefix), the others under /<locale>/ */
export function starlightLocales(helpDir: string)
{
  return Object.fromEntries(helpLocales(helpDir).map(l =>
    [l === DEFAULT_LOCALE ? 'root' : l, LANGUAGES[l]]));
}

//// SIDEBAR ////

type SidebarItem = { slug: string, label?: string } | { label: string, collapsed?: boolean, items: SidebarItem[] };

/** Starlight's `sidebar`, from the English files of SIDEBAR_SECTIONS */
export function helpSidebar(helpDir: string): SidebarItem[]
{
  return SIDEBAR_SECTIONS
    .filter(s => statSafe(join(helpDir, s.dir, DEFAULT_LOCALE)))
    .map(s => ({ label: s.label, items: dirItems(join(helpDir, s.dir, DEFAULT_LOCALE), `${s.dir}/${DEFAULT_LOCALE}`, false) }));
}

/** A folder's pages (index first, then by `order`, then name) and its subfolders as
 *  collapsed groups, labelled with the title of their index.md */
function dirItems(dir: string, rel: string, nested: boolean): SidebarItem[]
{
  const pages = readdirSync(dir)
    .filter(f => /\.mdx?$/.test(f))
    .filter(f => !(nested && /^index\.mdx?$/.test(f)))   // a group's index is its first item below
    .map(f => ({ file: f, ...frontmatter(join(dir, f)) }))
    .sort((a, b) => Number(/^index\./.test(b.file)) - Number(/^index\./.test(a.file))
      || (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file))
    .map(p => ({ slug: helpId(`${rel}/${p.file}`) }));

  const groups = subdirs(dir)
    .map(sub =>
    {
      const index = readdirSync(join(dir, sub)).find(f => /^index\.mdx?$/.test(f));
      const meta = index ? frontmatter(join(dir, sub, index)) : {};
      // The group already carries the index page's title
      const items: SidebarItem[] = [
        ...(index ? [{ slug: helpId(`${rel}/${sub}/${index}`), label: 'Overview' }] : []),
        ...dirItems(join(dir, sub), `${rel}/${sub}`, true),
      ];
      return { label: meta.title ?? sub, order: meta.order, collapsed: true, items };
    })
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.label.localeCompare(b.label))
    .map(({ order: _order, ...group }) => group);

  return [...pages, ...groups];
}

/** title and order from a file's frontmatter, enough to label and sort it */
function frontmatter(file: string): { title?: string, order?: number }
{
  const head = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const value = (key: string) => head.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'))?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
  const order = value('order');
  return { title: value('title'), order: order === undefined ? undefined : Number(order) };
}

function subdirs(dir: string): string[]
{
  return readdirSync(dir).filter(f => statSafe(join(dir, f))?.isDirectory());
}

function statSafe(path: string)
{
  try { return statSync(path); }
  catch { return null; }
}
