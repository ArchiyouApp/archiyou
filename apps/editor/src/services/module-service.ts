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

import { registerModuleCompletions } from '@archiyou/ui/editor/completions.js';

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
      // Autocomplete for entitled modules. Registered here rather than generated
      // at build time because which modules exist is a per-deployment,
      // per-account fact (see completions.ts).
      registerModuleCompletions(modules);
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
}
