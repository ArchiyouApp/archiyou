/**
 * ifc.house.test.ts — automatic IFC classification of the real `archiyou/housetest` model.
 *
 * Two halves, so tuning stays fast:
 *
 *  1. SLOW: run the house script (with its `./timberwall` and `./urroof` components) and measure the
 *     scene into a plain feature tree. The tree is checked in as fixtures/house/housetest.features.json
 *     and this half only asserts that a fresh run still measures the same. A change in make.wall()
 *     or the components shows up here as a fixture diff. Refresh with IFC_UPDATE_FIXTURES=1.
 *
 *  2. FAST: classify the checked-in tree (milliseconds, no geometry). The readable result is a file
 *     snapshot, fixtures/house/housetest.ifc-classes.txt (refresh with `vitest -u`), and the
 *     meaning is pinned by contract assertions that do not care about evidence wording.
 *
 * Settings under test: IFC_ENTITIES and TUNING in src/modeler/IFC4Exporter.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import type { ScriptData } from '../../../src/ScriptSchema'
import { measureScene, classifyTree, explainIfc, ifcHistogram, type FeatureTree, type IfcClassification } from '../../../src/modeler/IFC4Exporter'
import { parseIFC, structuralProblems, readBack, validateWithIfcOpenShell } from './ifc.helpers'

const FIXTURES = join(__dirname, '../../fixtures/house')
const FEATURES = join(FIXTURES, 'housetest.features.json')
const UPDATE = !!process.env.IFC_UPDATE_FIXTURES

/** The author's saved configuration, the same as house.production.test.ts */
const PARAMS = { WIDTH: 2500, DEPTH: 4000, WALL_HEIGHT: 2550, ROOF_HEIGHT: 1997, OVERHANG_SIDE: 377, OVERHANG_FRONT: 554 }

const fixtureData = (name: string): ScriptData => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

function fixture(name: string): Script
{
    const script = Script.fromData(fixtureData(name))
    if (!script) throw new Error(`fixture "${name}" failed Script validation`)
    return script
}

describe('housetest — measured features match the checked-in tree', () =>
{
    let measured: FeatureTree

    beforeAll(async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([fixture('timberwall'), fixture('urroof')])
        const result = await runner.execute({ script: fixtureData('housetest'), params: PARAMS, outputs: ['default/model/glb'] } as any)
        if (result.status !== 'success') throw new Error(`housetest failed: ${JSON.stringify(result.errors ?? []).slice(0, 600)}`)
        const modeler = runner.getScope('default').modeler
        measured = measureScene(modeler.scene(), modeler.units())
        if (UPDATE || !existsSync(FEATURES)) writeFileSync(FEATURES, JSON.stringify(measured, null, 1) + '\n')
    }, 900000)

    it('measures the same scene as the fixture', () =>
    {
        const stored = JSON.parse(readFileSync(FEATURES, 'utf8'))
        expect(JSON.parse(JSON.stringify(measured))).toEqual(stored)
    })
})

