/**
 * tests/unit/runner/runner.modules.test.ts
 *
 * End-to-end script modules: a catalog on the request turns into a usable global
 * inside a real run, and an unavailable one turns into an error the script author
 * can act on.
 *
 * The module is fictional ('example') and injected through the registry's
 * loadClient seam, so nothing here needs a bundle server or a real module — which
 * is the point: this repository ships no modules (see modules/README.md).
 */
import { describe, it, expect } from 'vitest'

import type { AyModuleCatalogEntry } from '@archiyou/module-sdk'
import type { RunnerScriptExecutionResult } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import { ARCHIYOU_CORE_VERSION } from '../../../src/constants'

function entry(over: Partial<AyModuleCatalogEntry> = {}): AyModuleCatalogEntry
{
    return {
        id: 'example', global: 'example', name: 'Example Module',
        version: '1.0.0', engine: `^${ARCHIYOU_CORE_VERSION}`,
        runtime: 'client', entitled: true,
        ...over,
    } as AyModuleCatalogEntry
}

/** Install a fake client module so no bundle has to be fetched. */
function withModule(runner: Runner, impl: Record<string, any> = {})
{
    const mod: any = {
        _ay: null,
        setArchiyou(ay: any) { mod._ay = ay },
        double: (n: number) => n * 2,
        ...impl,
    }
    runner.modules.setOptions({ loadClient: async () => mod })
    return mod
}

const errorText = (r: RunnerScriptExecutionResult): string =>
    (r.errors ?? []).map(e => e.message).join('\n')

describe('Runner — $module() declarations', () =>
{
    it('declares a module and binds its global', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `$module('example')\nw = example.double(21)\nbox(w,10,10)` },
            modules: [entry()],
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
    })

    it('returns the module so it can be aliased', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `cc = $module('example')\nbox(cc.double(21), 10, 10)` },
            modules: [entry()],
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
    })

    it('loads a module that is ONLY ever named in the declaration', async () =>
    {
        const runner = await new Runner().load()
        let loads = 0
        runner.modules.setOptions({
            loadClient: async () => { loads++; return { setArchiyou() {}, double: (n: number) => n * 2 } as any },
        })

        // The bare global 'example' never appears, so the word-match pre-scan
        // alone would never fetch this. Extracting $module() literals is what
        // makes aliasing work at all.
        const result = await runner.execute({
            script: { code: `cc = $module('example')\nbox(cc.double(5), 10, 10)` },
            modules: [entry()],
            outputs: [],
        } as any)

        expect(loads).toBe(1)
        expect(result.status).toBe('success')
    })

    it('resolves by module id when the global differs', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `cc = $module('cloud-calc')\nbox(cc.double(5), 10, 10)` },
            modules: [entry({ id: 'cloud-calc', global: 'cloudcalc' })],
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
    })

    it('fails AT THE DECLARATION when the module is unavailable', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `$module('example')\nbox(10,10,10)` },
            modules: [entry({ entitled: false })],
            outputs: [],
        } as any)

        // The whole point of declaring: stop before building anything, and name
        // the declaration rather than some later line that merely touched it.
        expect(result.status).toBe('error')
        expect(errorText(result)).toMatch(/\$module\('example'\): not available on your account/)
    })

    it('reports an unknown name distinctly from an unavailable one', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `$module('exmaple')\nbox(10,10,10)` },   // typo
            modules: [entry()],
            outputs: [],
        } as any)

        expect(result.status).toBe('error')
        expect(errorText(result)).toMatch(/no such module/)
    })

    it('can still be caught for graceful degradation', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `
                cc = null
                try { cc = $module('example') } catch(e) { cc = null }
                box(10,10,10)
            ` },
            modules: [entry({ entitled: false })],
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
    })

    it('rejects a non-string argument with a usable message', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `$module()\nbox(10,10,10)` },
            modules: [entry()],
            outputs: [],
        } as any)

        expect(errorText(result)).toMatch(/needs a module name/)
    })
})

