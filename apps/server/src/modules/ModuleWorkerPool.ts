/**
 * ModuleWorkerPool — runs server-runtime module calls off the API event loop.
 *
 * WHY THREADS: a server module exists precisely because its work is heavy (a FEM
 * solve, a large optimisation). Running that in the Fastify process would block
 * every other request for its duration, and native/WASM code cannot be preempted
 * by an await.
 *
 * A worker thread also makes the timeout real. The script-execution path
 * documents its own timeout as only partial, because a synchronous `while(true)`
 * starves the timer that is supposed to fire (see execution/ExecutionWorker.ts).
 * Here the timeout lives on the *parent* thread and enforces itself with
 * terminate(), which stops a spinning thread dead.
 *
 * One thread per call, capped by config.modules.poolSize. Threads are not reused:
 * module code is trusted but arbitrary, and a fresh thread means one call cannot
 * leave state behind for the next.
 *
 * WARM WORKERS (manifest `keepAlive: true`): such a module pays a start-up cost
 * per thread — a WASM engine, a parsed workbook — that dwarfs the call itself.
 * Its calls go to a thread kept per (module, user): state is reused only by the
 * user who created it, never across users. The thread is retired when it idles
 * for config.modules.warmIdleMs, when its call times out (terminate() still
 * makes the timeout real), when it crashes, when the module's server.js changes
 * on disk, or when config.modules.warmMax warm threads exist and it is the least
 * recently used. Calls on one warm thread run one after another.
 */

import { Worker } from 'node:worker_threads';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { config } from '../config';

export class ModuleCallError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'unknown_method' | 'failed' | 'busy',
    message: string,
  ) {
    super(message);
    this.name = 'ModuleCallError';
  }
}

/** Result envelope sent back by the worker entry (moduleWorker.ts). */
interface WorkerReply {
  /** Warm workers only: the call this answers. */
  id?: number;
  ok: boolean;
  result?: unknown;
  error?: string;
  kind?: 'unknown_method' | 'failed';
}

/** How a module's calls should be run. */
export interface CallOptions {
  /** Keep the thread for the next call of the same owner (manifest `keepAlive`). */
  keepAlive?: boolean;
  /** Whose thread it is: warm state is never shared between owners. */
  owner?: string;
}

/** A thread kept between calls of one (module, owner). */
interface WarmWorker {
  key: string;
  worker: Worker;
  /** server.js mtime when spawned — a rebuild retires the thread. */
  mtimeMs: number;
  /** Tail of this thread's call chain; calls run one after another. */
  queue: Promise<unknown>;
  pending: number;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
  nextId: number;
  /** The call in flight, if any. */
  current: { id: number; resolve: (v: unknown) => void; reject: (e: unknown) => void } | null;
}

function entryMtime(entryPath: string): number {
  try {
    return statSync(entryPath).mtimeMs;
  } catch {
    return 0;
  }
}

export class ModuleWorkerPool {
  private _running = 0;

  /** How many calls are in flight. Exposed for tests and health output. */
  get running(): number {
    return this._running;
  }

