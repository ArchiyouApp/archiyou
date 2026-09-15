/**
 * db/schema.ts — a single table that IS the core `ScriptData` model.
 *
 * One row per saved script version (Script.id), grouped into files by fileId
 * (Script.fileId) and owned by `author` (the user's handle). Columns mirror
 * ScriptData one-to-one; the complex fields (tags/params/presets/published/
 * shared) are JSON, and their TS types are pulled straight from the core
 * ScriptData/ScriptShared types via `.$type<…>()` so the DB model can't drift
 * from ScriptSchema without a compile error here (and in ScriptStore).
 *
 * `published` null ⇒ the version is not published. `shared` null ⇒ not shared;
 * a non-null object carries the sharing metadata. `version` is a nullable
 * top-level semver — a working script has none; it's set on publish/share, and
 * a given (fileId, version) is unique. There is no users table beyond the one
 * below: auth is a single .env test user (see config.ts), so `author` fully
 * identifies ownership.
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type { ScriptData, ScriptShared } from '@archiyou/core/src/execution/types';

/**
 * Accounts. Kept minimal — the script model stays in the single script_versions
 * table below. `username` is the lowercase handle used as a script `author`, so
 * ownership on scripts joins to it. The .env test user is seeded into this table
 * on boot (see UserService.seedTestUser).
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),               // uuid
  username: text('username').notNull(),      // author handle (lowercase, unique)
  email: text('email').notNull(),            // unique
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  /** When the address was confirmed via an emailed link; null ⇒ unverified.
   *  Unverified accounts can use the editor but cannot publish or share (see
   *  requireVerified in routes/scripts.ts). Accounts that predate verification
   *  are backfilled as verified by the migration. */
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  /** Ids of the script modules this account may use (see modules/README.md).
   *  Deliberately read from here on every request rather than carried in the JWT:
   *  session tokens live for days and have no revocation list, so a claim would
   *  make a grant or a revoke take up to a week to take effect. A column makes
   *  both immediate, at the cost of one indexed lookup. */
  modules: text('modules', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Operator account: may reach /admin (routes/admin.ts), whose only power today is
   *  marking a published version `validated` — i.e. clearing it to run server-side,
   *  unsandboxed, for anonymous callers. Granted only with `pnpm admin:users`.
   *
   *  Read from here on every request for the same reason as `modules` above, and it
   *  matters more here: a stale admin claim in a week-long token is a far worse thing
   *  to be unable to revoke than a stale module grant. */
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  usernameUnique: uniqueIndex('users_username_unique').on(t.username),
  emailUnique: uniqueIndex('users_email_unique').on(t.email),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const scriptVersions = sqliteTable('script_versions', {
  // ── ScriptData fields (types tracked from core to prevent drift) ──
  id: text('id').primaryKey(),                 // Script.id (version id)
  fileId: text('file_id').notNull(),           // Script.fileId (groups versions)
  author: text('author'),                      // owner handle (lowercase)
  name: text('name'),
  description: text('description'),
  details: text('details'),
  // nullable top-level semver; unique per (fileId, version). Null for working scripts.
  version: text('version'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  code: text('code').notNull(),
  params: text('params', { mode: 'json' }).$type<ScriptData['params']>(),
  presets: text('presets', { mode: 'json' }).$type<ScriptData['presets']>(),
  // JSON blob; null ⇒ this version is not published.
  published: text('published', { mode: 'json' }).$type<ScriptData['published']>(),
  // JSON blob; null ⇒ this version is not shared. Otherwise the ScriptShared metadata.
  shared: text('shared', { mode: 'json' }).$type<ScriptShared>(),
  // Public URL of the generated thumbnail, or null. Just a URL: the SVG bytes are files on
  // disk (see services/ThumbnailStore.ts), so this column stays ~60 bytes and can ride along
  // in the library list responses that already carry every script's `code`.
  thumbnail: text('thumbnail'),
  created: integer('created', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updated: integer('updated', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => ({
  byFile: index('sv_by_file').on(t.fileId),
  byAuthor: index('sv_by_author').on(t.author, t.updated),
  // Partial index: only rows that are actually shared — powers the "shared scripts" list.
  // Unqualified column ref: SQLite rejects table-qualified names in index WHERE clauses.
  byShared: index('sv_by_shared').on(t.shared).where(sql`shared IS NOT NULL`),
  // Same partial-index trick for the admin configurator list, which spans every author
  // and so cannot lean on sv_by_author.
  byPublished: index('sv_by_published').on(t.published).where(sql`published IS NOT NULL`),
  // One stored script per concrete version (SQLite treats NULL versions as distinct).
  fileVersionUnique: uniqueIndex('sv_file_version').on(t.fileId, t.version),
}));

export type ScriptVersionRow = typeof scriptVersions.$inferSelect;
export type NewScriptVersionRow = typeof scriptVersions.$inferInsert;

/**
 * Visitor feedback, sent from the "Give feedback" button on a configurator
 * (<configurator-attribution>). Anyone may post — visitors are usually anonymous —
 * so `username` is only set when the sender happened to be signed in. The script
 * columns are a denormalized snapshot of what was on screen (not a foreign key):
 * feedback must outlive the version it was about. Read and moderated on /admin.
 */
export const feedback = sqliteTable('feedback', {
  id: text('id').primaryKey(),                  // uuid
  message: text('message').notNull(),
  // What the visitor was looking at. All nullable: the preview in the editor may
  // show a script that was never saved.
  scriptId: text('script_id'),
  fileId: text('file_id'),
  scriptAuthor: text('script_author'),
  scriptName: text('script_name'),
  scriptVersion: text('script_version'),
  /** The page address, params included, so the configuration can be reproduced. */
  url: text('url'),
  /** Handle of the sender when signed in, else null. */
  username: text('username'),
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  created: integer('created', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => ({
  byCreated: index('feedback_by_created').on(t.created),
}));

export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedbackRow = typeof feedback.$inferInsert;
