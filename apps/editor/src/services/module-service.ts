/**
 * module-service — the catalog of gated script modules available to this user.
 *
 * `GET /modules` returns every module installed on the backend, each marked
 * entitled or not (see modules/README.md). The result is cached per signed-in
 * user and refreshed automatically when that user changes, so a sign-out cannot
 * leave the previous account's modules showing as unlocked.
 *
 * The LOCKED entries matter as much as the unlocked ones. They let the editor
 * show a module as unavailable rather than pretend it does not exist, and the
 * runner uses them to turn a script's use of a locked module into
 * "not available on your account" instead of "undefined is not a function".
 *
 * On a backend with no modules installed — the default — this is an empty list
 * and nothing anywhere behaves differently.
 */

import { signal } from '@lit-labs/signals';
import type { AyModuleCatalogEntry } from '@archiyou/module-sdk';


import { authService, currentUser } from './auth-service.js';
import { netFetch } from './network.js';

const API_BASE = (import.meta.env.SERVER_API_BASE_URL as string | undefined) ?? '';

/** Installed modules with this user's entitlement. Empty until first load. */
export const moduleCatalog = signal<AyModuleCatalogEntry[]>([]);

/** Modules this user may actually use. */
export function entitledModules(): AyModuleCatalogEntry[] {
  return moduleCatalog.get().filter((m) => m.entitled);
}

/** Modules that exist but are locked for this user — what the UI offers to unlock. */
export function lockedModules(): AyModuleCatalogEntry[] {
  return moduleCatalog.get().filter((m) => !m.entitled);
}

/** Whose entitlements the cached catalog reflects. `undefined` = never loaded,
 *  `null` = loaded while anonymous. */
let _loadedFor: string | null | undefined;
let _inFlight: Promise<AyModuleCatalogEntry[]> | null = null;

async function fetchCatalog(): Promise<AyModuleCatalogEntry[]> {
  try {
    const token = await authService.getToken();
    const res = await netFetch(`${API_BASE}/modules`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const body = await res.json() as { modules?: AyModuleCatalogEntry[] };
    return Array.isArray(body?.modules) ? body.modules : [];
  } catch {
    // A backend that is down, offline, or older than this route simply means
    // "no modules". It must never stop the editor from running scripts.
    return [];
  }
}

/**
 * The catalog for the current user, fetching only when needed.
 *
 * Cheap to call on every run: it re-fetches only when the signed-in user has
 * changed since the last load. Concurrent callers share one request.
 *
 * EXCEPT in a dev build, where it goes stale after DEV_TTL_MS. That is what makes
 * editing a module show up on the next run rather than after a reload: the
 * backend publishes a per-build `rev` in dev, and the runner keys its module
 * cache on it — but only if someone asks for a fresh catalog.
 *
 * A TTL rather than an unconditional re-fetch, because this sits on the critical
 * path of every run: hammering Run stays free, while any real edit is far slower
 * than the window, so a rebuild is never missed.
 */
const DEV_TTL_MS = 500;
let _loadedAt = 0;

export async function ensureModuleCatalog(): Promise<AyModuleCatalogEntry[]> {
  const userId = currentUser.get()?.id ?? null;
  if (_inFlight) return _inFlight;

  const fresh = !import.meta.env.DEV || (Date.now() - _loadedAt) < DEV_TTL_MS;
  if (_loadedFor === userId && fresh) return moduleCatalog.get();

  _inFlight = (async () => {
    try {
      const modules = await fetchCatalog();
      moduleCatalog.set(modules);
      // NOTE editor autocomplete for these modules is registered by <code-box>, off
      // this signal — deliberately not from here. completions.ts pulls in CodeMirror,
      // and this service is on the configurator's import path (via execution-service),
      // so importing it here put a ~490KB code editor into the download of a page that
      // never shows one.
      _loadedFor = userId;
      _loadedAt = Date.now();
      return modules;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

/** Drop the cache so the next ensureModuleCatalog() re-fetches. Use after an
 *  entitlement is expected to have changed server-side. */
export function invalidateModuleCatalog(): void {
  _loadedFor = undefined;
  _docs.clear();
}

/** Documentation markdown already fetched this session, keyed by module id. */
const _docs = new Map<string, Promise<string | null>>();

/**
 * A module's DOCS.md as markdown, or null when the backend has none to give.
 *
 * This is the module's SCRIPT-FACING documentation, not its README — see
 * AyModuleCatalogEntry.docs for why those are separate files.
 *
 * Cached per module for the life of the session: it is large compared to a
 * catalog entry, and someone paging back and forth between the list and the docs
 * should not re-download it each time. In a dev build the cache is skipped, so
 * editing a module's DOCS.md shows up on the next open — the same bargain the
 * catalog's DEV_TTL_MS makes.
 *
 * Never throws. A module whose docs cannot be fetched shows "no documentation"
 * rather than breaking the menu it is displayed in.
 */
export async function fetchModuleDocs(id: string): Promise<string | null> {
  const cached = !import.meta.env.DEV && _docs.get(id);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const token = await authService.getToken();
      const res = await netFetch(`${API_BASE}/modules/${encodeURIComponent(id)}/docs`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  })();

  _docs.set(id, pending);
  // A failed fetch must not be remembered as "this module has no docs" — the
  // next open should be able to try again.
  void pending.then((md) => { if (md === null) _docs.delete(id); });
  return pending;
}
