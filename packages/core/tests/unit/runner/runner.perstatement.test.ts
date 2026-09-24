import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult }
        from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'
import type { SceneNodeData } from '../../../src/modeler/types'

const TIMEOUT = 30000; // WASM kernel load

function req(code: string, perStatement = true): RunnerScriptExecutionRequest
{
    return { script: { code }, perStatement } as RunnerScriptExecutionRequest;
}

/** Collect all `print()` user messages from a result into one string. */
function userText(result: RunnerScriptExecutionResult): string
{
    return (result.messages ?? []).filter(m => m.type === 'user').map(m => m.message).join('\n');
}

describe('Runner per-statement mode', () =>
{
    it('parity: same model as whole-script mode', async () =>
    {
        const code = `
            a = box(10,20,30);
            b = sphere(10).move(40);
            c = cylinder(5, 20).move(-40);
        `;
        const runner = await new Runner().load();
        const whole = await runner.execute(req(code, false));
        const perStmt = await runner.execute(req(code, true));

        expect(whole.status).toBe('success');
        expect(perStmt.status).toBe('success');
        expect(perStmt.meta?.numShapes).toBe(whole.meta?.numShapes);
        expect(perStmt.meta?.bbox).toEqual(whole.meta?.bbox);
    }, TIMEOUT)

    it('parses modern syntax that ecmaVersion 6 rejected', async () =>
    {
        const code = `
            base = { w: 10, h: 20 };
            spread = { ...base, d: 30 };
            picked = spread?.w ?? 99;
            powered = 2 ** 3;
            delayed = await picked;
            b = box(spread.w, spread.h, spread.d);
            print('picked=' + picked + ' powered=' + powered + ' delayed=' + delayed);
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('success');
        expect(userText(result)).toContain('picked=10 powered=8 delayed=10');
    }, TIMEOUT)

    it('does not corrupt string literals containing let/const/var', async () =>
    {
        const code = `print('let me tell you about const values and var names');`;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('success');
        expect(userText(result)).toContain('let me tell you about const values and var names');
    }, TIMEOUT)

    it('keeps nested declarations local (does not leak into scope)', async () =>
    {
        const code = `
            helper = () => { const secret = 42; return secret; };
            r = helper();
            print('r=' + r + ' secretType=' + (typeof secret));
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('success');
        // r resolves to 42; secret must NOT have leaked into the shared scope.
        expect(userText(result)).toContain('r=42 secretType=undefined');
    }, TIMEOUT)

    it('hoists top-level function/class declarations (usable before definition)', async () =>
    {
        const code = `
            doubled = twice(5);
            made = new Maker(7).value();
            print('doubled=' + doubled + ' made=' + made);
            function twice(n){ return n * 2; }
            class Maker { constructor(n){ this.n = n; } value(){ return this.n + 1; } }
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('success');
        expect(userText(result)).toContain('doubled=10 made=8');
    }, TIMEOUT)

    it('halts on error but keeps the partial model', async () =>
    {
        const code = `
            a = box(10,10,10);
            b = box(20,20,20).move(50);
            c = nonExistentFunction(1);
            d = box(5,5,5).move(100);
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('error');
        expect(result.errors?.length).toBe(1);
        // Error anchored to statement c (line 4 counting the leading newline as line 1).
        expect(result.errors?.[0].lineStart).toBe(4);
        // a and b were built; c failed; d never ran → 2 shapes survive.
        expect(result.meta?.numShapes).toBe(2);
    }, TIMEOUT)

    it('reports per-statement profiling for every statement', async () =>
    {
        const code = `
            a = box(10,10,10);
            b = sphere(8).move(30);
            c = cylinder(4, 16).move(-30);
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        expect(result.status).toBe('success');
        expect(result.statements?.length).toBe(3);
        expect(result.statements?.every(s => s.status === 'success')).toBe(true);
        expect(result.statements?.every(s => typeof s.duration === 'number')).toBe(true);
        const totalPerc = (result.statements ?? []).reduce((sum, s) => sum + (s.durationPerc ?? 0), 0);
        expect(totalPerc).toBeGreaterThanOrEqual(98);
        expect(totalPerc).toBeLessThanOrEqual(102);
    }, TIMEOUT)

    it('records which serial ids each statement added to the scene', async () =>
    {
        const code = `
            a = box(10,10,10);
            n = 3;
            for(let i = 0; i < n; i++)
            {
                sphere(4).move(20*i, 40);
            }
            b = a.copy().move(0, -40);
            c = [box(5), notDefined()];
        `;
        const runner = await new Runner().load();
        const result = await runner.execute(req(code));

        // The last statement fails halfway, after its box entered the scene
        expect(result.status).toBe('error');
        const ranges = (result.statements ?? []).map(s => [s.lineStart, s.sidFirst, s.sidLast]);
        expect(ranges).toEqual([
            [2, 1, 1],                  // a
            [3, undefined, undefined],  // n: no shapes
            [4, 2, 4],                  // the loop, lines 4-7
            [8, 5, 5],                  // b
            [9, 6, 6],                  // c: the box made before the error
        ]);

        // Every shape in the scenegraph falls in the range of exactly one statement
        const sids = (node: SceneNodeData): Array<number> =>
            [...(node.sid ? [node.sid] : []), ...node.children.flatMap(sids)];
        const sceneSids = sids(result.state.scenegraph as SceneNodeData);
        expect(sceneSids.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
        sceneSids.forEach(sid =>
        {
            const owners = (result.statements ?? []).filter(s => s.sidFirst !== undefined && s.sidFirst <= sid && sid <= s.sidLast!);
            expect(owners.length).toBe(1);
        });
    }, TIMEOUT)
})
