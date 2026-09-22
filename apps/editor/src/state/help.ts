/// <reference types="vite/client" />
/**
 * state/help.ts — the help panel: which help document is open, at which step.
 *
 * Help content is markdown in `help/<section>/<locale>/` at the repository root
 * (format: packages/ui/src/editor/help/help-content.ts). The editor uses the sections
 * `onboarding` and `tutorials`; the docs site (apps/docs) shows those and the rest of
 * help/. They are bundled with the editor as lazy chunks, one per file, so a document
 * is fetched when it is first opened and always matches the editor version it ships
 * with. A file missing in the reader's language falls back to English.
 *
 * Running a step's code needs the editor page (it owns execution), which is not in
 * the help panel's component tree — the page registers a runner here, the same
 * indirection state/viewer.ts uses for handle drags.
 */

import { signal, computed } from '@lit-labs/signals';

import { parseHelpDoc, codeAt, hasCode, resolveHelpPath, type HelpDoc } from '@archiyou/ui/editor/help/help-content.js';
import { indexApi, lookupAt, type ApiIndex, type ApiLookup, type ApiEntry } from '@archiyou/ui/editor/help/help-reference.js';
import { createNewScript, updateScriptName } from './core';
import { scriptParams, deleteParam } from './editor';

//// SETTINGS ////

const DEFAULT_LOCALE = 'en';
/** Set once the tour has been shown automatically, so it appears on a first visit only. */
const ONBOARDED_KEY = 'archiyou:help:onboarded';
/** The reference's "follow the cursor" switch, remembered per browser */
const FOLLOW_CURSOR_KEY = 'archiyou:help:follow-cursor';
/** Wait for the cursor to rest before looking up the word under it */
const FOLLOW_CURSOR_DELAY = 250;
/** The tour's path (help/onboarding/<locale>/tour.md) */
export const ONBOARDING_PATH = 'onboarding/tour';

//// CONTENT ////

/** `help/<section>/<locale>/<rest>.md` → loader of the raw markdown. Only the sections
 *  the editor shows; the guide pages are for the docs site. */
