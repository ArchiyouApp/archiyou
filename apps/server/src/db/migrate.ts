/**
 * db/migrate.ts — apply the generated Drizzle migrations to the database.
 *
 * Two entry points, deliberately different:
 *
 *   runMigrations()   applies whatever is pending. `pnpm db:migrate`, the tests and
 *                     the one-off scripts call this.
 *   migrateOnBoot()   what the server calls, and it does NOT always migrate. See the
 *                     comment on it: a shared database must not be schema-changed by
 *                     whichever developer happens to start their dev server.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';

import { db, DATABASE_URL, describeDatabase, isRemoteDatabase, type Db } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Apply every pending migration. Idempotent. */
export async function runMigrations(): Promise<void> {
  // The two migrators are the same function over different sessions; the union type
  // of `db` hides which one it is, so the driver flag picks and the cast is local.
  const migrateFor = isRemoteDatabase ? migrateNodePg : migratePglite;
  await (migrateFor as (d: Db, opts: { migrationsFolder: string }) => Promise<void>)(
    db, { migrationsFolder },
  );
}

/** How many migrations this checkout has, and how many the database has applied.
 *  A database ahead of the checkout (applied > journal) is another developer's newer
 *  branch, which is worth saying out loud rather than quietly "having nothing to do". */
async function migrationState(): Promise<{ journal: number; applied: number }> {
  const meta = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  const journal = (meta.entries as unknown[]).length;
  try {
    // `db.execute` is typed per driver and `db` is the dialect, so the shape is asserted
    // here; both drivers return { rows }.
    const res = await db.execute(sql`select count(*)::int as n from drizzle."__drizzle_migrations"`) as
      { rows: Array<{ n: number }> };
    return { journal, applied: Number(res.rows[0]?.n ?? 0) };
  } catch {
    // No drizzle schema yet ⇒ nothing has ever been applied here.
    return { journal, applied: 0 };
  }
}

/**
 * Boot-time schema handling.
 *
 * On PGlite the database belongs to this checkout alone, so migrating it is free and
 * `pnpm dev` stays zero-config. In production the api container is the thing that owns
 * the schema, so it migrates on deploy as it always did.
 *
 * A DEVELOPMENT process pointed at a real PostgreSQL server does neither: that server
 * is shared, and a checkout sitting on a feature branch would otherwise migrate
 * everyone else's database — including production's — just by running `pnpm dev`. It
 * verifies instead, and refuses to start if the two disagree.
 */
export async function migrateOnBoot(): Promise<void> {
  const autoMigrate = !isRemoteDatabase || process.env.NODE_ENV === 'production';
  if (autoMigrate) {
    await runMigrations();
    return;
  }

  const { journal, applied } = await migrationState();
  if (applied === journal) return;

  const ahead = applied > journal;
  throw new Error(
    `Schema mismatch against ${describeDatabase()}\n` +
    `  this checkout has ${journal} migration(s); the database has ${applied} applied.\n` +
    (ahead
      ? '  The database is AHEAD of your branch — someone deployed or migrated a newer one.\n' +
        '  Pull that branch, or point SERVER_DATABASE_URL at your own database.\n'
      : '  The database is BEHIND your branch. A dev server deliberately does not migrate a\n' +
        '  shared database: run `pnpm db:migrate` yourself once you are sure it should change,\n' +
        '  or unset SERVER_DATABASE_URL to work against your own PGlite copy.\n'),
  );
}

// When executed directly (`tsx src/db/migrate.ts`), run and report.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { closeDb } = await import('./client');
  await runMigrations();
  console.log(`✅ Migrations applied to ${describeDatabase(DATABASE_URL)}`);
  await closeDb();
}
