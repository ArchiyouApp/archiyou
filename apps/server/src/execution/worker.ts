#!/usr/bin/env node

/**
 * Standalone Execution Worker Entry Point
 * Starts an execution worker that connects to Redis and processes script execution tasks
 */

import { ExecutionWorker } from './ExecutionWorker.js';
import type { RedisConfig } from './types.js';

// Get Redis configuration from environment variables
const redisConfig: RedisConfig = {
    host: process.env.SERVER_REDIS_HOST || 'localhost',
    port: parseInt(process.env.SERVER_REDIS_PORT || '6379'),
    password: process.env.SERVER_REDIS_PASSWORD || undefined,
};

const workerId = process.env.WORKER_ID || 'worker-unknown';

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
