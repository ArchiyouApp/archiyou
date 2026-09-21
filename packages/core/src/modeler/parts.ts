/**
 *  parts.ts
 *
 *  What a model is made OF: the solids, measured, classified, merged into parts and labelled.
 *
 *  Two callers need the same answer for different reasons, and before this they could not
 *  share one:
 *
 *    - `Make.partList()` wants a CUT LIST — beams and plates, merged by section and length,
 *      with quantities. Blocks and non-solids are not cut list material and it drops them.
 *    - `docs.instruct` wants a LABEL on every visible solid, because a manual step cannot
 *      point at a part that has no name. Dropping the odd block would leave a hole in the
 *      middle of an assembly.
 *
 *  So this module measures and merges, and each caller filters what it gets. The classifier
 *  itself — OBB dims sorted ascending, beam if it is long for its section, plate if it is thin
 *  for its face — was lifted out of Make.partList() unchanged; `tests/unit/modeler/parts.test.ts`
 *  pins the rows that produced before the move.
 *
 *  Duck-typed on purpose, like modeler/SVGExporter.ts and annotator/annotationLayer.ts: it reads
 *  `obbox()`, `isSolid()`, `name()`, `style` and `_node` off whatever it is handed, so it works
 *  for either kernel and needs no runtime meshup import.
 */

/** What kind of thing a part is, by proportion.
 *
 *  Deliberately only three. `'block'` is the residual — measurable, solid, and neither long
 *  nor thin — so there is no fourth bucket for anything to fall into. A shape that cannot be
 *  measured at all is not a part, and measurePart() returns null for it. */
export type PartKind = 'beam' | 'plate' | 'block'

/** Length is dominant enough over the larger section dimension to call it a beam. */
export const BEAM_RATIO = 2
/** Thin enough relative to its in-plane size to call it a plate. */
export const PLATE_RATIO = 10

export interface PartMeasure
{
    kind: PartKind
    /** OBB dimensions, sorted ascending: thickness <= width <= length. */
    thickness: number
    width: number
    length: number
    volume: number
}

/** One part of the model, and every instance of it. */
export interface Part
{
    /** 'A', 'B', … — empty when labelling is off. */
    label: string
    /** Scene layer or collection group this part belongs to. '' when it has none. */
    group: string
    /** The instances' shape names, joined. */
    name: string
    measure: PartMeasure
    /** Section as a cut list writes it, e.g. '44x20' (width x thickness, rounded). */
    section: string
    /** Length in model units, rounded. */
    length: number
    quantity: number
    /** The instances, in the order they were found. */
    shapes: Array<any>
    /** SceneNode.path() per instance — the identity that survives into the GLB, where a name
     *  does not (four legs are four nodes all called 'leg'). Empty for a shape not in a scene. */
    paths: Array<string>
}

export type PartLabelScheme = 'alpha' | 'numeric'
/** How parts are ordered before labels are handed out — see collectParts(). */
export type PartOrder = 'group' | 'size' | 'scene'

export interface CollectPartsOptions
{
    /** Label scheme, or false for no labels (what a cut list wants). Default 'alpha'. */
    labels?: PartLabelScheme | false
    /** Default 'group'. */
    order?: PartOrder
    /** Labels fixed before the rest are handed out, keyed by a shape or by a group name. */
    pinned?: Map<any, string>
    /** Keep shapes whose style marks them invisible. Default false — a hidden shape is not
     *  part of the thing being built. */
    includeHidden?: boolean
    /** Keep only these kinds. Default: all of them. */
    kinds?: Array<PartKind>
}

/** One shape found in a source, with where it was found. */
interface PartSource
{
    shape: any
    group: string
    name: string
    path: string
}

//// MEASURING ////

/** Measure and classify one shape from its oriented bounding box.
 *
 *  Null when the shape is not a usable solid — a curve, a vertex, a mesh with no volume, or
 *  anything that cannot answer `obbox()`. That is not the same as `'block'`: a block IS a
 *  part, it is just neither long nor thin.
 *
 *  The OBB rather than the axis-aligned bbox, so a rotated beam is still a beam.
 */
