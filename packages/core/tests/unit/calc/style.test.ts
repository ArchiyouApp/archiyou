/**
 * Table styles: the look of a spreadsheet table (header, column and cell fills, fonts,
 * number formats, widths) kept on a calc Table, through sort/rename, and into the xlsx export.
 */

import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'

import { Table } from '../../../src/calc/Table'
import { Calc } from '../../../src/calc/Calc'
import { formatNumber } from '../../../src/calc/numfmt'
import type { TableStyle } from '../../../src/calc/types'

const style:TableStyle = {
    header: { fill: '#1f4e78', color: '#ffffff', bold: true },
    columns: { price: { format: '#,##0.00', align: 'right', width: 105 } },
    cells: [null, { price: { fill: '#ffff00', bold: true } }],
}
/** Read the files of a zip (an .xlsx) as text, from its central directory */
function unzipText(buffer:ArrayBuffer):Record<string, string>
{
    const b = Buffer.from(buffer)
    const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const count = b.readUInt16LE(eocd + 10)
    const files:Record<string, string> = {}
    let p = b.readUInt32LE(eocd + 16)
    Array.from({ length: count }).forEach(() =>
    {
        const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20)
        const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32)
        const local = b.readUInt32LE(p + 42)
        const name = b.toString('utf8', p + 46, p + 46 + nameLen)
        const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
        const data = b.subarray(start, start + size)
        files[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
        p += 46 + nameLen + extraLen + commentLen
    })
    return files
}

const makeTable = () => new Table([{ part: 'leg', price: 12.5 }, { part: 'top', price: 1080 }]).style(style)

describe('formatNumber()', () =>
{
    it('formats decimals, thousands and percentages with the locale separators', () =>
    {
        expect(formatNumber(1234.567, '#,##0.00', 'en-US')).toBe('1,234.57')
        expect(formatNumber(1234.567, '#,##0.00', 'nl-NL')).toBe('1.234,57')
        expect(formatNumber(1234.567, '0', 'en-US')).toBe('1235')
        expect(formatNumber(0.256, '0.0%', 'en-US')).toBe('25.6%')
        expect(formatNumber(1500000, '#,##0,', 'en-US')).toBe('1,500')
    })

    it('keeps currency symbols and literal text', () =>
    {
        expect(formatNumber(1234.5, '"€ "#,##0.00', 'nl-NL')).toBe('€ 1.234,50')
        expect(formatNumber(1234.5, '[$€-413] #,##0.00', 'nl-NL')).toBe('€ 1.234,50')
        expect(formatNumber(12, '0" m²"', 'en-US')).toBe('12 m²')
        expect(formatNumber(-5, '#,##0;(#,##0)', 'en-US')).toBe('(5)')
        expect(formatNumber(-5, '#,##0;[Red]-#,##0', 'en-US')).toBe('-5')
        expect(formatNumber(-5, '#,##0', 'en-US')).toBe('-5')
    })

    it('formats date serials', () =>
    {
        expect(formatNumber(45292, 'dd-mm-yyyy')).toBe('01-01-2024')
        expect(formatNumber(45292.5, 'yyyy-mm-dd hh:mm')).toBe('2024-01-01 12:00')
        expect(formatNumber(45292, 'd mmm yyyy')).toBe('1 Jan 2024')
    })

    it('returns null for text, General, unknown formats and non-numbers', () =>
    {
        expect(formatNumber(5, 'General')).toBeNull()
        expect(formatNumber(5, '@')).toBeNull()
        expect(formatNumber(0.5, '# ?/?')).toBeNull()
        expect(formatNumber('a', '0.00')).toBeNull()
    })
})

describe('Table.style()', () =>
{
    it('gets, sets and clears the style and merges column and cell styles', () =>
    {
        const t = makeTable()
        expect(t.style()).toBe(style)
        expect(new Table([{ a: 1 }]).style({ locale: 'nl-NL' }).style()).toEqual({ locale: 'nl-NL' })
        expect(t.cellStyle(0, 'price')).toEqual({ format: '#,##0.00', align: 'right' })
        expect(t.cellStyle(1, 'price')).toEqual({ format: '#,##0.00', align: 'right', fill: '#ffff00', bold: true })
        expect(t.style({}).style()).toBeNull()
        expect(() => t.style({ nope: 1 } as any)).toThrow(/style/)
    })

    it('moves cell styles along when sorting and renames them with setColumns', () =>
    {
        const t = makeTable().sort('price', 'desc')
        expect(t.cellStyle(0, 'price').fill).toBe('#ffff00')
        t.setColumns(['part', 'cost'])
        expect(t.cellStyle(0, 'cost').fill).toBe('#ffff00')
        expect(t.style().columns.cost.width).toBe(105)
    })

    it('is picked up by calc.table() from rows that carry a style', () =>
    {
        const calc = new Calc()
        calc.setArchiyou({} as any)
        const rows = [{ part: 'leg', price: 12.5 }]
        Object.defineProperty(rows, 'style', { value: style, enumerable: false })
        expect((calc.table('parts', rows) as Table).style()).toBe(style)
    })

    it('exports to xlsx with fills, fonts, number formats and widths', async () =>
    {
        const files = unzipText(await makeTable().toExcel())
        const styles = files['xl/styles.xml']
        const sheet = files['xl/worksheets/sheet1.xml']
        expect(styles).toMatch(/1F4E78/i)
        expect(styles).toMatch(/FFFF00/i)
        expect(styles).toMatch(/FFFFFF/i)
        expect(styles).toContain('#,##0.00')
        expect(sheet).toMatch(/<col [^>]*width="15"/)
    })

    it('exports an unstyled table with just a bold header', async () =>
    {
        const files = unzipText(await new Table([{ a: 1 }]).toExcel())
        expect(files['xl/styles.xml']).toMatch(/<b\s*\/>/)
        expect(files['xl/worksheets/sheet1.xml']).not.toContain('<col ')
    })
})
