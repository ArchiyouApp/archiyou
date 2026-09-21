/**
 *  docs/instruct/Instruct.ts
 *
 *  An instructable: a numbered, illustrated sequence that says how the model is BUILT.
 *
 *  Reached from a script as `docs.instruct('assembly')`, the same way `docs.create('spec')`
 *  reaches a Document. One script can hold several — an assembly manual and a maintenance
 *  manual are different sequences over the same model.
 *
 *  ## The rule everything else follows from
 *
 *  Steps are written AFTER the model is finished, so every step sees the same, final geometry.
 *  A step therefore does not capture a moment during modelling; it declares a DEVIATION from
 *  the finished scene — a subset of the parts, a layout transform, an entry motion. An
 *  assembly manual is a disassembly played backwards.
 *
 *  The practical consequence: a step holds transforms and never mutates the scene. Where a
 *  layout is needed this uses Layouter.result(), never Layouter.apply(), which moves the real
 *  shapes and would leave every later step — and the GLB — looking at a model that had
 *  already been taken apart.
 *
 *  ## Parts
 *
 *  An instructable is written in terms of parts ("fit A into B", "you need four of C"), not
 *  in terms of the script's variables. So it identifies them itself: every visible solid of
 *  the scene is measured, identical ones are merged, and each gets a label. See
 *  modeler/parts.ts, which Make.partList() shares.
 */

import { collectParts, nonPartCount, type Part } from '../../modeler/parts'
import { projectMeshes } from '../../modeler/SVGExporter'
import { Layouter } from '../../modeler/Layouter'
import { Label, labelShapeFor } from '../../annotator/AnnotatorLabel'
import { Step } from './Step'
import {
    isCameraSide,
    type CameraPositionInput, type CameraProjection, type CameraSide, type CameraSpec,
    type InstructData, type InstructLabelMode, type InstructPartsOptions,
    type PartRef, type PartRefInput, type ResolvedCamera, type ResolvedMove,
    type StepData, type StepLabelData, type StepPlacement,
} from './types'
import type { LabelOptions } from '../../annotator/types'
import type { Docs } from '../Docs'
import type { LayoutAnimationInterpolation, LayoutTransformation } from '../../modeler/types'

/** Seconds. Matches GLTF_ANIMATION_DURATION so a step's motion reads like the scene's own. */
const DEFAULT_DURATION = 1.0
/** No turn at all, [x, y, z, w] — what a part gets when the layout did not move it. */
const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1]
/** How far out a part starts when `move()` is given no distance, as a fraction of the
 *  assembly's largest side. Far enough to read as an approach, close enough to stay in frame. */
const MOVE_DISTANCE_FRACTION = 0.35
/** Fallback camera distance, as a multiple of the target's largest side. */
const CAMERA_DISTANCE_FACTOR = 2.5

/** Group names the step drawing is styled through. The projection tags its output `shape-N`
 *  per source shape; these re-tag those so a stylesheet can say "draw the subject solid and
 *  everything else light" without knowing anything about indices. */
export const SUBJECT_GROUP = 'instruct-subject'
export const CONTEXT_GROUP = 'instruct-context'

/** CSS class on an automatic part label, so a document can restyle them as a set:
 *  `view.css({ '.instruct-part-label': 'fill:#c00' })`. */
export const PART_LABEL_CLASS = 'instruct-part-label'

export class Instruct
{
    //// SETTINGS ////
    DEFAULT_TABLE_NAME = 'parts'

    //// END SETTINGS ////

    _docs: Docs
    _name: string
    _title: string | null = null

    _steps: Array<Step> = []

    /** Defaults every step inherits unless it says otherwise. */
    _camera: CameraSpec = { position: [-1, -1, 1], projection: 'orthographic' }
    _duration: number = DEFAULT_DURATION
    /** How much of a step names its own parts, and how those labels are drawn. See labels(). */
    _labelMode: InstructLabelMode = 'subject'
    _labelOptions: LabelOptions = { target: 'circle' }

    /** Labels fixed by the script before the rest are handed out. */
    _pinned: Map<any, string> = new Map()

    /** Filled by parts() or, if it was never called, by _resolve(). */
    _parts: Array<Part> | null = null
    _partsOptions: InstructPartsOptions = {}

    /** Projections, keyed by what they were made of. Hidden-line removal is the expensive
     *  operation in the whole pipeline and a page re-render asks for the same drawing again;
     *  without this a twenty-step manual re-projects twenty times per render. */
    _projections: Map<string, StepProjection | null> = new Map()
    /** Laid-out steps, keyed the same way. The drawing needs the transformed copies and the
     *  3D outputs need the transforms; both come out of one Layouter run, and _resolve() is
     *  called once per step by a page render, so without this a laid-out step re-runs the
     *  layout for every step on the page. */
    _layouts: Map<string, StepLayout | null> = new Map()
    /** Said once per instructable, not once per step — see _projectCollection(). */
    _warnedDegraded = false

    constructor(docs: Docs, name: string)
    {
        this._docs = docs
        this._name = name
    }

    get archiyou(): any
    {
        return (this._docs as any)?._archiyou
    }

    get modeler(): any
    {
        return this.archiyou?.modeler
    }

    //// SETTINGS API ////

    /** Title of the manual, for its title block and for `extras.instruct`. */
    title(title: string): this
    {
        this._title = String(title ?? '')
        return this
    }

    /** Default camera POSITION for every step: a world-space eye point, or a named side of
     *  the target's bounding box ('front', 'top', …).
     *
     *  A position, not a direction — but note that the drawing pipeline wants a direction:
     *  `projectMeshes({ cam })` hands `cam` to `Mesh._resolveViewDirection()`. The conversion
     *  (`normalize(lookAt − position)`) happens in _resolveCamera(). A named side skips it
     *  and goes straight to the kernel's own elevation direction, which is the fast path.
     */
    camera(position: CameraPositionInput): this
    {
        this._camera.position = position
        return this
    }

