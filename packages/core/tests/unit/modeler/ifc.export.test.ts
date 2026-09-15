/**
 * ifc.export.test.ts — the IFC4 file: text format primitives, GlobalIds, the building model and the
 * written file, on a small synthetic wall with a window.
 *
 * The file is checked three ways, because a writer and a reader can each be self-consistently wrong:
 *
 *  1. structure, by hand: every #reference resolves, GlobalIds are unique, every product has exactly one
 *     parent (a storey, the element it is part of, or the element an opening cuts);
 *  2. read back with web-ifc (a devDependency only): entity counts and geometry per product;
 *  3. schema validation with IfcOpenShell when IFCOPENSHELL_PYTHON points at a Python that has it
 *     (skipped otherwise; CI does not have it).
 *
 * The real house goes through the same checks in ifc.house.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { MaterialManager } from '../../../src/materials/MaterialManager'
import type { ArchiyouModules } from '../../../src/types'
import {
    formatReal, formatSPF, escapeSPFString, ifcGuid, buildIFC, SPFWriter,
} from '../../../src/modeler/IFC4Exporter'
import { parseIFC, structuralProblems, readBack, validateWithIfcOpenShell } from './ifc.helpers'

const OUTPUTS = join(__dirname, '../../outputs/modeler')

//// TESTS ////

describe('ISO 10303-21 values', () =>
{
    it('writes REALs with a decimal point', () =>
    {
        expect(formatReal(1)).toBe('1.')
        expect(formatReal(-2.5)).toBe('-2.5')
        expect(formatReal(0)).toBe('0.')
        expect(formatReal(-0)).toBe('0.')
        expect(formatReal(1e-5)).toBe('0.00001')
        expect(formatReal(1e-7)).toBe('1.E-07')
        expect(formatReal(1.5e21)).toBe('1.5E21')
    })

    it('escapes strings', () =>
    {
        expect(escapeSPFString("it's")).toBe("it''s")
        expect(escapeSPFString('a\\b')).toBe('a\\\\b')
        expect(escapeSPFString('Gebäude')).toBe('Geb\\X2\\00E4\\X0\\ude')
        expect(escapeSPFString('\u{1F3E0}')).toBe('\\X4\\0001F3E0\\X0\\')
    })

    it('writes every kind of value', () =>
    {
        expect(formatSPF(null)).toBe('$')
        expect(formatSPF('*')).toBe('*')
        expect(formatSPF({ int: 3 })).toBe('3')
        expect(formatSPF({ enum: 'ELEMENT' })).toBe('.ELEMENT.')
        expect(formatSPF({ ref: 12 })).toBe('#12')
        expect(formatSPF({ typed: 'IfcLabel', value: 'x' })).toBe("IFCLABEL('x')")
        expect(formatSPF([[0, 1], [2, 3]])).toBe('((0.,1.),(2.,3.))')
    })

    it('numbers entities in order', () =>
    {
        const f = new SPFWriter()
        expect(f.add('IfcCartesianPoint', [0, 0, 0])).toEqual({ ref: 1 })
        expect(f.add('IfcAxis2Placement3D', { ref: 1 }, null, null)).toEqual({ ref: 2 })
        expect(f.toString({ description: 'd', name: 'n', timestamp: 't', author: 'a', organization: 'o', application: 'p', schema: 'IFC4' }))
            .toContain('#2=IFCAXIS2PLACEMENT3D(#1,$,$);')
    })
})

describe('GlobalIds', () =>
{
    it('are 22 characters of the IFC alphabet, stable for a seed', () =>
    {
        const id = ifcGuid('Scene/wallFront')
        expect(id).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/)
        expect(ifcGuid('Scene/wallFront')).toBe(id)
        expect(ifcGuid('Scene/wallLeft')).not.toBe(id)
    })

    it('do not collide over many scene paths', () =>
    {
        const ids = new Set(Array.from({ length: 20000 }, (_, i) => ifcGuid(`Scene/wall${i % 7}/studs/stud${i}`)))
        expect(ids.size).toBe(20000)
    })
})

describe('IFC4 export of a synthetic wall', () =>
{
    let modeler: Modeler
    const PRODUCTS = ['IfcWall', 'IfcMember', 'IfcBuildingElementPart', 'IfcOpeningElement', 'IfcWindow', 'IfcDoor']

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        const annotator = new Annotator()
        const modules = { modeler, annotator, materials: new MaterialManager() } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
        mkdirSync(OUTPUTS, { recursive: true })
    })

    beforeEach(() => { modeler.reset(); modeler.units('mm') })

    /** A 3 m framed wall along x with a 600 x 1000 window at 900 */
    function wall(u = 1)
    {
        const shapes: any[] = []
        const add = (s: any, name: string, material?: string) => { s.name(name); if (material) s.material(material); shapes.push(s) }
        add(modeler.box(3000 * u, 200 * u, 38 * u).move(1500 * u, 0, 19 * u), 'bottomplate', 'softwood')
        add(modeler.box(3000 * u, 200 * u, 38 * u).move(1500 * u, 0, 2531 * u), 'topplate', 'softwood')
        ;[0, 1, 2, 3, 4].forEach(i => add(modeler.box(38 * u, 200 * u, 2474 * u).move((19 + i * 740) * u, 0, 1275 * u), `stud${i}`, 'softwood'))
        ;[0, 1, 2, 3].forEach(i => add(modeler.box(702 * u, 200 * u, 2474 * u).move((389 + i * 740) * u, 0, 1275 * u), `insulation${i}`, 'mineralwool'))
        shapes.push(modeler.polygon([[1000 * u, 100 * u, 900 * u], [1600 * u, 100 * u, 900 * u], [1600 * u, 100 * u, 1900 * u], [1000 * u, 100 * u, 1900 * u]]).hide().name('opening0'))
        modeler.group('wallSouth', ...shapes)
    }

    const PANEL = { units: 'mm' as const, name: 'panel', timestamp: 0 }

    it('builds a model with the right parents', () =>
    {
        wall()
        const { model } = buildIFC(modeler.scene(), PANEL)
        const wallEl = model.elements.find(e => e.entity === 'IfcWall')!
        expect(wallEl.parent).toEqual({ storey: 0 })
        expect(wallEl.bodies).toHaveLength(0)
        model.elements.filter(e => ['IfcMember', 'IfcBuildingElementPart'].includes(e.entity)).forEach(e => expect(e.parent).toEqual({ element: wallEl.key }))
        const opening = model.elements.find(e => e.entity === 'IfcOpeningElement')!
        expect(opening.parent).toEqual({ voids: wallEl.key })
        const window = model.elements.find(e => e.entity === 'IfcWindow')!
        expect(window.parent).toEqual({ storey: 0 })
        expect(window.fills).toBe(opening.key)
        expect(window.name).toBe('wallSouth window')
    })

    it('keeps faces as n-gons and welds their corners', () =>
    {
        wall()
        const { model } = buildIFC(modeler.scene(), PANEL)
        const stud = model.elements.find(e => e.name === 'stud0')!
        expect(stud.bodies).toHaveLength(1)
        expect(stud.bodies[0].faces).toHaveLength(6)
        expect(stud.bodies[0].points).toHaveLength(8)
        stud.bodies[0].faces.forEach(f => expect(f).toHaveLength(4))
        const opening = model.elements.find(e => e.entity === 'IfcOpeningElement')!
        const xs = opening.bodies[0].points.map(p => p[1])
        expect(Math.min(...xs)).toBeCloseTo(-110)
        expect(Math.max(...xs)).toBeCloseTo(110)
    })

    it('carries materials, quantities in SI and the classification evidence', () =>
    {
        wall()
        const { model } = buildIFC(modeler.scene(), PANEL)
        const stud = model.elements.find(e => e.name === 'stud0')!
        expect(stud.material).toBe('softwood')
        expect(stud.qto!.name).toBe('Qto_MemberBaseQuantities')
        expect(stud.qto!.netVolume).toBeCloseTo(0.038 * 0.2 * 2.474, 6)
        expect(stud.qto!.length).toBeCloseTo(2474)
        expect(stud.qto!.netWeight).toBeGreaterThan(5)
        expect(stud.properties.Classification).toBe('IfcMember.STUD')
        expect(stud.properties.EmbodiedCarbonKgCO2e).toBeTypeOf('number')
        const wallEl = model.elements.find(e => e.entity === 'IfcWall')!
        expect(wallEl.qto!.netVolume).toBeCloseTo(3 * 0.2 * 2.55, 2)
    })

    it('writes a structurally sound file', () =>
    {
        wall()
        const { text } = buildIFC(modeler.scene(), PANEL)
        writeFileSync(join(OUTPUTS, 'ifc.export.wall.ifc'), text)
        expect(structuralProblems(parseIFC(text), PRODUCTS)).toEqual([])
    })

    it('writes the same bytes twice', () =>
    {
        wall()
        const a = buildIFC(modeler.scene(), PANEL).text
        const b = buildIFC(modeler.scene(), PANEL).text
        expect(a).toBe(b)
    })

    it('declares the model unit and leaves the coordinates alone', () =>
    {
        wall()
        const mm = buildIFC(modeler.scene(), PANEL).text
        modeler.reset()
        modeler.units('m')
        wall(0.001)
        const m = buildIFC(modeler.scene(), { ...PANEL, units: 'm' }).text
        expect(mm).toContain("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)")
        expect(m).toContain("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")
        expect(mm).toMatch(/\(3000\.,-100\.,38\.\)/)
        expect(m).toMatch(/\(3\.,-0\.1,0\.038\)/)
    })

    it('reads back in web-ifc with every product and its geometry', async () =>
    {
        wall()
        const { text, classification } = buildIFC(modeler.scene(), PANEL)
        const back = await readBack(text)
        expect(back.count('IfcWall')).toBe(1)
        expect(back.count('IfcMember')).toBe(7)
        expect(back.count('IfcBuildingElementPart')).toBe(4)
        expect(back.count('IfcOpeningElement')).toBe(1)
        expect(back.count('IfcWindow')).toBe(1)
        expect(back.count('IfcRelFillsElement')).toBe(1)
        expect(back.count('IfcRelVoidsElement')).toBe(1)
        expect(back.count('IfcBuildingStorey')).toBe(1)
        // 11 solids with bodies (web-ifc does not mesh opening elements on their own)
        expect(back.productsWithGeometry).toBeGreaterThanOrEqual(11)
        expect(classification.products).toHaveLength(14)
    })

    it('passes IfcOpenShell schema validation (when IFCOPENSHELL_PYTHON is set)', () =>
    {
        wall()
        const path = join(OUTPUTS, 'ifc.export.wall.ifc')
        writeFileSync(path, buildIFC(modeler.scene(), PANEL).text)
        const log = validateWithIfcOpenShell(path)
        if (log === null) return
        expect(log).toEqual([])
    }, 300000)
})
