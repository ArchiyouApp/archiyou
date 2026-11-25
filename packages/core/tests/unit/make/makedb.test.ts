import { describe, it, expect } from 'vitest'
import { MakeDb, validateSnapshot, snapshotFromTables, nextVersion, compareVersions, type MakeDbSnapshot } from '../../../src/make/db'
import { scanContentNeeds, makeDbNeeds } from '../../../src/modules/contentNeeds'
import { Runner } from '../../../src/runner/Runner'

/** A snapshot as a sync makes it: the tables as rows with their header first */
function snapshot(overrides: Partial<MakeDbSnapshot> = {}): MakeDbSnapshot
{
    const s = snapshotFromTables({
        version: '2026-11-24.1',
        date: new Date('2026-11-24T14:00:00Z'),
        source: { sheet: '1o0_OGFKAh9f3Sh6FlVx7JYNoDmSopAzd9U0akVJHGzw', title: 'URBUILD_DATABASE_CORE' },
        tables: {
            materialen: [
                ['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'],
                ['naaldhout_constructief', 'Naaldhout C24', 'constructiehout', 450, 0.13],
                ['', '', '', '', ''],
            ],
            producten: [
                ['productgroep', 'product_id', 'vorm', 'materiaal', 'dikte', 'breedte', 'hoogte', 'lengte'],
                ['SLS', 'sls-38x235', 'balk', 'naaldhout_constructief', '', 38, 235, 5400],
            ],
            bewerkingen: [
                ['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'],
                ['afkorten', 'voorbewerking', 'st', 90, 1.5],
                ['', 'Toelichting: wat is een bewerking?'],
            ],
            componenten: [
                ['component', 'fase', 'product', 'bewerking', 'per', 'factor'],
                ['hsbwand', '', '', '', '', ''],
                ['hsbwand', 'materiaal', 'sls-38x235', '', '', ''],
            ],
        },
        settings: { 'settings.rate_labor': 40, 'outputs.marges.materiaal': 10, 'outputs.marges.arbeid': 20, 'outputs.marges.algemeen': 5, 'settings.waste': [['balk', 0.1]] },
    })
    return { ...s, ...overrides }
}

