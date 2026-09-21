/**
 * btlx.test.ts
 *
 * BTLx 2.3 export (src/modeler/BTLxExporter.ts, plans/FAB.md phase 5): parts with their angled saw cuts and
 * drillings, read from fab.operations(). Mesh kernel.
 *
 * The numbers are checked by building the geometry back from them, the way compas_timber reads a BTLx file
 * (JackRafterCut.plane_from_params_and_beam, Drilling.cylinder_from_params_and_element), and comparing it with
 * the model. So a swapped angle or a flipped side fails here even when the file looks plausible.
 *
 * Schema: the files this test writes (tests/outputs/modeler/btlx.*.btlx) were validated against the official
 * BTLx_2_3_0.xsd from design2machine.com with lxml on 2026-09-16, and all were valid. The test only checks that
 * the XML is well formed, since core has no XSD validator. To check again:
 *   python -c "import lxml.etree as e; s = e.XMLSchema(e.parse('BTLx_2_3_0.xsd')); print(s.validate(e.parse('file.btlx')), s.error_log)"
 * (the XSD includes x3d-3.3.xsd, which includes xmldsig-core-schema.xsd; download them next to it.)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { buildBTLx } from '../../../src/modeler/BTLxExporter'
import type { SawCut, Drilling } from '../../../src/modeler/Fab'
import { installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording } from '../../../src/modeler/Recipe'
import { save } from '@archiyou/meshup/src/utils'

const TEST_OUTPUT_DIR = './tests/outputs/modeler'
const DAY = '2026-09-16'

type V = [number, number, number]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a))
const neg = (a: V): V => scale(a, -1)

/** Rotate v about the unit axis k by deg degrees, right-handed (Rodrigues) */
function rotate(v: V, k: V, deg: number): V
{
    const a = deg * Math.PI / 180
    return add(add(scale(v, Math.cos(a)), scale(cross(k, v), Math.sin(a))), scale(k, dot(k, v) * (1 - Math.cos(a))))
}

async function newModeler(): Promise<Modeler>
{
    const modeler = new Modeler()
    await modeler.load()
    await modeler.loadFab()
    const calc = new Calc()
    const modules = { modeler, calc } as any
    calc.setArchiyou(modules)
    modeler.setArchiyou(modules)
    return modeler
}

//// READING A FILE BACK ////

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    isArray: name => ['Part', 'Transformation', 'JackRafterCut', 'Drilling'].includes(name),
})

interface PartIn
{
    attrs: Record<string, string>
    length: number
    height: number
    width: number
    count: number
    transformations: Array<{ guid: string, origin: V, x: V, y: V, z: V }>
    cuts: any[]
    drills: any[]
}

function readFile(text: string): { root: any, parts: PartIn[] }
{
    expect(XMLValidator.validate(text)).toBe(true)
    const root = parser.parse(text).BTLx
    const vec = (o: any): V => [Number(o.X), Number(o.Y), Number(o.Z)]
    const parts = (root.Project.Parts.Part as any[]).map(p => ({
        attrs: p,
        length: Number(p.Length),
        height: Number(p.Height),
        width: Number(p.Width),
        count: Number(p.Count),
        transformations: (p.Transformations.Transformation as any[]).map(t =>
        {
            const x = vec(t.Position.XVector), y = vec(t.Position.YVector)
            return { guid: t.GUID, origin: vec(t.Position.ReferencePoint), x, y, z: cross(x, y) }
        }),
        cuts: p.Processings?.JackRafterCut ?? [],
        drills: p.Processings?.Drilling ?? [],
    }))
    return { root, parts }
}

type Placement = PartIn['transformations'][number]

/** Reference sides as compas_timber builds them: point, x, y, and the outward normal x × y */
function refSide(p: PartIn, t: Placement, id: number): { point: V, x: V, y: V, z: V }
{
    const at = (...vs: V[]) => vs.reduce((acc, v) => add(acc, v), t.origin)
    const sides: Array<[V, V, V]> = [
        [t.origin, t.x, t.z],
        [at(scale(t.y, p.height)), t.x, neg(t.y)],
        [at(scale(t.y, p.height), scale(t.z, p.width)), t.x, neg(t.z)],
        [at(scale(t.z, p.width)), t.x, t.y],
        [t.origin, t.z, t.y],
        [at(scale(t.x, p.length), scale(t.y, p.height)), t.z, neg(t.y)],
    ]
    const [point, x, y] = sides[id - 1]
    return { point, x, y, z: cross(x, y) }
}

