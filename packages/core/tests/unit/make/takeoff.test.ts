import { describe, it, expect } from 'vitest'
import { snapshotFromTables, type MakeDbSnapshot } from '../../../src/make/db'
import { cutPlan } from '../../../src/make/products/ProductManager'
import { Takeoff } from '../../../src/make/takeoff/Takeoff'
import { MakeDb } from '../../../src/make/db'
import { Script } from '../../../src/Script'
import { Runner } from '../../../src/runner/Runner'

/**
 *  A sheet with one component, worked out by hand: 'wand', 1000 x 2000 x 100 mm (0.2 m3, 2 m2),
 *  three studs (30 euro), cut to length (6 x afkorten: 90 s, 1.5 euro), mounted as a whole
 *  (montagewand: 9000 s, 150 euro). Labour factor 1.5: an hour of time is 1.5 paid hours, as the
 *  sheet's arbeidstijd. Margins: material 10 %, labour 20 %.
 */
function snapshot(): MakeDbSnapshot
{
    const C = ['component', 'gebouwdeel', 'componentgroep', 'naam (in de offerte)', 'representatieve breedte (mm)', 'representatieve hoogte (mm)', 'representatieve diepte (mm)',
        'representatieve maat', 'eenheid maat', 'bouwdeel', 'fase', 'product', 'bewerking', 'vorm / werkeenheid', 'stuks (totaal)', 'lengte (totaal m1)', 'oppervlak (totaal m2)',
        'volume (totaal m3)', 'zaaglengte (totaal m1)', 'hoeveelheid in prijseenheid', 'materiaalkosten', 'onsitekosten', 'voorbewerkingskosten', 'assemblagekosten',
        'montagekosten', 'afbouwkosten', 'arbeidstijd (uur)', 'per', 'factor']
    const row = (values: Record<string, unknown>) => C.map(c => values[c] ?? '')
    return snapshotFromTables({
        version: '2026-11-24.1',
        date: new Date('2026-11-24T14:00:00Z'),
        source: { sheet: 'test', title: 'TEST' },
        tables: {
            materialen: [
                ['materiaal_id', 'naam', 'toepassing', 'dichtheid (kg/m3)', 'warmtegeleidingscoëfficiënt λ (W/(m·K))'],
                ['naaldhout_constructief', 'Naaldhout C24', 'constructiehout', 450, 0.13],
            ],
            producten: [
                ['productgroep', 'product_id', 'term', 'aliassen', 'vorm', 'materiaal', 'breedte', 'hoogte', 'lengte', 'prijs', 'prijseenheid', 'prijs per basiseenheid'],
                ['SLS', 'sls-38x140', 'Structural stud C24 38x140', 'stud, regel', 'balk', 'naaldhout_constructief', 38, 140, 5400, 2, 'm1', 10.8],
                ['SLS-GEVINGERLAST', 'sls-gevingerlast-38x140', 'Finger-jointed stud C24 38x140', '', 'balk', 'naaldhout_constructief', 38, 140, 12000, 3, 'm1', 36],
                ['TAPE', 'tape-60', 'Tape 60 mm', 'tape', 'rol', '', '', 60, 25000, 0.5, 'm1', 12.5],
            ],
            bewerkingen: [
                ['naam', 'fase', 'werkeenheid', 'tijd (seconden)', 'kosten (EUR per werkeenheid)'],
                ['afkorten', 'voorbewerking', 'st', 90, 1.5],
                ['montagewand', 'montage', 'st', 9000, 150],
            ],
            componenten: [
                C,
                row({ component: 'wand', gebouwdeel: 'casco', componentgroep: 'wanden', 'naam (in de offerte)': 'Wand', 'representatieve breedte (mm)': 1000,
                    'representatieve hoogte (mm)': 2000, 'representatieve diepte (mm)': 100, 'representatieve maat': 2, 'eenheid maat': 'm2' }),
                row({ component: 'wand', bouwdeel: 'constructiehout', fase: 'materiaal', product: 'sls-38x140', 'vorm / werkeenheid': 'balk', 'stuks (totaal)': 3,
                    'lengte (totaal m1)': 6, 'volume (totaal m3)': 0.0319, materiaalkosten: 30 }),
                row({ component: 'wand', fase: 'voorbewerking', product: 'sls-38x140', bewerking: 'afkorten', 'vorm / werkeenheid': 'st', 'hoeveelheid in prijseenheid': 6,
                    voorbewerkingskosten: 9, 'arbeidstijd (uur)': 0.225, per: 'st', factor: 2 }),
                row({ component: 'wand', fase: 'montage', bewerking: 'montagewand', 'vorm / werkeenheid': 'st', 'hoeveelheid in prijseenheid': 1,
                    montagekosten: 150, 'arbeidstijd (uur)': 3.75, per: 'element', factor: 1 }),
            ],
        },
        settings: { 'settings.rate_labor': 40, 'settings.labor_factor': 1.5, 'outputs.marges.materiaal': 10, 'outputs.marges.arbeid': 20, 'outputs.marges.algemeen': 0,
            'outputs.verlies': [['balk', 0.1]] },
    })
}

