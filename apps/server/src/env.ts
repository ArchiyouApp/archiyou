/**
 * env.ts — load the repository's one `.env`, at the root beside docker-compose.yml, into
 * process.env. Imported FIRST by the entry points that should see it: the API (index.ts),
 * migrations and the admin scripts.
 *
 * Never by the execution worker or anything it loads: under compose the checkout, this
 * `.env` included, is mounted into the worker's container too, and the worker must see
 * only the variables compose hands it (see docker-compose.yml).
 *
 * Variables already in the environment win (dotenv never overrides), so a container's
 * env_file and an inline `VAR=… pnpm …` take precedence over the file.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
