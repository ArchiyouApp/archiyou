import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import type { ScriptParamData } from '../../../src/execution/types'
import type { ManagedHandleOp } from '../../../src/interaction/types'
import { Runner } from '../../../src/runner/Runner'

// The shape of timberwallopenings.js, minus the wall: an object list plus one handle per
// entry. Geometry is irrelevant here — what matters is the handle ops that come back.
const SCRIPT_CODE = `
    $PARAMS.defineObject('Opening', {
        name:   'text',
        left:   { type:'number', label:'From left', min:0, max:8000, step:10, default:1000 },
        sill:   { type:'number', label:'Sill',      min:0, max:3000, step:10, default:900 },
    });

    $PARAMS.define('OPENINGS', 'list', {
        of: 'Opening',
        default: [
            { name: 'kitchen window', left: 600,  sill: 900 },
            { name: 'door',           left: 2400, sill: 0 },
        ],
    });

    box(100, 100, 100);

    $OPENINGS.forEach((o, i) =>
        $handle()
            .param(\`OPENINGS[\${i}]\`, (param, handle) => { param.left += handle.du; param.sill += handle.dv })
            .at([o.left, 0, o.sill])
            .along('xz')
            .range(['-4000', '-2500'], ['+4000', '+2500'])
    );
`

const run = (runner: Runner, over: Partial<RunnerScriptExecutionRequest> = {}) =>
    runner.execute({
        kernel:  'mesh',
        script:  { id: 'wall-openings', code: SCRIPT_CODE },
        outputs: ['default/model/gltf'],
        ...over,
    } as RunnerScriptExecutionRequest)

const opById = (ops: ManagedHandleOp[], id: string) => ops.find(o => o.id === id)

describe('Runner — $handle().param("NAME[i]") over an object-list param', () =>
{
    it('emits one add op per list entry, bound by index', async () =>
    {
        const runner = await new Runner().load()
        const result = await run(runner)

        expect(result.status, result.errors?.[0]?.message ?? '').toBe('success')

        const ops = result.state.managedHandles!
        expect(ops.map(o => [o.id, o._operation])).toEqual([
            ['OPENINGS[0]', 'add'],
            ['OPENINGS[1]', 'add'],
        ])

        const first = opById(ops, 'OPENINGS[0]')!.data!
        expect(first.param).toBe('OPENINGS[0]')
        expect(first.paramFnSrc).toContain('param.left += handle.du')
        expect(first.position).toEqual([600, 0, 900])
        expect(first.rangeRelative).toBe(true)
        // The wall lies in XZ, so the drag plane spans world X and Z.
        expect(first.plane.uAxis).toEqual([1, 0, 0])
        expect(first.plane.vAxis).toEqual([0, 0, 1])
    })

    it('moves the handle to the edited entry after a param re-run, not back to the seed', async () =>
    {
        const runner = await new Runner().load()

        const first = await run(runner)
        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        // What the viewer writes after a drag of entry 0: whole array, one entry changed.
        const second = await run(runner, {
            script: { id: 'wall-openings', code: SCRIPT_CODE, params } as any,
            params: {
                OPENINGS: [
                    { name: 'kitchen window', left: 1230, sill: 900 },
                    { name: 'door',           left: 2400, sill: 0 },
                ],
            },
        })

        expect(second.status).toBe('success')
        const ops = second.state.managedHandles!

        // at() is an every-run position push (the script owns these positions — they must
        // track the geometry), so both handles emit an update and the moved one lands on
        // the edited value rather than the seed.
        expect(ops).toEqual([
            { id: 'OPENINGS[0]', _operation: 'update', position: [1230, 0, 900] },
            { id: 'OPENINGS[1]', _operation: 'update', position: [2400, 0, 0] },
        ])
    })

    it('still moves the handle when the edit also changes the range bounds', async () =>
    {
        // The realistic shape of a per-entry handle: the anchor is centred on the opening
        // (left + width/2) and the drag range is derived from that same entry, so editing
        // ANY of its properties changes a define-once field and a mutator at once. The
        // viewer preserves the live position across a definition re-add — it has to, or a
        // dragged handle would snap back — so the add op alone cannot move the handle. The
        // position mutator has to be emitted alongside it.
        const CODE = `
            $PARAMS.defineObject('Opening', {
                name:  'text',
                left:  { type:'number', min:0, max:8000, step:10, default:1000 },
                width: { type:'number', min:300, max:3000, step:10, default:1000 },
            });
            $PARAMS.define('OPENINGS', 'list', {
                of: 'Opening',
                default: [{ name: 'door', left: 1800, width: 1000 }],
            });
            box(100, 100, 100);
            $OPENINGS.forEach((o, i) =>
                $handle()
                    .param(\`OPENINGS[\${i}]\`, (param, handle) => { param.left += handle.du })
                    .at([o.left + o.width/2, 0, 0])
                    .along('x')
                    .range(\`-\${o.left}\`, \`+\${4600 - o.width - o.left}\`)
            );
        `
        const runner = await new Runner().load()
        const first = await runner.execute({
            kernel: 'mesh', script: { id: 'centred-handle', code: CODE }, outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)
        expect(first.status, first.errors?.[0]?.message ?? '').toBe('success')
        expect(opById(first.state.managedHandles!, 'OPENINGS[0]')!.data!.position).toEqual([2300, 0, 0])

        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        // width 1000 -> 2000 with left unchanged: the anchor moves half the growth (+500)
        // and rangeMax shrinks by the same edit.
        const second = await runner.execute({
            kernel: 'mesh',
            script: { id: 'centred-handle', code: CODE, params } as any,
            params: { OPENINGS: [{ name: 'door', left: 1800, width: 2000 }] },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        const ops = second.state.managedHandles!
        expect(ops.map(o => o._operation)).toEqual(['add', 'update'])
        expect(ops[0]!.data!.rangeMax).toBe(800)          // definition really did change
        expect(ops[1]!.position).toEqual([2800, 0, 0])    // ...and the handle still moves
    })

    it('deletes the orphaned handle when the user removes an entry', async () =>
    {
        const runner = await new Runner().load()

        const first = await run(runner)
        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        const second = await run(runner, {
            script: { id: 'wall-openings', code: SCRIPT_CODE, params } as any,
            params: { OPENINGS: [{ name: 'door', left: 2400, sill: 0 }] },
        })

        const ops = second.state.managedHandles!
        expect(opById(ops, 'OPENINGS[0]')).toEqual({
            id: 'OPENINGS[0]', _operation: 'update', position: [2400, 0, 0],
        })
        expect(opById(ops, 'OPENINGS[1]')?._operation).toBe('delete')
    })

    it('fails the run with a helpful error when the bound param does not exist', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: `
                $PARAMS.define('OPENINGS', 'list', { listItemType: 'string', default: [] });
                box(10,10,10);
                $handle().param('OPENINGZ[0]', (param, handle) => { param.left += handle.du });
            ` },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('error')
        expect(result.errors?.[0]?.message).toMatch(/unknown param "OPENINGZ"/)
    })

    it('accepts a param declared in code on the very first run, before the app knows it', async () =>
    {
        // request.script.params is empty here — the check has to see what $PARAMS.define()
        // registered this run, or it would reject every programmatic script's own params.
        const runner = await new Runner().load()
        const result = await run(runner)
        expect(result.status, result.errors?.[0]?.message ?? '').toBe('success')
        expect(result.state.managedHandles).toHaveLength(2)
    })
})