describe('housetest — classification', () =>
{
    let tree: FeatureTree
    let result: IfcClassification
    const byLabel = (label: RegExp) => result.products.filter(p => label.test(p.label))
    const kind = (p: { entity: string; predefinedType: string }) => `${p.entity}.${p.predefinedType}`

    beforeAll(() =>
    {
        tree = JSON.parse(readFileSync(FEATURES, 'utf8'))
        result = classifyTree(tree)
    })

    it('reads as the checked-in explanation', async () =>
    {
        await expect(explainIfc(result)).toMatchFileSnapshot('../../fixtures/house/housetest.ifc-classes.txt')
    })

    it('synthesises exactly one storey at ground level', () =>
    {
        expect(result.storeys).toEqual([{ name: 'Storey 0', path: null, elevation: 0, synthesised: true }])
    })

    it('finds four framed walls, keyed by their component roots', () =>
    {
        const walls = result.products.filter(p => p.entity === 'IfcWall')
        expect(walls.map(w => w.label).sort()).toEqual(['wallBack[0]', 'wallFront', 'wallLeft', 'wallRight'])
        walls.forEach(w => expect(w.predefinedType).toBe('ELEMENTEDWALL'))
        walls.forEach(w => expect(w.via).toBe('children'))
    })

    it('finds the roof by composition and reports that its name says wall', () =>
    {
        const roofs = result.products.filter(p => p.entity === 'IfcRoof')
        expect(roofs).toHaveLength(1)
        expect(roofs[0].path).toBe('Scene/wallBack%5B1%5D')
        expect(roofs[0].predefinedType).toBe('GABLE_ROOF')
        expect(roofs[0].conflict).toMatch(/IfcWall/)
        expect(result.products.filter(p => p.conflict)).toHaveLength(1)
    })

    it('never makes the wrapper layer of make.wall() a product', () =>
    {
        expect(result.products.some(p => /timberwall_wall$/.test(decodeURIComponent(p.path)))).toBe(false)
    })

    it('classifies the wall framing', () =>
    {
        byLabel(/(^|\/)stud\d*$|endstud$|KingStud|Jack|cripple/i).forEach(p => expect(kind(p), p.label).toBe('IfcMember.STUD'))
        byLabel(/plate$|plate(Left|Right)$/i).forEach(p => expect(kind(p), p.label).toBe('IfcMember.PLATE'))
        byLabel(/insulation\d*(\[\d+\])?$/).forEach(p => expect(kind(p), p.label).toBe('IfcBuildingElementPart.INSULATION'))
        expect(byLabel(/\/stud\d*$/)).toHaveLength(20)
        expect(byLabel(/insulation\d*(\[\d+\])?$/)).toHaveLength(30)
    })

    it('frames the openings with a lintel above and a sill below', () =>
    {
        const horizontals = byLabel(/openingHorizontal(\[\d+\])?$/)
        expect(horizontals).toHaveLength(4)
        expect(horizontals.filter(p => kind(p) === 'IfcBeam.LINTEL')).toHaveLength(2)
        expect(horizontals.filter(p => p.objectType === 'SILL')).toHaveLength(2)
    })

    it('keeps the hidden opening polygons as opening elements of their wall', () =>
    {
        const openings = result.products.filter(p => p.entity === 'IfcOpeningElement')
        expect(openings.length).toBeGreaterThan(0)
        openings.forEach(o => expect(result.products.find(p => p.path === o.host)?.entity).toBe('IfcWall'))
    })

    it('fills the left opening with a window, and reports the front opening as too low for a door', () =>
    {
        // housetest: front wall OPENING_SILL 100, OPENING_HEIGHT 1600 (below DOOR_MIN_HEIGHT_MM 1800);
        // left wall OPENING_SILL 500, OPENING_HEIGHT 1000
        const fillings = result.products.filter(p => p.fills)
        const summary = fillings.map(f => [result.products.find(p => p.path === f.host)!.label, kind(f)])
        expect(summary).toEqual([['wallLeft', 'IfcWindow.WINDOW']])
        const unfilled = result.skipped.filter(s => s.reason === 'opening without a door or window')
        expect(unfilled.map(s => decodeURIComponent(s.path))).toEqual(['Scene/wallFront/./timberwall_wall/./timberwall_openingDiagrams/./timberwall_opening0'])
        fillings.forEach(f => expect(result.products.find(p => p.path === f.fills)?.entity).toBe('IfcOpeningElement'))
    })

    it('classifies the roof structure', () =>
    {
        byLabel(/rafter\d*$|rafterFacia/).forEach(p => expect(kind(p), p.label).toBe('IfcMember.RAFTER'))
        byLabel(/purlin\d$/).forEach(p => expect(kind(p), p.label).toBe('IfcMember.PURLIN'))
        byLabel(/purlinsBlocks/).forEach(p => expect(p.objectType, p.label).toBe('BLOCKING'))
    })

    it('leaves nothing unclassified', () =>
    {
        expect(result.products.filter(p => p.entity === 'IfcBuildingElementProxy').map(p => p.label)).toEqual([])
        expect(result.products.filter(p => p.entity === 'IfcElementAssembly').map(p => p.label)).toEqual([])
    })

    it('skips drawings, diagrams and the iso projection', () =>
    {
        // The roof script draws one real rafter into its diagram layer; that one is a product. The opening
        // polygons live in make.wall()'s openingDiagrams layer and are products too.
        const fromOpenings = ['IfcOpeningElement', 'IfcDoor', 'IfcWindow']
        const fromDrawings = result.products.filter(p => !fromOpenings.includes(p.entity) && /iso|diagram|gridline/i.test(p.path))
        expect(fromDrawings.map(p => p.label)).toEqual(['diagram/rafter1'])
        expect(result.skipped.some(s => s.path === 'Scene/iso')).toBe(true)
    })

    it('keeps the mirrored ridge purlin as a shape of its own', () =>
    {
        // urroof mirrors all purlins, the ridge purlin lands on itself; both are exported
        expect(byLabel(/purlin2$/).map(p => p.label).sort()).toEqual(['purlins/purlin2', 'purlinsRight/purlin2'])
    })

    it('has a stable entity histogram', () =>
    {
        expect(ifcHistogram(result)).toMatchSnapshot()
    })
})

