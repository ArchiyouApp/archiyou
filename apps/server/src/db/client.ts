/**
 * db/client.ts — the shared better-sqlite3 + Drizzle instance.
 *
 * A single embedded SQLite file (DATABASE_FILE). WAL mode for better
 * read/write concurrency; foreign keys enforced for cascade deletes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { config } from '../config';

import * as schema from './schema';

export const DATABASE_FILE = resolve(config.databaseFile);

// Ensure the parent directory exists before better-sqlite3 opens the file.
const dir = dirname(DATABASE_FILE);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export const sqlite = new Database(DATABASE_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export { schema };
