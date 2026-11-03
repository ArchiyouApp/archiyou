/**
 *  animator/layouts.ts
 *
 *  Where each shape of the model lies in the layouts animations start or end in: stacks of
 *  stock at the origin ('partstack'), those stacks packed into a bin at the origin ('packed'), laid flat in a
 *  row in front of the model ('row'), or pulled apart ('exploded'). resolve.ts runs them for `from()` and `to()`; `animator.layout()` hands them
 *  to a script that keys its parts itself.
 *
 *  Never mutates the scene: Layouter.placements() only says where each shape would go.
 */

import type { LayoutKind, LayoutOptions } from './Animation'
import { Layouter } from '../modeler/Layouter'
import { collectParts, type Part } from '../modeler/parts'
import type { LayoutPlacement } from '../modeler/placements'
import { MM_PER_UNIT } from '../units/UnitConverter'
import { isPack3dLoaded } from '../modeler/Make'

/** The placements of a layout, about each part's own centre, keyed by the path of the scene
 *  node the shape is in.
 *  @param only the shapes to lay out; default the whole model */
export function layoutPlacements(modeler: any, kind: LayoutKind, options: LayoutOptions = {}, only: Array<any> = []): Array<LayoutPlacement>
{
    const root = modeler.scene()
    const source = only.length ? modeler.collection(...only) : root
    const mmPerUnit = MM_PER_UNIT[modeler.units?.()] ?? 1
    const layouter = new Layouter(source, { mmPerUnit })
    const laid = usableLayout(kind)

    if (laid === 'exploded')
    {
        layouter.exploded({ distance: options.distance })
    }
    else
    {
        const bounds = boundsOf(root.shapes().toArray())
        // the stacks stand at the origin, as layout() puts them; the row in front of the model
        const beside = options.beside ?? (laid === 'row')
        const size = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) || 1
        const spacing = options.spacing ?? (beside ? Math.max(size * 0.05, 1) : undefined)
        const parts = collectParts(source, { labels: false, order: 'scene' })
        const origin = beside ? besideOrigin(laid, bounds, parts, spacing ?? 5, mmPerUnit) : undefined
        const centerX = beside ? (bounds[0] + bounds[3]) / 2 : undefined // exactly in front of the model

        if (laid === 'partstack') { layouter.partStack({ spacing, parts, origin, centerX }) }
        else if (laid === 'packed')
        {
            // as tight as layout('packed'): the spacing beside the model is its distance to the bin, not the room in the
            // bin. Beside the model, further bins go away from it.
            layouter.packed({ spacing: options.spacing, parts, origin, centerX, binDirection: beside ? -1 : 1 })
        }
        else { layouter.rowOrtho({ spacing, origin, centerX }) }
    }

    // the Layouter of a collection has nodes of its own: name each by the shape's real node
    return layouter.placements().map(p => ({ ...p, path: p.shape?._node?.path?.() ?? p.path }))
}

/** The layout to run: 'packed' needs the 3D load planner, which the Runner loads only for a run
 *  that names it (or the fly-in). A run it did not see starts from the stacks, unpacked. */
function usableLayout(kind: LayoutKind): LayoutKind
{
    if (kind !== 'packed' || isPack3dLoaded()) { return kind }
    console.warn(`animator: the packed layout needs the 3D load planner, which this run did not load. The parts start from stacks instead.`)
    return 'partstack'
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
 *  spacing away (x is the Layouter's to center, by centerX): laid out, a part's longest side runs along X and its thinnest along Z, so
 *  the row is as deep as the widest part. A packed layout starts with the bin standing in front. */
function besideOrigin(kind: LayoutKind, bounds: Array<number>, parts: Array<Part>, spacing: number, mmPerUnit: number): [number, number, number]
{
    const [minX, minY, minZ] = bounds
    const widest = Math.max(0, ...parts.map(p => p.measure.width))
    // packed(): the origin is the corner of the first bin, 1200 mm wide unless a part is wider
    if (kind === 'packed') { return [minX, minY - spacing - Math.max(1200 / mmPerUnit, widest), minZ] }
    const thickest = Math.max(0, ...parts.map(p => p.measure.thickness))
    return [
        minX,
        minY - spacing - widest / 2,
        // stacks stand on z; rowOrtho centres its shapes on it
        (kind === 'partstack') ? minZ : minZ + thickest / 2,
    ]
}
