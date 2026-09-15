import { describe, it, expect, vi } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * $component(...).info(): prints the component's param definitions to the user console.
 * Params defined in code with $PARAMS.define only exist while the component runs, so those
 * have to come back from the component's execution result.
 */

const WALL_COMPONENT = `
$PARAMS.define('ANGLE', 'number', { group: "extra", order: 0, default: 0 });
$PARAMS.define('WIDTH', 'number', { group: "main", order: 0, default: 3000, minimum: 2000, maximum: 8000, multipleOf: 1 });
$PARAMS.define('HEIGHT', 'number', { group: "main", order: 1, default: 2700 });
box($WIDTH, 100, $HEIGHT);
`

async function setup()
{
    const runner = await new Runner().load()
    runner.linkComponentScripts([Script.fromData({ name: 'wall', code: WALL_COMPONENT })!])
    const execSpy = vi.spyOn(runner as any, '_executeComponentScript')
    return { runner, execSpy }
}

const run = (runner:Runner, code:string) => runner.execute({
    kernel: 'mesh',
    script: { code },
    outputs: ['default/model/internal'],
    messages: ['user'],
} as any)

const userMessages = (result:any) => (result.messages ?? []).map((m:any) => m.message).join('\n')

describe('Runner: $component().info()', () =>
{
    it('prints params defined in component code, with given values and bounds', async () =>
    {
        const { runner } = await setup()

        const result = await run(runner, `$component('./wall', { WIDTH: 4000, COLOR: 'red' }).info();`)

        expect(result.status).not.toBe('error')
        const msg = userMessages(result)
        expect(msg).toContain('params (3)')
        expect(msg.indexOf('[main]')).toBeLessThan(msg.indexOf('[extra]'))
        expect(msg).toContain('WIDTH (number) = 4000 (default: 3000)')
        expect(msg).toContain('2000..8000 step 1')
        expect(msg).toContain('HEIGHT (number) = 2700 (default)')
        expect(msg).toMatch(/not defined by component.*COLOR/)
    })

    it('is chainable and shares the memoised execution with model()', async () =>
    {
        const { runner, execSpy } = await setup()

        const result = await run(runner, `wall = $component('./wall').info().model();`)

        expect(result.status).not.toBe('error')
        expect(result.meta?.numShapes).toBe(1)
        expect(execSpy).toHaveBeenCalledTimes(1)
    })
})

describe('Runner: $component() model placement', () =>
{
    it('adds the component model to the active layer of the calling script', async () =>
    {
        const { runner } = await setup()

        const result = await run(runner, `
            layer('walls');
            wall = $component('./wall').model();
        `)

        expect(result.status).not.toBe('error')
        const modeler = (runner as any)._localScopes['default']._archiyou.modeler
        expect(modeler.layer('walls').shapes().length).toBe(1)
    })
})
