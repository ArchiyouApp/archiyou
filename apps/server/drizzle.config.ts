import { defineConfig } from 'drizzle-kit';

// Drizzle Kit config — generates SQL migrations from src/db/schema.ts.
// Migrations are generated statically and applied via `pnpm db:migrate`.
//
// Reads the same SERVER_DATABASE_FILE the runtime uses (src/db/client.ts). It
// previously read DATABASE_FILE, which nothing else set, so drizzle-kit and the
// server could silently point at different database files.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.SERVER_DATABASE_FILE ?? './data/archiyou.db',
  },
});
