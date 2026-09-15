/**
 * scad.test.ts — the OpenSCAD exporter on small scenes (mesh kernel, recipe recording on).
 *
 * OpenSCAD itself is not available to this test run (the round trip through the OpenSCAD WASM build is
 * a separate suite), so the emitted geometry is checked by reading it back here:
 *
 *  - an extrusion's `multmatrix(M) linear_extrude(height = h) polygon(P)` is expanded into its prism
 *    corners, which must be exactly the mesh's vertices;
 *  - a `polyhedron(points, faces)` must enclose the mesh's volume with every face clockwise from
 *    outside, as OpenSCAD requires.
 *
 * The rest are text contracts: primitives, placement, booleans, names, colours, the PART switch, 2D
 * parts, the header. One representative scene is kept as a file snapshot for reading.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as meshup from '@archiyou/meshup'

import { Modeler } from '../../../src/modeler/Modeler'
import type { ArchiyouModules } from '../../../src/types'
import { installRecipeRecorder, uninstallRecipeRecorder, setRecipeRecording } from '../../../src/modeler/Recipe'
import { buildSCAD, scadNumber, scadVector, placed, SCADNames } from '../../../src/modeler/SCADExporter'

type V3 = [number, number, number]

/** The body of one module */
function moduleBody(text: string, name: string): string
{
    const start = text.indexOf(`module ${name}() {`)
    expect(start, `module ${name} in\n${text}`).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = text.indexOf('{', start); i < text.length; i++)
    {
        if (text[i] === '{') depth++
        if (text[i] === '}' && --depth === 0) return text.slice(text.indexOf('{', start) + 1, i)
    }
    throw new Error(`unterminated module ${name}`)
}

/** Corners of every `[multmatrix(M) | translate(t)] linear_extrude(height = h) polygon(P)` in a body */
function extrusionCorners(body: string): V3[]
{
    const corners: V3[] = []
    const re = /(?:multmatrix\((\[\[.*?\]\])\)\s*|translate\((\[[^\]]*\])\)\s*)?linear_extrude\(height = ([^)]*)\)\s*polygon\((\[\[.*?\]\])\);/g
    for (const m of body.matchAll(re))
    {
        const M: number[][] = m[1] ? JSON.parse(m[1]) : [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
        if (m[2]) { const t = JSON.parse(m[2]); M[0][3] = t[0]; M[1][3] = t[1]; M[2][3] = t[2] }
        const h = Number(m[3])
        const apply = (x: number, y: number, z: number): V3 => [0, 1, 2].map(r => M[r][0] * x + M[r][1] * y + M[r][2] * z + M[r][3]) as V3
        for (const [x, y] of JSON.parse(m[4]) as number[][]) corners.push(apply(x, y, 0), apply(x, y, h))
    }
    return corners
}

/** Points, faces and six times the signed volume of a polyhedron in a body */
function polyhedronOf(body: string): { points: V3[]; faces: number[][]; volume6: number }
{
    const m = /polyhedron\(\s*points = (\[.*?\]\]),\s*faces = (\[.*?\]\])\s*\);/s.exec(body)
    expect(m, body).not.toBeNull()
    const points: V3[] = JSON.parse(m![1])
    const faces: number[][] = JSON.parse(m![2])
    let volume6 = 0
    for (const f of faces) for (let i = 1; i < f.length - 1; i++)
    {
        const [a, b, c] = [points[f[0]], points[f[i]], points[f[i + 1]]]
        volume6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
    }
    return { points, faces, volume6 }
}

const key = (p: ArrayLike<number>) => Array.from(p).map(v => Math.round(v * 1e4) / 1e4 + 0).join(',')

