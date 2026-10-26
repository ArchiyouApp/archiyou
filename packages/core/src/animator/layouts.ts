/**
 *  animator/layouts.ts
 *
 *  Where each shape of the model lies in the layouts animations start or end in: stacks of
 *  stock beside the model ('partstack'), laid flat in a row ('row'), or pulled apart
 *  ('exploded'). resolve.ts runs them for `from()` and `to()`; `animator.layout()` hands them
 *  to a script that keys its parts itself.
 *
 *  Never mutates the scene: Layouter.placements() only says where each shape would go.
 */

import type { LayoutKind, LayoutOptions } from './Animation'
import { Layouter } from '../modeler/Layouter'
import { collectParts, type Part } from '../modeler/parts'
import type { LayoutPlacement } from '../modeler/placements'

/** The placements of a layout, about each part's own centre, keyed by the path of the scene
 *  node the shape is in.
 *  @param only the shapes to lay out; default the whole model */
export function layoutPlacements(modeler: any, kind: LayoutKind, options: LayoutOptions = {}, only: Array<any> = []): Array<LayoutPlacement>
{
    const root = modeler.scene()
    const source = only.length ? modeler.collection(...only) : root
    const layouter = new Layouter(source)

    if (kind === 'exploded')
    {
        layouter.exploded({ distance: options.distance })
    }
    else
    {
        const bounds = boundsOf(root.shapes().toArray())
        const beside = options.beside !== false
        const size = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) || 1
        const spacing = options.spacing ?? (beside ? Math.max(size * 0.05, 1) : undefined)
        const parts = collectParts(source, { labels: false, order: 'scene' })
        const origin = beside ? besideOrigin(kind, bounds, parts, spacing ?? 5) : undefined

        if (kind === 'partstack') { layouter.partStack({ spacing, parts, origin }) }
        else { layouter.rowOrtho({ spacing, origin }) }
    }

    // the Layouter of a collection has nodes of its own: name each by the shape's real node
    return layouter.placements().map(p => ({ ...p, path: p.shape?._node?.path?.() ?? p.path }))
}

/** [minX, minY, minZ, maxX, maxY, maxZ] of shapes. */
export function boundsOf(shapes: Array<any>): [number, number, number, number, number, number]
{
    const boxes = shapes.map(s => s?.bbox?.()).filter(Boolean)
    if (!boxes.length) { return [0, 0, 0, 0, 0, 0] }
    const min = boxes.map((b: any) => b.min())
    const max = boxes.map((b: any) => b.max())
    return [
        Math.min(...min.map((p: any) => p.x)), Math.min(...min.map((p: any) => p.y)), Math.min(...min.map((p: any) => p.z)),
        Math.max(...max.map((p: any) => p.x)), Math.max(...max.map((p: any) => p.y)), Math.max(...max.map((p: any) => p.z)),
    ]
}

/** Where a row or the stacks start so they stand on the ground in front of the model, one
 *  spacing away: laid out, a part's longest side runs along X and its thinnest along Z, so
 *  the row is as deep as the widest part. */
function besideOrigin(kind: LayoutKind, bounds: Array<number>, parts: Array<Part>, spacing: number): [number, number, number]
{
    const [minX, minY, minZ] = bounds
    const widest = Math.max(0, ...parts.map(p => p.measure.width))
    const thickest = Math.max(0, ...parts.map(p => p.measure.thickness))
    return [
        minX,
        minY - spacing - widest / 2,
        // stacks stand on z; rowOrtho centres its shapes on it
        (kind === 'partstack') ? minZ : minZ + thickest / 2,
    ]
}
