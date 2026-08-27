import { describe, it, expect, vi } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * The component EXECUTION result cache (Runner._componentResults).
 *
 * $component() runs its script synchronously in a throwaway scope, once per call site, so
 * a wall repeated across a facade used to model once per repeat. These tests pin down when
 * the memo is used, when it must miss, and that a memoised tree hands every caller its own
 * shapes — a Shape can only live in one SceneNode, so sharing one would silently drop
 * geometry out of the scene.
 *
 * The probe throughout is a spy on Runner._executeComponentScript(): it counts the actual
 * sub-executions, which is the thing the cache exists to avoid.
 */

const BOX_COMPONENT = `mybox = box(10, 10, 10).color('blue');`

/** Runner with one linked component, and a spy counting real component executions. */
async function setup(code:string = BOX_COMPONENT)
{
    const runner = await new Runner().load()
    runner.linkComponentScripts([Script.fromData({ name: 'mybox', code })!])
    const execSpy = vi.spyOn(runner as any, '_executeComponentScript')
    return { runner, execSpy }
}

const run = (runner:Runner, code:string) => runner.execute({
    kernel: 'mesh',
    script: { code },
    outputs: ['default/model/internal'],
} as any)

describe('Runner: $component() execution result cache', () =>
{
    it('executes an identical component activation once, however often it is used', async () =>
    {
        const { runner, execSpy } = await setup()

        const result = await run(runner, `
            a = $component('./mybox').model();
            b = $component('./mybox').model();
            c = $component('./mybox').model();
        `)

        expect(result.status).not.toBe('error')
        expect(execSpy).toHaveBeenCalledTimes(1)
    })

    it('gives every caller its own Shape instance, not one shared object', async () =>
    {
        const { runner } = await setup()

        const result = await run(runner, `
            a = $component('./mybox').model();
            b = $component('./mybox').model();
        `)

        // Both nodes report a shape either way — without the copy they report the SAME one,
        // which is why identity, not the count, is what this has to assert.
        expect(result.meta?.numShapes).toBe(2)
        const ids = (runner as any)._localScopes['default']._archiyou.modeler.all()
                        .toArray().map((s:any) => s.id())
        expect(new Set(ids).size).toBe(2)
    })

    it('keeps the cached original pristine when the caller mutates its copy', async () =>
    {
        const { runner } = await setup()

        const result = await run(runner, `
            a = $component('./mybox').model();
            b = $component('./mybox').model();
            a.move(1000, 0, 0);
        `)

        // Both boxes are box(10,10,10) at the origin; moving only 'a' must leave 'b' behind.
        const [minX, , , maxX] = result.meta!.bbox as Array<number>
        expect(minX).toBeCloseTo(-5, 3)
        expect(maxX).toBeCloseTo(1005, 3)
    })

    /* On BREP, not mesh, and deliberately: the kernels disagree about what `_copy()` carries.
       meshup's clones the shape's own style, brep's returns it empty — so a cached brep
       component would come back colourless if _copyComponentShape() did not restore it. */
    it('carries the component shape style across the copy (brep loses it on _copy)', async () =>
    {
        const { runner } = await setup()

        const result = await runner.execute({
            kernel: 'brep',
            script: { code: `
                a = $component('./mybox').model();
                b = $component('./mybox').model();
            ` },
            outputs: ['default/model/internal'],
        } as any)
        expect(result.status).not.toBe('error')

        const shapes = (runner as any)._localScopes['default']._archiyou.modeler.all().toArray()
        expect(shapes.length).toBe(2)
        shapes.forEach((s:any) => expect(s.style?.explicitData()?.color).toBe('#0000ff'))
    }, 120000)

    it('misses on different params', async () =>
    {
        const { runner, execSpy } = await setup(`mybox = box($size, 10, 10);`)

        await run(runner, `
            a = $component('./mybox').params({ size: 10 }).model();
            b = $component('./mybox').params({ size: 20 }).model();
            c = $component('./mybox').params({ size: 10 }).model();
        `)

        expect(execSpy).toHaveBeenCalledTimes(2) // size 10 memoised, size 20 is its own entry
    })

    it('hits across runs, and misses once the component code changes', async () =>
    {
        const { runner, execSpy } = await setup()
        const parent = `a = $component('./mybox').model();`

        await run(runner, parent)
        expect(execSpy).toHaveBeenCalledTimes(1)

        await run(runner, parent) // same code, same params: served from the memo
        expect(execSpy).toHaveBeenCalledTimes(1)

        // The editor's re-link with edited component code must invalidate by itself.
        runner.linkComponentScripts([Script.fromData({ name: 'mybox', code: `mybox = box(99, 99, 99);` })!])
        await run(runner, parent)
        expect(execSpy).toHaveBeenCalledTimes(2)
    })
})

