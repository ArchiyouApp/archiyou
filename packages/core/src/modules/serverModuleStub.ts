/**
 * serverModuleStub.ts — the script-facing object for a `runtime: 'server'` module.
 *
 * The module's code never reaches the client. What the script gets instead is a
 * Proxy that turns every member access into an HTTP call:
 *
 *     result = await example.solve({ ... })
 *       →  POST {moduleApiUrl}/modules/example/call  { method: 'solve', args: {...} }
 *
 * Note the `await`: unlike $import(), a server module cannot be pre-fetched,
 * because the arguments only exist once the script is running. Server modules are
 * therefore async by nature, which is fine — user code is compiled with
 * AsyncFunction (see Runner._executeLocal), so `await` works at the top level.
 *
 * There is deliberately no client-side list of legal method names. The server
 * owns the module's `methods` allowlist and rejects anything else; duplicating
 * that here would just be a second copy to drift.
 */

import type { AyModuleManifest } from './sdkTypes';

export interface ServerModuleStubOptions
{
    /** Base URL of the Archiyou backend. '' means root-relative. */
    moduleApiUrl: string;
    /** Bearer token for the signed-in user. Server modules are gated, so calls
     *  without one are rejected. */
    authToken?: string;
    /** Injectable for tests. */
    fetchImpl?: typeof fetch;
}

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

export function serverModuleStub(manifest: AyModuleManifest, opts: ServerModuleStubOptions): any
{
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    const base = (opts.moduleApiUrl ?? '').replace(/\/+$/, '');
    const url = `${base}/modules/${encodeURIComponent(manifest.id)}/call`;

    const call = async (method: string, args: any): Promise<any> =>
    {
        let res: Response;
        try
        {
            res = await doFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
                },
                body: JSON.stringify({ method, args }),
            });
        }
        catch(e)
        {
            // Network-level failure: no response at all.
            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): could not reach the server (${(e as Error)?.message})`);
        }

        if(!res.ok)
        {
            // Prefer the server's own explanation; fall back to the status.
            let detail = `HTTP ${res.status}`;
            try
            {
                const body = await res.json() as { error?: string };
                if(body?.error) detail = body.error;
            }
            catch { /* non-JSON error body — keep the status */ }

            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): ${detail}`, res.status);
        }

        const body = await res.json() as { success?: boolean, result?: any, error?: string };
        if(body?.success === false)
        {
            throw new ServerModuleCallError(manifest.id, method,
                `${manifest.global}.${method}(): ${body.error ?? 'failed'}`, res.status);
        }
        return body?.result;
    };

    return new Proxy({}, {
        get: (_target, key) =>
        {
            if(NON_METHOD_KEYS.has(key)) return undefined;
            if(key === 'toString') return () => `[server module '${manifest.global}']`;
            if(typeof key !== 'string') return undefined;
            return (args: any) => call(key, args);
        },
        has: () => true,
    });
}
