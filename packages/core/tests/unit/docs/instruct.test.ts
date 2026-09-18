/** docs.instruct(): building a step-by-step manual from the finished scene.
 *
 *  The rule these tests are really pinning is the one in Instruct's header: a step declares a
 *  DEVIATION from the finished scene, not a snapshot of a moment during modelling. So steps
 *  resolve against final geometry, and resolving must never move it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Calc } from '../../../src/calc/Calc'
import { Docs } from '../../../src/docs/Docs'
import { Instruct, SUBJECT_GROUP, CONTEXT_GROUP } from '../../../src/docs/instruct/Instruct'
import { Step } from '../../../src/docs/instruct/Step'
import type { ArchiyouModules } from '../../../src/types'
import { projectMeshes } from '../../../src/modeler/SVGExporter'

let modeler: Modeler
let calc: Calc
let docs: Docs

/** 4 legs, 2 rails, a top — the smallest thing that is recognisably an assembly. */
async function buildTable()
{
    modeler = new Modeler()
    await modeler.load()
    calc = new Calc()
    docs = new Docs(null, {} as any)

    const modules = { modeler, calc, docs } as unknown as ArchiyouModules
    modeler.setArchiyou(modules)
    calc.setArchiyou(modules)
    docs.setArchiyou(modules)

    modeler.group('legs',
        ...[0, 1, 2, 3].map(i => modeler.box(44, 44, 700)
            .moveToX(i % 2 ? 1100 : 0).moveToY(i < 2 ? 500 : 0).name('leg')))

    modeler.group('frame',
        ...[0, 1].map(i => modeler.box(1180, 44, 60).moveToY(i * 500).moveToZ(600).name('rail')))

    modeler.group('top', modeler.box(1200, 600, 18).moveToZ(730).name('top panel'))
}

beforeEach(async () => { await buildTable() })

describe('docs.instruct()', () =>
{
    it('is reachable from the docs module and returns an Instruct', () =>
    {
        expect(docs.instruct('assembly')).toBeInstanceOf(Instruct)
    })

    it('returns the same instructable for the same name, rather than a second one', () =>
    {
        const first = docs.instruct('assembly')
        expect(docs.instruct('assembly')).toBe(first)
        expect(docs.instructs()).toEqual(['assembly'])
    })

    it('can hold several — an assembly manual and a maintenance one', () =>
    {
        docs.instruct('assembly')
        docs.instruct('maintenance')
        expect(docs.instructs()).toEqual(['assembly', 'maintenance'])
        expect(docs.getInstruct('maintenance')?._name).toBe('maintenance')
    })

    it('is cleared by Docs.reset(), which the Runner calls between runs', () =>
    {
        docs.instruct('assembly')
        docs.reset()
        expect(docs.instructs()).toEqual([])
    })
})

describe('parts', () =>
{
    it('labels every visible solid and reports quantities', () =>
    {
        const parts = docs.instruct('a').parts({ print: false, table: false }).list()

        expect(parts.map(p => [p.label, p.name, p.quantity]))
            .toEqual([['A', 'leg', 4], ['B', 'rail', 2], ['C', 'top panel', 1]])
    })

    it('prints the list, because reading the labels off it is the point', () =>
    {
        const log = vi.spyOn(console, 'info').mockImplementation(() => {})
        docs.instruct('a').parts({ table: false })

        const printed = log.mock.calls.map(c => String(c[0])).find(t => t.includes("Instruct 'a'"))
        log.mockRestore()

        expect(printed).toBeDefined()
        expect(printed).toContain('3 parts, 7 pieces')
        expect(printed).toMatch(/A\s+legs \/ leg\s+beam\s+44x44\s+700\s+x4/)
    })

    it('registers the rows as a Calc table', () =>
    {
        docs.instruct('a').parts({ print: false })

        expect(calc.tables()).toContain('parts')
        const rows = (calc.table('parts') as any).toData()
        expect(rows[0].label).toBe('A')
        expect(rows[0].quantity).toBe(4)
    })

    it('does not throw over a table name already in use — it says so and moves on', () =>
    {
        calc.table('parts', [['something', 1]], ['name', 'n'])
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(() => docs.instruct('a').parts({ print: false })).not.toThrow()
        expect(warn.mock.calls.flat().join(' ')).toContain('already exists')
        warn.mockRestore()

        // the user's own table is untouched
        expect((calc.table('parts') as any).toData()[0].name).toBe('something')
    })

    it('honours a pinned label', () =>
    {
        const parts = docs.instruct('a')
            .part('top', 'A')
            .parts({ print: false, table: false })
            .list()

        expect(parts.find(p => p.group === 'top')!.label).toBe('A')
        expect(new Set(parts.map(p => p.label)).size).toBe(parts.length)
    })

    it('collects on demand when parts() was never called', () =>
    {
        expect(docs.instruct('a').list().length).toBe(3)
    })
})

