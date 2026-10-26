/**
 *  modeler/placements.ts
 *
 *  A layout as something a scene graph can apply: per part, where its centre goes and how it
 *  is turned about that centre.
 *
 *  A Layouter transform is a recipe for the kernel, not a rigid transform about anything a
 *  viewer knows: `Layouter._applyTransforms()` turns a shape with `rotateQuaternion()`, which
 *  keeps the shape's bounding-box centre where it was (`Mesh.rotateQuaternion()` moves it back
 *  there), and only then translates it. So a part with centre `c` ends up turned by `R` about
 *  `c`, with its centre at `c + translation`:
 *
 *      p' = R (p − c) + c + translation
 *
 *  That is what a glTF node and a three.js object can apply. Writing the rotation straight
 *  onto a node, as GLTFBuilder.addAnimations() used to, turns the part about the node's
 *  origin instead, which for meshup's containers is the world origin: every turned part of a
 *  laid-out clip swung round it.
 *
 *  Instruct used to read the same positions off laid-out COPIES of the shapes. A copy's centre
 *  after the recipe is `c + translation` by construction, so this gives the same answer
 *  without copying anything.
 *
 *  Duck-typed (`shape()`, `bbox().center()`, `path()`), like modeler/parts.ts, so it works for
 *  either kernel and needs no runtime meshup import.
 */

import type { LayoutTransformation, LayoutTransformationResult } from './types'

export interface LayoutPlacement
{
    /** The scene node the transform was for, and its shape. */
    sceneNode: any
    shape: any
    /** SceneNode.path(), or the node's name when it cannot say. */
    path: string
    /** Where the part's centre ends up, world coordinates. */
    position: [number, number, number]
    /** Rotation about the part's own centre, [x, y, z, w]. */
    rotation: [number, number, number, number]
    /** Scale about the part's own centre. */
    scale: [number, number, number]
    /** The part's authored centre — what the rotation turns about. */
    centre: [number, number, number]
}

/** Every transform of a layout as a placement about the part's own centre. A transform whose
 *  node holds no shape (nothing to measure a centre on) is left out. */
export function placementsOf(result: LayoutTransformationResult): Array<LayoutPlacement>
{
    return result.transforms
        .map(transform => placementOf(transform))
        .filter((p): p is LayoutPlacement => p !== null)
}

export function placementOf(transform: LayoutTransformation): LayoutPlacement | null
{
    const node = transform.sceneNode as any
    const shape = node?.shape?.()
    const centre = centreOf(shape)
    if (!centre) { return null }

    const t = transform.translation
    return {
        sceneNode: node,
        shape,
        path: (typeof node?.path === 'function') ? node.path() : (node?.name ?? ''),
        position: [centre[0] + t[0], centre[1] + t[1], centre[2] + t[2]],
        rotation: [...transform.rotation] as [number, number, number, number],
        scale: [...transform.scale] as [number, number, number],
        centre,
    }
}

/** Bounding-box centre of a shape — the point the kernel turns it about. */
export function centreOf(shape: any): [number, number, number] | null
{
    const c = shape?.bbox?.()?.center?.()
    if (!c || typeof c.x !== 'number') { return null }
    return [c.x, c.y, c.z]
}
