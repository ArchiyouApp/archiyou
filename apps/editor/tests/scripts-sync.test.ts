/**
 * tests/scripts-sync.test.ts — how the editor's local copies (localStorage) and the
 * server's scripts are reconciled, with the real state/core.ts and services/scripts-sync.ts
 * against an in-memory server.
 *
 * The server keeps every save as a version stamped with ITS clock, like ScriptStore does;
 * the editor compares the list's `updated` with the server's latest on load (last write
 * wins) and pushes the open script on every save.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const USER = 'mark';

//// FAKE SERVER ////

interface Row { data: Record<string, any>; updated: number }
const server = {
  versions: new Map<string, Row[]>(),
  clock: 0,
  listFails: false,
  now(): number { this.clock = Math.max(this.clock + 1000, Date.now()); return this.clock; },
  save(data: Record<string, any>): Record<string, any>
  {
    const updated = this.now();
    const row = { data: { ...data, author: USER }, updated };
    this.versions.set(data.fileId, [...(this.versions.get(data.fileId) ?? []), row]);
    return this.toData(row);
  },
  latest(fileId: string): Record<string, any> | undefined
  {
    const rows = this.versions.get(fileId);
    return rows ? this.toData(rows[rows.length - 1]) : undefined;
  },
  toData(row: Row): Record<string, any> { return { ...row.data, updated: new Date(row.updated).toISOString() }; },
  reset() { this.versions.clear(); this.clock = 0; this.listFails = false; },
};

const calls: string[] = [];

vi.mock('../src/services/api.js', () =>
{
  class ApiError extends Error { constructor(public status: number, msg = '') { super(msg); } }
  const api = {
    async get(path: string)
    {
      calls.push(`GET ${path}`);
      if (path === `/scripts/${USER}` && server.listFails) throw new ApiError(503, 'unavailable');
      if (path === `/scripts/${USER}`) return [...server.versions.keys()].map(id => server.latest(id));
      throw new ApiError(404);
    },
    async put(path: string, data: any)
    {
      calls.push(`PUT ${data.code}`);
      return server.save(data);
    },
    async post(path: string, data: any)
    {
      calls.push(`POST ${data.code}`);
      // Like ScriptStore.create(): a script whose row already exists is a conflict
      if (server.versions.has(data.fileId)) throw new ApiError(409, 'already exists');
      return server.save(data);
    },
    async delete() { return null; },
  };
  return { api, ApiError, assetUrl: (p: string) => p };
});

/** Like the real auth service on a reload with a stored token: signed in straight away, but
 *  the user (and with it the handle the /scripts/{user} paths need) only arrives when the
 *  /auth/me check answers, a moment later */
vi.mock('../src/services/auth-service.js', async () =>
{
  const { signal } = await import('@lit-labs/signals');
  const user = { id: USER, email: 'm@example.com', name: 'Mark' };
  const currentUser = signal<typeof user | null>(null);
  const authReady = new Promise(resolve => setTimeout(() => { currentUser.set(user); resolve(user); }, 50));
  return {
    currentUser,
    authService: { isAuthenticated: () => true, getUser: () => currentUser.get() },
    authReady,
  };
});

//// FAKE BROWSER STORAGE ////

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

const ACTIVE_KEY = 'archiyou:editor:script';
const LIST_KEY   = 'archiyou:editor:scripts';

/** A script as the browser stored it */
function stored(code: string, updated: number, fileId = 'F1'): Record<string, any>
{
  return { name: 'house', code, fileId, author: USER, updated: new Date(updated).toISOString(), created: new Date(0).toISOString() };
}

/** Load the editor as a page load does: fresh modules over the given localStorage, and
 *  nothing else — whatever syncing happens is what the editor starts by itself */
async function loadEditor()
{
  vi.resetModules();
  const core = await import('../src/state/core.js');
  const sync = await import('../src/services/scripts-sync.js');
  await vi.advanceTimersByTimeAsync(100); // the /auth/me check, and the pull after it
  return { core, sync };
}

const serverCode = (fileId = 'F1') => server.latest(fileId)?.code;

