/**
 * save-project.ts — "Save as project" from a published configurator (plans/PROJECTS.md).
 *
 * The configurator links to the editor's /projects/new with the design in the query:
 *
 *     /projects/new?configurator=urbuild/urhouse:0.4&WIDTH=5400&lang=nl
 *
 * That page (pages/project-new.ts) makes a project with this design as its first
 * configuration and opens it. Until it can, the design waits here: a visitor who first has
 * to sign in, create an account or confirm their email address comes back to it, also when
 * the confirmation link opens in another tab.
 *
 * Kept in the editor's own localStorage, never the configurator frame's: inside another
 * site's page that storage belongs to the other site's partition, which the editor's tabs
 * do not see. That is also why the button is a link and the design rides in it.
 */

import type { ProjectData } from '@archiyou/types';
import { Script } from '@archiyou/core/src/Script';

import { createProject } from './projects.js';
import { fetchPublishedScriptVersion } from './publishing.js';
import { decodeParamValues } from '../state/configurator-url';

export const SAVE_PROJECT_STORAGE_KEY = 'archiyou:save-project';

/** A design is kept this long; after that a sign-in no longer turns it into a project. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The page the configurator's button opens. */
export const SAVE_PROJECT_PATH = '/projects/new';

export interface PendingProject
{
  /** The published configurator: `author/name:version`. */
  configurator: string;
  /** Its configuration as the configurator writes it in a link (`WIDTH=5400&lang=nl`). */
  query: string;
  at: number;
  /** The project made of it, once there is one: a second tab, a reload or the
   *  confirmation link opens that project instead of making another. */
  savedAs?: string;
}

/** The link for "Save as project": the configurator, then its configuration. */
export function saveProjectUrl(origin: string, author: string, name: string, version: string, query: string): string
{
  const search = new URLSearchParams({ configurator: `${author}/${name}:${version}` });
  new URLSearchParams(query).forEach((value, key) => search.append(key, value));
  return `${origin}${SAVE_PROJECT_PATH}?${search}`;
}

/** The design a /projects/new link carries, or null without one. */
export function pendingProjectFromQuery(search: string): PendingProject | null
{
  const query = new URLSearchParams(search);
  const configurator = query.get('configurator');
  if (!configurator || !/^[^/]+\/[^/:]+(:[^/:]+)?$/.test(configurator)) return null;
  query.delete('configurator');
  return { configurator, query: query.toString(), at: Date.now() };
}

/** The design waiting to become a project, or null (none, unreadable or too old). */
export function pendingProject(): PendingProject | null
{
  try
  {
    const pending = JSON.parse(localStorage.getItem(SAVE_PROJECT_STORAGE_KEY) ?? 'null') as PendingProject | null;
    if (!pending?.configurator || typeof pending.query !== 'string') return null;
    return Date.now() - pending.at < MAX_AGE_MS ? pending : null;
  }
  catch
  {
    return null;
  }
}

export function storePendingProject(pending: PendingProject): void
{
  try { localStorage.setItem(SAVE_PROJECT_STORAGE_KEY, JSON.stringify(pending)); }
  catch (err) { console.warn('save-project: could not keep the design:', err); }
}

/** A design still waiting for its project: what the sign-in and confirmation pages ask
 *  before they continue to /projects/new. */
export function hasUnsavedProject(): boolean
{
  const pending = pendingProject();
  return !!pending && !pending.savedAs;
}

/**
 * The project of the waiting design: the one already made of it, or a new one. Null when no
 * design waits. One tab at a time (Web Locks, shared by the editor's tabs): the tab that opened
 * the confirmation link and the tab that waited for it both continue here, and must not make
 * two projects of one design.
 */
export async function savePendingProject(): Promise<string | null>
{
  const save = async () =>
  {
    const pending = pendingProject();
    if (!pending) return null;
    return pending.savedAs ?? (await createPendingProject(pending)).id;
  };
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(SAVE_PROJECT_STORAGE_KEY, save)
    : save();
}

/**
 * Make the project: the published configurator's script with the values of the link (the
 * script's defaults for what the link does not set), titled after the configurator. Throws
 * the server's error (`email_not_verified` until the address is confirmed).
 */
export async function createPendingProject(pending: PendingProject): Promise<ProjectData>
{
  const slash = pending.configurator.indexOf('/');
  const data = await fetchPublishedScriptVersion(pending.configurator.slice(0, slash), pending.configurator.slice(slash + 1));
  const script = data ? Script.fromData(data) : null;
  if (!data || !script) throw new Error('This configurator is no longer published.');

  const params = Object.values(script.params);
  const values = {
    ...Object.fromEntries(params.map(p => [p.name, p.default])),
    ...decodeParamValues(pending.query, params),
  };
  const project = await createProject({
    title: data.published?.title || data.name || null,
    configuration: {
      script: data,
      values,
      lang: new URLSearchParams(pending.query).get('lang'),
      sourceVersionId: data.id ?? null,
    },
  });
  storePendingProject({ ...pending, savedAs: project.id });
  return project;
}
