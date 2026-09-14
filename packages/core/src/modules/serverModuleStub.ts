/**
 * serverModuleStub.ts — the script-facing object for a `runtime: 'server'` module.
 *
 * The module's code never reaches the client. What the script gets instead is a
 * Proxy that turns every member access into an HTTP call:
 *
 *     result = example.solve({ ... })
 *       →  POST {moduleApiUrl}/modules/example/call  { method: 'solve', args: {...} }
 *
 * SYNCHRONOUS WHERE IT CAN BE. User scripts run inside a dedicated Web Worker,
 * and a worker — unlike a window — may issue a *synchronous* XMLHttpRequest. So
 * inside the script worker a call blocks until the server answers and returns
 * the plain result: no `await`, no Promise in the scope panel. Wall-clock cost is
 * identical to awaiting; only the ergonomics change.
 *
 * Anywhere else (Node, tests, a main-thread embedding) the same stub returns a
 * Promise, exactly as before. A script written with `await example.solve()`
 * keeps working in both modes, because awaiting a plain value is a no-op.
 *
 * There is deliberately no client-side list of legal method names. The server
 * owns the module's `methods` allowlist and rejects anything else; duplicating
 * that here would just be a second copy to drift.
 */

import type { AyModuleManifest } from './sdkTypes';

declare var WorkerGlobalScope: any; // only defined inside a Web Worker

/** A blocking POST. `status` 0 means the request never got a response. Injectable
 *  for tests (and, later, for a Node bridge built on Atomics.wait). */
export type SyncTransport = (
    url: string,
    init: { headers: Record<string, string>; body: string; timeoutMs: number },
) => { status: number; text: string };

export interface ServerModuleStubOptions
{
    /** Base URL of the Archiyou backend. '' means root-relative. */
    moduleApiUrl: string;
    /** Bearer token for the signed-in user. Server modules are gated, so calls
     *  without one are rejected. */
    authToken?: string;
    /** Injectable for tests — the asynchronous path. */
    fetchImpl?: typeof fetch;
    /** Injectable synchronous transport. Supplying one forces the sync path,
     *  which is how tests (and non-browser hosts) opt in. */
    callSync?: SyncTransport;
    /** How long a blocking call may take. Defaults to a little over the server's
     *  own per-call timeout (60 s), so the server's explanation wins over ours. */
    syncTimeoutMs?: number;
}

const DEFAULT_SYNC_TIMEOUT_MS = 65_000;

/** Error raised when a server-module call fails. Carries the HTTP status so
 *  callers can tell "you may not do this" from "the solver blew up". */
export class ServerModuleCallError extends Error
{
    readonly moduleId: string;
    readonly method: string;
    readonly status?: number;

    constructor(moduleId: string, method: string, message: string, status?: number)
    {
        super(message);
        this.name = 'ServerModuleCallError';
        this.moduleId = moduleId;
        this.method = method;
        this.status = status;
    }
}

/** Keys that must resolve to `undefined` rather than to a forwarding function.
 *
 *  `then` matters most: this Proxy returns a function for *any* key, so without
 *  this guard `await example.solve(...)` would see a `then` on the resolved value,
 *  treat it as a thenable, and call it — turning one network call into an
 *  unbounded chain. The others keep logging and serialization from firing
 *  spurious requests. */
const NON_METHOD_KEYS: Set<PropertyKey> = new Set<PropertyKey>([
    'then', 'catch', 'finally',
    'toJSON', 'constructor', 'prototype',
    Symbol.toPrimitive,
    Symbol.toStringTag,
    Symbol.iterator,
    Symbol.asyncIterator,
    Symbol.for('nodejs.util.inspect.custom'),
]);

/** Can this environment block on a request? True inside a Web Worker (where sync
 *  XHR is allowed) or when a transport was injected. Never on a window: the
 *  browser forbids sync XHR there, and blocking the UI would be wrong anyway. */
export function canCallSync(opts: Pick<ServerModuleStubOptions, 'callSync'>): boolean
{
    if(opts.callSync) return true;
    if(typeof XMLHttpRequest !== 'function') return false;
    if(typeof WorkerGlobalScope === 'undefined') return false;
    try { return (globalThis as any).self instanceof WorkerGlobalScope; }
    catch { return false; }
}

/** The response body as text. Prefers `text()`; a Response-like object that
 *  only offers `json()` (test doubles, older fetch shims) is read through that
 *  instead. An unreadable body is reported through the status alone. */
async function readBody(res: Response): Promise<string>
{
    try
    {
        if(typeof res.text === 'function') return await res.text();
        if(typeof (res as any).json === 'function') return JSON.stringify(await (res as any).json());
    }
    catch { /* fall through */ }
    return '';
}

/** The default synchronous transport: a blocking XHR, legal in workers. */
const xhrSync: SyncTransport = (url, init) =>
{
    const xhr = new XMLHttpRequest();
    try
    {
        xhr.open('POST', url, false);
        // A timeout on a sync request is permitted in workers (it is a window-only
        // restriction), and it is what keeps a dead server from hanging the run.
        xhr.timeout = init.timeoutMs;
        Object.entries(init.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.send(init.body);
    }
    catch(e)
    {
        return { status: 0, text: (e as Error)?.message ?? String(e) };
    }
    return { status: xhr.status, text: xhr.responseText ?? '' };
};

export function serverModuleStub(manifest: AyModuleManifest, opts: ServerModuleStubOptions): any
{
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    const base = (opts.moduleApiUrl ?? '').replace(/\/+$/, '');
    const url = `${base}/modules/${encodeURIComponent(manifest.id)}/call`;
    const headers = (): Record<string, string> => ({
        'Content-Type': 'application/json',
        ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
    });

    /** One reading of a response for both transports, so the two paths cannot
     *  drift in what they tell the user. `status` 0 is "no response at all". */
    const interpret = (method: string, status: number, text: string): any =>
    {
        if(status === 0)
        {
            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): could not reach the server (${text || 'no response'})`);
        }

        let body: { success?: boolean, result?: any, error?: string } | null = null;
        try { body = text ? JSON.parse(text) : null; }
        catch { body = null; }

        if(status >= 400)
        {
            // Prefer the server's own explanation; fall back to the status.
            const detail = body?.error ?? `HTTP ${status}`;
            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): ${detail}`, status);
        }
        if(body?.success === false)
        {
            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): ${body.error ?? 'failed'}`, status);
        }
        return body?.result;
    };

    const callAsync = async (method: string, args: any): Promise<any> =>
    {
        let res: Response;
        try
        {
            res = await doFetch(url, { method: 'POST', headers: headers(), body: JSON.stringify({ method, args }) });
        }
        catch(e)
        {
            return interpret(method, 0, (e as Error)?.message);
        }
        return interpret(method, res.status, await readBody(res));
    };

    const callSync = (method: string, args: any): any =>
    {
        const transport = opts.callSync ?? xhrSync;
        const { status, text } = transport(url, {
            headers: headers(),
            body: JSON.stringify({ method, args }),
            timeoutMs: opts.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
        });
        return interpret(method, status, text);
    };

    // Decided once per stub, not per call: the environment does not change
    // between calls, and a script must see one consistent mode.
    const sync = canCallSync(opts);

    return new Proxy({}, {
        get: (_target, key) =>
        {
            if(NON_METHOD_KEYS.has(key)) return undefined;
            if(key === 'toString') return () => `[server module '${manifest.global}']`;
            if(typeof key !== 'string') return undefined;
            return (args: any) => (sync ? callSync(key, args) : callAsync(key, args));
        },
        has: () => true,
    });
}
