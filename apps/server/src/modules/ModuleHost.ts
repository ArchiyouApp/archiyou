/**
 * ModuleHost — the installed set of gated script modules on this instance.
 *
 * Modules are built and distributed OUTSIDE this repository (see modules/README.md)
 * and cloned into the `modules/` overlay, where each is:
 *
 *   <dir>/<id>/manifest.json
 *   <dir>/<id>/bundle.js     (runtime: 'client' — served to entitled browsers)
 *   <dir>/<id>/server.js     (runtime: 'server' — never leaves this machine)
 *   <dir>/<id>/DOCS.md       (optional — the script-facing documentation, shown in the editor)
 *
 * A server module with `"client": true` in its manifest ships BOTH: server.js
 * stays here, bundle.js is the wrapper served to browsers (see
 * AyModuleManifest.client in the module SDK).
 *
 * The runtime artifact is also accepted at `<id>/dist/<name>.js`, which is where
 * a module's own build puts it. Together with roots being discovered under
 * `modules/` (see discoverRoots.ts) that means a cloned module repository is read
 * in place, with neither a copy step nor a setting — see modules/README.md.
 *
 * `SERVER_MODULES_DIR` still overrides the roots when a deployment keeps them
 * elsewhere; config.modules.dir is the resolved answer either way.
 *
 * Scanned at boot, and re-scanned on change when config.modules.dev is on.
 * **With no module installed the host is inert** — list() is empty, GET /modules
 * returns [], and the server behaves exactly as it does without this feature.
 * That is what keeps a plain checkout of this repository fully functional.
 */

