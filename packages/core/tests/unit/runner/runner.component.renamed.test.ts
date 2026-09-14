import { describe, it, expect, vi, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * Rename fallback for $component('./name').
 *
 * Components are referenced by name, so renaming one used to break every script still
 * using the old name. In the editor the Runner now asks the author's own store which
 * file carried that name (GET /scripts/{author}/by-name/{name}) and uses the linked
 * workspace script with the same fileId — its latest working copy.
 *
 * fetch() is stubbed: these tests are about the resolution decisions, not HTTP.
 */

function stubFetch(impl: (url: string) => { status?: number; body?: unknown })
{
    const spy = vi.fn(async (url: string, _init?: RequestInit) =>
    {
        const { status = 200, body = {} } = impl(url)
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        } as unknown as Response
    })
    vi.stubGlobal('fetch', spy)
    return spy
}

afterEach(() => { vi.unstubAllGlobals() })

const STORED = { fileId: 'file-wall', name: 'newwall', author: 'archiyou', code: `stored = box(5);` }

function request(code: string, extra: Record<string, unknown> = {})
{
    return {
        kernel: 'mesh',
        script: { author: 'archiyou', name: 'house', fileId: 'file-house', code },
        componentLibraryUrl: '/api',
        authToken: 'token',
        ...extra,
    } as any
}

describe('Runner: $component() of a renamed script', () =>
{
    it('resolves the old name to the linked script with the same fileId', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ body: STORED }))

        runner.linkComponentScripts([
            Script.fromData({ fileId: 'file-wall', name: 'newwall', code: `workingcopy = box(1);` })!,
        ])

        const { missing } = await runner._prefetchComponentScripts(request(`$component('./oldwall').model();`))

        expect(missing).toEqual([])
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(fetchSpy.mock.calls[0][0]).toBe('/api/scripts/archiyou/by-name/oldwall')
        expect((fetchSpy.mock.calls[0][1]?.headers as any)?.Authorization).toBe('Bearer token')
        // the linked (unsaved) working copy wins over the stored version
        expect(runner.getComponentScriptFromCache('./oldwall')!.code).toBe(`workingcopy = box(1);`)
    })

    it('also resolves a bare old name', async () =>
    {
        const runner = await new Runner().load()
        stubFetch(() => ({ body: STORED }))
        runner.linkComponentScripts([
            Script.fromData({ fileId: 'file-wall', name: 'newwall', code: `workingcopy = box(1);` })!,
        ])

        const { missing } = await runner._prefetchComponentScripts(request(`$component('oldwall').model();`))
        expect(missing).toEqual([])
    })

    it('does not look up renames without an auth token (published configurator)', async () =>
    {
        const runner = await new Runner().load()
        const fetchSpy = stubFetch(() => ({ status: 404, body: { success: false } }))
        runner.linkComponentScripts([Script.fromData({ fileId: 'x', name: 'other', code: `a = 1;` })!])

        await runner._prefetchComponentScripts(request(`$component('./oldwall').model();`, { authToken: undefined }))

        expect(fetchSpy.mock.calls.map(c => c[0])).toEqual(['/api/scripts/shared/archiyou/oldwall'])
    })

    it('never resolves the running script into itself', async () =>
    {
        const runner = await new Runner().load()
        stubFetch((url) => url.includes('by-name')
            ? { body: { ...STORED, fileId: 'file-house' } }
            : { status: 404, body: { success: false } })
        runner.linkComponentScripts([Script.fromData({ fileId: 'x', name: 'other', code: `a = 1;` })!])

        const { missing } = await runner._prefetchComponentScripts(request(`$component('./oldhouse').model();`))
        expect(missing).toEqual(['./oldhouse'])
    })
})