describe('OpenSCAD text helpers', () =>
{
    it('writes numbers without float noise or negative zero', () =>
    {
        expect(scadNumber(0.1 + 0.2)).toBe('0.3')
        expect(scadNumber(-0)).toBe('0')
        expect(scadNumber(1e-12)).toBe('0')
        expect(scadNumber(1237.5)).toBe('1237.5')
        expect(scadVector([1, -2.5, 0])).toBe('[1, -2.5, 0]')
    })

    it('makes names unique identifiers that never shadow a builtin', () =>
    {
        const names = new SCADNames()
        expect(names.allocate('top length')).toBe('top_length')
        expect(names.allocate('top length')).toBe('top_length_2')
        expect(names.allocate('cube')).toBe('cube_part')
        expect(names.allocate('3d print')).toBe('part_3d_print')
        expect(names.allocate('')).toBe('part')
        expect(names.allocate('Wand über')).toBe('Wand_uber')
    })

    it('places a body by nothing, translate() or multmatrix()', () =>
    {
        expect(placed([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 'cube(1);')).toBe('cube(1);')
        expect(placed([1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7], 'cube(1);')).toBe('translate([5, 6, 7]) cube(1);')
        expect(placed([0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3], 'cube(1);')).toBe('multmatrix([[0, -1, 0, 1], [1, 0, 0, 2], [0, 0, 1, 3], [0, 0, 0, 1]]) cube(1);')
    })
})

describe('OpenSCAD export', () =>
{
    let modeler: Modeler

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()
        modeler.setArchiyou({ modeler } as unknown as ArchiyouModules)
        installRecipeRecorder()
    })

    afterAll(() => uninstallRecipeRecorder())

    beforeEach(() =>
    {
        modeler.reset()
        modeler.units('mm')
        setRecipeRecording(true)
    })

    const exportScene = (opts = {}) =>
    {
        const result = buildSCAD(modeler.scene(), { units: modeler.units(), ...opts })
        expect(result).not.toBeNull()
        return result!
    }
    const box = (...a: Parameters<Modeler['box']>) => modeler.box(...a) as meshup.Mesh

    it('writes a moved box as a translated cube and selects it with PART', () =>
    {
        box(10, 20, 30).move(5, 6, 7).name('plate')
        const { text, parts } = exportScene()
        expect(parts).toEqual([{ module: 'plate', label: 'plate', path: expect.stringMatching(/plate$/), kind: 'csg' }])
        expect(moduleBody(text, 'plate')).toContain('translate([5, 6, 7]) cube([10, 20, 30], center = true);')
        expect(moduleBody(text, 'plate')).not.toContain('color(')   // no colour chosen: none written
        expect(text).toContain('$fn = 32;')
        expect(text).toContain('PART = "";')
        expect(text).toContain('if (PART == "" || PART == "plate") plate();')
    })

    it('writes cylinders, cones and spheres in their recipe frames', () =>
    {
        ;(modeler.cylinder(5, 40) as meshup.Mesh).name('rod')
        ;(modeler.sphere(8, [100, 0, 0]) as meshup.Mesh).name('ball')
        const { text } = exportScene()
        expect(moduleBody(text, 'rod')).toContain('cylinder(h = 40, r = 5);')
        expect(moduleBody(text, 'ball')).toMatch(/translate\(\[100, 0, 0\]\) sphere\(r = 8(, \$fn = \d+)?\);/)
    })

    it('writes a rotated box through multmatrix', () =>
    {
        box(100, 10, 10).rotateZ(30).name('beam')
        const body = moduleBody(exportScene().text, 'beam')
        expect(body).toMatch(/multmatrix\(\[\[0\.866025403784, -0\.5, 0, 0\], \[0\.5, 0\.866025403784, 0, 0\], \[0, 0, 1, 0\], \[0, 0, 0, 1\]\]\) cube\(\[100, 10, 10\], center = true\);/)
    })

    it('writes the editor start script as a coloured difference, the hidden tool only inside it', () =>
    {
        const main = box(50).color('red').name('myMainBox')
        main.subtract(box(25).color('blue').name('subBox').moveTo((main as any).bbox().corner('leftfronttop')).hide())
        const { text, parts } = exportScene()
        expect(parts.map(p => p.module)).toEqual(['myMainBox'])
        const body = moduleBody(text, 'myMainBox')
        expect(body).toContain('color([1, 0, 0]) difference() {')
        expect(body).toContain('cube([50, 50, 50], center = true);')
        expect(body).toContain('translate([-25, -25, 25]) cube([25, 25, 25], center = true);')
    })

    it("writes a colour chosen on a layer, and the shape's own colour and opacity over it", () =>
    {
        modeler.layer('walls').color('blue')
        box(10).name('plain')
        box(10).color('#00ff00').opacity(0.5).name('glass')
        const { text } = exportScene()
        expect(moduleBody(text, 'plain')).toContain('color([0, 0, 1]) cube(')
        expect(moduleBody(text, 'glass')).toContain('color([0, 1, 0, 0.5]) cube(')
    })

    it('writes union and intersect as union() and intersection()', () =>
    {
        box(20).union(modeler.sphere(12, [10, 0, 0]) as meshup.Mesh)
        ;(box(20).name('b') as any).intersect(modeler.sphere(12) as meshup.Mesh)
        const { text } = exportScene()
        expect(text).toContain('union() {')
        expect(text).toContain('intersection() {')
    })

    it('writes a perpendicular extrusion whose prism corners are exactly the mesh', () =>
    {
        const beam = (modeler.line([0, 0, 0], [100, 0, 50]).extrude(20, [0, 1, 0]) as any).extrude(-10).name('beam') as meshup.Mesh
        const body = moduleBody(exportScene().text, 'beam')
        expect(body).toMatch(/linear_extrude\(height = 10\) polygon\(/)
        expect(new Set(extrusionCorners(body).map(key))).toEqual(new Set(beam.positions().map(p => key([p.x, p.y, p.z]))))
    })

    it('writes an oblique extrusion as a sheared multmatrix, corners exact', () =>
    {
        const face = modeler.line([0, 0, 0], [100, 0, 0]).extrude(50, [0, 1, 0]) as any
        const sheared = face.extrude(30, [1, 0, 1]).name('sheared') as meshup.Mesh
        const body = moduleBody(exportScene().text, 'sheared')
        expect(body).toMatch(/linear_extrude\(height = 1\) polygon\(/)
        expect(new Set(extrusionCorners(body).map(key))).toEqual(new Set(sheared.positions().map(p => key([p.x, p.y, p.z]))))
    })

    it('keeps a moved and rotated extrusion exact', () =>
    {
        const beam = (modeler.rectBetween([0, 0, 0], [400, 300, 0]) as any).extrude(18).name('board') as meshup.Mesh
        beam.rotateX(20)
        beam.move(10, 20, 30)
        const body = moduleBody(exportScene().text, 'board')
        expect(new Set(extrusionCorners(body).map(key))).toEqual(new Set(beam.positions().map(p => key([p.x, p.y, p.z]))))
    })

    it('writes a cutoff as a difference with the half-space box', () =>
    {
        box(100, 10, 10).cutoff('x', 20).name('bar')
        const body = moduleBody(exportScene().text, 'bar')
        expect(body).toContain('difference() {')
        expect(body.match(/cube\(/g)).toHaveLength(2)
    })

    it('bakes an unrecorded shape into a closed, clockwise polyhedron of its volume', () =>
    {
        const odd = box(10, 20, 30).name('odd')
        ;(odd as any).inverse().inverse()   // unrecorded, geometrically a no-op
        const { text, parts } = exportScene()
        expect(parts[0]).toMatchObject({ module: 'odd', kind: 'baked', reason: 'inverse() is not recorded' })
        expect(text).toContain('//   baked: odd (inverse() is not recorded)')
        const poly = polyhedronOf(moduleBody(text, 'odd'))
        expect(poly.points).toHaveLength(8)
        expect(poly.faces).toHaveLength(6)
        // clockwise seen from outside: the signed volume comes out negative
        expect(poly.volume6 / 6).toBeCloseTo(-6000, 6)
    })

    it('bakes a boolean with holes in its faces into faces without holes', () =>
    {
        const plate = box(100, 100, 10).name('plate')
        plate.subtract(box(20, 20, 50))
        ;(plate as any).inverse().inverse()
        const poly = polyhedronOf(moduleBody(exportScene().text, 'plate'))
        expect(poly.volume6 / 6).toBeCloseTo(-(100 * 100 * 10 - 20 * 20 * 10), 3)
    })

    it('bakes everything when parametric export is off', () =>
    {
        box(10).name('a')
        const { parts, text } = exportScene({ parametric: false })
        expect(parts[0].kind).toBe('baked')
        expect(text).toContain('polyhedron(')
    })

    it('writes closed faces as 2D parts outside the default render, and skips open curves', () =>
    {
        const face = new meshup.Polygon([[0, 0, 0], [100, 0, 0], [100, 0, 50], [0, 0, 50]])
        face.addHole([[25, 0, 10], [75, 0, 10], [75, 0, 40], [25, 0, 40]])
        modeler.addToScene(face as any)
        face.name('front')
        ;(modeler.rectBetween([0, 0, 0], [30, 20, 0]) as any).name('floorplan')
        ;(modeler.line([0, 0, 0], [10, 10, 0]) as any).name('guide')
        box(10).name('solid')
        const { text, parts } = exportScene()
        expect(parts.filter(p => p.kind === '2d').map(p => p.module).sort()).toEqual(['floorplan', 'front'])
        expect(text).toContain('if (PART == "front") front();')
        expect(text).not.toContain('PART == "" || PART == "front"')
        expect(moduleBody(text, 'front')).toMatch(/paths = \[\[0, 1, 2, 3\], \[4, 5, 6, 7\]\]/)
        expect(text).toContain('// front: 2D, drawn in its own plane')
        expect(moduleBody(text, 'floorplan')).toContain('[30, 20]')
        expect(text).toContain('// Skipped: guide (open curve)')
    })

    it('writes a flat surface without volume as a 2D part, and skips a folded one', () =>
    {
        const flat = meshup.Mesh.planeBetween([0, 0, 0], [30, 0, 20])        // a vertical rectangle, no volume
        modeler.addToScene(flat as any)
        flat.name('panel')
        const folded = meshup.Mesh.fromPolygons([[[0, 0, 0], [10, 0, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [0, 10, 5]]])
        modeler.addToScene(folded as any)
        folded.name('fold')
        box(10).name('solid')
        const { text, parts } = exportScene()
        expect(parts.find(p => p.label === 'panel')).toMatchObject({ kind: '2d', reason: 'a surface without volume' })
        expect(text).toContain('// panel: 2D, a surface without volume, drawn in its own plane')
        expect(text).not.toContain('polyhedron(')
        expect(text).toContain('// Skipped: fold (a curved surface: OpenSCAD has no surfaces)')
    })

    it('lists the script and its parameters in the header, for reference only', () =>
    {
        box(10).name('a')
        const { text } = exportScene({ name: 'workbench', version: '1.2.0', params: [{ name: 'WIDTH', _value: 1000 }, { name: 'FINISH', default: 'oak' }] })
        expect(text.split('\n')[0]).toBe('// Archiyou -> OpenSCAD  |  script: workbench 1.2.0  |  units: mm')
        expect(text).toContain('//   WIDTH = 1000')
        expect(text).toContain('//   FINISH = "oak"')
    })

    it('states model units other than millimetres without scaling', () =>
    {
        modeler.units('cm')
        box(10).move(1, 0, 0).name('a')
        const { text } = exportScene()
        expect(text).toContain('coordinates are in cm (STL readers assume millimetres)')
        expect(text).toContain('translate([1, 0, 0]) cube([10, 10, 10], center = true);')
    })

    it('returns null for a scene without exportable geometry', () =>
    {
        expect(buildSCAD(modeler.scene(), { units: 'mm' })).toBeNull()
    })

    it('reads as the checked-in example', async () =>
    {
        const legs = [[0, 0], [560, 0], [0, 360], [560, 360]].map(([x, y], i) =>
            (modeler.boxBetween([x, y, 0], [x + 40, y + 40, 700]) as any).name(`leg${i}`))
        const top = (modeler.rectBetween([-20, -20, 700], [620, 420, 700]) as any).extrude(25).name('top') as meshup.Mesh
        top.subtract((modeler.cylinder(15, 100, [300, 200, 650]) as meshup.Mesh).hide())
        top.color('#b08050')
        const brace = (modeler.line([40, 20, 100], [560, 20, 600]).extrude(20, [0, 1, 0]) as any).extrude(20).name('brace')
        void legs; void brace
        await expect(exportScene({ name: 'table', version: '0.1.0', params: [{ name: 'WIDTH', _value: 600 }] }).text)
            .toMatchFileSnapshot('./__snapshots__/scad.table.scad')
    })
})
