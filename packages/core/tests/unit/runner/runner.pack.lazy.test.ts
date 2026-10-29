import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isBinPackerLoaded, isPack3dLoaded } from '../../../src/modeler/Make'

/**
 * Both packers load on demand: the 2D sheet packer for pack(), pack2d() or boarding(), the 3D load planner for pack3d()
 * or pack(). make.pack() cannot know before it sees the shapes which one it needs, so it loads both. This file runs in its
 * own module registry, so nothing is loaded at the start, and the tests depend on their order.
 */
const run = async (name: string, code: string) =>
{
    const runner = await new Runner().load()
    const result: any = await runner.execute({
        script: Script.fromData({ name, code })!,
        params: {},
        outputs: ['default/model/gltf'],
        messages: ['user', 'error'],
    } as any)
    expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
    return (result.messages ?? []).map((m: any) => m.message).join('\n') as string
}

describe('Runner — the packers loaded on demand', () =>
{
    it('loads neither for a script that never packs', async () =>
    {
        await run('plain', `post = box(100, 100, 2600); pack = 1; unpack = 2`)
        expect([isBinPackerLoaded(), isPack3dLoaded()]).toEqual([false, false])
    }, 60000)

    it('loads only the load planner for pack3d()', async () =>
    {
        await run('planner', `function plan(parts) { return make.pack3d(parts, {}) }; box(100, 100, 100)`)
        expect([isBinPackerLoaded(), isPack3dLoaded()]).toEqual([false, true])
    }, 60000)

    it('loads the sheet packer for pack2d(), and the call works', async () =>
    {
        const text = await run('sheets', `
            panels = collection(box(800, 400, 18).name('a'), box(800, 400, 18).name('b'));
            make.pack2d(panels, { width: 2440, height: 1220 });
            print('packed ' + modeler.stats.numberOfSheets);
        `)
        expect(isBinPackerLoaded()).toBe(true)
        expect(text).toMatch(/packed/)
    }, 60000)

    it('loads both for pack(), and the call works', async () =>
    {
        const text = await run('either', `
            cartons = collection(box(400, 300, 250).name('a'), box(400, 300, 250).name('b'), box(400, 300, 250).name('c'));
            make.pack(cartons, { bins: [{ length: 1200, width: 800, height: 1800 }], maxIterations: 0 });
            print('items ' + modeler.stats.bins[0].items);
        `)
        expect(text).toMatch(/items 3/)
        expect([isBinPackerLoaded(), isPack3dLoaded()]).toEqual([true, true])
    }, 60000)
})
