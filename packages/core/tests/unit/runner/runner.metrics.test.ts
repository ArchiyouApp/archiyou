import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'

/**
 * Metric outputs: 'default/metrics/*\/json' resolves to one output per metric, each holding
 * that metric only. A metric whose name is part of another's ('BALANCE' in 'BALANCE PER
 * HOUSE') must not come along with it, or the Metrics tool shows it twice.
 */
describe('Runner — metric outputs', () =>
{
    it('gives each metric once, also when one name is part of another', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `calc.metric('BALANCE', 10, {}); calc.metric('BALANCE PER HOUSE', 2, {}); calc.metric('HOUSES', 5, {});` },
            outputs: ['default/metrics/*/json'],
        } as any)

        expect(result.status).toBe('success')
        const metrics = (result.outputs ?? [])
            .filter((o: any) => o.path.category === 'metrics')
            .flatMap((o: any) => Object.values(o.output) as Array<{ name: string }>)
            .map(m => m.name)
        expect(metrics.sort()).toEqual(['BALANCE', 'BALANCE PER HOUSE', 'HOUSES'])
    })
})
