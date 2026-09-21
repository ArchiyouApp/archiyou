/** Part identification: measuring, merging and labelling the solids of a model.
 *
 *  Two callers share one classifier. `Make.partList()` turns it into a cut list — beams and
 *  plates only, because that is what a cut list is for. `docs.instruct` needs a label on EVERY
 *  visible solid, because a manual step cannot point at a part that has no name. The shared
 *  half lives in modeler/parts.ts and each caller filters it its own way.
 *
 *  The `partList` block was written BEFORE that extraction and pins the rows it produced, so
 *  the refactor could not quietly change anyone's cut list.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { collectParts, measurePart, labelForIndex, nonPartCount } from '../../../src/modeler/parts'
import type { ArchiyouModules } from '../../../src/types'

let modeler: Modeler
let calc: Calc

/** A small frame: 4 identical legs, 2 long rails, 2 short rails, 1 top panel — plus a cube
 *  (neither beam nor plate) and a curve (not a solid at all), which the two callers treat
 *  differently. */
async function buildFrame()
{
    modeler = new Modeler()
    await modeler.load()
    calc = new Calc()
    const modules = { modeler, calc } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    calc.setArchiyou(modules)

    modeler.group('legs',
        ...[0, 1, 2, 3].map(i => modeler.box(44, 44, 700)
            .moveToX(i % 2 ? 560 : 0).moveToY(i < 2 ? 1180 : 0).name('leg')))

    modeler.group('frame',
        ...[0, 1].map(i => modeler.box(1180, 44, 20).moveToY(i * 500).name('rail long')),
        ...[0, 1].map(i => modeler.box(560, 44, 20).moveToX(i * 500).moveToZ(100).name('rail short')))

    // 1200x900x18: unambiguously a plate. At 1200x600 it would be a BEAM — dims sort to
    // [18,600,1200] and length/width lands exactly on BEAM_RATIO, which is tested first.
    modeler.group('top', modeler.box(1200, 900, 18).moveToZ(720).name('panel'))

    // not in a cut list: a cube-ish block is neither beam nor plate, a curve is not a solid
    modeler.box(50, 50, 50).name('cube')
    modeler.rect(100, 100).name('outline')
}

const rowsOf = (table: any) => table.toData()

describe('Make.partList (pinned before the parts.ts extraction)', () =>
{
    beforeEach(async () => { await buildFrame() })

    it('keeps its columns, in order', () =>
    {
        const table = modeler.make.partList(modeler.all(), 'parts') as any
        expect(table.columns())
            .toEqual(['part', 'subpart', 'type', 'section', 'length', 'quantity'])
    })

    it('merges identical parts and counts them, one row per distinct part', () =>
    {
        const table = modeler.make.partList(modeler.all(), 'parts') as any
        const rows = rowsOf(table)

        /*  legs ×4, rail long ×2, rail short ×2, panel ×1. The cube is neither beam nor plate
            and the curve is not a solid, so neither reaches a cut list.

            `part` is 'main' for all of them because `modeler.all()` is a FLAT collection —
            group names come from the collection's own groups (ShapeCollection.forEachGroup
            falls back to 'main'), not from the scene's layers. See the grouped test below. */
        expect(rows.map((r: any) => [r.part, r.subpart, r.type, r.section, r.length, r.quantity]))
            .toEqual([
                ['main', 'leg',        'beam',  '44x44',   700, 4],
                ['main', 'rail long',  'beam',  '44x20',  1180, 2],
                ['main', 'rail short', 'beam',  '44x20',   560, 2],
                ['main', 'panel',      'plate', '900x18', 1200, 1],
            ])
    })

    it('takes `part` from the collection group when the collection has groups', () =>
    {
        const grouped = modeler.collection() as any
        grouped.addGroup('legs', modeler.all().toArray().filter((s: any) => s.name?.() === 'leg'))
        grouped.addGroup('top', modeler.all().toArray().filter((s: any) => s.name?.() === 'panel'))

        const rows = rowsOf(modeler.make.partList(grouped, 'grouped') as any)
        expect(rows.map((r: any) => [r.part, r.subpart, r.quantity]))
            .toEqual([['legs', 'leg', 4], ['top', 'panel', 1]])
    })

    it('classifies on the oriented bbox, so a rotated beam is still a beam', () =>
    {
        const rotated = modeler.collection(modeler.box(44, 44, 700).rotateX(37).name('tilted')) as any
        const rows = rowsOf(modeler.make.partList(rotated, 'rotated') as any)
        expect(rows.map((r: any) => [r.type, r.section, r.length])).toEqual([['beam', '44x44', 700]])
    })

    it('skips hidden shapes', () =>
    {
        modeler.all().toArray().filter((s: any) => s.name?.() === 'leg').forEach((s: any) => s.hide())
        const rows = rowsOf(modeler.make.partList(modeler.all(), 'parts') as any)
        expect(rows.map((r: any) => r.subpart)).not.toContain('leg')
    })

    it('adds a total-length footer grouped by type and section', () =>
    {
        const table = modeler.make.partList(modeler.all(), 'parts') as any
        const footers = table.computeFooterRows()
        expect(footers.length).toBeGreaterThan(0)
        // legs: 4 × 700 = 2800
        expect(footers.map((f: any) => f.values.length)).toContain(2800)
    })

    it('names the table after the collection when no name is given', () =>
    {
        modeler.make.partList(modeler.all())
        expect(calc.tables()).toContain('parts')
    })
})

