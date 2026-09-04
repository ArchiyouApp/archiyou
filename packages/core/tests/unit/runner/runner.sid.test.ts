import { describe, it, expect, vi } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * Shape serial ids (`sid`) through a whole run.
 *
 * The point of a sid is that it is REPRODUCIBLE where the shape uuid is not: the same script
 * with the same params numbers its shapes identically on every re-run. The Modeler owns the
 * counter and reset() rebases it at the start of each run, so this is a property of the run,
 * not of the process.
 *
 * $component() is the interesting case. Each activation runs in a throwaway scope with its
 * OWN Modeler (and so its own counter), and its shapes are copied into the caller by
 * RunnerComponentImporter._copyComponentShape() — where they are adopted into the caller's
 * scene and earn sids in the caller's sequence. That has to hold whether the activation was
 * really executed or served from the memo, otherwise the cache would be observable.
 */

const BOX_COMPONENT = `mybox = box(10, 10, 10).color('blue');`

const run = (runner:Runner, code:string) => runner.execute({
    kernel: 'mesh',
    script: { code },
    outputs: ['default/model/internal'],
} as any)

/** Every sid in the main scope's scene, in scene order. */
const sidsOf = (runner:Runner):Array<number> =>
    (runner as any)._localScopes['default']._archiyou.modeler.all()
        .toArray().map((s:any) => s.sid())

describe('Runner: sid', () =>
{
    it('numbers a run\'s shapes from 1, in creation order', async () =>
    {
        const runner = await new Runner().load()

        const result = await run(runner, `
            a = box(10, 10, 10);
            b = circle(5);
            c = box(2, 2, 2);
        `)

        expect(result.status).not.toBe('error')
        expect(sidsOf(runner)).toEqual([1, 2, 3])
    })

    it('gives the same sids on a re-run of the same script', async () =>
    {
        const runner = await new Runner().load()
        const code = `
            a = box(10, 10, 10);
            b = circle(5);
            c = a.copy().move(50);
        `

        await run(runner, code)
        const first = sidsOf(runner)

        await run(runner, code)
        const second = sidsOf(runner)

        expect(first).toEqual(second)
        expect(first.length).toBeGreaterThan(0)
    })

    it('does not carry sids across runs — reset() rebases the sequence', async () =>
    {
        const runner = await new Runner().load()

        await run(runner, `a = box(10, 10, 10);`)
        await run(runner, `a = box(10, 10, 10);`)

        // Without the rebase in Modeler.reset() the second run would start at 2.
        expect(sidsOf(runner)).toEqual([1])
    })

    it('numbers component shapes in the CALLER\'s sequence, cached or not', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({ name: 'mybox', code: BOX_COMPONENT })!])
        const execSpy = vi.spyOn(runner as any, '_executeComponentScript')

        const code = `
            a = box(1, 1, 1);
            b = $component('./mybox').model();
            c = $component('./mybox').model();
        `

        const result = await run(runner, code)
        expect(result.status).not.toBe('error')

        // Second activation was a cache hit...
        expect(execSpy).toHaveBeenCalledTimes(1)
        // ...yet both component shapes are numbered in the caller's sequence, alongside `a`.
        const sids = sidsOf(runner)
        expect(sids).toEqual([1, 2, 3])
        expect(new Set(sids).size).toEqual(3) // no shape shares a sid
    })

    it('gives identical sids whether the component cache hits or misses', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({ name: 'mybox', code: BOX_COMPONENT })!])

        const code = `
            a = box(1, 1, 1);
            b = $component('./mybox').model();
            c = $component('./mybox').model();
        `

        await run(runner, code)
        const warm = sidsOf(runner)

        runner.clearComponentResultCache()
        await run(runner, code)
        const cold = sidsOf(runner)

        expect(warm).toEqual(cold)
    })
})
