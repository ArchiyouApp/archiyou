import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'

/**
 * $component() and $component().list(): print and return the names usable in $component('name') -
 * the linked (workspace) scripts. Without a name, $component() must not be treated as
 * a missing component by the prefetch.
 */

const run = (runner:Runner, code:string) => runner.execute({
    kernel: 'mesh',
    script: { code },
    outputs: ['default/model/internal'],
    messages: ['user'],
} as any)

const userMessages = (result:any) => (result.messages ?? []).map((m:any) => m.message).join('\n')

describe('Runner: $component().list()', () =>
{
    it('lists the linked component names, sorted', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([
            Script.fromData({ name: 'wall', code: 'box(100);' })!,
            Script.fromData({ name: 'Door', code: 'box(50);' })!,
        ])

        const result = await run(runner, `names = $component().list(); box(names.length);`)

        expect(result.status).not.toBe('error')
        expect(runner.listComponentNames()).toEqual(['door', 'wall'])
        const msg = userMessages(result)
        expect(msg).toContain('2 available component(s)')
        expect(msg.indexOf('door')).toBeLessThan(msg.indexOf('wall'))
    })

    it('lists them when $component() is called without a name, once', async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([Script.fromData({ name: 'wall', code: 'box(100);' })!])

        const plain = await run(runner, `$component();`)
        expect(plain.status).not.toBe('error')
        expect(userMessages(plain)).toContain('1 available component(s)')

        const chained = await run(runner, `$component().list();`)
        expect(userMessages(chained).match(/available component/g)).toHaveLength(1)
    })

    it('says so when there are no components', async () =>
    {
        const runner = await new Runner().load()

        const result = await run(runner, `$component().list();`)

        expect(result.status).not.toBe('error')
        expect(userMessages(result)).toContain('no components available')
    })
})
