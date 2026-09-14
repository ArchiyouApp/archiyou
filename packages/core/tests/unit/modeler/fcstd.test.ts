import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import * as meshup from '@archiyou/meshup'

import { Modeler } from '../../../src/modeler/Modeler'
import type { ArchiyouModules } from '../../../src/types'
import * as brep from '../../../src/modeler/brep/index'
import { installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording } from '../../../src/modeler/Recipe'
import { buildFCStd, writePlanarBRep, writePolylineBRep, type FCStdParam, type BRepFace } from '../../../src/modeler/FCStdExporter'

/**
 * FreeCAD export. See src/modeler/FCStdExporter.ts.
 *
 * FreeCAD itself is not available to the test run, so each FreeCAD rule the reader enforces is
 * checked the way the reader applies it (verified against FreeCAD 1.1.3 sources):
 *  - zip entries in read order, sizes in the local headers
 *  - every Count/count attribute equal to its children
 *  - every link pointing at an object that exists
 *  - every .brp read back by OpenCascade (the same kernel FreeCAD uses) and checked valid
 * and the parametric description is checked against the real geometry: FreeCAD's placement
 * conventions applied to the written properties must land on the mesh's own vertices.
 */

//// helpers: zip, xml ////

type ZipEntry = { name: string; text: string }

function unzip(data: Uint8Array): ZipEntry[]
{
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const entries: ZipEntry[] = []
    let pos = 0
    while (view.getUint32(pos, true) === 0x04034b50)
    {
        const method = view.getUint16(pos + 8, true)
        const size = view.getUint32(pos + 18, true)
        const nameLength = view.getUint16(pos + 26, true)
        const extra = view.getUint16(pos + 28, true)
        const name = new TextDecoder().decode(data.subarray(pos + 30, pos + 30 + nameLength))
        const start = pos + 30 + nameLength + extra
        const body = data.subarray(start, start + size)
        const raw = method === 8 ? inflateRawSync(body) : body
        entries.push({ name, text: new TextDecoder().decode(raw) })
        pos = start + size
    }
    return entries
}

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[] }

function parseXml(xml: string): XmlNode
{
    const root: XmlNode = { name: '#root', attrs: {}, children: [] }
    const stack = [root]
    const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '')
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g
    let m: RegExpExecArray | null
    while ((m = tag.exec(body)))
    {
        const [, closing, name, attrText, selfClosing] = m
        if (closing)
        {
            const open = stack.pop()!
            expect(open.name, `closing </${name}>`).toBe(name)
            continue
        }
        const attrs: Record<string, string> = {}
        for (const a of attrText.matchAll(/([\w:.-]+)="([^"]*)"/g))
        {
            attrs[a[1]] = a[2].replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        }
        const node: XmlNode = { name, attrs, children: [] }
        stack[stack.length - 1].children.push(node)
        if (!selfClosing) stack.push(node)
    }
    expect(stack.map(n => n.name)).toEqual(['#root'])
    return root
}

const all = (node: XmlNode, name: string): XmlNode[] =>
    [...(node.name === name ? [node] : []), ...node.children.flatMap(c => all(c, name))]

/** The loop bounds FreeCAD's reader trusts: element -> the children it reads that many of */
const COUNTED: Record<string, { attr: string; child: string }> = {
    Properties: { attr: 'Count', child: 'Property' },
    Objects: { attr: 'Count', child: 'Object' },
    ObjectData: { attr: 'Count', child: 'Object' },
    LinkList: { attr: 'count', child: 'Link' },
    Map: { attr: 'count', child: 'Item' },
    Cells: { attr: 'Count', child: 'Cell' },
    ExpressionEngine: { attr: 'count', child: 'Expression' },
    ViewProviderData: { attr: 'Count', child: 'ViewProvider' },
}

function expectCountsExact(node: XmlNode)
{
    const rule = COUNTED[node.name]
    if (rule)
    {
        expect(node.attrs[rule.attr], `${node.name} has ${rule.attr}`).toBeDefined()
        expect(node.children.filter(c => c.name === rule.child).length, `${node.name} ${rule.attr}`).toBe(Number(node.attrs[rule.attr]))
    }
    node.children.forEach(expectCountsExact)
}

