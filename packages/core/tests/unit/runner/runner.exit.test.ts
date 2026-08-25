import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult }
        from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import { SCRIPT_EXIT_WARNING } from '../../../src/runner/ScriptExit'

const TIMEOUT = 30000; // WASM kernel load

function req(code: string, perStatement = false): RunnerScriptExecutionRequest
{
    // 'warn' is what the editor asks for too (default result messages are 'user' only)
    return { script: { code }, perStatement, messages: ['user','warn','error'] } as RunnerScriptExecutionRequest;
}

function warnText(result: RunnerScriptExecutionResult): string
{
    return (result.messages ?? []).filter(m => m.type === 'warn').map(m => m.message).join('\n');
}

const CODE = `
    a = box(10,20,30);
    exit();
    b = sphere(10).move(100);
`;

describe('Runner exit()', () =>
{
    it('stops the script, keeps the partial model and warns', async () =>
    {
        const runner = await new Runner().load();
        const result = await runner.execute(req(CODE));

        expect(result.status).toBe('success');
        expect(result.meta?.numShapes).toBe(1); // sphere after exit() never ran
        expect(warnText(result)).toContain(SCRIPT_EXIT_WARNING);
    }, TIMEOUT)

    it('does the same in per-statement mode', async () =>
    {
        const runner = await new Runner().load();
        const result = await runner.execute(req(CODE, true));

        expect(result.status).toBe('success');
        expect(result.errors ?? []).toHaveLength(0);
        expect(result.meta?.numShapes).toBe(1);
        expect(warnText(result)).toContain(SCRIPT_EXIT_WARNING);
        // the statement after exit() is not reported as executed
        expect((result.statements ?? []).length).toBe(2);
    }, TIMEOUT)

    it('takes an optional message', async () =>
    {
        const runner = await new Runner().load();
        const result = await runner.execute(req(`a = box(10); exit('after the box');`));

        expect(result.status).toBe('success');
        expect(warnText(result)).toContain('after the box');
    }, TIMEOUT)
})
