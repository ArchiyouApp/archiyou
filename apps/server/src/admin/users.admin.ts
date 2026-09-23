/**
 * users — grant, revoke and inspect operator (admin) rights.
 *
 * An operator can reach /admin (routes/admin.ts), whose one power is marking a
 * published version `validated` — clearing it to run SERVER-SIDE, unsandboxed, in the
 * execution worker's Node process, for callers who may be anonymous. Read SECURITY.md
 * before granting this to anyone.
 *
 * This is the ONLY way to change the flag. There is deliberately no HTTP route for it,
 * so holding admin does not let you hand admin out, and so the first operator can be
 * created before any admin UI exists — the chicken-and-egg an admin-only screen has.
 *
 * The flag is read from the database on every request, so a change here takes effect on
 * the operator's next call — there is no token to expire and no cache to clear.
 *
 * Exit codes:
 *   0  the requested change was applied, or the listing printed
 *   2  usage error, or the named account does not exist — nothing was changed
 *
 * Usage (from apps/server):
 *   pnpm admin:users --list
 *   pnpm admin:users --user <handle>
 *   pnpm admin:users --user <handle> --grant-admin
 *   pnpm admin:users --user <handle> --revoke-admin
 */

import 'dotenv/config';

import { userService } from '../services/UserService';

//// ARGS ////

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? '' : v;
}

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

function usage(message?: string): never {
  if (message) console.error(`\n✗ ${message}`);
  console.error(`
Usage:
  pnpm admin:users --list
  pnpm admin:users --user <handle>
  pnpm admin:users --user <handle> --grant-admin
  pnpm admin:users --user <handle> --revoke-admin

An operator can mark published scripts as validated, which lets them run
server-side without a sandbox. See SECURITY.md.
`);
  process.exit(2);
}

//// COMMANDS ////

/** Every operator, and the size of the account table for context. */
async function listAll(): Promise<void> {
  const total = await userService.countAll();
  const admins = (await userService.listAdmins()).sort((a, b) => a.username.localeCompare(b.username));

  console.log(`\nOperators (${admins.length} of ${total} accounts):`);
  if (admins.length === 0) {
    // Expected on a fresh instance, and the reason /admin 403s for everybody —
    // worth saying out loud rather than printing an empty list.
    console.log('  (none — /admin is closed to everyone until you grant this)');
  }
  admins.forEach((u) => console.log(`  ${u.username} (${u.email})`));
  console.log('');
}

async function showUser(handle: string): Promise<void> {
  const user = await userService.findByUsername(handle);
  if (!user) usage(`no account with handle '${handle}'`);
  console.log(`\n${user.username} (${user.email}): ${user.isAdmin ? 'operator' : 'not an operator'}\n`);
}

//// MAIN ////

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) usage();

  if (hasFlag('--list')) {
    await listAll();
    return;
  }

  const handle = argValue('--user');
  if (!handle) usage('--user <handle> is required (or use --list)');
  if (!(await userService.findByUsername(handle))) usage(`no account with handle '${handle}'`);

  const grant = hasFlag('--grant-admin');
  const revoke = hasFlag('--revoke-admin');

  if (grant && revoke) usage('--grant-admin and --revoke-admin are mutually exclusive');

  if (!grant && !revoke) {
    await showUser(handle);
    return;
  }

  const before = await userService.isAdmin(handle);
  await userService.setAdmin(handle, grant);
  const after = await userService.isAdmin(handle);

  console.log(`\n${handle}`);
  console.log(`  before: ${before ? 'operator' : 'not an operator'}`);
  console.log(`  after:  ${after ? 'operator' : 'not an operator'}`);
  if (after && !before) {
    console.log(
      '\n⚠ This account can now clear scripts to run unsandboxed on this machine.\n' +
      '  Validating a script means having READ its code. See SECURITY.md.',
    );
  }
  console.log('\nTakes effect on the next request — the flag is read per request.\n');
}

await main();
