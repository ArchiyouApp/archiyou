import { describe, it, expect } from 'vitest'

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult }
        from '../../../src/runner/types'
import { Runner } from '../../../src/runner/Runner'

const REQUEST: RunnerScriptExecutionRequest = {
    script: {
        code: `
            const t = calc.table('parts',
                [ { part: 'A', length: 100, quantity: 2 },
                  { part: 'B', length: 50,  quantity: 3 } ]);
            t.footer({ part: 'Total', length: 'sum', quantity: 'sum' });
        `
    },
    outputs: [
        'default/tables/*/json',
    ]
}

describe('Runner table footer output', () =>
{
    it('attaches computed footer rows to the json table output', async () =>
    {
        const runner = await new Runner().load()
        const result: RunnerScriptExecutionResult = await runner.execute(REQUEST)

        expect(result.status).toBe('success')

        const tableOutput = (result.outputs ?? []).find(o => o.path.category === 'tables')
        expect(tableOutput).toBeDefined()
        expect(Array.isArray(tableOutput!.output)).toBe(true)

        const footer = tableOutput!.footer ?? []
        expect(footer).toHaveLength(1)
        expect(footer[0].values.part).toBe('Total')
        expect(footer[0].values.length).toBe(150)   // sum 100 + 50
        expect(footer[0].values.quantity).toBe(5)   // sum 2 + 3
    })
})
