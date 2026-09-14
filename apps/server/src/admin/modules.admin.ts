/**
 * modules — grant, revoke and inspect script-module entitlements.
 *
 * Access to a gated script module (see modules/README.md) is a per-user list of
 * module ids in `users.modules`. This is the only supported way to change it.
 *
 * Entitlements are read from the database on every request, so a change here
 * takes effect on the user's next run — there is no token to expire and no cache
 * to clear.
 *
 * Exit codes:
 *   0  the requested change was applied, or the listing printed
 *   2  usage error, or the named account does not exist — nothing was changed
 *
 * Usage (from apps/server):
 *   pnpm admin:modules --list
 *   pnpm admin:modules --user <handle>
 *   pnpm admin:modules --user <handle> --grant <id>[,<id>…]
 *   pnpm admin:modules --user <handle> --revoke <id>[,<id>…]
 *   pnpm admin:modules --user <handle> --set <id>[,<id>…]     (replaces the list)
 *   pnpm admin:modules --user <handle> --set ""               (revokes everything)
 *   pnpm admin:modules --user <handle> --grant '*'            (every module, incl. future ones)
 *   pnpm admin:modules --user <handle> --revoke '*'           (drops the wildcard)
 *
 * Quote the wildcard — an unquoted `*` is expanded by the shell to the files in
 * the current directory before this script ever sees it.
 */

import 'dotenv/config';

import { db } from '../db/client';
import { users } from '../db/schema';
import { userService, normalizeModuleIds } from '../services/UserService';
import { ALL_MODULES, grantsAllModules } from '../modules/entitlements';
import { moduleHost } from '../modules/ModuleHost';
import { config } from '../config';

//// ARGS ////

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  // An empty value is meaningful for --set (revoke everything), so only a
  // missing value or another flag counts as absent.
  return v === undefined || v.startsWith('--') ? '' : v;
}

const hasFlag = (flag: string): boolean => process.argv.includes(flag);
const idList = (raw: string | undefined): string[] =>
  (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function usage(message?: string): never {
  if (message) console.error(`\n✗ ${message}`);
  console.error(`
Usage:
  pnpm admin:modules --list
  pnpm admin:modules --user <handle>
  pnpm admin:modules --user <handle> --grant <id>[,<id>…]
  pnpm admin:modules --user <handle> --revoke <id>[,<id>…]
  pnpm admin:modules --user <handle> --set <id>[,<id>…]

  '*' is a wildcard: every module installed now or later. Quote it, or the
  shell expands it before this script sees it.
`);
  process.exit(2);
}

//// COMMANDS ////

/** Why the catalog is empty, per the way `dir` was resolved (see config.modules). */
const WHY_EMPTY: Record<typeof config.modules.dirSource, string> = {
  none: "nothing installed under modules/, and SERVER_MODULES_DIR is unset",
  discovered: `nothing loaded from ${config.modules.dir}`,
  env: `nothing loaded from SERVER_MODULES_DIR=${config.modules.dir}`,
  off: 'SERVER_MODULES_DIR is set to off',
};

/** Everyone who has any module, plus what is installed on this instance. */
function listAll(): void {
  const installed = moduleHost.list();
  console.log(`\nInstalled modules (${installed.length}):`);
  if (installed.length === 0) {
    // The common case on a fresh instance, and easy to mistake for a bug — so say
    // which of the three reasons it is rather than naming a setting that, these
    // days, is usually not the one at fault.
    console.log(`  (none — ${WHY_EMPTY[config.modules.dirSource]})`);
  } else {
    installed.forEach((m) => console.log(`  ${m.id}@${m.version}  [${m.runtime}]  ${m.name}`));
  }

  const rows = db.select().from(users).all();
  const entitled = rows
    .map((u) => ({ username: u.username, modules: normalizeModuleIds(u.modules) }))
    .filter((u) => u.modules.length > 0)
    .sort((a, b) => a.username.localeCompare(b.username));

  console.log(`\nAccounts with entitlements (${entitled.length} of ${rows.length}):`);
  if (entitled.length === 0) console.log('  (none)');
  entitled.forEach((u) => console.log(`  ${u.username}: ${describe(u.modules)}`));
  console.log('');
}

/** How a stored list reads to an operator. A bare `*` gives no hint that it is a
 *  wildcard rather than a module someone typed by mistake. */
function describe(moduleIds: string[]): string {
  if (grantsAllModules(moduleIds)) return `${ALL_MODULES}  (all modules, including future ones)`;
  return moduleIds.length ? moduleIds.join(', ') : '(no modules)';
}

function showUser(handle: string): void {
  const user = userService.findByUsername(handle);
  if (!user) usage(`no account with handle '${handle}'`);
  console.log(`\n${user.username} (${user.email}): ${describe(normalizeModuleIds(user.modules))}\n`);
}

/** Warn about ids that are not installed here. Deliberately NOT an error: a grant
 *  may legitimately precede a deployment, and a module can be temporarily removed
 *  without wanting to drop everyone's access. */
function warnUnknown(ids: string[]): void {
  const installed = new Set(moduleHost.list().map((m) => m.id));
  if (installed.size === 0) return; // nothing installed — no signal to give
  // The wildcard is not a module id, so it is never "not installed".
  const unknown = ids.filter((id) => id !== ALL_MODULES && !installed.has(id));
  if (unknown.length) {
    console.warn(`⚠ not installed on this instance: ${unknown.join(', ')}`);
  }
}

//// MAIN ////

function main(): void {
  if (hasFlag('--help') || hasFlag('-h')) usage();

  if (hasFlag('--list')) {
    listAll();
    return;
  }

  const handle = argValue('--user');
  if (!handle) usage('--user <handle> is required (or use --list)');

  if (!userService.findByUsername(handle)) usage(`no account with handle '${handle}'`);

  const grant = hasFlag('--grant') ? idList(argValue('--grant')) : null;
  const revoke = hasFlag('--revoke') ? idList(argValue('--revoke')) : null;
  const set = hasFlag('--set') ? idList(argValue('--set')) : null;

  if (set !== null && (grant !== null || revoke !== null)) {
    usage('--set replaces the whole list; do not combine it with --grant/--revoke');
  }

  if (grant === null && revoke === null && set === null) {
    showUser(handle);
    return;
  }

  const before = userService.getModules(handle);

  if (set !== null) {
    warnUnknown(set);
    userService.setModules(handle, set);
  }
  if (grant !== null) {
    if (grant.length === 0) usage('--grant needs at least one module id');
    warnUnknown(grant);
    userService.grantModules(handle, grant);
  }
  if (revoke !== null) {
    if (revoke.length === 0) usage('--revoke needs at least one module id');
    // `["*"]` holds no named ids, so removing one from it changes nothing. Said
    // out loud because the before/after below would otherwise look like a
    // successful revoke of an account that still has access to everything.
    if (grantsAllModules(before) && !revoke.includes(ALL_MODULES)) {
      console.warn(
        `⚠ ${handle} has the '${ALL_MODULES}' wildcard, so revoking ${revoke.join(', ')} changes nothing.\n` +
        `  Use --revoke '${ALL_MODULES}' to drop it, or --set <ids> to replace it with an explicit list.`,
      );
    }
    userService.revokeModules(handle, revoke);
  }

  const after = userService.getModules(handle);
  console.log(`\n${handle}`);
  console.log(`  before: ${describe(before)}`);
  console.log(`  after:  ${describe(after)}`);
  console.log('\nTakes effect on the next run — entitlements are read per request.\n');
}

main();
