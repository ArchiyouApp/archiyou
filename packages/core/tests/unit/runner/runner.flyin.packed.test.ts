import { describe, it, expect, vi, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isPack3dLoaded } from '../../../src/modeler/Make'

/** The fly-in starts from the packed layout, so a run that bakes it loads the 3D load planner, even when the
 *  script never names it. A run the scan cannot see (a computed layout name) starts from the stacks instead.
 *  In this order: the planner, once loaded, stays loaded. */
describe('Runner — the fly-in starts from the packed layout', () =>
{
    const MODEL = `box(400, 300, 250).name('a'); box(400, 300, 250).name('b').moveZ(250);\n`
    const NOT_PACKED = /packed layout needs the 3D load planner/

    afterEach(() => vi.restoreAllMocks())

    async function run(runner: Runner, code: string, outputs: Array<string>): Promise<any>
    {
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'flyin', code })!, params: {}, outputs, messages: ['user', 'error'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        return result
    }

    it('a packed layout the scan does not see starts from the stacks', async () =>
    {
        const warn = vi.spyOn(console, 'warn')
        const runner = await new Runner().load()
        await run(runner, MODEL + `animator.create('lift').from(['pack', 'ed'].join('')).duration(2);\n`,
            ['default/model/glb?animations=lift'])

        expect(isPack3dLoaded()).toBe(false)
        expect(warn.mock.calls.flat().join('\n')).toMatch(NOT_PACKED)
    }, 60000)

    it('asking an output for the fly-in loads the planner, and the parts start packed', async () =>
    {
        const warn = vi.spyOn(console, 'warn')
        const runner = await new Runner().load()
        await run(runner, MODEL, ['default/model/glb?animations=flyin'])

        expect(isPack3dLoaded()).toBe(true)
        expect(warn.mock.calls.flat().join('\n')).not.toMatch(NOT_PACKED)
    }, 60000)
})
