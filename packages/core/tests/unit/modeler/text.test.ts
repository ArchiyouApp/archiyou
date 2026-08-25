import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import type { ArchiyouModules } from '../../../src/types'

describe('Modeler.text()', () =>
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
    beforeEach(() => modeler.reset())

    it('outline text (default font) adds curves to the scene', () => {
        const r = modeler.text('Ag', { size: 20 })
        expect(modeler.scene().shapes().length).toBeGreaterThan(2)
        expect(r).toBeTruthy()
    })

    it('solid text produces a 3D mesh with correct depth', () => {
        const m: any = modeler.text('AB', { style: 'solid', size: 20, depth: 4 })
        const bb = m.bbox()
        expect(bb.max().z - bb.min().z).toBeCloseTo(4, 1)
    })

    it('stroke text (Hershey) adds open line curves', () => {
        const r = modeler.text('AV', { style: 'stroke', size: 5 })
        expect(modeler.scene().shapes().length).toBeGreaterThan(0)
        expect(r).toBeTruthy()
    })

    it('at + center align positions text', () => {
        modeler.text('X', { size: 20, align: 'center', at: [0, 50, 0] })
        expect(modeler.scene().shapes().length).toBeGreaterThan(0)
    })

    it('unknown named font throws (must loadFont first)', () => {
        expect(() => modeler.text('Hi', { font: 'NotLoaded' })).toThrow()
    })

    it('loadFont registers bytes and text uses them', async () => {
        const { readFileSync } = await import('fs')
        // the meshup workspace package, not the old devlibs/csgrs checkout it used to live in
        const bytes = new Uint8Array(readFileSync('../meshup/rust/asar.ttf'))
        await modeler.loadFont('asar', bytes)
        const r = modeler.text('Hi', { font: 'asar', size: 20 })
        expect(r).toBeTruthy()
    })

    it('exports scene with text to GLB', async () => {
        modeler.text('OK', { style: 'solid', size: 15, depth: 2 })
        const glb = await modeler.toGLB()
        expect(glb.byteLength).toBeGreaterThan(0)
    })
})