describe('references', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('resolves a part label to every instance', () =>
    {
        const [ref] = manual.resolveRef('A')
        expect(ref.shapes).toHaveLength(4)
        expect(new Set(ref.paths).size).toBe(4)
    })

    it('resolves one instance, numbered from #1', () =>
    {
        const [ref] = manual.resolveRef('A#2')
        expect(ref.shapes).toHaveLength(1)
        expect(ref.shapes[0]).toBe(manual.resolveRef('A')[0].shapes[1])
    })

    it('resolves a group name to every part in it', () =>
    {
        expect(manual.resolveRef('legs').map(r => r.part.label)).toEqual(['A'])
    })

    it('resolves a Shape reference back to its part', () =>
    {
        const leg = modeler.all().toArray().find((s: any) => s.name?.() === 'leg')
        const [ref] = manual.resolveRef(leg)
        expect(ref.part.label).toBe('A')
        expect(ref.shapes).toEqual([leg])
    })

    it('throws on an unknown reference, listing what would have worked', () =>
    {
        expect(() => manual.resolveRef('Q'))
            .toThrow(/not a part of instructable "a".*A, B, C.*legs, frame, top/s)
    })

    it('throws on an instance that does not exist, saying how many there are', () =>
    {
        expect(() => manual.resolveRef('A#9')).toThrow(/instance 9 of part A, which has 4/)
    })
})

describe('steps', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('numbers steps from 1 and keeps their order', () =>
    {
        manual.step('one')
        manual.step('two')

        const data = manual.toData()
        expect(data.steps.map(s => [s.number, s.title])).toEqual([[1, 'one'], [2, 'two']])
    })

    it('chains from one step into the next', () =>
    {
        const second = manual.step('one').shapes('A').step('two')
        expect(second).toBeInstanceOf(Step)
        expect(manual.steps()).toHaveLength(2)
    })

    it('shows only what a step names', () =>
    {
        manual.step('legs only').shapes('A')
        const [step] = manual.toData().steps

        expect(step.visible).toHaveLength(4)
        expect(step.uses).toEqual(['A'])
    })

    it('shows the whole model when a step names nothing', () =>
    {
        manual.step('the finished thing')
        expect(manual.toData().steps[0].uses).toEqual(['A', 'B', 'C'])
    })

    it('adds a subject to the scene, since a step about an unseen part is never meant', () =>
    {
        manual.step('fit the top').shapes('A').subject('C')
        const [step] = manual.toData().steps

        expect(step.uses).toEqual(['A', 'C'])
        expect(step.subject).toHaveLength(1)
        // subject is a subset of visible — that is what makes the rest context
        step.subject.forEach(path => expect(step.visible).toContain(path))
    })

    it('carries notes, tools and hardware', () =>
    {
        manual.step('bolt it')
            .note('Do not tighten fully until step 7.')
            .tools('allen key 4mm', 'clamp')
            .hardware('M6x40 bolt', 4)

        const [step] = manual.toData().steps
        expect(step.note).toBe('Do not tighten fully until step 7.')
        expect(step.tools).toEqual(['allen key 4mm', 'clamp'])
        expect(step.hardware).toEqual([{ name: 'M6x40 bolt', quantity: 4 }])
    })

    it('records a label at the position of what it points at', () =>
    {
        manual.step('here').shapes('C').label('C', 'the top')
        const [step] = manual.toData().steps

        expect(step.labels).toHaveLength(1)
        expect(step.labels[0].text).toBe('the top')
        expect(step.labels[0].position[2]).toBeGreaterThan(700)   // the top panel is up high
    })

    it('does not move the scene — the finished model is still finished afterwards', () =>
    {
        const before = modeler.all().toArray().map((s: any) => s.center().toArray())

        manual.step('lay them out').shapes('A').layout('row', { spacing: 20 })
        manual.step('assemble').shapes('A', 'B').subject('B').move({ from: 'top' })
        manual.toData()

        expect(modeler.all().toArray().map((s: any) => s.center().toArray())).toEqual(before)
    })
})

