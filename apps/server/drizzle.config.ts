import { defineConfig } from 'drizzle-kit';

// Drizzle Kit config — generates SQL migrations from src/db/schema.ts into
// src/db/migrations. Migrations are generated statically and applied by
// `pnpm db:migrate` (src/db/migrate.ts).
//
// drizzle-kit needs a real PostgreSQL server for `push`/`studio`/`pull`; plain
// `generate` only diffs the schema file against the stored snapshots and never
// connects, which is the only command we use here. The URL is the same
// SERVER_DATABASE_URL the runtime reads, so if you do reach for one of the
// connecting commands it cannot silently address a different database — but note
// that a `pglite://…` default is not something drizzle-kit can dial.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.SERVER_DATABASE_URL ?? 'postgres://archiyou:archiyou@127.0.0.1:5432/archiyou',
  },
});
