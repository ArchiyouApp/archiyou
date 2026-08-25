#!/usr/bin/env node
/**
 * Typecheck one workspace package's OWN source, ignoring errors inside the other
 * workspace packages its program pulls in.
 *
 * Why this is needed: @archiyou/core (and meshup) are consumed as TypeScript
 * *source*, not as built artifacts, so `tsc -p <pkg>` compiles them too and
 * reports their pre-existing errors. Those belong to core's backlog, not to the
 * package under test, and they made a CI gate impossible — so nothing was checked
 * at all, and the boundary silently rotted.
 *
 * This runs the real compile — every cross-package call is still checked against
 * core's actual types — but fails only on diagnostics in the package's own
 * directory.
 *
 * Usage:  node scripts/typecheck-own.mjs <package-dir>
 *   e.g.  node scripts/typecheck-own.mjs apps/server
 *
 * Retire this per package as core is cleaned up, and gate on `tsc` directly.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pkgArg = process.argv[2];
if (!pkgArg) {
  console.error('usage: node scripts/typecheck-own.mjs <package-dir>   e.g. apps/server');
  process.exit(2);
}

const pkgDir = resolve(repoRoot, pkgArg);
const tsconfig = resolve(pkgDir, 'tsconfig.json');
if (!existsSync(tsconfig)) {
  console.error(`no tsconfig.json at ${relative(repoRoot, tsconfig)}`);
  process.exit(2);
}

const tsc = spawnSync(
  'npx',
  ['tsc', '--noEmit', '--pretty', 'false', '-p', tsconfig],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' },
);

const lines = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
  .split('\n')
  .filter((l) => l.includes('error TS'));

// Diagnostics are paths relative to tsc's cwd (the repo root). A diagnostic
// belongs to this package when its path starts with the package directory.
const ownPrefix = `${relative(repoRoot, pkgDir)}${sep}`;
const pathOf = (line) => (line.match(/^(.*?)\(\d+,\d+\):/) ?? [])[1] ?? '';
const isOwn = (line) => {
  const p = pathOf(line);
  return p.startsWith(ownPrefix) && !p.includes('node_modules');
};

const own = lines.filter(isOwn);
const foreign = lines.filter((l) => !isOwn(l));

if (foreign.length > 0) {
  const byPackage = new Map();
  for (const line of foreign) {
    const p = pathOf(line);
    const m = p.match(/^((?:packages|apps)\/[^/]+)\//);
    const key = m ? m[1] : 'other';
    byPackage.set(key, (byPackage.get(key) ?? 0) + 1);
  }
  const summary = [...byPackage]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  console.log(`note: ignoring ${foreign.length} pre-existing error(s) outside ${pkgArg} (${summary})`);
}

if (own.length > 0) {
  console.error(`\n${own.length} type error(s) in ${pkgArg}:\n`);
  for (const line of own) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`ok: ${pkgArg} typechecks cleanly against its dependencies' real types`);
