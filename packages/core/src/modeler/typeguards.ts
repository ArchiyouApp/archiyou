import type { PointLike, AnyShapeCollection, AnyShapeOrCollection } from './types'

import { isPointLike as meshupIsPointLike } from '@archiyou/meshup'

export function isPointLike(value: any): value is PointLike
{
    // brep accepts a superset of meshup's PointLike (relative coord strings, axis shorthands)
    // and reads anything with x/y/z, so the mesh contract is the right common denominator here.
    return meshupIsPointLike(value);
}

//// KERNEL-NEUTRAL SHAPE GUARDS ////

/*  App modules (docs, annotator, calc) must not care which kernel produced a shape. Testing
    `instanceof meshup.Shape` silently rejects everything the brep kernel makes — that is how a
    brep doc pipeline ended up reporting "not a Shape or ShapeCollection (got _ShapeCollection)".

    Both kernels answer the same two questions on the instance, so these are structural. */

/** A ShapeCollection from EITHER kernel. */
export function isKernelShapeCollection(o: any): o is AnyShapeCollection
{
    if (!o || typeof o !== 'object') return false;
    if (typeof o.isShapeCollection === 'function') return !!o.isShapeCollection();
    return o.type === 'ShapeCollection';
}

/** A single Shape from EITHER kernel (collections excluded — they answer isShapeClass() too). */
export function isKernelShape(o: any): boolean
{
    if (!o || typeof o !== 'object') return false;
    if (isKernelShapeCollection(o)) return false;
    return typeof o.isShapeClass === 'function' ? !!o.isShapeClass() : false;
}

/** A Shape or ShapeCollection from EITHER kernel. */
export function isKernelShapeOrCollection(o: any): o is AnyShapeOrCollection
{
    return isKernelShape(o) || isKernelShapeCollection(o);
}

/** Render a Shape or ShapeCollection to SVG using ITS OWN kernel's exporter.
 *  Wrapping a brep shape in a meshup ShapeCollection (or the reverse) draws nothing — each
 *  kernel's collection only knows its own geometry. */
export function kernelShapeToSVG(o: any, options?: any): string | null
{
    if (typeof o?.toSVG !== 'function') return null;
    return o.toSVG(options);
}
