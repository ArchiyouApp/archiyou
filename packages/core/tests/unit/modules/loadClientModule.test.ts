/**
 * tests/unit/modules/loadClientModule.test.ts
 *
 * Fetching and instantiating a client bundle. The blob-URL import is stubbed via
 * `importImpl` — Node has no dependable blob-URL module loader, and what matters
 * here is the gating and the contract checks around the import, not the import
 * mechanism itself.
 */
import { describe, it, expect, vi } from 'vitest'

import { loadClientModule, clientBundleUrl, ModuleLoadError } from '../../../src/modules/loadClientModule'
import type { AyModuleManifest } from '@archiyou/module-sdk'

const manifest: AyModuleManifest = {
    id: 'example', global: 'example', name: 'Example',
    version: '2.3.4', engine: '^1.0.0', runtime: 'client',
}

const okFetch = (body = 'source') => vi.fn(async () => ({
    ok: true, status: 200, text: async () => body,
})) as any

const failFetch = (status: number) => vi.fn(async () => ({
    ok: false, status, text: async () => '',
})) as any

describe('clientBundleUrl', () =>
{
    it('puts the version in the path so a bundle can be cached immutably', () =>
    {
        expect(clientBundleUrl(manifest, 'https://api.test'))
            .toBe('https://api.test/modules/example/2.3.4/bundle.js')
    })

    it('supports a root-relative base', () =>
    {
        expect(clientBundleUrl(manifest, '')).toBe('/modules/example/2.3.4/bundle.js')
    })

    it('appends a dev build revision so no cache can serve the previous build', () =>
    {
        expect(clientBundleUrl({ ...manifest, rev: 'k3f9' }, ''))
            .toBe('/modules/example/2.3.4/bundle.js?rev=k3f9')
    })
})

describe('loadClientModule', () =>
{
    it('sends the bearer token, since import() cannot carry headers itself', async () =>
    {
        const fetchImpl = okFetch()
        const importImpl = async () => ({ default: () => ({ setArchiyou() {} }) })

        await loadClientModule(manifest, { moduleApiUrl: '', authToken: 'tok', fetchImpl, importImpl })

        expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    })

    it('marks a 403 as an entitlement problem, not a broken bundle', async () =>
    {
        const importImpl = async () => ({ default: () => ({ setArchiyou() {} }) })

        // The distinction drives what the user is told, so it is worth asserting:
        // "not available on your account" vs "this module is broken".
        const err = await loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: failFetch(403), importImpl })
            .catch(e => e)

        expect(err).toBeInstanceOf(ModuleLoadError)
        expect(err.notEntitled).toBe(true)
        expect(err.message).toMatch(/not available on your account/)
    })

    it('treats a 500 as a broken bundle', async () =>
    {
        const importImpl = async () => ({ default: () => ({ setArchiyou() {} }) })
        const err = await loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: failFetch(500), importImpl })
            .catch(e => e)

        expect(err.notEntitled).toBe(false)
        expect(err.message).toMatch(/HTTP 500/)
    })

    it('rejects a bundle that does not default-export a factory', async () =>
    {
        const importImpl = async () => ({ default: { notAFunction: true } })

        await expect(loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: okFetch(), importImpl }))
            .rejects.toThrow(/does not default-export a factory function/)
    })

    it('rejects a module that does not implement setArchiyou', async () =>
    {
        const importImpl = async () => ({ default: () => ({ solve: () => 1 }) })

        await expect(loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: okFetch(), importImpl }))
            .rejects.toThrow(/does not implement setArchiyou/)
    })

    it('reports a throwing factory without losing the original message', async () =>
    {
        const importImpl = async () => ({ default: () => { throw new Error('bad init') } })

        await expect(loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: okFetch(), importImpl }))
            .rejects.toThrow(/factory threw while constructing: bad init/)
    })

    it('accepts a namespace whose factory is the namespace itself', async () =>
    {
        // Some bundlers emit the function directly rather than under `default`.
        const importImpl = async () => (() => ({ setArchiyou() {}, ok: true }))

        const mod = await loadClientModule(manifest, { moduleApiUrl: '', fetchImpl: okFetch(), importImpl })
        expect((mod as any).ok).toBe(true)
    })
})
