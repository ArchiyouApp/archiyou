import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } 
        from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

import { save } from '@archiyou/meshup/src/utils'

//// TEST REQUEST ////

const REQUEST: RunnerScriptExecutionRequest = {
    script: {
        code: `
            r = rect(300, 200).color('blue');
            b = box(10,20,30).color('red');
            c = circle(10).color('green');
            s = sphere(10).color('yellow');
            bb = box(10,20,30).color('red')

            calc.table('test',
                [ { col1: 1, col2: 'row1'},{ col1: 2, col2: 'row2'}])

            docs.page('test')
                .text('Hello Archiyou!')
                .pivot(0,0)
                .position(0.5,0.5);
        `
    },
    outputs: [
        // {{pipeline}}/{{entity}}/{{format}}{{?options}}
        'default/model/glb',
        'default/tables/*/json',
        // 'default/docs/*/pdf', // PDF not working yet
    ]
}

describe('Runner', () =>
{
    it('loads successfully', async () =>
    {
        const runner = await new Runner().load();
        expect(runner).toBeInstanceOf(Runner);
    })


    it('executes script and returns success result', async () =>
    {
        const runner = await new Runner().load()
        const result: RunnerScriptExecutionResult = await runner.execute(REQUEST)

        expect(result).toBeDefined()
        expect(result.status).toBe('success')
    })

    it('returns outputs for all requested paths', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute(REQUEST)

        expect(result.status).toBe('success')
        expect(result.outputs).toBeDefined()
        expect(result.outputs!.length).toBeGreaterThan(0)

        for (const output of result.outputs!)
        {
            console.log(`==== Output: ${output.path.resolvedPath} ====`)
            console.log('  type:', typeof output.output)
            console.log('  category:', output.path.category)
            console.log('  format:', output.path.format)
        }
    })

    it('returns a GLB model output', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute(REQUEST)

        expect(result.status).toBe('success')

        const glbOutput = result.outputs?.find(o => o.path.format === 'glb')
        expect(glbOutput).toBeDefined()
        expect(glbOutput!.output).toBeDefined()

        // For debugging: save the GLB output to a file
        console.log('==== GLB Output ====');
        console.log(glbOutput.output);
        await save('./tests/outputs/runner/runner.test.glb', glbOutput!.output as ArrayBuffer);

    })

    it('returns table output as JSON', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute(REQUEST)

        expect(result.status).toBe('success')

        const tableOutput = result.outputs?.find(o => o.path.category === 'tables')
        expect(tableOutput).toBeDefined()
    })

})

// ── Error line extraction tests ───────────────────────────────────────────────
// These tests calibrate and verify that Runner correctly maps eval stack-trace
// line numbers back to the original user-script line numbers.
// If a test fails with the wrong line, adjust CORRECT_LINES_FOR_EVAL_WRAP in
// Runner._extractScriptContextFromErrorStack accordingly.

describe('Runner error line extraction', () =>
{
    // Helper: run a snippet and return the first error entry
    async function runAndGetError(code: string)
    {
        const runner = await new Runner().load()
        const result = await runner.execute({ script: { code }, outputs: ['default/model/glb'] })
        expect(result.status).toBe('error')
        expect(result.errors).toBeDefined()
        expect(result.errors!.length).toBeGreaterThan(0)
        const err = result.errors![0]
        console.log(`[error line test] lineStart=${err.lineStart}  message=${err.message?.slice(0, 80)}`)
        return err
    }

    it('reports line 1 for an error on the first line of the script', async () =>
    {
        // The only line is line 1 — error must land on line 1
        const code = `notAFunction()`
        const err = await runAndGetError(code)
        expect(err.lineStart).toBe(1)
    })

    it('reports line 5 for an error on line 5', async () =>
    {
        const code = [
            `a = 1`,
            `b = 2`,
            `c = 3`,
            `d = 4`,
            `notAFunction()`,   // line 5
        ].join('\n')
        const err = await runAndGetError(code)
        expect(err.lineStart).toBe(5)
    })

    it('reports line 10 for an error on line 10', async () =>
    {
        const code = [
            `a = 1`,
            `b = 2`,
            `c = 3`,
            `d = 4`,
            `e = 5`,
            `f = 6`,
            `g = 7`,
            `h = 8`,
            `i = 9`,
            `notAFunction()`,   // line 10
        ].join('\n')
        const err = await runAndGetError(code)
        expect(err.lineStart).toBe(10)
    })

    it('reports the correct line when valid code precedes the error', async () =>
    {
        // box() is valid; the error is on line 3
        const code = [
            `b = box(10, 20, 30)`,
            `b.move(5, 0, 0)`,
            `notAValidCall()`,  // line 3
        ].join('\n')
        const err = await runAndGetError(code)
        expect(err.lineStart).toBe(3)
    })

    it('reports the correct line for a null property access error', async () =>
    {
        // null.method() throws a TypeError — the Proxy does NOT swallow this
        // because it only intercepts identifier lookups, not property access on null.
        const code = [
            `x = 1`,
            `null.method()`,  // line 2 — TypeError: Cannot read properties of null
        ].join('\n')
        const err = await runAndGetError(code)
        expect(err.lineStart).toBe(2)
    })
})

describe('Runner request params', () =>
{
    it('preserves explicit param values instead of collapsing back to defaults', async () =>
    {
        const runner = new Runner()
        const request = {
            kernel: 'mesh',
            script: {
                code: `box($SIZE, 50, 100)`,
                params: {
                    SIZE: {
                        name: 'SIZE',
                        type: 'number',
                        default: 50,
                    },
                    ENABLED: {
                        name: 'ENABLED',
                        type: 'boolean',
                        default: true,
                    },
                },
            },
            params: {
                SIZE: 80,
                ENABLED: false,
            },
            outputs: ['default/model/glb'],
        } as any

        const normalized = runner._checkRequestParams(request)

        expect(normalized.params.SIZE).toBe(80)
        expect(normalized.params.ENABLED).toBe(false)
        expect(normalized.script.params.SIZE._value).toBe(80)
        expect(normalized.script.params.ENABLED._value).toBe(false)
    })
})
