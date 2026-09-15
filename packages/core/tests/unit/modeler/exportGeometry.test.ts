/**
 * exportGeometry.test.ts — the welded shell and the style helpers shared by the FreeCAD, DAE and
 * OpenSCAD exporters.
 *
 * `weldFaces()` is what makes a baked mesh a closed solid in every faceted format, so its contract is
 * checked directly here: closedness, outward orientation, T-junction repair, hole winding, degenerate
 * input. The FreeCAD tests (fcstd.test.ts) check the same code once more through OpenCascade.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as meshup from '@archiyou/meshup'
import { Style } from '@archiyou/meshup'

import { weldFaces, meshFaces, signedVolume, newell, type PlanarFace, type Vec3 } from '../../../src/modeler/exportGeometry'
import { cascadedStyle, isVisible, toRgb01 } from '../../../src/modeler/exportStyle'

type P = [number, number, number]
const c = (x: number, y: number, z: number): P => [x, y, z]
const volumeOf = (w: NonNullable<ReturnType<typeof weldFaces>>) => signedVolume(w.points, w.faces) / 6

/** A 1 x 2 x 3 box with its corner at the origin, faces wound outward */
const BOX: PlanarFace[] = [
    { outer: [c(0, 0, 0), c(0, 2, 0), c(1, 2, 0), c(1, 0, 0)] },   // -z
    { outer: [c(0, 0, 3), c(1, 0, 3), c(1, 2, 3), c(0, 2, 3)] },   // +z
    { outer: [c(0, 0, 0), c(1, 0, 0), c(1, 0, 3), c(0, 0, 3)] },   // -y
    { outer: [c(0, 2, 0), c(0, 2, 3), c(1, 2, 3), c(1, 2, 0)] },   // +y
    { outer: [c(0, 0, 0), c(0, 0, 3), c(0, 2, 3), c(0, 2, 0)] },   // -x
    { outer: [c(1, 0, 0), c(1, 2, 0), c(1, 2, 3), c(1, 0, 3)] },   // +x
]

describe('weldFaces', () =>
{
    it('welds a box into eight shared corners and six closed, outward faces', () =>
    {
        const w = weldFaces(BOX)!
        expect(w.points).toHaveLength(8)
        expect(w.faces).toHaveLength(6)
        expect(w.closed).toBe(true)
        expect(volumeOf(w)).toBeCloseTo(6, 12)
        const top = w.faces.find(f => f.normal[2] > 0.5)!
        expect(top.normal).toEqual([0, 0, 1])
    })

    it('turns an inside-out shell outward', () =>
    {
        const inverted = BOX.map(f => ({ outer: [...f.outer].reverse() }))
        const w = weldFaces(inverted)!
        expect(w.closed).toBe(true)
        expect(volumeOf(w)).toBeCloseTo(6, 12)
        expect(w.faces.find(f => Math.abs(f.normal[2]) > 0.5 && w.points[f.outer[0]][2] === 3)!.normal[2]).toBe(1)
    })

    it('reports an open shell as not closed and leaves it as given', () =>
    {
        const w = weldFaces(BOX.slice(1))!
        expect(w.closed).toBe(false)
        expect(w.faces).toHaveLength(5)
    })

    it('closes a T-junction left by a split face', () =>
    {
        const faces: PlanarFace[] = [
            { outer: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)] },
            { outer: [c(1, 0, 1), c(2, 0, 1), c(2, 1, 1), c(1, 1, 1)] },
            { outer: [c(0, 0, 0), c(0, 1, 0), c(2, 1, 0), c(2, 0, 0)] },
            { outer: [c(0, 0, 0), c(2, 0, 0), c(2, 0, 1), c(1, 0, 1), c(0, 0, 1)] },
            { outer: [c(0, 1, 0), c(0, 1, 1), c(2, 1, 1), c(2, 1, 0)] },   // T-junction at (1,1,1)
            { outer: [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)] },
            { outer: [c(2, 0, 0), c(2, 1, 0), c(2, 1, 1), c(2, 0, 1)] },
        ]
        const w = weldFaces(faces)!
        expect(w.closed).toBe(true)
        expect(volumeOf(w)).toBeCloseTo(2, 12)
        expect(w.faces.find(f => f.normal[1] > 0.5)!.outer).toHaveLength(5)   // the back face got the split vertex
    })

    it('welds within the tolerance, drops zero-length edges and zero-area faces', () =>
    {
        const nudged = BOX.map(f => ({ outer: f.outer.map(p => [p[0] + 1e-9, p[1], p[2]] as Vec3) }))
        const faces: PlanarFace[] = [
            ...BOX.slice(0, 3),
            ...nudged.slice(3),
            { outer: [c(5, 5, 5), c(5, 5, 5), c(6, 5, 5)] },                      // collapses to an edge
            { outer: [c(0, 0, 0), c(1, 0, 0), c(2, 0, 0)] },                      // collinear: no area
        ]
        const w = weldFaces(faces)!
        expect(w.faces).toHaveLength(6)
        expect(w.closed).toBe(true)
    })

    it('winds holes against their face', () =>
    {
        const outer = [c(0, 0, 0), c(4, 0, 0), c(4, 4, 0), c(0, 4, 0)]
        const hole = [c(1, 1, 0), c(3, 1, 0), c(3, 3, 0), c(1, 3, 0)]          // same winding as the outer ring
        const w = weldFaces([{ outer, holes: [hole] }])!
        const f = w.faces[0]
        const n = (ring: number[]) => newell(ring.map(i => w.points[i]))
        expect(Math.sign(n(f.outer)[2])).toBe(-Math.sign(n(f.holes[0])[2]))
    })

    it('returns null when nothing is left', () =>
    {
        expect(weldFaces([])).toBeNull()
        expect(weldFaces([{ outer: [c(0, 0, 0), c(1, 0, 0)] }])).toBeNull()
    })
})