const SOURCES = import.meta.glob(['../../../../help/onboarding/*/**/*.md', '../../../../help/tutorials/*/**/*.md'], { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

/** Keyed `<locale>/<section>/<rest>`: the path within a locale is what a document is known by */
const FILES = new Map<string, () => Promise<string>>(Object.entries(SOURCES)
  .map(([file, load]) =>
  {
    const [section, locale, ...rest] = file.replace(/^.*?\/help\//, '').replace(/\.md$/, '').split('/');
    return [`${locale}/${section}/${rest.join('/')}`, load];
  }));

/** `help/<section>/<locale>/<rest>.<image>` → its URL, keyed by the path inside help/.
 *  Only the URLs are in the bundle; the browser fetches an image when it is shown. */
const IMAGES = new Map(Object.entries(import.meta.glob(['../../../../help/onboarding/*/**/*.{png,jpg,jpeg,gif,webp,avif,svg}', '../../../../help/tutorials/*/**/*.{png,jpg,jpeg,gif,webp,avif,svg}'], { query: '?url', import: 'default', eager: true }) as Record<string, string>)
  .map(([file, url]) => [file.replace(/^.*?\/help\//, ''), url] as const));

/** Locales with any help content, English first */
export const helpLocales: string[] = [...new Set([...FILES.keys()].map(key => key.split('/')[0]))]
  .sort((a, b) => (a === DEFAULT_LOCALE ? -1 : b === DEFAULT_LOCALE ? 1 : a.localeCompare(b)));

export interface HelpEntry
{
  /** Path within a locale, e.g. 'tutorials/simple-table' */
  path: string;
  /** The locale the content was actually loaded in (after fallback) */
  locale: string;
  doc: HelpDoc;
}

//// STATE ////

export type HelpTab = 'tour' | 'tutorials' | 'reference';

export const helpTab = signal<HelpTab>('tutorials');
export const helpLocale = signal<string>(detectLocale());
/** The document in the player, null when the tutorial list is shown */
export const helpEntry = signal<HelpEntry | null>(null);
export const helpStep = signal<number>(0);
/** Tutorials of the current locale, sorted for the list; null until loaded */
export const helpTutorials = signal<HelpEntry[] | null>(null);
/** The tab of the tutorial list: a tag (HELP_TAGS), or 'all' */
export const helpTutorialTag = signal<string>('all');

export const helpCurrentStep = computed(() => helpEntry.get()?.doc.steps[helpStep.get()] ?? null);

/** The code the player last put in the editor for a step */
let _lastStepCode: string | null = null;

//// ACTIONS ////

/** Load one help document in the current locale, falling back to English. */
export async function loadHelpDoc(path: string): Promise<HelpEntry | null>
{
  const locale = [helpLocale.get(), DEFAULT_LOCALE].find(l => FILES.has(`${l}/${path}`));
  if (!locale) return null;

  const source = await FILES.get(`${locale}/${path}`)!();
  return { path, locale, doc: parseHelpDoc(source) };
}

/** Load the tutorial list: every `tutorials/*` of the locale (or English), by `order`. */
export async function loadHelpTutorials(): Promise<void>
{
  const paths = [...new Set([...FILES.keys()]
    .map(key => key.slice(key.indexOf('/') + 1))
    .filter(path => path.startsWith('tutorials/')))];

  const entries = (await Promise.all(paths.map(loadHelpDoc))).filter((e): e is HelpEntry => !!e);
  const order = (e: HelpEntry) => Number(e.doc.meta.order ?? Infinity);

  helpTutorials.set(entries.sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path)));
}

/** URL of an image a help file refers to (its `thumbnail:`, or `![](…)` in the text),
 *  relative to that file. A translation without its own copy uses the English image.
 *  Absolute URLs pass through; unknown files give null. */
export function helpImageUrl(entry: HelpEntry, src: string): string | null
{
  if (/^(https?:|data:)/i.test(src)) return src;

  // The file's own place in help/: <section>/<locale>/<rest>
  const [section, ...rest] = entry.path.split('/');
  return [entry.locale, DEFAULT_LOCALE]
    .map(locale => resolveHelpPath(`${section}/${locale}/${rest.join('/')}`, src))
    .map(path => (path ? IMAGES.get(path) : undefined))
    .find((url): url is string => !!url) ?? null;
}

/** Open a help document in the player at its first step. A tutorial (a document
 *  with code) gets a new script of its own, so the user's work is never overwritten.
 *  Returns false when the document does not exist. */
export async function openHelpDoc(path: string): Promise<boolean>
{
  const entry = await loadHelpDoc(path);
  if (!entry) return false;

  if (hasCode(entry.doc))
  {
    createNewScript();
    updateScriptName(`tutorial-${path.split('/').pop()}`);
    // The start script's own parameters would show up next to the tutorial's
    scriptParams.get().forEach(p => deleteParam(p.name));
  }

  helpEntry.set(entry);
  helpTab.set(path === ONBOARDING_PATH ? 'tour' : 'tutorials');
  _lastStepCode = null;
  goToHelpStep(0);
  return true;
}

/** Show a step; for a tutorial, put the tutorial's code up to that step in the editor
 *  and run it. A step that does not change the code leaves the editor alone, so the
 *  user's own edits survive paging through prose. */
export function goToHelpStep(index: number): void
{
  const entry = helpEntry.get();
  if (!entry) return;

  const step = Math.max(0, Math.min(index, entry.doc.steps.length - 1));
  helpStep.set(step);

  const code = codeAt(entry.doc, step);
  if (code !== null && code !== _lastStepCode) runHelpCode(code);
  _lastStepCode = code;
}

/** Back to the tutorial list */
export function closeHelpDoc(): void
{
  helpEntry.set(null);
  helpStep.set(0);
  helpTab.set('tutorials');
}

export async function setHelpLocale(locale: string): Promise<void>
{
  helpLocale.set(locale);
  helpTutorials.set(null);

  // Reload the open document in the new language, staying on the same step
  const entry = helpEntry.get();
  if (!entry) return;
  const reloaded = await loadHelpDoc(entry.path);
  if (reloaded) helpEntry.set(reloaded);
}

//// API REFERENCE ////

/** The reference data, loaded on first use (a separate chunk, ~100 kB gzipped) */
export const helpApi = signal<ApiIndex | null>(null);
export const helpApiQuery = signal<string>('');
/** Id of the entry shown, null for the search results or overview */
export const helpApiEntry = signal<string | null>(null);
/** Last lookup of the word at the cursor */
export const helpApiLookup = signal<ApiLookup | null>(null);
/** On unless switched off in this browser */
export const helpFollowCursor = signal<boolean>(readFlag(FOLLOW_CURSOR_KEY, true));
/** Set by the help panel while it is on screen; the cursor is only followed then */
export const helpPanelOpen = signal<boolean>(false);

let _apiLoading: Promise<ApiIndex> | null = null;
let _cursor: { code: string, pos: number } | null = null;
let _followTimer: ReturnType<typeof setTimeout> | undefined;

export function loadHelpApi(): Promise<ApiIndex>
{
  _apiLoading ??= import('@archiyou/ui/editor/help/api.generated.json')
    .then(data =>
    {
      const index = indexApi((data.default as { entries: ApiEntry[] }).entries);
      helpApi.set(index);
      return index;
    });
  return _apiLoading;
}

/** Show one entry of the reference */
export function showApiEntry(id: string | null): void
{
  helpApiEntry.set(id);
  helpTab.set('reference');
}

/** Where the cursor is in the code; followed when the reference is open and following. */
export function setHelpCursor(code: string, pos: number): void
{
  _cursor = { code, pos };
  if (!helpFollowCursor.get() || !helpPanelOpen.get() || helpTab.get() !== 'reference') return;

  clearTimeout(_followTimer);
  _followTimer = setTimeout(() => void lookupHelpAtCursor(false), FOLLOW_CURSOR_DELAY);
}

/** Look up the word at the cursor and show it. `always` (F1) also clears a search in
 *  progress; following the cursor leaves the previous result when there is no word. */
export async function lookupHelpAtCursor(always = true): Promise<void>
{
  if (!_cursor) return;
  const index = await loadHelpApi();
  const result = lookupAt(index, _cursor.code, _cursor.pos);
  if (!result.word && !always) return;

  helpApiLookup.set(result);
  helpApiQuery.set('');
  // A single match is shown directly; a script parameter gets its own explanation
  helpApiEntry.set(result.entries.length === 1 && !result.param ? result.entries[0].id : null);
  helpTab.set('reference');
}

export function setHelpFollowCursor(on: boolean): void
{
  helpFollowCursor.set(on);
  try { localStorage.setItem(FOLLOW_CURSOR_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  if (on) void lookupHelpAtCursor(false);
}

/** A remembered on/off switch; `fallback` when never set (or storage is unavailable) */
function readFlag(key: string, fallback = false): boolean
{
  try
  {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1';
  }
  catch { return fallback; }
}

//// FIRST VISIT ////

/** True the first time the editor opens in this browser; marks the tour as shown. */
export function claimOnboarding(): boolean
{
  try
  {
    if (localStorage.getItem(ONBOARDED_KEY)) return false;
    localStorage.setItem(ONBOARDED_KEY, '1');
    return true;
  }
  catch
  {
    return false;   // storage unavailable: never force the tour on every visit
  }
}

//// RUNNING CODE ////

let _runner: ((code: string) => void) | null = null;

/** Called by the editor page: put code in the editor and execute it. */
export function registerHelpRunner(runner: (code: string) => void): void
{
  _runner = runner;
}

export function runHelpCode(code: string): void
{
  _runner?.(code);
}

function detectLocale(): string
{
  const wanted = (typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
    .flatMap(tag => [tag, tag.split('-')[0]]);
  return wanted.find(tag => helpLocales.includes(tag)) ?? DEFAULT_LOCALE;
}
