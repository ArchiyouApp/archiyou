import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { isRecipeRecording } from '../../../src/modeler/Recipe'

/**
 * `fab` in scripts. The fabrication module is loaded on demand (Modeler.loadFabModule) and every fab.*()
 * call is synchronous, so the Runner loads it before a run whose script or components use it. This file
 * runs in its own module registry and the component test comes first, so the module starts unloaded: a
 * working fab.operations() inside a component proves the Runner looked into the component's code too.
 */
describe('Runner — fab', () =>
{
    it('loads the fabrication module for fab used only inside a component', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({
            name: 'frame',
            code: `
                wall = make.wall(1220, 2400, 120, 38, 610);
                ops = fab.operations(wall);
                print('fastened: ' + ops.fasteners().map(f => f.count + 'x' + f.length).join(', '));
            `,
        })!])
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'host', code: `$component('./frame').model();` })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user', 'error'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        const text = (result.messages ?? []).map((m: any) => m.message).join('\n')
        expect(text).toContain('fastened: 12x90')
    }, 60000)

    it('fastens a wall, writes the tables and explains itself', async () =>
    {
        const runner = await new Runner().load()
        const result: any = await runner.execute({
            script: Script.fromData({
                name: 'wall',
                code: `
                    $PARAMS.define('WIDTH', 'number', { default: 2440, minimum: 1000, maximum: 4000 });
                    fab.configure({ joints: { 'stud-plate': { count: 3 } } });
                    wall = make.wall($WIDTH, 2400, 120, 38, 610);
                    ops = fab.operations(wall);
                    ops.table('fastenings');
                    ops.table('fasteners', { by: 'fastener' });
                    ops.table('cut list', { by: 'part' });
                    print('cut list from: ' + ops.parts().map(p => p.origin).join(', '));
                    print(ops.explain());
                    est = fab.estimate(ops, { area: $WIDTH / 1000 * 2.4 });
                    est.metrics();
                    est.table('material', { by: 'stock' });
                    print('estimate: ' + est.hours + ' h, complete ' + est.complete);
                `,
            })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user', 'error'],
        } as any)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')

        const text = (result.messages ?? []).map((m: any) => m.message).join('\n')
        expect(text).toContain('Archiyou fab: fabrication from the model')
        expect(text).toContain('1 change(s) this run')
        // a script that uses fab records recipes, so its cuts are confirmed by them
        expect(isRecipeRecording()).toBe(true)
        expect(text).toContain('cut list from: derived, derived')

        const calc: any = runner.getScope('default').calc
        expect(calc.getTableNames()).toEqual(expect.arrayContaining(['fastenings', 'fasteners', 'cut list', 'material']))
        expect(calc.getMetricNames()).toEqual(['production_time', 'cost_labor', 'cost_material'])
        expect(text).toMatch(/estimate: [\d.]+ h, complete true/)
        // 5 studs, 3 screws at each end
        expect(calc.table('fasteners').toData()).toEqual([{ type: 'screw', diameter: 5, length: 90, count: 30 }])
    }, 60000)

    it('starts every run from the norm book again', async () =>
    {
        const runner = await new Runner().load()
        const run = (code: string) => runner.execute({
            script: Script.fromData({ name: 'plain', code })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user', 'error'],
        } as any)
        await run(`fab.configure({ joints: { 'stud-plate': { count: 4 } } });`)
        const result: any = await run(`
            ops = fab.operations(make.wall(1220, 2400, 120, 38, 610));
            print('book changes: ' + fab.config().changes + ', per stud end: ' + ops.fastenings().find(f => f.joint === 'stud-plate').count);
        `)
        expect(result.status, JSON.stringify(result.errors ?? [])).toBe('success')
        const text = (result.messages ?? []).map((m: any) => m.message).join('\n')
        expect(text).toContain('book changes: 0, per stud end: 2')
    }, 60000)
})
