import { describe, it, expect, beforeAll } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'

/**
 * Guards one invariant: the scope Proxy wraps the scope STATE itself, not a copy of it.
 *
 * `createScope()` used to do `new Proxy({ ...BASIC_SCOPE, ...state }, ...)`. The in-scope
 * helpers built by `buildLocalExecScopeState()` ($import, $optimize, print, …) close over
 * `state`, so with a copy they could never observe anything assigned to the scope afterwards
 * — including `scope.$PARAMS`, which `_executionStartRunInScope()` sets after the Proxy is
 * built. `$optimize()` therefore saw an empty param set and reported "nothing to optimize" on
 * scripts that plainly had params.
 *
 * The failure mode is silent, so it needs a test that fails loudly.
 */

const run = (runner: Runner, code: string) =>
    runner.execute({
        kernel: 'mesh',
        messages: ['user', 'error'],
        script: { code },
    } as RunnerScriptExecutionRequest)

const printed = (result: any): string =>
    (result.messages ?? []).filter((m: any) => m.type === 'user').map((m: any) => m.message).join(' ')

describe('Runner scope identity (Proxy target === state)', () =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    })

    // NOTE: runner.scope(name) SELECTS a scope and returns the Runner for chaining.
    // runner.getScope(name) is the one that returns the scope object.

    it('lets a closure built with the scope see a value assigned to it afterwards', () =>
    {
        // This is the exact mechanism the bug broke, probed without $optimize.
        //
        // buildLocalExecScopeState() defines `print` as `(...m) => state.console.user(...m)`
        // — a closure over `state`. Swap the scope's console THROUGH the proxy, then call
        // that closure: it only reaches the new console if `state` and the proxy target are
        // the same object. Against the old shallow copy, `state.console` stayed the original
        // and this assertion fails.
        runner.createScope('identity-probe')
        const scope: any = runner.getScope('identity-probe')

        const seen: Array<string> = []
        scope.console = { user: (m: string) => seen.push(m), info: () => {} }
        scope.print('via the swapped console')

        expect(seen).toEqual(['via the swapped console'])

        runner.deleteLocalScope('identity-probe')
    })

    it('still isolates one scope from another', () =>
    {
        // Sharing state with its own proxy must not start sharing state BETWEEN scopes.
        runner.createScope('iso-a')
        runner.createScope('iso-b')

        const a: any = runner.getScope('iso-a')
        const b: any = runner.getScope('iso-b')

        a.someVar = 'a'
        b.someVar = 'b'

        expect(a.someVar).toBe('a')
        expect(b.someVar).toBe('b')
        expect(a._archiyou).not.toBe(b._archiyou)
        expect(a._archiyou.modeler).not.toBe(b._archiyou.modeler)

        runner.deleteLocalScope('iso-a')
        runner.deleteLocalScope('iso-b')
    })

    it('keeps a working console on the scope', async () =>
    {
        // BASIC_SCOPE used to supply this via the object spread; it is now a `??=` fallback.
        const result = await run(runner, `print('console works')`)
        expect(result.status).toBe('success')
        expect(printed(result)).toContain('console works')
    })

    it('still auto-names shapes assigned through the proxy', async () =>
    {
        // The set trap does the naming, and it now writes into `state` — verify the trap is
        // still reached and still does its job.
        const result = await run(runner, `
            myTopBox = box(10,10,10)
            print('name=' + myTopBox.name())
        `)
        expect(result.status).toBe('success')
        expect(printed(result)).toContain('name=myTopBox')
    })

    it('resolves $PARAMS.define()d params inside the same run', async () =>
    {
        // The end-to-end shape of the original bug, independent of $optimize.
        const result = await run(runner, `
            $PARAMS.define('WIDTH', 'number', { minimum: 10, maximum: 200, default: 50 })
            print('n=' + $PARAMS.getParams().length)
            print('width=' + $WIDTH)
        `)
        expect(result.status).toBe('success')
        expect(printed(result)).toContain('n=1')
        expect(printed(result)).toContain('width=50')
    })
})
