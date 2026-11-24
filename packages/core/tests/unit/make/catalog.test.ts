import { describe, it, expect } from 'vitest'
import { MakeDb, snapshotFromTables, type MakeDbSnapshot } from '../../../src/make/db'
import { Catalog, normalize, distance } from '../../../src/make/catalog'
import { Runner } from '../../../src/runner/Runner'

/** A small product sheet: two sizes of one group, two boards that are the same size, a note */
function snapshot(): MakeDbSnapshot
{
    const head = ['productgroep', 'product_id', 'term', 'aliassen', 'vorm', 'materiaal', 'dikte', 'breedte', 'hoogte', 'lengte', 'dichtheid (kg/m3)']
    const stud = 'SLS, CLS, stud, studs, framing timber, regel, regels, stijl'
    return snapshotFromTables({
        version: '2026-11-24.1',
        date: new Date('2026-11-24T14:00:00Z'),
        source: { sheet: 'test', title: 'TEST' },
        tables: {
            materialen: [
                ['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'],
                ['naaldhout_constructief', 'Naaldhout C24', 'constructiehout', 450, 0.13],
                ['osb', 'OSB/3', 'plaatmateriaal', 611, 0.13],
            ],
            producten: [
                head,
                ['SLS', 'sls-38x140', 'Structural stud C24 38x140', stud, 'balk', 'naaldhout_constructief', '', 38, 140, 5400, 450],
                ['SLS', 'sls-38x235', 'Structural stud C24 38x235', stud, 'balk', 'naaldhout_constructief', '', 38, 235, 5400, 450],
                ['OSB-RK, OSB', 'osb-18-rk-1220x2440', 'OSB/3 board, square edge 18 mm', 'OSB, OSB3, oriented strand board, OSB plaat', 'plaat', 'osb', 18, 1220, '', 2440, 611],
                ['OSB-MG2, OSB', 'osb-18-mg2-1220x2440', 'OSB/3 board, tongue and groove 18 mm', 'OSB, OSB3, OSB T&G, messing en groef', 'plaat', 'osb', 18, 1220, '', 2440, 611],
                ['Houtwol', 'houtwol-100', 'Wood fibre insulation 100 mm', 'houtwol, houtvezelisolatie, wood fibre', 'plaat', 'naaldhout_constructief', 100, 600, '', 1200, 50],
            ],
            bewerkingen: [
                ['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'],
                ['afkorten', 'voorbewerking', 'st', 90, 1.5],
            ],
            componenten: [
                ['component', 'fase', 'product', 'bewerking', 'per', 'factor'],
                ['hsbwand', '', '', '', '', ''],
                ['hsbwand', 'materiaal', 'sls-38x235', '', 'st', 1],
            ],
        },
        settings: { 'settings.rate_labor': 40, 'outputs.marges.materiaal': 10, 'outputs.marges.arbeid': 20, 'outputs.marges.algemeen': 5 },
    })
}

const catalog = () => new Catalog(new MakeDb(snapshot()))
const ids = (c: Catalog, name: string) => c.find(name).candidates.map(p => p.id)
const measure = (kind: string, ...d: Array<number>) => { const [thickness, width, length] = d.sort((a, b) => a - b); return { kind, thickness, width, length, volume: thickness! * width! * length! } as any }
const beam = (w: number, h: number, l: number) => measure('beam', w, h, l)

