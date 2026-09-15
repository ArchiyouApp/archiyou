/**
 * exportStyle.ts
 *
 * Style helpers shared by the scene-walking exporters (DAE, FreeCAD, OpenSCAD): how a node's style
 * cascades onto its shapes, what counts as visible, and colours as 0..1 floats. Kept tiny, and only
 * imported by exporters that are themselves loaded lazily.
 */

import { Color, Style } from '@archiyou/meshup'

/** The node's effective style (inherited from its ancestors) with the shape's own explicit style on
 *  top, as the glTF export applies it. Falls back to the shape's style if the node has none. */
export function cascadedStyle(node: any, shape: any): any
{
    try
    {
        const merged = new Style(node.effectiveStyle().toData())
        merged.merge(shape.style.explicitData())
        return merged
    }
    catch { return shape?.style }
}

/** A node or shape is exportable unless its style says hidden.
 *  NOTE: SceneNode.visible(v) is a SETTER; calling it bare would throw, so read the Style. */
export function isVisible(styleOwner: any): boolean
{
    return styleOwner?.style?.visible !== false
}

/** Any CSS colour as 0..1 floats. Unset or unparseable colours give `fallback` (0..255 per channel). */
export function toRgb01(color: unknown, fallback: readonly [number, number, number] = [204, 204, 204]): [number, number, number]
{
    let rgb: readonly number[] = fallback
    try { if (color !== undefined && color !== null) rgb = new Color(color as any).toRgb() }
    catch { /* unparseable: keep the fallback */ }
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
}
