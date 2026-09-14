/**
 * discoverRoots.ts — find installed module repositories under the checkout's
 * `modules/` overlay, so that installing one is `git clone` and nothing else.
 *
 * `SERVER_MODULES_DIR` remains the authority: set it and it is used verbatim.
 * Leave it unset (or empty, which is what `.env.example` ships) and the roots
 * are discovered here instead — the setting existed only to name a location
 * that is already a convention, and having to add it after every clone was a
 * step that did nothing but be forgotten.
 *
 * **A checkout with no modules installed discovers nothing**, which is the same
 * inert state as before: `modules/` then holds only its README, `GET /modules`
 * returns [], and this repository still stands alone as open source.
 *
 * Kept free of any import from `../config` — config imports THIS, and the cycle
 * would otherwise be real.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Never a module or a module repository, and expensive to walk into. */
const IGNORED = new Set(['node_modules', 'dist', 'target', '.git', '.turbo']);

/** How far up to look for the workspace root before giving up. `src/modules/`
 *  sits three levels under `apps/server`, which is itself two under the root. */
const MAX_WALK_UP = 8;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Directory entries that could plausibly hold a module, in a stable order.
 *  Sorted because the first definition of an id wins across roots, and a scan
 *  order that depends on the filesystem would make that arbitrary. */
function candidateChildren(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('.') && !IGNORED.has(n))
    .sort()
    .map((n) => join(dir, n))
    .filter(isDir);
}

/**
 * The monorepo root: the nearest ancestor holding `pnpm-workspace.yaml`.
 *
 * Walked up from this file rather than taken from `process.cwd()`, because the
 * cwd differs between `pnpm dev` (apps/server), an admin script and a worker
 * thread — and a path that resolves differently per process is exactly the
 * class of bug this function exists to remove.
 */
export function findRepoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = from;
  for (let i = 0; i < MAX_WALK_UP; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Module roots installed under `<repoRoot>/modules`.
 *
 * A *root* is a directory whose CHILDREN are modules (`<root>/<id>/manifest.json`)
 * — the same thing `SERVER_MODULES_DIR` has always named. Both shapes a clone
 * produces are recognised, and they can coexist:
 *
 *   modules/<repo>/<id>/manifest.json   → `modules/<repo>` is a root
 *                                          (a repository holding several modules)
 *   modules/<id>/manifest.json          → `modules` itself is a root
 *                                          (a single module cloned in directly)
 *
 * The search stops there: two levels is every layout in use, and recursing
 * further would walk into each module's own `vendor/` and dependency trees for
 * no gain.
 *
 * Returns absolute paths, deduplicated, with `modules/` itself first when it
 * qualifies — a module cloned in directly shadows a same-id module inside a
 * repository, which is the direction that makes a local override work.
 */
export function discoverModuleRoots(repoRoot: string | null = findRepoRoot()): string[] {
  if (!repoRoot) return [];

  const overlay = join(repoRoot, 'modules');
  if (!isDir(overlay)) return [];

  const roots: string[] = [];
  const children = candidateChildren(overlay);

  // `modules/<id>/manifest.json` — the overlay itself holds modules.
  if (children.some((child) => existsSync(join(child, 'manifest.json')))) roots.push(overlay);

  // `modules/<repo>/<id>/manifest.json` — a repository holding modules.
  for (const child of children) {
    if (existsSync(join(child, 'manifest.json'))) continue; // already covered by the overlay root
    if (candidateChildren(child).some((g) => existsSync(join(g, 'manifest.json')))) roots.push(child);
  }

  return roots;
}

/** Values of `SERVER_MODULES_DIR` that mean "installed or not, load nothing".
 *  Without one there would be no way back to the inert state short of moving
 *  the checkout — worth having for reproducing an open-source-only instance. */
const OFF = new Set(['off', 'none', 'false', '0', 'disabled']);

export interface ResolvedModulesDir {
  /** What `ModuleHost.load()` scans. Empty ⇒ the feature is inert. */
  dir: string;
  /** How that was arrived at, for the boot log and `admin:modules --list`. */
  source: 'env' | 'discovered' | 'off' | 'none';
}

/**
 * Resolve `SERVER_MODULES_DIR` into the directory list to scan.
 *
 * An explicit value always wins — including the off-switch, and including a
 * path that does not exist, which `ModuleHost` warns about rather than silently
 * replacing with a guess.
 */
export function resolveModulesDir(raw: string | undefined, repoRoot?: string | null): ResolvedModulesDir {
  const value = (raw ?? '').trim();
  if (value && OFF.has(value.toLowerCase())) return { dir: '', source: 'off' };
  if (value) return { dir: value, source: 'env' };

  const discovered = discoverModuleRoots(repoRoot === undefined ? findRepoRoot() : repoRoot);
  return discovered.length
    ? { dir: discovered.join(','), source: 'discovered' }
    : { dir: '', source: 'none' };
}
