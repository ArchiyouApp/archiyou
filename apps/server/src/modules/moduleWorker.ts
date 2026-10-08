/**
 * moduleWorker.ts — worker-thread entry that performs server-module calls.
 *
 * Two modes, chosen by ModuleWorkerPool:
 *  - one-shot (the default): spawned with { entryPath, method, args }, posts back
 *    a single reply and is terminated.
 *  - warm (`keepAlive` modules): spawned with { entryPath, warm: true }, imports
 *    the module once and then answers `{ id, method, args }` messages with
 *    `{ id, ok, ... }` replies until the pool terminates it. Whatever the module
 *    keeps in module scope (a loaded WASM engine, an opened workbook) survives
 *    from one call to the next — that is the point.
 *
 * It never reads config, the database, or process.env — the pool starts it with
 * only the module's namespaced environment, so module code cannot reach the JWT
 * signing key or the mail credentials.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import type { AyServerModule } from '@archiyou/module-sdk';

interface WorkerInput {
  entryPath: string;
  warm?: boolean;
  method?: string;
  args?: unknown;
}

interface CallMessage {
  id: number;
  method: string;
  args: unknown;
}

const input = workerData as WorkerInput;

let loaded: Promise<Record<string, unknown>> | null = null;

/** The module's method map, imported once per thread. */
function methodsOf(entryPath: string): Promise<Record<string, unknown>> {
  return (loaded ??= import(pathToFileURL(entryPath).href).then((namespace) => {
    const mod = (namespace?.default ?? namespace) as AyServerModule;
    const methods = mod?.methods;
    if (!methods || typeof methods !== 'object') {
      throw Object.assign(new Error('module does not export a `methods` object'), { kind: 'failed' });
    }
    return methods as Record<string, unknown>;
  }));
}

async function invoke(method: string, args: unknown): Promise<unknown> {
  const methods = await methodsOf(input.entryPath);

  // Own-property check, so a request cannot reach `toString`, `constructor` or
  // anything else up the prototype chain by naming it as a method.
  if (!Object.prototype.hasOwnProperty.call(methods, method) || typeof methods[method] !== 'function') {
    throw Object.assign(new Error(`unknown method '${method}'`), { kind: 'unknown_method' });
  }
  return (methods[method] as (a: unknown) => unknown)(args);
}

function failure(err: any) {
  return {
    ok: false,
    error: err?.message ?? String(err),
    kind: err?.kind === 'unknown_method' ? 'unknown_method' : 'failed',
  };
}

if (input.warm) {
  parentPort?.on('message', (msg: CallMessage) => {
    invoke(msg.method, msg.args).then(
      (result) => parentPort?.postMessage({ id: msg.id, ok: true, result }),
      (err) => parentPort?.postMessage({ id: msg.id, ...failure(err) }),
    );
  });
} else {
  invoke(input.method ?? '', input.args).then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    (err) => parentPort?.postMessage(failure(err)),
  );
}
