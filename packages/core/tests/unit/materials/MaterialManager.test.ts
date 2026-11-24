import { describe, it, expect } from 'vitest'

import { MaterialManager } from '../../../src/materials/MaterialManager'
import { materialFromRow, sheetNumber } from '../../../src/materials/fromSheet'
import { APPEARANCE } from '../../../src/materials/appearance'
import { rangeFor } from '../../../src/materials/ranges'
import { MATERIAL_PROPERTY_KEYS } from '../../../src/materials/types'
import type { ArchiyouModules } from '../../../src/types'
import { MATERIALEN_ROWS } from './materialen.fixture'

/** A manager with the materials of the core sheet (the fixture), and a modeler stub for units. */
function makeManager(system: 'metric' | 'imperial' = 'metric', unit = 'mm', loaded = true): MaterialManager
{
    const mgr = new MaterialManager()
    mgr.setArchiyou({
        modeler: { unitSystem: () => system, units: () => unit },
    } as unknown as ArchiyouModules)
    return loaded ? mgr.fromRows(MATERIALEN_ROWS) : mgr
}

/** A fake solid with a fixed volume (in model units³). */
function fakeShape(volume: number)
{
    return { volume: () => volume }
}

describe('MaterialManager', () =>
{
    describe('materials from the core sheet', () =>
    {
        it('reads a row of the materialen tab', () =>
        {
            const timber = materialFromRow(MATERIALEN_ROWS[0]!)!
            expect(timber).toMatchObject({
                name: 'naaldhout_constructief',
                group: 'wood',
                application: 'constructiehout',
                strengthClass: 'C24',
                fireClass: 'D-s2,d0',
                density: { value: 493, unit: 'kg/m3' },
                thermalConductivity: { value: 0.13, unit: 'W/mK' },
                compressive: { value: 21, unit: 'MPa' },
                price: { value: 723.16, unit: 'EUR/m3' },
            })
            expect(timber.density!.source).toMatch(/EN ISO 10456/)
            expect(timber.description).toMatch(/^Constructief vurenhout/)
        })

        it('groups by application, with the exceptions the sheet needs', () =>
        {
            const mgr = makeManager()
            expect(mgr.get('houtvezel_flex')!.group).toBe('insulation')
            expect(mgr.get('dampremmende_folie')!.group).toBe('membrane')
            expect(mgr.get('gipsplaat')!.group).toBe('finish')          // plaatmateriaal in the sheet
            expect(mgr.get('constructiestaal')!.group).toBe('metal')    // fundering in the sheet
        })

        it('reads numbers as cloudcalc gives them, and as text the way the sheet shows them', () =>
        {
            expect(sheetNumber(0.13)).toBe(0.13)
            expect(sheetNumber('€ 1,021.79')).toBe(1021.79)
            expect(sheetNumber('1,200')).toBe(1200)
            expect(sheetNumber('50 / 20')).toBe(50)
            expect(sheetNumber('')).toBeUndefined()
        })

        it('leaves out what the sheet leaves empty', () =>
        {
            const tape = makeManager().get('luchtdichte_tape')!
            expect(tape.density).toBeUndefined()
            expect(tape.lca).toBeUndefined()
            expect('thermalConductivity' in tape).toBe(false)
        })

        it('reads the whole table from an open workbook', () =>
        {
            const wb = { tables: () => [{ name: 'materialen' }], table: () => MATERIALEN_ROWS }
            const mgr = new MaterialManager().fromWorkbook(wb)
            expect(mgr.all()).toHaveLength(MATERIALEN_ROWS.length)
            expect(mgr.loaded).toBe(true)
        })

        it('says how to give the tab its table when the sheet has none', () =>
        {
            const wb = { tables: () => [{ name: 'producten' }], table: () => [] }
            expect(() => new MaterialManager().fromWorkbook(wb)).toThrow(/named range tables\.materialen/)
        })
    })

    describe('before the sheet is loaded', () =>
    {
        it('knows how a material looks, and its group, but none of its properties', () =>
        {
            const mgr = makeManager('metric', 'mm', false)
            const osb = mgr.get('osb')!
            expect(osb.group).toBe('wood')
            expect(osb.viz?.textures?.sides?.image).toBe('./textures/osb_sides.jpg')
            expect(osb.density).toBeUndefined()
            expect(mgr.resolve('osb', fakeShape(1e9))!.mass()).toBeUndefined()
        })

        it('does not know a material without a look', () =>
        {
            expect(makeManager('metric', 'mm', false).get('unobtainium')).toBeNull()
        })
    })

    describe('lookup', () =>
    {
        it('resolves by materiaal_id, case-insensitive', () =>
        {
            const mgr = makeManager()
            expect(mgr.get('douglas')?.name).toBe('douglas')
            expect(mgr.get('DOUGLAS')?.name).toBe('douglas')
        })

        it('returns null / warns on unknown', () =>
        {
            const mgr = makeManager()
            expect(mgr.get('unobtainium')).toBeNull()
            expect(mgr.resolve('unobtainium')).toBeNull()
        })
    })

    describe('property values fall within plausible physical ranges', () =>
    {
        const mgr = makeManager()
        for (const mat of mgr.all())
        {
            it(`${mat.name} has in-range properties`, () =>
            {
                for (const key of MATERIAL_PROPERTY_KEYS)
                {
                    const p = mat[key]
                    if (!p) continue
                    const range = rangeFor(key, mat.group)
                    if (!range) continue
                    expect(p.value, `${mat.name}.${key}=${p.value} out of [${range.min},${range.max}]`)
                        .toBeGreaterThanOrEqual(range.min)
                    expect(p.value).toBeLessThanOrEqual(range.max)
                }
            })
        }
    })

    describe('mass / weight calculation', () =>
    {
        it('computes kg for a 1m³ solid in metric (mm units)', () =>
        {
            const mgr = makeManager('metric', 'mm')
            // 1 m³ = 1e9 mm³ ; beton 2400 kg/m³ → 2400 kg
            expect(mgr.massFor(mgr.get('beton')!, 1e9)).toBeCloseTo(2400, 3)
        })

        it('bound shape .mass()/.weight() agree', () =>
        {
            const mgr = makeManager('metric', 'mm')
            // douglas 530 kg/m³, beam 100 x 100 x 2000 mm = 0.02 m³ → 10.6 kg
            const bound = mgr.resolve('douglas', fakeShape(100 * 100 * 2000))!
            expect(bound.mass()).toBeCloseTo(10.6, 3)
            expect(bound.weight()).toBeCloseTo(bound.mass()!, 6)
        })

        it('presents pounds in imperial mode', () =>
        {
            // model unit is inches in imperial; a 1 ft³ cube = 12³ inch³
            const mgr = makeManager('imperial', 'inch')
            const massLb = mgr.massFor(mgr.get('constructiestaal')!, 12 ** 3) // 7850 kg/m³, 1 ft³
            // 1 ft³ steel ≈ 222.3 kg → ~490 lb
            expect(massLb).toBeGreaterThan(480)
            expect(massLb).toBeLessThan(500)
        })

        it('returns undefined for a shape without volume()', () =>
        {
            const bound = makeManager().resolve('constructiestaal', {} as any)!
            expect(bound.mass()).toBeUndefined()
        })
    })

    describe('property read-out unit conversion', () =>
    {
        it('converts density to lb/ft³ in imperial', () =>
        {
            const metric = makeManager('metric')
            const imperial = makeManager('imperial')
            expect(metric.property(metric.get('constructiestaal')!, 'density')!.unit).toBe('kg/m3')
            const imp = imperial.property(imperial.get('constructiestaal')!, 'density')!
            expect(imp.unit).toBe('lb/ft3')
            expect(imp.value).toBeCloseTo(7850 * 0.0624279606, 2) // ≈ 490 lb/ft³
        })
    })

    describe('render spec', () =>
    {
        it('builds a spec with pbr and textures for a wood material', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const spec = mgr.renderSpec(mgr.get('douglas')!)!
            expect(spec.name).toBe('douglas')
            expect(spec.pbr?.color).toBeTruthy()
            expect(spec.textures?.section).toBeTruthy()
            expect(spec.modelUnitMM).toBe(1)
            expect(spec.thinSideThresholdMM).toBe(25)
        })

        it('gives a material of the sheet without its own look its group colour', () =>
        {
            const mgr = new MaterialManager().fromRows([{ materiaal_id: 'kurk', toepassing: 'isolatie', 'dichtheid (kg/m3)': 110 }])
            expect(APPEARANCE['kurk']).toBeUndefined()
            expect(mgr.renderSpec(mgr.get('kurk')!).pbr?.color).toMatch(/^#[0-9a-f]{6}$/)
        })

        it('always carries an edge style, so materialized shapes get an outline', () =>
        {
            const mgr = makeManager()
            const spec = mgr.renderSpec(mgr.get('constructiestaal')!)
            expect(spec.edge).toMatchObject({ opacity: 1.0, width: 1 })
            expect(spec.edge!.color).toMatch(/^#[0-9a-f]{6}$/)
        })

        it('derives the outline from the material base colour, darkened', () =>
        {
            const mgr = makeManager()
            const douglas = mgr.get('douglas')!
            const base = douglas.viz!.pbr!.color!            // '#c08a4a'
            const edge = mgr.renderSpec(douglas).edge!.color

            const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
            const [br, bg, bb] = rgb(base), [er, eg, eb] = rgb(edge)

            // Same hue family, but genuinely darker — an outline in exactly the surface
            // colour is invisible, which is what this whole path got wrong before.
            expect(er).toBeLessThan(br)
            expect(eg).toBeLessThan(bg)
            expect(eb).toBeLessThan(bb)
            expect(er / Math.max(br, 1)).toBeCloseTo(mgr.materialLineDarken, 1)
            // hue preserved: red still dominates for a warm timber
            expect(er).toBeGreaterThan(eb)
        })

        it('pins every material to a literal colour when one is set', () =>
        {
            const mgr = makeManager()
            mgr.materialLineColor = '#123456'
            expect(mgr.renderSpec(mgr.get('douglas')!).edge!.color).toBe('#123456')
            expect(mgr.renderSpec(mgr.get('constructiestaal')!).edge!.color).toBe('#123456')
        })

        it('falls back to black for a material with no base colour', () =>
        {
            const mgr = makeManager()
            expect(mgr.renderSpec({ name: 'x', group: 'other' } as any).edge!.color).toBe('#000000')
        })

        it('honours an overridden line setting', () =>
        {
            const mgr = makeManager()
            mgr.materialLineOpacity = 0.5
            mgr.materialLineColor = '#333333'
            expect(mgr.renderSpec(mgr.get('constructiestaal')!).edge)
                .toMatchObject({ color: '#333333', opacity: 0.5 })
        })

        it('carries the texture strength setting, in both directions', () =>
        {
            const mgr = makeManager()
            expect(mgr.renderSpec(mgr.get('douglas')!).textureStrength).toBe(1.0)
            mgr.materialTextureStrength = 0.4          // fade toward the flat colour
            expect(mgr.renderSpec(mgr.get('douglas')!).textureStrength).toBe(0.4)
            mgr.materialTextureStrength = 2.0          // deepen the linework
            expect(mgr.renderSpec(mgr.get('douglas')!).textureStrength).toBe(2.0)
        })

        it('leaves textures untouched at strength 1', async () =>
        {
            // The adjust path must be a genuine no-op at 1, not a re-encode: re-encoding
            // every texture on every export would be pure cost for zero visual change.
            const mgr = makeManager()
            mgr.materialTextureStrength = 1
            const spec = mgr.renderSpec(mgr.get('douglas')!)
            const box = { style: { material: spec } }
            await mgr.embedTexturesInShapes([box])

            const direct = await mgr.loadTextureDataURI(spec.textures!.sides!.image)
            expect(spec.textures!.sides!.data).toBe(direct)
        })

        it('every look points at a texture that exists', async () =>
        {
            const mgr = makeManager()
            const images = [...new Set(Object.values(APPEARANCE)
                .flatMap(v => Object.values(v.textures ?? {}).map(t => t!.image)))]
            for (const image of images)
            {
                expect(await mgr.loadTextureDataURI(image), image).toMatch(/^data:image\//)
            }
        })
    })

    describe('EN 15804 life-cycle data, per m³ as the sheet gives it', () =>
    {
        const mgr = makeManager()

        it('carries the modules, the standard and the source', () =>
        {
            const lca = mgr.get('douglas')!.lca!
            expect(lca.declaredUnit).toBe('m3')
            expect(lca.standard).toBe('EN 15804+A2')
            expect(lca.modules.A1A3!.value).toBeCloseTo(-810.85, 2)
            expect(lca.source.url).toMatch(/oekobaudat/)
        })

        it('per-kg intensity divides by the density', () =>
        {
            // GWP-total A1-A3 is negative: EN 15804+A2 counts the biogenic carbon in the timber
            const douglas = mgr.get('douglas')!
            expect(mgr.carbonIntensityOf(douglas)).toBeCloseTo(-810.85 / 530, 6)
        })

        it("'total' sums more modules than 'embodied'", () =>
        {
            const steel = mgr.get('constructiestaal')!
            expect(mgr.carbonIntensityOf(steel, 'total')).not.toBeCloseTo(mgr.carbonIntensityOf(steel, 'embodied')!, 6)
        })

        it('an explicit module selection sums only those modules', () =>
        {
            const steel = mgr.get('constructiestaal')!
            const lca = steel.lca!
            const got = mgr.carbonIntensityOf(steel, ['C3', 'C4'])!
            expect(got).toBeCloseTo(((lca.modules.C3?.value ?? 0) + (lca.modules.C4?.value ?? 0)) / 7850, 9)
        })

        it('returns undefined, not zero, for undeclared modules', () =>
        {
            expect(mgr.get('constructiestaal')!.lca!.modules.B6).toBeUndefined()
            expect(mgr.carbonIntensityOf(mgr.get('constructiestaal')!, ['B6'])).toBeUndefined()
        })
    })

    describe('carbon of a bound shape', () =>
    {
        it('scales with mass and stays in kg CO2e across unit systems', () =>
        {
            // Same physical beam, described in mm and in inches.
            const metric = makeManager('metric', 'mm')
            const imperial = makeManager('imperial', 'inch')

            const mmVolume = 100 * 100 * 2000                    // 0.02 m³ in mm³
            const inchVolume = mmVolume / (25.4 ** 3)            // the same volume in inch³

            const a = metric.resolve('douglas', fakeShape(mmVolume))!.carbon()!
            const b = imperial.resolve('douglas', fakeShape(inchVolume))!.carbon()!

            expect(a).toBeCloseTo(b, 6)   // a physical impact, not a display read-out
            expect(a).toBeCloseTo(-810.85 * 0.02, 6)
        })

        it('doubling the volume doubles the carbon', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const one = mgr.resolve('constructiestaal', fakeShape(1e6))!.carbon()!
            const two = mgr.resolve('constructiestaal', fakeShape(2e6))!.carbon()!
            expect(two).toBeCloseTo(one * 2, 6)
        })

        it('is undefined when the material has no usable data', () =>
        {
            expect(makeManager().resolve('luchtdichte_tape', fakeShape(1e6))!.carbon()).toBeUndefined()
        })
    })

    describe('totals() aggregation', () =>
    {
        /** A fake shape carrying a material name, as the modeler sets it. */
        const matShape = (name: string, volume: number) =>
            ({ _material: name, volume: () => volume })

        it('groups by material and sums mass and carbon', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const totals = mgr.totals([
                matShape('constructiestaal', 1e6),
                matShape('constructiestaal', 1e6),
                matShape('douglas', 2e7),
            ])

            expect(totals.byMaterial).toHaveLength(2)
            const steel = totals.byMaterial.find(r => r.name === 'constructiestaal')!
            expect(steel.count).toBe(2)
            expect(steel.volume).toBe(2e6)
            expect(steel.mass).toBeCloseTo(mgr.massKgFor(mgr.get('constructiestaal')!, 2e6)!, 6)
            expect(totals.total.mass).toBeCloseTo(
                totals.byMaterial.reduce((s, r) => s + r.mass, 0), 6)
        })

        it('counts shapes with no material as unaccounted rather than dropping them', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const totals = mgr.totals([matShape('constructiestaal', 1e6), { volume: () => 1e6 }])
            expect(totals.byMaterial).toHaveLength(1)
            expect(totals.total.unaccounted).toBe(1)
        })

        it('flags a material whose carbon could not be determined', () =>
        {
            const mgr = new MaterialManager().fromRows([{ materiaal_id: 'kurk', toepassing: 'isolatie', 'dichtheid (kg/m3)': 110 }])
            const row = mgr.totals([matShape('kurk', 1e9)]).byMaterial[0]!
            expect(row.mass).toBeCloseTo(110, 6)    // mass is knowable
            expect(row.carbon).toBeUndefined()      // carbon is not
            expect(row.partial).toBe(true)
        })
    })
})
