/** docs.instruct() driven the way a user drives it: from a CAD script, through the Runner.
 *
 *  The unit tests wire the modules by hand. This one checks the thing they cannot: that
 *  `docs.instruct` is actually reachable from script scope, that it sees the scene the script
 *  built, and that a manual written in the sketch's own style resolves.
 */
import { describe, expect, it } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import { createNodeIO } from '@archiyou/meshup'

const SCRIPT = `
legs = group('legs',
    box(44,44,700).moveTo(0,0,350).name('leg'),
    box(44,44,700).moveTo(1100,0,350).name('leg'),
    box(44,44,700).moveTo(0,500,350).name('leg'),
    box(44,44,700).moveTo(1100,500,350).name('leg'));

rails = group('rails',
    box(1180,44,60).moveTo(550,0,660).name('rail'),
    box(1180,44,60).moveTo(550,500,660).name('rail'));

top = group('top', box(1200,600,18).moveTo(550,250,740).name('top panel'));

manual = docs.instruct('assembly')
    .title('Workbench')
    .iso()
    .duration(0.8)
    .parts({ print: false, table: false });

manual.step('Get the parts ready')
      .shapes('A','B','C')
      .layout('row', { spacing: 50 });

manual.step('Stand the legs up')
      .shapes('A')
      .subject('A');

manual.step('Bolt the rails to the legs')
      .shapes('A','B')
      .subject('B')
      .camera('front')
      .move({ from: 'top', distance: 200, arrow: true })
      .label('A#1', 'Front left leg')
      .hardware('M6x40 bolt', 8)
      .tools('allen key 4mm')
      .note('Do not tighten fully until the top is on.');

manual.step('Lay the top on')
      .shapes('A','B','C')
      .subject('C')
      .move({ from: 'top' });

instructData = manual.toData();
`

const request = (): RunnerScriptExecutionRequest =>
    ({ script: { code: SCRIPT }, outputs: [], kernel: 'mesh' })

describe('docs.instruct from a script', () =>
{
    it('builds a manual from the scene the script made', async () =>
    {
        const runner = new Runner()
        await runner.load()

        const result = await runner.execute(request())
        expect(result.status).toBe('success')

        const scope = (runner as any).getActiveScope()
        const data = scope.instructData

        expect(data.name).toBe('assembly')
        expect(data.title).toBe('Workbench')

        // parts found and labelled straight off the scene
        expect(data.parts.map((p: any) => [p.label, p.name, p.quantity]))
            .toEqual([['A', 'leg', 4], ['B', 'rail', 2], ['C', 'top panel', 1]])

        // four steps, numbered
        expect(data.steps.map((s: any) => s.number)).toEqual([1, 2, 3, 4])
        expect(data.steps[0].layout).toEqual({ kind: 'row', spacing: 50 })

        const rails = data.steps[2]
        expect(rails.title).toBe('Bolt the rails to the legs')
        expect(rails.camera.side).toBe('front')
        expect(rails.move.distance).toBe(200)
        expect(rails.move.duration).toBe(0.8)          // the manual's default
        expect(rails.labels[0].text).toBe('Front left leg')
        expect(rails.hardware).toEqual([{ name: 'M6x40 bolt', quantity: 8 }])
        expect(rails.uses).toEqual(['A', 'B'])

        // and the scene is still the finished model, not something a step took apart
        expect(scope.top.first().center().z).toBeCloseTo(740, 3)
    })

    it('bakes into the GLB through the output path', async () =>
    {
        const runner = new Runner()
        await runner.load()

        /*  `?instruct=assembly` is parsed off the output path into the GLTF format options and
            reaches Modeler.toGLB() — no new output category, no new format, no editor change. */
        const result = await runner.execute({
            script: { code: SCRIPT },
            outputs: ['default/model/glb?instruct=assembly'],
            kernel: 'mesh',
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('success')

        const output = result.outputs?.find(o => o.path.format === 'glb')
        expect(output).toBeDefined()

        const bytes = output!.output as any
        const doc = await createNodeIO().readBinary(
            bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.data ?? bytes))
        const extras = doc.getRoot().getExtras() as any

        expect(extras.instruct.name).toBe('assembly')
        expect(extras.instruct.steps).toHaveLength(4)
        expect(doc.getRoot().listAnimations().map((a: any) => a.getName())).toEqual(['assembly'])
        expect(doc.getRoot().listCameras()).toHaveLength(4)
    })

    it('rides along on the execution state, so an ordinary run carries it', async () =>
    {
        /*  The editor asks for `default/model/glb` with no options, so a GLB-extras-only
            channel would be empty unless the user knew to add ?instruct. The viewer needs the
            step data on every run to be able to step through anything at all. */
        const runner = new Runner()
        await runner.load()
        const result = await runner.execute(request())

        const instructs = (result.state as any)?.instruct
        expect(instructs).toHaveLength(1)
        expect(instructs[0].name).toBe('assembly')
        expect(instructs[0].steps).toHaveLength(4)
        expect(instructs[0].steps[0].visible.length).toBeGreaterThan(0)
    })

    it('is listed on the docs module', async () =>
    {
        const runner = new Runner()
        await runner.load()
        await runner.execute(request())

        expect((runner as any).getActiveScope().docs.instructs()).toEqual(['assembly'])
    })
})
