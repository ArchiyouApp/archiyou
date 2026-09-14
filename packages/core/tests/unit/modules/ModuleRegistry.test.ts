/**
 * tests/unit/modules/ModuleRegistry.test.ts
 *
 * The registry decides which script modules a run may use. Everything here uses
 * a fictional 'example' module — real modules live outside this repository (see
 * modules/README.md), so no test may name one.
 */
import { describe, it, expect, vi } from 'vitest'

import type { AyModule, AyModuleCatalogEntry } from '@archiyou/module-sdk'
import { ModuleRegistry } from '../../../src/modules/ModuleRegistry'
import { ModuleLoadError } from '../../../src/modules/loadClientModule'
import { ModuleUnavailableError } from '../../../src/modules/unavailableStub'
import { ARCHIYOU_CORE_VERSION } from '../../../src/constants'

/** A catalog entry with sane defaults; override per test. */
function entry(over: Partial<AyModuleCatalogEntry> = {}): AyModuleCatalogEntry
{
    return {
        id: 'example',
        global: 'example',
        name: 'Example Module',
        version: '1.0.0',
        engine: `^${ARCHIYOU_CORE_VERSION}`,
        runtime: 'client',
        entitled: true,
        ...over,
    } as AyModuleCatalogEntry
}

/** A minimal module instance following the SDK convention. */
function fakeModule(): AyModule & { _ay: any; _resets: number }
{
    return {
        _ay: null,
        _resets: 0,
        setArchiyou(ay: any) { (this as any)._ay = ay },
        reset() { (this as any)._resets++ },
        double: (n: number) => n * 2,
    } as any
}

describe('ModuleRegistry — pre-scan', () =>
{
    it('detects a global as a whole word only', () =>
    {
        expect(ModuleRegistry.referencesGlobal('x = example.run()', 'example')).toBe(true)
        expect(ModuleRegistry.referencesGlobal('x = 1', 'example')).toBe(false)
        // Substring matches must not count, or every script mentioning a longer
        // identifier would pay to download a module it never uses.
        expect(ModuleRegistry.referencesGlobal('exampleOther.run()', 'example')).toBe(false)
        expect(ModuleRegistry.referencesGlobal('myexample.run()', 'example')).toBe(false)
    })

    it('extracts $module() declarations, whatever the quoting', () =>
    {
        const code = `
            $module('one')
            two = $module( "two" )
            $module(\`three\`)
            $module('one')
        `
        expect(ModuleRegistry.extractDeclaredNames(code).sort()).toEqual(['one', 'three', 'two'])
    })

    it('ignores a computed $module() argument', () =>
    {
        // Same limitation as $import(): the name must be resolvable before the
        // script runs, because that is when the bundle is fetched.
        expect(ModuleRegistry.extractDeclaredNames("$module('a' + 'b')")).toEqual([])
        expect(ModuleRegistry.extractDeclaredNames('$module(name)')).toEqual([])
    })

    it('does not load a module the script never mentions', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare('box(10,10,10)', [entry()])

        expect(loadClient).not.toHaveBeenCalled()
        expect(reg.globals()).toEqual({})
    })

    it('loads a module the script does mention', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nr = example.double(4)", [entry()])

        expect(loadClient).toHaveBeenCalledTimes(1)
        expect(reg.globals().example.double(4)).toBe(8)
    })

    it('reuses a loaded instance on a re-run instead of re-fetching', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.double(1)", [entry()])
        const first = reg.globals().example
        await reg.prepare("$module('example')\nexample.double(2)", [entry()])

        // The editor re-runs on every keystroke-ish edit; a bundle must be
        // fetched once per version, not once per run.
        expect(loadClient).toHaveBeenCalledTimes(1)
        expect(reg.globals().example).toBe(first)
    })

    it('reloads when the build revision changes at the same version', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.double(1)", [entry({ rev: 'aaa' })])
        await reg.prepare("$module('example')\nexample.double(1)", [entry({ rev: 'aaa' })])
        expect(loadClient).toHaveBeenCalledTimes(1)

        // A rebuild during development keeps the version and changes `rev`. The
        // instance cache must treat that as a different module, or the editor
        // keeps running the previous build for the rest of the session.
        await reg.prepare("$module('example')\nexample.double(1)", [entry({ rev: 'bbb' })])
        expect(loadClient).toHaveBeenCalledTimes(2)
    })

    it('does not accumulate an instance per rebuild', async () =>
    {
        const reg = new ModuleRegistry().setOptions({ loadClient: async () => fakeModule() })

        for(const rev of ['r1', 'r2', 'r3', 'r4'])
        {
            await reg.prepare("$module('example')\nexample.double(1)", [entry({ rev })])
        }

        // Each instance may hold something expensive (a wasm instance, a loaded
        // dataset); a long dev session must not stack them up.
        expect(Object.keys((reg as any)._instances)).toHaveLength(1)
    })

    it('treats a new module version as a different module', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.double(1)", [entry({ version: '1.0.0' })])
        await reg.prepare("$module('example')\nexample.double(1)", [entry({ version: '1.1.0' })])

        expect(loadClient).toHaveBeenCalledTimes(2)
    })
})

