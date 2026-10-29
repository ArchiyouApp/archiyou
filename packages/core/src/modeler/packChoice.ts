/**
 *  packChoice.ts
 *
 *  How make.pack() tells whether a set of shapes is a job for the sheet packer (2D) or for the load planner (3D).
 *  Every shape votes on what it is: a curve, a polygon, an open surface or a plate (a solid at most a tenth as thick
 *  as it is wide, like a board) is flat and votes 2D; any other closed solid votes 3D. The majority decides, and a tie
 *  goes to 2D.
 */

import { PLATE_RATIO } from './parts';

export type Dimension = '2d' | '3d';

/** Whether a shape is a closed solid (a mesh without open edges, or a brep solid). */
export function isClosedSolid(shape: any): boolean
{
    return typeof shape?.isSolid === 'function' && Boolean(shape.isSolid());
}

/** What a shape is for the packer: flat things and plates are 2D, other solids are 3D. */
export function dimensionOf(shape: any): Dimension
{
    if (!isClosedSolid(shape)) return '2d';
    const box = shape.obbox?.();
    if (!box) return '2d';
    const [thickness, width] = [box.width(), box.height(), box.depth()].sort((a: number, b: number) => a - b);
    return !(thickness > 0) || width / thickness >= PLATE_RATIO ? '2d' : '3d';
}

/** The indices of the shapes that vote 2D and 3D, and what the majority makes of it. */
export function vote(shapes: any[]): { flat: number[]; solid: number[]; dimension: Dimension }
{
    const dimensions = shapes.map(dimensionOf);
    const indices = (wanted: Dimension) => dimensions.flatMap((d, i) => (d === wanted ? [i] : []));
    const [flat, solid] = [indices('2d'), indices('3d')];
    return { flat, solid, dimension: solid.length > flat.length ? '3d' : '2d' };
}