describe('layout', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('resolves where each part goes, so the 3D outputs can lay it out too', () =>
    {
        /*  layout() reached the drawings and stopped there: the "here is what you need" step
            showed the finished model in the viewer and in the GLB, because the arrangement
            existed only as detached copies inside the projection. */
        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })
        const [step] = manual.toData().steps

        expect(step.placements).toHaveLength(7)             // 4 legs, 2 rails, a top
        expect(step.placements!.map(p => p.path)).toEqual(step.visible)

        // a row along X: every part at a different x, none of them still stacked in Z
        const xs = step.placements!.map(p => p.position[0])
        expect(new Set(xs).size).toBe(7)
        expect(xs).toEqual([...xs].sort((a, b) => a - b))
    })

    it('carries the rotation a row layout turns a part by, about the part\'s own centre', () =>
    {
        manual.step('lay them out').shapes('A').layout('row', { spacing: 100 })
        const [leg] = manual.toData().steps[0].placements!

        // an upright leg is laid flat, so this is a real rotation and not the identity
        expect(leg.rotation).toHaveLength(4)
        expect(Math.abs(leg.rotation[3])).toBeLessThan(1 - 1e-6)
        expect(leg.centre).toEqual(modeler.all().toArray()[0].bbox().center().toArray())
    })

    it('stacks the pieces of each part when asked for a partstack', () =>
    {
        manual.step('here is what you need').shapes('A', 'B', 'C').layout('partstack')
        const [step] = manual.toData().steps

        // four legs in one stack, two rails in the next, the top in the last
        const columns = step.placements!.reduce((groups: Array<Array<number>>, placement) =>
        {
            const column = groups.find(g => Math.abs(g[0] - placement.position[0]) < 1e-6)
            if (column) { column.push(placement.position[0]) } else { groups.push([placement.position[0]]) }
            return groups
        }, [])

        expect(columns.map(c => c.length)).toEqual([4, 2, 1])    // most used first
    })

    it('stacks what the MANUAL calls a part, not what the step\'s shapes would merge into', () =>
    {
        /*  A step's shapes reach the Layouter as a flat collection with its layers gone, so
            parts re-derived there merge across layers. Two same-sized parts in two layers would
            become one pile of six with the labels pointing at stacks that are not theirs. */
        modeler.group('spares', modeler.box(1180, 44, 60).moveToZ(-500).name('spare rail'))

        const m = docs.instruct('b').parts({ print: false, table: false })
        expect(m.list().map(p => [p.label, p.quantity])).toEqual([['A', 4], ['B', 2], ['C', 1], ['D', 1]])

        m.step('lay them out').layout('partstack')
        const [step] = m.toData().steps

        // the rails and the spare are the same board in different layers: two stacks, not one
        const xs = step.placements!.map(p => +p.position[0].toFixed(6))
        expect(new Set(xs).size).toBe(4)                         // one column per part
        expect(step.placements).toHaveLength(8)
    })

    it('turns each part by its own quaternion, however the layout ordered its transforms', () =>
    {
        /*  partStack emits transforms a stack at a time, MOST-USED PART FIRST — not in the
            order the step's shapes came in. Six pegs put the biggest stack last in the scene
            and first in the layout, so reading transforms back by index crosses the two and
            every part is turned by another part's quaternion.

            The invariant, checked against the kernel rather than against a literal: a piece
            turned by its own placement lies flat, as thick as its own part. */
        modeler.group('pegs', ...[0, 1, 2, 3, 4, 5].map(i =>
            modeler.box(20, 20, 100).moveToX(i * 60).moveToZ(-200).name('peg')))

        const m = docs.instruct('b').parts({ print: false, table: false })
        m.step('here is what you need').layout('partstack')

        const parts = m.list()
        const placements = m.toData().steps[0].placements!
        expect(placements).toHaveLength(13)

        placements.forEach(placement =>
        {
            const part = parts.find(p => p.paths.includes(placement.path))!
            const index = part.paths.indexOf(placement.path)

            const flat = part.shapes[index].copy()
            flat.rotateQuaternion({
                x: placement.rotation[0], y: placement.rotation[1],
                z: placement.rotation[2], w: placement.rotation[3],
            })
            const box = flat.bbox()

            expect(box.max().z - box.min().z).toBeCloseTo(part.measure.thickness, 6)
        })
    })

    it('has none at all for a step that did not ask for one', () =>
    {
        manual.step('assembled').shapes('A', 'B')
        expect(manual.toData().steps[0].placements).toBeUndefined()
    })

    it('frames the step on the layout, not on the assembly it deviates from', () =>
    {
        manual.step('assembled').shapes('A', 'B', 'C')
        manual.step('laid out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        const [assembled, laidOut] = manual.toData().steps

        // a row of parts is far wider than the thing they build, and the camera has to know
        expect(laidOut.bbox[3] - laidOut.bbox[0])
            .toBeGreaterThan((assembled.bbox[3] - assembled.bbox[0]) * 2)
        expect(laidOut.camera.lookAt[0]).not.toBeCloseTo(assembled.camera.lookAt[0], 0)
    })

    it('still does not move the scene', () =>
    {
        const before = modeler.all().toArray().map((s: any) => s.center().toArray())

        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })
        manual.toData()

        expect(modeler.all().toArray().map((s: any) => s.center().toArray())).toEqual(before)
    })

    it('runs the layout once, however many times the step is resolved', () =>
    {
        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        const first = manual.toData().steps[0].placements
        expect(manual.toData().steps[0].placements).toBe(first)     // the same object, cached
    })
})