type FcObjectView = { name: string; type: string; touched: boolean; props: Record<string, XmlNode> }

function objectsOf(doc: XmlNode): FcObjectView[]
{
    const types = all(doc, 'Objects')[0].children
    const data = all(doc, 'ObjectData')[0].children
    return types.map((t, i) =>
    {
        expect(data[i].attrs.name, 'ObjectData follows Objects order').toBe(t.attrs.name)
        const props: Record<string, XmlNode> = {}
        for (const p of all(data[i], 'Properties')[0].children) props[p.attrs.name] = p
        return { name: t.attrs.name, type: t.attrs.type, touched: t.attrs.Touched === '1', props }
    })
}

const value = (o: FcObjectView, prop: string) => o.props[prop]?.children[0]?.attrs.value
const num = (o: FcObjectView, prop: string) => Number(value(o, prop))
const label = (o: FcObjectView) => value(o, 'Label')

type V3 = [number, number, number]

/** FreeCAD Placement applied to a local point: R(q) p + P, with Q0..Q3 = x, y, z, w */
function placementApply(o: FcObjectView, p: V3): V3
{
    const a = o.props.Placement.children[0].attrs
    const [x, y, z, w] = ['Q0', 'Q1', 'Q2', 'Q3'].map(k => Number(a[k]))
    const R = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ]
    // the axis-angle attributes must describe the same rotation as the quaternion
    const angle = Number(a.A)
    expect(Math.cos(angle / 2)).toBeCloseTo(w, 9)
    return [
        R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + Number(a.Px),
        R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + Number(a.Py),
        R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + Number(a.Pz),
    ]
}

//// helpers: OpenCascade ////

let oc: any
let fileCounter = 0

function readBrep(text: string): { shape: any; valid: boolean; volume: number; type: string }
{
    const file = `/fcstd_test_${fileCounter++}.brp`
    oc.FS.writeFile(file, text)
    const shape = new oc.TopoDS_Shape()
    const ok = oc.BRepTools.Read_2(shape, file, new oc.BRep_Builder(), new oc.Message_ProgressRange_1())
    oc.FS.unlink(file)
    expect(ok, 'OpenCascade reads the .brp').toBeTruthy()
    expect(shape.IsNull()).toBe(false)
    const props = new oc.GProp_GProps_1()
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false)
    const types = ['TopAbs_COMPOUND', 'TopAbs_COMPSOLID', 'TopAbs_SOLID', 'TopAbs_SHELL', 'TopAbs_FACE', 'TopAbs_WIRE', 'TopAbs_EDGE', 'TopAbs_VERTEX']
    const type = types.find(t => shape.ShapeType() === oc.TopAbs_ShapeEnum[t]) ?? 'unknown'
    return { shape, valid: !!new oc.BRepCheck_Analyzer(shape, true, false).IsValid_2(), volume: props.Mass(), type }
}

//// tests ////

