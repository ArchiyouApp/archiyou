import { describe, it, expect, vi, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * $component('@author/name[:version]'): the shared library, the same for own scripts as for
 * other authors'. ':dev' is the latest script version: the linked workspace copy for own
 * scripts, the dev copy for others'. $component() lists own (as :dev) first, then shared.
 *
 * fetch() is stubbed: these tests are about resolution and listing, not HTTP.
 */

function stubFetch(impl: (url: string) => { status?: number; body?: unknown })
{
    const spy = vi.fn(async (url: string) =>
    {
        const { status = 200, body = {} } = impl(url)
        return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
    })
    vi.stubGlobal('fetch', spy)
    return spy
}

afterEach(() => { vi.unstubAllGlobals() })

const request = (code: string) => ({
    kernel: 'mesh',
    script: { author: 'mark', name: 'house', code },
    componentLibraryUrl: '/api',
    authToken: 'token',
    outputs: ['default/model/internal'],
    messages: ['user'],
} as any)

const userMessages = (result: any) => (result.messages ?? []).map((m: any) => m.message).join('\n')

describe('Runner: $component("@author/name")', () =>
{
    it('resolves an own script to its latest shared version, not the workspace copy', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: { success: true, data: { name: 'wall', author: 'mark', version: '0.6', code: 'shared = box(10);' } } }))
        runner.linkComponentScripts([Script.fromData({ name: 'wall', author: 'mark', code: 'workspace = box(100);' })!])

        const { missing } = await runner._prefetchComponentScripts(request(`$component('@mark/wall').model();`))

        expect(missing).toEqual([])
        expect(fetchSpy.mock.calls.map(c => c[0])).toEqual(['/api/scripts/shared/mark/wall'])
        expect(runner.getComponentScriptFromCache('@mark/wall')!.code).toBe('shared = box(10);')
    })

    it('fetches a pinned shared version', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: { success: true, data: { name: 'wall', author: 'mark', version: '0.5', code: 'box(10);' } } }))

        const { missing } = await runner._prefetchComponentScripts(request(`$component('@mark/wall:0.5').model();`))

        expect(missing).toEqual([])
        expect(fetchSpy.mock.calls.map(c => c[0])).toEqual(['/api/scripts/shared/mark/wall:0.5'])
    })

    it(':dev resolves an own script to the linked workspace copy, without fetching', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ status: 404 }))
        runner.linkComponentScripts([Script.fromData({ name: 'wall', author: 'mark', code: 'workspace = box(100);' })!])

        const result = await runner.execute(request(`$component('@mark/wall:dev').model();`))

        expect(result.status).not.toBe('error')
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(runner.getComponentScriptFromCache('@mark/wall:dev')!.code).toBe('workspace = box(100);')
    })

    it('accepts a version on a workspace name: name:dev and ./name:version', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: { success: true, data: { name: 'wall', author: 'mark', version: '0.6', code: 'shared = box(10);' } } }))
        runner.linkComponentScripts([Script.fromData({ name: 'wall', author: 'mark', code: `$PARAMS.define('WIDTH', 'number', { default: 10 }); workspace = box($WIDTH);` })!])

        const result = await runner.execute(request(`WIDTH = 5; w = $component('wall:dev', { WIDTH: WIDTH }).info().model();`))
        expect(result.status).not.toBe('error')
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(runner.getComponentScriptFromCache('wall:dev')!.code).toContain('workspace = box')

        const { missing } = await runner._prefetchComponentScripts(request(`$component('./wall:0.6').model();`))
        expect(missing).toEqual([])
        expect(fetchSpy.mock.calls.map(c => c[0])).toEqual(['/api/scripts/shared/mark/wall:0.6'])
    })

    it('name:dev finds the workspace script when the workspace mixes authors and the script has none', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ status: 404 }))
        runner.linkComponentScripts([
            Script.fromData({ name: 'roof', author: 'mark', code: 'box(50);' })!,  // first authored script
            Script.fromData({ name: 'foundation', author: 'archiyou', code: 'box(100);' })!,
        ])

        const req = request(`f = $component('foundation:dev').model();`)
        delete req.script.author
        const result = await runner.execute(req)

        expect(result.status).not.toBe('error')
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it(':dev fetches another author\'s dev copy, falling back to their latest shared version', async () =>
    {
        const runner = await new Runner().load()
        let devReadable = true
        const fetchSpy = stubFetch((url) => url.endsWith(':dev')
            ? (devReadable ? { body: { success: true, data: { name: 'timberwall', author: 'archiyou', code: 'dev = box(1);' } } } : { status: 404 })
            : { body: { success: true, data: { name: 'timberwall', author: 'archiyou', version: '1.0', code: 'shared = box(1);' } } })

        await runner._prefetchComponentScripts(request(`$component('@archiyou/timberwall:dev').model();`))
        expect(fetchSpy.mock.calls.map(c => c[0])).toEqual(['/api/scripts/shared/archiyou/timberwall:dev'])
        expect(runner.getComponentScriptFromCache('@archiyou/timberwall:dev')!.code).toBe('dev = box(1);')

        // Dev copies are fetched again every run; without dev access the shared version is used
        devReadable = false
        await runner._prefetchComponentScripts(request(`$component('@archiyou/timberwall:dev').model();`))
        expect(runner.getComponentScriptFromCache('@archiyou/timberwall:dev')!.code).toBe('shared = box(1);')
    })

    it('fetches another author\'s component from their shared library, with the token', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: { success: true, data: { name: 'timberwall', author: 'archiyou', code: 'box(10);' } } }))

        const result = await runner.execute(request(`$component('@archiyou/timberwall').model();`))

        expect(result.status).not.toBe('error')
        expect(fetchSpy.mock.calls[0][0]).toBe('/api/scripts/shared/archiyou/timberwall')
        expect((fetchSpy.mock.calls[0] as any)[1]?.headers?.Authorization).toBe('Bearer token')
    })

    it('fetches @author/name when the running script has no author (new, unsynced script)', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: { success: true, data: { name: 'pubtest2', author: 'archiyou', code: 'box(10);' } } }))
        runner.linkComponentScripts([Script.fromData({ name: 'wall', code: 'box(100);' })!])

        const req = request(`$component('@archiyou/pubtest2').model();`)
        delete req.script.author
        const result = await runner.execute(req)

        expect(result.status).not.toBe('error')
        expect(fetchSpy.mock.calls.map(c => c[0])).toContain('/api/scripts/shared/archiyou/pubtest2')
    })

    it('fetches the own author\'s shared script when it is not in the workspace', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch((url) => url.includes('/shared/')
            ? { body: { success: true, data: { name: 'pubtest2', author: 'mark', code: 'box(10);' } } }
            : { status: 404 })

        const result = await runner.execute(request(`$component('@mark/pubtest2').model();`))

        expect(result.status).not.toBe('error')
        expect(fetchSpy.mock.calls.map(c => c[0])).toContain('/api/scripts/shared/mark/pubtest2')
    })

    it('lists own components first (latest version), then all shared ones', async () =>
    {
        const runner = await new Runner().load()
        stubFetch((url) => ({
            body: {
                success: true,
                data: url.endsWith('/with-me')
                    ? [{ author: 'bob', name: 'door' }]
                    : [{ author: 'archiyou', name: 'timberwall' }, { author: 'mark', name: 'wall' }],
            },
        }))
        runner.linkComponentScripts([
            Script.fromData({ name: 'wall', author: 'mark', code: 'box(100);' })!,
            Script.fromData({ name: 'roof', author: 'mark', code: 'box(50);' })!,
        ])

        const result = await runner.execute(request(`$component();`))

        expect(result.status).not.toBe('error')
        expect(runner.listComponentNames()).toEqual(['@mark/roof:dev', '@mark/wall:dev', '@archiyou/timberwall', '@bob/door', '@mark/wall'])
        const msg = userMessages(result)
        expect(msg.indexOf('your scripts')).toBeLessThan(msg.indexOf('shared ('))
    })
})