const item = (s: MakeDbSnapshot) => ({ kind: 'make-db', id: 'latest', bytes: new TextEncoder().encode(JSON.stringify(s)).buffer, version: s.version, via: 'public' })
async function run(code: string, options: { components?: Record<string, string>, content?: boolean } = {})
{
    const r = await new Runner().load()
    r.linkComponentScripts(Object.entries(options.components ?? {}).map(([name, code]) => Script.fromData({ name, code }) as Script))
    const result: any = await r.execute({ script: { code }, content: options.content === false ? {} : { 'make-db:latest': item(snapshot()) }, outputs: [] } as any)
    return { result, scope: r.getScope('default') as any }
}
const close = (v: number) => Math.round(v * 1e4) / 1e4

const MODEL = `
    studs = collection(box(38, 140, 2400), box(38, 140, 2400).move(600)).product('stud', { component: 'wand' });
    take = make.takeoff();
`

describe('make.takeoff()', () =>
{
    it('weighs, prices and times the parts by the sheet: material with its waste, labour by its recipe and time', async () =>
    {
        const { result, scope } = await run(MODEL + `
            W = take.weight(); COST = take.cost(); TIME = take.time(); LINES = take.lines(); CHECK = take.check();
        `)
        expect(result.errors ?? []).toEqual([])
        // 2 x 2.4 m x 38 x 140 mm x 450 kg/m3
        expect(close(scope.W)).toBe(close(2 * 2.4 * 0.038 * 0.14 * 450))
        // material: 4.8 m x 2 euro, +10 % waste, +10 % margin; afkorten 2 x per stud: 4 x 1.5 euro, +20 %
        expect(close(scope.COST.material)).toBe(close(4.8 * 2 * 1.1 * 1.1))
        expect(close(scope.COST.voorbewerking)).toBe(close(4 * 1.5 * 1.2))
        expect(close(scope.COST.total)).toBe(close(4.8 * 2 * 1.1 * 1.1 + 4 * 1.5 * 1.2))
        // 4 x 90 s x 1.5
        expect(close(scope.TIME.voorbewerking)).toBe(close(4 * 90 / 3600 * 1.5))
        expect(close(scope.TIME.total)).toBe(close(scope.TIME.voorbewerking))
        expect(scope.LINES.map((l: any) => [l.id, l.st, l.labour])).toEqual([['sls-38x140', 2, 'wand/sls-38x140']])
        expect(scope.CHECK).toEqual([])
    })

    it('reckons a mass as its component, groups by component, product or phase', async () =>
    {
        const { scope } = await run(MODEL.replace('take =', `mass = box(1000, 100, 2000).move(5000).component('wand'); take =`) + `
            LINES = take.lines(); BY = take.by('product'); PHASE = take.by('phase'); COMPONENT = take.by('component');
        `)
        const mass = scope.LINES.find((l: any) => l.id === 'wand')
        // the representative wall itself: 0.2 m3, so its own rows
        expect(close(mass.costs.total)).toBe(30 + 9 + 150)
        expect(close(mass.hours.total)).toBe(close(0.225 + 3.75))
        expect(close(mass.weight)).toBe(close(0.0319 * 450))
        expect(scope.BY.map((g: any) => g.key)).toEqual(['sls-38x140', 'wand'])
        expect(close(scope.BY[1].cost.total)).toBe(close(30 * 1.1 + (9 + 150) * 1.2))
        expect(scope.PHASE.map((g: any) => g.key)).toEqual(['material', 'voorbewerking', 'montage'])
        expect(scope.COMPONENT.map((g: any) => g.key)).toEqual(['wand'])
    })

    it('orders in stock lengths and lists the cuts', async () =>
    {
        const { scope } = await run(MODEL + `ORDER = take.order(); CUTS = take.cuts(); T = take.cutTable().name();`)
        // two parts of 2400 from one length of 5400, a saw cut of 4 mm between
        expect(scope.CUTS.map((c: any) => [c.product, c.stock, c.parts.map((p: any) => p.length), c.rest])).toEqual([['sls-38x140', 5400, [2400, 2400], 596]])
        expect(scope.ORDER.map((o: any) => [o.product, o.quantity, o.unit, close(o.total)])).toEqual([['sls-38x140', 1, 'st', 10.8]])
        expect(cutPlan([{ length: 3000 }, { length: 3000 }, { length: 2000 }], 5400, 4).map(b => b.parts.length)).toEqual([2, 1])
    })

    it('says what it could not reckon with, in check() and make.check(); strict stops the run', async () =>
    {
        const { scope } = await run(`box(10, 10, 10).name('loose'); ${MODEL} CHECK = take.check(); MAKE = make.check();`)
        expect(scope.CHECK.map((i: any) => i.message)).toEqual(['1 shape(s) have no product and are not reckoned with: loose'])
        expect(scope.MAKE.map((i: any) => i.where)).toEqual(['make.takeoff()'])

        const strict = await run(`make.strict(); box(10, 10, 10).name('loose'); ${MODEL}`)
        expect(strict.result.status).toBe('error')
        expect(JSON.stringify(strict.result.errors)).toMatch(/have no product/)
    })
})

