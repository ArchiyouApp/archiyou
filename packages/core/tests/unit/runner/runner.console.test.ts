import { describe, it, expect, afterEach } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import { NATIVE_CONSOLE } from '../../../src/console/Console'

/**
 * Execution scopes install their own Console on globalThis for the duration of a run.
 * These guard the two ways that used to leak:
 *   - a Console binding globalThis.console (another Console) as its debug target, so
 *     instances chained into each other and every message cascaded down the chain
 *   - a component scope never handing globalThis.console back when it is deleted
 */

/** Length of the _originalConsole chain hanging off the installed global console */
function consoleChainDepth(c: any): number
{
    let d = 0
    let cur = c
    while (cur && cur._originalConsole && cur !== cur._originalConsole && d < 100)
    {
        d++
        cur = cur._originalConsole
    }
    return d
}

const COMPONENT = () => Script.fromData({
    name: 'loggingbox',
    code: `print('hello from component'); mybox = box(10, 10, 10);`,
})!

const PARENT = () => Script.fromData({
    name: 'parent',
    code: `imported = $component('./loggingbox').model();`,
})!

afterEach(() => { globalThis.console = NATIVE_CONSOLE })

describe('Runner console scope handling', () =>
{
    it('does not stack Consoles on globalThis across repeated component runs', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([COMPONENT()])
        const parent = PARENT()

        const depths: number[] = []
        for (let i = 0; i < 4; i++)
        {
            await runner.execute({ script: parent, params: {}, outputs: ['default/model/gltf'] } as any)
            depths.push(consoleChainDepth(globalThis.console))
        }

        // Every run should look like the first: one Console installed, echoing straight
        // to the native console. Previously this grew by 2 per run (2, 4, 6, 8...).
        expect(depths).toEqual([depths[0], depths[0], depths[0], depths[0]])
        expect(depths[0]).toBeLessThanOrEqual(1)
    }, 60000)

    it('hands globalThis.console back to the parent scope after a component run', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([COMPONENT()])

        await runner.execute({ script: PARENT(), params: {}, outputs: ['default/model/gltf'] } as any)

        // The component's Console must not still be installed globally: what is left on
        // globalThis has to be the MAIN scope's own Console, the one deleteLocalScope()
        // restores. (This used to compare a `_scopeName` field that does not exist on
        // Console, so it passed no matter which Console was installed.)
        expect(globalThis.console).toBe((runner.getScope('default') as any)?._archiyou?.console)
        expect(consoleChainDepth(globalThis.console)).toBeLessThanOrEqual(1)
    }, 60000)

    it('prints objects as data, not [object Object]', async () =>
    {
        const runner = await new Runner().load()

        const result: any = await runner.execute({
            script: Script.fromData({
                name: 'printing',
                code: `print({ width: 10, height: 100 }); print('size:', [1,2]); console.log({ a: 1 });`,
            })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user', 'info'],
        } as any)

        const msgs = (result.messages ?? []).map((m: any) => m.message)
        expect(msgs).toContain('{ width: 10, height: 100 }')
        expect(msgs).toContain('size: [ 1, 2 ]')
        expect(msgs).toContain('{ a: 1 }')
        expect(msgs.join('\n')).not.toContain('[object Object]')
    }, 60000)

    it("still surfaces a component's messages in the parent script's result", async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([COMPONENT()])

        const result: any = await runner.execute({
            script: PARENT(),
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user'],
        } as any)

        const msgs = (result.messages ?? []).map((m: any) => m.message).join('\n')
        expect(msgs).toContain('hello from component')
    }, 60000)
})
