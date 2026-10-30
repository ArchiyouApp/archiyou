import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isBinPackerLoaded, isPack3dLoaded } from '../../../src/modeler/Make'

/** A packed() layout needs the 3D load planner, and only that one: the Runner finds the call in the script. */
describe('Runner — the layout packed() loads the 3D load planner', () =>
{
    it('loads the planner and not the sheet packer, and the layout works', async () =>
    {
        const runner = await new Runner().load()
        const code = `
            box(400, 300, 250).name('a'); box(400, 300, 250).name('b');
            modeler.layouter().packed({ length: 1200, width: 800, height: 600 }).apply();
            print('placed ' + all().toArray().length);
        `
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'packed', code })!, params: {}, outputs: ['default/model/gltf'], messages: ['user', 'error'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(result.messages.map((m: any) => m.message).join('\n')).toMatch(/placed 2/)
        expect([isBinPackerLoaded(), isPack3dLoaded()]).toEqual([false, true])
    }, 60000)
})