/** A component: two studs of a wall part, its tape, and the work on it as a whole */
const PART = `
    $PARAMS.define('WIDTH', 'number', { default: 1000 });
    studs = collection(box(38, 140, 2400), box(38, 140, 2400).move($WIDTH)).product('stud', { component: 'wand' });
    make.add('tape-60', { lengte: 2 }, { component: 'wand', label: 'naden' });
    make.complete('wand', { oppervlak: 2 }, { except: ['sls-38x140'] });
`

describe('make.takeoff() of components', () =>
{
    it('brings what a component adds with its shapes: used twice, twice', async () =>
    {
        const once = await run(`p = $component('./part').model(); take = make.takeoff(); L = take.lines();`, { components: { part: PART } })
        const twice = await run(`a = $component('./part').model(); b = $component('./part', { WIDTH: 1200 }).model().moveY(2000); take = make.takeoff(); L = take.lines();`, { components: { part: PART } })
        expect(once.result.errors ?? []).toEqual([])
        const of = (lines: any[], id: string) => lines.find(l => l.id === id)
        expect(of(once.scope.L, 'tape-60').lengte).toBeCloseTo(2)
        expect(of(twice.scope.L, 'tape-60').lengte).toBeCloseTo(4)
        expect(of(twice.scope.L, 'sls-38x140').st).toBe(4)
        // complete(): the component's element work (montagewand), not its studs again
        expect(of(once.scope.L, 'montagewand').st).toBeCloseTo(1)
        expect(of(twice.scope.L, 'montagewand').st).toBeCloseTo(2)
    })

    it('takes the first name that fits, turns short pieces, and lets a part be part of another', async () =>
    {
        const { scope } = await run(`
            long = box(38, 140, 6000).product(['SLS', 'SLS-GEVINGERLAST']);
            block = box(38, 140, 38).move(500).product('SLS');
            rafter = box(38, 180, 3000).move(1000).product('sls-38x140', { fit: false });
            head = box(200, 200, 10).move(2000).partOf(long);
            take = make.takeoff();
            IDS = take.lines().map(l => [l.id, l.st, Math.round(l.lengte * 1000)]);
            HEAD = head.product(); CHECK = make.check();
        `)
        expect(scope.IDS).toEqual([['sls-gevingerlast-38x140', 1, 6000], ['sls-38x140', 2, 3038]])
        expect(scope.HEAD).toEqual({ kind: 'part of', id: 'sls-gevingerlast-38x140', db: null })
        expect(scope.CHECK).toEqual([])
    })

    it('without the make database a shape keeps its name, and the takeoff finds the product', async () =>
    {
        const { result, scope } = await run(`stud = box(38, 140, 2400).product('stud', { component: 'wand' }); P = stud.product(); make.add('tape-60', { lengte: 3 });`, { content: false })
        expect(result.status).toBe('success')
        expect(scope.P).toMatchObject({ kind: 'product', pending: true, name: "'stud'" })
        const take = new Takeoff(new MakeDb(snapshot()), scope.stud, {}, null, () => {}, scope.make.extras())
        expect(take.lines().map(l => [l.id, l.st, l.labour])).toEqual([['sls-38x140', 1, 'wand/sls-38x140'], ['tape-60', 0, null]])
    })

    it('passes the content on to components, and their problems on to the model', async () =>
    {
        const { result, scope } = await run(`p = $component('./bad').model(); take = make.takeoff(); C = make.check().map(i => i.where + ': ' + i.message);`,
            { components: { bad: `box(10, 10, 10).product('banana'); box(38, 140, 2400).product('stud');` } })
        expect(result.errors ?? []).toEqual([])
        expect(scope.C).toEqual([expect.stringMatching(/^in a component: shape\.product\('banana'\): 'banana' is no product of the sheet/),
            'make.takeoff(): 1 shape(s) have no product and are not reckoned with: shape'])
    })
})