describe('Runner: $component().noCache()', () =>
{
    it('executes every time it is used', async () =>
    {
        const { runner, execSpy } = await setup()

        await run(runner, `
            a = $component('./mybox').noCache().model();
            b = $component('./mybox').noCache().model();
        `)

        expect(execSpy).toHaveBeenCalledTimes(2)
    })

    it('also RESETS, so the next ordinary call re-executes instead of serving the bypassed memo', async () =>
    {
        const { runner, execSpy } = await setup()

        await run(runner, `a = $component('./mybox').model();`)          // memoise
        expect(execSpy).toHaveBeenCalledTimes(1)
        expect(runner.componentResultCacheSize).toBe(1)

        await run(runner, `a = $component('./mybox').noCache().model();`) // bypass + drop
        expect(execSpy).toHaveBeenCalledTimes(2)
        expect(runner.componentResultCacheSize).toBe(0)

        await run(runner, `a = $component('./mybox').model();`)           // nothing left to serve
        expect(execSpy).toHaveBeenCalledTimes(3)
    })

    it('can be chained in any order', async () =>
    {
        const { runner, execSpy } = await setup(`mybox = box($size, 10, 10);`)

        await run(runner, `
            a = $component('./mybox').noCache().params({ size: 10 }).model();
            b = $component('./mybox').params({ size: 10 }).noCache().model();
        `)

        expect(execSpy).toHaveBeenCalledTimes(2)
    })
})

describe('Runner: component result cache bookkeeping', () =>
{
    it('hashes params independently of key order', async () =>
    {
        const runner = await new Runner().load()
        const script = Script.fromData({ name: 'x', code: `box(1,1,1);` })!

        const key = (params:Record<string,any>) => runner._componentResultCacheKey(script, {
            component: './x', kernel: 'mesh', params, outputs: ['default/model/internal'],
        } as any)

        expect(key({ w: 1, h: 2 })).toBe(key({ h: 2, w: 1 }))
        expect(key({ w: 1, h: 2 })).not.toBe(key({ w: 2, h: 1 }))
    })

    it('never memoises a failed execution', async () =>
    {
        const runner = await new Runner().load()

        runner.addComponentResultToCache('k', { status: 'error', errors: [] } as any)
        expect(runner.componentResultCacheSize).toBe(0)

        runner.addComponentResultToCache('k', { status: 'success', outputs: [] } as any)
        expect(runner.componentResultCacheSize).toBe(1)
    })

    it('clearComponentResultCache() drops one entry or all of them', async () =>
    {
        const runner = await new Runner().load()
        runner.addComponentResultToCache('a', { status: 'success' } as any)
        runner.addComponentResultToCache('b', { status: 'success' } as any)

        runner.clearComponentResultCache('a')
        expect(runner.componentResultCacheSize).toBe(1)
        expect(runner.getComponentResultFromCache('a')).toBeNull()

        runner.clearComponentResultCache()
        expect(runner.componentResultCacheSize).toBe(0)
    })
})
