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
 * a given (fileId, version) is unique.
 *
 * PostgreSQL (see db/client.ts — a server over the wire, or PGlite in-process).
 * Two type choices are load-bearing and should not be "tidied up":
 *
 *   - **`jsonb` everywhere EXCEPT `params` and `presets`, which are plain `json`.**
 *     jsonb normalizes, which includes reordering object keys. `params` is a record
 *     keyed by parameter name and the editor renders it in insertion order, so jsonb
 *     would silently reshuffle every configurator's parameter UI on the next save.
 *   - **`timestamptz` for every timestamp.** Drizzle's `mode: 'date'` still hands the
 *     stores a `Date`, so `.toISOString()` / `.getTime()` in rowToData are unchanged,
 *     and psql shows a real date instead of an epoch integer.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, timestamp, json, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

import type { ScriptData, ScriptShared } from '@archiyou/core/src/execution/types';
import type { DeliveryFile, DeliveryOffer } from '@archiyou/types';

/**
 * Accounts. Kept minimal — the script model stays in the single script_versions
 * table below. `username` is the lowercase handle used as a script `author`, so
 * ownership on scripts joins to it. The .env test user is seeded into this table
 * on boot (see UserService.seedTestUser).
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),               // uuid
  username: text('username').notNull(),      // author handle (lowercase, unique)
  email: text('email').notNull(),            // unique
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  /** When the address was confirmed via an emailed link; null ⇒ unverified.
   *  Unverified accounts can use the editor but cannot publish or share (see
   *  requireVerified in routes/scripts.ts). Accounts that predate verification
   *  were backfilled as verified before this table moved to Postgres. */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
  /** Ids of the script modules this account may use (see modules/README.md).
   *  Deliberately read from here on every request rather than carried in the JWT:
   *  session tokens live for days and have no revocation list, so a claim would
   *  make a grant or a revoke take up to a week to take effect. A column makes
   *  both immediate, at the cost of one indexed lookup. */
  modules: jsonb('modules').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Operator account: may reach /admin (routes/admin.ts), whose only power today is
   *  marking a published version `validated` — i.e. clearing it to run server-side,
   *  unsandboxed, for anonymous callers. Granted only with `pnpm admin:users`.
   *
   *  Read from here on every request for the same reason as `modules` above, and it
   *  matters more here: a stale admin claim in a week-long token is a far worse thing
   *  to be unable to revoke than a stale module grant. */
  isAdmin: boolean('is_admin').notNull().default(false),
}, (t) => [
  uniqueIndex('users_username_unique').on(t.username),
  uniqueIndex('users_email_unique').on(t.email),
]);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const scriptVersions = pgTable('script_versions', {
  // ── ScriptData fields (types tracked from core to prevent drift) ──
  id: text('id').primaryKey(),                 // Script.id (version id)
  fileId: text('file_id').notNull(),           // Script.fileId (groups versions)
  author: text('author'),                      // owner handle (lowercase)
  name: text('name'),
  description: text('description'),
  details: text('details'),
  // nullable top-level semver; unique per (fileId, version). Null for working scripts.
  version: text('version'),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  code: text('code').notNull(),
  // `json`, not `jsonb`: key order is the parameter order the editor renders. See the
  // file header.
  params: json('params').$type<ScriptData['params']>(),
  presets: json('presets').$type<ScriptData['presets']>(),
  // JSON blob; null ⇒ this version is not published.
  published: jsonb('published').$type<ScriptData['published']>(),
  // JSON blob; null ⇒ this version is not shared. Otherwise the ScriptShared metadata.
  shared: jsonb('shared').$type<ScriptShared>(),
  // Public URL of the generated thumbnail (a PNG the viewer rendered), or null. Just a URL:
  // the bytes are files on disk (see services/ThumbnailStore.ts), so this column stays ~60
  // bytes and can ride along in the library list responses that already carry every
  // script's `code`. Saves inherit it from the file's previous row (ScriptStore).
  thumbnail: text('thumbnail'),
  created: timestamp('created', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updated: timestamp('updated', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('sv_by_file').on(t.fileId),
  index('sv_by_author').on(t.author, t.updated),
  // Partial indexes: only rows that are actually shared (resp. published) — they power
  // the "shared scripts" list and the admin configurator list, which spans every author
  // and so cannot lean on sv_by_author.
  //
  // The indexed columns are (author, updated), NOT the JSON blob itself. Indexing the
  // blob is what SQLite did, and Postgres will not have it: a btree entry is capped at
  // about 2.7 KB, so publishing a configurator with a normal amount of metadata would
  // fail the INSERT outright. The `WHERE` clause is what these lists actually filter on
  // anyway. Unqualified column refs: a predicate cannot name its own table.
  index('sv_by_shared').on(t.author, t.updated).where(sql`shared IS NOT NULL`),
  index('sv_by_published').on(t.author, t.updated).where(sql`published IS NOT NULL`),
  // One stored script per concrete version (NULL versions are distinct in Postgres too,
  // so every working copy is still allowed).
  uniqueIndex('sv_file_version').on(t.fileId, t.version),
]);

export type ScriptVersionRow = typeof scriptVersions.$inferSelect;
export type NewScriptVersionRow = typeof scriptVersions.$inferInsert;

/**
 * Visitor feedback, sent from the "Give feedback" button on a configurator
 * (<configurator-attribution>). Anyone may post — visitors are usually anonymous —
 * so `username` is only set when the sender happened to be signed in. The script
 * columns are a denormalized snapshot of what was on screen (not a foreign key):
 * feedback must outlive the version it was about. Read and moderated on /admin.
 */
export const feedback = pgTable('feedback', {
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
  starred: boolean('starred').notNull().default(false),
  created: timestamp('created', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('feedback_by_created').on(t.created),
]);

export type FeedbackRow = typeof feedback.$inferSelect;
export type NewFeedbackRow = typeof feedback.$inferInsert;

// ── Projects (plans/PROJECTS.md) ─────────────────────────────────────────────────────────
//
// A professional's projects: clients, projects, immutable configuration snapshots, the
// deliveries sent to clients, and the activity on them. Every row carries `professional`
// (the username handle of whoever runs the project — not necessarily the author of the
// scripts in it) and every query filters on it. No foreign keys, like the tables above:
// the store keeps the references consistent.

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A professional's clients, deduped on email (NULL emails are all distinct). */
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  professional: text('professional').notNull(),
  email: text('email'),                         // lowercased
  name: text('name'),
  company: text('company'),
  phone: text('phone'),
  address: text('address'),
  note: text('note'),
  created: at('created').notNull().defaultNow(),
  updated: at('updated').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('clients_by_email').on(t.professional, t.email),
  index('clients_by_updated').on(t.professional, t.updated),
]);

export type ClientRow = typeof clients.$inferSelect;

/** `status`: request → active | lost, active → won | lost, won | lost → active. */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  professional: text('professional').notNull(),
  number: integer('number').notNull(),          // per professional, shown as P-001
  title: text('title').notNull(),
  clientId: text('client_id'),
  status: text('status').notNull(),
  note: text('note'),
  archivedAt: at('archived_at'),
  /** The client's latest action (an order, an open, a response): with `seen_at` the
   *  "unread" dot on the project. */
  clientActivityAt: at('client_activity_at'),
  seenAt: at('seen_at'),
  created: at('created').notNull().defaultNow(),
  updated: at('updated').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('projects_by_number').on(t.professional, t.number),
  index('projects_by_status').on(t.professional, t.status, t.updated),
]);

