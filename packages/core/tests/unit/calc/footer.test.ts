import { describe, it, expect } from 'vitest'

import { Table } from '../../../src/calc/Table'

const makeTable = () => new Table(
    [
        ['A', 'beam',  '40x10', 1000, 2],
        ['A', 'beam',  '40x10', 2000, 1],
        ['B', 'plate', '20x5',  500,  3],
    ],
).setColumns(['part', 'type', 'section', 'length', 'quantity'])

describe('calc.Table footer', () =>
{
    it('aggregates sum and average over the whole table as a single footer row', () =>
    {
        const t = makeTable().footer({ part: 'Total', length: 'sum', quantity: 'average' })
        const rows = t.computeFooterRows()

        expect(rows).toHaveLength(1)
        expect(rows[0].values.part).toBe('Total')          // literal label
        expect(rows[0].values.length).toBe(3500)           // sum 1000+2000+500
        expect(rows[0].values.quantity).toBe(2)            // average (2+1+3)/3
        expect(rows[0].values.type).toBe('')               // unspecified column blank
        expect(rows[0].line).toBe(true)                    // separating line by default
        expect(rows[0].bold).toBe(true)
    })

    it('supports a custom aggregation function with access to all group rows', () =>
    {
        const t = makeTable().footer({
            length: (_vals, groupRows) =>
                groupRows.reduce((s, r) => s + (Number(r.length) || 0) * (Number(r.quantity) || 0), 0),
        })
        const rows = t.computeFooterRows()
        // 1000*2 + 2000*1 + 500*3 = 5500
        expect(rows[0].values.length).toBe(5500)
    })

    it('produces one grouped subtotal row per unique group, with groupBy columns filled in', () =>
    {
        const t = makeTable().footer(
            {
                part: 'total per section',
                length: (_vals, groupRows) =>
                    groupRows.reduce((s, r) => s + (Number(r.length) || 0) * (Number(r.quantity) || 0), 0),
            },
            { groupBy: ['type', 'section'] },
        )
        const rows = t.computeFooterRows()

        expect(rows).toHaveLength(2) // beam 40x10, plate 20x5
        expect(rows[0].values).toMatchObject({ type: 'beam', section: '40x10', length: 1000 * 2 + 2000 * 1 })
        expect(rows[1].values).toMatchObject({ type: 'plate', section: '20x5', length: 500 * 3 })
        expect(rows[0].line).toBe(true)   // only first row of the block carries the line
        expect(rows[1].line).toBe(false)
    })

    it('stacks multiple footer() calls and can be cleared', () =>
    {
        const t = makeTable()
            .footer({ length: 'sum' })
            .footer({ quantity: 'sum' })
        expect(t.computeFooterRows()).toHaveLength(2)

        t.clearFooters()
        expect(t.computeFooterRows()).toHaveLength(0)
    })
})
