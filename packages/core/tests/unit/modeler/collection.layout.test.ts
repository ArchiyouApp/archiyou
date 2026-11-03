import { describe, it, expect, beforeAll } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/** `collection.layout(name, options)` is `new Layouter(collection).<name>(options).apply()`: the shapes themselves move.
 *  The same on both kernels. */
describe.each(['mesh', 'brep'])('ShapeCollection.layout() on %s', (kernel) =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    }, 60000)

    async function run(code: string, outputs: Array<string> = ['default/model/gltf']): Promise<any>
    {
        return runner.execute({
            kernel, script: Script.fromData({ name: 'layout', code })!, params: {}, outputs, messages: ['user', 'error'],
        } as any)
    }

    const printed = (result: any): string => (result.messages ?? []).map((m: any) => m.message).join('\n')

    it('packs the shapes of a collection and returns it', async () =>
    {
        const result = await run(`
            legs = collection(box(44, 44, 700), box(44, 44, 700).move(300), box(44, 44, 700).move(600));
            top = box(1200, 600, 22).moveZ(711);
            laid = all().layout('packed', { spacing: 10 });
            print('same ' + (laid.length === 4));
            print('height ' + Math.round(all().bbox().height()));
        `)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        // laid flat in the bin: the legs lie on their sides, nothing stands 700 high any more
        expect(printed(result)).toMatch(/same true/)
        const height = Number(printed(result).match(/height (\d+)/)![1])
        expect(height).toBeLessThan(700)
    }, 60000)

    it('lays out only the shapes of the collection, by any name of the layout', async () =>
    {
        const result = await run(`
            legs = collection(box(44, 44, 700), box(44, 44, 700).move(300));
            top = box(1200, 600, 22).moveZ(711);
            legs.layout('flat');
            print('top ' + top.bbox().min().toArray().map(Math.round).join(','));
            print('legs ' + Math.round(legs.bbox().height()));
        `)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(printed(result)).toMatch(/top -600,-300,700/)
        expect(printed(result)).toMatch(/legs 44/)
    }, 60000)

    it('lays a turned shape flat in a row, its longest side along X', async () =>
    {
        const result = await run(`
            a = box(600, 100, 30).rotateZ(30).rotateX(20).move(500, 200, 300);
            b = box(400, 80, 18).rotateY(45);
            all().layout('row');
            all().forEach(s => print('at ' + s.bbox().min().toArray().map(Math.round) + ' / ' + s.bbox().max().toArray().map(Math.round)));
        `)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(printed(result)).toMatch(/at 0,-50,-15 \/ 600,50,15/)
        expect(printed(result)).toMatch(/at 605,-40,-9 \/ 1005,40,9/)
    }, 60000)

    it('pulls the shapes apart in the exploded view', async () =>
    {
        const result = await run(`
            a = box(100); b = box(100).move(100);
            all().layout('exploded', { distance: 50 });
            print('gap ' + Math.round(b.bbox().min().x - a.bbox().max().x));
        `)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(Number(printed(result).match(/gap (-?\d+)/)![1])).toBeGreaterThanOrEqual(50)
    }, 60000)

    it('bakes the fly-in from the packed layout', async () =>
    {
        const result = await run(`legs = collection(box(44, 44, 700), box(44, 44, 700).move(300));\nanimator.preset('flyin');\n`,
            ['default/model/glb?animations=flyin'])
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        expect(JSON.stringify(result.messages ?? [])).not.toMatch(/could not make/)
    }, 60000)

    it('names the layouts when the name is not one', async () =>
    {
        const result = await run(`all().layout('pile');`)
        expect(result.status).not.toBe('success')
        expect(JSON.stringify(result.errors)).toMatch(/'packed', 'partstack', 'row' or 'exploded'/)
    }, 60000)
})
