/**
 * db/client.ts — the shared PostgreSQL + Drizzle instance.
 *
 * One dialect, two drivers. `SERVER_DATABASE_URL` (config.databaseUrl) picks:
 *
 *   postgres://… | postgresql://…   node-postgres, pooled. A real server: the
 *                                   container in docker-compose, or the central
 *                                   instance through an ssh tunnel.
 *   memory://                       PGlite in RAM — a fresh, empty database that
 *                                   dies with the process. What the tests use.
 *   pglite://<dir> | unset          PGlite on disk under <dir>.
 *
 * PGlite is PostgreSQL compiled to WASM running inside this process. Same SQL, same
 * schema, same migrations as the server — so "Postgres only" stays true while
 * `git clone && pnpm dev` still needs no container and no configuration. Connecting
 * to a database other people also use is therefore always deliberate.
 *
 * `db` is typed as the dialect, not as either driver, so nothing downstream has to
 * know which one it got.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import { config } from '../config';

import * as schema from './schema';

/** The configured URL, verbatim. Printed at boot and by the admin CLIs. */
export const DATABASE_URL = config.databaseUrl;

/** Is this a real PostgreSQL server (rather than in-process PGlite)? Several
 *  guards hang off this: boot migrations, test-user seeding, and what the admin
 *  tools say out loud before they write. */
export const isRemoteDatabase = /^postgres(ql)?:\/\//i.test(DATABASE_URL);

/** The URL with any password replaced — safe to print. */
export function describeDatabase(url = DATABASE_URL): string {
  if (!/^postgres(ql)?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'postgres://(unparseable URL)';
  }
}

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The underlying driver handle, so closeDb() can shut it down. */
let handle: Pool | PGlite;

function open(): Db {
  if (isRemoteDatabase) {
    // Modest pool: this process is one API container, and the central instance is
    // shared with every developer's tunnel.
    const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
    handle = pool;
    return drizzleNodePg(pool, { schema });
  }

  // `memory://` is PGlite's own in-memory URL; anything else names a data directory.
  const dataDir = DATABASE_URL === 'memory://'
    ? 'memory://'
    : resolve(DATABASE_URL.replace(/^pglite:\/\//i, ''));
  if (dataDir !== 'memory://' && !existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const client = new PGlite(dataDir);
  handle = client;
  return drizzlePglite(client, { schema });
}

export const db: Db = open();

/** Release the connection(s). Long-running processes never call this — it is for
 *  the admin CLIs and one-off scripts, which would otherwise hang on an open pool. */
export async function closeDb(): Promise<void> {
  if (handle instanceof Pool) await handle.end();
  else await handle.close();
}

export { schema };
