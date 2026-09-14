/**
 * tests/unit/modules/stubs.test.ts
 *
 * The two stand-ins a script can end up holding: the "you don't have this"
 * placeholder, and the forwarding object for a server-side module.
 *
 * Both are Proxies that answer *any* property, which makes their behaviour on
 * the language's own well-known keys (`then` above all) load-bearing rather than
 * incidental — hence the tests below.
 */
import { describe, it, expect, vi } from 'vitest'

import { unavailableStub, ModuleUnavailableError } from '../../../src/modules/unavailableStub'
import { serverModuleStub, ServerModuleCallError, canCallSync } from '../../../src/modules/serverModuleStub'
import type { AyModuleManifest } from '@archiyou/module-sdk'

const manifest: AyModuleManifest = {
    id: 'example', global: 'example', name: 'Example',
    version: '1.0.0', engine: '^1.0.0', runtime: 'server',
}

describe('unavailableStub', () =>
{
    it('throws a named error naming the module and the reason', () =>
    {
        const stub = unavailableStub('example', 'example', 'not available on your account')

        expect(() => stub.solve()).toThrow(ModuleUnavailableError)
        expect(() => stub.anything).toThrow(/Module 'example': not available on your account/)
    })

    it('is not a thenable, so awaiting it neither hangs nor misreports', async () =>
    {
        const stub = unavailableStub('example', 'example', 'nope')

        // If `then` threw, the failure would surface at the await rather than at
        // the member access. If it returned a function, the runtime would CALL it
        // and the run would hang. Undefined is the only safe answer.
        expect(stub.then).toBeUndefined()
        await expect(Promise.resolve(stub)).resolves.toBe(stub)
    })

    it('stays printable so it cannot mask a real error', () =>
    {
        const stub = unavailableStub('example', 'example', 'nope')
        expect(String(stub)).toBe("[unavailable module 'example']")
        expect(() => JSON.stringify({ stub })).not.toThrow()
    })
})

describe('serverModuleStub', () =>
{
    const okFetch = (payload: any) => vi.fn(async () => ({
        ok: true, status: 200, text: async () => JSON.stringify(payload),
    })) as any

    it('posts method and args, and unwraps the result', async () =>
    {
        const fetchImpl = okFetch({ success: true, result: 7 })
        const stub = serverModuleStub(manifest, { moduleApiUrl: 'https://api.test', authToken: 't', fetchImpl })

        expect(await stub.solve({ n: 3 })).toBe(7)

        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.test/modules/example/call')
        expect(JSON.parse(init.body)).toEqual({ method: 'solve', args: { n: 3 } })
    })

    it('is not a thenable, so awaiting a call does not chain forever', async () =>
    {
        const fetchImpl = okFetch({ success: true, result: 1 })
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl })

        // This Proxy returns a function for any string key. Without the guard,
        // `await`-ing anything that resolved to the stub would find a `then`,
        // call it as a thenable, and issue an unbounded chain of requests.
        expect(stub.then).toBeUndefined()
        expect(stub.catch).toBeUndefined()

        // A real call still returns a genuine promise.
        expect(typeof stub.solve({}).then).toBe('function')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('reports the server explanation and status on refusal', async () =>
    {
        const fetchImpl = vi.fn(async () => ({
            ok: false, status: 403, text: async () => JSON.stringify({ error: 'not entitled' }),
        })) as any
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl })

        await expect(stub.solve({})).rejects.toThrow(ServerModuleCallError)
        await expect(stub.solve({})).rejects.toThrow(/example\.solve\(\): not entitled/)
    })

    it('survives a non-JSON error body', async () =>
    {
        const fetchImpl = vi.fn(async () => ({
            ok: false, status: 502, text: async () => 'not json',
        })) as any
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl })

        await expect(stub.solve({})).rejects.toThrow(/HTTP 502/)
    })

    it('reports a network failure distinctly from a rejection', async () =>
    {
        const fetchImpl = vi.fn(async () => { throw new Error('offline') }) as any
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl })

        await expect(stub.solve({})).rejects.toThrow(/could not reach the server \(offline\)/)
    })
})

describe('serverModuleStub — synchronous transport', () =>
{
    const okSync = (payload: any) => vi.fn(() => ({ status: 200, text: JSON.stringify(payload) })) as any

    it('returns the plain result when a blocking transport is available', () =>
    {
        const callSync = okSync({ success: true, result: 7 })
        const stub = serverModuleStub(manifest, { moduleApiUrl: 'https://api.test', authToken: 't', callSync })

        const out = stub.solve({ n: 3 })
        // No Promise: the whole point is that a script needs no `await`.
        expect(out).toBe(7)

        const [url, init] = callSync.mock.calls[0]
        expect(url).toBe('https://api.test/modules/example/call')
        expect(JSON.parse(init.body)).toEqual({ method: 'solve', args: { n: 3 } })
        expect(init.headers.Authorization).toBe('Bearer t')
        expect(init.timeoutMs).toBeGreaterThan(60_000)
    })

    it('still works for a script written with await', async () =>
    {
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', callSync: okSync({ success: true, result: 1 }) })
        // Awaiting a plain value is a no-op, so old scripts are unaffected.
        expect(await stub.solve({})).toBe(1)
        expect(stub.then).toBeUndefined()
    })

    it('reports the server explanation and status on refusal', () =>
    {
        const callSync = vi.fn(() => ({ status: 403, text: JSON.stringify({ error: 'not entitled' }) })) as any
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', callSync })

        expect(() => stub.solve({})).toThrow(ServerModuleCallError)
        try { stub.solve({}) } catch(e) { expect((e as ServerModuleCallError).status).toBe(403) }
        expect(() => stub.solve({})).toThrow(/example\.solve\(\): not entitled/)
    })

    it('survives a non-JSON error body', () =>
    {
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', callSync: () => ({ status: 502, text: '<html>bad gateway</html>' }) })
        expect(() => stub.solve({})).toThrow(/HTTP 502/)
    })

    it('reports a network failure distinctly from a rejection', () =>
    {
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', callSync: () => ({ status: 0, text: 'offline' }) })
        expect(() => stub.solve({})).toThrow(/could not reach the server \(offline\)/)
    })

    it('treats a body that says success:false as a failure', () =>
    {
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', callSync: okSync({ success: false, error: 'sheet not found' }) })
        expect(() => stub.solve({})).toThrow(/sheet not found/)
    })

    it('stays asynchronous outside a worker when no transport is injected', () =>
    {
        // vitest runs in Node: no XMLHttpRequest, no WorkerGlobalScope.
        expect(canCallSync({})).toBe(false)
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl: vi.fn(async () => ({
            ok: true, status: 200, text: async () => JSON.stringify({ success: true, result: 2 }),
        })) as any })
        expect(typeof stub.solve({}).then).toBe('function')
    })
})