import { readdirSync, readFileSync, statSync, existsSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';

import type { AyModuleCatalogEntry } from '@archiyou/module-sdk';

import { config } from '../config';
import { parse, ValidationError } from '../validate';
import { grantsAllModules } from './entitlements';
import { ModuleManifestSchema, type ModuleManifest } from './manifestSchema';
import { moduleWorkerPool, ModuleCallError } from './ModuleWorkerPool';

interface InstalledModule {
  manifest: ModuleManifest;
  /** Absolute path to the module's directory. */
  dir: string;
  /** Absolute path to the runtime artifact (bundle.js or server.js). */
  entry: string;
  /** Hybrid modules only: the client wrapper (bundle.js) served next to server.js. */
  clientEntry?: string;
  /** Absolute path to the module's DOCS.md, when it ships one. This is the
   *  script-facing documentation shown in the editor's module list — NOT its
   *  README, which is written for whoever builds and deploys the module. */
  docs?: string;
  /** Content fingerprint of the artifact + manifest. Changes on every rebuild,
   *  which is what lets a caller distinguish "rebuilt" from "same version". */
  rev: string;
}

/**
 * A short fingerprint of a module's built output.
 *
 * Deliberately mtime+size rather than a content hash: it is one stat() per file
 * on a path that runs per request, and the only question being asked is "is this
 * the same build as last time" — for which a rebuild always changes at least the
 * mtime. A hash would cost a full read of a multi-megabyte bundle to answer the
 * same question.
 */
function revisionOf(entryPath: string, manifestPath: string): string {
  let acc = '';
  for (const p of [entryPath, manifestPath]) {
    try {
      const s = statSync(p);
      acc += `${Math.round(s.mtimeMs)}-${s.size}.`;
    } catch {
      acc += 'x.';
    }
  }
  // Base36 keeps it short enough to sit in a URL without being noise.
  let h = 0;
  for (let i = 0; i < acc.length; i++) h = (Math.imul(31, h) + acc.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * A module's DOCS.md, if it has one.
 *
 * DELIBERATELY NOT README.md. The route that serves this is public, and a
 * module's README is written for whoever builds and deploys it — build steps,
 * environment variables, the reasoning behind its security guards. DOCS.md is
 * the half written for the person using the module from a script, and keeping
 * them apart makes publishing it a decision the module author takes rather than
 * one this scan takes for them.
 *
 * Case-insensitive on the whole name rather than a fixed list of spellings: the
 * file is authored by whoever wrote the module, and `docs.md` losing its
 * documentation to a capitalisation is not a useful failure. Only the module's
 * OWN directory is looked at — a DOCS.md nested in src/ or in a dependency is
 * not the module's documentation.
 */
function findDocs(moduleDir: string): string | undefined {
  try {
    const name = readdirSync(moduleDir).find((f) => f.toLowerCase() === 'docs.md');
    return name ? join(moduleDir, name) : undefined;
  } catch {
    return undefined;
  }
}

/** Files whose change means a module changed. Everything else under a module
 *  directory — node_modules churn, source files, editor temp files — is ignored,
 *  or a single `pnpm install` would trigger hundreds of re-scans.
 *
 *  Compared lower-cased, so `docs.md` is watched on the same terms findDocs
 *  accepts it. */
const WATCHED_NAMES = new Set(['manifest.json', 'bundle.js', 'server.js', 'docs.md']);

/**
 * Split a root list — `SERVER_MODULES_DIR`, or what discovery found — into absolute paths.
 *
 * Comma or colon separated. Colon is the PATH convention and the one people reach for, but
 * it also appears in a Windows drive letter, so a single-character segment is treated as
 * part of the path that follows rather than as a separator of its own.
 *
 * Blank entries are dropped, and duplicates are collapsed so a doubled root does not produce
 * a spurious "id already loaded" warning against itself.
 */
export function splitRoots(dir: string): string[] {
  if (!dir) return [];
  const parts = dir
    .split(',')
    .flatMap((chunk) => {
      const segs = chunk.split(':');
      const out: string[] = [];
      for (const seg of segs) {
        // Re-attach a Windows drive letter to the segment it belongs to.
        if (out.length && /^[A-Za-z]$/.test(out[out.length - 1])) out[out.length - 1] += `:${seg}`;
        else out.push(seg);
      }
      return out;
    })
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => resolve(p));
  return [...new Set(parts)];
}

export class ModuleHost {
  private _modules = new Map<string, InstalledModule>();
  private _loaded = false;
  /** Every scanned root, in the order given. Usually one; more when several module
   *  repositories are checked out side by side (see splitRoots). */
  private _roots: string[] = [];
  private _watchers: FSWatcher[] = [];
  private _debounce: NodeJS.Timeout | null = null;
  private _listeners = new Set<() => void>();

  /**
   * Scan the modules directories. Safe to call repeatedly; re-scans.
   *
   * `dir` may name SEVERAL roots, comma- or colon-separated — which is what discovery
   * produces when more than one module repository is cloned into `modules/`. One root was
   * enough while every module lived in a single private repository; an open-source module
   * gets its own repository, checked out alongside, and the backend has to see both. Roots
   * are scanned in order and the first definition of an id wins, so an earlier root can
   * deliberately shadow a later one.
   */
  load(dir: string = config.modules.dir): this {
    this._modules.clear();
    this._loaded = true;
    this._roots = splitRoots(dir);

    if (this._roots.length === 0) return this; // feature off — the default

    for (const root of this._roots) this._scanRoot(root);

    if (this._modules.size > 0) {
      const names = [...this._modules.values()].map((m) => `${m.manifest.id}@${m.manifest.version}`);
      console.log(`🧩 Loaded ${this._modules.size} script module(s): ${names.join(', ')}`);
      // Naming the roots — and whether they were configured or found — turns
      // "why is this module here / not here" into something readable at boot
      // instead of something to reason out from an environment.
      const how = config.modules.dirSource === 'discovered' ? 'found under modules/' : 'from SERVER_MODULES_DIR';
      console.log(`   ${how}: ${this._roots.join(', ')}`);
    }
    return this;
  }

  /** Scan one root for `<id>/manifest.json`. */
  private _scanRoot(root: string): void {
    if (!existsSync(root)) {
      console.warn(`⚠ module root does not exist: ${root} (from ${config.modules.dirSource === 'env' ? 'SERVER_MODULES_DIR' : 'modules/'})`);
      return;
    }

    for (const name of readdirSync(root)) {
      const moduleDir = join(root, name);
      try {
        if (!statSync(moduleDir).isDirectory()) continue;
      } catch {
        continue;
      }

      const manifestPath = join(moduleDir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = parse(ModuleManifestSchema, JSON.parse(readFileSync(manifestPath, 'utf-8')));

        // The directory name is what the deployment controls; the id is what
        // every URL and entitlement uses. Letting them differ would make
        // "which module is this?" ambiguous.
        if (manifest.id !== name) {
          console.warn(`⚠ module '${manifest.id}' skipped: manifest id does not match its directory '${name}'`);
          continue;
        }
        if (this._modules.has(manifest.id)) {
          // First root wins. Naming the winner matters once there is more than one root:
          // otherwise "why is my edit not taking effect" has no visible answer.
          console.warn(
            `⚠ module '${manifest.id}' in ${root} skipped: id already loaded from ` +
            `${this._modules.get(manifest.id)!.dir}`,
          );
          continue;
        }

        const entryName = manifest.runtime === 'client' ? 'bundle.js' : 'server.js';
        // Deployed layout first, then the in-place build output — so the same
        // code serves a real deployment and a developer's working tree.
        const entry = [join(moduleDir, entryName), join(moduleDir, 'dist', entryName)]
          .find((p) => existsSync(p));
        if (!entry) {
          console.warn(`⚠ module '${manifest.id}' skipped: ${entryName} is missing (looked in ./ and ./dist)`);
          continue;
        }

        // A hybrid module (server + client wrapper) needs its bundle too; without
        // it the script would get a bare stub where the manifest promised objects,
        // so the module is skipped rather than half-served.
        let clientEntry: string | undefined;
        if (manifest.runtime === 'server' && manifest.client === true) {
          clientEntry = [join(moduleDir, 'bundle.js'), join(moduleDir, 'dist', 'bundle.js')]
            .find((p) => existsSync(p));
          if (!clientEntry) {
            console.warn(`⚠ module '${manifest.id}' skipped: manifest sets "client": true but bundle.js is missing (looked in ./ and ./dist)`);
            continue;
          }
        }

        this._modules.set(manifest.id, {
          manifest,
          dir: moduleDir,
          entry,
          clientEntry,
          docs: findDocs(moduleDir),
          rev: revisionOf(entry, manifestPath),
        });
      } catch (err) {
        // A bad manifest must not stop the server from booting; it is reported
        // and skipped, exactly like a bad request body would be rejected.
        const detail = err instanceof ValidationError ? err.issues.join('; ') : (err as Error)?.message;
        console.warn(`⚠ module '${name}' skipped: invalid manifest (${detail})`);
      }
    }
  }

  /** True when at least one module is installed. */
  get enabled(): boolean {
    return this._modules.size > 0;
  }

  /** Every installed manifest. Lazily scans on first use. */
  list(): ModuleManifest[] {
    if (!this._loaded) this.load();
    return [...this._modules.values()].map((m) => m.manifest);
  }

  get(id: string): ModuleManifest | undefined {
    if (!this._loaded) this.load();
    return this._modules.get(id)?.manifest;
  }

  /**
   * The catalog as the given user sees it: every installed module, each marked
   * entitled or not.
   *
   * Locked modules are INCLUDED on purpose. The editor uses this to show what
   * exists and offer an upgrade path, and the runner uses it to turn a script's
   * use of a locked module into "not available on your account" instead of
   * "undefined is not a function".
   *
   * The wildcard entitlement (`'*'`, see UserService.ALL_MODULES) marks every
   * installed module entitled, so a module deployed after the grant is usable
   * without touching the account.
   */
  catalogFor(entitledIds: string[]): AyModuleCatalogEntry[] {
    if (!this._loaded) this.load();
    const all = grantsAllModules(entitledIds);
    const owned = new Set(entitledIds);
    return [...this._modules.values()].map((m) => ({
      ...m.manifest,
      // A public module is available to everybody, including anonymous callers. See
      // AyModuleManifest.public — gating is the default, this is the deliberate opt-out.
      entitled: m.manifest.public === true || all || owned.has(m.manifest.id),
      // Only the FLAG, never the text: the catalog is fetched on every run and
      // a page of documentation is orders of magnitude larger than the rest of
      // an entry. The editor asks for the markdown itself only when someone
      // opens the docs.
      ...(m.docs ? { docs: true } : {}),
      // Only in dev. In production a version bump is the cache key, and shipping
      // a per-build revision would defeat the immutable caching of bundles.
      ...(config.modules.dev ? { rev: m.rev } : {}),
    }));
  }

  /** Current content revision of a module, or undefined if unknown. */
  revision(id: string): string | undefined {
    if (!this._loaded) this.load();
    return this._modules.get(id)?.rev;
  }

  //// DEV WATCHING ////

  /**
   * Re-scan whenever a module's manifest or built artifact changes, so editing a
   * module never needs a server restart.
   *
   * Best-effort: recursive fs.watch is not available on every platform, and a
   * failure here only costs the developer a restart, so it must never prevent
   * the server from starting.
   */
  watch(): this {
    if (this._watchers.length) return this;

    for (const root of this._roots) {
      if (!existsSync(root)) continue;
      try {
        this._watchers.push(watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          const name = (String(filename).replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase();
          if (!WATCHED_NAMES.has(name)) return;

          // A build writes several files in quick succession; re-scanning on each
          // would serve a half-written module to whoever asked in between. The
          // debounce is shared across roots for the same reason.
          if (this._debounce) clearTimeout(this._debounce);
          this._debounce = setTimeout(() => {
            this._debounce = null;
            const before = this.list().map((m) => `${m.id}@${m.version}`).join(',');
            this.load(this._roots.join(','));
            const after = this.list().map((m) => `${m.id}@${m.version}`).join(',');
            console.log(`🧩 modules changed — re-scanned${before !== after ? ` (${after || 'none'})` : ''}`);
            this._listeners.forEach((fn) => { try { fn(); } catch { /* never let a listener break the watcher */ } });
          }, 150);
        }));
        console.log(`👀 Watching script modules in ${root}`);
      } catch (err) {
        console.warn(`⚠ could not watch ${root} (${(err as Error)?.message}) — module changes need a restart`);
      }
    }
    return this;
  }

  /** Subscribe to re-scans. Returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Stop watching. Called on server shutdown. */
  close(): void {
    if (this._debounce) { clearTimeout(this._debounce); this._debounce = null; }
    for (const w of this._watchers) w.close();
    this._watchers = [];
    this._listeners.clear();
  }

  /**
   * Absolute path of the bundle a browser may receive — a client module's
   * bundle.js, or a hybrid module's client wrapper — or null.
   *
   * Resolved from the in-memory map keyed by validated ids, NEVER by joining a
   * request-supplied id onto a path — that is what keeps `../` out of it. The
   * version must match too, so a stale cached URL cannot serve a new bundle.
   */
  bundlePath(id: string, version: string): string | null {
    if (!this._loaded) this.load();
    const found = this._modules.get(id);
    if (!found) return null;
    if (found.manifest.version !== version) return null;
    if (found.manifest.runtime === 'client') return found.entry;
    // A hybrid module serves its wrapper — and only ever the wrapper. server.js
    // has no path out of this method.
    return found.clientEntry ?? null;
  }

  /**
   * Absolute path of a module's DOCS.md, or null when it ships none.
   *
   * Same resolution rule as bundlePath(): the path comes from the validated map,
   * never from anything in the request, so no id can reach outside its own
   * module directory.
   */
  docsPath(id: string): string | null {
    if (!this._loaded) this.load();
    return this._modules.get(id)?.docs ?? null;
  }

  /** Invoke a server module's method in a worker thread. */
  async call(id: string, method: string, args: unknown): Promise<unknown> {
    if (!this._loaded) this.load();
    const found = this._modules.get(id);
    if (!found) throw new ModuleCallError('failed', `unknown module '${id}'`);
    if (found.manifest.runtime !== 'server') {
      throw new ModuleCallError('failed', `module '${id}' is a client module and cannot be called`);
    }
    return moduleWorkerPool.call(found.entry, method, args, id);
  }
}

export const moduleHost = new ModuleHost();
