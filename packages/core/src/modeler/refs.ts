/**
 *  modeler/refs.ts
 *
 *  What a script means when it points at part of the model: a Shape, a ShapeCollection, a part
 *  label ('A'), one instance of a part ('A#2', 1-based) or a layer / group name ('frame').
 *  Shared by docs.instruct and the animator, so a manual and an animation of the same model
 *  accept the same references and fail on a typo the same way.
 *
 *  Duck-typed like modeler/parts.ts: no runtime import of either kernel.
 */

import type { Part } from './parts'

/** The parts a reference resolved to, and which of their instances. */
export interface PartRef
{
    part: Part
    /** The instances of that part the reference names. */
    shapes: Array<any>
    /** Their scene paths, index-matched to `shapes`. */
    paths: Array<string>
}

/** The shapes a Shape / ShapeCollection / array stands for. */
export function shapesOf(o: any): Array<any>
{
    if (Array.isArray(o)) { return o.flatMap(item => shapesOf(item)) }
    if (typeof o?.toArray === 'function') { return o.toArray() }
    if (o) { return [o] }
    return []
}

/** Resolve a reference against a list of parts.
 *
 *  A string is a part label, one instance of one ('A#2'), or a group name; anything else
 *  throws `unknown(ref)`, which should list what WOULD have worked — a script is written
 *  against labels the author read off a console, and a typo should say so rather than
 *  silently drop a part. A Shape or a collection resolves to the parts holding those shapes.
 *
 *  @param where who is asking, for the error message ('Instruct::shapes()') */
export function resolvePartRef(ref: any, parts: Array<Part>, unknown: (ref: string) => Error,
    where: string): Array<PartRef>
{
    if (typeof ref === 'string')
    {
        const instance = ref.match(/^(.+)#(\d+)$/)
        if (instance)
        {
            const [, label, indexText] = instance
            const part = parts.find(p => p.label === label)
            if (!part) { throw unknown(ref) }

            const index = parseInt(indexText, 10) - 1     // '#1' is the first
            if (index < 0 || index >= part.shapes.length)
            {
                throw new Error(`${where}: "${ref}" asks for instance ${index + 1} of `
                    + `part ${label}, which has ${part.shapes.length}. Instances are numbered from #1.`)
            }
            return [{ part, shapes: [part.shapes[index]], paths: [part.paths[index]] }]
        }

        const byLabel = parts.find(p => p.label === ref)
        if (byLabel) { return [wholePart(byLabel)] }

        const byGroup = parts.filter(p => p.group === ref)
        if (byGroup.length) { return byGroup.map(p => wholePart(p)) }

        throw unknown(ref)
    }

    // a Shape or a ShapeCollection: find the parts holding those shapes
    const found = new Map<Part, PartRef>()

    shapesOf(ref).forEach(shape =>
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

export function wholePart(part: Part): PartRef
{
    return { part, shapes: [...part.shapes], paths: [...part.paths] }
}