  /**
   * The environment a module worker is allowed to see.
   *
   * NOT the API's environment: that holds the JWT signing key, the mail
   * credentials and the S3 keys, and module code has no business reading them.
   * But a module does need its own configuration — cloudcalc needs the sheets it
   * may open, and its Google service-account key.
   *
   * So the rule is a namespace: a module with id `cloudcalc` sees `CLOUDCALC_*`,
   * and every module sees `MODULE_*` for anything shared. An operator can grant
   * config by naming the variable, and cannot leak a secret by accident.
   */
  private _envFor(moduleId: string): Record<string, string> {
    const prefix = `${moduleId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_`;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (key.startsWith(prefix) || key.startsWith('MODULE_')) env[key] = value;
    }
    return env;
  }

  private _warm = new Map<string, WarmWorker>();

  /** How many warm threads are alive. Exposed for tests and health output. */
  get warmCount(): number {
    return this._warm.size;
  }

  /**
   * Run `method(args)` inside `entryPath`'s module: in a fresh worker thread,
   * or — with `keepAlive` and an `owner` — in that owner's warm thread.
   *
   * Rejects with ModuleCallError('timeout') and kills the thread if the call
   * outlives config.modules.callTimeoutMs.
   */
  async call(
    entryPath: string,
    method: string,
    args: unknown,
    moduleId = '',
    opts: CallOptions = {},
  ): Promise<unknown> {
    if (this._running >= config.modules.poolSize) {
      throw new ModuleCallError('busy', 'Too many module calls in progress; try again shortly');
    }
    this._running++;
    try {
      const warm = opts.keepAlive && opts.owner ? this._warmWorker(entryPath, moduleId, opts.owner) : null;
      return await (warm ? this._enqueue(warm, method, args) : this._callOnce(entryPath, method, args, moduleId));
    } finally {
      this._running--;
    }
  }

  /** Terminate every warm thread (of one entry, or all). */
  retire(entryPath?: string): void {
    for (const w of [...this._warm.values()]) {
      if (!entryPath || w.key.startsWith(`${entryPath}\0`)) this._retire(w);
    }
  }

  //// ONE-SHOT ////

  private _callOnce(entryPath: string, method: string, args: unknown, moduleId: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(fileURLToPath(WORKER_URL), {
        workerData: { entryPath, method, args },
        // Only the module's own namespaced configuration — never the API's
        // environment, which holds the JWT signing key and mail credentials.
        env: this._envFor(moduleId),
      });

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new ModuleCallError(
              'timeout',
              `module call timed out after ${config.modules.callTimeoutMs} ms`,
            ),
          ),
        );
      }, config.modules.callTimeoutMs);

      worker.on('message', (reply: WorkerReply) => {
        finish(() => {
          if (reply?.ok) resolve(reply.result);
          else reject(new ModuleCallError(reply?.kind ?? 'failed', reply?.error ?? 'module call failed'));
        });
      });

      worker.on('error', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err ?? '');
        finish(() => reject(new ModuleCallError('failed', message || 'module worker crashed')));
      });

      worker.on('exit', (code) => {
        // Only meaningful if we have not already settled: a normal call
        // terminates the thread itself once the message is in.
        finish(() =>
          reject(new ModuleCallError('failed', `module worker exited unexpectedly (code ${code})`)),
        );
      });
    });
  }

  //// WARM ////

  /** The owner's warm thread for this module: reused, or spawned. Null when
   *  the warm cap is reached and nothing idle can be evicted — the call then
   *  runs one-shot rather than waiting. */
  private _warmWorker(entryPath: string, moduleId: string, owner: string): WarmWorker | null {
    const key = `${entryPath}\0${owner}`;
    const mtimeMs = entryMtime(entryPath);
    const existing = this._warm.get(key);
    if (existing && existing.mtimeMs === mtimeMs) return existing;
    if (existing) this._retire(existing);

    if (this._warm.size >= config.modules.warmMax) {
      const idle = [...this._warm.values()]
        .filter((w) => w.pending === 0)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!idle) return null;
      this._retire(idle);
    }

    const worker = new Worker(fileURLToPath(WORKER_URL), {
      workerData: { entryPath, warm: true },
      env: this._envFor(moduleId),
    });
    // An idle warm thread must not keep the process alive on shutdown.
    worker.unref();

    const w: WarmWorker = {
      key, worker, mtimeMs,
      queue: Promise.resolve(),
      pending: 0,
      lastUsed: Date.now(),
      idleTimer: null,
      nextId: 1,
      current: null,
    };

    worker.on('message', (reply: WorkerReply) => {
      const cur = w.current;
      if (!cur || reply?.id !== cur.id) return;
      w.current = null;
      if (reply.ok) cur.resolve(reply.result);
      else cur.reject(new ModuleCallError(reply.kind ?? 'failed', reply.error ?? 'module call failed'));
    });
    worker.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err ?? '');
      this._retire(w, new ModuleCallError('failed', message || 'module worker crashed'));
    });
    worker.on('exit', (code) => {
      this._retire(w, new ModuleCallError('failed', `module worker exited unexpectedly (code ${code})`));
    });

    this._warm.set(key, w);
    return w;
  }

  /** Run one call on a warm thread, after the calls already queued on it. */
  private _enqueue(w: WarmWorker, method: string, args: unknown): Promise<unknown> {
    w.pending++;
    if (w.idleTimer) {
      clearTimeout(w.idleTimer);
      w.idleTimer = null;
    }

    const run = () => this._send(w, method, args);
    const result = w.queue.then(run, run);
    w.queue = result.catch(() => undefined);

    return result.finally(() => {
      w.pending--;
      w.lastUsed = Date.now();
      if (w.pending === 0 && this._warm.get(w.key) === w) {
        w.idleTimer = setTimeout(() => this._retire(w), config.modules.warmIdleMs);
        w.idleTimer.unref();
      }
    });
  }

  private _send(w: WarmWorker, method: string, args: unknown): Promise<unknown> {
    if (this._warm.get(w.key) !== w) {
      return Promise.reject(new ModuleCallError('failed', 'module worker was retired'));
    }
    return new Promise<unknown>((resolve, reject) => {
      const id = w.nextId++;
      const timer = setTimeout(() => {
        this._retire(w, new ModuleCallError(
          'timeout',
          `module call timed out after ${config.modules.callTimeoutMs} ms`,
        ));
      }, config.modules.callTimeoutMs);
      w.current = {
        id,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      w.worker.postMessage({ id, method, args });
    });
  }

  /** Forget and terminate a warm thread, failing its call in flight with `reason`. */
  private _retire(w: WarmWorker, reason?: ModuleCallError): void {
    if (this._warm.get(w.key) === w) this._warm.delete(w.key);
    if (w.idleTimer) clearTimeout(w.idleTimer);
    w.idleTimer = null;
    const cur = w.current;
    w.current = null;
    cur?.reject(reason ?? new ModuleCallError('failed', 'module worker was retired'));
    void w.worker.terminate();
  }
}

// A .ts entry works because the whole server runs under tsx (`pnpm start` /
// the Dockerfile CMD), and tsx's loader hooks DO propagate into worker
// threads — verified against tsx 4.22.3, including with the empty env below.
// Deliberately no execArgv override: forcing `--import tsx` here would break
// any future pre-compiled deployment, whereas propagation just works in both.
const WORKER_URL = new URL('./moduleWorker.ts', import.meta.url);

export const moduleWorkerPool = new ModuleWorkerPool();
