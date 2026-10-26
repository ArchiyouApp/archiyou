/**
 *  Every standard animation baked into a real model, written out to look at: open
 *  tests/outputs/cadscripts/test.workbench.animations.glb in Blender or a glTF viewer.
 */

import fs from 'node:fs'

import { describe, it, expect, beforeAll } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../src/runner/types'
import { Runner } from '../../src/runner/Runner'
import { createNodeIO } from '../../src/GLTFBuilder'
import { PRESET_KINDS } from '../../src/animator/Animator'

import { save } from '@archiyou/meshup/src/utils'

const TEST_OUTPUTS_PATH = './tests/outputs/cadscripts/'

describe('cadscripts - animations', () =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    })

    it('bakes the standard animations into the workbench', async () =>
    {
        const code = fs.readFileSync('./tests/cadscripts/scripts/workbench.js', 'utf8') + `
            swing = animator.create('swing').duration(3).loop('pingpong');
            swing.key(0, all(), {});
            swing.highlight(all().first(), 0.5, 2.5, 'orange');
            swing.turntable(120);
        `

        const result = await runner.execute({
            kernel: 'mesh',
            script: { name: 'workbench', code, params: {} },
            outputs: ['default/model/glb?animations=*'],
            messages: ['user', 'warn'],
        } as RunnerScriptExecutionRequest)

        expect(result.status, result.errors?.[0]?.message ?? '').toBe('success')

        const glb = result.outputs[0].output as Uint8Array
        save(TEST_OUTPUTS_PATH + 'test.workbench.animations.glb', glb)

        const doc = await createNodeIO().readBinary(glb)
        const names = doc.getRoot().listAnimations().map(a => a.getName())

        // the workbench has no instructable, so 'assembly' says so and is left out
        expect(names).toEqual(['swing', ...PRESET_KINDS.filter(k => k !== 'assembly')])
        expect(JSON.stringify(result.messages)).toContain('no instructable')
    })
})