    /** Default look-at target. Each step falls back to its own subject, then its own scene. */
    lookAt(target: PartRefInput): this
    {
        this._camera.lookAt = target
        return this
    }

    /** Isometric camera for every step: on the [-1,-1,1] diagonal, orthographic. The default. */
    iso(): this
    {
        this._camera.position = [-1, -1, 1]
        this._camera.projection = 'orthographic'
        return this
    }

    /** Perspective projection for every step.
     *
     *  This reaches the 3D output only. The kernel's hidden-line removal is orthographic —
     *  there is no perspective HLR anywhere in the pipeline — so the printed drawings stay
     *  orthographic along the same view direction. Said out loud here because a drawing that
     *  quietly ignores a setting is worse than one that documents why.
     */
    perspective(): this
    {
        this._camera.projection = 'perspective'
        return this
    }

    /** Default motion duration in seconds. */
    duration(seconds: number): this
    {
        this._duration = seconds
        return this
    }

    /** How much of each step names its own parts, with the labels the manual is written in.
     *
     *  A step's prose says "screw B to A", and the reader has to be able to find A and B on
     *  the picture — so by default every step labels what it is ABOUT, in the drawings and in
     *  the 3D viewer alike. A step with no subject labels everything it shows, which is what
     *  the "here is what you need" step wants.
     *
     *      .labels('all')      every part on screen, context included
     *      .labels(false)      only the labels the script wrote itself, with step.label()
     *
     *  Hand-written labels always survive; a part named by one of them is not labelled twice.
     *
     *  The second argument is how they LOOK, and it reaches both the drawings and the viewer:
     *
     *      .labels('subject', { shape: 'rect', target: 'arrow', length: 12, angle: 45 })
     *      .labels('subject', { labelOnly: false })    // leaders on paper too
     *
     *  See AnnotatorLabel for what each one means — and for why `labelOnly` is the one whose
     *  default differs between paper and screen. `step.label()` takes the same options and
     *  overrides these for the one label it makes.
     */
    labels(mode: InstructLabelMode | boolean = 'subject', options?: LabelOptions): this
    {
        this._labelMode = (mode === true) ? 'subject'
                        : (mode === false) ? 'none'
                        : mode
        this._labelOptions = { ...this._labelOptions, ...(options ?? {}) }
        this._projections.clear()   // the drawings carry them
        return this
    }

    //// PARTS ////

    /** Fix a part's label before the rest are handed out.
     *
     *  Labels are assigned by group and then by size, which is stable under most parameter
     *  changes — but a published manual's prose says "part C", so this is the escape hatch
     *  when stability has to be guaranteed. Takes a Shape or a group name.
     */
    part(shapeOrGroup: any, label: string): this
    {
        this._pinned.set(shapeOrGroup, label)
        this._parts = null      // labels changed — collect again
        return this
    }

    /** Identify the parts of the model, label them A, B, C…, and print the list.
     *
     *  Printing is the point: you run the script once, read the labels off the console, and
     *  write them into your steps. Calling this is optional — _resolve() runs it with defaults
     *  if a step referred to a label and nothing had collected them yet.
     *
     *  The rows are also registered as a Calc table (default name 'parts'), so they can be put
     *  on a page with the existing `.table()` container and exported to xlsx for nothing. A
     *  name already in use is reported and skipped rather than thrown over — pass
     *  `{ table: 'assembly-parts' }` to keep both, or `{ table: false }` for none.
     */
    parts(options?: InstructPartsOptions): this
    {
        this._partsOptions = { ...this._partsOptions, ...(options ?? {}) }
        this._collectParts()

        if (this._partsOptions.print !== false) { this._printParts() }
        this._registerPartsTable()

        return this
    }

    /** The parts, as data. Collects them first if nothing has yet. */
    list(): Array<Part>
    {
        if (!this._parts) { this._collectParts() }
        return this._parts ?? []
    }

    _collectParts(): Array<Part>
    {
        const scene = this.modeler?.scene?.()
        if (!scene)
        {
            console.warn(`Instruct::parts(): no scene to read parts from — is this running `
                + `outside a script? Returning none.`)
            this._parts = []
            return this._parts
        }

        this._parts = collectParts(scene, {
            labels: this._partsOptions.labels ?? 'alpha',
            order: this._partsOptions.order ?? 'group',
            includeHidden: this._partsOptions.includeHidden === true,
            pinned: this._pinned,
        })

        return this._parts
    }

    /** The part list as an aligned block of text, the way `Table.print()` writes one. */
    _printParts(): void
    {
        const parts = this._parts ?? []
        const pieces = parts.reduce((sum, p) => sum + p.quantity, 0)

        const lines = [
            `Instruct '${this._name}' — ${parts.length} part${parts.length === 1 ? '' : 's'}, `
                + `${pieces} piece${pieces === 1 ? '' : 's'}`,
            '',
            ...this._partLines(parts),
        ]

        const skipped = nonPartCount(this.modeler?.scene?.(), this._partsOptions.includeHidden === true)
        if (skipped)
        {
            lines.push('', `  not parts: ${skipped} shape${skipped === 1 ? ' is' : 's are'} not `
                + `solid (curves, points) — nothing to point at in a step`)
        }

        console.info(lines.join('\n'))
    }

    /** One aligned line per part. Columns padded here rather than through Calc's own printer,
     *  because this is read while WRITING a script — it wants the label first and loud. */
    _partLines(parts: Array<Part>): Array<string>
    {
        const cells = parts.map(p => [
            p.label,
            p.group ? `${p.group} / ${p.name}` : p.name,
            p.measure.kind,
            p.section,
            String(p.length),
            `x${p.quantity}`,
        ])

        const widths = [0, 1, 2, 3, 4, 5].map(i =>
            Math.max(...cells.map(c => c[i].length), 0))

        return cells.map(c => '  ' + c.map((cell, i) =>
            (i >= 4) ? cell.padStart(widths[i]) : cell.padEnd(widths[i])).join('  ').trimEnd())
    }

