import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isPack3dLoaded } from '../../../src/modeler/Make'

/**
 * The 3D load planner (pack3d-wasm) loads on demand. make.pack3d() is synchronous for scripts, so the Runner
 * loads the module before a run whose script, or any of its components, calls pack3d(). This file runs in its own
 * module registry, so the module starts unloaded and the tests below depend on their order: what a plain script
 * leaves behind is checked first, then a call inside a component (which only the scan of the components can catch),
 * then a call in the script itself.
 */
const LOAD = `
parts = collection(box(400, 300, 250).name('a'), box(400, 300, 250).name('b'), box(600, 400, 300).name('c'));
loaded = make.pack3d(parts, { bins: [{ name: 'pallet', length: 1200, width: 800, height: 1800 }], maxIterations: 0 });
print('items ' + modeler.stats.bins[0].items + ' of ' + parts.toArray().length + ', unplaced ' + modeler.stats.unplaced.length);
`

const run = async (runner: Runner, name: string, code: string) =>
{
    const result: any = await runner.execute({
        script: Script.fromData({ name, code })!,
        params: {},
        outputs: ['default/model/gltf'],
        messages: ['user', 'error'],
    } as any)
    expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
    return (result.messages ?? []).map((m: any) => m.message).join('\n') as string
}

describe('Runner — the 3D load planner loaded on demand', () =>
{
    it('does not load it for a script that never mentions pack3d()', async () =>
    {
        const runner = await new Runner().load()
        await run(runner, 'plain', `post = box(100, 100, 2600); pack = 1; mypack3d = 2`)
        expect(isPack3dLoaded()).toBe(false)
    }, 60000)

    it('loads it for a call to pack3d() inside a component, and the call works', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({ name: 'loadplan', code: LOAD })!])
        const text = await run(runner, 'host', `$component('./loadplan').model();`)
        expect(text).toMatch(/items 3 of 3, unplaced 0/)
        expect(isPack3dLoaded()).toBe(true)
    }, 60000)

    it('loads it for a call to pack3d() in the script itself', async () =>
    {
        const runner = await new Runner().load()
        expect(await run(runner, 'direct', LOAD)).toMatch(/items 3 of 3, unplaced 0/)
    }, 60000)
})
