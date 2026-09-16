// Archiyou server — one backend, one root API namespace.
//
//   /auth/*                          auth
//   /scripts/{user}/*                the user's own scripts (authed, self-scoped)
//   /scripts/{published,shared}/*    public libraries (DB-backed)
//   /scripts/published/execute/*     server-side execution (Redis/BullMQ; `pnpm worker`)
//
// The DB (script_versions) is the single source of truth for scripts; a row is
// "published"/"shared" when that metadata column is set.

import 'dotenv/config';

import Fastify from 'fastify';

import { config } from './config';
import { runMigrations } from './db/migrate';
import { userService } from './services/UserService';
import { serverApiPlugin } from './plugin';

async function main(): Promise<void> {
  runMigrations();               // idempotent: brings the SQLite file up to the latest schema

  // Dev convenience account — never seeded in production unless explicitly asked
  // for with a real password (see config.seedTestUser).
  if (config.seedTestUser) {
    await userService.seedTestUser();
  }

  const app = Fastify({
    logger: false,
    // Honour X-Forwarded-For/Proto from the reverse proxy in front of us (Caddy),
    // so request.ip is the real client. Without this every request appears to come
    // from the proxy's container IP, which silently collapses the per-IP rate
    // limiters (auth + /proxy) into a single shared bucket for all traffic.
    trustProxy: true,
    // Fastify defaults to 1 MiB. Script bodies (code + params + presets) can legitimately
    // exceed that.
    bodyLimit: config.bodyLimitBytes,
  });

  // The whole API at the root — one JWT/CORS, one /scripts namespace.
  await app.register(serverApiPlugin);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`🚀 Archiyou server on http://localhost:${config.port}  →  /auth + /scripts/{user,published,shared}`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