describe('Runner — script modules', () =>
{
    it('makes an entitled module callable from a script', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: "$module('example')\nsizeVal = example.double(21)\nbox(sizeVal, 10, 10)" },
            modules: [entry()],
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
    })

    it('gives a module the engine back-reference', async () =>
    {
        const runner = await new Runner().load()
        const mod = withModule(runner)

        await runner.execute({
            script: { code: "$module('example')\nexample.double(1)" },
            modules: [entry()],
            outputs: [],
        } as any)

        // Same wiring convention as the built-in modules (Runner.initLocalArchiyou).
        expect(mod._ay).toBeTruthy()
        expect(mod._ay.modeler).toBeTruthy()
        expect(mod._ay.modules).toBe(runner.modules)
    })

    it('fails a script that uses a module the user lacks, with a readable reason', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: "$module('example')\nx = example.double(2)" },
            modules: [entry({ entitled: false })],
            outputs: [],
        } as any)

        expect(result.status).toBe('error')
        // The whole reason the stub exists: without it the scope Proxy resolves
        // the unknown name to undefined and the author sees
        // "undefined is not a function", which points nowhere.
        expect(errorText(result)).toMatch(/not available on your account/)
        expect(errorText(result)).not.toMatch(/undefined is not a function/)
    })

    it('lets a script degrade gracefully with try/catch', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner)

        const result = await runner.execute({
            script: { code: `
                stress = 'skipped'
                try { stress = example.double(2) } catch(e) { stress = 'unavailable' }
                box(10,10,10)
            ` },
            modules: [entry({ entitled: false })],
            outputs: [],
        } as any)

        // Documented in modules/README.md as the way to write a script that works
        // with or without a module. It only holds because the stub throws a real
        // Error that ordinary script control flow can catch.
        expect(result.status).toBe('success')
    })

    it('does NOT load a module that is merely mentioned, only declared ones', async () =>
    {
        const runner = await new Runner().load()
        let loads = 0
        runner.modules.setOptions({
            loadClient: async () => { loads++; return { setArchiyou() {} } as any },
        })

        await runner.execute({
            script: { code: '// TODO: try example here later\nbox(10,10,10)' },
            modules: [entry()],
            outputs: [],
        } as any)

        // Loading is driven by $module() alone. A stray mention — in a comment, a
        // string, a similarly-named variable — can no longer cost a download.
        expect(loads).toBe(0)
    })

    it('tells a script that used a module without declaring it what to add', async () =>
    {
        const runner = await new Runner().load()
        let loads = 0
        runner.modules.setOptions({
            loadClient: async () => { loads++; return { setArchiyou() {}, double: (n: number) => n * 2 } as any },
        })

        const result = await runner.execute({
            script: { code: 'x = example.double(2)\nbox(10,10,10)' },
            modules: [entry()],
            outputs: [],
        } as any)

        // Requiring the declaration must not cost the good error message. The
        // name is still bound — to a stub that says exactly what is missing —
        // rather than left undefined, which would read as
        // "undefined is not a function" and point nowhere.
        expect(result.status).toBe('error')
        expect(errorText(result)).toMatch(/not declared in this script — add \$module\('example'\)/)
        expect(errorText(result)).not.toMatch(/undefined is not a function/)
        // …and diagnosing it cost no network.
        expect(loads).toBe(0)
    })

    it('leaves ordinary scripts completely untouched (regression: no catalog)', async () =>
    {
        const runner = await new Runner().load()

        // No catalog on the request — the default for every build of this repo.
        const result = await runner.execute({
            script: { code: 'box(100,100,100)' },
            outputs: [],
        } as any)

        expect(result.status).toBe('success')
        expect(runner.modules.globals()).toEqual({})
    })

    it('does not let a module shadow a core global', async () =>
    {
        const runner = await new Runner().load()
        withModule(runner, { double: () => { throw new Error('module box was called') } })

        const result = await runner.execute({
            script: { code: 'b = box(10,10,10)' },
            modules: [entry({ global: 'box' })],
            outputs: [],
        } as any)

        // box() must still be Archiyou's box(), not anything the module supplied.
        expect(result.status).toBe('success')
        expect(runner.modules.rejected[0].reason).toMatch(/already used by Archiyou/)
    })

    it('keeps the module instance across re-runs', async () =>
    {
        const runner = await new Runner().load()
        let built = 0
        runner.modules.setOptions({
            loadClient: async () => { built++; return { setArchiyou() {}, double: (n: number) => n * 2 } as any },
        })

        const req = { script: { code: "$module('example')\nexample.double(1)" }, modules: [entry()], outputs: [] }
        await runner.execute({ ...req } as any)
        await runner.execute({ ...req } as any)

        // Re-running in the editor must not re-download the bundle each time.
        expect(built).toBe(1)
    })
})