/** JackRafterCut.plane_from_params_and_beam: the cut plane, its normal pointing at the waste */
function cutPlane(p: PartIn, t: Placement, c: any): { normal: V, point: V }
{
    const rs = refSide(p, t, Number(c.ReferencePlaneID))
    const point = add(rs.point, scale(rs.x, Number(c.StartX)))
    const end = c.Orientation === 'end'
    const horizontal = end ? 90 - Number(c.Angle) : Number(c.Angle) - 90
    const vertical = end ? 90 - Number(c.Inclination) : Number(c.Inclination) - 90
    const x = rotate(rotate(rs.x, rs.y, vertical), rs.z, horizontal)
    return { normal: end ? x : neg(x), point }
}

/** Drilling.cylinder_from_params_and_element: where the drill goes in and the line it follows */
function drillLine(p: PartIn, t: Placement, d: any): { entry: V, axis: V }
{
    const rs = refSide(p, t, Number(d.ReferencePlaneID))
    const entry = add(add(rs.point, scale(rs.x, Number(d.StartX))), scale(rs.y, Number(d.StartY)))
    const angle = Number(d.Angle), inclination = Number(d.Inclination)
    const y1 = rotate(neg(rs.y), neg(rs.z), angle)
    const z1 = rotate(rs.x, neg(rs.z), angle)
    return { entry, axis: rotate(z1, y1, inclination) }
}

const samePlane = (a: { normal: V, point: V }, b: { normal: V, point: V }, tol = 0.01) =>
    dot(unit(a.normal), unit(b.normal)) > 1 - 1e-6 && Math.abs(dot(unit(a.normal), sub(b.point, a.point))) < tol

const onLine = (entry: V, axis: V, q: V) => Math.hypot(...cross(unit(axis), sub(q, entry)))

/** Every cut plane in the file, rebuilt, lies on an angled saw cut of the model, and the other way round */
function expectCutsMatch(parts: PartIn[], modelPlanes: Array<{ normal: V, point: V }>)
{
    const filePlanes = parts.flatMap(p => p.transformations.flatMap(t => p.cuts.map(c => cutPlane(p, t, c))))
    filePlanes.forEach(f => expect(modelPlanes.some(m => samePlane(f, m)), JSON.stringify(f)).toBe(true))
    modelPlanes.forEach(m => expect(filePlanes.some(f => samePlane(f, m)), JSON.stringify(m)).toBe(true))
    return filePlanes
}

//// TESTS ////

