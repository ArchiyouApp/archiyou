import { describe, it, expect } from 'vitest'

import { Table } from '../../../src/calc/Table'

/** A valid `parts` table (columns match Make.partList + the parts schema). */
const makeParts = () => new Table(
    [
        ['A', 'leg',   'beam',  '40x40', 1000, 2],
        ['A', 'rail',  'beam',  '40x40', 2000, 1],
        ['B', 'panel', 'plate', '600x18', 500, 3],
    ],
).setColumns(['part', 'subpart', 'type', 'section', 'length', 'quantity'])

describe('calc.Table schema', () =>
{
    it('accepts the standard "parts" schema on valid rows', () =>
    {
        expect(() => makeParts().schema('parts')).not.toThrow()
    })

    it('throws on an unknown standard schema name, listing the known ones', () =>
    {
        expect(() => makeParts().schema('nope')).toThrow(/Unknown standard schema.*parts/)
    })

    it('throws when an existing row violates the schema (bad enum value)', () =>
    {
        const t = makeParts()
        t.toDataRows()[0].type = 'blob' // not 'beam' | 'plate'
        expect(() => t.schema('parts')).toThrow(/failed schema validation/)
    })

    it('validates rows added via addRow once a schema is set', () =>
    {
        const t = makeParts().schema('parts')
        expect(() => t.addRow({ part: 'C', subpart: 'x', type: 'beam', section: '20x20', length: 300, quantity: 1 })).not.toThrow()
        expect(t.numRows()).toBe(4)
        // missing required numeric `length` → reject
        expect(() => t.addRow({ part: 'D', type: 'plate', section: '10x10', quantity: 1 })).toThrow(/schema validation/)
        expect(t.numRows()).toBe(4) // unchanged
    })

    it('does not validate when no schema is set', () =>
    {
        const t = makeParts()
        expect(() => t.addRow({ anything: 123 })).not.toThrow()
    })
})

describe('calc.Table id / sort / group / append', () =>
{
    it('id() sets and gets the id column, and rejects unknown columns', () =>
    {
        const t = makeParts()
        expect(t.id('part')).toBe(t)          // chainable
        expect(t.id()).toBe('part')           // getter
        expect(() => t.id('missing')).toThrow(/No column 'missing'/)
    })

    it('sorts numerically by a column, ascending and descending', () =>
    {
        const asc = makeParts().sort('length')
        expect(asc.toDataColumn('length')).toEqual([500, 1000, 2000])

        const desc = makeParts().sort('length', 'desc')
        expect(desc.toDataColumn('length')).toEqual([2000, 1000, 500])
    })

    it('sorts by a custom comparator function', () =>
    {
        // by subpart string length
        const t = makeParts().sort((a, b) => String(a.subpart).length - String(b.subpart).length)
        expect(t.toDataColumn('subpart')).toEqual(['leg', 'rail', 'panel'])
    })

    it('groups by the id column: sums numbers, unique-joins strings', () =>
    {
        const t = makeParts().id('part').group()
        expect(t.numRows()).toBe(2) // groups A and B

        const a = t.toDataRows().find(r => r.part === 'A')
        expect(a.length).toBe(3000)          // 1000 + 2000
        expect(a.quantity).toBe(3)           // 2 + 1
        expect(a.subpart).toBe('leg, rail')  // unique strings joined
        expect(a.type).toBe('beam')          // both 'beam' → collapses to one
        expect(a.section).toBe('40x40')
    })

    it('groups by an explicit column argument', () =>
    {
        const t = makeParts().group('type')
        expect(t.numRows()).toBe(2) // beam, plate
        const beam = t.toDataRows().find(r => r.type === 'beam')
        expect(beam.length).toBe(3000)
    })

    it('throws when grouping with no column and no id set', () =>
    {
        expect(() => makeParts().group()).toThrow(/no id\(\) column set/)
    })

    it('appends rows from another table', () =>
    {
        const a = makeParts()
        const b = makeParts()
        a.append(b)
        expect(a.numRows()).toBe(6)
    })

    it('validates appended rows against the schema', () =>
    {
        const a = makeParts().schema('parts')
        const bad = new Table([['X', 'y', 'blob', '1x1', 10, 1]])
            .setColumns(['part', 'subpart', 'type', 'section', 'length', 'quantity'])
        expect(() => a.append(bad)).toThrow(/schema validation/)
        expect(a.numRows()).toBe(3) // first bad row aborts before push
    })
})
