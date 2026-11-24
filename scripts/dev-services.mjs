/**
 * dev-services — get what server-side execution needs ready before `pnpm dev` starts.
 *
 *   Redis    The API connects to Redis once, at boot (apps/server/src/plugin.ts): if
 *            Redis comes up later, /execute answers 503 until the server restarts. So
 *            it is started here, before the server. Something already answering on
 *            SERVER_REDIS_HOST:SERVER_REDIS_PORT is used as is; otherwise the redis
 *            service of docker-compose.dev.yml is started (Redis only, not Postgres).
 *            Without Docker this only warns: the editor and server still start, and
 *            only /execute is unavailable, as before.
 *
 *   meshup   The worker loads the mesh kernel from packages/meshup/dist
 *            (apps/server/tsconfig.runtime.json), so it is built once if missing.
 *
 * Postgres is left alone: PGlite, the tunnel or `pnpm docker:dev` stay your choice.
 *
 * Never fails `pnpm dev`: every problem is a warning, and the exit code is always 0.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');

// Same values the server will see: the root .env, without overriding the environment
if (existsSync(envFile))
{
    process.loadEnvFile(envFile);
}

const redisHost = process.env.SERVER_REDIS_HOST || 'localhost';
const redisPort = Number(process.env.SERVER_REDIS_PORT || 6379);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(redisHost);

const log = (line) => console.log(`[dev-services] ${line}`);
const warn = (line) => console.warn(`[dev-services] ⚠️  ${line}`);

/** True when something accepts a TCP connection on host:port within the timeout */
function isListening(host, port, timeoutMs = 500)
{
    return new Promise((done) =>
    {
        const socket = connect({ host, port });
        const finish = (ok) =>
        {
            socket.destroy();
            done(ok);
        };
        socket.setTimeout(timeoutMs, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

function run(command, args, options = {})
{
    return spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options }).status === 0;
}

async function ensureRedis()
{
    if (await isListening(redisHost, redisPort))
    {
        log(`Redis answers on ${redisHost}:${redisPort}`);
        return;
    }

    if (!isLocal)
    {
        warn(`no Redis on ${redisHost}:${redisPort}, and it is not local, so it is not started here.`);
        warn('Server-side execution (/execute) will answer 503.');
        return;
    }

    if (!run('docker', ['info'], { stdio: 'ignore' }))
    {
        warn(`no Redis on ${redisHost}:${redisPort} and Docker is not available.`);
        warn('Server-side execution (/execute) will answer 503. Start a Redis and restart `pnpm dev` to enable it.');
        return;
    }

    log('starting Redis (docker-compose.dev.yml, redis only)');
    if (!run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait', 'redis']))
    {
        warn('could not start Redis with Docker. Server-side execution (/execute) will answer 503.');
    }
}

function ensureMeshup()
{
    if (existsSync(resolve(root, 'packages/meshup/dist/index.js')))
    {
        return;
    }

    if (!existsSync(resolve(root, 'packages/meshup/package.json')))
    {
        warn('packages/meshup is empty (git submodule update --init --recursive). The worker will not start.');
        return;
    }

    log('building packages/meshup once, the worker needs its dist/');
    if (!run('pnpm', ['build:meshup']))
    {
        warn('building meshup failed. The worker will not start.');
    }
}

await ensureRedis();
ensureMeshup();
