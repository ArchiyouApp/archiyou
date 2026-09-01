/**
 *  docs/instruct/Step.ts
 *
 *  One step of an instructable: what is on screen, what the step is about, how the camera
 *  looks at it, how the new part arrives, and what the reader is told.
 *
 *  Everything here is stored raw and resolved later by Instruct._resolve(). Two reasons: a
 *  step can then be written before the last shape exists, and a resolved step holds scene
 *  paths rather than Shape references, which is what lets it cross a $component() boundary
 *  (see Document.resolveScopeReferences for the same problem solved the same way).
 *
 *  On the API shape: every verb takes its target explicitly. An earlier sketch had a
 *  `select()` / `deselect()` cursor, so `label()` and `highlight()` each meant two things
 *  depending on invisible state — Document's `_activeContainer` cursor already causes that
 *  class of bug (see the note in tests/cadscripts/scripts/artcrate.js). `subject()` is not a
 *  mode: it is a property of the step, and it is what drives highlighting, framing and motion.
 */

import type { Instruct } from './Instruct'
import type {
    CameraPositionInput, CameraSpec, MoveSpec, PartRefInput,
    StepDimSpec, StepLabelSpec, StepLayoutKind, StepLayoutSpec,
} from './types'

export class Step
{
    _instruct: Instruct
    _title: string
    _index: number

    /** Raw arguments, resolved by Instruct._resolve(). */
    _shapeRefs: Array<PartRefInput> = []
    _subjectRefs: Array<PartRefInput> = []
    _camera: CameraSpec = {}
    _layout: StepLayoutSpec | null = null
    _move: MoveSpec | null = null
    _labels: Array<StepLabelSpec> = []
    _dims: Array<StepDimSpec> = []
    _note: string | null = null
    _tools: Array<string> = []
    _hardware: Array<{ name: string, quantity: number }> = []

    constructor(instruct: Instruct, title: string, index: number)
    {
        this._instruct = instruct
        this._title = title ?? ''
        this._index = index
    }

    //// SCENE ////

    /** What is visible in this step.
     *
     *  Takes Shapes, ShapeCollections, part labels ('A'), single instances ('A#2') or scene
     *  layer names ('frame') — interchangeably, so a step can be written against the model
     *  while it is being developed and against labels once the part list is settled.
     *
     *  Everything in the model that is NOT named here is hidden for this step. With nothing
     *  named at all the step shows the whole model, which is the sensible default for a first
     *  or last step.
     *
     *  NOTE the difference from `docs.view().shapes('name')`, where a string is the name of a
     *  PIPELINE VARIABLE. An instructable works from the live scene rather than a doc
     *  pipeline, so a string here is only ever a part label or a group name.
     */
    shapes(...refs: Array<PartRefInput>): this
    {
        this._shapeRefs.push(...refs.flat())
        return this
    }

    /** What this step is ABOUT.
     *
     *  The subject is highlighted, the camera frames it, and it is what `move()` moves.
     *  Anything in `shapes()` but not here is CONTEXT — the work so far, drawn lighter, so the
     *  reader can see where the new part goes. A subject not already in `shapes()` is added to
     *  it; naming the thing the step is about and then not showing it is never what was meant.
     */
    subject(...refs: Array<PartRefInput>): this
    {
        this._subjectRefs.push(...refs.flat())
        return this
    }

    //// CAMERA ////

    /** Where the camera is: a world-space eye position, or a named side of the subject's
     *  bounding box ('front', 'top', …). See Instruct.camera() for the whole story. */
    camera(position: CameraPositionInput): this
    {
        this._camera.position = position
        return this
    }

    /** What the camera points at. Defaults to the step's subject, or its scene when it has
     *  no subject. */
    lookAt(target: PartRefInput): this
    {
        this._camera.lookAt = target
        return this
    }

    /** The standard isometric camera for this step. */
    iso(): this
    {
        this._camera.position = [-1, -1, 1]
        this._camera.projection = 'orthographic'
        return this
    }

    /** Perspective projection for this step.
     *
     *  3D only. The kernel's hidden-line removal is orthographic — there is no perspective
     *  HLR — so the printed drawing of this step is still an orthographic projection along the
     *  same view direction. */
    perspective(): this
    {
        this._camera.projection = 'perspective'
        return this
    }

    //// ARRANGEMENT AND MOTION ////

    /** Lay the step's parts out rather than showing them where they end up — for a
     *  "here is what you need" step.
     *
     *  Named after the Layouter methods that do the work:
     *
     *      'partstack'   one flat stack per part, side by side, most-used first — the pile of
     *                    cut material the job starts from. Four legs are one stack four boards
     *                    high, so a model with any repetition still fits on the page.
     *      'row'         every piece laid flat in a row, rowOrtho
     *      'exploded'    every piece pushed out from the middle, exploded
     *
     *  A 'partstack' step stacks what THIS MANUAL calls a part — the same A, B, C its labels
     *  and its prose use — not whatever the step's own shapes would merge into.
     *
     *  The layout is a TRANSFORM applied for this step only; the scene itself is never moved,
     *  because every later step and the GLB still need it where it was.
     */
    layout(kind: StepLayoutKind, options?: { spacing?: number, distance?: number }): this
    {
        this._layout = { kind, ...(options ?? {}) }
        return this
    }

    /** How the subject arrives: in from a direction, over a duration.
     *
     *  In the 3D output this is keyframed motion. In print it is an arrow — and in print the
     *  arrow IS the motion, since there is nothing else to see, which is why `arrow` defaults
     *  to true. With no `from`, the direction is derived the way an exploded view derives one:
     *  from the centre of the assembly out to the part.
     */
    move(options?: MoveSpec): this
    {
        this._move = { ...(options ?? {}) }
        return this
    }

    //// ANNOTATION ////

    /** A callout pointing at something. The target takes the same references `shapes()` does,
     *  and can also be a sub-shape (`legLeft.select('F||top')`) or a bare point. */
    label(target: PartRefInput, text: string, options?: Record<string, any>): this
    {
        this._labels.push({ target, text: String(text ?? ''), options })
        return this
    }

    /** A dimension line on something, for a step where a measurement is the instruction. */
    dim(target: PartRefInput, options?: Record<string, any>): this
    {
        this._dims.push({ target, options })
        return this
    }

    //// TEXT ////

    /** The prose under the step: a note, a warning, the thing that is easy to get wrong. */
    note(text: string): this
    {
        this._note = String(text ?? '')
        return this
    }

    /** Tools the reader needs for this step. */
    tools(...names: Array<string>): this
    {
        this._tools.push(...names.flat().map(String))
        return this
    }

    /** Something the step needs that is not in the model — screws, glue, a bracket. Parts that
     *  ARE in the model are derived from shapes()/subject() and need no restating. */
    hardware(name: string, quantity: number = 1): this
    {
        this._hardware.push({ name: String(name), quantity })
        return this
    }

    //// CHAINING ////

    /** Start the next step. Sugar for going back to the Instruct, so a whole manual can be
     *  written as one chain. */
    step(title: string): Step
    {
        return this._instruct.step(title)
    }

    /** The Instruct this step belongs to. */
    end(): Instruct
    {
        return this._instruct
    }
}