describe('make/db: the snapshot of the product sheet', () =>
{
    it('is made from the tables as the sync reads them: records by header, blank rows gone', () =>
    {
        const s = snapshot()
        expect(s.format).toBe(1)
        expect(s.date).toBe('2026-11-24T14:00:00.000Z')
        expect(s.tables.materialen).toEqual([{ materiaal_id: 'naaldhout_constructief', naam: 'Naaldhout C24', toepassing: 'constructiehout',
            'dichtheid (kg/m3)': 450, 'warmtegeleidingscoëfficiënt λ (W/(m·K))': 0.13 }])
        expect(s.tables.producten[0]!['product_id']).toBe('sls-38x235')
        expect(validateSnapshot(s)).toEqual([{ level: 'warning', at: 'bewerkingen:row 2', message: 'no naam: a note, not read' }])
    })

    it('reports every problem: errors that make it unusable, warnings to look at', () =>
    {
        const s = snapshot()
        s.tables.producten.push({ ...s.tables.producten[0]!, breedte: 'veertig' }, { productgroep: 'SLS', product_id: '', vorm: 'balk', materiaal: 'x' })
        s.tables.bewerkingen = []
        s.settings = { ...s.settings, 'settings.rate_labor': 'veertig' }
        const issues = validateSnapshot({ ...s, version: '24-11-2026' })
        expect(issues.filter(i => i.level === 'error').map(i => `${i.at}: ${i.message}`)).toEqual([
            'version: "24-11-2026" is not a version like 2026-11-24.1',
            'producten:sls-38x235: product_id "sls-38x235" also on row 1',
            'bewerkingen: missing or empty',
            'settings.rate_labor: missing, or not a number',
        ])
        expect(issues.filter(i => i.level === 'warning').map(i => `${i.at}: ${i.message}`)).toEqual([
            'producten:sls-38x235: breedte "veertig" is not a number', 'producten:row 3: no product_id: a note, not read'])
        expect(validateSnapshot({ ...snapshot(), tables: { ...snapshot().tables, producten: [{ product_id: 'a' }] } })[0]!.message)
            .toBe('no column "productgroep", "vorm", "materiaal"')
    })

    it('numbers its versions per day, and orders them as numbers', () =>
    {
        const day = new Date('2026-11-24T09:00:00Z')
        expect(nextVersion(day)).toBe('2026-11-24.1')
        expect(nextVersion(day, ['2026-11-23.4', '2026-11-24.1', '2026-11-24.9'])).toBe('2026-11-24.10')
        expect(['2026-11-24.10', '2026-11-24.2', '2026-11-23.7'].sort(compareVersions)).toEqual(['2026-11-23.7', '2026-11-24.2', '2026-11-24.10'])
    })

    it('MakeDb refuses a snapshot with errors, naming them, and keeps the warnings', () =>
    {
        const db = MakeDb.fromJSON(JSON.stringify(snapshot()))
        expect(db.version).toBe('2026-11-24.1')
        expect(db.setting('settings.rate_labor')).toBe(40)
        expect(db.table('producten')).toHaveLength(1)
        // a note under a table (bewerkingen ends with one) is in the snapshot, not in the table
        expect(db.snapshot.tables.bewerkingen).toHaveLength(2)
        expect(db.table('bewerkingen').map(r => r['naam'])).toEqual(['afkorten'])
        expect(db.issues.map(i => i.at)).toEqual(['bewerkingen:row 2'])
        expect(String(db)).toBe('make-db 2026-11-24.1 (URBUILD_DATABASE_CORE)')
        expect(() => new MakeDb({ ...snapshot(), format: 2 })).toThrow(/not usable:\n  format: format 2; this core reads format 1/)
        expect(() => MakeDb.fromJSON('{')).toThrow(/not JSON/)
    })
})

describe('make/db: which snapshot a script needs', () =>
{
    it('names the version make.db() pins, and the latest where the code reckons with products', () =>
    {
        expect(makeDbNeeds("db = make.db('2026-11-24.1')")).toEqual([{ kind: 'make-db', id: '2026-11-24.1', reason: 'make.db' }])
        expect(makeDbNeeds('db = make.db()').map(n => n.id)).toEqual(['latest'])
        expect(makeDbNeeds("stud = box(38, 235, 2700).product('SLS')").map(n => n.id)).toEqual(['latest'])
        expect(makeDbNeeds('est = make.estimate(all())').map(n => n.id)).toEqual(['latest'])
        // the materials' properties come from it too
        expect(makeDbNeeds("w = box(10, 10, 10).material('osb').weight()").map(n => n.id)).toEqual(['latest'])
        expect(makeDbNeeds('rc = materials.rc(all())').map(n => n.id)).toEqual(['latest'])
        // $component is a script, not a component of the sheet; an unrelated .product property neither
        expect(makeDbNeeds("wall = $component('./timberwall', {}); x = y.product")).toEqual([])
        expect(scanContentNeeds("make.db('2026-11-24.2'); cloudcalc.open('https://docs.google.com/spreadsheets/d/1o0_OGFKAh9f3Sh6FlVx7JYNoDmSopAzd9U0akVJHGzw')").map(n => `${n.kind}:${n.id}`))
            .toEqual(['google-sheet:1o0_OGFKAh9f3Sh6FlVx7JYNoDmSopAzd9U0akVJHGzw', 'make-db:2026-11-24.2'])
    })
})

