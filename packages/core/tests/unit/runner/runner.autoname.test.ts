import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionResult } from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

/**
 * Auto-naming: a shape assigned to a variable takes that variable's name,
 * e.g. `myTopBox = box(10,10,10)` behaves like `.name('myTopBox')`.
 * Explicit and earlier names always win.
 */
describe('Runner — auto-name shapes from variable name', () =>
{
    it('names a single shape after its variable', async () =>
    {
        const runner = await new Runner().load()
        const result: RunnerScriptExecutionResult = await runner.execute({
            script: { code: `myTopBox = box(10,10,10);` },
            outputs: ['default/model/glb'],
        } as any)

        expect(result.status).toBe('success')

        const scope = runner.getActiveScope() as any
        expect(scope.myTopBox).toBeDefined()
        expect(scope.myTopBox.name()).toBe('myTopBox')
    })

    it('does not overwrite an explicit .name()', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({
            script: { code: `explicit = box(1,1,1).name('foo');` },
            outputs: ['default/model/glb'],
        } as any)

        const scope = runner.getActiveScope() as any
        expect(scope.explicit.name()).toBe('foo')
    })

    it('keeps the first name when the same shape is re-assigned to another variable', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({
            script: { code: `first = box(2,2,2); second = first;` },
            outputs: ['default/model/glb'],
        } as any)

        const scope = runner.getActiveScope() as any
        // both refer to the same shape, named on the first assignment
        expect(scope.first.name()).toBe('first')
        expect(scope.second.name()).toBe('first')
    })

    it('renames a copy after the variable it is assigned to', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({
            // copy() inherits the source name; assigning to a fresh variable
            // must re-name it, even through a chained transform like mirrorX.
            script: { code: `rafterLeft = box(1,1,1); rafterRight = rafterLeft.copy().mirrorX(0);` },
            outputs: ['default/model/glb'],
        } as any)

        const scope = runner.getActiveScope() as any
        expect(scope.rafterLeft.name()).toBe('rafterLeft')
        expect(scope.rafterRight.name()).toBe('rafterRight')
    })

    it('keeps an explicit .name() on a copy', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({
            script: { code: `src = box(1,1,1); dup = src.copy().name('explicit');` },
            outputs: ['default/model/glb'],
        } as any)

        const scope = runner.getActiveScope() as any
        expect(scope.dup.name()).toBe('explicit')
    })

    it('names a collection after its variable (instead of the default "collection")', async () =>
    {
        const runner = await new Runner().load()
        await runner.execute({
            script: { code: `parts = collection(box(1,1,1), box(2,2,2));` },
            outputs: ['default/model/glb'],
        } as any)

        const scope = runner.getActiveScope() as any
        expect(scope.parts?.isShapeCollection?.()).toBe(true)
        expect(scope.parts._name).toBe('parts')
    })
})