export function measurePart(shape: any): PartMeasure | null
{
    if (typeof shape?.obbox !== 'function') { return null }
    if (shape.isSolid?.() === false) { return null } // only solids (mesh / brep), not curves

    const obb = shape.obbox()
    if (!obb || obb.is3D?.() === false) { return null }

    const [thickness, width, length] = [obb.width(), obb.height(), obb.depth()]
        .sort((a: number, b: number) => a - b)
    if (thickness <= 0) { return null }

    const isBeam = length / width >= BEAM_RATIO
    const isPlate = width / thickness >= PLATE_RATIO

    /*  Beam is tested first, and the order matters on the boundary: a 1200x600x18 panel is
        "long" (1200/600 = 2) and "thin" (600/18 = 33) at the same time, and comes out a beam.
        Kept as it was — a cut list that started reclassifying parts on a refactor would be
        worse than one with a debatable edge case. */
    return {
        kind: isBeam ? 'beam' : isPlate ? 'plate' : 'block',
        thickness, width, length,
        volume: thickness * width * length,
    }
}

/** How a cut list writes a section: the two smaller dimensions, larger first. */
export function partSection(m: PartMeasure): string
{
    return `${Math.round(m.width)}x${Math.round(m.thickness)}`
}

/** The key that decides "these are the same part".
 *
 *  Group, kind, section and length — the same four fields `Make.partList()` merged on. Group
 *  is in there deliberately: two identical beams in different sub-assemblies are two parts to
 *  someone following the manual, even though they come off the saw the same. */
export function partSignature(group: string, m: PartMeasure): string
{
    return `${group}-${m.kind}-${partSection(m)}-${Math.round(m.length)}`
}

//// LABELS ////

/** A, B, … Z, AA, AB, … or 1, 2, 3 … */
export function labelForIndex(index: number, scheme: PartLabelScheme = 'alpha'): string
{
    if (scheme === 'numeric') { return String(index + 1) }

    let label = ''
    let n = index
    while (n >= 0)
    {
        label = String.fromCharCode(65 + (n % 26)) + label
        n = Math.floor(n / 26) - 1
    }
    return label
}

//// COLLECTING ////

/** Every shape a source holds, with the group it sits in.
 *
 *  A SceneNode is walked as a tree and the group is the layer the shape lives in — which is
 *  what a script author authored, and what instruct wants. A ShapeCollection is read through
 *  its own groups instead (`forEachGroup`, which answers 'main' when there are none) — which
 *  is what `Make.partList()` has always done, and changing it would rename every row of every
 *  existing cut list. */
function partSources(source: any, includeHidden: boolean): Array<PartSource>
{
    const found: Array<PartSource> = []
    const visible = (shape: any) => includeHidden || shape?.style?.visible !== false

    const nameOf = (shape: any, fallback = '') =>
        (typeof shape?.name === 'function' ? shape.name() : shape?.name) ?? fallback

    // A SceneNode: walk the tree, group = the layer the shape is in
    if (typeof source?.children === 'function' && typeof source?.hasShape === 'function')
    {
        const root = source

        /*  Depth first, and deliberately not SceneNode.descendants(), which is BREADTH first
            (see _traverse). Breadth first puts a loose shape hanging off the root ahead of
            everything inside a layer, so a stray offcut would be labelled A and the legs B —
            the reverse of how the model reads and of what the scene navigator shows.
            Pre-order depth first is authoring order. */
        const walk = (node: any): void =>
        {
            const shape = node.hasShape() ? node.shape() : null
            if (shape && visible(shape))
            {
                const parent = node.parent()
                found.push({
                    shape,
                    // the root is not a group — everything is in it
                    group: (parent && parent !== root) ? parent.name : '',
                    name: nameOf(shape, node.name),
                    path: (typeof node.path === 'function') ? node.path() : '',
                })
            }
            node.children().forEach(walk)
        }

        walk(root)
        return found
    }

    // A ShapeCollection: read its own groups
    if (typeof source?.forEachGroup === 'function')
    {
        source.forEachGroup((groupName: string, groupShapes: any) =>
        {
            groupShapes.forEach((shape: any) =>
            {
                if (!visible(shape)) { return }
                found.push({
                    shape,
                    group: groupName,
                    name: nameOf(shape),
                    path: (typeof shape?._node?.path === 'function') ? shape._node.path() : '',
                })
            })
        })
        return found
    }

    return found
}