describe('housetest — IFC4 file through the Runner', () =>
{
    const OUTPUT = join(__dirname, '../../outputs/runner/housetest.ifc')
    let text: string
    let expected: Record<string, number>

    beforeAll(async () =>
    {
        const runner = await new Runner().load()
        runner.linkComponentScripts([fixture('timberwall'), fixture('urroof')])
        const result = await runner.execute({ script: fixtureData('housetest'), params: PARAMS, outputs: ['default/model/ifc'] } as any)
        if (result.status !== 'success') throw new Error(`housetest failed: ${JSON.stringify(result.errors ?? []).slice(0, 600)}`)
        text = result.outputs?.find((o: any) => o.path?.requestedPath === 'default/model/ifc')?.output as string
        mkdirSync(join(__dirname, '../../outputs/runner'), { recursive: true })
        writeFileSync(OUTPUT, text ?? '')
        expected = ifcHistogram(classifyTree(JSON.parse(readFileSync(FEATURES, 'utf8'))))
    }, 900000)

    const total = (entity: string) => Object.entries(expected).filter(([k]) => k.startsWith(`${entity}.`)).reduce((a, [, n]) => a + n, 0)
    const ENTITIES = ['IfcWall', 'IfcRoof', 'IfcMember', 'IfcBeam', 'IfcBuildingElementPart', 'IfcOpeningElement', 'IfcWindow', 'IfcDoor']

    it('writes a structurally sound IFC4 file', () =>
    {
        expect(text?.startsWith('ISO-10303-21;')).toBe(true)
        expect(structuralProblems(parseIFC(text), ENTITIES)).toEqual([])
    })

    it('holds the same products as the classification of the measured scene', async () =>
    {
        // the Runner records recipes for IFC, so boxes are measured exactly: the verdicts must not change
        const back = await readBack(text)
        ENTITIES.forEach(entity => expect(back.count(entity), entity).toBe(total(entity)))
        expect(back.count('IfcBuildingStorey')).toBe(1)
        expect(back.count('IfcRelVoidsElement')).toBe(2)
        expect(back.count('IfcRelFillsElement')).toBe(1)
    })

    it('gives every solid part its geometry', async () =>
    {
        const back = await readBack(text)
        const solids = total('IfcMember') + total('IfcBeam') + total('IfcBuildingElementPart')
        expect(back.productsWithGeometry).toBeGreaterThanOrEqual(solids)
        expect(back.vertices).toBeGreaterThan(solids * 8)
    })

    it('passes IfcOpenShell schema validation (when IFCOPENSHELL_PYTHON is set)', () =>
    {
        const log = validateWithIfcOpenShell(OUTPUT)
        if (log === null) return
        expect(log).toEqual([])
    }, 300000)
})
