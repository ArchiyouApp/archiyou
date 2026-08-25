import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Annotator } from '../../../src/annotator/Annotator'
import { Label } from '../../../src/annotator/AnnotatorLabel'
import type { ArchiyouModules } from '../../../src/types'
import type { LabelData } from '../../../src/annotator/types'

/**
 * Label annotation: SmartShape.label(value, options) → centralized
 * Annotator.label().fromShape(), serialized via getAnnotationsData().
 */
describe('Labels', () =>
{
    let modeler: Modeler
    let annotator: Annotator

    beforeAll(async () =>
    {
        modeler = new Modeler()
        await modeler.load()

        annotator = new Annotator()
        const modules = { modeler, annotator } as unknown as ArchiyouModules
        modeler.setArchiyou(modules)
        annotator.setArchiyou(modules)
    })

    beforeEach(() =>
    {
        modeler.reset()
        annotator.reset()
    })

    it('shape.label(value) creates one Label annotation', () =>
    {
        const box = modeler.box(10, 10, 10)
        const l = box.label('hello')

        expect(l).toBeInstanceOf(Label)
        expect(annotator.getAnnotations().length).toBe(1)
        expect(Label.isLabel(annotator.getAnnotations()[0])).toBe(true)
    })

    it('serializes to LabelData with type, value and a 3-tuple position', () =>
    {
        modeler.box(10, 10, 10).label('Part A')

        const data = annotator.getAnnotationsData() as LabelData[]
        expect(data.length).toBe(1)

        const d = data[0]
        expect(d.type).toBe('label')
        expect(d.value).toBe('Part A')
        expect(Array.isArray(d.position)).toBe(true)
        expect(d.position).toHaveLength(3)
        expect(d.position.every(n => typeof n === 'number')).toBe(true)
    })

    it('passes through a custom CSS class option', () =>
    {
        modeler.box(5, 5, 5).label('tagged', { class: 'my-label' })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.class).toBe('my-label')
    })

    it('coerces non-string values to string', () =>
    {
        modeler.box(5, 5, 5).label(42 as unknown as string)
        expect((annotator.getAnnotationsData() as LabelData[])[0].value).toBe('42')
    })

    it('labels and dimension lines coexist in the annotation list', () =>
    {
        const box = modeler.box(20, 30, 40)
        box.dim()    // 3 bbox dimension lines (mesh)
        box.label('Block')

        const data = annotator.getAnnotationsData() as Array<{ type?: string }>
        expect(data.some(d => d.type === 'label')).toBe(true)
        expect(data.some(d => d.type === 'dimensionLine')).toBe(true)
    })

    it('line(...).start().label() works (start() returns a SmartMeshVertex)', () =>
    {
        const v = modeler.line([0, 0, 0], [100, 0, 0]).start()
        expect(typeof (v as any).label).toBe('function')

        const l = v.label('A')
        expect(Label.isLabel(l)).toBe(true)

        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.type).toBe('label')
        expect(d.value).toBe('A')
        // anchored at the start vertex (0,0,0)
        expect(d.position.map(n => Math.round(n))).toEqual([0, 0, 0])
    })

    it('line(...).end().label() anchors at the end point', () =>
    {
        modeler.line([0, 0, 0], [100, 0, 0]).end().label('B')
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.position.map(n => Math.round(n))).toEqual([100, 0, 0])
    })

    it('no leader by default', () =>
    {
        modeler.box(5, 5, 5).label('plain')
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.line).toBe(false)
    })

    it('line:true gives default leader length/angle, no arrow', () =>
    {
        modeler.box(5, 5, 5).label('L', { line: true })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.line).toBe(true)
        expect(d.offset).toBe(40)
        expect(d.angle).toBe(90)
        expect(d.arrow).toBe(false)
    })

    it('a leader is implied when offset/arrow is set; values pass through', () =>
    {
        modeler.box(5, 5, 5).label('L', { offset: 80, angle: 45, arrow: true })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.line).toBe(true)        // implied
        expect(d.offset).toBe(80)
        expect(d.angle).toBe(45)
        expect(d.arrow).toBe(true)
    })

    it('annotator.reset() clears labels', () =>
    {
        modeler.box(5, 5, 5).label('x')
        expect(annotator.getAnnotations().length).toBe(1)
        annotator.reset()
        expect(annotator.getAnnotations().length).toBe(0)
    })
})