describe('meshFaces', () =>
{
    beforeAll(async () => { await meshup.initAsync() })

    it('merges a box mesh into six quads, scaled by the factor', () =>
    {
        const faces = meshFaces(meshup.Mesh.Box(10, 20, 30), 10)
        expect(faces).toHaveLength(6)
        faces.forEach(f => expect(f.outer).toHaveLength(4))
        const xs = faces.flatMap(f => f.outer.map(p => p[0]))
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([-50, 50])
        const w = weldFaces(faces)!
        expect(w.closed).toBe(true)
        expect(volumeOf(w)).toBeCloseTo(6000 * 1000, 3)
    })

    it('closes a boolean union through the T-junction repair', () =>
    {
        const stack = meshup.Mesh.Box(20, 20, 10)
        const top = meshup.Mesh.Box(10, 10, 10)
        top.move(0, 0, 10)
        stack.union(top)
        const w = weldFaces(meshFaces(stack))!
        expect(w.closed).toBe(true)
        expect(volumeOf(w)).toBeCloseTo(stack.volume()!, 6)
    })

    it('gives nothing for something that is not a mesh', () =>
    {
        expect(meshFaces(null)).toEqual([])
        expect(meshFaces({})).toEqual([])
    })
})

describe('export style helpers', () =>
{
    it('parses colours to 0..1 and falls back when there is none', () =>
    {
        expect(toRgb01('#ff0000')).toEqual([1, 0, 0])
        expect(toRgb01(undefined)).toEqual([0.8, 0.8, 0.8])
        expect(toRgb01('not a colour', [0x99, 0x99, 0x99])).toEqual([0.6, 0.6, 0.6])
    })

    it('reads visibility from the style, never calling the visible() setter', () =>
    {
        expect(isVisible({ style: { visible: false } })).toBe(false)
        expect(isVisible({ style: {} })).toBe(true)
        expect(isVisible(undefined)).toBe(true)
    })

    it('cascades the node style onto the shape, the shape winning', () =>
    {
        const nodeStyle = new Style({ color: '#00ff00', opacity: 0.5 } as any)
        const shapeStyle = new Style({ color: '#ff0000' } as any)
        const node = { effectiveStyle: () => nodeStyle }
        const merged = cascadedStyle(node, { style: shapeStyle })
        expect(toRgb01(merged.color)).toEqual([1, 0, 0])
        expect(merged.opacity).toBe(0.5)
        expect(cascadedStyle({}, { style: shapeStyle })).toBe(shapeStyle)
    })
})