describe('BTLx export', () =>
{
    beforeAll(() => installRecipeRecorder())
    afterAll(() => uninstallRecipeRecorder())
    beforeEach(() => setRecipeRecording(true))
    afterEach(() => setRecipeRecording(false))

    it('writes a well-formed BTLx 2.3 file with the project and its history', async () =>
    {
        const m = await newModeler()
        m.box(38, 120, 2400).name('stud')
        const text = (await m.toBTLx({ name: 'shed', version: '1.2.0', timestamp: DAY }))!
        expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Archiyou fab: fabrication from the model: BTLx 2.3 from shed 1.2.0')).toBe(true)
        const { root, parts } = readFile(text)
        expect(root.Version).toBe('2.3.0')
        expect(root.xmlns).toBe('https://www.design2machine.com')
        expect(root.FileHistory.InitialExportProgram).toMatchObject({ ProgramName: 'Archiyou', FileName: 'shed.btlx', Date: DAY })
        expect(root.Project).toMatchObject({ Name: 'shed', Comment: 'version 1.2.0, norm book 2026-09-A' })
        expect(root.Project.GUID).toMatch(/^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/)

        // square ends need no processing: the Length carries them
        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({ length: 2400, height: 120, width: 38, count: 1, cuts: [], drills: [] })
        expect(parts[0].attrs).toMatchObject({ Designation: 'stud', Annotation: 'stud', SingleMemberNumber: '1' })
        expect(text).not.toContain('<Processings>')
    })

    it('writes the same file for the same model', async () =>
    {
        const build = async () =>
        {
            const m = await newModeler()
            m.box(38, 120, 2400).name('stud')
            m.box(38, 89, 1200).move(500, 0, 0)
            return (await m.toBTLx({ name: 'shed', timestamp: DAY }))!
        }
        const [a, b] = [await build(), await build()]
        expect(a).toBe(b)
        // an unnamed part is called by its kind
        expect(readFile(a).parts.map(p => p.attrs.Designation)).toEqual(['stud', 'stick'])
    })

    it('counts identical parts once, with a placement for each piece', async () =>
    {
        const m = await newModeler()
        const xs = [0, 600, 1200]
        xs.forEach(x => m.boxBetween([x, 0, 0], [x + 38, 120, 2400]).name(`stud${x}`))
        m.boxBetween([0, 0, 2400], [1238, 120, 2438]).name('plate')
        const result = buildBTLx(m, m.all(), { timestamp: DAY })!
        expect(result.report).toMatchObject({ parts: 2, pieces: 4, processings: 0 })
        const { parts } = readFile(result.text)
        const studs = parts.find(p => p.attrs.Designation === 'stud')!
        expect(studs.count).toBe(3)
        expect(studs.transformations).toHaveLength(3)
        expect(new Set(studs.transformations.map(t => t.guid)).size).toBe(3)
        // each placement puts the part's box on its stud
        const lows = studs.transformations.map(t =>
        {
            const corners = [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k =>
                add(add(add(t.origin, scale(t.x, i * studs.length)), scale(t.y, j * studs.height)), scale(t.z, k * studs.width)))))
            return [0, 1, 2].map(axis => Math.min(...corners.map(c => c[axis])))
        })
        expect(lows.map(l => l.map(v => Math.round(v)))).toEqual(xs.map(x => [x, 0, 0]))
        // a fastening joint is assembly: the header says it is not written
        expect(result.report.notExported.join('\n')).toMatch(/fasteners in 3 joints are assembly, not machining/)
    })

    it('writes the sloped cuts of a ridge wall as JackRafterCuts on the model planes', async () =>
    {
        const m = await newModeler()
        m.make.wall(3000, 2400, 120, 38, 610, [{ left: 1000, sill: 800, width: 900, height: 1000 }], { height: 600, center: 0.5 })
        const result = buildBTLx(m, m.all(), { name: 'ridge wall', timestamp: DAY })!
        save(`${TEST_OUTPUT_DIR}/btlx.ridgewall.btlx`, result.text)
        const { parts } = readFile(result.text)

        // nothing unrecognised: bottom jacks inside the ridge outline keep their square ends
        expect(result.report.notExported.join('\n')).not.toMatch(/unknown|not recognised/)
        expect(result.report.notExported.join('\n')).toMatch(/fills \(insulation\) are not machined/)

        const angled = result.operations.members()
            .flatMap(member => member.ops.filter(op => op.op === 'sawCut' && op.kind !== 'square') as SawCut[])
        expect(angled.length).toBeGreaterThan(0)
        const planes = expectCutsMatch(parts, angled.flatMap(c => c.planes) as any)
        expect(planes.length).toBe(result.report.processings + parts
            .filter(p => p.count > 1).reduce((n, p) => n + (p.count - 1) * p.cuts.length, 0))

        // the pitch: 600 over 1500, cut square to the wall face
        const pitch = Math.atan(600 / 1500) * 180 / Math.PI
        parts.flatMap(p => p.cuts).forEach(c =>
        {
            expect(Math.min(Math.abs(Number(c.Angle) - (90 - pitch)), Math.abs(Number(c.Angle) - (90 + pitch)))).toBeLessThan(0.01)
            expect(Number(c.Inclination)).toBe(90)
            expect(Number(c.ReferencePlaneID)).toBe(1)
        })
    }, 60000)

    it('writes a pointed end as two cuts, and leaves out a V cut into the end', async () =>
    {
        const m = await newModeler()
        const peak: any = m.boxBetween([500, -60, 0], [538, 60, 3000]).name('peak')
        const roof = m.polygon([[400, 0, 0], [700, 0, 0], [700, 0, 2800], [519, 0, 2981], [400, 0, 2862]]).extrude(400, [0, 1, 0]).move(0, -200, 0)
        peak._intersection(roof)
        roof.removeFromScene()
        const fork: any = m.boxBetween([0, -60, 0], [38, 60, 2400]).name('fork')
        const notch = m.polygon([[-30, -61, 2401], [-30, 61, 2401], [-30, 0, 2340]]).extrude(100, [1, 0, 0])
        fork.subtract(notch)
        notch.removeFromScene()

        const result = buildBTLx(m, m.all(), { timestamp: DAY })!
        save(`${TEST_OUTPUT_DIR}/btlx.ends.btlx`, result.text)
        const { parts } = readFile(result.text)
        expect(parts.map(p => p.attrs.Designation).sort()).toEqual(['fork', 'peak'])

        const p = parts.find(q => q.attrs.Designation === 'peak')!
        expect(p.cuts).toHaveLength(2)
        expect(p.cuts.map(c => c.Orientation)).toEqual(['end', 'end'])
        expect(p.cuts.map(c => Number(c.Angle)).sort((a, b) => a - b)).toEqual([45, 135])
        const s = Math.SQRT1_2
        expectCutsMatch([p], [
            { normal: [-s, 0, s], point: [519, 0, 2981] },
            { normal: [s, 0, s], point: [519, 0, 2981] },
        ])

        const f = parts.find(q => q.attrs.Designation === 'fork')!
        expect(f.cuts).toHaveLength(0)
        expect(result.report.notExported).toContain('fork: the end is a V cut into the part, not written')
        const forkEnd = result.operations.members().find(q => q.name === 'fork')!.ops
            .find(op => op.op === 'sawCut' && op.end === 'end') as SawCut
        expect(forkEnd).toMatchObject({ kind: 'double', convex: false })
    })

    it('writes drillings that go in where the model drill goes in, square or tilted', async () =>
    {
        const m = await newModeler()
        const beam: any = m.box(38, 120, 2000).name('beam')
        const tools = [
            m.cylinder(6, 200, [0, 0, 0]).rotate(90, 'x').move(0, 100, 300),     // through the 120 side
            m.cylinder(5, 30, [0, 0, 0]).rotate(-90, 'y').move(30, 0, -500),     // 19 deep into the 38 side
            m.cylinder(4, 200, [0, 0, 0]).rotate(60, 'y').move(-86.6, 0, 150),   // through, tilted 30° from square
        ]
        tools.forEach(t => { beam.subtract(t); t.removeFromScene() })

        const result = buildBTLx(m, m.all(), { timestamp: DAY })!
        save(`${TEST_OUTPUT_DIR}/btlx.drillings.btlx`, result.text)
        const { parts } = readFile(result.text)
        expect(parts).toHaveLength(1)
        const [p] = parts
        expect(p).toMatchObject({ length: 2000, height: 120, width: 38 })
        expect(p.drills).toHaveLength(3)

        const drills = result.operations.members()[0].ops.filter(op => op.op === 'drilling') as Drilling[]
        expect(drills).toHaveLength(3)
        drills.forEach(d =>
        {
            const written = p.drills.find(w => Number(w.Diameter) === d.diameter)!
            const line = drillLine(p, p.transformations[0], written)
            expect(Math.abs(dot(unit(line.axis), unit(d.axis as V)))).toBeGreaterThan(1 - 1e-6)
            expect(Math.hypot(...sub(line.entry, d.entry as V))).toBeLessThan(0.01)
            expect(written.DepthLimited).toBe(d.through ? 'no' : 'yes')
            if (!d.through) expect(Number(written.Depth)).toBeCloseTo(19, 3)
        })
        const tilted = p.drills.find(w => Number(w.Diameter) === 8)!
        expect(Number(tilted.Inclination)).toBeCloseTo(60, 2)
        p.drills.filter(w => w !== tilted).forEach(w => expect(Number(w.Inclination)).toBe(90))
    })

    it('writes the holes of the fasteners only when asked, on the fastener axes', async () =>
    {
        const m = await newModeler()
        m.boxBetween([-19, -60, 38], [19, 60, 2438]).name('stud')
        m.boxBetween([-500, -60, 0], [500, 60, 38]).name('plate')
        const plain = buildBTLx(m, m.all(), { timestamp: DAY })!
        expect(plain.report.processings).toBe(0)
        expect(plain.report.notExported).toContain('4 fastener holes (toBTLx({ holes: true }) writes them for pre-drilling)')

        const result = buildBTLx(m, m.all(), { timestamp: DAY, holes: true })!
        save(`${TEST_OUTPUT_DIR}/btlx.holes.btlx`, result.text)
        expect(result.report.notExported.join('\n')).not.toMatch(/fastener holes/)
        const { parts } = readFile(result.text)
        const stud = parts.find(p => p.attrs.Designation === 'stud')!
        const plate = parts.find(p => p.attrs.Designation === 'plate')!
        expect(plate.drills.map(d => [d.DepthLimited, Number(d.Diameter)])).toEqual([['no', 5], ['no', 5]])
        expect(stud.drills.map(d => [d.DepthLimited, Number(d.Depth), Number(d.Diameter)])).toEqual([['yes', 52, 5], ['yes', 52, 5]])
        const [fastening] = result.operations.fastenings()
        ;[stud, plate].forEach(part => part.drills.forEach(d =>
        {
            const line = drillLine(part, part.transformations[0], d)
            const on = fastening.fasteners.filter(p => Math.abs(dot(unit(line.axis), p.dir as V)) > 1 - 1e-6
                && onLine(p.point as V, p.dir as V, line.entry) < 0.01)
            expect(on).toHaveLength(1)
        }))
    })

    it('reads the same parts from a turned model', async () =>
    {
        const build = async (turn: boolean) =>
        {
            const m = await newModeler()
            const beam: any = m.box(38, 120, 2000).name('beam')
            const drill = m.cylinder(4, 200, [0, 0, 0]).rotate(60, 'y').move(-86.6, 0, 150)
            beam.subtract(drill)
            drill.removeFromScene()
            const saw = m.box(400, 400, 400).rotate(30, 'y').move(0, 0, 1100)
            beam.subtract(saw)
            saw.removeFromScene()
            if (turn) beam.rotate(37, 'z').rotate(20, 'x')
            const result = buildBTLx(m, m.all(), { timestamp: DAY })!
            const member = result.operations.members()[0]
            return { result, part: readFile(result.text).parts[0], member }
        }
        const flat = await build(false)
        const turned = await build(true)
        expect(turned.result.report.notExported).toEqual(flat.result.report.notExported)
        expect([turned.part.length, turned.part.height, turned.part.width].map(Math.round))
            .toEqual([flat.part.length, flat.part.height, flat.part.width].map(Math.round))
        expect(turned.part.cuts).toHaveLength(1)
        expect(turned.part.drills).toHaveLength(1)

        // the rebuilt geometry lands on the turned model, whichever corner the frame starts from
        const cuts = turned.member.ops.filter(op => op.op === 'sawCut' && op.kind !== 'square') as SawCut[]
        expectCutsMatch([turned.part], cuts.flatMap(c => c.planes) as any)
        const drill = turned.member.ops.find(op => op.op === 'drilling') as Drilling
        const line = drillLine(turned.part, turned.part.transformations[0], turned.part.drills[0])
        expect(Math.abs(dot(unit(line.axis), unit(drill.axis as V)))).toBeGreaterThan(1 - 1e-6)
        expect(onLine(line.entry, line.axis, drill.entry as V)).toBeLessThan(0.01)
        // angles do not depend on how the model is turned
        expect(Number(turned.part.drills[0].Inclination)).toBeCloseTo(Number(flat.part.drills[0].Inclination), 3)
        expect(Number(turned.part.cuts[0].Angle)).toBeCloseTo(Number(flat.part.cuts[0].Angle), 3)
    })

    it('has nothing to write without timber parts', async () =>
    {
        const m = await newModeler()
        expect(await m.toBTLx({ timestamp: DAY })).toBeNull()
    })
})
