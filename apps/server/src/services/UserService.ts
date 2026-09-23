/**
 * UserService — account registration/login over the `users` table.
 *
 * `username` is the lowercase handle used as a script `author` (and as the JWT
 * `sub`), so scripts scope by it. The .env test user is seeded on boot.
 */

import bcrypt from 'bcryptjs';
import { and, eq, ilike, ne, or, sql } from 'drizzle-orm';

import { uuid4 } from '@archiyou/core/src/utils';
import type { PublicUser } from '@archiyou/types';

import { db } from '../db/client';
import { users, type UserRow } from '../db/schema';
import { config } from '../config';
import { ALL_MODULES, grantsAllModules } from '../modules/entitlements';

const BCRYPT_ROUNDS = 10;

/** The one row of a `.limit(1)` query, or undefined. Postgres has no `.get()`. */
async function first<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
  return (await query)[0];
}

export class UserError extends Error {
  constructor(
    public readonly code: 'email_taken' | 'invalid_credentials' | 'invalid_token',
    message: string,
  ) {
    super(message);
  }
}

/** Client-safe view. `id` is the username handle (== JWT sub == script author). */
export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.username,
    email: u.email,
    name: u.name,
    avatarUrl: null,
    // Was hardcoded `true` before verification existed, so the client could never
    // tell. Now reflects the column, which the editor uses to show its banner.
    emailVerified: u.emailVerifiedAt !== null,
    // Which gated script modules this account may use. The editor needs it to
    // mark modules locked/unlocked; it is NOT the authority — every bundle fetch
    // and server-module call is re-checked against the database.
    modules: normalizeModuleIds(u.modules),
    // Lets the editor show the Admin entry. Not the authority — requireAdmin
    // re-reads the column on every admin request.
    isAdmin: u.isAdmin === true,
  };
}

/**
 * The view of *somebody else* — what the people picker is allowed to see.
 *
 * `toPublicUser` is the view of yourself (login, /auth/me) and legitimately carries
 * your address and entitlements. Handing that same shape to a directory search meant
 * any account could enumerate every user's email, so this drops both: the address,
 * and the module entitlements, which are nobody else's business either.
 *
 * `email` stays in the shape as null rather than being removed, so PublicUser stays
 * one type and the picker's `u.email ? … : nothing` branch simply does not render.
 */
export function toDirectoryUser(u: UserRow): PublicUser {
  return { ...toPublicUser(u), email: null, modules: [] };
}

/** Tolerate a legacy or hand-edited row: the column is JSON, so it can hold
 *  anything if someone writes it directly. Anything that is not a list of
 *  non-empty strings degrades to "no modules" rather than crashing a login. */
export function normalizeModuleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is string => typeof m === 'string' && m.length > 0);
}

// The wildcard lives in modules/entitlements.ts so ModuleHost can read it
// without importing this file (and with it, the database). Re-exported here
// because `users.modules` is this service's column.
export { ALL_MODULES, grantsAllModules };

