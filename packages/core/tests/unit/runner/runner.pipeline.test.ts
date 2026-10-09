/**
 *  Pipelines: named steps after the model whose output is kept apart from it (see
 *  execution/Pipeline.ts). Selected by the first segment of an output path.
 */

import { describe, it, expect, beforeAll } from 'vitest'

import type { RunnerScriptExecutionResult } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

let runner: Runner

beforeAll(async () =>
{
    runner = await new Runner().load()
}, 60_000)

const run = (code: string, outputs: Array<string>, kernel: 'mesh'|'brep' = 'mesh'): Promise<RunnerScriptExecutionResult> =>
    runner.execute({ script: { code }, outputs, kernel } as any)

const output = (result: RunnerScriptExecutionResult, path: string) =>
    result.outputs?.find(o => o.path.requestedPath === path || o.path.resolvedPath === path)?.output

/** Names of the LAYER records in a DXF string */
const dxfLayers = (dxf: string): Array<string> =>
{
    const lines = dxf.split(/\r?\n/).map(l => l.trim())
    return lines
        .map((l, i) => (l === 'LAYER' && lines[i + 1] === '5') ? lines.slice(i, i + 12) : null)
        .filter(Boolean)
        .map(rec => rec![rec!.indexOf('2') + 1])
        .filter(Boolean)
}

const DRAWINGS = `
    b = box(100, 50, 30);
    $pipeline('drawings', function()
    {
        iso = b.iso();
        front = b.elevation('front');
        return { iso, front };
    });
`