describe('FCStd export', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        await brep.init()
        oc = brep.getOc()
        modeler = new Modeler() // mesh kernel, 'mm'
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        installRecipeRecorder()
    }, 60000)

    afterAll(() => uninstallRecipeRecorder())

    beforeEach(() =>
    {
        modeler.reset()
        modeler.units('mm')
        setRecipeRecording(true)
    })

    const box = (...a: Parameters<Modeler['box']>) => modeler.box(...a) as meshup.Mesh
    const cylinder = (...a: Parameters<Modeler['cylinder']>) => modeler.cylinder(...a) as meshup.Mesh
    const sphere = (...a: Parameters<Modeler['sphere']>) => modeler.sphere(...a) as meshup.Mesh
    const faces = (mesh: meshup.Mesh): BRepFace[] => (mesh.inner().reconstructNgons().polygons() as any[]).map(p => ({
        outer: p.vertices().map((v: any) => { const q = v.position(); return [q.x, q.y, q.z] }),
        holes: (p.holes() as any[][]).map(h => h.map((v: any) => { const q = v.position(); return [q.x, q.y, q.z] })),
    }))

    async function exportScene(params: FCStdParam[] = [], units = 'mm')
    {
        const result = await buildFCStd(modeler.scene(), { units: units as any, params, timestamp: '2026-01-02T03:04:05Z', meta: { script: 'test', version: '1.0.0' } })
        expect(result).not.toBeNull()
        const entries = unzip(result!.data)
        const doc = parseXml(entries.find(e => e.name === 'Document.xml')!.text)
        const gui = parseXml(entries.find(e => e.name === 'GuiDocument.xml')!.text)
        return { result: result!, entries, doc, gui, objects: objectsOf(doc) }
    }

    //// the BRep writer on its own ////

    describe('planar BRep writer', () =>
    {
        it('writes a box OpenCascade reads as a valid solid with the right volume', () =>
        {
            const b = writePlanarBRep(faces(meshup.Mesh.Box(10, 20, 30)))!
            expect(b.kind).toBe('solid')
            const read = readBrep(b.text)
            expect(read.type).toBe('TopAbs_SOLID')
            expect(read.valid).toBe(true)
            expect(read.volume).toBeCloseTo(6000, 6)
        })

        it('writes faces with holes (a square tube) and turns an inside-out input the right way round', () =>
        {
            // 10 x 10 x 2 plate with a 4 x 4 hole, built face by face with holes in both caps
            const sq = (h: number, z: number): [number, number, number][] => [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]]
            const quad = (a: number[][], b: number[][], i: number) => [a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]] as [number, number, number][]
            const o0 = sq(5, 0), o1 = sq(5, 2), i0 = sq(2, 0), i1 = sq(2, 2)
            const tubeFaces: BRepFace[] = [
                { outer: o1, holes: [[...i1].reverse()] },               // top, facing +z
                { outer: [...o0].reverse(), holes: [i0] },               // bottom, facing -z
                ...[0, 1, 2, 3].map(i => ({ outer: quad(o0, o1, i) })),  // outside walls
                ...[0, 1, 2, 3].map(i => ({ outer: quad(i1, i0, i) })),  // inside walls, facing the hole
            ]
            const expected = (100 - 16) * 2

            const b = writePlanarBRep(tubeFaces)!
            expect(b.kind).toBe('solid')
            const read = readBrep(b.text)
            expect(read.valid).toBe(true)
            expect(read.volume).toBeCloseTo(expected, 9)

            const inverted = tubeFaces.map(f => ({ outer: [...f.outer].reverse(), holes: (f.holes ?? []).map(h => [...h].reverse()) }))
            expect(readBrep(writePlanarBRep(inverted)!.text).volume).toBeCloseTo(expected, 9)
        })

        it('writes a boolean union as a valid solid with the mesh volume', () =>
        {
            const stack = meshup.Mesh.Box(20, 20, 10)
            const top = meshup.Mesh.Box(10, 10, 10)
            top.move(0, 0, 10)
            stack.union(top)
            const b = writePlanarBRep(faces(stack))!
            expect(b.kind).toBe('solid')
            const read = readBrep(b.text)
            expect(read.valid).toBe(true)
            expect(read.volume).toBeCloseTo(stack.volume()!, 6)
        })

        it('closes a hand-built T-junction: a top face split in two over a single bottom face', () =>
        {
            type P = [number, number, number]
            const c = (x: number, y: number, z: number): P => [x, y, z]
            const tFaces: BRepFace[] = [
                { outer: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)] },     // top left, facing +z
                { outer: [c(1, 0, 1), c(2, 0, 1), c(2, 1, 1), c(1, 1, 1)] },     // top right
                { outer: [c(0, 0, 0), c(0, 1, 0), c(2, 1, 0), c(2, 0, 0)] },     // bottom, one face
                { outer: [c(0, 0, 0), c(2, 0, 0), c(2, 0, 1), c(1, 0, 1), c(0, 0, 1)] }, // front (-y) carries the split vertex
                { outer: [c(0, 1, 0), c(0, 1, 1), c(2, 1, 1), c(2, 1, 0)] },     // back (+y) does NOT: T-junction at (1,1,1)
                { outer: [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)] },     // left
                { outer: [c(2, 0, 0), c(2, 1, 0), c(2, 1, 1), c(2, 0, 1)] },     // right
            ]
            const b = writePlanarBRep(tFaces)!
            expect(b.kind).toBe('solid')
            const read = readBrep(b.text)
            expect(read.valid).toBe(true)
            expect(read.volume).toBeCloseTo(2, 9)
        })

        it('writes a faceted cylinder and sphere as valid solids', () =>
        {
            for (const mesh of [meshup.Mesh.Cylinder(5, 20), meshup.Mesh.Sphere(8)])
            {
                const read = readBrep(writePlanarBRep(faces(mesh))!.text)
                expect(read.type).toBe('TopAbs_SOLID')
                expect(read.valid).toBe(true)
                expect(read.volume).toBeCloseTo(mesh.volume()!, 4)
            }
        })

        it('writes polylines as a compound of wires', () =>
        {
            const read = readBrep(writePolylineBRep([[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 0, 0]], [[0, 0, 5], [0, 0, 15]]])!.text)
            expect(read.type).toBe('TopAbs_COMPOUND')
            expect(read.valid).toBe(true)
        })
    })

    //// the document ////

    describe('document', () =>
    {
        it('is a zip FreeCAD can read in sequence, with exact counts and resolvable links', async () =>
        {
            modeler.layer('Parts')
            const plate = box(100, 50, 20)
            plate.rotate(30, 'z')
            const hole = cylinder(5, 40, [10, 0, -20])
            plate.subtract(hole)
            ;(plate as any).name('plate')
            ;(hole as any).hide()
            sphere(10, [200, 0, 0]).color('red')
            modeler.layer('Drawing')
            modeler.rect(100, 50)

            const { entries, doc, gui, objects } = await exportScene()

            // Read order: Document.xml, shape files in object order, GuiDocument.xml last
            expect(entries[0].name).toBe('Document.xml')
            expect(entries[entries.length - 1].name).toBe('GuiDocument.xml')
            const shapeFiles = objects.map(o => o.props.Shape?.children[0].attrs.file).filter(Boolean)
            expect(entries.slice(1, -1).map(e => e.name)).toEqual(shapeFiles)

            expectCountsExact(doc)
            expectCountsExact(gui)
            expect(all(gui, 'ViewProvider').map(v => v.attrs.name)).toEqual(objects.map(o => o.name))
            expect(all(gui, 'Camera')).toHaveLength(1) // the reader requires it

            const names = new Set(objects.map(o => o.name))
            expect(names.size).toBe(objects.length)
            objects.forEach(o => expect(o.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/))
            for (const link of all(doc, 'Link')) expect(names.has(link.attrs.value), `link to ${link.attrs.value}`).toBe(true)

            const types = objects.map(o => o.type)
            expect(types).toContain('Part::Cut')
            expect(types).toContain('Part::Box')
            expect(types).toContain('Part::Cylinder')
            expect(types).toContain('Part::Sphere')
            expect(types).toContain('Part::Feature')        // the rectangle, as a wire
            expect(types.filter(t => t === 'App::DocumentObjectGroup')).toHaveLength(2)

            // Groups hold what the user made, not the operands FreeCAD shows under their boolean
            const cut = objects.find(o => o.type === 'Part::Cut')!
            expect(label(cut)).toBe('plate')
            const operands = [value(cut, 'Base'), value(cut, 'Tool')]
            const grouped = all(doc, 'Link').filter((_, i, links) => true) // every link
            const groupMembers = objects.filter(o => o.type === 'App::DocumentObjectGroup')
                .flatMap(g => all(g.props.Group, 'Link').map(l => l.attrs.value))
            operands.forEach(op => expect(groupMembers).not.toContain(op))
            expect(grouped.length).toBeGreaterThan(0)
            expect(value(objects.find(o => o.name === operands[0])!, 'Visibility')).toBe('false')
        })

        it('writes every shape file so OpenCascade reads it as valid, and the cut with the mesh volume', async () =>
        {
            const plate = box(100, 50, 20)
            plate.subtract(cylinder(5, 40, [10, 0, -20]))
            ;(plate as any).name('plate')

            const { entries, objects } = await exportScene()
            for (const e of entries.filter(e => e.name.endsWith('.brp')))
            {
                expect(readBrep(e.text).valid, e.name).toBe(true)
            }
            const cut = objects.find(o => o.type === 'Part::Cut')!
            const cutFile = cut.props.Shape.children[0].attrs.file
            expect(readBrep(entries.find(e => e.name === cutFile)!.text).volume).toBeCloseTo(plate.volume()!, 3)
        })

        it('writes colour, transparency and visibility for the viewer', async () =>
        {
            const ball = sphere(10)
            ball.color('red')
            ball.style.opacity = 0.25
            const { gui } = await exportScene()
            const provider = all(gui, 'ViewProvider').find(v => all(v, 'PropertyColor').length)!
            const color = Number(all(provider, 'PropertyColor')[0].attrs.value)
            expect(color >>> 24).toBe(255)          // red
            expect((color >>> 8) & 0xff).toBe(0)     // blue
            expect(color & 0xff).toBe(0)             // opaque in the pre-1.1 colour convention
            expect(all(provider, 'Integer')[0].attrs.value).toBe('75')
        })

        it('embeds the report and script identity in the document metadata', async () =>
        {
            box(10)
            const { doc, result } = await exportScene()
            const items = Object.fromEntries(all(doc, 'Item').map(i => [i.attrs.key, i.attrs.value]))
            expect(items['archiyou.script']).toBe('test')
            expect(items['archiyou.version']).toBe('1.0.0')
            expect(items['archiyou.report']).toBe(result.report.summary())
        })
    })

    //// parametric features ////

    describe('parametric features', () =>
    {
        it('places a rotated, mirrored box so its FreeCAD corners are the mesh vertices', async () =>
        {
            const b = box(10, 20, 30, [40, 5, 7])
            b.rotate(33, [1, 2, 3])
            b.mirror('x', 3)
            const { objects } = await exportScene()
            const fcBox = objects.find(o => o.type === 'Part::Box')!
            const [L, W, H] = ['Length', 'Width', 'Height'].map(p => num(fcBox, p))
            expect([L, W, H]).toEqual([10, 20, 30])

            const corners: V3[] = []
            for (const x of [0, L]) for (const y of [0, W]) for (const z of [0, H]) corners.push(placementApply(fcBox, [x, y, z]))
            for (const p of b.positions())
            {
                const nearest = Math.min(...corners.map(c => Math.hypot(c[0] - p.x, c[1] - p.y, c[2] - p.z)))
                expect(nearest).toBeLessThan(1e-6)
            }
            expect(fcBox.touched).toBe(false) // a box cache is exact
        })

        it('places a rotated cylinder on its base, and marks it for recompute', async () =>
        {
            const c = cylinder(5, 40, [3, 4, 5])
            c.rotateAround(50, [1, 0, 1], [0, 0, 0])
            const { objects } = await exportScene()
            const fc = objects.find(o => o.type === 'Part::Cylinder')!
            const R = num(fc, 'Radius'), H = num(fc, 'Height')
            expect([R, H]).toEqual([5, 40])

            const base = placementApply(fc, [0, 0, 0]), top = placementApply(fc, [0, 0, H])
            const axis = [top[0] - base[0], top[1] - base[1], top[2] - base[2]].map(v => v / H)
            for (const p of c.positions())
            {
                const rel = [p.x - base[0], p.y - base[1], p.z - base[2]]
                const along = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2]
                const radial = Math.hypot(rel[0] - along * axis[0], rel[1] - along * axis[1], rel[2] - along * axis[2])
                expect(along).toBeGreaterThan(-1e-6)
                expect(along).toBeLessThan(H + 1e-6)
                expect(radial).toBeLessThan(R + 1e-6)
            }
            expect(fc.touched).toBe(true)
        })

        it('turns a cut with two tools into Cut(base, MultiFuse(tools))', async () =>
        {
            const base = box(100, 100, 10)
            base.subtract(box(10, 10, 30, [-20, 0, 0]))
            base.subtract(box(10, 10, 30, [20, 0, 0]))
            const { objects } = await exportScene()
            const cut = objects.find(o => o.type === 'Part::Cut')!
            const tool = objects.find(o => o.name === value(cut, 'Tool'))!
            expect(tool.type).toBe('Part::MultiFuse')
            expect(all(tool.props.Shapes, 'Link')).toHaveLength(2)
            expect(tool.props.Shape.children[0].attrs.file).toBe('') // FreeCAD builds it on Recompute
            expect(cut.touched).toBe(true)
        })

        it('writes fuse and common as MultiFuse and MultiCommon', async () =>
        {
            const a = box(20)
            a.union(sphere(12, [10, 0, 0]))
            const b = box(20, 20, 20, [100, 0, 0])
            b.intersect(sphere(12, [100, 0, 0]))
            const { objects } = await exportScene()
            const multi = objects.filter(o => o.type === 'Part::MultiFuse' || o.type === 'Part::MultiCommon')
            expect(multi.map(o => o.type).sort()).toEqual(['Part::MultiCommon', 'Part::MultiFuse'])
        })

        it('scales geometry and dimensions from model units to millimetres', async () =>
        {
            modeler.units('cm')
            box(10, 20, 30, [1, 0, 0])
            const { objects, entries } = await exportScene([], 'cm')
            const fc = objects.find(o => o.type === 'Part::Box')!
            expect(['Length', 'Width', 'Height'].map(p => num(fc, p))).toEqual([100, 200, 300])
            expect(Number(fc.props.Placement.children[0].attrs.Px)).toBeCloseTo(10 - 50, 9)
            const file = fc.props.Shape.children[0].attrs.file
            expect(readBrep(entries.find(e => e.name === file)!.text).volume).toBeCloseTo(100 * 200 * 300, 3)
        })

        it('bakes what FreeCAD features cannot express, and says why', async () =>
        {
            const squashed = cylinder(5, 10)
            squashed.scale([2, 1, 1])
            ;(squashed as any).name('squashed')
            const flipped = box(10)
            ;(flipped as any).inverse()
            ;(flipped as any).name('flipped')

            const { objects, result } = await exportScene()
            expect(objects.filter(o => o.type === 'Part::Feature').map(label).sort()).toEqual(['flipped', 'squashed'])
            const reasons = Object.fromEntries(result.report.entries.map(e => [e.subject, e.reason]))
            expect(reasons.squashed).toContain('elliptic')
            expect(reasons.flipped).toContain('inverse() is not recorded')
        })

        it('bakes everything when parametric export is off', async () =>
        {
            box(10)
            const result = await buildFCStd(modeler.scene(), { parametric: false })
            const objects = objectsOf(parseXml(unzip(result!.data)[0].text))
            expect(objects.map(o => o.type)).toEqual(['Part::Feature'])
        })
    })

    //// parameters ////

    describe('parameters', () =>
    {
        const params: FCStdParam[] = [
            { name: 'WIDTH', type: 'number', _value: 120, schema: { minimum: 10, maximum: 500 }, description: 'Plate width' },
            { name: 'H', type: 'number', _value: 30 },            // 'H' is a FreeCAD unit (henry): needs a safe alias
            { name: 'A1', type: 'number', _value: 7 },            // looks like a cell address
            { name: 'SAME1', type: 'number', _value: 55 },
            { name: 'SAME2', type: 'number', _value: 55 },
            { name: 'SHELVES', type: 'boolean', _value: true },
            { name: 'FINISH', type: 'options', _value: 'oak & "walnut"' },
        ]

        it('writes a spreadsheet with valid aliases and binds dimensions that equal one parameter', async () =>
        {
            box(120, 55, 30)
            const { doc, objects, result } = await exportScene(params)

            const sheet = objects.find(o => o.type === 'Spreadsheet::Sheet')!
            const cells = all(sheet.props.cells, 'Cell')
            const aliases = cells.filter(c => c.attrs.alias).map(c => c.attrs.alias)
            expect(aliases).toEqual(['WIDTH', 'P_H', 'P_A1', 'SAME1', 'SAME2', 'SHELVES', 'FINISH'])
            expect(cells.find(c => c.attrs.alias === 'WIDTH')!.attrs.content).toBe('120')
            expect(cells.find(c => c.attrs.alias === 'FINISH')!.attrs.content).toBe(`'oak & "walnut"`)
            expect(cells.find(c => c.attrs.alias === 'SHELVES')!.attrs.content).toBe('=1')

            const fcBox = objects.find(o => o.type === 'Part::Box')!
            const expressions = Object.fromEntries(all(fcBox.props.ExpressionEngine, 'Expression').map(e => [e.attrs.path, e.attrs.expression]))
            expect(expressions).toEqual({
                Length: `${sheet.name}.WIDTH * 1 mm`,
                Height: `${sheet.name}.P_H * 1 mm`,
                // Width is 55: two parameters have that value, so it stays unbound
            })
            expect(result.report.toString()).toContain('55 equals SAME1, SAME2: not bound')
            expectCountsExact(doc)
        })

        it('does not bind a scaled dimension', async () =>
        {
            const b = box(120, 10, 10)
            b.scale([2, 1, 1])
            const { objects } = await exportScene(params)
            const fcBox = objects.find(o => o.type === 'Part::Box')!
            expect(fcBox.props.ExpressionEngine).toBeUndefined()
        })
    })

    //// the brep kernel ////

    it('exports recorded brep shapes as features, with the exact result as the cache', async () =>
    {
        const m = new Modeler('brep')
        await m.load()
        m.setArchiyou({ modeler: m } as unknown as ArchiyouModules)
        installRecipeRecorder({ brep })

        const plate = m.box(100, 50, 20) as any
        plate.rotateZ(30)
        plate.subtract(m.cylinder(5, 40, [10, 0, -20]))
        ;(plate as any).name?.('plate')
        const lone = m.box(10, 20, 30, [200, 0, 0]) as any
        lone.rotateAround(40, [1, 1, 0], [200, 0, 0])

        const result = await buildFCStd(m.scene(), { units: 'mm' })
        const entries = unzip(result!.data)
        const objects = objectsOf(parseXml(entries[0].text))
        expect(objects.map(o => o.type)).toEqual(expect.arrayContaining(['Part::Cut', 'Part::Box', 'Part::Cylinder']))

        // The cut's cache is OpenCascade's own exact solid
        const cut = objects.find(o => o.type === 'Part::Cut')!
        const read = readBrep(entries.find(e => e.name === cut.props.Shape.children[0].attrs.file)!.text)
        expect(read.valid).toBe(true)
        expect(read.volume).toBeCloseTo(100 * 50 * 20 - Math.PI * 25 * 20, 3)

        // The lone box's FreeCAD corners are the brep box's vertices
        const fcBox = objects.filter(o => o.type === 'Part::Box').find(o => o.name !== value(cut, 'Base'))!
        const [L, W, H] = ['Length', 'Width', 'Height'].map(p => num(fcBox, p))
        const corners: V3[] = []
        for (const x of [0, L]) for (const y of [0, W]) for (const z of [0, H]) corners.push(placementApply(fcBox, [x, y, z]))
        const vertices = lone.vertices().toArray().map((v: any) => [v.x, v.y, v.z])
        expect(vertices).toHaveLength(8)
        for (const v of vertices)
        {
            expect(Math.min(...corners.map(c => Math.hypot(c[0] - v[0], c[1] - v[1], c[2] - v[2])))).toBeLessThan(1e-6)
        }
    }, 60000)

    it('bakes brep kernel shapes as exact OpenCascade geometry', async () =>
    {
        const solid = new brep.Solid().makeCylinder(10, 30)
        const root = new meshup.SceneNode('Scene')
        const child = new meshup.SceneNode('pin')
        ;(child as any)._shape = solid
        root.addChild(child)

        const result = await buildFCStd(root, { units: 'mm', parametric: false })
        const entries = unzip(result!.data)
        const objects = objectsOf(parseXml(entries[0].text))
        expect(objects.map(o => o.type)).toEqual(['Part::Feature'])
        const read = readBrep(entries[1].text)
        expect(read.valid).toBe(true)
        expect(read.volume).toBeCloseTo(Math.PI * 100 * 30, 6) // exact, not faceted
    })
})
