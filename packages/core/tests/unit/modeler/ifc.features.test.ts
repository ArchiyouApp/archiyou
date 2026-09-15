/**
 * ifc.features.test.ts — the IFC classifier on small synthetic scenes (fast, mesh kernel, no Runner).
 *
 * Covers the building blocks the house test relies on: name tokenising, shape features (class,
 * direction, fill), independence from model units, the host hierarchy (a stick is a stud in a wall
 * and a column on a storey), explicit tags, and the integrity of the IFC_ENTITIES table itself.
 * The real-model check is ifc.house.test.ts.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Runner } from '../../../src/runner/Runner'
import { Script } from '../../../src/Script'
import type { ArchiyouModules } from '../../../src/types'
import {
    tokeniseName, classifyScene, classifyTree, measureScene, explainIfc, entityOfTag, IFC_ENTITIES,
    type IfcClassification, type IfcProduct,
} from '../../../src/modeler/IFC4Exporter'

describe('tokeniseName', () =>
{
    it.each([
        ['openingKingStudLeft', 'stud', ['opening', 'king', 'stud']],
        ['purlinsBlocksFront', 'block', ['purlin', 'block']],
        ['joistHeaderLeft', 'header', ['joist', 'header']],
        ['./timberwall_insulation3', 'insulation', ['insulation']],
        ['wallBack[1]', 'wall', ['wall']],
        ['bottom plate', 'plate', ['plate']],
        ['rafterFaciaFront', 'facia', ['rafter', 'facia']],
    ])('%s -> head %s', (raw, head, tokens) =>
    {
        const name = tokeniseName(raw, raw.startsWith('./timberwall_') ? './timberwall_' : undefined)
        expect(name.head).toBe(head)
        expect(name.tokens).toEqual(tokens)
    })

    it('marks plural heads, which make a layer a group rather than an element', () =>
    {
        expect(tokeniseName('walls').plural).toBe(true)
        expect(tokeniseName('wall').plural).toBe(false)
        expect(tokeniseName('glass').plural).toBe(false)
    })
})

describe('entityOfTag', () =>
{
    it('reads short and full tags, and ignores other namespaces', () =>
    {
        expect(entityOfTag('ifc:wall')).toBe('IfcWall')
        expect(entityOfTag('ifc:IfcMember')).toBe('IfcMember')
        expect(entityOfTag('ifc:storey')).toBe('IfcBuildingStorey')
        expect(entityOfTag('btlx:sawCut')).toBe(null)
        expect(entityOfTag('ifc:nonsense')).toBe(null)
    })
})

describe('IFC_ENTITIES table', () =>
{
    const entities = Object.keys(IFC_ENTITIES)
    const spatial = ['IfcBuilding', 'IfcSite', '*']

    it('only names hosts that exist', () =>
    {
        Object.entries(IFC_ENTITIES).forEach(([entity, rule]) =>
            rule.hosts.forEach(h => expect(entities.includes(h) || spatial.includes(h), `${entity} host ${h}`).toBe(true)))
    })

    it('gives every entity a way to be found', () =>
    {
        Object.entries(IFC_ENTITIES).forEach(([entity, rule]) =>
            expect(!!(rule.name || rule.shape || rule.children), entity).toBe(true))
    })

    it('uses upper-case PredefinedTypes everywhere', () =>
    {
        Object.entries(IFC_ENTITIES).forEach(([entity, rule]) =>
        {
            Object.keys(rule.subclass ?? {}).forEach(t => expect(t, entity).toMatch(/^[A-Z_]+$/))
            Object.values(rule.name ?? {}).filter(Boolean).forEach(v => expect(v!, entity).toMatch(/^[A-Z_]+(:[A-Z_]+)?$/))
        })
    })
})

describe('classification of synthetic scenes', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        const annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    // reset() keeps the units, and one test switches to centimetres
    beforeEach(() => { modeler.reset(); modeler.units('mm') })

    const classify = (): IfcClassification => classifyScene(modeler.scene(), { units: modeler.units() }).result
    const one = (r: IfcClassification, label: RegExp): IfcProduct =>
    {
        const hits = r.products.filter(p => label.test(p.label))
        expect(hits, explainIfc(r)).toHaveLength(1)
        return hits[0]
    }
    const kind = (p: IfcProduct) => `${p.entity}.${p.predefinedType}`

    /** A 3 m timber-frame panel along x, 200 deep, 2550 tall, with deliberately unhelpful names (u = mm) */
    function panel(u = 1): any[]
    {
        const shapes: any[] = []
        const add = (s: any, name: string) => { s.name(name); shapes.push(s); return s }
        add(modeler.box(3000 * u, 200 * u, 38 * u).move(1500 * u, 0, 19 * u), 'a')
        add(modeler.box(3000 * u, 200 * u, 38 * u).move(1500 * u, 0, 2531 * u), 'b')
        ;[0, 1, 2, 3, 4].forEach(i =>
            add(modeler.box(38 * u, 200 * u, 2474 * u).move((19 + i * 740) * u, 0, 1275 * u), `c${i}`))
        ;[0, 1, 2, 3].forEach(i =>
            add(modeler.box(702 * u, 200 * u, 2474 * u).move((389 + i * 740) * u, 0, 1275 * u), `d${i}`))
        return shapes
    }

    it('recognises a framed wall by composition, and its parts by shape', () =>
    {
        modeler.group('panel', ...panel())
        const r = classify()
        const wall = one(r, /^panel$/)
        expect(kind(wall)).toBe('IfcWall.ELEMENTEDWALL')
        expect(wall.via).toBe('children')
        r.products.filter(p => /\/c\d$/.test(p.label)).forEach(p => expect(kind(p), p.label).toBe('IfcMember.STUD'))
        r.products.filter(p => /\/[ab]$/.test(p.label)).forEach(p => expect(kind(p), p.label).toBe('IfcMember.PLATE'))
        r.products.filter(p => /\/d\d$/.test(p.label)).forEach(p => expect(kind(p), p.label).toBe('IfcBuildingElementPart.INSULATION'))
        expect(r.products).toHaveLength(12)
    })

    /** A hidden opening rectangle in the panel plane, like make.wall() keeps */
    function opening(name: string, sill: number, height: number, left = 1000, width = 600): any
    {
        return modeler.polygon([[left, 100, sill], [left + width, 100, sill], [left + width, 100, sill + height], [left, 100, sill + height]]).hide().name(name)
    }

    it.each([
        ['a raised opening', 'opening0', 900, 1200, 'IfcWindow.WINDOW'],
        ['a tall opening at the floor', 'opening0', 50, 2100, 'IfcDoor.DOOR'],
        ['a low opening at the floor', 'opening0', 50, 800, null],
        ['a 1600 opening at the floor, below the door height', 'opening0', 50, 1600, null],
        ['an 1800 opening at the floor, the door height', 'opening0', 50, 1800, 'IfcDoor.DOOR'],
        ['an opening named as a door, whatever its height', 'doorOpening', 900, 1200, 'IfcDoor.DOOR'],
    ])('fills %s', (_, name, sill, height, expected) =>
    {
        modeler.group('panel', ...panel(), opening(name as string, sill as number, height as number))
        const r = classify()
        expect(r.products.filter(p => p.entity === 'IfcOpeningElement'), explainIfc(r)).toHaveLength(1)
        const fillings = r.products.filter(p => p.fills)
        expect(fillings.map(kind)).toEqual(expected ? [expected] : [])
        fillings.forEach(f => expect(r.products.find(p => p.path === f.host)?.entity).toBe('IfcWall'))
    })

    it('makes the same stick a column when it stands on the storey', () =>
    {
        modeler.box(100, 100, 2600).move(0, 0, 1300).name('thing')
        const r = classify()
        const p = one(r, /^thing$/)
        expect(kind(p)).toBe('IfcColumn.COLUMN')
        expect(p.host).toBe('Scene')
    })

    it('trusts a name over geometry for a leaf, and keeps the geometric verdict as the alternative', () =>
    {
        modeler.box(100, 100, 2600).move(0, 0, 1300).name('beam')
        const p = one(classify(), /^beam$/)
        expect(kind(p)).toBe('IfcBeam.BEAM')
        expect(p.alternative).toBe('IfcColumn')
    })

    it('trusts composition over a name for a layer, and reports the conflict', () =>
    {
        modeler.group('roof', ...panel())
        const p = one(classify(), /^roof$/)
        expect(p.entity).toBe('IfcWall')
        expect(p.conflict).toMatch(/'roof' says IfcRoof/)
    })

    it('lets an explicit tag win over everything', () =>
    {
        const post = modeler.box(100, 100, 2600).move(0, 0, 1300).name('column') as any
        post.metadata.is = { tag: 'ifc:member', opts: { predefinedType: 'POST' } }
        const p = one(classify(), /^column$/)
        expect(kind(p)).toBe('IfcMember.POST')
        expect(p.origin).toBe('explicit')
    })

    it('classifies the same model identically in millimetres and centimetres', () =>
    {
        modeler.group('panel', ...panel())
        const mm = classify().products.map(kind)
        modeler.reset()
        modeler.units('cm')
        modeler.group('panel', ...panel(0.1))
        const cm = classify().products.map(kind)
        expect(cm).toEqual(mm)
    })

    it('stops calling a cut box a box, although its subtype still says Box', () =>
    {
        // a diamond cutter across the top takes a sloped bite out of the post (like a gable cut)
        const post = modeler.box(38, 200, 1000).move(0, 0, 500).name('post') as any
        const cutter = modeler.box(100, 1000, 1000).rotateX(45).move(0, 100, 1000).hide()
        post.subtract(cutter)
        const { tree, result } = classifyScene(modeler.scene(), { units: 'mm' })
        const p = one(result, /post/)
        expect(p.evidence).toMatch(/not a box/)
        expect(tree.root.children.find(c => c.name === 'post')?.shape?.subtype).toBe('Box')
    })

    it('skips hidden solids as boolean tools, and curves as drawings', () =>
    {
        modeler.box(100, 100, 100).hide()
        modeler.line([0, 0, 0], [1000, 0, 0])
        const r = classify()
        expect(r.products).toHaveLength(0)
        expect(r.skipped.map(s => s.reason).sort()).toEqual(['curve', 'hidden solid (a boolean tool)'])
    })

    it('classifies a measured tree again without the scene', () =>
    {
        modeler.group('panel', ...panel())
        const tree = JSON.parse(JSON.stringify(measureScene(modeler.scene(), 'mm')))
        expect(classifyTree(tree).products.map(kind)).toEqual(classify().products.map(kind))
    })
})

describe('explainIFC() in a script', () =>
{
    it('is loaded on demand: a direct Modeler call asks for loadIFC() first', async () =>
    {
        // runs before anything in this file loads the IFC module through the Modeler
        const modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        modeler.box(100, 100, 2600)
        expect(() => modeler.explainIFC()).toThrow(/await modeler\.loadIFC\(\) first/)
        await modeler.loadIFC()
        expect(modeler.explainIFC()).toMatch(/IfcColumn\.COLUMN/)
    }, 60000)

    it('prints the classification to the user console, without await', async () =>
    {
        const runner = await new Runner().load()
        const result: any = await runner.execute({
            script: Script.fromData({ name: 'ifc-explain', code: `thing = box(100, 100, 2600); explainIFC();` })!,
            params: {},
            outputs: ['default/model/gltf'],
            messages: ['user'],
        } as any)
        expect(result.status).toBe('success')
        const text = (result.messages ?? []).filter((m: any) => m.type === 'user').map((m: any) => m.message).join('\n')
        expect(text).toMatch(/thing\s+IfcColumn\.COLUMN/)
    }, 60000)
})
