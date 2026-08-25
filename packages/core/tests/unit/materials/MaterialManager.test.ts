import { describe, it, expect } from 'vitest'

import { MaterialManager } from '../../../src/materials/MaterialManager'
import { rangeFor } from '../../../src/materials/ranges'
import { MATERIAL_PROPERTY_KEYS } from '../../../src/materials/types'
import type { ArchiyouModules } from '../../../src/types'

/** Minimal modeler stub exposing the unit accessors MaterialManager reads. */
function makeManager(system: 'metric' | 'imperial' = 'metric', unit = 'mm'): MaterialManager
{
    const mgr = new MaterialManager()
    mgr.setArchiyou({
        modeler: { unitSystem: () => system, units: () => unit },
    } as unknown as ArchiyouModules)
    return mgr
}

/** A fake solid with a fixed volume (in model units³). */
function fakeShape(volume: number)
{
    return { volume: () => volume }
}

describe('MaterialManager', () =>
{
    describe('lookup & aliases', () =>
    {
        it('resolves by canonical name', () =>
        {
            const mgr = makeManager()
            expect(mgr.get('douglas')?.name).toBe('douglas')
            expect(mgr.get('DOUGLAS')?.name).toBe('douglas') // case-insensitive
        })

        it('resolves by alias', () =>
        {
            const mgr = makeManager()
            expect(mgr.get('multiplex')?.name).toBe('plywood')
            expect(mgr.get('aluminium')?.name).toBe('aluminum')
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

        it('every material with a numeric property cites a source', () =>
        {
            for (const mat of mgr.all())
                for (const key of MATERIAL_PROPERTY_KEYS)
                    if (mat[key]) expect(mat[key]!.source, `${mat.name}.${key}`).toBeTruthy()
        })
    })

    describe('mass / weight calculation', () =>
    {
        it('computes kg for a 1m³ solid in metric (mm units)', () =>
        {
            const mgr = makeManager('metric', 'mm')
            // 1 m³ = 1e9 mm³ ; concrete 2400 kg/m³ → 2400 kg
            const mat = mgr.get('concrete')!
            expect(mgr.massFor(mat, 1e9)).toBeCloseTo(2400, 3)
        })

        it('bound shape .mass()/.weight() agree', () =>
        {
            const mgr = makeManager('metric', 'mm')
            // douglas 530 kg/m³, beam 100 x 100 x 2000 mm = 2e7 mm³ = 0.02 m³ → 10.6 kg
            const bound = mgr.resolve('douglas', fakeShape(100 * 100 * 2000))!
            expect(bound.mass()).toBeCloseTo(10.6, 3)
            expect(bound.weight()).toBeCloseTo(bound.mass()!, 6)
        })

        it('presents pounds in imperial mode', () =>
        {
            // model unit is inches in imperial; a 1 ft³ cube = 12³ inch³
            const mgr = makeManager('imperial', 'inch')
            const mat = mgr.get('steel')! // 7850 kg/m³
            const massLb = mgr.massFor(mat, 12 ** 3) // 1 ft³
            // 1 ft³ steel ≈ 222.3 kg → ~490 lb
            expect(massLb).toBeGreaterThan(480)
            expect(massLb).toBeLessThan(500)
        })

        it('returns undefined for a shape without volume()', () =>
        {
            const mgr = makeManager()
            const bound = mgr.resolve('steel', {} as any)!
            expect(bound.mass()).toBeUndefined()
        })
    })

    describe('property read-out unit conversion', () =>
    {
        it('converts density to lb/ft³ in imperial', () =>
        {
            const metric = makeManager('metric')
            const imperial = makeManager('imperial')
            const steel = metric.get('steel')!
            expect(metric.property(steel, 'density')!.unit).toBe('kg/m3')
            const imp = imperial.property(imperial.get('steel')!, 'density')!
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

        it('always carries an edge style, so materialized shapes get an outline', () =>
        {
            const mgr = makeManager()
            const spec = mgr.renderSpec(mgr.get('steel')!)
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
            expect(mgr.renderSpec(mgr.get('steel')!).edge!.color).toBe('#123456')
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
            expect(mgr.renderSpec(mgr.get('steel')!).edge)
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
    })

    describe('EN 15804 life-cycle data', () =>
    {
        const mgr = makeManager()
        const withLca = mgr.all().filter(m => m.lca)

        it('imported life-cycle data for most of the database', () =>
        {
            expect(withLca.length).toBeGreaterThan(30)
        })

        for (const mat of withLca)
        {
            it(`${mat.name} carries complete provenance`, () =>
            {
                const src = mat.lca!.source
                for (const key of ['dataset', 'uuid', 'version', 'url', 'retrieved'] as const)
                    expect(src[key], `${mat.name}.lca.source.${key}`).toBeTruthy()
                expect(mat.lca!.standard).toMatch(/^EN 15804\+A[12]$/)
                expect(Object.keys(mat.lca!.modules).length).toBeGreaterThan(0)
            })
        }

        it('per-kg intensity of a volumetric EPD uses the EPD own density', () =>
        {
            // douglas: Nadelschnittholz declared per m³; GWP-total A1-A3 is negative
            // because EN 15804+A2 counts the biogenic carbon taken up by the timber.
            const lca = mgr.get('douglas')!.lca!
            expect(lca.declaredUnit).toBe('m3')
            expect(lca.density?.value).toBeGreaterThan(0)

            const perKg = mgr.carbonIntensityOf(mgr.get('douglas')!)!
            const expected = lca.modules.A1A3!.value / (lca.declaredUnitValue ?? 1) / lca.density!.value
            expect(perKg).toBeCloseTo(expected, 6)
            expect(perKg).toBeLessThan(0)
        })

        it('does not invent a per-kg figure for an area-declared EPD', () =>
        {
            // Flat glass is declared per m² — no thickness, so no honest mass basis.
            // ÖKOBAUDAT spells that 'qm' (Quadratmeter), not 'm2'.
            expect(mgr.get('glass')!.lca!.declaredUnit).toBe('qm')
            expect(mgr.carbonIntensityOf(mgr.get('glass')!)).toBeUndefined()
        })

        it('does not double-count A1-A3 against its own A1/A2/A3 parts', () =>
        {
            const mat = mgr.get('douglas')!
            const lca = mat.lca!
            // this dataset declares BOTH the aggregate and the three constituents
            expect(lca.modules.A1A3).toBeTruthy()
            expect(lca.modules.A1).toBeTruthy()
            // the aggregate must win, not be added on top of its parts
            const perKg = mgr.carbonIntensityOf(mat)!
            expect(perKg).toBeCloseTo(
                lca.modules.A1A3!.value / (lca.declaredUnitValue ?? 1) / lca.density!.value, 6)
        })

        it("'total' sums more modules than 'embodied'", () =>
        {
            const steel = mgr.get('steel')!
            const embodied = mgr.carbonIntensityOf(steel, 'embodied')!
            const total = mgr.carbonIntensityOf(steel, 'total')!
            expect(total).not.toBeCloseTo(embodied, 6)
        })

        it('an explicit module selection sums only those modules', () =>
        {
            // Steel is declared per 1000 kg, so declaredUnitValue carries the factor
            // and no density conversion is involved.
            const steel = mgr.get('steel')!
            const lca = steel.lca!
            expect(lca.declaredUnit).toBe('kg')
            expect(lca.declaredUnitValue).toBe(1000)

            const got = mgr.carbonIntensityOf(steel, ['C3', 'C4'])!
            const want = ((lca.modules.C3?.value ?? 0) + (lca.modules.C4?.value ?? 0)) / 1000
            expect(got).toBeCloseTo(want, 9)
        })

        it('returns undefined, not zero, for undeclared modules', () =>
        {
            // B6 (operational energy) is not declared for structural steel
            expect(mgr.get('steel')!.lca!.modules.B6).toBeUndefined()
            expect(mgr.carbonIntensityOf(mgr.get('steel')!, ['B6'])).toBeUndefined()
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
            expect(a).toBeLessThan(0)     // sequestered biogenic carbon
        })

        it('doubling the volume doubles the carbon', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const one = mgr.resolve('steel', fakeShape(1e6))!.carbon()!
            const two = mgr.resolve('steel', fakeShape(2e6))!.carbon()!
            expect(two).toBeCloseTo(one * 2, 6)
        })

        it('is undefined when the material has no usable data', () =>
        {
            const mgr = makeManager('metric', 'mm')
            expect(mgr.resolve('glass', fakeShape(1e6))!.carbon()).toBeUndefined()
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
                matShape('steel', 1e6),
                matShape('steel', 1e6),
                matShape('douglas', 2e7),
            ])

            expect(totals.byMaterial).toHaveLength(2)
            const steel = totals.byMaterial.find(r => r.name === 'steel')!
            expect(steel.count).toBe(2)
            expect(steel.volume).toBe(2e6)
            expect(steel.mass).toBeCloseTo(mgr.massKgFor(mgr.get('steel')!, 2e6)!, 6)
            expect(totals.total.mass).toBeCloseTo(
                totals.byMaterial.reduce((s, r) => s + r.mass, 0), 6)
        })

        it('counts shapes with no material as unaccounted rather than dropping them', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const totals = mgr.totals([matShape('steel', 1e6), { volume: () => 1e6 }])
            expect(totals.byMaterial).toHaveLength(1)
            expect(totals.total.unaccounted).toBe(1)
        })

        it('flags a material whose carbon could not be determined', () =>
        {
            const mgr = makeManager('metric', 'mm')
            const glass = mgr.totals([matShape('glass', 1e6)]).byMaterial[0]
            expect(glass.mass).toBeGreaterThan(0)   // mass is knowable
            expect(glass.carbon).toBeUndefined()    // carbon is not
            expect(glass.partial).toBe(true)
        })
    })
})
