import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

import type { RedisConfig, QueueTaskData, QueueDebugTask, QueueTaskResult } from './types';
import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { connectToRedis } from './utils';


//// MAIN CLASS ////

export class ExecutionBroker 
{
    //// SETTINGS ////
    private readonly TIMEOUT_MS = 60000; // 60 seconds
    
    //// END SETTINGS ////

    private queue: Queue;
    private queueEvents: QueueEvents;
    private redis: Redis;

    constructor(redisConfig?: RedisConfig) 
    {
        // NOTE: any environment variables should be loaded before this point

        // Initialize Redis connection
        this.redis = new Redis(
        {
            host: redisConfig?.host || process.env.SERVER_REDIS_HOST || 'localhost',
            // Was hardcoded to 6379, silently ignoring SERVER_REDIS_PORT — so a
            // non-default Redis port worked for the worker but not the broker.
            port: redisConfig?.port || Number(process.env.SERVER_REDIS_PORT) || 6379,
            password: redisConfig?.password || process.env.SERVER_REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null, // Disable automatic retries
            lazyConnect: true, // Don't connect immediately, we'll do it manually with error handling
        });
      
    }

    public async init():Promise<this>
    {
        // Test Redis connection before proceeding
        if(await connectToRedis(this))
        {
            // Initialize BullMQ Queue
            this.queue = new Queue('execution-queue', 
            {
                connection: this.redis,
                defaultJobOptions: {
                    removeOnComplete: { age: 1000 * 60 * 60 * 24 }, // Keep completed jobs for 24 hours
                    removeOnFail:  { age: 1000 * 60 * 60 * 24 }, // Keep failed jobs for 24 hours
                    attempts: 1,
                },
            });

            // Initialize QueueEvents for listening to job events
            this.queueEvents = new QueueEvents('execution-queue', {
                connection: this.redis,
            });
        }
        else {
            throw new Error(`Failed to connect to Redis at ${this.redis.options.host}:${this.redis.options.port}. Cannot initialize ExecutionBroker.`);
        }

        return this;
    }

    /**
     * Add a task to the queue and wait for completion
     * @param taskData The data to process
     * @returns Promise that resolves with the result or null after timeout
     * 
     * Structure of models of queue:
     *  QueueTaskData
     *       ↳ payload => RunnerScriptExecutionRequest or QueueDebugTask
     *        ...
     *  ==> result:
     *   QueueTaskResult
     *       ↳ result => RunnerScriptExecutionResult or data (for debug)
     *        ...
     *
     * NOTE: On timeouts the task will be marked as completed, but result is null
     */
    async submitTask(taskData: any|RunnerScriptExecutionRequest|QueueDebugTask, timeout:number = this.TIMEOUT_MS): Promise<QueueTaskResult> 
    {
        let job;
        try {
            // Job is a running task in the queue
            job = await this.queue.add('task', 
                {
                    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    payload: taskData,
                    timestamp: Date.now(),
                    timeout: timeout, // Optional timeout in milliseconds
                } as QueueTaskData
            );
            
            // Wait for job completion with timeout
            const result = await job.waitUntilFinished(this.queueEvents, this.TIMEOUT_MS) as QueueTaskResult;
            return result;
        } 
        catch (error) 
        {
            console.error('ExecutionBroker::submitTask(): Job failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                result: null,
                duration: Date.now() - job.timestamp, // Duration is 0 if job failed
            } as QueueTaskResult;
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() 
    {
        const waiting = await this.queue.getWaiting();
        const active = await this.queue.getActive();
        const completed = await this.queue.getCompleted();
        const failed = await this.queue.getFailed();

        return {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
        };
    }

    /**
     * Clean up resources
     */
    async close(): Promise<void> 
    {
        await this.queue.close();
        await this.queueEvents.close();
        await this.redis.quit();
    }
}