describe('ModuleRegistry — validation', () =>
{
    const cases: Array<[string, Partial<AyModuleCatalogEntry>, RegExp]> = [
        ['a reserved module name', { global: 'calc' }, /already used by Archiyou/],
        ['a reserved modeling function', { global: 'box' }, /already used by Archiyou/],
        ['a lowercased modeling function', { global: 'planebetween' }, /already used by Archiyou/],
        ['the $ param namespace', { global: '$fem' }, /not a valid global name/],
        ['the _ internal namespace', { global: '_secret' }, /not a valid global name/],
        ['a non-identifier', { global: '1example' }, /not a valid global name/],
        ['an unknown runtime', { runtime: 'native' as any }, /unknown runtime/],
        ['an incompatible engine', { engine: '^99.0.0' }, /needs Archiyou core/],
        ['an unparseable engine', { engine: 'not-a-range' }, /needs Archiyou core/],
    ]

    it.each(cases)('refuses %s', async (_label, over, expected) =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })
        const e = entry(over)

        await reg.prepare("$module('example')\n", [e])

        expect(loadClient).not.toHaveBeenCalled()
        expect(reg.rejected[0]?.reason).toMatch(expected)
    })

    it('refuses both modules when two claim the same global', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.run()", [
            entry({ id: 'one' }),
            entry({ id: 'two' }),
        ])

        // Resolving by array order would be arbitrary, and which module you got
        // would depend on catalog ordering. Refusing both is the honest outcome.
        expect(loadClient).not.toHaveBeenCalled()
        expect(reg.rejected).toHaveLength(2)
        expect(reg.rejected[0].reason).toMatch(/more than one module claims/)
    })

    it('accepts an engine range that matches the running core', () =>
    {
        const reg = new ModuleRegistry()
        expect(reg.validate(entry({ engine: `^${ARCHIYOU_CORE_VERSION}` }))).toBeNull()
    })

    it('binds NOTHING under a reserved name, leaving the core global intact', async () =>
    {
        const reg = new ModuleRegistry().setOptions({ loadClient: async () => fakeModule() })

        await reg.prepare('box(10,10,10)', [entry({ global: 'box' })])

        // The dangerous outcome would be { box: <stub> }: the Runner assigns these
        // straight onto the scope, so a stub here would shadow the real box() for
        // every script — the exact breakage the reserved list exists to stop.
        expect(reg.globals()).toEqual({})
        expect(reg.rejected[0].reason).toMatch(/already used by Archiyou/)
    })

    it('reports a malformed manifest even when no script uses it', async () =>
    {
        const reg = new ModuleRegistry().setOptions({ loadClient: async () => fakeModule() })

        // A broken manifest is an operator problem. Waiting for someone to write a
        // script that happens to use it would hide the mistake indefinitely.
        await reg.prepare('box(10,10,10)', [entry({ global: 'calc' })])

        expect(reg.rejected[0].reason).toMatch(/already used by Archiyou/)
        expect(reg.globals()).toEqual({})
    })
})

