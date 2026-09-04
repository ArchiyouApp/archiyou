import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../../src/runner/types'
import type { ScriptParamData } from '../../../src/execution/types'
import { Runner } from '../../../src/runner/Runner'

// A script that declares its own params + a preset, then uses one to build geometry.
const SCRIPT_CODE = `
    $PARAMS.define('WIDTH', 'number', { min: 10, max: 200, step: 5, default: 120, group: 'Size' });
    $PARAMS.define('SHOW',  'boolean', { default: true });
    $PARAMS.preset('SMALL', { WIDTH: 40 }, { description: 'Compact version' });

    box($WIDTH, 20, 30);
`

describe('Runner — programmatic params ($PARAMS.define / $PARAMS.preset)', () =>
{
    it('emits managedParams and managedPresets in result.state', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('success')

        const managed = result.state.managedParams
        expect(managed).toBeDefined()
        const newNames = managed!.new.map(p => p.name)
        expect(newNames).toContain('WIDTH')
        expect(newNames).toContain('SHOW')

        const presets = result.state.managedPresets
        expect(presets).toBeDefined()
        expect(presets!.SMALL.WIDTH._value).toBe(40)
    })

    it('is idempotent on re-run: re-asserting the same params yields no new/deleted', async () =>
    {
        const runner = await new Runner().load()

        // First run to obtain the emitted param definitions.
        const first = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        // Feed the emitted params back in (as the app would persist them) and
        // pick a user value for WIDTH.
        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        const second = await runner.execute({
            kernel:  'mesh',
            script:  { code: SCRIPT_CODE, params },
            params:  { WIDTH: 80 },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(second.status).toBe('success')
        const managed = second.state.managedParams!
        expect(managed.new.length).toBe(0)       // already known → not new
        expect(managed.deleted.length).toBe(0)   // still defined → not dropped
    })

    /* TODO: Fix and tests
        $PARAMS.define('SHOW', 'boolean', { default: false });  ==> looks like setting default is not workign
    */
})

// ── Object types & lists of objects ($PARAMS.defineObject) ───────────────────

// The real shape from Make.wall(): a list of openings the user picks from and edits.
const OPENINGS_CODE = `
    $PARAMS.defineObject('Opening', {
        wall:   ['left','right','front','back'],
        left:   { type:'number', min:0,   max:20000, step:10, default:1000, units:'mm' },
        sill:   { type:'number', min:0,   max:3000,  step:10, default:900  },
        width:  { type:'number', min:100, max:5000,  step:10, default:1200 },
        height: { type:'number', min:100, max:3000,  step:10, default:2100 },
        name:   'text',
    });

    $PARAMS.define('OPENINGS', 'list', {
        of: 'Opening',
        group: 'Openings',
        default: [
            { wall:'front', left:1000, sill:900, width:1200, height:2100, name:'kitchen window' },
            { wall:'left',  left:500,  sill:0,   width:900,  height:2100, name:'door' },
        ],
    });

    // Name a shape per opening, so a test can prove what the SCRIPT actually received.
    $OPENINGS.forEach(o => box(o.width / 100, 20, 30).name(o.name));
`

describe('Runner — object list params ($PARAMS.defineObject)', () =>
{
    it('inlines the object schema into schema.items, with the min/max aliases applied', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: OPENINGS_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('success')

        const openings = result.state.managedParams!.new.find(p => p.name === 'OPENINGS')
        expect(openings).toBeDefined()

        const schema = openings!.schema as any
        expect(schema.type).toBe('array')

        // Inlined: the app must be able to validate with no ParamManager around.
        expect(schema.items.type).toBe('object')
        expect(schema.items.title).toBe('Opening')

        // The min/max/step aliases really land in the nested property schemas.
        expect(schema.items.properties.left.maximum).toBe(20000)
        expect(schema.items.properties.width.minimum).toBe(100)
        expect(schema.items.properties.width.multipleOf).toBe(10)
        expect(schema.items.properties.wall.enum).toEqual(['left','right','front','back'])

        // Opt-in only — defaulting these would break schema evolution.
        expect(schema.items.required).toBeUndefined()
        expect(schema.items.additionalProperties).toBeUndefined()

        // The seeded entries are the default, and the script can read them.
        expect(openings!.default).toHaveLength(2)
    })

    it('keeps the user-edited list across a re-run (user edits win over the seed)', async () =>
    {
        const runner = await new Runner().load()

        const first = await runner.execute({
            kernel:  'mesh',
            script:  { code: OPENINGS_CODE },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        const params: Record<string, ScriptParamData> = {}
        for (const p of first.state.managedParams!.new) params[p.name] = p

        // The user edited entry 1 and added a third one.
        const edited = [
            { wall:'front', left:2500, sill:900, width:1400, height:2100, name:'big window' },
            { wall:'left',  left:500,  sill:0,   width:900,  height:2100, name:'door' },
            { wall:'back',  left:200,  sill:900, width:1000, height:1400, name:'hatch' },
        ]

        const second = await runner.execute({
            kernel:  'mesh',
            script:  { code: OPENINGS_CODE, params },
            params:  { OPENINGS: edited },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(second.status).toBe('success')

        // Neither re-defining nor the seed may clobber what the user edited.
        const managed = second.state.managedParams!
        expect(managed.deleted.length).toBe(0)

        const emitted = [...managed.new, ...managed.updated].find(p => p.name === 'OPENINGS')
        expect(emitted).toBeDefined()
        expect(emitted!._value).toEqual(edited)

        // …and the script itself ran against the edited list, not the seed: one named
        // shape per entry. This is the assertion that actually protects the feature.
        const sceneGraph = (second.state as any).sceneGraph ?? (second.state as any).scenegraph
        const names = (sceneGraph?.children ?? []).map((n: any) => n.name)
        expect(names).toEqual(['big window', 'door', 'hatch'])
    })

    it('errors with a helpful message on an unknown object type', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: `$PARAMS.define('OPENINGS', 'list', { of: 'Nope' }); box(10,10,10);` },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        expect(result.status).toBe('error')
        const text = JSON.stringify(result.messages)
        expect(text).toContain('Unknown object type')
        expect(text).toContain('Nope')
        expect(text).toContain('defineObject') // points at the fix
    })

    it('pushes onto an untouched list param and reports it back', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            kernel:  'mesh',
            script:  { code: `
                $PARAMS.defineObject('Hole', { size: { type:'number', min:1, max:100, default:10 } });
                $PARAMS.define('HOLES', 'list', { of: 'Hole' });
                $PARAMS.HOLES.push({ size: 20 });
                $PARAMS.HOLES.push({ size: 30 });
                box(10,10,10);
            ` },
            outputs: ['default/model/gltf'],
        } as RunnerScriptExecutionRequest)

        // Pre-fix this threw: the duplicate check indexed an undefined _value.
        expect(result.status).toBe('success')

        const holes = [...result.state.managedParams!.new, ...result.state.managedParams!.updated]
                        .find(p => p.name === 'HOLES')
        expect(holes).toBeDefined()
        expect(holes!._value).toEqual([{ size: 20 }, { size: 30 }])
    })
})