describe('Runner pipelines', () =>
{
    it('lists pipelines and keeps their output out of the model', async () =>
    {
        const result = await run(DRAWINGS, ['default/model/glb', 'drawings/model/glb'])

        expect(result.status).toBe('success')
        expect(result.meta?.pipelines).toEqual(['drawings'])
        expect(output(result, 'default/model/glb')).toBeTruthy()
        expect(output(result, 'drawings/model/glb')).toBeTruthy()

        const layerNames = JSON.stringify(result.state?.scenegraph ?? {})
        expect(layerNames).not.toContain('"iso"')
        expect(runner.getScope('default').modeler.all().length).toBe(1) // only the box
    })

    it('exports the returned shapes as DXF, one layer per key', async () =>
    {
        const result = await run(DRAWINGS + `r = rect(10, 10);`, ['default/model/dxf', 'drawings/model/dxf'])

        const drawings = output(result, 'drawings/model/dxf') as string
        expect(typeof drawings).toBe('string')
        expect(dxfLayers(drawings)).toEqual(expect.arrayContaining(['iso', 'front']))

        const model = output(result, 'default/model/dxf') as string
        expect(dxfLayers(model)).not.toContain('iso')
        expect(dxfLayers(model)).not.toContain('front')
    })

    it('outputs the shapes it made when it returns nothing', async () =>
    {
        const result = await run(`
            b = box(100);
            $pipeline('plan', function(){ outline = b.elevation('top'); });
        `, ['default/model/glb', 'plan/model/dxf'])

        expect(output(result, 'plan/model/dxf')).toBeTruthy()
        expect(result.meta?.numShapes).toBe(1)
    })

    it('keeps the variables it makes to itself, but reads those of the script', async () =>
    {
        const result = await run(`
            size = 100;
            b = box(size);
            $pipeline('a', function(){ iso = b.iso(); seen = size; return { iso } });
            $pipeline('b', function(){ iso = b.iso([1, 1, 1]); return { iso } });
        `, ['a/model/glb', 'b/model/glb'])

        expect(result.status).toBe('success')
        const scope = runner.getScope('default')
        expect(scope.iso).toBeUndefined()
        expect(scope.seen).toBeUndefined()

        const [a, b] = ['a', 'b'].map(n => runner.getPipelineByName(n, scope)!)
        expect(a.vars().seen).toBe(100)
        expect(a.vars().iso).toBeTruthy()
        expect(b.vars().iso).toBeTruthy()
        expect(a.vars().iso).not.toBe(b.vars().iso)
    })

    it('runs a pipeline once for all its outputs and its documents', async () =>
    {
        const result = await run(`
            runs = { count: 0 }; // an object: assigning count itself would stay in the pipeline
            b = box(100);
            $pipeline('drawings', function(){ runs.count++; return { iso: b.iso() } });
            docs.create('spec').pipeline('drawings').page('p').view('iso').shapes('iso');
        `, ['drawings/model/glb', 'drawings/model/dxf', 'default/docs/*/svg'])

        expect(result.status).toBe('success')
        expect(runner.getScope('default').runs.count).toBe(1)
        expect(result.outputs?.some(o => o.path.category === 'docs')).toBe(true)
    })

    it('starts every run without the pipelines of the previous one', async () =>
    {
        await run(`$pipeline('old', function(){ return { b: box(10) } })`, ['default/model/glb'])
        const result = await run(`box(10)`, ['default/model/glb', 'old/model/glb'])

        expect(result.meta?.pipelines).toEqual([])
        expect(output(result, 'old/model/glb')).toBeUndefined()
        expect(result.warnings?.join(' ')).toContain(`no pipeline 'old'`)
    })

    it('reports a failing pipeline without failing the run or the other pipelines', async () =>
    {
        const result = await run(`
            b = box(100);
            $pipeline('broken', function(){ throw new Error('boom') });
            $pipeline('fine', function(){ return { iso: b.iso() } });
        `, ['default/model/glb', 'broken/model/glb', 'fine/model/glb'])

        expect(result.status).toBe('success')
        expect(output(result, 'default/model/glb')).toBeTruthy()
        expect(output(result, 'broken/model/glb')).toBeUndefined()
        expect(output(result, 'fine/model/glb')).toBeTruthy()
        expect(result.warnings?.join(' ')).toContain('boom')
    })

    it('awaits an async pipeline', async () =>
    {
        const result = await run(`
            b = box(100);
            $pipeline('later', async function()
            {
                await 0;
                return { iso: b.iso() };
            });
        `, ['later/model/dxf'])

        expect(output(result, 'later/model/dxf')).toBeTruthy()
    })

    it('gives a pipeline the documents bound to it', async () =>
    {
        const result = await run(`
            b = box(100);
            $pipeline('drawings', function(){ return { iso: b.iso() } });
            docs.create('spec').pipeline('drawings').page('p').view('iso').shapes('iso');
            docs.create('other').page('p').text('hello');
        `, ['drawings/docs/*/svg', 'default/docs/*/svg'])

        const docsOf = (pipeline: string) => result.outputs!
            .filter(o => o.path.pipeline === pipeline && o.path.category === 'docs')
            .map(o => o.path.entityName)
        expect(docsOf('drawings')).toEqual(['spec'])
        expect(docsOf('default').sort()).toEqual(['other', 'spec'])
    })

    it('exports the dimensions of the drawing, not those of the model', async () =>
    {
        const result = await run(`
            plate = rect(200, 100);
            plate.dim();
            $pipeline('plain', function(){ return { outline: rect(50, 20).moveX(500) } });
            $pipeline('dimensioned', function(){ r = rect(50, 20).moveX(500); r.dim(); return { r } });
        `, ['plain/model/dxf', 'dimensioned/model/dxf'])

        expect(output(result, 'plain/model/dxf') as string).not.toContain('DIMENSION')
        expect(output(result, 'dimensioned/model/dxf') as string).toContain('DIMENSION')
    })

    it('turns a document pipeline function into a pipeline named after the document', async () =>
    {
        const result = await run(`
            b = box(100);
            docPipeline = function(){ return { iso: b.iso() } };
            docs.create('spec').pipeline(docPipeline).page('p').view('iso').shapes('iso');
            docs.create('copy').pipeline(docPipeline).page('p').view('iso').shapes('iso');
        `, ['spec/model/dxf', 'default/docs/*/svg'])

        expect(result.meta?.pipelines).toEqual(['spec'])
        expect(output(result, 'spec/model/dxf')).toBeTruthy()
        expect(result.outputs!.filter(o => o.path.category === 'docs')).toHaveLength(2)
    })

    it('does not run pipelines whose outputs and documents are not asked for', async () =>
    {
        await run(`
            runs = { count: 0 };
            b = box(100);
            $pipeline('drawings', function(){ runs.count++; return { iso: b.iso() } });
            docs.create('spec').pipeline(function(){ runs.count++; return { iso: b.iso() } }).page('p').view('iso').shapes('iso');
        `, ['default/model/glb', 'default/tables/*/json'])

        expect(runner.getScope('default').runs.count).toBe(0)
    })

    it('still draws an old document pipeline that only assigns variables', async () =>
    {
        const result = await run(`
            b = box(100);
            function docPipeline(){ iso = b.iso(); }
            docs.create('spec').pipeline(docPipeline).page('p').view('iso').shapes('iso');
        `, ['default/docs/*/svg'])

        expect(result.status).toBe('success')
        const svg = result.outputs!.find(o => o.path.category === 'docs')?.output as string
        expect(svg).toContain('<svg')
        expect(svg).not.toContain('was not found')
        expect(runner.getScope('default').iso).toBeUndefined()
    })

    it('works on the brep kernel', async () =>
    {
        const result = await run(DRAWINGS, ['default/model/glb', 'drawings/model/dxf'], 'brep')

        // brep shapes are converted on export, so the DXF has no scene layers (see DXFExporter layerNodeOf)
        expect(result.status).toBe('success')
        expect(output(result, 'drawings/model/dxf')).toBeTruthy()
        expect(runner.getScope('default').modeler.all().length).toBe(1)
    }, 60_000)
})