describe('measurePart', () =>
{
    beforeEach(async () => { await buildFrame() })

    it('classifies a long shape as a beam and a thin one as a plate', () =>
    {
        expect(measurePart(modeler.box(44, 44, 700))?.kind).toBe('beam')
        expect(measurePart(modeler.box(1200, 900, 18))?.kind).toBe('plate')
    })

    it('calls a shape that is neither a block, rather than dropping it', () =>
    {
        // Not cut-list material, but instruct still has to be able to point at it
        expect(measurePart(modeler.box(50, 50, 50))?.kind).toBe('block')
    })

    it('is null for anything with no measurable volume', () =>
    {
        expect(measurePart(modeler.rect(100, 100))).toBeNull()
        expect(measurePart(modeler.line([0, 0, 0], [10, 0, 0]))).toBeNull()
        expect(measurePart(undefined)).toBeNull()
    })

    it('sorts its dimensions ascending, whatever order the box was made in', () =>
    {
        // toBeCloseTo, not toEqual: an OBB is fitted, so its dims carry float residue
        const m = measurePart(modeler.box(700, 20, 44))!
        expect(m.thickness).toBeCloseTo(20, 6)
        expect(m.width).toBeCloseTo(44, 6)
        expect(m.length).toBeCloseTo(700, 6)
    })
})

describe('labelForIndex', () =>
{
    it('runs A..Z then AA, AB', () =>
    {
        expect([0, 1, 25, 26, 27, 51, 52].map(i => labelForIndex(i, 'alpha')))
            .toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA'])
    })

    it('can count instead', () =>
    {
        expect([0, 1, 9].map(i => labelForIndex(i, 'numeric'))).toEqual(['1', '2', '10'])
    })
})

describe('collectParts', () =>
{
    beforeEach(async () => { await buildFrame() })

    it('labels every visible solid of the scene, blocks included', () =>
    {
        const parts = collectParts(modeler.scene())

        // legs, rail long, rail short, panel, cube — the curve is not a part
        expect(parts.map(p => [p.label, p.name, p.quantity]))
            .toEqual([
                ['A', 'leg', 4],
                ['B', 'rail long', 2],
                ['C', 'rail short', 2],
                ['D', 'panel', 1],
                ['E', 'cube', 1],
            ])
        expect(parts.map(p => p.measure.kind))
            .toEqual(['beam', 'beam', 'beam', 'plate', 'block'])
    })

    it('takes the group from the scene layer a shape lives in', () =>
    {
        const parts = collectParts(modeler.scene())
        const byName = new Map(parts.map(p => [p.name, p.group]))

        expect(byName.get('leg')).toBe('legs')
        expect(byName.get('rail long')).toBe('frame')
        expect(byName.get('panel')).toBe('top')
        expect(byName.get('cube')).toBe('')      // not in a layer of its own
    })

    it('carries one scene path per instance, which is what the GLB needs', () =>
    {
        const legs = collectParts(modeler.scene()).find(p => p.name === 'leg')!

        expect(legs.paths).toHaveLength(4)
        // four shapes all named 'leg' — the paths are what tells them apart
        expect(new Set(legs.paths).size).toBe(4)
        legs.paths.forEach(path => expect(path.startsWith('Scene/')).toBe(true))
    })

    it('skips hidden shapes unless asked', () =>
    {
        modeler.all().toArray().filter((s: any) => s.name?.() === 'cube').forEach((s: any) => s.hide())

        expect(collectParts(modeler.scene()).map(p => p.name)).not.toContain('cube')
        expect(collectParts(modeler.scene(), { includeHidden: true }).map(p => p.name)).toContain('cube')
    })

    it('counts what it looked at and rejected', () =>
    {
        expect(nonPartCount(modeler.scene())).toBe(1)   // the rect
    })

    describe('ordering', () =>
    {
        it('is by group first, so a size change does not renumber the manual', async () =>
        {
            const before = collectParts(modeler.scene()).map(p => [p.label, p.name])

            /*  Make a rail longer than a leg. Under size ordering B would become A and every
                "fit part B" in the prose would now point at the wrong thing. */
            await buildFrame()
            modeler.all().toArray()
                .filter((s: any) => s.name?.() === 'rail long')
                .forEach((s: any) => s.scale([3, 1, 1]))

            expect(collectParts(modeler.scene()).map(p => [p.label, p.name])).toEqual(before)
        })

        it('can be asked for size order instead', () =>
        {
            const parts = collectParts(modeler.scene(), { order: 'size' })
            const volumes = parts.map(p => p.measure.volume)
            expect(volumes).toEqual([...volumes].sort((a, b) => b - a))
        })
    })

    describe('pinned labels', () =>
    {
        it('honours a pin by shape and works around it', () =>
        {
            const panel = modeler.all().toArray().find((s: any) => s.name?.() === 'panel')
            const parts = collectParts(modeler.scene(), { pinned: new Map([[panel, 'A']]) })
            const byName = new Map(parts.map(p => [p.name, p.label]))

            expect(byName.get('panel')).toBe('A')
            // A is taken, so the rest start at B and no label is used twice
            expect(byName.get('leg')).toBe('B')
            expect(new Set(parts.map(p => p.label)).size).toBe(parts.length)
        })

        it('honours a pin by group name', () =>
        {
            const parts = collectParts(modeler.scene(), { pinned: new Map([['top', 'Z']]) })
            expect(parts.find(p => p.group === 'top')!.label).toBe('Z')
        })
    })

    it('merges by group as well as by size, so the same beam in two assemblies is two parts', () =>
    {
        modeler.group('spare', modeler.box(44, 44, 700).name('leg'))
        const parts = collectParts(modeler.scene()).filter(p => p.name === 'leg')

        expect(parts.map(p => [p.group, p.quantity])).toEqual([['legs', 4], ['spare', 1]])
    })
})
