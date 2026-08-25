/**
 *  env.ts — load the local .env (if present) before anything reads process.env.
 *  Import this first for its side effect: `import './env.js';`
 *  Uses Node's built-in env-file loader (Node >= 20.6); no dependency.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath) && typeof (process as any).loadEnvFile === 'function')
{
    (process as any).loadEnvFile(envPath);
}