export class UserService {
  async findByEmail(email: string): Promise<UserRow | undefined> {
    return first(db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1));
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    return first(db.select().from(users).where(eq(users.username, username.toLowerCase())).limit(1));
  }

  async findById(id: string): Promise<UserRow | undefined> {
    return first(db.select().from(users).where(eq(users.id, id)).limit(1));
  }

  /**
   * Search accounts for the "Share only with" picker, excluding `excludeUsername`
   * (the caller).
   *
   * Two deliberate narrowings, because this is the one route that reads *other*
   * people's rows and every signed-in account can call it:
   *
   *  - **Handle and name match on substring; email matches only in full.** A
   *    substring email search turns the directory into an address harvester, and
   *    lets anyone confirm whether a given address has an account — which is
   *    precisely what /auth/forgot-password refuses to disclose. Requiring the
   *    whole address keeps the real workflow (you already know the address of the
   *    person you want to share with) and removes the probe.
   *  - **The result never carries the address**, see toDirectoryUser.
   */
  async search(query: string, excludeUsername: string, limit = 10): Promise<PublicUser[]> {
    const raw = query.trim().toLowerCase();
    if (raw.length === 0) return [];
    const substring = `%${raw}%`;
    const rows = await db
      .select()
      .from(users)
      .where(
        and(
          ne(users.username, excludeUsername.toLowerCase()),
          or(
            // ilike, not like: Postgres LIKE is case-sensitive and SQLite's was not, so a
            // plain `like` here would quietly stop matching "Alice" for a query of "ali".
            // `username` is stored lowercase; `name` is not, hence the lower() on it.
            ilike(users.username, substring),
            ilike(sql`lower(${users.name})`, substring),
            eq(sql`lower(${users.email})`, raw),
          ),
        ),
      )
      .limit(limit);
    return rows.map(toDirectoryUser);
  }

  /** Turn an email/name into a unique lowercase handle. */
  private async deriveUsername(email: string, name?: string): Promise<string> {
    const base =
      (name || email.split('@')[0] || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 20) || 'user';
    if (!(await this.findByUsername(base))) return base;
    let candidate = base;
    let i = 2;
    do { candidate = `${base}${i++}`; } while (await this.findByUsername(candidate));
    return candidate;
  }

  /** Register a new account. Throws UserError('email_taken') on conflict. */
  async register(email: string, password: string, name?: string): Promise<UserRow> {
    const normalized = email.trim().toLowerCase();
    if (await this.findByEmail(normalized)) {
      throw new UserError('email_taken', 'An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const row: UserRow = {
      id: uuid4(),
      username: await this.deriveUsername(normalized, name),
      email: normalized,
      passwordHash,
      name: name ?? null,
      createdAt: new Date(),
      // Unverified until the emailed link is followed. The account is usable
      // immediately — only publishing and sharing require verification.
      emailVerifiedAt: null,
      // New accounts have no gated modules; grants are made with `pnpm admin:modules`.
      modules: [],
      // Never on registration — an operator is made only with `pnpm admin:users`,
      // which needs a shell on the box.
      isAdmin: false,
    };
    await db.insert(users).values(row);
    return row;
  }

  /** Verify credentials, resolving the identifier as an email OR a username
   *  handle (mirrors the legacy backend's email-or-username login). Throws
   *  UserError('invalid_credentials') on failure. */
  async login(identifier: string, password: string): Promise<UserRow> {
    const id = identifier.trim();
    const user = (await this.findByEmail(id)) ?? (await this.findByUsername(id));
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UserError('invalid_credentials', 'Invalid email or password');
    }
    return user;
  }

  /** Set (overwrite) a user's password. Used by the password-reset flow. Changing
   *  the hash also invalidates any outstanding reset links (see routes/auth.ts). */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  /** Mark an address confirmed. Idempotent: following a verification link twice
   *  is harmless, and the first timestamp is kept. */
  async markEmailVerified(userId: string): Promise<void> {
    await db.update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, userId), sql`${users.emailVerifiedAt} IS NULL`));
  }

  /** Module ids this account may use. Returns [] for an unknown handle, so a
   *  stale token can never widen access. */
  async getModules(username: string): Promise<string[]> {
    const user = await this.findByUsername(username);
    return user ? normalizeModuleIds(user.modules) : [];
  }

  /** Is this account entitled to one specific module? The single question every
   *  gated route asks. */
  async hasModule(username: string | null | undefined, moduleId: string): Promise<boolean> {
    if (!username) return false;
    const owned = await this.getModules(username);
    return grantsAllModules(owned) || owned.includes(moduleId);
  }

  /** Replace the entitlement list. Deduplicated and sorted so the stored value is
   *  stable and diffable. Returns the stored list, or null for an unknown handle.
   *
   *  A list containing the wildcard collapses to exactly `["*"]`: the named ids
   *  alongside it would grant nothing extra, and keeping them would leave a list
   *  that looks meaningful but is not — revoking one of them would change
   *  nothing. */
  async setModules(username: string, moduleIds: string[]): Promise<string[] | null> {
    const user = await this.findByUsername(username);
    if (!user) return null;
    const ids = normalizeModuleIds(moduleIds);
    const next = grantsAllModules(ids) ? [ALL_MODULES] : [...new Set(ids)].sort();
    await db.update(users).set({ modules: next }).where(eq(users.id, user.id));
    return next;
  }

  /** Grant modules, keeping existing ones. Returns the new list, or null for an
   *  unknown handle. */
  async grantModules(username: string, moduleIds: string[]): Promise<string[] | null> {
    const current = await this.findByUsername(username);
    if (!current) return null;
    return this.setModules(username, [...normalizeModuleIds(current.modules), ...moduleIds]);
  }

  /** Revoke modules. Returns the new list, or null for an unknown handle.
   *
   *  Revoking a named id from a wildcard account is a no-op — `["*"]` holds no
   *  named ids to remove. Pass `'*'` to drop the wildcard itself, or use
   *  setModules to replace it with an explicit list. The admin CLI says so out
   *  loud, because a silent no-op reads exactly like a successful revoke. */
  async revokeModules(username: string, moduleIds: string[]): Promise<string[] | null> {
    const current = await this.findByUsername(username);
    if (!current) return null;
    const drop = new Set(moduleIds);
    return this.setModules(username, normalizeModuleIds(current.modules).filter((m) => !drop.has(m)));
  }

  /** Is this account an operator? Returns false for an unknown handle, so a stale
   *  token can never widen access. Read per request by requireAdmin — never trusted
   *  from a JWT claim, because tokens live 7 days with no revocation list and a
   *  mistaken grant has to be undoable now, not next week. */
  async isAdmin(username: string | null | undefined): Promise<boolean> {
    if (!username) return false;
    return (await this.findByUsername(username))?.isAdmin === true;
  }

  /** Grant or revoke operator rights. Returns the stored value, or null for an
   *  unknown handle. Reachable only from `pnpm admin:users` — deliberately NOT
   *  exposed over HTTP, so admin cannot be handed out by anyone who merely has it. */
  async setAdmin(username: string, isAdmin: boolean): Promise<boolean | null> {
    const user = await this.findByUsername(username);
    if (!user) return null;
    await db.update(users).set({ isAdmin }).where(eq(users.id, user.id));
    return isAdmin;
  }

  /** Every account, for the `pnpm admin:modules --list` overview. Deliberately
   *  not reachable over HTTP — /users/search is the only route that reads other
   *  people's rows, and it narrows what it returns (see toDirectoryUser). */
  async listAll(): Promise<UserRow[]> {
    return db.select().from(users);
  }

  /** How many accounts exist — the context line on `pnpm admin:users --list`. */
  async countAll(): Promise<number> {
    // .mapWith(Number): count() is bigint, which the driver returns as a string.
    const rows = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(users);
    return rows[0]?.n ?? 0;
  }

  /** Every operator account, for `pnpm admin:users --list`. */
  async listAdmins(): Promise<UserRow[]> {
    return db.select().from(users).where(eq(users.isAdmin, true));
  }

  /** Ensure the .env test user exists (idempotent — runs on boot). */
  async seedTestUser(): Promise<void> {
    const t = config.testUser;
    if ((await this.findByEmail(t.email)) || (await this.findByUsername(t.username))) return;
    const passwordHash = await bcrypt.hash(t.password, BCRYPT_ROUNDS);
    await db.insert(users).values({
      id: uuid4(),
      username: t.username,
      email: t.email.toLowerCase(),
      passwordHash,
      name: t.name,
      createdAt: new Date(),
    });
    console.log(`👤 Seeded test user "${t.email}" (handle: ${t.username})`);
  }
}

export const userService = new UserService();
