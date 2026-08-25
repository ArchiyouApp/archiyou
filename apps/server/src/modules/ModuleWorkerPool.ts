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
 */

import { Worker } from 'node:worker_threads';
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
  ok: boolean;
  result?: unknown;
  error?: string;
  kind?: 'unknown_method' | 'failed';
}

export class ModuleWorkerPool {
  private _running = 0;

  /** How many calls are in flight. Exposed for tests and health output. */
  get running(): number {
    return this._running;
  }

  /**
   * Run `method(args)` inside `entryPath`'s module, in a fresh worker thread.
   *
   * Rejects with ModuleCallError('timeout') and kills the thread if the call
   * outlives config.modules.callTimeoutMs.
   */
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

  async call(entryPath: string, method: string, args: unknown, moduleId = ''): Promise<unknown> {
    if (this._running >= config.modules.poolSize) {
      throw new ModuleCallError('busy', 'Too many module calls in progress; try again shortly');
    }
    this._running++;

    // A .ts entry works because the whole server runs under tsx (`pnpm start` /
    // the Dockerfile CMD), and tsx's loader hooks DO propagate into worker
    // threads — verified against tsx 4.22.3, including with the empty env below.
    // Deliberately no execArgv override: forcing `--import tsx` here would break
    // any future pre-compiled deployment, whereas propagation just works in both.
    const workerUrl = new URL('./moduleWorker.ts', import.meta.url);

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const worker = new Worker(fileURLToPath(workerUrl), {
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
    } finally {
      this._running--;
    }
  }
}

export const moduleWorkerPool = new ModuleWorkerPool();
