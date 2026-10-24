import { describe, it, expect } from 'vitest'

import { Runner } from '../../../src/runner/Runner'

/**
 * Table outputs carry the table's style next to its rows and footer, so the Data tool can
 * show a table the way its spreadsheet looks. Tables without a style have no style field.
 */
describe('Runner — table style output', () =>
{
    it('sends the style with the json table output', async () =>
    {
        const runner = await new Runner().load()
        const result = await runner.execute({
            script: { code: `
                calc.table('styled', [{ a: 1 }]).style({ header: { bold: true }, columns: { a: { format: '0.00' } } });
                calc.table('plain', [{ a: 1 }]);` },
            outputs: ['default/tables/*/json'],
        } as any)

        expect(result.status).toBe('success')
        const byName = Object.fromEntries((result.outputs ?? [])
            .filter((o: any) => o.path.category === 'tables')
            .map((o: any) => [o.path.entityName, o]))
        expect(byName.styled.style).toEqual({ header: { bold: true }, columns: { a: { format: '0.00' } } })
        expect(byName.plain.style).toBeUndefined()
    })
})
