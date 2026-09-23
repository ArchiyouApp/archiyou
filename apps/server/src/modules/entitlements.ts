/**
 * entitlements.ts — what a stored `users.modules` list means.
 *
 * Deliberately dependency-free. Both sides of the entitlement check need it:
 * UserService (which owns the column) and ModuleHost (which builds the catalog),
 * and ModuleHost must stay importable without opening the database — its unit
 * test scans a temp directory and connects to nothing.
 */

/**
 * Wildcard entitlement: this account may use every module installed on the
 * instance, including ones deployed after the grant was made.
 *
 * Stored literally in `users.modules` as the single entry `["*"]`. It can never
 * collide with a real module id: ModuleRegistry restricts ids and globals to
 * `/^[A-Za-z][A-Za-z0-9_]*$/`, so `*` is unreachable as a name.
 *
 * Intended for staff and for the operator's own account. It is not a substitute
 * for per-module grants on customer accounts, because it silently widens every
 * time a module is deployed.
 */
export const ALL_MODULES = '*';

/** Does this stored list grant every installed module? */
export function grantsAllModules(moduleIds: readonly string[]): boolean {
  return moduleIds.includes(ALL_MODULES);
}
