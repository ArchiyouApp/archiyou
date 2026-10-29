import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isPack3dLoaded } from '../../../src/modeler/Make'

/**
 * The 3D load planner (pack3d-wasm) loads on demand. make.pack3d() is synchronous for scripts, so the Runner
 * loads the module before a run whose script, or any of its components, calls pack3d(). This file runs in its own
 * module registry, so the module starts unloaded and the tests below depend on their order: what a plain script
 * leaves behind is checked first.
 */
const run = async (runner: Runner, name: string, code: string) =>
{
    const result: any = await runner.execute({
        script: Script.fromData({ name, code })!,
        params: {},
        outputs: ['default/model/gltf'],
        messages: ['user', 'error'],
    } as any)
    expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
    return result
}

describe('Runner — the 3D load planner loaded on demand', () =>
{
    it('does not load it for a script that never mentions pack3d()', async () =>
    {
        const runner = await new Runner().load()
        await run(runner, 'plain', `post = box(100, 100, 2600); pack = 1; mypack3d = 2`)
        expect(isPack3dLoaded()).toBe(false)
    }, 60000)

    it('loads it for a script that calls pack3d()', async () =>
    {
        const runner = await new Runner().load()
        // the call itself is not made here: the scan looks at the text, and the API arrives with make.pack3d()
        await run(runner, 'planner', `function plan(parts) { return make.pack3d(parts, {}) }; box(100, 100, 100)`)
        expect(isPack3dLoaded()).toBe(true)
    }, 60000)
})