describe('labels', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    const partLabels = (index = 0) =>
        manual.toData().steps[index].labels.filter(l => l.kind === 'part').map(l => l.text)

    it('names the step\'s subject, because its prose refers to parts by label', () =>
    {
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')
        expect(partLabels()).toEqual(['B'])
    })

    it('names everything in a step with no subject — the "here is what you need" step', () =>
    {
        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })
        expect(partLabels()).toEqual(['A', 'B', 'C'])
    })

    it('names a part once, not once per instance of it', () =>
    {
        manual.step('stand the legs up').shapes('A').subject('A')

        const [label] = manual.toData().steps[0].labels
        expect(label.text).toBe('A')
        expect(label.paths).toEqual(['Scene/legs/leg%5B0%5D'])   // the first one, a real piece
    })

    it('follows the layout, so a label points at where the part actually is', () =>
    {
        manual.step('assembled').shapes('A', 'B', 'C')
        manual.step('laid out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        const [assembled, laidOut] = manual.toData().steps
        const legOf = (s: typeof assembled) => s.labels.find(l => l.part === 'A')!.position

        expect(legOf(laidOut)[0]).not.toBeCloseTo(legOf(assembled)[0], 0)
    })

    it('labels every part on screen when asked to', () =>
    {
        manual.labels('all')
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')
        expect(partLabels()).toEqual(['A', 'B'])
    })

    it('can be turned off, leaving only what the script wrote itself', () =>
    {
        manual.labels(false)
        manual.step('bolt the rails on').shapes('A', 'B').subject('B').label('B', 'the rails')

        expect(manual.toData().steps[0].labels.map(l => [l.text, l.kind]))
            .toEqual([['the rails', 'custom']])
    })

    it('does not label a part the script already labelled by hand', () =>
    {
        manual.step('bolt the rails on').shapes('A', 'B').subject('B').label('B', 'the rails')

        expect(manual.toData().steps[0].labels.map(l => l.text)).toEqual(['the rails'])
    })

    it('draws them onto the step, anchored on the line-work the part actually drew', () =>
    {
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')

        const projection = manual.projectStep(0)!
        expect(projection.degraded).toBe(false)
        expect(projection.labels).toBe(1)

        const [annotation] = projection.drawing.getAnnotations()
        expect(annotation.value).toBe('B')

        // inside the drawing, where the rails are — not at some un-projected 3D coordinate
        const box = projection.drawing.bbox()
        expect(annotation.position.x).toBeGreaterThanOrEqual(box.minX())
        expect(annotation.position.x).toBeLessThanOrEqual(box.maxX())
    })

    it('draws one per part of a laid-out step', () =>
    {
        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        expect(manual.projectStep(0)!.labels).toBe(3)
    })

    it('circles the letter and puts it on the part, which is what a manual looks like', () =>
    {
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')

        const [annotation] = manual.projectStep(0)!.drawing.getAnnotations()
        expect(annotation.shape).toBe('circle')
        expect(annotation.target).toBe('circle')

        /*  On paper the label sits ON the part: a leader from a dot to a circled letter is
            clutter when the letter can sit on the thing it names. The viewer defaults the
            other way — see AnnotatorLabel's header. */
        const svg = annotation.toSVG({ unitsPerMm: 1 })
        expect(svg).toContain('<circle class="annotation text-background"')
        expect(svg).not.toContain('leader')
    })

    it('takes the styling the manual asks for, in the drawings and in the step data alike', () =>
    {
        manual.labels('subject', { shape: 'rect', target: 'arrow', labelOnly: false, length: 14 })
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')

        // the resolved data carries it, which is how the viewer gets the same label
        expect(manual.toData().steps[0].labels[0].options)
            .toMatchObject({ shape: 'rect', target: 'arrow', labelOnly: false, length: 14 })

        const svg = manual.projectStep(0)!.drawing.getAnnotations()[0].toSVG({ unitsPerMm: 1 })
        expect(svg).toContain('<rect class="annotation text-background"')
        expect(svg).toContain('class="annotation arrow')
        expect(svg).toContain('leader')
    })

    it('circles a part label and boxes a sentence, in both renderers', () =>
    {
        /*  A part label is one character and belongs in a circle; a hand-written note is prose
            and a circle around it is a balloon. Resolved in the step data so the drawing and
            the viewer cannot come to different answers about the same label. */
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')
              .label('A', 'the front left leg')

        const [custom, auto] = manual.toData().steps[0].labels
        expect(custom.options?.shape).toBe('rect')
        expect(auto.options?.shape).toBe('circle')

        const drawn = manual.projectStep(0)!.drawing.getAnnotations()
            .map((a: any) => a.toSVG({ unitsPerMm: 1 }))
        expect(drawn.some((svg: string) => svg.includes('<rect class="annotation text-background"'))).toBe(true)
        expect(drawn.some((svg: string) => svg.includes('<circle class="annotation text-background"'))).toBe(true)
    })

    it('lets one hand-written label override the manual\'s styling', () =>
    {
        manual.labels('subject', { shape: 'rect' })
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')
              .label('A', 'the left leg', { shape: 'circle' })

        const [custom, auto] = manual.toData().steps[0].labels
        expect(custom.options?.shape).toBe('circle')
        expect(auto.options?.shape).toBe('rect')
    })

    it('points the leader away from the middle of the drawing, so labels fan out', () =>
    {
        manual.labels('all', { labelOnly: false })
        manual.step('lay them out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        const angles = manual.projectStep(0)!.drawing.getAnnotations().map((a: any) => a.angle)
        expect(new Set(angles).size).toBeGreaterThan(1)     // not all stacked straight up
    })

    it('draws none on a merged projection, which has no per-part line-work to anchor on', () =>
    {
        manual.step('bolt the rails on').shapes('A', 'B').subject('B')

        const projection = manual.projectStep(0, { strategy: 'exact' })!
        expect(projection.degraded).toBe(true)
        expect(projection.labels).toBe(0)
    })
})

