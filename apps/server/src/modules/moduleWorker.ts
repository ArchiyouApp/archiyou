/**
 * moduleWorker.ts — worker-thread entry that performs ONE server-module call.
 *
 * Spawned by ModuleWorkerPool with { entryPath, method, args }; posts back a
 * single reply and exits. It never reads config, the database, or process.env —
 * the pool starts it with an empty environment on purpose, so module code cannot
 * reach the JWT signing key or the mail credentials.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import type { AyServerModule } from '@archiyou/module-sdk';

interface WorkerInput {
  entryPath: string;
  method: string;
  args: unknown;
}

async function run(): Promise<void> {
  const { entryPath, method, args } = workerData as WorkerInput;

  const namespace = await import(pathToFileURL(entryPath).href);
  const mod = (namespace?.default ?? namespace) as AyServerModule;

  const methods = mod?.methods;
  if (!methods || typeof methods !== 'object') {
    throw Object.assign(new Error('module does not export a `methods` object'), { kind: 'failed' });
  }

  // Own-property check, so a request cannot reach `toString`, `constructor` or
  // anything else up the prototype chain by naming it as a method.
  if (!Object.prototype.hasOwnProperty.call(methods, method) || typeof methods[method] !== 'function') {
    throw Object.assign(new Error(`unknown method '${method}'`), { kind: 'unknown_method' });
  }

  const result = await methods[method](args);
  parentPort?.postMessage({ ok: true, result });
}

run().catch((err: any) => {
  parentPort?.postMessage({
    ok: false,
    error: err?.message ?? String(err),
    kind: err?.kind === 'unknown_method' ? 'unknown_method' : 'failed',
  });
});
