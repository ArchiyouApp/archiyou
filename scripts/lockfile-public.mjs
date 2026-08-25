/**
 * Regenerate pnpm-lock.yaml as a PUBLIC checkout would have it.
 *
 * pnpm records one importer per workspace project, so installing with the
 * private ./modules overlay present writes those module names — and their full
 * dependency lists — into the tracked lockfile. That leaks both the existence
 * of a private module and, from its deps, what it does. The
 * `private-modules-boundary` CI job fails the build when it happens; this
 * script is the fix it points at.
 *
 * Renaming each overlay directory to a dot-prefixed name is enough to hide it:
 * the `modules/*` globs in pnpm-workspace.yaml do not match dotfiles. The
 * rename is within one directory, so it is atomic and cheap, and the finally
 * block puts every entry back even if pnpm fails.
 *
 * pnpm tolerates importers that have no directory on disk, so the lockfile this
 * writes still installs cleanly here, with the overlay present.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const MODULES = 'modules';
const parked = [];

try {
  for (const entry of readdirSync(MODULES, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const from = join(MODULES, entry.name);
    const to = join(MODULES, `.parked-${entry.name}`);
    renameSync(from, to);
    parked.push([to, from]);
    console.log(`parked  ${from}`);
  }

  if (parked.length === 0) console.log('no private overlay present — regenerating as-is');

  execFileSync('pnpm', ['install', '--lockfile-only'], { stdio: 'inherit' });
} finally {
  for (const [to, from] of parked) {
    renameSync(to, from);
    console.log(`restored ${from}`);
  }
}