describe('cameras', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('defaults to an isometric orthographic camera', () =>
    {
        manual.step('one')
        const { camera } = manual.toData().steps[0]

        expect(camera.projection).toBe('orthographic')
        // looking down the [1,1,-1] diagonal, i.e. from [-1,-1,1] towards the model
        expect(camera.direction.map(n => Math.round(n * 100) / 100))
            .toEqual([0.58, 0.58, -0.58])
    })

    it('takes a named side and looks along that axis', () =>
    {
        manual.step('front on').camera('front')
        const { camera } = manual.toData().steps[0]

        expect(camera.side).toBe('front')
        expect(camera.direction).toEqual([0, 1, 0])
    })

    it('places the eye on the far side of the target from the direction it looks', () =>
    {
        manual.step('front on').shapes('C').camera('front')
        const { camera } = manual.toData().steps[0]

        // looking towards +y, so the eye is at -y of what it is looking at
        expect(camera.position[1]).toBeLessThan(camera.lookAt[1])
    })

    it('takes an explicit eye position in world coordinates', () =>
    {
        manual.step('from over there').camera([5000, -5000, 3000])
        const { camera } = manual.toData().steps[0]

        expect(camera.position).toEqual([5000, -5000, 3000])
        // and the direction follows from it
        expect(camera.direction[0]).toBeLessThan(0)
        expect(camera.direction[1]).toBeGreaterThan(0)
    })

    it('points at the subject by default, not at the whole model', () =>
    {
        manual.step('the top').shapes('A', 'C').subject('C')
        const { camera } = manual.toData().steps[0]

        // the top panel sits at z 730; the legs start at 0. Aiming at the model would be lower.
        expect(camera.lookAt[2]).toBeGreaterThan(700)
    })

    it('takes perspective, and says it is a 3D-only setting', () =>
    {
        manual.perspective()
        manual.step('one')
        expect(manual.toData().steps[0].camera.projection).toBe('perspective')
    })

    it('lets a step override the manual default', () =>
    {
        manual.iso()
        manual.step('iso one')
        manual.step('front one').camera('front')

        const [a, b] = manual.toData().steps
        expect(a.camera.side).toBeUndefined()
        expect(b.camera.side).toBe('front')
    })
})

