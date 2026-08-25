/**
 * TranslationQueue.ts — the background queue that translates published configurators.
 *
 * Worked IN THE API PROCESS, unlike the execution queue. That is deliberate and safe:
 * execution needs its own process because the Runner compiles and runs untrusted script
 * source with full Node capability, whereas translation is pure IO against an HTTP API.
 * Nothing here evaluates user input.
 *
 * BullMQ rather than a detached promise, because it brings four things this needs for
 * free: retries with backoff, survival across a restart, a concurrency cap, and job
 * dedupe — `jobId` is `{versionId}:{sourceHash}`, so republishing with unchanged copy
 * coalesces into a single job instead of paying twice.
 *
 * Redis being unavailable is an already-supported degraded mode for this server (see
 * plugin.ts). Here it simply means no translations, which is the same silent outcome as
 * every other failure path.
 */

import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

import { extractTranslatableStrings } from '@archiyou/core/src/i18n/extract';

import { config } from '../config';
import { scriptStore } from '../services/ScriptStore';
import { runTranslateJob, type TranslateJobData, type TranslateJobResult } from './translateJob';

const QUEUE_NAME = 'translation-queue';

/** Modest: this is background work competing with real requests in the same process. */
const CONCURRENCY = 2;
const ATTEMPTS = 3;
const BACKOFF_MS = 30_000;

/** Per-author budget guard, counted in Redis with a rolling hourly key. */
const RATE_WINDOW_SECONDS = 3600;

/** Cap on the Redis handshake, mirroring EXECUTION_INIT_TIMEOUT_MS in plugin.ts.
 *  ioredis retries a refused connection indefinitely by default, so without this an
 *  unreachable Redis would stall server boot rather than degrading. */
const INIT_TIMEOUT_MS = 5000;

export class TranslationQueue {
  private redis: Redis | null = null;
  private queue: Queue<TranslateJobData> | null = null;
  private worker: Worker<TranslateJobData, TranslateJobResult> | null = null;

  /** Wire up Redis + the worker. Never throws: a missing Redis disables the feature
   *  rather than blocking boot. */
  async init(): Promise<this> {
    try {
      this.redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      await Promise.race([
        this.redis.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`redis connect timed out after ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS),
        ),
      ]);

      this.queue = new Queue<TranslateJobData>(QUEUE_NAME, {
        connection: this.redis,
        defaultJobOptions: {
          attempts: ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_MS },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      });

      this.worker = new Worker<TranslateJobData, TranslateJobResult>(
        QUEUE_NAME,
        async (job: Job<TranslateJobData>) => runTranslateJob(job.data),
        { connection: this.redis.duplicate(), concurrency: CONCURRENCY },
      );

      // Log only — the author is never told, but an operator must be able to see it.
      this.worker.on('failed', (job, error) => {
        console.warn(`Translation job ${job?.id} failed: ${error?.message}`);
      });
      this.worker.on('completed', (job, result) => {
        if (result?.status === 'translated') {
          console.log(`🌍 Translated ${job.data.versionId} from ${result.sourceLocale} into ${result.locales} locales`);
        } else if (result?.status === 'reused') {
          console.log(`🌍 Reused existing translations for ${job.data.versionId} (no model calls)`);
        }
      });

      console.log('🌍 Translation queue ready.');
      return this;
    } catch (error) {
      console.warn('⚠️  Translation queue unavailable (is Redis running?):', (error as Error).message);
      console.warn('    Configurators will be served untranslated.');
      await this.close();
      return this;
    }
  }

  /**
   * Queue a translation for one just-published (or just-edited) version.
   *
   * Call sites MUST NOT await this in a way that can affect their response — a publish
   * has already committed by the time this runs and must never fail because of it.
   */
  async enqueue(data: TranslateJobData): Promise<void> {
    if (!this.queue) return;

    try {
      const script = scriptStore.findVersionById(data.author, data.versionId);
      if (!script?.published) return;

      const { strings, sourceHash } = extractTranslatableStrings(script);
      if (Object.keys(strings).length === 0) return;

      if (!(await this.withinRateLimit(data.author))) {
        console.warn(`Translation rate limit reached for author ${data.author}; skipping ${data.versionId}`);
        return;
      }

      // Dedupe: same version + same copy ⇒ the same job, queued once.
      await this.queue.add('translate', data, { jobId: `${data.versionId}:${sourceHash}` });
    } catch (error) {
      console.warn('Translation enqueue failed:', (error as Error).message);
    }
  }

  /** Rolling per-hour counter, keyed on the ACCOUNT rather than the IP — this costs
   *  money per author, and IP buckets would be both too coarse and too easy to spread. */
  private async withinRateLimit(author: string): Promise<boolean> {
    if (!this.redis) return false;
    const hour = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
    const key = `translation:rate:${author}:${hour}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, RATE_WINDOW_SECONDS);
    return count <= config.gemini.maxJobsPerHour;
  }

  async close(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.redis?.disconnect();
    this.worker = null;
    this.queue = null;
    this.redis = null;
  }
}

export const translationQueue = new TranslationQueue();
