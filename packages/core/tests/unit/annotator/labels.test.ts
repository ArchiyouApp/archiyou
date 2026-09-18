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

    /** A box to hang a label on. Cast because `label()` is added to shapes at runtime by
     *  modeler/shapeAnnotations.ts and the kernel shape types do not know about it. */
    const box = () => modeler.box(5, 5, 5) as any

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

    /*  NOTE: `target`, and `circle` beside it. The anchor marker used to be a boolean, back
        when a circle was the only thing it could be; `circle` and the older `arrow` survive as
        INPUT aliases (Label.setOptions) and `circle` is still emitted so an older viewer keeps
        working, but `target` is what says which of the two is drawn. */
    it('line:true gives default leader length/angle, no anchor marker', () =>
    {
        modeler.box(5, 5, 5).label('L', { line: true })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.line).toBe(true)
        expect(d.offset).toBe(40)
        expect(d.angle).toBe(90)
        expect(d.target).toBe('none')
        expect(d.circle).toBe(false)
    })

    it('puts the text in a circle unless asked for a rectangle', () =>
    {
        box().label('A')
        box().moveToX(50).label('B', { shape: 'rect' })

        const [a, b] = annotator.getAnnotationsData() as LabelData[]
        expect(a.shape).toBe('circle')
        expect(b.shape).toBe('rect')
    })

    it('drops the circle for a rectangle once the text outgrows it', () =>
    {
        /*  A circle is circumscribed about the text box, so it grows with that box's
            diagonal: right for a circled letter, a balloon for a sentence. */
        box().label('A')
        box().moveToX(50).label('AA')
        box().moveToX(100).label('999')
        box().moveToX(150).label('Front left leg')

        expect((annotator.getAnnotationsData() as LabelData[]).map(d => d.shape))
            .toEqual(['circle', 'circle', 'circle', 'rect'])
    })

    it('keeps a circle the script asked for, however long the text', () =>
    {
        // the fallback decides a default; it does not overrule a script that said what it wants
        box().label('Front left leg', { shape: 'circle' })
        expect((annotator.getAnnotationsData() as LabelData[])[0].shape).toBe('circle')
    })

    it('takes the cut-off from the annotator, so a script can move it', () =>
    {
        box().label('AA')

        // read while the setting is in force: the shape is resolved on export, not on creation
        annotator.LABEL_CIRCLE_MAX_CHARS = 1
        try
        {
            expect((annotator.getAnnotationsData() as LabelData[])[0].shape).toBe('rect')
        }
        finally { annotator.LABEL_CIRCLE_MAX_CHARS = 3 }

        expect((annotator.getAnnotationsData() as LabelData[])[0].shape).toBe('circle')
    })

    it('takes an arrowhead as the anchor marker, and implies a leader with it', () =>
    {
        box().label('L', { target: 'arrow' })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.target).toBe('arrow')
        expect(d.line).toBe(true)
        expect(d.circle).toBe(false)     // the legacy flag means the circle, and this is not
    })

    it('takes the leader length under one name, whichever renderer reads it', () =>
    {
        box().label('L', { length: 25, angle: 30 })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.length).toBe(25)
        expect(d.offset).toBe(25)        // the viewer's older name, kept in step
        expect(d.angle).toBe(30)
        expect(d.line).toBe(true)        // implied
    })

    it('carries labelOnly through unset, because the two renderers default it differently', () =>
    {
        box().label('L')
        box().moveToX(50).label('M', { labelOnly: false })

        const [plain, full] = annotator.getAnnotationsData() as LabelData[]
        expect(plain.labelOnly).toBeNull()
        expect(full.labelOnly).toBe(false)
        expect(full.line).toBe(true)     // "not label only" is a leader, by definition
    })

    it('a leader is implied when offset/circle is set; values pass through', () =>
    {
        modeler.box(5, 5, 5).label('L', { offset: 80, angle: 45, circle: true })
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.line).toBe(true)        // implied
        expect(d.offset).toBe(80)
        expect(d.angle).toBe(45)
        expect(d.circle).toBe(true)
    })

    it('the deprecated `arrow` input now sets an actual arrowhead', () =>
    {
        /*  `arrow:true` was an alias for the circle marker, from when the marker WAS an
            arrowhead and before it was renamed. There is a real arrow again, so the alias
            means what it says rather than the opposite of it. */
        modeler.box(5, 5, 5).label('L', { arrow: true } as any)
        const d = (annotator.getAnnotationsData() as LabelData[])[0]
        expect(d.target).toBe('arrow')
        expect(d.line).toBe(true)        // implied, same as any other marker
    })

    it('annotator.reset() clears labels', () =>
    {
        modeler.box(5, 5, 5).label('x')
        expect(annotator.getAnnotations().length).toBe(1)
        annotator.reset()
        expect(annotator.getAnnotations().length).toBe(0)
    })

    /*  toSVG() is the document renderer. BaseAnnotation.toSVG() returns null and
        annotationLayer() drops anything falsy, so until Label overrode it a labelled drawing
        exported without a single label on it. */
    describe('toSVG', () =>
    {
        const label = (value: string, options?: Record<string, any>) =>
        {
            modeler.box(10, 10, 10).label(value, options as any)
            const all = annotator.getAnnotations()
            return all[all.length - 1] as Label   // several labels per test — take the new one
        }

        it('draws the text, and nothing when there is none', () =>
        {
            expect(label('hello').toSVG()).toContain('>hello<')
            expect(label('').toSVG()).toBe('')
        })

        it('sizes the text in page millimeters when the scale is known', () =>
        {
            const l = label('scaled')
            const svg = l.toSVG({ unitsPerMm: 4 })
            // LABEL_TEXT_SIZE_MM (2.5) x unitsPerMm (4) = 10 model units on a 1:4 drawing
            expect(svg).toContain(`font-size="${annotator.LABEL_TEXT_SIZE_MM * 4}"`)
        })

        it('follows a changed setting', () =>
        {
            annotator.LABEL_TEXT_SIZE_MM = 5
            const svg = label('big').toSVG({ unitsPerMm: 2 })
            expect(svg).toContain('font-size="10"')
            annotator.LABEL_TEXT_SIZE_MM = 2.5
        })

        it('draws the label alone by default — no leader, no marker', () =>
        {
            /*  The page's default, and only the page's: on paper a circled letter sits ON the
                part it names and a leader from a dot to it is clutter. The viewer defaults the
                other way; see AnnotatorLabel's header. */
            const plain = label('plain', { line: true, circle: true }).toSVG({ unitsPerMm: 1 })
            expect(plain).not.toContain('leader')
            expect(plain).not.toContain('class="annotation marker"')
            expect(plain).toContain('>plain<')
        })

        it('draws a leader and a marker when labelOnly is off', () =>
        {
            const withBoth = label('L', { labelOnly: false, circle: true }).toSVG({ unitsPerMm: 1 })
            expect(withBoth).toContain('leader')
            expect(withBoth).toContain('class="annotation marker"')
        })

        it('draws an arrowhead instead of the dot when asked for one', () =>
        {
            const arrow = label('L', { labelOnly: false, target: 'arrow' }).toSVG({ unitsPerMm: 1 })
            expect(arrow).toContain('class="annotation arrow')
            expect(arrow).not.toContain('class="annotation marker"')
        })

        it('circles the text by default, and squares it off when asked', () =>
        {
            expect(label('A').toSVG({ unitsPerMm: 1 })).toContain('<circle class="annotation text-background"')

            const rect = label('A', { shape: 'rect' }).toSVG({ unitsPerMm: 1 })
            expect(rect).toContain('<rect class="annotation text-background"')
            expect(rect).not.toContain('rx=')        // square corners, not a rounded box
        })

        it('draws a long label in a rectangle, the same fallback the data reports', () =>
        {
            const long = label('Front left leg').toSVG({ unitsPerMm: 1 })
            expect(long).toContain('<rect class="annotation text-background"')
            expect(long).not.toContain('<circle class="annotation text-background"')
        })

        it('puts the text at the end of the leader, in the angle asked for', () =>
        {
            // angle 90 is UP on screen, and SVG y points down — so the text sits at -y
            const up = label('up', { labelOnly: false, angle: 90 }).toSVG({ unitsPerMm: 1 })
            const leader = up.match(/class="annotation line leader"[^/]*\/>/)?.[0] ?? ''
            const y1 = Number(leader.match(/y1="(-?[\d.]+)"/)?.[1])
            const y2 = Number(leader.match(/y2="(-?[\d.]+)"/)?.[1])
            expect(y2).toBeCloseTo(y1 - annotator.LABEL_LEADER_LENGTH_MM, 4)
        })

        it('takes the leader length in page millimeters', () =>
        {
            const long = label('L', { labelOnly: false, angle: 90, length: 20 })
                            .toSVG({ unitsPerMm: 1 })
            const leader = long.match(/class="annotation line leader"[^/]*\/>/)?.[0] ?? ''
            const y1 = Number(leader.match(/y1="(-?[\d.]+)"/)?.[1])
            const y2 = Number(leader.match(/y2="(-?[\d.]+)"/)?.[1])
            expect(y2).toBeCloseTo(y1 - 20, 4)
        })

        it('carries an extra CSS class through to the group', () =>
        {
            expect(label('L', { class: 'warning' }).toSVG()).toContain('class="label warning"')
        })

        it('reports its anchor as a Shape with a bbox, so a frame can include it', () =>
        {
            const shape = label('anchored').toShape()
            expect(typeof shape?.bbox).toBe('function')
            expect(shape.bbox().center().toArray().map((n: number) => Math.round(n))).toEqual([0, 0, 0])
        })
    })
})