describe('motion', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('is absent unless a step asks for it', () =>
    {
        manual.step('static').shapes('A')
        expect(manual.toData().steps[0].move).toBeUndefined()
    })

    it('comes in from a named side, travelling towards the model', () =>
    {
        manual.step('drop it on').shapes('A', 'C').subject('C').move({ from: 'top' })
        const { move } = manual.toData().steps[0]

        // from above means it travels DOWN
        expect(move!.direction[2]).toBeLessThan(0)
        expect(move!.distance).toBeGreaterThan(0)
        expect(move!.arrow).toBe(true)      // in print the arrow IS the motion
    })

    it('derives a direction from the assembly when none is given', () =>
    {
        manual.step('fit the top').shapes('A', 'B', 'C').subject('C').move({})
        const { move } = manual.toData().steps[0]

        // the top sits above everything, so it comes down into place
        expect(move!.direction[2]).toBeLessThan(0)
    })

    it('takes duration and easing, and falls back to the manual default', () =>
    {
        manual.duration(0.4)
        manual.step('quick').shapes('C').subject('C').move({})
        manual.step('slow').shapes('C').subject('C').move({ duration: 3, interpolation: 'spring' })

        const [a, b] = manual.toData().steps
        expect(a.move!.duration).toBe(0.4)
        expect(a.move!.interpolation).toBe('easeInOut')
        expect(b.move!.duration).toBe(3)
        expect(b.move!.interpolation).toBe('spring')
    })

    it('can be told not to draw an arrow', () =>
    {
        manual.step('silent').shapes('C').subject('C').move({ arrow: false })
        expect(manual.toData().steps[0].move!.arrow).toBe(false)
    })
})

