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
import { serverModuleStub, ServerModuleCallError } from '../../../src/modules/serverModuleStub'
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
        ok: true, status: 200, json: async () => payload,
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
            ok: false, status: 403, json: async () => ({ error: 'not entitled' }),
        })) as any
        const stub = serverModuleStub(manifest, { moduleApiUrl: '', fetchImpl })

        await expect(stub.solve({})).rejects.toThrow(ServerModuleCallError)
        await expect(stub.solve({})).rejects.toThrow(/example\.solve\(\): not entitled/)
    })

    it('survives a non-JSON error body', async () =>
    {
        const fetchImpl = vi.fn(async () => ({
            ok: false, status: 502, json: async () => { throw new Error('not json') },
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