/** Join the instance names of one part.
 *
 *  NOTE the substring test rather than an equality test: it is what `Make.partList()` did, and
 *  it means a part with instances named 'rail' and 'rail long' keeps only 'rail'. Preserved
 *  because a cut list's subpart column is prose for a human, and changing how it reads is not
 *  worth the churn — but it is a quirk, not a design. */
function joinInstanceNames(names: Array<string>): string
{
    return names.reduce((joined, name) =>
    {
        if (!name || joined.indexOf(name) !== -1) { return joined }
        return joined ? `${joined},${name}` : name
    }, '')
}

/** The parts of a scene or a collection: measured, merged, ordered and labelled.
 *
 *  Order matters more than it looks. A published manual's prose says "part C", so the label a
 *  part gets has to survive someone dragging a parameter slider. Ordering by size alone
 *  renumbers everything the moment a rail grows longer than a leg, which is why the default is
 *  by GROUP first — groups are authored, and a parameter does not reshuffle them.
 */
export function collectParts(source: any, options?: CollectPartsOptions): Array<Part>
{
    const labels = options?.labels ?? 'alpha'
    const order = options?.order ?? 'group'
    const kinds = options?.kinds
    const pinned = options?.pinned

    const sources = partSources(source, options?.includeHidden === true)

    // measure and merge, keeping first-seen order
    const bySignature = new Map<string, Part>()
    const groupOrder: Array<string> = []

    sources.forEach(({ shape, group, name, path }) =>
    {
        const measure = measurePart(shape)
        if (!measure) { return }                                  // not a part at all
        if (kinds && !kinds.includes(measure.kind)) { return }

        if (!groupOrder.includes(group)) { groupOrder.push(group) }

        const signature = partSignature(group, measure)
        const existing = bySignature.get(signature)

        if (existing)
        {
            existing.quantity += 1
            existing.shapes.push(shape)
            existing.paths.push(path)
            existing.name = joinInstanceNames([existing.name, name])
            return
        }

        bySignature.set(signature, {
            label: '',
            group,
            name: joinInstanceNames([name]),
            measure,
            section: partSection(measure),
            length: Math.round(measure.length),
            quantity: 1,
            shapes: [shape],
            paths: [path],
        })
    })

    const parts = [...bySignature.values()]

    if (order === 'group')
    {
        parts.sort((a, b) =>
            (groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group))
            || (b.measure.volume - a.measure.volume)
            || a.name.localeCompare(b.name))
    }
    else if (order === 'size')
    {
        parts.sort((a, b) => (b.measure.volume - a.measure.volume) || a.name.localeCompare(b.name))
    }
    // 'scene' keeps first-seen order

    if (labels !== false) { assignLabels(parts, labels, pinned) }

    return parts
}

/** Hand out labels in order, leaving the pinned ones alone and never reusing one. */
function assignLabels(parts: Array<Part>, scheme: PartLabelScheme, pinned?: Map<any, string>): void
{
    const taken = new Set<string>()

    if (pinned?.size)
    {
        parts.forEach(part =>
        {
            // pinned by any of the part's own shapes, or by its group name
            const byShape = part.shapes.map(s => pinned.get(s)).find(Boolean)
            const label = byShape ?? pinned.get(part.group)
            if (label) { part.label = label; taken.add(label) }
        })
    }

    let next = 0
    parts.filter(p => !p.label).forEach(part =>
    {
        let label = labelForIndex(next++, scheme)
        while (taken.has(label)) { label = labelForIndex(next++, scheme) }
        part.label = label
        taken.add(label)
    })
}

/** How many shapes of a source were looked at but are not parts — curves, vertices, anything
 *  with no measurable volume. Reported rather than silently dropped, because "why is my part
 *  not in the list" is the first question anyone asks. */
export function nonPartCount(source: any, includeHidden = false): number
{
    return partSources(source, includeHidden).filter(s => measurePart(s.shape) === null).length
}