describe('ModuleRegistry — unavailable modules', () =>
{
    it('gives an unentitled module a stub that names the reason', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.double(2)", [entry({ entitled: false })])

        expect(loadClient).not.toHaveBeenCalled()
        const stub = reg.globals().example
        expect(() => stub.double(2)).toThrow(ModuleUnavailableError)
        expect(() => stub.double(2)).toThrow(/not available on your account/)
    })

    it('gives a failed load a stub rather than failing the whole run', async () =>
    {
        const loadClient = vi.fn(async () => { throw new ModuleLoadError('example', 'bundle failed to load: boom') })
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.double(2)", [entry()])

        // A script may use several modules; one broken bundle must not take the
        // others (or the geometry) down with it.
        expect(() => reg.globals().example.double(2)).toThrow(/bundle failed to load: boom/)
    })

    it('keeps working modules usable alongside a broken one', async () =>
    {
        const loadClient = vi.fn(async (m: AyModuleCatalogEntry) =>
        {
            if(m.id === 'broken') throw new ModuleLoadError('broken', 'nope')
            return fakeModule()
        })
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\n$module('broken')\nexample.double(2); broken.run()", [
            entry(),
            entry({ id: 'broken', global: 'broken' }),
        ])

        expect(reg.globals().example.double(3)).toBe(6)
        expect(() => reg.globals().broken.run()).toThrow(/nope/)
    })
})

describe('ModuleRegistry — lifecycle', () =>
{
    it('hands each instance the engine reference and resets it', async () =>
    {
        const mod = fakeModule()
        const reg = new ModuleRegistry().setOptions({ loadClient: async () => mod })
        await reg.prepare("$module('example')\nexample.double(1)", [entry()])

        const archiyou = { modeler: {}, calc: {} } as any
        reg.linkToArchiyou(archiyou)

        expect(mod._ay).toBe(archiyou)
        expect(mod._resets).toBe(1)
    })

    it('does not touch stubs during linking', async () =>
    {
        const reg = new ModuleRegistry()
        await reg.prepare("$module('example')\nexample.run()", [entry({ entitled: false })])

        // The stub's Proxy throws on any property access, so linking must
        // recognise it as not-an-instance without reading through it.
        expect(() => reg.linkToArchiyou({} as any)).not.toThrow()
    })

    it('survives a module that throws during setup', async () =>
    {
        const angry = {
            setArchiyou() { throw new Error('bad wiring') },
        } as any
        const reg = new ModuleRegistry().setOptions({ loadClient: async () => angry })
        await reg.prepare("$module('example')\nexample.run()", [entry()])

        expect(() => reg.linkToArchiyou({} as any)).not.toThrow()
    })
})

describe('ModuleRegistry — warm-up', () =>
{
    it('awaits warm() and tells the module how to reach the asset proxy', async () =>
    {
        let seen: any = null
        let finished = false
        const mod = {
            ...fakeModule(),
            async warm(ctx: any)
            {
                seen = ctx
                await new Promise(r => setTimeout(r, 5))
                finished = true
            },
        } as any

        const reg = new ModuleRegistry().setOptions({ loadClient: async () => mod })
        await reg.prepare("$module('example')\nexample.double(1)", [entry()])
        await reg.warmModules({ assetProxyUrl: 'https://api.test' })

        // Awaited, not fired and forgotten: the whole point is that the script
        // finds the data already there.
        expect(finished).toBe(true)
        expect(seen).toEqual({ assetProxyUrl: 'https://api.test' })
    })

    it('logs and carries on when a warm-up fails', async () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const mod = { ...fakeModule(), async warm() { throw new Error('network down') } } as any

        const reg = new ModuleRegistry().setOptions({ loadClient: async () => mod })
        await reg.prepare("$module('example')\nexample.double(1)", [entry()])

        // A warm-up is an optimisation. Unlike init(), failing it must not cost
        // the run — the script may not even need what was being preloaded.
        await expect(reg.warmModules({})).resolves.toBeUndefined()
        expect(warn.mock.calls.flat().join(' ')).toMatch(/failed to warm up.*network down/)
        warn.mockRestore()
    })

    it('leaves modules without a warm() alone, and does not read through stubs', async () =>
    {
        const plain = new ModuleRegistry().setOptions({ loadClient: async () => fakeModule() })
        await plain.prepare("$module('example')\nexample.double(1)", [entry()])
        await expect(plain.warmModules({})).resolves.toBeUndefined()

        const stubbed = new ModuleRegistry()
        await stubbed.prepare("$module('example')\nexample.run()", [entry({ entitled: false })])
        await expect(stubbed.warmModules({})).resolves.toBeUndefined()
    })
})