    /** Register the part list as a Calc table, if the name is free. */
    _registerPartsTable(): void
    {
        const requested = this._partsOptions.table
        if (requested === false) { return }

        const name = (typeof requested === 'string') ? requested : this.DEFAULT_TABLE_NAME
        const calc = this.archiyou?.calc
        if (!calc?.table) { return }

        if (calc.tables?.().includes(name))
        {
            console.warn(`Instruct::parts(): a table named "${name}" already exists, so the part `
                + `list was not registered as one. Pass { table: '${this._name}-parts' } to keep both, `
                + `or { table: false } to stop asking.`)
            return
        }

        calc.table(name,
            (this._parts ?? []).map(p =>
                [p.label, p.group, p.name, p.measure.kind, p.section, p.length, p.quantity]),
            ['label', 'part', 'subpart', 'type', 'section', 'length', 'quantity'])
    }

    //// STEPS ////

    /** Add a step. Returns the Step to build on. */
    step(title: string): Step
    {
        const step = new Step(this, title, this._steps.length)
        this._steps.push(step)
        return step
    }

    /** The steps, in order. */
    steps(): Array<Step>
    {
        return this._steps
    }

    //// RESOLUTION ////

    /** Resolve a script's reference to the parts it means.
     *
     *  Accepts a Shape, a ShapeCollection, a part label ('A'), one instance of a part ('A#2',
     *  1-based) or a scene layer / group name ('frame'). Anything else throws, listing what
     *  WOULD have worked — a manual is written against labels the author read off a console,
     *  and a typo in one should say so rather than silently drop a part from a step.
     */
    resolveRef(ref: PartRefInput): Array<PartRef>
    {
        const parts = this.list()

        if (typeof ref === 'string')
        {
            const instance = ref.match(/^(.+)#(\d+)$/)
            if (instance)
            {
                const [, label, indexText] = instance
                const part = parts.find(p => p.label === label)
                if (!part) { throw this._unknownRef(ref, parts) }

                const index = parseInt(indexText, 10) - 1     // '#1' is the first
                if (index < 0 || index >= part.shapes.length)
                {
                    throw new Error(`Instruct::shapes(): "${ref}" asks for instance ${index + 1} of `
                        + `part ${label}, which has ${part.shapes.length}. Instances are numbered from #1.`)
                }
                return [{ part, shapes: [part.shapes[index]], paths: [part.paths[index]] }]
            }

            const byLabel = parts.find(p => p.label === ref)
            if (byLabel) { return [this._wholePart(byLabel)] }

            const byGroup = parts.filter(p => p.group === ref)
            if (byGroup.length) { return byGroup.map(p => this._wholePart(p)) }

            throw this._unknownRef(ref, parts)
        }

        // a Shape or a ShapeCollection: find the parts holding those shapes
        const shapes = this._shapesOf(ref)
        const found = new Map<Part, PartRef>()

        shapes.forEach(shape =>
        {
            const part = parts.find(p => p.shapes.includes(shape))
            if (!part) { return }

            const index = part.shapes.indexOf(shape)
            const existing = found.get(part)
            if (existing)
            {
                existing.shapes.push(shape)
                existing.paths.push(part.paths[index])
            }
            else
            {
                found.set(part, { part, shapes: [shape], paths: [part.paths[index]] })
            }
        })

        return [...found.values()]
    }

    _wholePart(part: Part): PartRef
    {
        return { part, shapes: [...part.shapes], paths: [...part.paths] }
    }

    _unknownRef(ref: string, parts: Array<Part>): Error
    {
        const labels = parts.map(p => p.label).join(', ') || '(none)'
        const groups = [...new Set(parts.map(p => p.group).filter(Boolean))].join(', ') || '(none)'
        return new Error(
            `Instruct::shapes(): "${ref}" is not a part of instructable "${this._name}". `
            + `Use a part label (${labels}), one instance of one ('A#2'), a group name (${groups}), `
            + `or a Shape. Run docs.instruct('${this._name}').parts() to print the list.`)
    }

    /** The shapes a Shape / ShapeCollection / array stands for. */
    _shapesOf(o: any): Array<any>
    {
        if (Array.isArray(o)) { return o.flatMap(item => this._shapesOf(item)) }
        if (typeof o?.toArray === 'function') { return o.toArray() }
        if (o) { return [o] }
        return []
    }

    //// CAMERA RESOLUTION ////

    /** Turn a step's camera settings into a position, a target and — the part the drawing
     *  pipeline actually uses — a direction. */
    _resolveCamera(step: Step, targetShapes: Array<any>): ResolvedCamera
    {
        const spec: CameraSpec = {
            position: step._camera.position ?? this._camera.position,
            lookAt: step._camera.lookAt ?? this._camera.lookAt,
            projection: step._camera.projection ?? this._camera.projection ?? 'orthographic',
        }

        const lookAt = this._centreOf(spec.lookAt !== undefined
            ? this._shapesOfRef(spec.lookAt)
            : targetShapes)

        const size = this._sizeOf(targetShapes) || 1

        // A named side is the kernel's own fast path — no position/direction round trip
        if (isCameraSide(spec.position))
        {
            const side = spec.position as CameraSide
            const direction = SIDE_DIRECTIONS[side]
            return {
                side,
                // an eye position on that side, for the 3D output
                position: [
                    lookAt[0] - direction[0] * size * CAMERA_DISTANCE_FACTOR,
                    lookAt[1] - direction[1] * size * CAMERA_DISTANCE_FACTOR,
                    lookAt[2] - direction[2] * size * CAMERA_DISTANCE_FACTOR,
                ],
                lookAt,
                direction,
                projection: spec.projection as CameraProjection,
            }
        }

        const raw = this._pointOf(spec.position) ?? [-1, -1, 1]

        /*  An isometric-style setting is a DIRECTION written as a position — [-1,-1,1] is the
            classic one and is the default. Treat a small vector as a direction from the target
            rather than as an eye point a millimetre from the origin, which is what taking it
            literally would mean for a model of any size. */
        const isUnitish = Math.hypot(raw[0], raw[1], raw[2]) <= 2
        const position: [number, number, number] = isUnitish
            ? [
                lookAt[0] + raw[0] * size * CAMERA_DISTANCE_FACTOR,
                lookAt[1] + raw[1] * size * CAMERA_DISTANCE_FACTOR,
                lookAt[2] + raw[2] * size * CAMERA_DISTANCE_FACTOR,
              ]
            : [raw[0], raw[1], raw[2]]

        return {
            position,
            lookAt,
            direction: normalize([
                lookAt[0] - position[0], lookAt[1] - position[1], lookAt[2] - position[2],
            ]),
            projection: spec.projection as CameraProjection,
        }
    }

    /** Resolve a look-at reference, which may be a part reference OR a bare point/shape. */
    _shapesOfRef(ref: PartRefInput): Array<any>
    {
        if (typeof ref === 'string')
        {
            try { return this.resolveRef(ref).flatMap(r => r.shapes) }
            catch { return [] }
        }
        return this._shapesOf(ref)
    }

    //// MOTION ////

    /** Where the subject comes in from, and how far.
     *
     *  With no direction given, derive one the way Layouter.exploded() does: out from the
     *  centre of everything visible towards the part. That is the direction the part was
     *  installed along, run backwards, which is what an assembly arrow wants to show.
     */
    _resolveMove(step: Step, subjectShapes: Array<any>, sceneShapes: Array<any>): ResolvedMove | undefined
    {
        if (!step._move) { return undefined }

        const spec = step._move
        const size = this._sizeOf(sceneShapes) || 1

        let direction: [number, number, number]
        if (isCameraSide(spec.from as any))
        {
            // 'top' means it comes in FROM above, i.e. it travels downwards
            const away = SIDE_DIRECTIONS[spec.from as CameraSide]
            direction = [away[0], away[1], away[2]]
        }
        else if (Array.isArray(spec.from))
        {
            direction = normalize([spec.from[0] ?? 0, spec.from[1] ?? 0, spec.from[2] ?? 0])
        }
        else
        {
            const from = this._centreOf(sceneShapes)
            const to = this._centreOf(subjectShapes)
            const out = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
            // travels inwards, from its offset start position to its final one
            direction = [-out[0], -out[1], -out[2]]
        }

        return {
            direction,
            distance: spec.distance ?? size * MOVE_DISTANCE_FRACTION,
            duration: spec.duration ?? this._duration,
            interpolation: (spec.interpolation ?? 'easeInOut') as LayoutAnimationInterpolation,
            arrow: spec.arrow !== false,
        }
    }

    //// OUTPUT ////

    /** Resolve every step. Called by the renderers; safe to call more than once. */
    _resolve(): InstructData
    {
        if (!this._parts) { this._collectParts() }

        /*  One continuous timeline, steps back to back. A step lasts as long as its motion,
            or the manual's default when it has none — a step with nothing moving still needs
            a slot, or scrubbing would skip straight past it. */
        let t = 0
        const steps = this._steps.map((step, i) =>
        {
            const resolved = this._resolveStep(step, i)
            const length = resolved.move?.duration ?? this._duration
            resolved.tStart = t
            resolved.tEnd = t + length
            t = resolved.tEnd
            return resolved
        })

        return {
            name: this._name,
            title: this._title ?? undefined,
            duration: t,
            parts: (this._parts ?? []).map(p => ({
                label: p.label,
                group: p.group,
                name: p.name,
                kind: p.measure.kind,
                section: p.section,
                length: p.length,
                quantity: p.quantity,
                paths: p.paths,
            })),
            steps,
        }
    }

    /** Everything a step shows, as one ordered list of instances.
     *
     *  ONE list, built in one place, because the step's drawing tags its projected curves by
     *  INDEX into it (`shape-N`) — that index is the only thread back from a curve to the part
     *  it came from. The data and the drawing each used to derive this list for themselves,
     *  and two copies that drift apart do not fail, they mislabel.
     */
    _stepEntries(step: Step): Array<StepEntry>
    {
        const subjectRefs = step._subjectRefs.flatMap(ref => this.resolveRef(ref))
        const subjectShapes = new Set(subjectRefs.flatMap(r => r.shapes))

        /*  A subject that was never put in shapes() is added to it. Naming the thing a step is
            about and then not showing it is never what was meant. */
        const sceneRefs = step._shapeRefs.length
            ? [...step._shapeRefs.flatMap(ref => this.resolveRef(ref)), ...subjectRefs]
            : (this._parts ?? []).map(p => this._wholePart(p))   // no shapes(): the whole model

        const seen = new Set<any>()

        return sceneRefs
            .flatMap(ref => ref.shapes.map((shape, i) => ({
                shape,
                path: ref.paths[i],
                part: ref.part.label,
                subject: subjectShapes.has(shape),
            })))
            .filter(entry =>
            {
                if (seen.has(entry.shape)) { return false }
                seen.add(entry.shape)
                return true
            })
    }

    _resolveStep(step: Step, index: number): StepData
    {
        const entries = this._stepEntries(step)
        const layout = this._layoutOf(step, entries)

        const sceneShapes = entries.map(e => e.shape)
        const subjectShapes = entries.filter(e => e.subject).map(e => e.shape)

        /*  A laid-out step is framed on the LAYOUT, not on the assembly it deviates from.
            Framing it on the assembly points the camera at the middle of a model that, this
            step, is not there — and sizes the orthographic camera to a tenth of what is on
            screen. */
        const shownShapes = layout?.laidOut ?? sceneShapes
        const shownSubject = layout
            ? layout.laidOut.filter((_, i) => entries[i].subject)
            : subjectShapes

        return {
            index,
            number: index + 1,
            title: step._title,
            tStart: 0,          // filled by _resolve(), which owns the timeline
            tEnd: 0,
            bbox: this._bboxOf(shownShapes),
            visible: dedupe(entries.map(e => e.path)),
            subject: dedupe(entries.filter(e => e.subject).map(e => e.path)),
            uses: dedupe(entries.map(e => e.part)),
            camera: this._resolveCamera(step, shownSubject.length ? shownSubject : shownShapes),
            layout: step._layout ?? undefined,
            placements: layout?.placements,
            move: this._resolveMove(step, subjectShapes, sceneShapes),
            labels: this._resolveLabels(step, entries, layout),
            note: step._note ?? undefined,
            tools: [...step._tools],
            hardware: [...step._hardware],
        }
    }

    //// LABELS ////

    /** The step's labels: the ones the script wrote, and then one per part the step names.
     *
     *  Positions are in the step's OWN space — the laid-out one when it is laid out — so a
     *  viewer can put them straight on screen. The DRAWING does not use these positions; it
     *  anchors on the projected line-work instead, which is exact. See _labelDrawing().
     */
    _resolveLabels(step: Step, entries: Array<StepEntry>, layout: StepLayout | null): Array<StepLabelData>
    {
        const placed = new Map((layout?.placements ?? []).map(p => [p.path, p.position]))

        /** Where a label goes: the laid-out position when the step moved the part, else the
         *  centre of the geometry itself. */
        const positionOf = (paths: Array<string>, shapes: Array<any>): [number, number, number] =>
        {
            const moved = paths.map(path => placed.get(path)).filter(Boolean) as Array<[number, number, number]>
            return moved.length ? centreOfPoints(moved) : this._centreOf(shapes)
        }

        const custom: Array<StepLabelData> = step._labels.map(l =>
        {
            const refs = this._partRefsOf(l.target)
            const paths = refs?.flatMap(r => r.paths) ?? []

            return {
                position: positionOf(paths, this._shapesOfRef(l.target)),
                text: l.text,
                ...(refs?.length === 1 ? { part: refs[0].part.label } : {}),
                ...(paths.length ? { paths } : {}),
                kind: 'custom' as const,
                options: this._labelStyle(l.text, { ...this._labelOptions, ...(l.options ?? {}) }),
            }
        })

        // a part the script already labelled by hand is not labelled again
        const named = new Set(custom.map(l => l.part).filter(Boolean))

        return [
            ...custom,
            ...this._autoLabelled(entries)
                .filter(entry => !named.has(entry.part))
                .map(entry => ({
                    position: positionOf([entry.path], [entry.shape]),
                    text: entry.part,
                    part: entry.part,
                    paths: [entry.path],
                    kind: 'part' as const,
                    options: this._labelStyle(entry.part, this._labelOptions),
                })),
        ]
    }

    /** A label's options with its box resolved: a circled letter for 'B', a rectangle for a
     *  sentence.
     *
     *  Resolved HERE rather than left to each renderer, because the step data is the one place
     *  both of them read: a part label goes to the drawing through Label (which would work it
     *  out itself) and to the viewer through the overlay (which would not), and the two have to
     *  agree about the same label. See labelShapeFor() for the rule.
     */
    _labelStyle(text: string, options: LabelOptions): LabelOptions
    {
        return {
            ...options,
            shape: labelShapeFor(text, options.shape,
                                 (this.archiyou?.annotator as any)?.LABEL_CIRCLE_MAX_CHARS),
        }
    }

    /** One instance per part the step should name — the first of each, so the label points at
     *  a real piece rather than at the space between two of them. */
    _autoLabelled(entries: Array<StepEntry>): Array<StepEntry>
    {
        if (this._labelMode === 'none') { return [] }

        /*  'subject' means "what the step is about" — except in a step with no subject at all,
            which is the "here is what you need" step, where naming every part is the point. */
        const wanted = (this._labelMode === 'all' || !entries.some(e => e.subject))
                            ? entries
                            : entries.filter(e => e.subject)

        const seen = new Set<string>()

        return wanted.filter(entry =>
        {
            if (seen.has(entry.part)) { return false }
            seen.add(entry.part)
            return true
        })
    }

    /** The parts a reference names, or null when it names none — a sub-shape (`leg.select(...)`)
     *  or a bare point is a perfectly good label target and simply is not a part. */
    _partRefsOf(ref: PartRefInput): Array<PartRef> | null
    {
        try
        {
            const refs = this.resolveRef(ref)
            return refs.length ? refs : null
        }
        catch { return null }
    }

    /** The instructable as plain data — what the page composer and the GLB writer read. */
    toData(): InstructData
    {
        return this._resolve()
    }

    /** The scene as a GLB with this instructable baked in: one continuous assembly animation,
     *  a camera per step, and the step data in `extras.instruct`.
     *
     *  Sugar for `modeler.toGLB({ instruct: name })`, which is also reachable as the output
     *  path `default/model/glb?instruct=<name>`. */
    async toGLB(options?: { cameras?: boolean }): Promise<Uint8Array>
    {
        return this.modeler.toGLB({
            instruct: this._name,
            instructCameras: options?.cameras !== false,
        })
    }

    //// DRAWING ////

    /** The 2D line-work of one step, hidden lines removed, ready to put in a document view.
     *
     *  Why this exists at all: a document `view()` draws only 2D geometry — `drawableLayer()`
     *  keeps curves and faces lying flat on XY — so a box handed to one draws NOTHING. Scripts
     *  work around it today by projecting by hand in a doc pipeline
     *  (`chair.elevation('front').move(5000)` in sedia.js), and an instructable cannot ask its
     *  author for one of those per step.
     *
     *  Two things it is careful about:
     *
     *   - **It does not touch the scene.** `ShapeCollection.iso()`/`.elevation()` are
     *     scene-layer decorated and would add their output to the scene, and from there to the
     *     GLB. `projectMeshes()` calls the undecorated `_iso()`/`_elevation()` instead.
     *   - **It keeps per-part identity.** `strategy:'clip'` projects each shape against its
     *     siblings and tags the result per source shape, which is what lets the subject be
     *     drawn solid and the rest as context. It needs convex, non-interpenetrating shapes,
     *     so `fallback:true` downgrades to the merging `'exact'` when it cannot run — and then
     *     there are no per-part groups and the styling degrades, which is worth saying once.
     */
    projectStep(step: Step | number, options?: StepProjectionOptions): StepProjection | null
    {
        const index = (typeof step === 'number') ? step : step._index
        const resolved = this._resolve().steps[index]
        if (!resolved) { return null }

        const strategy = options?.strategy ?? 'clip'
        const key = [
            index, strategy,
            layoutKey(this._steps[index]),
            resolved.camera.side ?? resolved.camera.direction.map(n => n.toFixed(4)).join(','),
            resolved.visible.join('|'),
            resolved.subject.join('|'),
        ].join('::')

        if (this._projections.has(key)) { return this._projections.get(key) ?? null }

        const made = this._projectCollection(index, strategy, options)
        this._projections.set(key, made)
        return made
    }

    /** Drop every cached projection and layout. Call after changing the model behind an
     *  instructable. */
    clearProjections(): this
    {
        this._projections.clear()
        this._layouts.clear()
        return this
    }

    _projectCollection(index: number, strategy: string, options?: StepProjectionOptions): StepProjection | null
    {
        const step = this._steps[index]
        const resolved = this._resolve().steps[index]

        /*  One collection, in a known order, because the projection tags its output `shape-N`
            by index into the VISIBLE MESHES of what it was given
            (ShapeCollection._visibleProjectionMeshes keeps collection order). That index is
            the only thread back from a projected curve to the part it came from. */
        const entries = this._stepEntries(step)
        if (!entries.length) { return null }

        /*  A step can ask to be drawn laid out rather than assembled. The copies are
            index-matched to the entries, so which part a copy came from is still known even
            though it is a different object. */
        const layout = this._layoutOf(step, entries)
        const drawn = layout?.laidOut ?? entries.map(e => e.shape)

        const collection = this.modeler?.collection?.(...drawn)
        if (!collection) { return null }

        const meshEntries = drawn
            .map((shape: any, i: number) => ({ ...entries[i], shape }))
            .filter((e: any) => e.shape?.type === 'Mesh' && e.shape?.style?.visible !== false)
        const meshes = meshEntries.map((e: any) => e.shape)

        const camera = resolved.camera

        /*  `cam` is the CAMERA-SIDE direction — it points from the model towards the eye, not
            the way the camera looks. Mesh.isometry() says so in one line ("from cam position
            to origin") and elevation() documents its `from` the same way; the kernel's own
            default is [-1,-1,1], which is where the camera stands.
 
            `camera.direction` is the opposite: the view direction, eye → target, which is what
            the GLB and the viewer want. Handing that to the projection drew every step from
            behind the model — hidden-line removal still ran, but against the far side, so the
            drawings came out looking see-through and inside-out. */
        const camSide: [number, number, number] = [
            -camera.direction[0], -camera.direction[1], -camera.direction[2],
        ]

        const drawing = projectMeshes(collection, {
            ...(camera.side ? { view: camera.side } : { cam: camSide }),
            strategy: strategy as any,
            fallback: true,
            hidden: options?.hiddenLines === true,
        })

        if (!drawing) { return null }

        /*  A projection that fell back to 'exact' merged everything and has no per-shape
            groups, so nothing in the drawing can be traced back to the part that drew it:
            subject and context cannot be told apart, and there is nowhere to anchor a part
            label. Not an error — the drawing is correct, just uniform — but silently shipping
            a manual with no highlighting and no labels is worse than one line of warning. */
        const degraded = !meshes.some((_: any, i: number) => hasGroup(drawing, `shape-${i}`))

        if (degraded && !this._warnedDegraded)
        {
            this._warnedDegraded = true
            console.warn(`Instruct '${this._name}': the step drawings fall back to a merged `
                + `projection, so the step's subject cannot be drawn differently from its `
                + `context and its parts cannot be labelled. That happens when the parts are `
                + `not convex or they interpenetrate. The drawings are still correct, just `
                + `uniform. The 3D output is unaffected — it labels the parts either way.`)
        }
        else if (!degraded)
        {
            meshEntries.forEach((entry: any, i: number) =>
            {
                const group = getGroup(drawing, `shape-${i}`)
                if (!group?.length) { return }
                drawing.tagGroup?.(entry.subject ? SUBJECT_GROUP : CONTEXT_GROUP, group)
            })
        }

        const labels = degraded ? 0 : this._labelDrawing(drawing, meshEntries, resolved.labels)

        return { drawing, degraded, labels, subjectGroup: SUBJECT_GROUP, contextGroup: CONTEXT_GROUP }
    }

    /** Put the step's part labels onto its drawing, as annotations the page already knows how
     *  to render (annotationLayer() → Label.toSVG()).
     *
     *  Anchored on the PROJECTED LINE-WORK, not on a projected point. A drawing is the
     *  projection flattened onto XY, twisted so the model's up is screen-up, and then
     *  re-centred on its own bounding box (Mesh._flattenProjectionToScreen) — so working out
     *  where a 3D point landed means redoing all of that, against two code paths, from
     *  outside the kernel. The curves the part itself drew are already here and tagged
     *  `shape-N`; their centre is exact and costs one bbox.
     *
     *  A label whose part drew nothing this step is left to the 3D output, which has the real
     *  position: a hand-written label on a sub-shape or a bare point, and every label at all
     *  on a merged projection, where there are no per-part groups to anchor on.
     *
     *  @returns how many were drawn.
     */
    _labelDrawing(drawing: any, entries: Array<StepEntry>, labels: Array<StepLabelData>): number
    {
        const archiyou = this.archiyou
        if (!archiyou || !labels.length) { return 0 }

        const centre = drawing?.bbox?.()?.center?.()

        return labels.reduce((drawn: number, label: StepLabelData) =>
        {
            const index = entries.findIndex(e => label.paths?.includes(e.path))
            const group = (index < 0) ? null : getGroup(drawing, `shape-${index}`)
            if (!group?.length) { return drawn }

            const anchor = group.bbox().center()

            const annotation = new Label(anchor, label.text, {
                /*  A leader, if the label asks for one, points away from the middle of the
                    drawing, so the labels of a step fan outwards rather than stacking on top
                    of each other and on top of the parts they name. A script that names its
                    own angle means it. */
                angle: outwardAngle(anchor, centre),
                class: PART_LABEL_CLASS,
                ...(label.options ?? {}),
            })
            annotation.setArchiyou(archiyou)
            drawing.addAnnotations?.(annotation)

            return drawn + 1
        }, 0)
    }

    //// GEOMETRY HELPERS ////

    /** Centre of a set of shapes' combined bounding box. */
    _centreOf(shapes: Array<any>): [number, number, number]
    {
        const boxes = shapes.map(s => s?.bbox?.()).filter(Boolean)
        if (!boxes.length) { return [0, 0, 0] }

        const min = boxes.map(b => b.min())
        const max = boxes.map(b => b.max())
        return [
            (Math.min(...min.map((p: any) => p.x)) + Math.max(...max.map((p: any) => p.x))) / 2,
            (Math.min(...min.map((p: any) => p.y)) + Math.max(...max.map((p: any) => p.y))) / 2,
            (Math.min(...min.map((p: any) => p.z)) + Math.max(...max.map((p: any) => p.z))) / 2,
        ]
    }

    //// LAYOUT ////

    /** A step's layout, worked out once and kept.
     *
     *  Null when the step asked for none, and null when the layout could not run — either way
     *  the step is shown assembled. Cached because a page render resolves the instructable
     *  once per step, and a layout that is not cached is then run once per step per render.
     */
    _layoutOf(step: Step, entries: Array<StepEntry>): StepLayout | null
    {
        if (!step._layout) { return null }

        const key = `${step._index}::${layoutKey(step)}::${entries.map(e => e.path).join('|')}`
        if (this._layouts.has(key)) { return this._layouts.get(key) ?? null }

        const made = this._runLayout(step, entries)
        this._layouts.set(key, made)
        return made
    }

    /** Run the layout: the detached copies the drawing is made of, and the placements the 3D
     *  outputs need, out of one pass.
     *
     *  `applyAsCopy()` rather than `apply()`: a layout is a way of SHOWING this one step, not
     *  a change to the model. Applying it would move the real shapes and leave every later
     *  step, and the GLB, looking at a product that had already been taken apart. The copies
     *  come back detached, so the scene never sees them.
     *
     *  Order is preserved end to end — Layouter builds its scene from the collection in order,
     *  emits one transform per node in that order, and clones children in order — which is
     *  what lets a copy and a transform be matched back to the part they came from.
     */
    _runLayout(step: Step, entries: Array<StepEntry>): StepLayout | null
    {
        const spec = step._layout
        if (!spec) { return null }

        const shapes = entries.map(e => e.shape)
        const collection = this.modeler?.collection?.(...shapes)
        if (!collection) { return null }

        try
        {
            const layouter = new Layouter(collection)

            if (spec.kind === 'exploded') { layouter.exploded({ distance: spec.distance }) }
            else if (spec.kind === 'partstack')
            {
                layouter.partStack({
                    spacing: spec.spacing ?? spec.distance,
                    parts: this._stepParts(entries),
                })
            }
            else { layouter.rowOrtho({ spacing: spec.spacing ?? spec.distance }) }

            const transforms = layouter.result().transforms
            const laidOut = layouter.applyAsCopy().shapes().toArray()

            if (laidOut.length !== shapes.length)
            {
                console.warn(`Instruct '${this._name}': the '${spec.kind}' layout of step `
                    + `${step._index + 1} returned ${laidOut.length} shapes for ${shapes.length} `
                    + `parts, so it was skipped — the step is shown assembled instead.`)
                return null
            }

            return { laidOut, placements: this._placements(entries, laidOut, transforms) }
        }
        catch (e)
        {
            console.warn(`Instruct '${this._name}': could not lay step ${step._index + 1} out `
                + `('${spec.kind}'): ${e}. Shown assembled instead.`)
            return null
        }
    }

    /** The manual's own parts, narrowed to the pieces one step shows.
     *
     *  What a part-stack step stacks has to be what the manual CALLS a part — the same A, B, C
     *  its labels and its prose use. Re-deriving parts from the handful of shapes one step
     *  holds would not give that: a step's shapes reach the Layouter as a flat collection with
     *  its layers gone, and two parts of equal size in different layers — this model's caps and
     *  its shelves, both 764x300x18 — would merge into one pile of five, with the labels
     *  pointing at stacks that are not theirs.
     */
    _stepParts(entries: Array<StepEntry>): Array<Part>
    {
        const shown = new Set(entries.map(e => e.shape))

        return (this._parts ?? [])
            .map(part =>
            {
                const shapes = part.shapes.filter(shape => shown.has(shape))
                return { ...part, shapes, quantity: shapes.length }
            })
            .filter(part => part.shapes.length > 0)
    }

    /** The layout as something a scene graph can apply: per part, where its centre goes and
     *  how it is turned about that centre.
     *
     *  Positions are read off the copies rather than off the transforms, because a Layouter
     *  transform is a recipe for the kernel (`rotateQuaternion` re-centres, then translate) and
     *  not a rigid transform a viewer could apply. The copies have already been through it.
     *
     *  Rotations are matched by SHAPE, not by index. A layout is free to emit its transforms in
     *  its own order — partStack emits them a stack at a time, most-used part first — and
     *  reading `transforms[i]` would then turn each part by another part's quaternion.
     */
    _placements(entries: Array<StepEntry>, laidOut: Array<any>,
                transforms: Array<LayoutTransformation>): Array<StepPlacement>
    {
        const rotations = new Map(transforms.map(t =>
            [(t.sceneNode as any)?.shape?.(), t.rotation]))

        return entries.map((entry, i) => ({
            path: entry.path,
            position: this._centreOf([laidOut[i]]),
            rotation: [...(rotations.get(entry.shape) ?? IDENTITY_ROTATION)] as [number, number, number, number],
            centre: this._centreOf([entry.shape]),
        }))
    }

    /** Combined bounding box of a set of shapes, as a flat six-tuple. */
    _bboxOf(shapes: Array<any>): [number, number, number, number, number, number]
    {
        const boxes = shapes.map(s => s?.bbox?.()).filter(Boolean)
        if (!boxes.length) { return [0, 0, 0, 0, 0, 0] }

        const min = boxes.map(b => b.min())
        const max = boxes.map(b => b.max())
        return [
            Math.min(...min.map((p: any) => p.x)), Math.min(...min.map((p: any) => p.y)),
            Math.min(...min.map((p: any) => p.z)),
            Math.max(...max.map((p: any) => p.x)), Math.max(...max.map((p: any) => p.y)),
            Math.max(...max.map((p: any) => p.z)),
        ]
    }

    /** Largest side of a set of shapes' combined bounding box. */
    _sizeOf(shapes: Array<any>): number
    {
        const boxes = shapes.map(s => s?.bbox?.()).filter(Boolean)
        if (!boxes.length) { return 0 }

        const min = boxes.map(b => b.min())
        const max = boxes.map(b => b.max())
        return Math.max(
            Math.max(...max.map((p: any) => p.x)) - Math.min(...min.map((p: any) => p.x)),
            Math.max(...max.map((p: any) => p.y)) - Math.min(...min.map((p: any) => p.y)),
            Math.max(...max.map((p: any) => p.z)) - Math.min(...min.map((p: any) => p.z)),
        )
    }

    /** [x,y,z] out of a point-like, whatever shape it arrives in. */
    _pointOf(o: any): [number, number, number] | null
    {
        if (Array.isArray(o)) { return [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0] }
        if (typeof o?.x === 'number') { return [o.x, o.y ?? 0, o.z ?? 0] }
        return null
    }
}

/** Which way you are looking when you look at a model from a named side. Matches the kernel's
 *  own elevation directions (Mesh._resolveViewDirection). */
const SIDE_DIRECTIONS: Record<CameraSide, [number, number, number]> = {
    front:  [0, 1, 0],
    back:   [0, -1, 0],
    left:   [1, 0, 0],
    right:  [-1, 0, 0],
    top:    [0, 0, -1],
    bottom: [0, 0, 1],
}

function normalize(v: Array<number>): [number, number, number]
{
    const length = Math.hypot(v[0], v[1], v[2])
    if (length < 1e-9) { return [0, 0, 1] }
    return [v[0] / length, v[1] / length, v[2] / length]
}

function dedupe(values: Array<string>): Array<string>
{
    return [...new Set(values.filter(Boolean))]
}

/** One instance of one part, as a step shows it. The order of a step's entries is the order
 *  its drawing is projected in, which is what `shape-N` counts. */
export interface StepEntry
{
    shape: any
    /** Scene path of this instance. */
    path: string
    /** Label of the part it is an instance of. */
    part: string
    /** Whether the step is ABOUT this instance, rather than merely showing it. */
    subject: boolean
}

/** A step's `layout()`, run. */
export interface StepLayout
{
    /** Detached, transformed copies — index-matched to the step's entries. */
    laidOut: Array<any>
    /** The same arrangement as something a scene graph can apply. */
    placements: Array<StepPlacement>
}

/** What a step's drawing came out as. */
export interface StepProjection
{
    /** The projected 2D line-work, as a ShapeCollection — hand it to a document view. */
    drawing: any
    /** True when the per-shape strategy could not run, so subject and context are not
     *  separable in the drawing. */
    degraded: boolean
    /** How many part labels were drawn onto it. */
    labels: number
    subjectGroup: string
    contextGroup: string
}

export interface StepProjectionOptions
{
    /** Which hidden-line algorithm. Default 'clip' — the one that keeps per-part identity. */
    strategy?: 'raycast' | 'exact' | 'clip' | 'painter'
    /** Keep occluded edges in a 'hidden' group. Default false. */
    hiddenLines?: boolean
}

/** ShapeCollection.group() logs an error for a group that is not there, so ask first. */
function hasGroup(collection: any, name: string): boolean
{
    return collection?._groups?.has?.(name) === true
}

function getGroup(collection: any, name: string): any
{
    return hasGroup(collection, name) ? collection.group(name) : null
}

/** Centre of a set of points. */
function centreOfPoints(points: Array<[number, number, number]>): [number, number, number]
{
    const axis = (i: number) =>
        (Math.min(...points.map(p => p[i])) + Math.max(...points.map(p => p[i]))) / 2
    return [axis(0), axis(1), axis(2)]
}

/** Which way a label should hang off its anchor: away from the middle of the drawing, in
 *  screen degrees (90 = up), which is how Label reads an angle. Straight up when the anchor
 *  IS the middle, which is what a one-part drawing looks like. */
function outwardAngle(anchor: any, centre: any): number
{
    const dx = (anchor?.x ?? 0) - (centre?.x ?? 0)
    const dy = (anchor?.y ?? 0) - (centre?.y ?? 0)
    if (Math.hypot(dx, dy) < 1e-9) { return 90 }
    return Math.atan2(dy, dx) * 180 / Math.PI
}

/** A step's layout, as a cache key fragment — a step drawn laid out and the same step drawn
 *  assembled are two different drawings. */
function layoutKey(step: Step | undefined): string
{
    const l = step?._layout
    return l ? `${l.kind}:${l.spacing ?? ''}:${l.distance ?? ''}` : 'none'
}
