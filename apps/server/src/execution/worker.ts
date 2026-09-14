#!/usr/bin/env node

/**
 * Standalone Execution Worker Entry Point
 * Starts an execution worker that connects to Redis and processes script execution tasks
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExecutionWorker } from './ExecutionWorker.js';
import type { RedisConfig } from './types.js';

/**
 * The mesh kernel has to be the BUILT @archiyou/meshup, not its TypeScript source.
 *
 * The package's `exports` point at ./src for the browser, where Vite compiles it
 * correctly. Node cannot: tsx applies one tsconfig, and only to files matching that
 * config's `include` — nothing includes packages/meshup/src, so it would be compiled
 * with no options at all and its legacy decorators would be read as TC39 ones. See
 * tsconfig.runtime.json, which redirects the import to dist/ for exactly this reason.
 *
 * Checked here rather than left to fail: without it the first symptom is
 * "Cannot read properties of undefined (reading 'value')" thrown from inside
 * sceneDecorators.ts, several layers down, which says nothing about what to do.
 */
function assertMeshupBuilt(): void
{
    const here = dirname(fileURLToPath(import.meta.url));         // apps/server/src/execution
    const dist = resolve(here, '../../../../packages/meshup/dist/index.js');
    if (existsSync(dist)) return;

    console.error('FATAL: packages/meshup/dist is missing — the mesh kernel cannot load.');
    console.error(`  looked for: ${dist}`);
    console.error('  build it once, from the repo root:  pnpm build:meshup');
    console.error('  (the Docker entrypoint does this for you; a local worker needs it run by hand)');
    process.exit(1);
}

// Get Redis configuration from environment variables
const redisConfig: RedisConfig = {
    host: process.env.SERVER_REDIS_HOST || 'localhost',
    port: parseInt(process.env.SERVER_REDIS_PORT || '6379'),
    password: process.env.SERVER_REDIS_PASSWORD || undefined,
};

const workerId = process.env.WORKER_ID || 'worker-unknown';

assertMeshupBuilt();

console.log(`🚀 Starting Archiyou Execution Worker [${workerId}]...`);
console.log('📡 Redis config:', `${redisConfig.host}:${redisConfig.port}`);

async function startWorker() 
{
    try {
        const worker = await new ExecutionWorker(redisConfig).init();
        console.log(`✅ Execution Worker [${workerId}] started successfully and listening for tasks`);
        
        // Graceful shutdown handling
        process.on('SIGTERM', async () => {
            console.log(`📴 Worker [${workerId}] received SIGTERM, shutting down gracefully...`);
            await worker.close();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log(`📴 Worker [${workerId}] received SIGINT, shutting down gracefully...`);
            await worker.close();
            process.exit(0);
        });

    } catch (error) {
        console.error(`❌ Failed to start Execution Worker [${workerId}]:`, error);
        process.exit(1);
    }
}

startWorker();
