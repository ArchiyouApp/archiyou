#!/usr/bin/env node
/**
 * A ratchet for packages that are not type-clean yet.
 *
 * `typecheck-own.mjs` demands zero errors, which works for apps/server,
 * apps/editor and packages/ui. packages/core is not there yet, and waiting for
 * zero would mean no gate at all — which is how the boundary drifted in the
 * first place.
 *
 * So: record the current count as a budget and fail if it goes UP. New code
 * cannot add type errors, and every cleanup commit lowers the number. When the
 * budget reaches 0, delete this and switch the package to typecheck-own.mjs.
 *
 * Usage:  node scripts/typecheck-budget.mjs <package-dir> <max-errors>
 *   e.g.  node scripts/typecheck-budget.mjs packages/core 197
 *
 * Going *under* budget passes, with a loud note asking you to lower the number
 * in the same commit. (Failing on an improvement would block perfectly good PRs;
 * the note is the nudge that keeps the budget honest.)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [pkgArg, budgetArg] = process.argv.slice(2);
if (!pkgArg || budgetArg === undefined) {
  console.error('usage: node scripts/typecheck-budget.mjs <package-dir> <max-errors>');
  process.exit(2);
}

const budget = Number(budgetArg);
if (!Number.isInteger(budget) || budget < 0) {
  console.error(`max-errors must be a non-negative integer, got "${budgetArg}"`);
  process.exit(2);
}

const tsconfig = resolve(repoRoot, pkgArg, 'tsconfig.json');
if (!existsSync(tsconfig)) {
  console.error(`no tsconfig.json in ${pkgArg}`);
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
const count = lines.length;

/** Group diagnostics by file, most-affected first. */
function topFiles(n) {
  const byFile = new Map();
  for (const line of lines) {
    const f = (line.match(/^(.*?)\(\d+,\d+\):/) ?? [])[1] ?? '?';
    byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }
  return [...byFile].sort((a, b) => b[1] - a[1]).slice(0, n);
}

if (count > budget) {
  console.error(`\n${pkgArg}: ${count} type errors, budget is ${budget} (+${count - budget}).\n`);
  console.error('New type errors are not allowed. Fix them, or — if you raised the');
  console.error('count deliberately — update the budget where it is set.\n');
  console.error('Most-affected files:');
  for (const [f, n] of topFiles(10)) console.error(`  ${String(n).padStart(4)}  ${f}`);
  process.exit(1);
}

if (count < budget) {
  console.log(`${pkgArg}: ${count} type errors — ${budget - count} below the budget of ${budget}.`);
  console.log(`Please lower the budget to ${count} in the same commit so it keeps ratcheting.`);
  process.exit(0);
}

console.log(`${pkgArg}: ${count} type errors, exactly at budget (${budget}).`);
