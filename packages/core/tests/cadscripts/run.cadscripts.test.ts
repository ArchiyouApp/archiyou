import fs from 'node:fs'

import { describe, it, expect, beforeAll } from 'vitest'

import type { RunnerScriptExecutionRequest } from '../../src/runner/types'
import { Runner } from '../../src/runner/Runner'

import { save } from '@archiyou/meshup/src/utils';

//// SETTINGS ////

const TEST_OUTPUTS_PATH = './tests/outputs/cadscripts/' // keep generated models out of the package root
const MAX = undefined; // use for step by step testing - undefined for all
const ONLY = process.env.CADSCRIPT; // run a single script by filename (without .js)

////

const SCRIPTS = fs.readdirSync('./tests/cadscripts/scripts')
                    .filter(f => f.endsWith('.js'))
                    .filter(f => !ONLY || f === ONLY || f === `${ONLY}.js`)
                    .slice(0,MAX)
const KERNEL = 'mesh' // default kernel for all tests, can be set per test in request


describe('cadscripts - mesh mode', () =>
{
    let runner: Runner

    beforeAll(async () =>
    {
        runner = await new Runner().load()
    })


    // Scripts are modules that can be dynamically loaded
    SCRIPTS.forEach((filename) =>
    {
        it(`runs "${filename}"`, async () =>
        {
            // Scripts are plain JS files: the code itself, with params declared
            // inline via $PARAMS.define() - no metadata wrapper
            const code = fs.readFileSync('./tests/cadscripts/scripts/' + filename, 'utf8');

            const request: RunnerScriptExecutionRequest = {
                kernel: 'mesh',
                script: { name: filename.replace('.js',''), code, params: {} },
                outputs: ['default/model/gltf'],
            }
            
            const result = await runner.execute(request)
            if (result.status !== 'success')
            {
                console.log(`!!!! ${filename}: ${JSON.stringify(result.errors?.[0])}`)
            }
            expect(result.status, `${filename}: ${result.errors?.[0]?.message ?? ''}`).toBe('success')
            expect(result.outputs[0].path.resolvedPath).toBe('default/model/gltf');

            save(TEST_OUTPUTS_PATH + 'test.' + filename.replace('.js','.gltf'), result.outputs[0].output as Uint8Array);
            
        })
    })
})
