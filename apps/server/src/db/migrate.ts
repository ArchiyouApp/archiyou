/**
 * db/migrate.ts — apply generated Drizzle migrations to the SQLite file.
 * Run standalone via `pnpm db:migrate`, and also invoked on server boot.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import 'dotenv/config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { db, DATABASE_FILE } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(): void {
  migrate(db, { migrationsFolder });
}

// When executed directly (`tsx src/db/migrate.ts`), run and report.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  console.log(`✅ Migrations applied to ${DATABASE_FILE}`);
}