describe('toData', () =>
{
    it('carries the part list, with a scene path per instance', () =>
    {
        const data = docs.instruct('assembly')
            .title('Workbench')
            .parts({ print: false, table: false })
            .step('one').shapes('A').end()
            .toData()

        expect(data.name).toBe('assembly')
        expect(data.title).toBe('Workbench')
        expect(data.parts.map(p => p.label)).toEqual(['A', 'B', 'C'])
        expect(data.parts[0].paths).toHaveLength(4)
        expect(new Set(data.parts[0].paths).size).toBe(4)
    })

    it('refers to shapes by path, so it survives leaving the scope that made it', () =>
    {
        const data = docs.instruct('a').parts({ print: false, table: false })
            .step('one').shapes('A').end()
            .toData()

        expect(JSON.parse(JSON.stringify(data))).toEqual(data)   // plain data, no live refs
        data.steps[0].visible.forEach(path => expect(typeof path).toBe('string'))
    })
})

describe('projectStep', () =>
{
    let manual: Instruct
    beforeEach(() => { manual = docs.instruct('a').parts({ print: false, table: false }) })

    it('draws a step that a document view could not draw on its own', () =>
    {
        /*  The point of it: a doc view keeps only 2D geometry, so a scene of boxes draws
            nothing at all. Projecting first is what turns it into line-work. */
        manual.step('the legs').shapes('A')
        const projection = manual.projectStep(0)!

        expect(projection).not.toBeNull()
        expect(projection.drawing.length).toBeGreaterThan(0)
        // line-work: the projection flattens solids to curves on the drawing plane
        expect(projection.drawing.toArray().every((s: any) => s.type === 'Curve')).toBe(true)
        expect(projection.drawing.bbox().height()).toBeCloseTo(0, 6)
    })

    it('separates the subject from its context', () =>
    {
        manual.step('fit the top').shapes('A', 'C').subject('C')
        const projection = manual.projectStep(0)!

        expect(projection.degraded).toBe(false)
        expect(projection.drawing._groups.has(SUBJECT_GROUP)).toBe(true)
        expect(projection.drawing._groups.has(CONTEXT_GROUP)).toBe(true)

        // exactly the top panel is the subject; the four legs are context
        expect(projection.drawing.group(SUBJECT_GROUP).length).toBeGreaterThan(0)
        expect(projection.drawing.group(CONTEXT_GROUP).length).toBeGreaterThan(0)
    })

    it('caches, because hidden-line removal is the expensive part of a page render', () =>
    {
        manual.step('the legs').shapes('A')
        const first = manual.projectStep(0)
        expect(manual.projectStep(0)).toBe(first)

        manual.clearProjections()
        expect(manual.projectStep(0)).not.toBe(first)
    })

    it('draws different cameras differently', () =>
    {
        manual.step('iso').shapes('A', 'B', 'C')
        manual.step('front').shapes('A', 'B', 'C').camera('front')

        const iso = manual.projectStep(0)!.drawing.bbox()
        const front = manual.projectStep(1)!.drawing.bbox()

        /*  A flattened drawing has no Z, so its shape is width x depth. An isometric view of a
            table is proportioned quite differently from a straight-on elevation of it. */
        expect(iso.depth() / iso.width()).not.toBeCloseTo(front.depth() / front.width(), 2)
    })

    it('leaves the scene alone — no stray projection layer in the model', () =>
    {
        /*  ShapeCollection.iso()/.elevation() are scene-layer decorated and would drop their
            output into the scene, and from there into the GLB. projectMeshes() uses the
            undecorated variants — this is what pins that. */
        const before = modeler.scene().descendants().length
        const shapesBefore = modeler.all().length

        manual.step('the legs').shapes('A')
        manual.projectStep(0)

        expect(modeler.scene().descendants().length).toBe(before)
        expect(modeler.all().length).toBe(shapesBefore)
    })

    it('projects from the camera SIDE, not along the view direction', () =>
    {
        /*  The kernel's `cam` points from the model towards the eye — Mesh.isometry() says
            "from cam position to origin", and its default [-1,-1,1] is where the camera
            stands. `camera.direction` is the opposite (eye → target), which is what the GLB
            and the viewer want. Passing the view direction straight through drew every step
            from BEHIND the model: hidden-line removal still ran, just against the far side,
            so the drawings came out see-through and inside-out.

            Pinned by drawing the same step from opposite sides and requiring them to differ,
            then by matching ours to the one the kernel gives for the camera position. */
        manual.step('iso').shapes('A', 'B', 'C')

        const ours = manual.projectStep(0)!.drawing
        const camera = manual.toData().steps[0].camera
        const all = modeler.collection(...modeler.all().toArray()) as any

        const fromEye = projectMeshes(all, {
            cam: camera.direction.map(n => -n) as any, strategy: 'clip', fallback: true, hidden: false })
        const fromBehind = projectMeshes(all, {
            cam: camera.direction as any, strategy: 'clip', fallback: true, hidden: false })

        // the two sides genuinely differ, so this is a real distinction and not a no-op
        expect(fromEye.length).not.toBe(fromBehind.length)
        expect(ours.length).toBe(fromEye.length)
    })

    it('draws a laid-out step laid out, not assembled', () =>
    {
        /*  layout() used to be recorded in the step data and never drawn: a "here is what you
            need" step came out looking exactly like the assembled model. */
        manual.step('assembled').shapes('A', 'B', 'C')
        manual.step('laid out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })

        const assembled = manual.projectStep(0)!.drawing.bbox()
        const laidOut = manual.projectStep(1)!.drawing.bbox()

        // a row of parts is far wider than the thing they build
        expect(laidOut.maxX() - laidOut.minX())
            .toBeGreaterThan((assembled.maxX() - assembled.minX()) * 2)
    })

    it('lays out detached copies, so the model is untouched', () =>
    {
        const before = modeler.all().toArray().map((s: any) => s.center().toArray())

        manual.step('laid out').shapes('A', 'B', 'C').layout('row', { spacing: 100 })
        manual.projectStep(0)

        expect(modeler.all().toArray().map((s: any) => s.center().toArray())).toEqual(before)
    })

    it('caches a laid-out step apart from an assembled one', () =>
    {
        manual.step('one').shapes('A', 'B')
        const assembled = manual.projectStep(0)!.drawing.length

        // same step index, now laid out — the cache key has to notice
        manual.steps()[0].layout('row', { spacing: 100 })
        expect(manual.projectStep(0)!.drawing.length).not.toBe(assembled)
    })

    it('is null for a step with nothing in it', () =>
    {
        const empty = docs.instruct('empty')
        empty._parts = []
        empty.step('nothing')
        expect(empty.projectStep(0)).toBeNull()
    })
})
