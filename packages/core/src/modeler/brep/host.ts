/**
 *  host.ts — reaching the host application from a brep Shape.
 *
 *  brep shapes used to hold `_brep`, a back-reference to a `Brep` god-class that owned the
 *  scene, the units, the annotator and the layer naming. That class is gone: the scene is now
 *  meshup's `SceneNode` graph and the app modules hang off `Modeler`.
 *
 *  Shapes instead carry `_modeler` — the same opaque back-reference meshup shapes carry, set
 *  when a shape is adopted into a scene (see Modeler._adopt). It is opaque on purpose: the
 *  kernel never reaches into the app except through the narrow accessors below.
 *
 *  Every accessor tolerates a detached shape (no modeler), because brep is usable standalone —
 *  `new brep.Solid().makeBox(10)` outside any Modeler must keep working.
 */

import type { ModelUnits } from './types'

/** The host modeler, or null for a standalone shape.
 *
 *  Also accepts a ShapeCollection. Collections are built ad-hoc (`new ShapeCollection(shape)`)
 *  and never adopted by the Modeler, so they carry no `_modeler` of their own — but their
 *  members do, and that is what `ShapeCollection.autoDim()` needs to reach the annotator. */
export function hostModeler(shape: any): any
{
    if (shape?._modeler){ return shape._modeler }

    const members = shape?.shapes // brep ShapeCollection holds a plain Array<AnyShape>
    if (Array.isArray(members))
    {
        for (const s of members){ if (s?._modeler){ return s._modeler } }
    }

    return null
}

/** The app modules (annotator, calc, docs, materials, …), or null when standalone. */
export function hostModules(shape: any): any
{
    return hostModeler(shape)?.modules ?? null
}

/** Model units of the host, defaulting to mm for a standalone shape — the same default
 *  `Modeler` itself uses. */
export function hostUnits(shape: any): ModelUnits
{
    const m = hostModeler(shape)
    if (!m) return 'mm'
    return (typeof m.units === 'function' ? m.units() : m._units) ?? 'mm'
}

/** The annotator module. Annotations are meaningless without a host, so this reports the
 *  cause rather than failing later with a null dereference. */
export function hostAnnotator(shape: any, method: string): any
{
    const annotator = hostModules(shape)?.annotator
    if (!annotator)
    {
        throw new Error(
            `${method}: no annotator available. Annotations need a Shape that belongs to a ` +
            `Modeler scene — create it through the modeler (box(), sketch(), …) rather than ` +
            `constructing it directly.`)
    }
    return annotator
}

//// NAMING ////

let _nameSeq = 0

/** A name that is unique within this session.
 *
 *  Replaces the old `Brep.getNextLayerName()`, which walked the scene for collisions. Scene
 *  naming is `SceneNode`'s job now (it de-duplicates sibling display names itself), so this
 *  only has to guarantee the suffix is fresh. */
export function nextName(prefix: string): string
{
    return `${prefix}_${++_nameSeq}`
}

/** @internal test seam — makes generated names deterministic across tests. */
export function _resetNameSeq(): void
{
    _nameSeq = 0
}