describe('make/catalog: a product by what a script calls it', () =>
{
    it('normalizes names and measures how far apart two are', () =>
    {
        expect(normalize('  OSB/3 Plaat_rechte-kant ')).toBe('osb 3 plaat rechte kant')
        expect(normalize('Isolatie Houtvézel')).toBe('isolatie houtvezel')
        expect(distance('stdu', 'stud')).toBe(1)        // a swap is one
        expect(distance('regel', 'regels')).toBe(1)
        expect(distance('osb', 'sls')).toBe(3)
    })

    it('finds by id, group, alias, words and fuzzily, in that order', () =>
    {
        const c = catalog()
        expect(c.find('sls-38x235')).toMatchObject({ how: 'id' })
        expect(ids(c, 'sls-38x235')).toEqual(['sls-38x235'])
        expect(c.find('SLS').how).toBe('group')
        expect(ids(c, 'osb')).toEqual(['osb-18-rk-1220x2440', 'osb-18-mg2-1220x2440'])
        expect(c.find('regel')).toMatchObject({ how: 'alias' })
        expect(ids(c, 'stud')).toEqual(['sls-38x140', 'sls-38x235'])
        expect(c.find('Houtvezelisolatie').how).toBe('alias')
        expect(c.find('stud 38x235')).toMatchObject({ how: 'words' })       // every word in term, aliases or id
        expect(ids(c, 'osb tongue groove')).toEqual(['osb-18-mg2-1220x2440'])
        expect(c.find('stdu')).toMatchObject({ how: 'fuzzy', read: 'stud' })
        expect(c.find('bananas')).toEqual({ how: null, candidates: [] })
        expect(c.find('slx').how).toBeNull()   // short names are never read fuzzily
    })

    it('lets the part size choose within a group, and says what it had to choose', () =>
    {
        const c = catalog()
        expect(c.resolve('SLS', beam(38, 140, 2700)).product?.id).toBe('sls-38x140')
        const r = c.resolve('stud', beam(38, 235, 2700))
        expect([r.product?.id, r.issues]).toEqual(['sls-38x235', []])

        const tie = c.resolve('OSB', measure('plate', 18, 1220, 2440))
        expect(tie.product?.id).toBe('osb-18-rk-1220x2440')
        expect(tie.issues).toEqual([{ level: 'warning', message: expect.stringMatching(/^2 products of 'OSB' fit .* equally well .*: took osb-18-rk-1220x2440/) }])

        expect(c.resolve('stdu', beam(38, 140, 2400)).issues).toEqual([{ level: 'warning', message: "'stdu' read as 'stud'" }])
        expect(c.resolve('SLS', beam(38, 300, 2700))).toMatchObject({ product: null, issues: [{ level: 'error', message: expect.stringMatching(/no product of 'SLS' fits/) }] })
        expect(c.resolve('SLS', null).issues[0]!.message).toMatch(/can be 2 products .* no size to choose by/)
        expect(c.resolve('houtwol', null).product?.id).toBe('houtwol-100')
        expect(c.resolve('regelhout', null).issues[0]!.message).toMatch(/is no product of the sheet; did you mean: .*regel/)
        expect(c.components()).toEqual(['hsbwand'])
    })
})

describe('shape.product() in a run', () =>
{
    const item = (s: MakeDbSnapshot) => ({ kind: 'make-db', id: 'latest', bytes: new TextEncoder().encode(JSON.stringify(s)).buffer, version: s.version, via: 'public' })
    const run = async (code: string, runner?: Runner) =>
    {
        const r = runner ?? await new Runner().load()
        const result: any = await r.execute({ script: { code }, content: { 'make-db:latest': item(snapshot()) }, outputs: [] } as any)
        return { result, scope: r.getScope('default') as any }
    }

    it('gives a shape its product and material, kept on a copy; collections per part', async () =>
    {
        const { result, scope } = await run(`
            stud = box(38, 235, 2700).product('SLS');
            copy = stud.copy().move(600);
            frame = collection(box(38, 140, 2700), box(38, 140, 2700).move(600)).product('regel');
            wall = box(3000, 263, 2700).component('hsbwand');
            ID = stud.product().id; HOW = stud.product().how; DB = stud.product().db;
            COPY = [copy.product().id, copy.material().name];
            FRAME = frame.product().map(p => p.id);
            WALL = wall.component();
            NONE = box(10, 10, 10).product();
            CHECK = make.check();
        `)
        expect(result.errors ?? []).toEqual([])
        expect(result.status).toBe('success')
        expect([scope.ID, scope.HOW, scope.DB]).toEqual(['sls-38x235', 'group', '2026-11-24.1'])
        expect(scope.COPY[0]).toBe('sls-38x235')
        expect(scope.COPY[1]).toBe('naaldhout_constructief')
        expect(scope.FRAME).toEqual(['sls-38x140', 'sls-38x140'])
        expect(scope.WALL).toEqual({ kind: 'component', id: 'hsbwand', db: '2026-11-24.1' })
        expect(scope.NONE).toBeUndefined()
        expect(scope.CHECK).toEqual([])
    })

    it('collects what it could not choose as warnings, and throws when strict', async () =>
    {
        const { scope } = await run(`
            box(18, 1220, 2440).product('OSB');
            box(10, 10, 10).product('banana');
            box(1, 1, 1).component('vloer');
            CHECK = make.check().map(i => i.level + ' ' + i.where);
        `)
        expect(scope.CHECK).toEqual(["warning shape.product('OSB')", "error shape.product('banana')", "error shape.component('vloer')"])

        const r = await new Runner().load()
        const strict = await run(`make.strict(); box(10, 10, 10).product('banana');`, r)
        expect(strict.result.status).toBe('error')
        expect(JSON.stringify(strict.result.errors)).toMatch(/'banana' is no product of the sheet/)

        // the next run of the same runner starts with no problems and not strict
        const next = await run(`box(10, 10, 10).product('banana'); N = make.check().length`, r)
        expect([next.result.status, next.scope.N]).toEqual(['success', 1])
    })
})