describe('ModuleRegistry — server runtime', () =>
{
    it('forwards a call to the backend and returns its result', async () =>
    {
        const fetchImpl = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ success: true, result: { area: 42 } }),
        })) as any

        const reg = new ModuleRegistry().setOptions({
            moduleApiUrl: 'https://api.test',
            authToken: 'tok',
            fetchImpl,
        })
        await reg.prepare("$module('example')\nawait example.solve({})", [entry({ runtime: 'server' })])

        const out = await reg.globals().example.solve({ a: 1 })
        expect(out).toEqual({ area: 42 })

        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://api.test/modules/example/call')
        expect(init.headers.Authorization).toBe('Bearer tok')
        expect(JSON.parse(init.body)).toEqual({ method: 'solve', args: { a: 1 } })
    })

    it('never downloads anything for a server module', async () =>
    {
        const loadClient = vi.fn()
        const reg = new ModuleRegistry().setOptions({ loadClient, fetchImpl: vi.fn() as any })
        await reg.prepare("$module('example')\nexample.solve({})", [entry({ runtime: 'server' })])

        // The whole point of the server runtime: the code stays on the server.
        expect(loadClient).not.toHaveBeenCalled()
    })
})

describe('ModuleRegistry — server modules', () =>
{
    const serverEntry = (over: Partial<AyModuleCatalogEntry> = {}) => entry({ runtime: 'server', ...over })

    it('hands the injected blocking transport to the stub', async () =>
    {
        const callSync = vi.fn(() => ({ status: 200, text: JSON.stringify({ success: true, result: 42 }) })) as any
        const reg = new ModuleRegistry().setOptions({ callSync, moduleApiUrl: 'https://api.test' })

        await reg.prepare("$module('example')\nexample.solve()", [serverEntry()])

        // Plain value, no Promise: what a script inside the worker gets.
        expect(reg.globals().example.solve({ a: 1 })).toBe(42)
        expect(callSync).toHaveBeenCalledTimes(1)
    })

    it('wraps a hybrid module in its client bundle, built around the server stub', async () =>
    {
        const callSync = vi.fn(() => ({ status: 200, text: JSON.stringify({ success: true, result: { ref: 'r1' } }) })) as any
        const loadClient = vi.fn(async (_m: any, opts: any) =>
        {
            // The wrapper is what the script sees; it forwards to the stub it was given.
            const server = opts.factoryContext?.server
            return {
                setArchiyou() {},
                open: (url: string) => ({ url, ...server.open({ ref: url }) }),
            } as any
        })
        const reg = new ModuleRegistry().setOptions({ callSync, loadClient })

        await reg.prepare("$module('example')\nexample.open('u')", [serverEntry({ client: true })])

        expect(loadClient).toHaveBeenCalledTimes(1)
        expect(loadClient.mock.calls[0][1].factoryContext.server).toBeDefined()
        expect(reg.globals().example.open('u')).toEqual({ url: 'u', ref: 'r1' })
        expect(JSON.parse(callSync.mock.calls[0][1].body)).toEqual({ method: 'open', args: { ref: 'u' } })
    })

    it('refreshes a cached wrapper with the new run’s stub', async () =>
    {
        const seen: any[] = []
        const loadClient = vi.fn(async (_m: any, opts: any) => ({
            setArchiyou() {},
            setServer(s: any) { seen.push(s) },
            _first: opts.factoryContext?.server,
        }) as any)
        const reg = new ModuleRegistry().setOptions({ loadClient, callSync: () => ({ status: 200, text: '{}' }) })

        await reg.prepare("$module('example')\nexample.x", [serverEntry({ client: true })])
        await reg.prepare("$module('example')\nexample.x", [serverEntry({ client: true })])

        // Loaded once (cached like any client module), but told about the second
        // run's stub — that one carries the current bearer token.
        expect(loadClient).toHaveBeenCalledTimes(1)
        expect(seen).toHaveLength(1)
        expect(seen[0]).not.toBe(reg.globals().example._first)
    })

    it('does not load a bundle for a plain server module', async () =>
    {
        const loadClient = vi.fn(async () => fakeModule())
        const reg = new ModuleRegistry().setOptions({ loadClient })

        await reg.prepare("$module('example')\nexample.solve()", [serverEntry()])

        expect(loadClient).not.toHaveBeenCalled()
        expect(String(reg.globals().example)).toBe("[server module 'example']")
    })
})
