import { describe, it, expect } from 'vitest'

import { readFileSync } from 'node:fs'  

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { save } from '@archiyou/meshup/src/utils'
import type { SceneNodeData } from '../../../src/modeler/types'

/**
 * Tests the linkComponentScripts() → _prepareComponentScript('./name')
 * → cache path. These verify the wiring added so the editor can pass a
 * collection of local Scripts to the Runner for component resolution.
 *
 * The full sub-execution of $component('./x').model() in a parent script
 * is exercised in the browser; see plan's verification section.
 */
describe('Runner.linkComponentScripts (local component lookup)', () =>
{
    it('caches a linked Script when the parent code references $component("./name")', async () =>
    {
        const runner = await new Runner().load()

        const component = Script.fromData({
            name: 'mybox',
            code: `box(20, 20, 20).color('blue');`,
        })
        expect(component).not.toBeNull()

        runner.linkComponentScripts([component!])

        // Drive the prefetch directly — no parent execution side-effects.
        await runner._prefetchComponentScripts(`$component('./mybox').model();`)

        const cached = runner.getComponentScriptFromCache('./mybox')
        expect(cached).not.toBeNull()
        expect(cached!.name).toBe('mybox')
        expect(cached!.code).toBe(`box(20, 20, 20).color('blue');`)
    })

    it('matches the local name case-insensitively (Script.fromData lowercases name)', async () =>
    {
        const runner = await new Runner().load()

        const component = Script.fromData({
            name: 'MyBox',
            code: `box(10, 10, 10).color('blue');`,
        })!
        runner.linkComponentScripts([component])

        await runner._prefetchComponentScripts(`$component('./MYBOX').model();`)

        const cached = runner.getComponentScriptFromCache('./MYBOX')
        expect(cached).not.toBeNull()
        expect(cached!.name).toBe('mybox')
    })

    it('returns null when no linked script matches the local name', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([]) // nothing linked

        // Prefetch logs warning + skips; no entry added to cache.
        await runner._prefetchComponentScripts(`$component('./notthere').model();`)

        const cached = runner.getComponentScriptFromCache('./notthere')
        expect(cached).toBeNull()
    })

    /**
     * End-to-end test: parent script imports a linked local component, the
     * full pipeline produces a GLB, scenegraph reports the merged tree.
     */
    it('runs a script with a component in it', async () =>
    {
        const runner = await new Runner().load()

        const component = Script.fromData({
            name: 'myComponent',
            code: `myComponent = box(10, 10, 100).color('blue');`,
        })!
        runner.linkComponentScripts([component])

        const parentCode = `
            g = box(50, 50, 5).color('green');
            m = $component('./myComponent').model();
        `
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: parentCode },
            outputs: ['default/model/glb'],
        } as any)

        expect(result.status).toBe('success')
        
        const countNodes = (n: SceneNodeData | undefined): number =>
            !n ? 0 : 1 + (n.children ?? []).reduce((acc, c) => acc + countNodes(c), 0)
        const total = countNodes(result.state?.scenegraph)
        console.log(`scenegraph total nodes: ${total}`)
        expect(total).toBeGreaterThan(1)

        const glb = result.outputs?.find(o => o.path.format === 'glb')
        expect(glb).toBeDefined()
        expect(glb!.output).toBeDefined()
        await save('./tests/outputs/runner/runner.component.test.glb', glb!.output as ArrayBuffer)
    })

    /** Component with docs */
    it('Runs a script with a component that produces docs', async () =>
    {
        const runner = await new Runner().load()

        const component = Script.fromData({
            name: 'myComponent',
            code: `
                myBox = box(10, 10, 100).color('blue');
                docs.create('myDoc')
                    .page('myPage')
                    .pipeline(() => {
                        iso = myBox.iso();
                        return { iso }
                    })
                    .view('isometry').shapes('iso');
            `,
        })
        runner.linkComponentScripts([component])

        const parentCode = `
                    p = box(50, 50, 5).color('green');
                    comp = $component('./myComponent').all();

                    docs.create('parentDoc')
                        .page('parentPage')
                        .text('ParentPage')
                        .merge(comp.docs) // merged component page
                `
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: parentCode },
            outputs: ['default/docs/*/svg'],
        })

        if(result.status !== 'success')
        {
            console.log('====================')
            console.error('Execution failed:', result.errors)
        }
        
        expect(result.status).toBe('success');
        const svg = result.outputs?.find(o => o.path.format === 'svg')
        expect(svg).toBeDefined();
        expect(svg!.output).toBeDefined();
        save('./tests/outputs/runner/runner.component.merged.docs.svg', svg!.output as string)
    })

    /** Component docs sugar: docs() and docs(name) */
    it('Gets all or specific docs of a component with docs()', async () =>
    {
        const runner = await new Runner().load()

        const component = Script.fromData({
            name: 'myDocsComponent',
            code: `
                docs.create('specDoc').page('specPage').text('Spec');
                docs.create('otherDoc').page('otherPage').text('Other');
            `,
        })
        runner.linkComponentScripts([component])

        const parentCode = `
                    allDocs = $component('./myDocsComponent').docs();
                    specDoc = $component('./myDocsComponent').docs('specDoc');
                    if(allDocs.length !== 2){ throw new Error('Expected 2 docs, got ' + allDocs.length); }
                    if(specDoc._name !== 'specDoc'){ throw new Error('Expected specDoc, got ' + specDoc._name); }

                    docs.create('parentDoc')
                        .page('parentPage')
                        .text('ParentPage')
                        .merge(specDoc)
                `
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: parentCode },
            outputs: ['default/docs/*/svg'],
        })

        if(result.status !== 'success'){ console.error('Execution failed:', result.errors) }
        expect(result.status).toBe('success');

        const missing = await runner.execute({
            kernel: 'mesh',
            script: { code: `$component('./myDocsComponent').docs('nope');` },
        })
        expect(missing.status).not.toBe('success');
    })

    /** Variables declared in component docs can be set by the parent */
    it('Sets variables of component docs', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([
            Script.fromData({ name: 'varDocs', code: `docs.create('myDoc').page('p').text('Untitled').var('title');` }),
            Script.fromData({ name: 'noVarDocs', code: `docs.create('myDoc').page('p').text('a');` }),
        ])

        const ok = await runner.execute({
            kernel: 'mesh',
            script: { code: `
                compDoc = $component('./varDocs').get('default/docs/myDoc');
                docs.page('cover')
                    .text('cover')
                    .merge(compDoc.set('title', 'OTHERTITLE'));
            ` },
            outputs: ['default/docs/*/svg'],
        })
        if(ok.status !== 'success'){ console.error('Execution failed:', ok.errors) }
        expect(ok.status).toBe('success');
        const svg = ok.outputs?.find(o => o.path.format === 'svg')?.output as string;
        expect(svg).toContain('OTHERTITLE');
        expect(svg).not.toContain('Untitled');

        // Variables are taken over by the document merged into
        const afterMerge = await runner.execute({
            kernel: 'mesh',
            script: { code: `
                docs.page('cover')
                    .merge($component('./varDocs').get('default/docs/myDoc'))
                    .set('title', 'MERGEDTITLE');
            ` },
            outputs: ['default/docs/*/svg'],
        })
        if(afterMerge.status !== 'success'){ console.error('Execution failed:', afterMerge.errors) }
        expect(afterMerge.status).toBe('success');
        expect(afterMerge.outputs?.find(o => o.path.format === 'svg')?.output as string).toContain('MERGEDTITLE');

        const none = await runner.execute({
            kernel: 'mesh',
            script: { code: `$component('./noVarDocs').get('default/docs/myDoc').set('title', 'X');` },
        })
        expect(none.status).not.toBe('success');
        expect(JSON.stringify(none.errors)).toContain('No vars available');
    })

    /** get() with docs paths: all, by name, without format */
    it('Gets all or specific docs of a component with get()', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([
            Script.fromData({ name: 'twoDocs', code: `box(10); docs.create('myDoc').page('p').text('a'); docs.create('other').page('q').text('b');` }),
            Script.fromData({ name: 'noDocs', code: `box(10);` }),
        ])

        const run = async (code:string) => runner.execute({ kernel: 'mesh', script: { code } });
        const check = (cond:string, msg:string) => `if(!(${cond})){ throw new Error(${JSON.stringify(msg)}); }`;

        const ok = await run(`
            all = $component('./twoDocs').get('default/docs/*');
            ${check("Array.isArray(all) && all.length === 2", 'docs/* should give all docs')}
            noFormat = $component('./twoDocs').get('default/docs');
            ${check("Array.isArray(noFormat) && noFormat.length === 2", 'docs should give all docs')}
            one = $component('./twoDocs').get('default/docs/myDoc');
            ${check("one._name === 'myDoc'", 'docs/myDoc should give myDoc')}
            withFormat = $component('./twoDocs').get('default/docs/other/internal');
            ${check("withFormat._name === 'other'", 'docs/other/internal should give other')}
            multi = $component('./twoDocs').get(['default/model', 'default/docs/other']);
            ${check("multi.model && multi.docs._name === 'other'", 'model and named doc')}
            multiArgs = $component('./twoDocs').get('default/model', 'default/docs/other');
            ${check("multiArgs.model && multiArgs.docs._name === 'other'", 'paths as separate arguments')}
            none = $component('./noDocs').docs();
            ${check("Array.isArray(none) && none.length === 0", 'component without docs gives []')}
            docs.create('parentDoc').page('parentPage').merge(one);
        `);
        if(ok.status !== 'success'){ console.error('Execution failed:', ok.errors) }
        expect(ok.status).toBe('success');

        for(const bad of [
            `$component('./twoDocs').get('default/docs/nope')`,
            `$component('./noDocs').docs('nope')`,
            `$component('./twoDocs').get('default/foo')`,
            `$component('./twoDocs').get('default/docs/myDoc/pdf')`,
        ])
        {
            expect((await run(bad)).status, bad).not.toBe('success');
        }
    })

    /** Advanced wall component */
    it('Runs a script with a more complex component', async () =>
    {
        const runner = await new Runner().load()


        const componentCode = readFileSync('./tests/unit/runner/timberwall.js', 'utf-8')

        const component = Script.fromData({ name: 'timberwall', code: componentCode });
        runner.linkComponentScripts([component])

        
        const parentCode = `
                   wallFrontComponent = $component('timberwall',
                       { WIDTH: WIDTH, HEIGHT: 2000, DEPTH: THICKNESS,
                         OPENING: true, OPENING_LEFT: 500, OPENING_WIDTH: 600,
                         OPENING_HEIGHT: 1600, OPENING_SILL: 100 }
                      )
                    .all();

                   docs.create('parentDoc')
                       .page('main')
                       .text('Main page timber project')
                       .merge(wallFrontComponent.docs) // merge the component's doc pages
                `
        const result = await runner.execute({
            kernel: 'mesh',
            script: { code: parentCode },
            outputs: ['default/docs/*/svg'],
        })

        if(result.status !== 'success')
        {
            console.log('====================')
            console.error('Execution failed:', result.errors)
        }
        
        expect(result.status).toBe('success');
        const svg = result.outputs?.find(o => o.path.format === 'svg')
        expect(svg).toBeDefined();
        expect(svg!.output).toBeDefined();
        save('./tests/outputs/runner/runner.component.merged.docs.timberframe.svg', svg!.output as string)

    })
})