describe('scripts: local copies vs the server', () =>
{
  beforeEach(() =>
  {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'queueMicrotask'] });
    storage.clear();
    server.reset();
    calls.length = 0;
  });

  afterEach(() => { vi.useRealTimers(); });

  it('1. on load, a newer server version replaces the local copy', async () =>
  {
    const t = Date.now();
    storage.set(ACTIVE_KEY, JSON.stringify(stored('local', t - 60_000)));
    storage.set(LIST_KEY, JSON.stringify([stored('local', t - 60_000)]));
    server.save(stored('server', 0)); // stamped now: newer

    const { core } = await loadEditor();
    expect(core.editorScript.get()?.code).toBe('server');
    expect(core.scripts.get().find(s => s.fileId === 'F1')?.code).toBe('server');
  });

  it('2. on load, a newer local edit is pushed up', async () =>
  {
    server.save(stored('server', 0));
    const later = server.clock + 60_000;
    storage.set(ACTIVE_KEY, JSON.stringify(stored('local edit', later)));
    storage.set(LIST_KEY, JSON.stringify([stored('local edit', later)]));

    const { core } = await loadEditor();
    expect(core.editorScript.get()?.code).toBe('local edit');
    expect(serverCode()).toBe('local edit');
  });

  it('3. an open tab never sees a later server version', async () =>
  {
    server.save(stored('v1', 0));
    storage.set(LIST_KEY, JSON.stringify([stored('v1', 0)]));
    storage.set(ACTIVE_KEY, JSON.stringify(stored('v1', 0)));
    const { core } = await loadEditor();

    server.save(stored('v2 from elsewhere', 0)); // another tab, device, or a DB write
    await vi.advanceTimersByTimeAsync(60_000);
    expect(serverCode()).toBe('v2 from elsewhere');
    expect(core.editorScript.get()?.code).toBe('v1'); // only a reload pulls
  });

  it('4. (known) a save in that stale tab (a run, no edit) puts its old copy back on top', async () =>
  {
    server.save(stored('v1', 0));
    storage.set(LIST_KEY, JSON.stringify([stored('v1', 0)]));
    storage.set(ACTIVE_KEY, JSON.stringify(stored('v1', 0)));
    const { core } = await loadEditor();

    server.save(stored('v2 from elsewhere', 0));
    core.saveCore();                          // what a run that changed a param value does
    await vi.advanceTimersByTimeAsync(1000);  // the debounced push
    expect(serverCode()).toBe('v1');          // the newer server version is buried
    expect(server.versions.get('F1')!.map(r => r.data.code)).toEqual(['v1', 'v2 from elsewhere', 'v1']);
  });

  it('5. (known) ...and the next load then keeps the old copy, as it is now the newest', async () =>
  {
    server.save(stored('v1', 0));
    storage.set(LIST_KEY, JSON.stringify([stored('v1', 0)]));
    storage.set(ACTIVE_KEY, JSON.stringify(stored('v1', 0)));
    const first = await loadEditor();
    server.save(stored('v2 from elsewhere', 0));
    first.core.saveCore();
    await vi.advanceTimersByTimeAsync(1000);

    const { core } = await loadEditor(); // reload
    expect(core.editorScript.get()?.code).toBe('v1');
  });

  it('6. a save queued before the load-time pull still pushes the old copy after it', async () =>
  {
    storage.set(ACTIVE_KEY, JSON.stringify(stored('local', Date.now() - 60_000)));
    storage.set(LIST_KEY, JSON.stringify([stored('local', Date.now() - 60_000)]));
    server.save(stored('server', 0));

    vi.resetModules();
    const core = await import('../src/state/core.js');
    await import('../src/services/scripts-sync.js');
    core.saveCore();                        // e.g. the first autorun, before the pull lands
    await vi.advanceTimersByTimeAsync(100); // /auth/me, then the pull adopts 'server'
    expect(core.editorScript.get()?.code).toBe('server');
    await vi.advanceTimersByTimeAsync(1000);
    expect(serverCode()).toBe('server');    // what should hold
  });

  // Known: every save sends the whole script, changed or not
  it.fails('7. a run that changes nothing makes no server version', async () =>
  {
    server.save(stored('v1', 0));
    storage.set(LIST_KEY, JSON.stringify([stored('v1', 0)]));
    storage.set(ACTIVE_KEY, JSON.stringify(stored('v1', 0)));
    const { core } = await loadEditor();
    const before = server.versions.get('F1')!.length;

    core.saveCore();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.versions.get('F1')!.length).toBe(before); // what should hold
  });

  it('8. a save of a file the server has, sent as a create, becomes a new version', async () =>
  {
    // The case that silently lost saves: the editor did not know the file was on the server
    // (its load-time pull had not run), so it sent a create, which the server refused
    server.save(stored('v1', 0));
    storage.set(ACTIVE_KEY, JSON.stringify(stored('v1', 0)));
    storage.set(LIST_KEY, JSON.stringify([stored('v1', 0)]));
    server.listFails = true;                   // the load-time pull fails: F1 stays unknown
    const { core, sync } = await loadEditor();

    core.updateScriptCode('v2 edited');
    await sync.syncSaveNow(core.editorScript.get()!);
    expect(calls.slice(-2)).toEqual(['POST v2 edited', 'PUT v2 edited']);
    expect(serverCode()).toBe('v2 edited');
  });
});
