import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';

import type { RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';

import { Runner } from '@archiyou/core/src/runner/Runner';
import { isRunnerScriptExecutionRequest } from '@archiyou/core/src/runner/typeguards';
import { convertBinaryToBase64 } from '@archiyou/core/src/utils';

import { config } from '../config';
import type { QueueTaskData, QueueTaskResult, QueueDebugTask, RedisConfig } from './types';
import { isQueueDebugTask } from './types';
import { connectToRedis } from './utils';


//// MAIN CLASS ////

/** "glTF" as a little-endian uint32 — the first 4 bytes of every GLB. */
const GLB_MAGIC = 0x46546c67;
/** magic + version + total length. */
const GLB_HEADER_BYTES = 12;

/** Normalize whatever the runner handed back into bytes, or null if it is not
 *  binary at all. The health check runs the Runner directly, so this is raw output
 *  rather than the base64 wrapper the queue path produces — but accept both, so a
 *  change on that side turns into a clear failure rather than a silent 0-length. */
export function toBytes(output: unknown): Uint8Array | null
{
    if (output instanceof Uint8Array) return output;
    if (output instanceof ArrayBuffer) return new Uint8Array(output);
    if (typeof output === 'object' && output !== null && 'data' in output)
    {
        const wrapper = output as { encoding?: string; data: unknown };
        if (wrapper.encoding === 'base64' && typeof wrapper.data === 'string')
        {
            return Uint8Array.from(Buffer.from(wrapper.data, 'base64'));
        }
        return toBytes(wrapper.data);
    }
    return null;
}

/**
 * Is this output a loadable GLB? Checks the 12-byte container header — magic "glTF",
 * version 2, and a declared total length matching what we hold.
 *
 * Deliberately structural rather than a size threshold. The previous check was
 * `size < 5000` ("a box is around 8000 bytes"); the mesh kernel exports
 * box(10,10,10) in 2804 bytes, so it failed every time — and a failed health check
 * exits the process, so a worker with `restart: unless-stopped` restart-looped
 * forever without ever draining a job. A byte count silently goes stale whenever the
 * exporter changes; the container format does not.
 */
export interface GlbVerdict { ok: boolean; size: number; reason?: string }

export function validateGlb(output: unknown): GlbVerdict
{
    const bytes = toBytes(output);
    if (!bytes || bytes.length < GLB_HEADER_BYTES)
    {
        return { ok: false, size: bytes?.length ?? 0, reason: `GLB output is not readable bytes (${bytes?.length ?? 0})` };
    }

    const header = new DataView(bytes.buffer, bytes.byteOffset, GLB_HEADER_BYTES);
    const magic = header.getUint32(0, true);
    const version = header.getUint32(4, true);
    const declaredLength = header.getUint32(8, true);

    if (magic !== GLB_MAGIC)
    {
        return { ok: false, size: bytes.length, reason: `GLB output is not glTF (magic 0x${magic.toString(16)})` };
    }
    if (version !== 2)
    {
        return { ok: false, size: bytes.length, reason: `GLB declares version ${version}, expected 2` };
    }
    if (declaredLength !== bytes.length)
    {
        return { ok: false, size: bytes.length, reason: `GLB is truncated — header declares ${declaredLength} bytes, got ${bytes.length}` };
    }

    return { ok: true, size: bytes.length };
}

export class ExecutionWorker 
{
    //// SETTINGS ////
    private HEALTH_CHECK_INTERVAL = 60000; // in ms
    private HEALTH_CHECK_TIMEOUT = 5000; // in ms
    //// END SETTINGS ////

    private worker: Worker;
    private redis: Redis;
    private runner: Runner;

    private healthCheckInterval: NodeJS.Timeout | null = null;

    constructor(redisConfig?: RedisConfig) 
    {
        // Initialize Redis connection
        this.redis = new Redis({
            host: redisConfig?.host || 'localhost',
            port: redisConfig?.port || 6379,
            password: redisConfig?.password,
            maxRetriesPerRequest: null, // Disable automatic retries
            lazyConnect: true, // Don't connect immediately, we'll do it manually with error handling
        });
    }

    /** Initiate the worker by creating a script execution Runner and BullMQ Worker */
    async init(): Promise<this>
    {
        console.info(`ExecutionWorker::init(): Initializing Execution Worker...`);
        console.info(`ExecutionWorker::init(): Initialized Archiyou Execution Runner.`);

        // Test Redis connection before proceeding
        if(connectToRedis(this))
        {
            // Init worker execution runner
            this.runner = await new Runner().load(); 

            // Initialize BullMQ Worker
            this.worker = new Worker(
                'execution-queue',
                async (job: Job<QueueTaskData>) => 
                {
                    return this.processTask(job.data);
                },
                {
                    connection: this.redis,
                    concurrency: 1, // Process one job at a time per worker - more does not make sense for our heavy script execution tasks
                    stalledInterval: 30000, // Check for stalled jobs every 30 seconds
                    maxStalledCount: 1, // Max number of times a job can be stalled before failing
                }
            );
            this.listen();

            console.info(`ExecutionWorker::init(): Started BullMQ Worker and listening for job events...`);

            // Start health check loop
            this.startHealthCheckLoop();
        }

        return this;
    }


    /** Start monitoring the queue */
    public listen()
    {
        // Handle worker events

        this.worker.on('active', (job: Job) =>
        {
            console.log(`ExecutionWorker::on('active'): Picking up job "${job.id}": ${job?.data?.payload?.script?.name || 'DEBUG'}`);
        });

        this.worker.on('completed', (job: Job) => 
        {
            console.log(`ExecutionWorker::on('completed'): Job ${job.id} completed successfully in ${job.finishedOn - job.processedOn}ms`);
        });

        this.worker.on('failed', (job: Job | undefined, err: Error) => 
        {
            console.error(`ExecutionWorker::on('failed'): Job ${job?.id} failed:`, err.message);
        });

        console.info('ExecutionWorker::listen(): Connected and listening for job events...');
    }

    /**
     * Process the task (this is where you'd implement your actual logic)
     * @param QueueTaskData The task data to process
     * @returns The result of processing
     */
    private async processTask(QueueTaskData: QueueTaskData): Promise<QueueTaskResult> 
    {
        const startTime = Date.now();
        
        try 
        {
            const result = await this.executeTask(QueueTaskData);
            console.log(`ExecutionWorker::processTask(): Finished processing task "${QueueTaskData.id}" in ${Date.now() - startTime}ms`);
            return result;
        } 
        catch (error) 
        {
            const duration = Date.now() - startTime;
            console.error(`ExecutionWorker::processTask(): Task "${QueueTaskData.id}" failed after ${duration}ms:`, error);
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                result: null,
                duration: duration,
            };
        }
    }

    /**
     * Run a script with a wall-clock cap (SERVER_EXECUTION_TIMEOUT_MS).
     *
     * ⚠️  PARTIAL PROTECTION — read before relying on this. Script code runs on
     * this process's event loop, so the timer below can only fire while the
     * script is awaiting something. A tight synchronous loop (`while(true){}`)
     * starves the timer and this timeout will NOT trigger; the worker stays
     * wedged until the container is killed. Defence for that case is external:
     * BullMQ marks the job stalled when the lock can't be renewed, and the
     * compose service sets cpus/mem_limit/pids_limit with a restart policy.
     *
     * What this DOES stop: scripts that yield — long awaits, slow I/O, runaway
     * async recursion — which is the common accidental case.
     *
     * The real fix is to run scripts in a killable worker_thread or a per-job
     * container; until then /execute is restricted to trusted authors
     * (config.execution.allowedAuthors).
     */
    private async executeWithTimeout(request: RunnerScriptExecutionRequest)
    {
        const { timeoutMs } = config.execution;
        let timer: NodeJS.Timeout | undefined;
        // Node has no `location`, so a root-relative asset path in the script — the
        // default document titleblock logo is '/img/archiyou_logo_header.png' — has
        // nothing to resolve against and the image is silently dropped. Tell the run
        // where the app is served from. Stamped here rather than at the /execute route
        // so every server-side execution path gets it. A request that already carries
        // one keeps it.
        const runRequest: RunnerScriptExecutionRequest = {
            ...request,
            appBaseUrl: request.appBaseUrl ?? config.frontendUrl,
        };
        try
        {
            return await Promise.race([
                this.runner.execute(runRequest),
                new Promise<never>((_, reject) =>
                {
                    timer = setTimeout(
                        () => reject(new Error(`Script execution exceeded ${timeoutMs}ms`)),
                        timeoutMs,
                    );
                }),
            ]);
        }
        finally
        {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Execute the actual task logic
     */
    private async executeTask(QueueTaskData: QueueTaskData): Promise<QueueTaskResult>
    {
        const payload = QueueTaskData.payload as QueueDebugTask|RunnerScriptExecutionRequest;

        // Debug task
        if (isQueueDebugTask(payload))
        {
            const debugTask = payload as QueueDebugTask;
            console.log(`ExecutionWorker::executeTask(): Processing DEBUG task with message "${debugTask.message}" for ${debugTask.wait}ms`);
            await new Promise(resolve => setTimeout(resolve, debugTask.wait));
            return {
                success: true,
                result: QueueTaskData.payload, // TODO: change this to actual result
                duration: Date.now() - QueueTaskData.timestamp, // Calculate duration
            };
        }
        // Execution request
        else if(isRunnerScriptExecutionRequest(payload))
        {
            const executionRequest = payload as RunnerScriptExecutionRequest;
            const RunnerScriptExecutionResult = await this.executeWithTimeout(executionRequest);

            // We need to prepare the result for JSON serialization - all binary data is converted to base64 strings
            const RunnerScriptExecutionResultBase64 = convertBinaryToBase64(RunnerScriptExecutionResult);
            
            if (RunnerScriptExecutionResult.status === 'error')
            {
                return {
                    success: false,
                    request: executionRequest, // original request in response for debugging
                    // Take over error message from RunnerScriptExecutionResult
                    error: RunnerScriptExecutionResult.errors?.[0]?.message || 'Execution error', 
                    messages: RunnerScriptExecutionResult.messages || [],
                    result: null,
                    duration: Date.now() - QueueTaskData.timestamp, // Calculate duration
                };
            }
            else {
                return {
                    success: true,
                    request: executionRequest, // original request in response for debugging
                    // messages: [], // in result as requested in response.messages
                    result: RunnerScriptExecutionResultBase64 || null, // Return outputs or null if not available
                    duration: Date.now() - QueueTaskData.timestamp, // Calculate duration
                };
            }
                
        }
        // Unknown task type
        else {
            return {
                success: false,
                error: 'Unknown task type',
                result: null,
                duration: Date.now() - QueueTaskData.timestamp, // Calculate duration
            }
        }
      
    }

    /**
     * Clean up worker resources
     */
    public async close(): Promise<void> 
    {
        await this.worker?.close();
        this.redis?.disconnect(false); // just disconnect without waiting for reconnection
    }

    startHealthCheckLoop()
    {
        console.info(`ExecutionWorker::startHealthCheckLoop(): Starting health check loop (interval: ${this.HEALTH_CHECK_INTERVAL}ms, timeout: ${this.HEALTH_CHECK_TIMEOUT}ms)...`);
        this.healthCheckInterval = setInterval(
            async () => { await this.checkHealth(); },
            this.HEALTH_CHECK_INTERVAL);
    }
    
    /**
     * Health check that executes a test script and verifies GLB output.
     * If the check fails, the worker process exits with code 1.
     * @returns Promise<boolean> - true if health check passes
     */
    async checkHealth(): Promise<boolean>
    {
        console.info(`ExecutionWorker::checkHealth(): ✅ Running health check...`);
        
        try 
        {
            // Verify runner is initialized
            if (!this.runner) 
            {
                console.error(`ExecutionWorker::checkHealth(): Runner not initialized`);
                process.exit(1);
            }

            const startTime = Date.now();

            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Health check timed out after ${this.HEALTH_CHECK_TIMEOUT}ms`));
                }, this.HEALTH_CHECK_TIMEOUT);
            });

            // Execute a simple test script that creates a box with timeout
            const result = await Promise.race([
                this.runner.execute({
                    kernel: 'mesh',
                    script: {
                        code: `box(10, 10, 10);`,
                    },
                    params: {},
                    outputs: ['default/model/glb']
                }),
                timeoutPromise
            ]);

            const duration = Date.now() - startTime;

            // Check execution status
            if (result.status !== 'success') 
            {
                console.error(`ExecutionWorker::checkHealth(): Execution failed with status "${result.status}"`);
                if (result.errors?.length) 
                {
                    console.error(`ExecutionWorker::checkHealth(): Errors:`, result.errors);
                }
                process.exit(1);
            }

            // Check for outputs
            if (!result.outputs || result.outputs.length === 0) 
            {
                console.error(`ExecutionWorker::checkHealth(): No outputs returned`);
                process.exit(1);
            }

            // Find GLB output and verify it has content
            const glbOutput = result.outputs.find(o => o.path?.format === 'glb');
            
            if (!glbOutput) 
            {
                console.error(`ExecutionWorker::checkHealth(): No GLB output found in results`);
                process.exit(1);
            }

            if (!glbOutput.output) 
            {
                console.error(`ExecutionWorker::checkHealth(): GLB output is empty`);
                process.exit(1);
            }

            // Structural check on the GLB container, not a byte count — see validateGlb.
            const verdict = validateGlb(glbOutput.output);

            if (!verdict.ok)
            {
                console.error(`ExecutionWorker::checkHealth(): ${verdict.reason}`);
                process.exit(1);
            }

            const glbSize = verdict.size;

            console.info(`ExecutionWorker::checkHealth(): Health check passed in ${duration}ms (GLB: ${glbSize} bytes)`);

            return true;
        } 
        catch (error) 
        {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`ExecutionWorker::checkHealth(): Health check failed: ${errorMessage}`);
            process.exit(1);
        }
    }
}