describe('make/db: the whole sheet', () =>
{
    it('keeps the sheet\'s other tabs as they are, and says which it left out', () =>
    {
        const asRows = (records: Array<Record<string, unknown>>) => [Object.keys(records[0]!), ...records.map(r => Object.values(r))]
        const s = snapshotFromTables({
            version: '2026-11-25.1', date: new Date('2026-11-25T09:00:00Z'),
            source: { sheet: 'x', title: 'X', tabs: ['instellingen'], skipped: ['bouwers', 'bouwersprijzen'] },
            tables: { ...Object.fromEntries(Object.entries(snapshot().tables).map(([k, rows]) => [k, asRows(rows)])),
                instellingen: [['A', 'naam', 'waarde', 'id'], ['element', 'uurtarief arbeid', 40, 'settings.rate_labor']] },
            settings: { ...snapshot().settings, 'outputs.hsbwand.costm2': 157.8 },
        })
        const db = new MakeDb(s)
        expect(db.tables()).toEqual(['materialen', 'producten', 'bewerkingen', 'componenten', 'instellingen'])
        expect(db.table('instellingen')).toEqual([{ A: 'element', naam: 'uurtarief arbeid', waarde: 40, id: 'settings.rate_labor' }])
        expect(db.setting('outputs.hsbwand.costm2')).toBe(157.8)
        expect(db.source.skipped).toEqual(['bouwers', 'bouwersprijzen'])
        expect(() => db.table('bouwers')).toThrow(/no such table; .* has: materialen, producten, bewerkingen, componenten, instellingen/)
        expect(validateSnapshot({ ...s, tables: { ...s.tables, kapot: 'x' as any } }).map(i => `${i.at}: ${i.message}`)).toContain('kapot: not rows of records')
    })
})

describe('make.db() in a run', () =>
{
    const item = (id: string, s: MakeDbSnapshot) => ({ kind: 'make-db', id, bytes: new TextEncoder().encode(JSON.stringify(s)).buffer, version: s.version, via: 'public' })

    it('reads the snapshot the run was given', async () =>
    {
        const r = await new Runner().load()
        const result = await r.execute({ script: { code: "db = make.db(); V = db.version; RATE = db.setting('settings.rate_labor'); N = db.table('producten').length" },
            content: { 'make-db:latest': item('latest', snapshot()) }, outputs: [] } as any)
        const scope = r.getScope('default') as any
        expect(result.status).toBe('success')
        expect([scope.V, scope.RATE, scope.N]).toEqual(['2026-11-24.1', 40, 1])
    })

    it('gives the run its materials: a material has its properties without anything else', async () =>
    {
        const r = await new Runner().load()
        await r.execute({ script: { code: "W = box(1000, 1000, 1000).material('naaldhout_constructief').weight(); N = materials.all().length" },
            content: { 'make-db:latest': item('latest', snapshot()) }, outputs: [] } as any)
        const scope = r.getScope('default') as any
        expect(scope.N).toBe(1)
        expect(scope.W).toBeCloseTo(450, 3)     // 1 m3 at 450 kg/m3

        // without it: how the material looks, no properties, and the run goes on
        const bare = await new Runner().load()
        const res: any = await bare.execute({ script: { code: "W = box(1000, 1000, 1000).material('osb').weight(); N = materials.all().length" }, outputs: [] } as any)
        expect(res.status).toBe('success')
        expect((bare.getScope('default') as any).N).toBe(0)
    })

    it('asks for it when the run was not given it, and refuses another version than it pinned', async () =>
    {
        const r = await new Runner().load()
        const missing: any = await r.execute({ script: { code: "db = make.db('2026-11-24.3')" }, outputs: [] } as any)
        expect(missing.needs?.content).toEqual([{ kind: 'make-db', id: '2026-11-24.3', reason: 'make.db' }])

        const other: any = await r.execute({ script: { code: "db = make.db('2026-11-24.3')" },
            content: { 'make-db:2026-11-24.3': item('2026-11-24.3', snapshot()) }, outputs: [] } as any)
        expect(other.status).toBe('error')
        expect(JSON.stringify(other.errors)).toMatch(/was given 2026-11-24.1 instead/)
    })
})
