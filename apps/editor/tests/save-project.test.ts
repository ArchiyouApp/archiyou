/**
 * tests/save-project.test.ts — "Save as project" from a configurator (services/save-project).
 *
 * The design rides in the link and waits in the editor's storage until the visitor is
 * signed in with a confirmed address; then it becomes one project, never two.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createProject = vi.fn();
const fetchPublishedScriptVersion = vi.fn();
vi.mock('../src/services/projects.js', () => ({ createProject }));
vi.mock('../src/services/publishing.js', () => ({ fetchPublishedScriptVersion }));

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
});

// Web Locks as the browser has them: one holder of a name at a time, in the order asked.
let held: Promise<unknown> = Promise.resolve();
vi.stubGlobal('navigator', {
  locks: {
    request: (_name: string, fn: () => Promise<unknown>) => (held = held.then(fn, fn)),
  },
});

const {
  saveProjectUrl, pendingProjectFromQuery, pendingProject, storePendingProject, hasUnsavedProject, createPendingProject,
  savePendingProject,
} = await import('../src/services/save-project.js');
const { nextPath } = await import('../src/services/auth-service.js');

/** A published configurator with two params. */
const PUBLISHED = {
  id: 'version-7',
  name: 'urhouse',
  author: 'urbuild',
  version: '0.4',
  code: '',
  published: { title: 'Urhouse' },
  params: {
    WIDTH: { name: 'WIDTH', type: 'number', schema: { type: 'number', default: 4500, minimum: 2000, maximum: 12000 } },
    ROOF: { name: 'ROOF', type: 'options', schema: { type: 'string', enum: ['gable', 'flat'], default: 'gable' } },
  },
};

beforeEach(() =>
{
  storage.clear();
  createProject.mockReset();
  fetchPublishedScriptVersion.mockReset();
});

describe('the link', () =>
{
  it('carries the configurator and its configuration, and reads back', () =>
  {
    const url = saveProjectUrl('https://archiyou.com', 'urbuild', 'urhouse', '0.4', 'WIDTH=5400&lang=nl');
    expect(url).toBe('https://archiyou.com/projects/new?configurator=urbuild%2Furhouse%3A0.4&WIDTH=5400&lang=nl');
    expect(pendingProjectFromQuery(new URL(url).search)).toMatchObject({ configurator: 'urbuild/urhouse:0.4', query: 'WIDTH=5400&lang=nl' });
  });

  it('is no design without a configurator, or with something else in its place', () =>
  {
    expect(pendingProjectFromQuery('?WIDTH=5400')).toBeNull();
    expect(pendingProjectFromQuery('?configurator=https://evil.example/x')).toBeNull();
    expect(pendingProjectFromQuery('?configurator=urhouse')).toBeNull();
  });
});

describe('the kept design', () =>
{
  it('waits until it is saved, for a week at most', () =>
  {
    expect(pendingProject()).toBeNull();
    storePendingProject({ configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now() });
    expect(hasUnsavedProject()).toBe(true);
    storePendingProject({ configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now(), savedAs: 'p1' });
    expect(hasUnsavedProject()).toBe(false);
    storePendingProject({ configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now() - 8 * 24 * 3600 * 1000 });
    expect(pendingProject()).toBeNull();
  });

  it('becomes a project at the values of the link, the defaults for the rest, and is marked saved', async () =>
  {
    fetchPublishedScriptVersion.mockResolvedValue(PUBLISHED);
    createProject.mockResolvedValue({ id: 'p1' });
    const pending = { configurator: 'urbuild/urhouse:0.4', query: 'WIDTH=5400&NOPE=1&lang=nl', at: Date.now() };

    await createPendingProject(pending);

    expect(fetchPublishedScriptVersion).toHaveBeenCalledWith('urbuild', 'urhouse:0.4');
    expect(createProject).toHaveBeenCalledWith({
      title: 'Urhouse',
      configuration: expect.objectContaining({ values: { WIDTH: 5400, ROOF: 'gable' }, lang: 'nl', sourceVersionId: 'version-7' }),
    });
    expect(pendingProject()?.savedAs).toBe('p1');
  });

  it('becomes one project when two tabs continue at once (the confirmation tab and the waiting one)', async () =>
  {
    fetchPublishedScriptVersion.mockResolvedValue(PUBLISHED);
    createProject.mockResolvedValue({ id: 'p1' });
    storePendingProject({ configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now() });

    expect(await Promise.all([savePendingProject(), savePendingProject()])).toEqual(['p1', 'p1']);
    expect(createProject).toHaveBeenCalledTimes(1);
    storage.clear();
    expect(await savePendingProject()).toBeNull();
  });

  it('stays waiting when the server refuses (address not confirmed)', async () =>
  {
    fetchPublishedScriptVersion.mockResolvedValue(PUBLISHED);
    createProject.mockRejectedValue(new Error('Please confirm your email address first.'));
    const pending = { configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now() };
    storePendingProject(pending);

    await expect(createPendingProject(pending)).rejects.toThrow();
    expect(hasUnsavedProject()).toBe(true);
  });

  it('is refused when the configurator is no longer published', async () =>
  {
    fetchPublishedScriptVersion.mockResolvedValue(null);
    await expect(createPendingProject({ configurator: 'urbuild/urhouse:0.4', query: '', at: Date.now() })).rejects.toThrow(/no longer published/);
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe('after signing in', () =>
{
  it('goes to a path on this origin, never elsewhere', () =>
  {
    expect(nextPath('?next=%2Fprojects%2Fnew&for=project')).toBe('/projects/new');
    expect(nextPath('')).toBe('/');
    expect(nextPath('?next=https://evil.example')).toBe('/');
    expect(nextPath('?next=//evil.example')).toBe('/');
    expect(nextPath('?next=/\\evil.example')).toBe('/');
  });
});