export type ProjectRow = typeof projects.$inferSelect;

/**
 * Immutable snapshots of a script and its parameter values (rev 1..n per project). A
 * snapshot rather than a reference: working-copy rows of script_versions are rewritten by
 * autosave, and files can be deleted. `script` is `json`, not `jsonb`, for the reason in
 * the file header — it carries `params`, whose key order is the parameter order.
 */
export const configurations = pgTable('configurations', {
  id: text('id').primaryKey(),
  professional: text('professional').notNull(),
  projectId: text('project_id').notNull(),
  rev: integer('rev').notNull(),
  label: text('label'),
  script: json('script').$type<ScriptData>().notNull(),
  values: jsonb('values').$type<Record<string, unknown>>().notNull(),
  unitSystem: text('unit_system'),
  lang: text('lang'),
  thumbnail: text('thumbnail'),
  origin: text('origin').notNull(),             // order | added | adjust
  fulfillment: text('fulfillment'),             // the ordered product fulfillment
  sourceVersionId: text('source_version_id'),
  sourceDeliveryId: text('source_delivery_id'),
  message: text('message'),
  created: at('created').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('configurations_by_rev').on(t.projectId, t.rev),
]);

export type ConfigurationRow = typeof configurations.$inferSelect;

/** What a professional sent a client: one configuration's frozen files, a message, an
 *  optional offer and a link (`token`). Immutable once sent, apart from revoking it, the
 *  counters and the client's one response. Links do not expire. */
export const deliveries = pgTable('deliveries', {
  id: text('id').primaryKey(),
  professional: text('professional').notNull(),
  projectId: text('project_id').notNull(),
  configurationId: text('configuration_id').notNull(),
  number: integer('number').notNull(),          // per project
  title: text('title').notNull(),
  message: text('message'),
  offer: jsonb('offer').$type<DeliveryOffer>(),
  recipientEmail: text('recipient_email'),
  recipientName: text('recipient_name'),
  files: jsonb('files').$type<DeliveryFile[]>().notNull().default(sql`'[]'::jsonb`),
  bytes: integer('bytes').notNull().default(0),
  token: text('token'),                         // set on send
  status: text('status').notNull(),             // draft | sent | revoked
  allowAdjust: boolean('allow_adjust').notNull().default(false),
  sentAt: at('sent_at'),
  firstOpenedAt: at('first_opened_at'),
  openCount: integer('open_count').notNull().default(0),
  downloadCount: integer('download_count').notNull().default(0),
  response: text('response'),                   // accepted | declined | changes
  responseNote: text('response_note'),
  responseAt: at('response_at'),
  created: at('created').notNull().defaultNow(),
  updated: at('updated').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('deliveries_by_token').on(t.token),
  uniqueIndex('deliveries_by_number').on(t.projectId, t.number),
  index('deliveries_by_sent').on(t.professional, t.sentAt),
]);

export type DeliveryRow = typeof deliveries.$inferSelect;

/** A project's activity. Client events carry `visitor`, a daily-salted hash for counting
 *  unique opens — never an IP. Purged after config.events.retentionDays. */
export const events = pgTable('events', {
  id: text('id').primaryKey(),
  professional: text('professional').notNull(),
  projectId: text('project_id').notNull(),
  deliveryId: text('delivery_id'),
  configurationId: text('configuration_id'),
  type: text('type').notNull(),
  actor: text('actor').notNull(),               // professional | client
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  visitor: text('visitor'),
  created: at('created').notNull().defaultNow(),
}, (t) => [
  index('events_by_project').on(t.projectId, t.created),
  index('events_by_created').on(t.created),
]);

export type EventRow = typeof events.$inferSelect;
